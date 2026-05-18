import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * GET /api/crm/admin/users
 *
 * Lightweight list of CRM user profiles for the admin-side pickers:
 *   - the "Team members" multi-select on /admin/users (platform admin)
 *   - the "Reports to" select for new HR+CRM users
 *   - the GrantModuleDialog's CRM manager picker
 *
 * Returns id + fullName + role + managerId for every CRM profile. The page's
 * server action (`getUsers`) is the source of truth for the admin table, but
 * the rep picker had no equivalent fetch endpoint — it tried to hit this URL
 * and got a 404, so the picker silently showed "No reps to assign" even when
 * reps existed. Adding this route fixes that.
 *
 * Gated by the proxy `/api/crm/admin` rule (ADMIN/MANAGER + platform admin).
 */
function callerAllowed(session: Session | null) {
  if (!session?.user) return false;
  const role = session.user.crmRole;
  const platformAdmin =
    !!session.user.hrRoles?.includes("super_admin") ||
    (!!session.user.modules?.includes("partners") && !session.user.partnerId);
  return platformAdmin || role === "ADMIN" || role === "MANAGER";
}

export async function GET() {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!callerAllowed(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const profiles = await db.crmUserProfile.findMany({
    select: {
      id: true,
      fullName: true,
      fullNameAr: true,
      role: true,
      managerId: true,
      active: true,
      // M2M memberships — a rep can be on multiple managers' teams. The
      // EditUserDialog team-picker uses this to seed checkboxes from the
      // join table instead of the legacy single-FK managerId.
      managedBy: { select: { managerId: true } },
    },
    orderBy: [{ active: "desc" }, { fullName: "asc" }],
  });

  const shaped = profiles.map((p) => ({
    id: p.id,
    fullName: p.fullName,
    fullNameAr: p.fullNameAr,
    role: p.role,
    managerId: p.managerId,
    active: p.active,
    managedByIds: p.managedBy.map((m) => m.managerId),
  }));

  return NextResponse.json({ users: shaped });
}
