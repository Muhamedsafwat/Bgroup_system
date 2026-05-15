import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { CrmOpportunityStage, CrmPriority, Prisma } from "@/generated/prisma";
import { SPEC_STAGES } from "@/lib/crm/stage-labels";

/**
 * Aggregator for the CRM sales board. Returns the data shape needed by the
 * dashboard described in CRM Req. Refrence.xlsx: KPI tiles, per-rep
 * performance, service distribution, stage distribution, meeting stats.
 *
 * Managers + admins see the full org; reps see only their own numbers.
 */
export async function GET(req: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const isManager =
    session.user.crmRole === "MANAGER" ||
    session.user.crmRole === "ADMIN" ||
    !!session.user.hrRoles?.includes("super_admin");

  const url = new URL(req.url);
  const companyIdFilter = url.searchParams.get("companyId");
  const repIdFilter = url.searchParams.get("repId");
  const productIdFilter = url.searchParams.get("productId");

  const oppScope: Prisma.CrmOpportunityWhereInput = {};
  const meetingScope: Prisma.CrmMeetingWhereInput = {};
  if (!isManager && session.user.crmProfileId) {
    oppScope.ownerId = session.user.crmProfileId;
    meetingScope.scheduledById = session.user.crmProfileId;
  } else if (isManager && repIdFilter) {
    oppScope.ownerId = repIdFilter;
    meetingScope.scheduledById = repIdFilter;
  }
  if (companyIdFilter) oppScope.companyId = companyIdFilter;
  if (productIdFilter) {
    oppScope.products = { some: { productId: productIdFilter } };
  }

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);

  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay()); // Sunday
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(endOfWeek.getDate() + 7);

  // KPI counts by stage
  const stageCountsRaw = await db.crmOpportunity.groupBy({
    by: ["stage"],
    where: oppScope,
    _count: { _all: true },
  });
  const stageCounts: Record<string, number> = {};
  for (const s of SPEC_STAGES) stageCounts[s] = 0;
  for (const r of stageCountsRaw) {
    stageCounts[r.stage as string] = r._count._all;
  }
  const total = stageCountsRaw.reduce((acc, r) => acc + r._count._all, 0);
  const won = stageCounts["WON"] ?? 0;
  const lost = stageCounts["LOST"] ?? 0;
  const closed = won + lost;
  const conversionRate = closed === 0 ? 0 : Math.round((won / closed) * 100);
  const active = total - won - lost - (stageCounts["POSTPONED"] ?? 0);

  // Priority breakdown
  const priorityCountsRaw = await db.crmOpportunity.groupBy({
    by: ["priority"],
    where: { ...oppScope, stage: { notIn: ["WON", "LOST"] } },
    _count: { _all: true },
  });
  const priorityCounts: Record<CrmPriority, number> = { HOT: 0, WARM: 0, COLD: 0 };
  for (const r of priorityCountsRaw) {
    priorityCounts[r.priority as CrmPriority] = r._count._all;
  }

  // New opps this month
  const newOppsThisMonth = await db.crmOpportunity.count({
    where: { ...oppScope, createdAt: { gte: startOfMonth } },
  });

  // Per-rep performance (managers only).
  let repTable: Array<{
    repId: string;
    name: string;
    total: number;
    perStage: Record<string, number>;
    active: number;
    conversion: number;
  }> = [];
  if (isManager) {
    const profiles = await db.crmUserProfile.findMany({
      where: { active: true, role: { in: ["REP", "ACCOUNT_MGR", "MANAGER"] } },
      select: { id: true, fullName: true },
    });
    const repOpps = await db.crmOpportunity.groupBy({
      by: ["ownerId", "stage"],
      _count: { _all: true },
    });
    repTable = profiles.map((p) => {
      const rows = repOpps.filter((r) => r.ownerId === p.id);
      const perStage: Record<string, number> = {};
      for (const s of SPEC_STAGES) perStage[s] = 0;
      let tot = 0;
      let repWon = 0;
      let repClosed = 0;
      for (const r of rows) {
        perStage[r.stage as string] = r._count._all;
        tot += r._count._all;
        if (r.stage === "WON") {
          repWon = r._count._all;
          repClosed += r._count._all;
        }
        if (r.stage === "LOST") repClosed += r._count._all;
      }
      const repActive = tot - repWon - (perStage["LOST"] ?? 0) - (perStage["POSTPONED"] ?? 0);
      const conv = repClosed === 0 ? 0 : Math.round((repWon / repClosed) * 100);
      return {
        repId: p.id,
        name: p.fullName || "(unnamed)",
        total: tot,
        perStage,
        active: repActive,
        conversion: conv,
      };
    });
    repTable.sort((a, b) => b.total - a.total);
  }

  // Service / product distribution (via CrmOpportunityProduct → CrmProduct).
  const productAgg = await db.crmOpportunityProduct.groupBy({
    by: ["productId"],
    where: { opportunity: oppScope },
    _count: { _all: true },
  });
  const productIds = productAgg.map((r) => r.productId);
  const productMeta =
    productIds.length === 0
      ? []
      : await db.crmProduct.findMany({
          where: { id: { in: productIds } },
          select: { id: true, nameEn: true, code: true },
        });
  const totalProductCount = productAgg.reduce((acc, r) => acc + r._count._all, 0);
  const serviceDistribution = productAgg
    .map((r) => {
      const meta = productMeta.find((p) => p.id === r.productId);
      return {
        name: meta?.nameEn ?? r.productId,
        code: meta?.code ?? "",
        count: r._count._all,
        pct: totalProductCount === 0 ? 0 : Math.round((r._count._all / totalProductCount) * 100),
      };
    })
    .sort((a, b) => b.count - a.count);

  // Meeting stats
  const [totalMeetings, todayMeetings, weekMeetings, confirmedMeetings, doneMeetings, cancelledMeetings] =
    await Promise.all([
      db.crmMeeting.count({ where: meetingScope }),
      db.crmMeeting.count({
        where: { ...meetingScope, startAt: { gte: startOfToday, lt: endOfToday } },
      }),
      db.crmMeeting.count({
        where: { ...meetingScope, startAt: { gte: startOfWeek, lt: endOfWeek } },
      }),
      db.crmMeeting.count({ where: { ...meetingScope, status: "CONFIRMED" } }),
      db.crmMeeting.count({ where: { ...meetingScope, status: "DONE" } }),
      db.crmMeeting.count({ where: { ...meetingScope, status: "CANCELLED" } }),
    ]);

  return NextResponse.json({
    scope: isManager ? "team" : "mine",
    kpi: {
      total,
      stageCounts,
      conversionRate,
      active,
      newOppsThisMonth,
      highPriority: priorityCounts.HOT ?? 0,
    },
    repTable,
    serviceDistribution,
    meetings: {
      total: totalMeetings,
      today: todayMeetings,
      thisWeek: weekMeetings,
      confirmed: confirmedMeetings,
      done: doneMeetings,
      cancelled: cancelledMeetings,
    },
    stages: SPEC_STAGES as CrmOpportunityStage[],
  });
}
