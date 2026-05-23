import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isAdminOnly } from "@/lib/crm/admin-gates";

/**
 * POST /api/crm/admin/lead-sla/evaluate
 *
 * One-shot SLA breach evaluator. Walks every active CrmLeadSlaPolicy
 * and finds cold leads where `now - assignedAt > targetMinutes`. For
 * each breach, the configured `breachAction` runs:
 *
 *   "notify-manager"      — no DB mutation; counted in the response so
 *                           the caller (cron or admin UI) can fan out
 *                           notifications (the email/Slack side of the
 *                           notify pipeline is out of scope here).
 *   "reassign-unassigned" — clear assignedToId, status back to NEW so
 *                           the lead returns to the unassigned pool.
 *   "no-op"               — just log it; useful for dry-run setup.
 *
 * Returns counts per status + per action. Idempotent — re-running on the
 * same minute won't re-process already-reassigned leads because their
 * status is no longer in the policy's window.
 *
 * Gate: ADMIN + super-admin only (cron jobs hit this with a service
 * token in production; today it's a manual-trigger admin tool).
 */

export async function POST() {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdminOnly(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const policies = await db.crmLeadSlaPolicy.findMany({
    where: { active: true },
  });
  if (policies.length === 0) {
    return NextResponse.json({ ok: true, evaluated: 0, breaches: 0, perStatus: {} });
  }

  const now = new Date();
  type Counts = { evaluated: number; breaches: number; actionsRun: number };
  const perStatus: Record<string, Counts> = {};
  let totalBreaches = 0;
  let totalEvaluated = 0;

  for (const p of policies) {
    const cutoff = new Date(now.getTime() - p.targetMinutes * 60_000);
    // Eligible leads: status matches, assignedAt older than cutoff.
    // We don't track per-lead "lastNotifiedAt", so notify-manager
    // returns a count and trusts the caller to dedupe at delivery
    // time (or this becomes an idempotent insert into a notifications
    // table — out of scope for the first cut).
    const breaching = await db.crmColdLead.findMany({
      where: {
        status: p.status,
        assignedAt: { lt: cutoff, not: null },
      },
      select: { id: true, assignedToId: true },
    });
    const evaluated = await db.crmColdLead.count({ where: { status: p.status } });
    totalEvaluated += evaluated;
    totalBreaches += breaching.length;
    let actionsRun = 0;

    if (p.breachAction === "reassign-unassigned" && breaching.length > 0) {
      const res = await db.crmColdLead.updateMany({
        where: { id: { in: breaching.map((b) => b.id) } },
        data: { assignedToId: null, status: "NEW", assignedAt: null },
      });
      actionsRun = res.count;
    } else if (p.breachAction === "notify-manager") {
      // No-op at the DB layer; the count is the actionable signal.
      actionsRun = breaching.length;
    }
    // "no-op" leaves actionsRun = 0.

    perStatus[p.status] = { evaluated, breaches: breaching.length, actionsRun };
  }

  return NextResponse.json({
    ok: true,
    evaluated: totalEvaluated,
    breaches: totalBreaches,
    perStatus,
  });
}
