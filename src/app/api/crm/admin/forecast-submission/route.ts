import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { describeZodError } from "@/lib/zod-errors";
import { isManagerOrAdmin } from "@/lib/crm/admin-gates";

/**
 * Tier-1 #28 — manager forecast-submission overlay.
 *
 *   GET ?periodKey=YYYY-MM     → list submissions for the period
 *                                (every manager's commit + bestCase).
 *   PUT                        → upsert one manager's submission for
 *                                the period (manager submits their
 *                                own; ADMIN can submit on behalf).
 *
 * `periodKey` is YYYY-MM for monthly, YYYY-Q1 etc. for quarterly. The
 * UI decides cadence; the storage is opaque.
 *
 * Gate: MANAGER + ADMIN.
 */

const putSchema = z.object({
  managerId: z.string().optional(),
  periodKey: z.string().regex(/^\d{4}-(0[1-9]|1[0-2]|Q[1-4])$/),
  commitEGP: z.number().nonnegative().max(1_000_000_000),
  bestCaseEGP: z.number().nonnegative().max(1_000_000_000),
  notes: z.string().trim().max(1000).optional(),
});

export async function GET(req: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isManagerOrAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const periodKey = url.searchParams.get("periodKey");
  const submissions = await db.crmForecastSubmission.findMany({
    where: periodKey ? { periodKey } : {},
    include: { manager: { select: { id: true, fullName: true } } },
    orderBy: [{ periodKey: "desc" }, { managerId: "asc" }],
  });
  return NextResponse.json({ submissions });
}

export async function PUT(req: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isManagerOrAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const callerId = session.user.crmProfileId!;
  const body = await req.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    const { message, fieldErrors } = describeZodError(parsed.error);
    return NextResponse.json({ error: message, fieldErrors }, { status: 422 });
  }
  // Manager submits for themselves unless they're ADMIN with a target.
  const isAdmin =
    session.user.crmRole === "ADMIN" || !!session.user.hrRoles?.includes("super_admin");
  const managerId =
    parsed.data.managerId && isAdmin ? parsed.data.managerId : callerId;
  const submission = await db.crmForecastSubmission.upsert({
    where: { managerId_periodKey: { managerId, periodKey: parsed.data.periodKey } },
    create: {
      managerId,
      periodKey: parsed.data.periodKey,
      commitEGP: parsed.data.commitEGP,
      bestCaseEGP: parsed.data.bestCaseEGP,
      notes: parsed.data.notes ?? null,
    },
    update: {
      commitEGP: parsed.data.commitEGP,
      bestCaseEGP: parsed.data.bestCaseEGP,
      notes: parsed.data.notes ?? null,
      submittedAt: new Date(),
    },
  });
  return NextResponse.json({ ok: true, submission });
}
