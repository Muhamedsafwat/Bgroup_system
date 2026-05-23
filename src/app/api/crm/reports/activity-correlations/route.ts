import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isManagerOrAdmin } from "@/lib/crm/admin-gates";

/**
 * Tier-1 #22 — activity-to-outcome correlations.
 *
 * Per rep: sum their daily-report numbers over the last 90 days
 * (calls / meetings booked / meetings held / new leads) and pair
 * against their WON-deal value + count over the same window. Returns
 * a flat per-rep array the dashboard charts as a scatter plot OR
 * computes a simple linear correlation client-side.
 *
 * The endpoint itself doesn't fit a regression — that's a UI concern
 * (recharts + a tooltip is enough at this scale). It just hands over
 * the data points.
 *
 * Gate: MANAGER + ADMIN.
 */

export async function GET() {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isManagerOrAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  const [activityRows, wonRows, reps] = await Promise.all([
    db.crmDailyReport.groupBy({
      by: ["repId"],
      where: { reportDate: { gte: since } },
      _sum: {
        callsCount: true,
        meetingsBooked: true,
        meetingsHeld: true,
        newLeads: true,
      },
    }),
    db.crmOpportunity.findMany({
      where: {
        stage: "WON",
        dateClosed: { gte: since },
        deletedAt: null,
      },
      select: { ownerId: true, estimatedValueEGP: true },
    }),
    db.crmUserProfile.findMany({
      where: { active: true },
      select: { id: true, fullName: true },
    }),
  ]);

  const wonByRep = new Map<string, { wonCount: number; wonValue: number }>();
  for (const w of wonRows) {
    const cur = wonByRep.get(w.ownerId) ?? { wonCount: 0, wonValue: 0 };
    cur.wonCount += 1;
    cur.wonValue += Number(w.estimatedValueEGP);
    wonByRep.set(w.ownerId, cur);
  }

  const repsById = new Map(reps.map((r) => [r.id, r.fullName]));

  const points = activityRows.map((a) => {
    const won = wonByRep.get(a.repId) ?? { wonCount: 0, wonValue: 0 };
    return {
      repId: a.repId,
      fullName: repsById.get(a.repId) ?? "(unknown)",
      callsCount: a._sum.callsCount ?? 0,
      meetingsBooked: a._sum.meetingsBooked ?? 0,
      meetingsHeld: a._sum.meetingsHeld ?? 0,
      newLeads: a._sum.newLeads ?? 0,
      wonCount: won.wonCount,
      wonValue: Math.round(won.wonValue),
    };
  });

  return NextResponse.json({
    windowDays: 90,
    points,
  });
}
