import type { SessionUser } from "@/types";

/**
 * Returns a Prisma `where` clause fragment that scopes Opportunity queries by role.
 * Must be spread into every Opportunity query's `where` clause.
 */
export function scopeOpportunityByRole(session: SessionUser) {
  switch (session.role) {
    case "REP":
      return { ownerId: session.id };
    case "MANAGER":
      // Manager sees opps owned by their direct reports (or, falling back,
      // the whole entity if their manager scope isn't pinned to specific reps).
      return session.entityId ? { entityId: session.entityId } : {};
    case "ASSISTANT":
      // Assistant gets read access to the whole entity for meeting + tech
      // coordination context, similar to the old TECH_DIRECTOR role.
      return session.entityId ? { entityId: session.entityId } : {};
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
 */
export function scopeCompanyByRole(session: SessionUser) {
  switch (session.role) {
    case "REP":
      return { assignedToId: session.id };
    case "MANAGER":
    case "ASSISTANT":
      return session.entityId
        ? { assignedTo: { entityId: session.entityId } }
        : {};
    case "ADMIN":
      return {};
    default:
      return { assignedToId: session.id };
  }
}

/**
 * Returns a Prisma `where` clause fragment for Call queries.
 */
export function scopeCallByRole(session: SessionUser) {
  switch (session.role) {
    case "REP":
      return { callerId: session.id };
    case "MANAGER":
    case "ASSISTANT":
      return session.entityId
        ? { caller: { entityId: session.entityId } }
        : {};
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
