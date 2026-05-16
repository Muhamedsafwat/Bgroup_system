import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Routes that don't require authentication
const publicPaths = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/api/auth",
  "/book", // public booking pages
  "/jobs", // public job posts
  "/api/health", // observability probe
];

// Public API endpoints that bypass module gates entirely.
const PUBLIC_API_PATTERNS = [
  /^\/api\/hr\/jobs\/[^/]+\/apply$/, // public application submission
  /^\/api\/v1\/.*/, // versioned public REST API uses API-key auth
];

function isPublic(pathname: string): boolean {
  if (publicPaths.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return true;
  }
  return PUBLIC_API_PATTERNS.some((re) => re.test(pathname));
}

/**
 * Role-aware route policy. Module access is necessary but not sufficient for
 * the "manager-only" surfaces — an HR employee may have hrAccess=true yet
 * have no business on /hr/dashboard, /hr/accountant, /admin/*, etc. The
 * previous proxy only enforced module gates, so an "employee" could browse
 * those URLs directly; pages have client-side redirects but those flash before
 * firing. This policy blocks at the proxy so the data never leaves the server.
 *
 * A rule matches if the request pathname starts with `prefix`. The first
 * matching rule wins. `allowedHrRoles` is checked against `session.user.hrRoles`;
 * `platformAdminOnly` matches super_admin OR partners-admin-without-partnerId.
 */
type RoleRule = {
  prefix: string;
  platformAdminOnly?: boolean;
  allowedHrRoles?: string[];
  /// Optional human-readable explanation, surfaced as ?denied=... on redirect.
  reason: string;
};

const ROLE_RULES: RoleRule[] = [
  // Platform admin surfaces
  { prefix: "/admin", platformAdminOnly: true, reason: "admin-only" },
  { prefix: "/api/admin", platformAdminOnly: true, reason: "admin-only" },

  // HR manager / leadership surfaces (excludes /hr/employee/* and /hr/team/*)
  {
    prefix: "/hr/dashboard",
    allowedHrRoles: ["super_admin", "hr_manager", "ceo", "accountant", "team_lead"],
    reason: "hr-manager-only",
  },
  {
    prefix: "/hr/accountant",
    allowedHrRoles: ["super_admin", "hr_manager", "accountant", "ceo"],
    reason: "accountant-only",
  },
  {
    prefix: "/hr/management",
    allowedHrRoles: ["super_admin", "hr_manager", "ceo"],
    reason: "management-only",
  },
  {
    prefix: "/hr/settings",
    allowedHrRoles: ["super_admin", "hr_manager"],
    reason: "settings-only",
  },
  {
    prefix: "/hr/payroll",
    allowedHrRoles: ["super_admin", "hr_manager", "accountant", "ceo"],
    reason: "payroll-only",
  },
  {
    prefix: "/hr/reports",
    allowedHrRoles: ["super_admin", "hr_manager", "accountant", "ceo"],
    reason: "reports-only",
  },
  {
    prefix: "/hr/employees",
    allowedHrRoles: ["super_admin", "hr_manager", "ceo", "team_lead"],
    reason: "employees-only",
  },
  {
    prefix: "/hr/bonuses",
    allowedHrRoles: ["super_admin", "hr_manager", "accountant", "ceo"],
    reason: "bonuses-only",
  },
  {
    prefix: "/hr/overtime/pending",
    allowedHrRoles: ["super_admin", "hr_manager", "team_lead"],
    reason: "overtime-approvals",
  },
  {
    prefix: "/hr/overtime/report",
    allowedHrRoles: ["super_admin", "hr_manager", "accountant", "ceo"],
    reason: "overtime-reports",
  },
  {
    prefix: "/hr/incidents/all",
    allowedHrRoles: ["super_admin", "hr_manager", "team_lead", "ceo"],
    reason: "incidents-mgr",
  },
  {
    prefix: "/hr/incidents/progressive",
    allowedHrRoles: ["super_admin", "hr_manager", "ceo"],
    reason: "incidents-progressive",
  },
  {
    prefix: "/hr/attendance/today",
    allowedHrRoles: ["super_admin", "hr_manager", "team_lead", "ceo"],
    reason: "attendance-mgr",
  },
  {
    prefix: "/hr/attendance/settings",
    allowedHrRoles: ["super_admin", "hr_manager"],
    reason: "attendance-settings",
  },
  {
    prefix: "/hr/attendance/report",
    allowedHrRoles: ["super_admin", "hr_manager", "accountant", "ceo"],
    reason: "attendance-report",
  },
  {
    prefix: "/hr/org-chart",
    allowedHrRoles: ["super_admin", "hr_manager", "ceo", "team_lead"],
    reason: "org-chart",
  },
  {
    prefix: "/hr/team",
    allowedHrRoles: ["super_admin", "hr_manager", "ceo", "team_lead"],
    reason: "team-only",
  },
];

