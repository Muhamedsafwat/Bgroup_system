import { db } from "@/lib/db";
import type { SessionUser } from "@/types";
import { scopeOpportunityByRole } from "@/lib/crm/rbac";
import { computeHygieneScore, getOverdueFollowups, getAgingProposals, getStaleLeads, getMissingNextActions } from "@/lib/crm/business/alerts";
import { countStalled } from "@/lib/crm/business/stalled";

/**
 * Sales targets are sourced from `CrmUserProfile.monthlyTargetEGP` per rep.
 * Used as a leaderboard floor and to drive the forecast page. Previously the
 * forecast summed targets from rows in the leaderboard, which was built FROM
 * opportunities — so a rep with zero opps (or a manager whose team hadn't
 * logged any opps yet) saw `Target: 0`. Pull from the rep list directly so
 * the number reflects what was actually set in CRM admin.
 */
const DEFAULT_TARGET_EGP = 50000;

function repTargetList(session: SessionUser) {
  switch (session.role) {
    case "REP":
      return { id: session.id };
    case "MANAGER":
      // MANAGER is "ADMIN minus settings" — the team target now sums every
      // active rep, same as ADMIN. The M2M team rows still drive the
      // optional "my team" filter on the dashboard, but the headline KPI
      // reflects the whole sales floor since managers are accountable for
      // pipeline beyond their direct reports.
      return { active: true };
    case "ASSISTANT":
      return session.entityId
        ? { entityId: session.entityId, active: true }
        : { id: "__none__" }; // assistants don't carry team-target context
    case "ACCOUNT_MGR":
      return { id: session.id };
    case "ADMIN":
      return { active: true };
    default:
      return { id: session.id };
  }
}

