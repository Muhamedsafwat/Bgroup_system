import type { SessionUser } from "@/types";
import type { Prisma } from "@/generated/prisma";

/**
 * Who can see what in the cold-lead system:
 *
 *   ADMIN          — every lead (the "big directory" the user described).
 *   MANAGER        — leads assigned to themselves or any of their direct reports.
 *   ASSISTANT      — read access to the whole entity (for coverage planning).
 *   REP            — only leads explicitly assigned to them.
 *   ACCOUNT_MGR    — out of scope, returns an empty filter.
 *
 * Used as a Prisma where-fragment alongside the optional category/industry/
 * location filters from the request.
 */
export function scopeColdLeadsByRole(session: SessionUser): Prisma.CrmColdLeadWhereInput {
  switch (session.role) {
    case "ADMIN":
      return {};
    case "MANAGER":
      return {
        OR: [
          { assignedToId: session.id },
          { assignedTo: { managerId: session.id } },
          // Managers also see the unassigned pool so they can distribute.
          { assignedToId: null },
        ],
      };
    case "ASSISTANT":
      return session.entityId
        ? { assignedTo: { entityId: session.entityId } }
        : {};
    case "REP":
      return { assignedToId: session.id };
    case "ACCOUNT_MGR":
      return { id: "__none__" };
    default:
      return { assignedToId: session.id };
  }
}

/// 30 days default cooldown for WAITING_LIST entries. NO_ANSWER goes back to
/// the pool with no cooldown — managers can redistribute immediately.
export const WAITING_LIST_COOLDOWN_DAYS = 30;

export function computeRecycleEligibility(disposition: string): Date | null {
  if (disposition === "WAITING_LIST") {
    const d = new Date();
    d.setDate(d.getDate() + WAITING_LIST_COOLDOWN_DAYS);
    return d;
  }
  if (disposition === "NO_ANSWER") {
    // Eligible immediately so a manager can push it back to a rep.
    return new Date();
  }
  return null;
}
