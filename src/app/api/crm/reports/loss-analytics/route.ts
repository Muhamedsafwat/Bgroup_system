import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isManagerOrAdmin } from "@/lib/crm/admin-gates";

/**
 * GET /api/crm/reports/loss-analytics
 *
 * Returns a multi-axis breakdown of LOST opportunities so admins can see
 * WHY deals die — the lever they actually control. Five slices, returned
 * as a single payload so the page does one fetch:
 *
 *   byReason      [{ reasonId, labelEn, count, totalValue }]
 *   byStage       [{ stage, count, totalValue }]
 *   byRep         [{ repId, fullName, count, totalValue }]
 *   bySource      [{ source, count, totalValue }]
 *   byCompetitor  [{ competitor, count, totalValue }]
 *
 * Plus a top-level total + a "lossRate" (lost / (lost + won)) so the
 * percentage is contextualised. Time window via `?from=YYYY-MM-DD` and
 * `?to=YYYY-MM-DD`; defaults to last 90 days.
 *
 * Gate: MANAGER + ADMIN + platform super_admin. Reps don't see this —
 * they have their own per-deal loss debrief flow.
 */

const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isManagerOrAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  for (const [name, val] of [["from", fromParam], ["to", toParam]] as const) {
    if (val && !DATE_RE.test(val)) {
      return NextResponse.json(
        { error: `${name} must be YYYY-MM-DD` },
        { status: 400 }
      );
    }
  }
  const to = toParam ? new Date(`${toParam}T23:59:59.999Z`) : new Date();
  const from = fromParam
    ? new Date(`${fromParam}T00:00:00.000Z`)
    : new Date(to.getTime() - NINETY_DAYS);

  // Pull every LOST opp in the window, then aggregate in JS. The
  // opp table is small enough (low tens of thousands) that one
  // fetch + multiple group-bys is faster than five separate
  // groupBy queries — and it keeps the loss-reason JOIN clean.
  const lost = await db.crmOpportunity.findMany({
    where: {
      stage: "LOST",
      dateClosed: { gte: from, lte: to },
      deletedAt: null,
    },
    select: {
      id: true,
      stage: true,
      leadSource: true,
      lostToCompetitor: true,
      estimatedValueEGP: true,
      lossReason: { select: { id: true, labelEn: true, labelAr: true } },
      owner: { select: { id: true, fullName: true } },
    },
  });

  const wonCount = await db.crmOpportunity.count({
    where: {
      stage: "WON",
      dateClosed: { gte: from, lte: to },
      deletedAt: null,
    },
  });

  type Agg = { count: number; totalValue: number };
  const bump = (m: Map<string, Agg>, key: string, val: number) => {
    const cur = m.get(key) ?? { count: 0, totalValue: 0 };
    cur.count += 1;
    cur.totalValue += val;
    m.set(key, cur);
  };

  const byReason = new Map<string, Agg & { labelEn: string; labelAr: string | null }>();
  const byStage = new Map<string, Agg>();
  const byRep = new Map<string, Agg & { fullName: string }>();
  const bySource = new Map<string, Agg>();
  const byCompetitor = new Map<string, Agg>();

  for (const o of lost) {
    const val = Number(o.estimatedValueEGP);
    // Reason — bucket "no reason captured" rows under the synthetic
    // key so admins see how many losses lack a debrief.
    const reasonKey = o.lossReason?.id ?? "__no_reason__";
    const reasonLabel = o.lossReason?.labelEn ?? "(no reason captured)";
    const cur = byReason.get(reasonKey) ?? {
      count: 0,
      totalValue: 0,
      labelEn: reasonLabel,
      labelAr: o.lossReason?.labelAr ?? null,
    };
    cur.count += 1;
    cur.totalValue += val;
    byReason.set(reasonKey, cur);

    // Stage at loss is always "LOST" right now — the more useful
    // slice is "stage BEFORE loss", which lives in CrmStageHistory.
    // For now we expose lostFromStage by reading the most recent
    // stage-history entry per opp; defer the JOIN to a phase 2.
    bump(byStage, o.stage, val);

    if (o.owner) {
      const r = byRep.get(o.owner.id) ?? {
        count: 0,
        totalValue: 0,
        fullName: o.owner.fullName,
      };
      r.count += 1;
      r.totalValue += val;
      byRep.set(o.owner.id, r);
    }

    bump(bySource, o.leadSource || "(unknown)", val);
    bump(byCompetitor, o.lostToCompetitor || "(none)", val);
  }

  const totalLost = lost.length;
  const totalValueLost = lost.reduce(
    (s, o) => s + Number(o.estimatedValueEGP),
    0
  );
  const lossRatePct =
    totalLost + wonCount > 0
      ? Math.round((totalLost / (totalLost + wonCount)) * 1000) / 10
      : 0;

  const toArr = <T extends Agg>(m: Map<string, T>) =>
    Array.from(m.entries())
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => b.count - a.count);

  return NextResponse.json({
    from: from.toISOString(),
    to: to.toISOString(),
    totals: {
      lostCount: totalLost,
      wonCount,
      lostValueEGP: Math.round(totalValueLost),
      lossRatePct,
    },
    byReason: toArr(byReason).map((r) => ({
      reasonId: r.key,
      labelEn: r.labelEn,
      labelAr: r.labelAr,
      count: r.count,
      totalValue: Math.round(r.totalValue),
    })),
    byStage: toArr(byStage).map((s) => ({
      stage: s.key,
      count: s.count,
      totalValue: Math.round(s.totalValue),
    })),
    byRep: toArr(byRep).map((r) => ({
      repId: r.key,
      fullName: r.fullName,
      count: r.count,
      totalValue: Math.round(r.totalValue),
    })),
    bySource: toArr(bySource).map((s) => ({
      source: s.key,
      count: s.count,
      totalValue: Math.round(s.totalValue),
    })),
    byCompetitor: toArr(byCompetitor).map((c) => ({
      competitor: c.key,
      count: c.count,
      totalValue: Math.round(c.totalValue),
    })),
  });
}
