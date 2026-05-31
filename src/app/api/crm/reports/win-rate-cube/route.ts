import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isManagerOrAdmin } from "@/lib/crm/admin-gates";

/**
 * Tier-1 #21 — win-rate cube. Same number sliced by:
 *   stage at close, lead source, owner, deal-size band, currency.
 *
 * `winRate = won / (won + lost)` per slice, plus the raw counts so
 * a 1-of-1 slice doesn't look like 100% in the UI without context.
 *
 * `from` / `to` filter by `dateClosed`. Defaults to last 365 days
 * (annual win-rate is the headline number most managers want).
 *
 * Gate: MANAGER + ADMIN + super_admin.
 */

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function band(value: number): string {
  if (value < 10_000) return "<10k";
  if (value < 50_000) return "10k-50k";
  if (value < 250_000) return "50k-250k";
  if (value < 1_000_000) return "250k-1M";
  return ">1M";
}

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
      return NextResponse.json({ error: `${name} must be YYYY-MM-DD` }, { status: 400 });
    }
  }
  const to = toParam ? new Date(`${toParam}T23:59:59.999Z`) : new Date();
  const from = fromParam ? new Date(`${fromParam}T00:00:00.000Z`) : new Date(to.getTime() - YEAR_MS);

  const closed = await db.crmOpportunity.findMany({
    where: {
      stage: { in: ["WON", "LOST"] },
      dateClosed: { gte: from, lte: to },
      deletedAt: null,
    },
    select: {
      stage: true,
      leadSource: true,
      estimatedValueEGP: true,
      currency: true,
      owner: { select: { id: true, fullName: true } },
    },
  });

  type Slice = { won: number; lost: number; wonValue: number; lostValue: number };
  const fresh = (): Slice => ({ won: 0, lost: 0, wonValue: 0, lostValue: 0 });

  const byOwner = new Map<string, Slice & { name: string }>();
  const bySource = new Map<string, Slice>();
  const byBand = new Map<string, Slice>();
  const byCurrency = new Map<string, Slice>();

  for (const o of closed) {
    const v = Number(o.estimatedValueEGP);
    const isWon = o.stage === "WON";
    const ownerKey = o.owner?.id ?? "__none__";
    const ownerName = o.owner?.fullName ?? "(no owner)";
    const cur1 = byOwner.get(ownerKey) ?? { ...fresh(), name: ownerName };
    if (isWon) {
      cur1.won += 1;
      cur1.wonValue += v;
    } else {
      cur1.lost += 1;
      cur1.lostValue += v;
    }
    byOwner.set(ownerKey, cur1);

    const sourceKey = o.leadSource || "(unknown)";
    const s = bySource.get(sourceKey) ?? fresh();
    if (isWon) {
      s.won += 1;
      s.wonValue += v;
    } else {
      s.lost += 1;
      s.lostValue += v;
    }
    bySource.set(sourceKey, s);

    const b = byBand.get(band(v)) ?? fresh();
    if (isWon) {
      b.won += 1;
      b.wonValue += v;
    } else {
      b.lost += 1;
      b.lostValue += v;
    }
    byBand.set(band(v), b);

    const c = byCurrency.get(o.currency) ?? fresh();
    if (isWon) {
      c.won += 1;
      c.wonValue += v;
    } else {
      c.lost += 1;
      c.lostValue += v;
    }
    byCurrency.set(o.currency, c);
  }

  const withRate = <T extends Slice>(rows: { key: string; data: T }[]) =>
    rows.map((r) => ({
      key: r.key,
      ...r.data,
      total: r.data.won + r.data.lost,
      winRatePct:
        r.data.won + r.data.lost > 0
          ? Math.round((r.data.won / (r.data.won + r.data.lost)) * 1000) / 10
          : 0,
      wonValue: Math.round(r.data.wonValue),
      lostValue: Math.round(r.data.lostValue),
    }));

  return NextResponse.json({
    from: from.toISOString(),
    to: to.toISOString(),
    totals: {
      won: closed.filter((o) => o.stage === "WON").length,
      lost: closed.filter((o) => o.stage === "LOST").length,
    },
    byOwner: withRate(
      Array.from(byOwner.entries()).map(([k, v]) => ({
        key: v.name,
        data: { won: v.won, lost: v.lost, wonValue: v.wonValue, lostValue: v.lostValue } as Slice,
      }))
    ),
    bySource: withRate(
      Array.from(bySource.entries()).map(([k, v]) => ({ key: k, data: v }))
    ),
    byBand: withRate(
      Array.from(byBand.entries()).map(([k, v]) => ({ key: k, data: v }))
    ),
    byCurrency: withRate(
      Array.from(byCurrency.entries()).map(([k, v]) => ({ key: k, data: v }))
    ),
  });
}
