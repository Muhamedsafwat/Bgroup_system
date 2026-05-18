import type { SessionUser } from "@/types";

/**
 * Returns a Prisma `where` clause fragment that scopes Opportunity queries by role.
 *
 * - REP: own opportunities only.
 * - MANAGER: opportunities OWNED by the manager OR by any rep on this
 *   manager's team. "On the team" is checked two ways and OR'd together:
 *     - legacy single-FK `CrmUserProfile.managerId` (primary manager)
 *     - many-to-many `CrmTeamMembership` (additional managers — the same
 *       rep can be on multiple managers' teams)
 *   Both are checked so legacy data keeps working while the team-members
 *   picker now syncs the join table for new assignments.
 * - ASSISTANT: limited to opps tied to meetings they touched.
 * - ACCOUNT_MGR: own delivery-owned WON deals only.
 * - ADMIN: everything.
 */
export function scopeOpportunityByRole(session: SessionUser) {
  switch (session.role) {
    case "REP":
      return { ownerId: session.id };
    case "MANAGER":
      return {
        OR: [
          { ownerId: session.id },
          { owner: { managerId: session.id } },
          { owner: { managedBy: { some: { managerId: session.id } } } },
        ],
      };
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
 * Managers see companies assigned to themselves or any team member
 * (primary or many-to-many).
 */
export function scopeCompanyByRole(session: SessionUser) {
  switch (session.role) {
    case "REP":
      return { assignedToId: session.id };
    case "MANAGER":
      return {
        OR: [
          { assignedToId: session.id },
          { assignedTo: { managerId: session.id } },
          { assignedTo: { managedBy: { some: { managerId: session.id } } } },
        ],
      };
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
 * Managers see calls made by themselves or any team member (primary or
 * many-to-many).
 */
export function scopeCallByRole(session: SessionUser) {
  switch (session.role) {
    case "REP":
      return { callerId: session.id };
    case "MANAGER":
      return {
        OR: [
          { callerId: session.id },
          { caller: { managerId: session.id } },
          { caller: { managedBy: { some: { managerId: session.id } } } },
        ],
      };
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
