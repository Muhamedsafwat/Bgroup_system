import type { Session } from "next-auth";

/**
 * Single source of truth for CRM admin-route gating.
 *
 * Two distinct gates show up across ~17 endpoints:
 *
 *   - `isManagerOrAdmin` — "people-class" actions: anything that
 *     supplies a rep with data, reassigns territory, reads team
 *     dashboards, exports reports. MANAGER is "ADMIN minus settings",
 *     so they're allowed here.
 *
 *   - `isAdminOnly` — "settings-class" actions: pipelines, workflows,
 *     alert rules, custom fields, lead-transitions, lead-sla,
 *     playbooks, activity-quotas, field-permissions, competitors-write,
 *     forecast-submission. MANAGER is NOT allowed.
 *
 * Both gates also accept the platform `super_admin` (HR roles) and
 * the platform-level Partners admin (a user with `partners` access
 * but no `partnerId`). Keeping these two functions side-by-side
 * prevents the next admin endpoint from accidentally drifting into
 * either gate by copy-pasting the wrong inline helper.
 */

export function isPlatformAdmin(session: Session | null): boolean {
  if (!session?.user) return false;
  return (
    !!session.user.hrRoles?.includes("super_admin") ||
    (!!session.user.modules?.includes("partners") && !session.user.partnerId)
  );
}

export function isManagerOrAdmin(session: Session | null): boolean {
  if (!session?.user) return false;
  if (isPlatformAdmin(session)) return true;
  const role = session.user.crmRole;
  return role === "ADMIN" || role === "MANAGER";
}

export function isAdminOnly(session: Session | null): boolean {
  if (!session?.user) return false;
  if (isPlatformAdmin(session)) return true;
  return session.user.crmRole === "ADMIN";
}
