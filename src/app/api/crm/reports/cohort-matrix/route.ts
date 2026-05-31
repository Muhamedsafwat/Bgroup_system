import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isManagerOrAdmin } from "@/lib/crm/admin-gates";

/**
 * Tier-2 #41 — cohort conversion matrix.
 *
 * Rows = month opp was created (YYYY-MM)
 * Cols = months-since-creation (0 .. 11)
 * Cells = cumulative win % of that cohort by month N
 *
 * Default window: last 12 cohorts (created within the last year).
 *
 * Gate: MANAGER + ADMIN.
 */

function ym(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthsBetween(a: Date, b: Date) {
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
}

export async function GET() {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isManagerOrAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const cutoff = new Date();
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 12);

  const opps = await db.crmOpportunity.findMany({
    where: {
      createdAt: { gte: cutoff },
      deletedAt: null,
    },
    select: { createdAt: true, dateClosed: true, stage: true },
  });

  // cohort → { created, wonByMonth: Map<offset, count> }
  const cohorts = new Map<string, { created: number; wonByMonth: Map<number, number> }>();
  for (const o of opps) {
    const cohort = ym(o.createdAt);
    const cur = cohorts.get(cohort) ?? { created: 0, wonByMonth: new Map<number, number>() };
    cur.created += 1;
    if (o.stage === "WON" && o.dateClosed) {
      const offset = monthsBetween(o.createdAt, o.dateClosed);
      cur.wonByMonth.set(offset, (cur.wonByMonth.get(offset) ?? 0) + 1);
    }
    cohorts.set(cohort, cur);
  }

  // Sort cohorts chronologically and produce cumulative-win % per offset 0..11.
  const rows = Array.from(cohorts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cohort, agg]) => {
      const offsets: { offset: number; cumulativeWinPct: number; cumulativeWins: number }[] = [];
      let cum = 0;
      for (let off = 0; off <= 11; off++) {
        cum += agg.wonByMonth.get(off) ?? 0;
        offsets.push({
          offset: off,
          cumulativeWins: cum,
          cumulativeWinPct:
            agg.created > 0 ? Math.round((cum / agg.created) * 1000) / 10 : 0,
        });
      }
      return { cohort, created: agg.created, offsets };
    });

  return NextResponse.json({ rows });
}
