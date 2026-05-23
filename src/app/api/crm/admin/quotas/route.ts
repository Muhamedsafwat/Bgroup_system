import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { describeZodError } from "@/lib/zod-errors";
import { isManagerOrAdmin } from "@/lib/crm/admin-gates";

/**
 * Tier-1 #18 — per-rep, per-period quota CRUD.
 *
 *   GET ?repId=&period=     → list quotas (optionally filtered by rep
 *                             and/or period). Defaults to all.
 *   POST                    → upsert (unique on rep+period+start+split,
 *                             so re-sending replaces in place).
 *   DELETE ?id=             → drop one quota row.
 *
 * Quota table is the source of truth going forward; the legacy
 * `CrmUserProfile.monthlyTargetEGP` stays as a fallback for reps with
 * no rows (pace-to-quota logic reads `current-period CrmQuota` first,
 * falls back to monthlyTargetEGP × 1, 3, or 12 depending on period).
 *
 * Gate: MANAGER + ADMIN. Managers run their floor's quota now that
 * MANAGER is "ADMIN minus settings".
 */

const upsertSchema = z.object({
  repId: z.string().min(1),
  period: z.enum(["monthly", "quarterly", "annual"]),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amountEGP: z.number().nonnegative().max(1_000_000_000),
  splitKind: z.string().trim().min(1).max(40).optional(),
  notes: z.string().trim().max(500).optional(),
});

export async function GET(req: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isManagerOrAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const url = new URL(req.url);
  const repId = url.searchParams.get("repId");
  const period = url.searchParams.get("period");
  const quotas = await db.crmQuota.findMany({
    where: {
      ...(repId ? { repId } : {}),
      ...(period ? { period } : {}),
    },
    include: { rep: { select: { id: true, fullName: true } } },
    orderBy: [{ periodStart: "desc" }, { repId: "asc" }],
  });
  return NextResponse.json({ quotas });
}

export async function POST(req: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isManagerOrAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    const { message, fieldErrors } = describeZodError(parsed.error);
    return NextResponse.json({ error: message, fieldErrors }, { status: 422 });
  }
  const splitKind = parsed.data.splitKind ?? "all";
  const periodStart = new Date(`${parsed.data.periodStart}T00:00:00.000Z`);
  const quota = await db.crmQuota.upsert({
    where: {
      repId_period_periodStart_splitKind: {
        repId: parsed.data.repId,
        period: parsed.data.period,
        periodStart,
        splitKind,
      },
    },
    create: {
      repId: parsed.data.repId,
      period: parsed.data.period,
      periodStart,
      amountEGP: parsed.data.amountEGP,
      splitKind,
      notes: parsed.data.notes ?? null,
    },
    update: {
      amountEGP: parsed.data.amountEGP,
      notes: parsed.data.notes ?? null,
    },
  });
  return NextResponse.json({ ok: true, quota });
}

export async function DELETE(req: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isManagerOrAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  await db.crmQuota.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
