import { db } from "@/lib/db";
import type { SessionUser } from "@/types";
import { scopeOpportunityByRole } from "@/lib/crm/rbac";
import { computeHygieneScore, getOverdueFollowups, getAgingProposals, getStaleLeads, getMissingNextActions } from "@/lib/crm/business/alerts";

export async function getMyDashboardData(session: SessionUser) {
  const scope = scopeOpportunityByRole(session);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // Fetch open opps, won opps, and user target in parallel
  const [openOpps, wonOpps, user] = await Promise.all([
    db.crmOpportunity.findMany({
      where: {
        ...scope,
        stage: { notIn: ["WON", "LOST"] },
      },
      include: {
        company: { select: { nameEn: true } },
        entity: { select: { code: true, nameEn: true, nameAr: true, color: true } },
      },
    }),
    db.crmOpportunity.findMany({
      where: {
        ...scope,
        stage: "WON",
        dateClosed: { gte: monthStart },
      },
    }),
    db.crmUserProfile.findUnique({
      where: { id: session.id },
      select: { monthlyTargetEGP: true },
    }),
  ]);

  // A null / 0 `monthlyTargetEGP` means "no target set for this rep". We
  // surface that as `targetSet: false` rather than silently using a 50k
  // fallback — the previous behaviour made attainment look like 500%+ for
  // anyone (e.g. admin) without a target, which the user perceived as a
  // bug in the percentages display. The UI now shows "—" instead.
  const rawTarget = user?.monthlyTargetEGP ? Number(user.monthlyTargetEGP) : 0;
  const targetSet = rawTarget > 0;
  const monthlyTarget = targetSet ? rawTarget : 0;
  const wonValueMTD = wonOpps.reduce((sum, o) => sum + Number(o.estimatedValueEGP), 0);
  const weightedPipeline = openOpps.reduce((sum, o) => sum + Number(o.weightedValueEGP), 0);

  // Today's activity
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [callsToday, answeredCallsToday, meetingsBookedToday] = await Promise.all([
    db.crmCall.count({
      where: { callerId: session.id, callAt: { gte: today, lt: tomorrow } },
    }),
    db.crmCall.count({
      where: {
        callerId: session.id,
        callAt: { gte: today, lt: tomorrow },
        outcome: { notIn: ["NO_ANSWER", "VOICEMAIL", "WRONG_NUMBER"] },
      },
    }),
    db.crmCall.count({
      where: {
        callerId: session.id,
        callAt: { gte: today, lt: tomorrow },
        outcome: "MEETING_BOOKED",
      },
    }),
  ]);

  const inNegotiation = openOpps.filter((o) => o.stage === "NEGOTIATION" || o.stage === "VERBAL_YES").length;

  // Pipeline by stage
  const stageGroups: Record<string, { count: number; totalValue: number; weightedValue: number }> = {};
  for (const opp of openOpps) {
    if (!stageGroups[opp.stage]) {
      stageGroups[opp.stage] = { count: 0, totalValue: 0, weightedValue: 0 };
    }
    stageGroups[opp.stage].count++;
    stageGroups[opp.stage].totalValue += Number(opp.estimatedValueEGP);
    stageGroups[opp.stage].weightedValue += Number(opp.weightedValueEGP);
  }

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

  // Top 5 hot opportunities
  const topHot = openOpps
    .filter((o) => o.priority === "HOT" || o.stage === "NEGOTIATION" || o.stage === "VERBAL_YES")
    .sort((a, b) => Number(b.weightedValueEGP) - Number(a.weightedValueEGP))
    .slice(0, 5);

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

  const alerts = {
    overdueFollowups: getOverdueFollowups(alertableOpps),
    agingProposals: getAgingProposals(alertableOpps),
    staleLeads: getStaleLeads(alertableOpps),
    missingNextActions: getMissingNextActions(alertableOpps),
  };

  const hygieneScore = computeHygieneScore(alertableOpps);

  return {
    kpis: {
      openOpps: openOpps.length,
      weightedPipeline: Math.round(weightedPipeline),
      wonCountMTD: wonOpps.length,
      wonValueMTD: Math.round(wonValueMTD),
      targetAttainment: targetSet ? Math.round((wonValueMTD / monthlyTarget) * 100) : null,
      monthlyTarget,
      targetSet,
    },
    todayActivity: {
      callsToday,
      answeredCalls: answeredCallsToday,
      meetingsBooked: meetingsBookedToday,
      overdueFollowups: alerts.overdueFollowups.length,
      inNegotiation,
    },
    pipelineByStage: Object.entries(stageGroups).map(([stage, data]) => ({
      stage,
      ...data,
    })),
    pipelineByEntity: Object.values(entityGroups),
    topHotOpportunities: topHot.map((o) => ({
      id: o.id,
      code: o.code,
      company: o.customerCompanyName ?? o.company?.nameEn ?? "—",
      entity: o.entity,
      stage: o.stage,
      priority: o.priority,
      weightedValueEGP: Number(o.weightedValueEGP),
      estimatedValueEGP: Number(o.estimatedValueEGP),
      nextActionDate: o.nextActionDate?.toISOString() || null,
    })),
    alerts,
    hygieneScore,
  };
}