export async function getGroupDashboardData(
  session: SessionUser,
  filters?: { entityId?: string }
) {
  const scope = scopeOpportunityByRole(session);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const entityFilter = filters?.entityId ? { entityId: filters.entityId } : {};

  // Fetch open and won opps in parallel
  const [openOpps, wonOpps] = await Promise.all([
    db.crmOpportunity.findMany({
      where: {
        ...scope,
        ...entityFilter,
        stage: { notIn: ["WON", "LOST"] },
      },
      include: {
        company: { select: { nameEn: true } },
        owner: { select: { id: true, fullName: true, fullNameAr: true, monthlyTargetEGP: true } },
        entity: { select: { code: true, nameEn: true, nameAr: true, color: true } },
      },
    }),
    db.crmOpportunity.findMany({
      where: {
        ...scope,
        ...entityFilter,
        stage: "WON",
        dateClosed: { gte: monthStart },
      },
      include: {
        owner: { select: { id: true, fullName: true, fullNameAr: true, monthlyTargetEGP: true } },
        entity: { select: { code: true, nameEn: true, nameAr: true, color: true } },
      },
    }),
  ]);

  // Team target: sum of monthlyTargetEGP across the reps the caller is
  // accountable for. Falls back to DEFAULT_TARGET_EGP per rep where the admin
  // hasn't filled the field in yet so the gap math stays meaningful.
  const repTargets = await db.crmUserProfile.findMany({
    where: repTargetList(session),
    select: { id: true, monthlyTargetEGP: true },
  });
  const teamTarget = repTargets.reduce(
    (sum, r) => sum + (Number(r.monthlyTargetEGP) || DEFAULT_TARGET_EGP),
    0
  );

  // Aggregate KPIs
  const weightedPipeline = openOpps.reduce((sum, o) => sum + Number(o.weightedValueEGP), 0);
  const wonValueMTD = wonOpps.reduce((sum, o) => sum + Number(o.estimatedValueEGP), 0);

  // Leaderboard: group by owner
  const repMap = new Map<string, {
    userId: string;
    userName: string;
    entityCode: string;
    entityColor: string;
    openOpps: number;
    weightedPipeline: number;
    wonCount: number;
    wonValue: number;
    target: number;
  }>();

  for (const opp of openOpps) {
    const key = opp.owner.id;
    if (!repMap.has(key)) {
      repMap.set(key, {
        userId: opp.owner.id,
        userName: opp.owner.fullName,
        entityCode: opp.entity.code,
        entityColor: opp.entity.color,
        openOpps: 0,
        weightedPipeline: 0,
        wonCount: 0,
        wonValue: 0,
        // 0 = "no target set" — the leaderboard shows "—" in that case
        // instead of the misleading "wonValue / 50k = 500%" we used to render.
        target: opp.owner.monthlyTargetEGP ? Number(opp.owner.monthlyTargetEGP) : 0,
      });
    }
    const rep = repMap.get(key)!;
    rep.openOpps++;
    rep.weightedPipeline += Number(opp.weightedValueEGP);
  }

  for (const opp of wonOpps) {
    const key = opp.owner.id;
    if (!repMap.has(key)) {
      repMap.set(key, {
        userId: opp.owner.id,
        userName: opp.owner.fullName,
        entityCode: opp.entity.code,
        entityColor: opp.entity.color,
        openOpps: 0,
        weightedPipeline: 0,
        wonCount: 0,
        wonValue: 0,
        // 0 = "no target set" — the leaderboard shows "—" in that case
        // instead of the misleading "wonValue / 50k = 500%" we used to render.
        target: opp.owner.monthlyTargetEGP ? Number(opp.owner.monthlyTargetEGP) : 0,
      });
    }
    const rep = repMap.get(key)!;
    rep.wonCount++;
    rep.wonValue += Number(opp.estimatedValueEGP);
  }

  const leaderboard = Array.from(repMap.values())
    .map((rep) => ({
      ...rep,
      // Cap at 9999% so a missing-target rep can't blow out the column width.
      attainment:
        rep.target > 0
          ? Math.min(9999, Math.round((rep.wonValue / rep.target) * 100))
          : null,
      weightedPipeline: Math.round(rep.weightedPipeline),
      wonValue: Math.round(rep.wonValue),
    }))
    .sort((a, b) => b.wonValue - a.wonValue);

  // Top 10 hot
  const topHot = openOpps
    .filter((o) => o.priority === "HOT" || o.stage === "NEGOTIATION" || o.stage === "VERBAL_YES")
    .sort((a, b) => Number(b.weightedValueEGP) - Number(a.weightedValueEGP))
    .slice(0, 10)
    .map((o) => ({
      id: o.id,
      code: o.code,
      company: o.customerCompanyName ?? o.company?.nameEn ?? "—",
      owner: o.owner.fullName,
      entity: o.entity,
      stage: o.stage,
      priority: o.priority,
      weightedValueEGP: Number(o.weightedValueEGP),
    }));

  // Pipeline by entity
  const entityGroups: Record<string, { code: string; name: string; nameAr: string; color: string; count: number; totalValue: number; weightedValue: number }> = {};
  for (const opp of openOpps) {
    const key = opp.entity.code;
    if (!entityGroups[key]) {
      entityGroups[key] = { code: opp.entity.code, name: opp.entity.nameEn, nameAr: opp.entity.nameAr, color: opp.entity.color, count: 0, totalValue: 0, weightedValue: 0 };
    }
    entityGroups[key].count++;
    entityGroups[key].totalValue += Number(opp.estimatedValueEGP);
    entityGroups[key].weightedValue += Number(opp.weightedValueEGP);
  }

  // Pipeline by stage — needed for the forecast page's admin/manager
  // detail view. Rolling up count + value + weighted lets us show "we have
  // 6.3M sitting in Negotiation that should land this month" — much more
  // actionable than the single weighted-pipeline KPI. Pull stage configs
  // along the way to surface human-readable labels + probability + order.
  const stageConfigRows = await db.crmStageConfig.findMany({
    where: { isActive: true },
    orderBy: { displayOrder: "asc" },
    select: {
      stage: true,
      customLabelEn: true,
      customLabelAr: true,
      probabilityPct: true,
      displayOrder: true,
    },
  });
  const stageBuckets = new Map<
    string,
    {
      stage: string;
      labelEn: string;
      labelAr: string;
      probabilityPct: number;
      displayOrder: number;
      count: number;
      totalValue: number;
      weightedValue: number;
    }
  >();
  for (const cfg of stageConfigRows) {
    stageBuckets.set(cfg.stage, {
      stage: cfg.stage,
      labelEn: cfg.customLabelEn ?? cfg.stage,
      labelAr: cfg.customLabelAr ?? cfg.stage,
      probabilityPct: cfg.probabilityPct,
      displayOrder: cfg.displayOrder,
      count: 0,
      totalValue: 0,
      weightedValue: 0,
    });
  }
  for (const opp of openOpps) {
    let bucket = stageBuckets.get(opp.stage);
    if (!bucket) {
      // Defensive: opp uses a stage code that's no longer in CrmStageConfig
      // (admin retired the stage). Still surface it so the forecast totals
      // tie out — with a "displayOrder=9999" so retired stages sink to the
      // bottom.
      bucket = {
        stage: opp.stage,
        labelEn: opp.stage,
        labelAr: opp.stage,
        probabilityPct: Number(opp.probabilityPct),
        displayOrder: 9999,
        count: 0,
        totalValue: 0,
        weightedValue: 0,
      };
      stageBuckets.set(opp.stage, bucket);
    }
    bucket.count++;
    bucket.totalValue += Number(opp.estimatedValueEGP);
    bucket.weightedValue += Number(opp.weightedValueEGP);
  }
  const pipelineByStage = Array.from(stageBuckets.values())
    .filter((b) => b.count > 0)
    .sort((a, b) => a.displayOrder - b.displayOrder);

  // Alerts
  const alertableOpps = openOpps.map((o) => ({
    id: o.id,
    code: o.code,
    stage: o.stage,
    nextAction: o.nextAction,
    nextActionDate: o.nextActionDate,
    dateProposalSent: o.dateProposalSent,
    createdAt: o.createdAt,
    company: { nameEn: o.customerCompanyName ?? o.company?.nameEn ?? "—" },
  }));

  const totalAlerts =
    getOverdueFollowups(alertableOpps).length +
    getAgingProposals(alertableOpps).length +
    getStaleLeads(alertableOpps).length +
    getMissingNextActions(alertableOpps).length;

  // Tier-0 #9: coverage ratio = open weighted pipeline / remaining quota
  // gap. Single number that tells you if the quarter is at risk. A
  // ratio below ~3x is the standard "I need to prospect more" signal
  // for mid-market sales orgs. We compute it once at team-level here
  // and per-rep on the leaderboard so the dashboard surfaces both.
  // Remaining-quota = teamTarget − wonValueMTD. Guard against div-by-0
  // and negative gaps (already over quota = ratio = ∞ → null).
  const remainingTeamQuota = Math.max(0, teamTarget - wonValueMTD);
  const teamCoverageRatio =
    remainingTeamQuota > 0
      ? Math.round((weightedPipeline / remainingTeamQuota) * 100) / 100
      : null;

  // Per-rep coverage on the leaderboard. Same formula, scoped to each
  // rep's target − wonValue. Reps with no target (target=0) get null.
  const leaderboardWithCoverage = leaderboard.map((rep) => {
    const gap = Math.max(0, rep.target - rep.wonValue);
    const coverage =
      rep.target > 0 && gap > 0
        ? Math.round((rep.weightedPipeline / gap) * 100) / 100
        : null;
    return { ...rep, coverage };
  });

  // Tier-0 #10: anti-gaming flags on the leaderboard. Surfaces patterns
  // that suggest the leaderboard number is being manipulated rather than
  // earned. None of these are accusatory on their own — they're "look
  // here next" signals for a 1:1 conversation. Three signals, each a
  // boolean per rep:
  //   - lateMonthSpike: > 60% of this month's WON value closed in the
  //                     last 5 days (cramming activity at month-end).
  //   - lowAcvHighVolume: > 5 wins this month with avg ACV < 10% of the
  //                       org average — could be padding the count.
  //   - stageBouncebacks: ≥ 3 stage-history rows in 30d where the SAME
  //                       opp moved backwards then forwards in the
  //                       pipeline (artificial stage churn).
  const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;
  const lateThreshold = new Date(now.getTime() - FIVE_DAYS_MS);
  const orgAvgWon = wonOpps.length > 0 ? wonValueMTD / wonOpps.length : 0;

  // Per-rep MTD wins + late-window wins for the spike signal.
  const wonByRep = new Map<string, { count: number; value: number; lateValue: number }>();
  for (const o of wonOpps) {
    const k = o.owner.id;
    const cur = wonByRep.get(k) ?? { count: 0, value: 0, lateValue: 0 };
    const v = Number(o.estimatedValueEGP);
    cur.count += 1;
    cur.value += v;
    if (o.dateClosed && o.dateClosed > lateThreshold) cur.lateValue += v;
    wonByRep.set(k, cur);
  }

  // Stage-bounceback signal — read recent history for the reps on the
  // leaderboard only (keeps the query tight). A "bounceback" is any
  // pair of consecutive history rows for the same opp where the
  // displayOrder went backwards then forwards across them.
  const repIds = leaderboardWithCoverage.map((r) => r.userId);
  const recentChanges =
    repIds.length > 0
      ? await db.crmStageHistory.findMany({
          where: {
            changedAt: { gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) },
            changedById: { in: repIds },
          },
          select: {
            opportunityId: true,
            changedById: true,
            fromStage: true,
            toStage: true,
            changedAt: true,
          },
          orderBy: [{ opportunityId: "asc" }, { changedAt: "asc" }],
        })
      : [];

  // Re-use stageConfigRows we already pulled to map stage → displayOrder.
  const stageOrderMap = new Map<string, number>();
  for (const cfg of stageConfigRows) stageOrderMap.set(cfg.stage, cfg.displayOrder);
  const bouncebacksByRep = new Map<string, number>();
  // Walk each opp's chronological history and count "backward then
  // forward" zig-zags. Resets the prev pointer per opp.
  let prevOppId: string | null = null;
  let lastOrder: number | null = null;
  let wasBackward = false;
  for (const h of recentChanges) {
    if (h.opportunityId !== prevOppId) {
      prevOppId = h.opportunityId;
      lastOrder = stageOrderMap.get(h.toStage) ?? null;
      wasBackward = false;
      continue;
    }
    const curOrder = stageOrderMap.get(h.toStage) ?? null;
    if (lastOrder != null && curOrder != null) {
      if (curOrder < lastOrder) {
        wasBackward = true;
      } else if (curOrder > lastOrder && wasBackward) {
        bouncebacksByRep.set(
          h.changedById,
          (bouncebacksByRep.get(h.changedById) ?? 0) + 1
        );
        wasBackward = false;
      }
    }
    lastOrder = curOrder;
  }

  const leaderboardWithFlags = leaderboardWithCoverage.map((rep) => {
    const w = wonByRep.get(rep.userId);
    const lateMonthSpike =
      w && w.value > 0 ? w.lateValue / w.value > 0.6 : false;
    const lowAcvHighVolume =
      w && w.count > 5 && orgAvgWon > 0 ? w.value / w.count < orgAvgWon * 0.1 : false;
    const stageBouncebacks = (bouncebacksByRep.get(rep.userId) ?? 0) >= 3;
    const flags: string[] = [];
    if (lateMonthSpike) flags.push("late-month-spike");
    if (lowAcvHighVolume) flags.push("low-acv-high-volume");
    if (stageBouncebacks) flags.push("stage-bouncebacks");
    return { ...rep, flags };
  });

  // Tier-1 #13 — stalled-deals count for the dashboard widget. Reuses
  // the openOpps set we already loaded (so no extra Prisma query for
  // the opp list) and joins to CrmStageHistory + CrmStageConfig.maxDays.
  const stalledCount = await countStalled(
    openOpps.map((o) => ({ id: o.id, stage: o.stage, createdAt: o.createdAt }))
  );

  return {
    kpis: {
      openOpps: openOpps.length,
      weightedPipeline: Math.round(weightedPipeline),
      wonCountMTD: wonOpps.length,
      wonValueMTD: Math.round(wonValueMTD),
      teamTarget: Math.round(teamTarget),
      remainingQuota: Math.round(remainingTeamQuota),
      coverageRatio: teamCoverageRatio,
      stalledCount,
    },
    leaderboard: leaderboardWithFlags,
    topHotOpportunities: topHot,
    pipelineByEntity: Object.values(entityGroups),
    pipelineByStage,
    totalAlerts,
    hygieneScore: computeHygieneScore(alertableOpps),
  };
}
