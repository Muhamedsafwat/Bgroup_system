import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";
import { describeZodError } from "@/lib/zod-errors";

// SECURITY (audit v12 HIGH #36): bound JSON blob size on POST — mirrors the
// boundedJson guard already applied to PATCH in [id]/route.ts. Without this,
// a caller could persist a multi-MB `filters` blob on creation, ballooning
// every subsequent GET for shared views. Cap each field at 8 KB serialised.
// A 32 KB total-body ceiling is enforced before parsing (see POST handler).
const boundedJson = z
  .unknown()
  .refine((v) => JSON.stringify(v ?? {}).length <= 8192, {
    message: "Field is too large (max 8 KB).",
  });

const createSchema = z.object({
  scope: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(60),
  filters: boundedJson,
  sort: boundedJson.optional(),
  columns: boundedJson.optional(),
  isShared: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

/**
 * Map a saved-view `scope` string to the module it belongs to. Used to
 * gate access so a CRM-only user can't list / create HR saved views.
 * Returns null if the scope is unknown — those are rejected as 400.
 */
// audit v12 HIGH (HIGH-37): added "tasks" to return type — tasks scopes were
// unmatched, causing moduleForScope to return null and every task saved-view
// request to be rejected with 403.
function moduleForScope(scope: string): "hr" | "crm" | "partners" | "tasks" | null {
  if (
    scope.startsWith("hr-") ||
    scope === "hr" ||
    scope.startsWith("hr:") ||
    scope.startsWith("hr/")
  ) {
    return "hr";
  }
  if (
    scope.startsWith("crm-") ||
    scope === "crm" ||
    scope.startsWith("crm:") ||
    scope.startsWith("crm/")
  ) {
    return "crm";
  }
  if (
    scope.startsWith("partners-") ||
    scope === "partners" ||
    scope.startsWith("partners:") ||
    scope.startsWith("partners/")
  ) {
    return "partners";
  }
  // audit v12 HIGH #37: tasks scopes are available to every authenticated user.
  if (
    scope.startsWith("tasks-") ||
    scope === "tasks" ||
    scope.startsWith("tasks:") ||
    scope.startsWith("tasks/")
  ) {
    return "tasks";
  }
  return null;
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const scope = url.searchParams.get("scope");
  if (!scope) {
    return NextResponse.json({ error: "scope is required" }, { status: 400 });
  }

  // Per-module gate: a user without the relevant module shouldn't be
  // able to read shared saved-views from another module. The previous
  // version returned every shared row for any `scope` value, leaking
  // HR filter sets to CRM-only users (and vice versa).
  const module = moduleForScope(scope);
  // audit v12 HIGH #37: tasks module is available to all authenticated users —
  // skip the modules-array check when the resolved module is "tasks".
  if (!module || (module !== "tasks" && !session.user.modules?.includes(module))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const views = await db.savedView.findMany({
    where: {
      scope,
      OR: [{ userId: session.user.id }, { isShared: true }],
    },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
  return NextResponse.json({ views });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // SECURITY (audit v12 HIGH #36): reject bodies over 32 KB before parsing
  // to prevent a multi-MB request from being fully buffered and decoded.
  const rawText = await req.text();
  if (rawText.length > 32768) {
    return NextResponse.json({ error: "Request body too large (max 32 KB)." }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(rawText);
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    const __z = describeZodError(parsed.error);
    return NextResponse.json({ error: __z.message, fieldErrors: __z.fieldErrors }, { status: 422 });
  }

  // Per-module gate: don't let a user create a saved view in a module
  // they don't have access to (e.g. a CRM-only ADMIN creating a shared
  // HR view that pollutes every HR user's view menu).
  const module = moduleForScope(parsed.data.scope);
  // audit v12 HIGH #37: tasks module is available to all authenticated users —
  // skip the modules-array check when the resolved module is "tasks".
  if (!module || (module !== "tasks" && !session.user.modules?.includes(module))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // SECURITY (audit v12 HIGH #35): derive isModuleAdmin from the module that
  // owns the requested scope only, so a CRM admin cannot share HR views.
  // A platform super_admin (hrRoles includes "super_admin") spans all modules.
  const isPlatformAdmin = session.user.hrRoles?.includes("super_admin") ?? false;
  let isModuleAdmin = false;
  if (isPlatformAdmin) {
    isModuleAdmin = true;
  } else if (module === "crm") {
    isModuleAdmin = session.user.crmRole === "ADMIN";
  } else if (module === "hr") {
    isModuleAdmin = false; // only platform super_admin can share HR views
  } else if (module === "partners") {
    isModuleAdmin =
      session.user.modules?.includes("partners") === true &&
      !session.user.partnerId;
  }

  if (parsed.data.isShared && !isModuleAdmin) {
    return NextResponse.json(
      { error: "Forbidden: insufficient role to create a shared view for this scope." },
      { status: 403 }
    );
  }

  const view = await db.savedView.create({
    data: {
      userId: session.user.id,
      scope: parsed.data.scope,
      name: parsed.data.name,
      filters: parsed.data.filters as object,
      sort: parsed.data.sort as object | undefined,
      columns: parsed.data.columns as object | undefined,
      isShared: !!parsed.data.isShared,
      isDefault: !!parsed.data.isDefault,
    },
  });

  return NextResponse.json({ view }, { status: 201 });
}