function isAdmin(modules: ("hr" | "crm" | "partners")[], hrRoles: string[], partnerId?: string | null) {
  return hrRoles.includes("super_admin") || (modules.includes("partners") && !partnerId);
}

function findDeniedRule(
  pathname: string,
  modules: ("hr" | "crm" | "partners")[],
  hrRoles: string[],
  partnerId: string | null | undefined
): RoleRule | null {
  const rule = ROLE_RULES.find((r) => pathname === r.prefix || pathname.startsWith(r.prefix + "/"));
  if (!rule) return null;
  if (rule.platformAdminOnly) {
    return isAdmin(modules, hrRoles, partnerId) ? null : rule;
  }
  if (rule.allowedHrRoles) {
    // Platform admin always passes. Otherwise need at least one of the listed roles.
    if (isAdmin(modules, hrRoles, partnerId)) return null;
    const ok = rule.allowedHrRoles.some((r) => hrRoles.includes(r));
    return ok ? null : rule;
  }
  return null;
}

export async function proxy(request: NextRequest) {
  // Use NextAuth to get session
  const session = await auth();
  const { pathname } = request.nextUrl;

  // Allow public routes
  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  // Allow static files, _next, favicon
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // Not authenticated → API routes return JSON 401; pages redirect to login
  if (!session?.user) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const modules = session.user.modules || [];
  const hrRoles = session.user.hrRoles ?? [];
  const partnerId = session.user.partnerId ?? null;

  // Force-change-password gate: a user invited with a temporary admin-set
  // password (or one whose password an admin just reset) must pick a new
  // one before doing anything else. We let through:
  //   - the change-password page itself
  //   - the matching API endpoint
  //   - sign-out, NextAuth callbacks, and static assets (covered above)
  //   - account API endpoints the dialog needs (session + upload-photo)
  // Everything else hops to /account/change-password.
  if (session.user.mustChangePassword) {
    const allowDuringGate =
      pathname.startsWith("/account/change-password") ||
      pathname === "/api/account/change-password" ||
      pathname === "/api/auth/session" ||
      pathname === "/api/auth/signout" ||
      pathname.startsWith("/api/auth/callback");
    if (!allowDuringGate) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json(
          { error: "Password change required", code: "MUST_CHANGE_PASSWORD" },
          { status: 403 }
        );
      }
      const redirectTo = new URL("/account/change-password", request.url);
      return NextResponse.redirect(redirectTo);
    }
  }

  // Module access enforcement — pages
  if (pathname.startsWith("/hr") && !modules.includes("hr")) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  if (pathname.startsWith("/crm") && !modules.includes("crm")) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  if (pathname.startsWith("/partners") && !modules.includes("partners")) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // Module access enforcement — API routes
  if (pathname.startsWith("/api/hr") && !modules.includes("hr")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (pathname.startsWith("/api/crm") && !modules.includes("crm")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (pathname.startsWith("/api/partners") && !modules.includes("partners")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Role-aware gate: lock the manager/accountant/admin surfaces so a base
  // "employee" can't reach them by typing the URL. The page would client-side
  // redirect on its own, but that flashes, and worse the data has already
  // been fetched by the page render. Block here.
  const denied = findDeniedRule(pathname, modules, hrRoles, partnerId);
  if (denied) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: `Forbidden (${denied.reason})` }, { status: 403 });
    }
    // Route the user to whatever home they're entitled to see, with a flag
    // the UI can read to render a "you weren't allowed there" toast.
    const home = modules.includes("hr") ? "/hr/employee/home" : "/";
    const redirectTo = new URL(home, request.url);
    redirectTo.searchParams.set("denied", denied.reason);
    return NextResponse.redirect(redirectTo);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
