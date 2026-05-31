import { db } from "@/lib/db";

/**
 * Tier-1 #13 — stalled-deal detection.
 *
 * An opportunity is "stalled" when its CURRENT stage has a `maxDays`
 * threshold set in CrmStageConfig AND the opp has been in that stage
 * for longer than maxDays without a stage-history transition. We
 * measure days-in-stage from the most recent CrmStageHistory entry
 * for the opp; if there's no history we fall back to `createdAt`.
 *
 * The function returns a map of opp id → days-in-stage so the kanban
 * card can render the "stalled X days" pill in one pass for every
 * opp it displays. A second function `countStalled` is what the
 * group dashboard uses for the "N stuck deals" widget.
 */
type OppLite = { id: string; stage: string; createdAt: Date };

export async function getStalledMap(
  opps: OppLite[]
): Promise<Map<string, { daysInStage: number; maxDays: number; targetDays: number | null }>> {
  if (opps.length === 0) return new Map();

  const stages = Array.from(new Set(opps.map((o) => o.stage)));
  const configs = await db.crmStageConfig.findMany({
    where: { stage: { in: stages }, isActive: true },
    select: { stage: true, targetDays: true, maxDays: true },
  });
  const cfgByStage = new Map(configs.map((c) => [c.stage, c]));

  // Pull the most recent stage-history entry for each opp in one query.
  // findMany + orderBy gives us all the rows; we collapse to one per
  // opp by walking the result (already sorted by changedAt desc).
  const history = await db.crmStageHistory.findMany({
    where: { opportunityId: { in: opps.map((o) => o.id) } },
    select: { opportunityId: true, toStage: true, changedAt: true },
    orderBy: { changedAt: "desc" },
  });
  const lastChangeByOpp = new Map<string, Date>();
  for (const h of history) {
    if (!lastChangeByOpp.has(h.opportunityId)) {
      lastChangeByOpp.set(h.opportunityId, h.changedAt);
    }
  }

  const now = Date.now();
  const result = new Map<
    string,
    { daysInStage: number; maxDays: number; targetDays: number | null }
  >();
  for (const o of opps) {
    const cfg = cfgByStage.get(o.stage);
    if (!cfg?.maxDays) continue; // no threshold configured → not stalled
    const lastChange = lastChangeByOpp.get(o.id) ?? o.createdAt;
    const daysInStage = Math.floor((now - lastChange.getTime()) / (24 * 60 * 60 * 1000));
    if (daysInStage > cfg.maxDays) {
      result.set(o.id, {
        daysInStage,
        maxDays: cfg.maxDays,
        targetDays: cfg.targetDays ?? null,
      });
    }
  }
  return result;
}

/**
 * Count of currently-stalled opps across a (typically scope-filtered)
 * set. Caller passes the same opp-lite list the group dashboard
 * already loads so we don't double-query.
 */
export async function countStalled(opps: OppLite[]): Promise<number> {
  const map = await getStalledMap(opps);
  return map.size;
}
