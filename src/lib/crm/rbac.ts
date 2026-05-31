import type { SessionUser } from "@/types";

/**
 * Returns a Prisma `where` clause fragment that scopes Opportunity queries by role.
 *
 * - REP: own opportunities only.
 * - MANAGER: everything. MANAGER is "ADMIN minus settings" — they oversee
 *   the entire sales operation, can supply any rep with data, reassign
 *   ownership across teams, and act on opps owned by anyone. The M2M
 *   CrmTeamMembership rows still exist for focused "my team" views and
 *   leaderboard / group-dashboard scoping, but the read-scope itself is
 *   unbounded. (Before: team-only via `managerId` + `managedBy`. Reverted
 *   because it left managers unable to see opps owned by reps outside
 *   their direct team even though they're accountable for the whole
 *   pipeline.)
 * - ASSISTANT: limited to opps tied to meetings they touched.
 * - ACCOUNT_MGR: own delivery-owned WON deals only.
 * - ADMIN: everything.
 */
export function scopeOpportunityByRole(session: SessionUser) {
  switch (session.role) {
    case "REP":
      return { ownerId: session.id };
    case "MANAGER":
      return {};
    case "ASSISTANT":
      // Assistants no longer see the whole entity's pipeline. They only see
      // opportunities tied to a meeting they scheduled OR approved/denied —
      // i.e. the deals they're already in the loop on. The opp detail page
      // ties this to the post-meeting "write minutes / update what happened"
      // workflow without exposing the rest of the pipeline.
      return {
        meetings: {
          some: {
            OR: [
              { scheduledById: session.id },
              { approvedById: session.id },
            ],
          },
        },
      };
    case "ACCOUNT_MGR":
      return { deliveryOwnerId: session.id, stage: "WON" as const };
    case "ADMIN":
      return {};
    default:
      return { ownerId: session.id };
  }
}

/**
 * Returns a Prisma `where` clause fragment for Company queries.
 * MANAGER is treated as ADMIN here — they curate the company directory
 * across the whole CRM, not just their team's accounts.
 */
export function scopeCompanyByRole(session: SessionUser) {
  switch (session.role) {
    case "REP":
      return { assignedToId: session.id };
    case "MANAGER":
      return {};
    case "ASSISTANT":
      // Assistants don't browse companies. Return a clause that matches
      // nothing — they get to companies via the meeting-linked opportunity
      // detail page, which has its own access check.
      return { id: "__none__" };
    case "ADMIN":
      return {};
    default:
      return { assignedToId: session.id };
  }
}

/**
 * Returns a Prisma `where` clause fragment for Call queries.
 * MANAGER sees every call across the org (same as ADMIN) — they coach
 * across teams and need full visibility, not just their direct reports.
 */
export function scopeCallByRole(session: SessionUser) {
  switch (session.role) {
    case "REP":
      return { callerId: session.id };
    case "MANAGER":
      return {};
    case "ASSISTANT":
      // Assistants don't see other reps' call logs.
      return { id: "__none__" };
    case "ADMIN":
      return {};
    default:
      return { callerId: session.id };
  }
}

/**
 * Check if a role can access a given route pattern.
 */
export function canAccessRoute(
  role: SessionUser["role"],
  pathname: string
): boolean {
  // Admin routes
  if (pathname.startsWith("/admin")) {
    return role === "ADMIN";
  }
  // Group dashboard
  if (pathname.startsWith("/group")) {
    return role === "ADMIN" || role === "MANAGER";
  }
  // All other dashboard routes are accessible to authenticated users
  return true;
}

/**
 * Returns the default landing page for a given role.
 */
export function getDefaultRoute(role: SessionUser["role"]): string {
  switch (role) {
    case "ADMIN":
    case "MANAGER":
      return "/crm/group";
    case "ASSISTANT":
      // Assistant defaults to the meeting approval queue.
      return "/crm/meetings";
    default:
      return "/crm/my";
  }
}
