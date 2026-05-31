import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { describeZodError } from "@/lib/zod-errors";
import { isAdminOnly } from "@/lib/crm/admin-gates";

/**
 * Tier-1 #25 — per-stage activity quota CRUD. The changeStage action
 * already pulls stage-config; we'll layer the quota check into that
 * pipeline in a follow-up. For now this endpoint manages the config.
 *
 * Gate: ADMIN (settings-class).
 */

const upsertSchema = z.object({
  stage: z.string().trim().min(1).max(40),
  activityType: z.enum(["call", "meeting", "email"]),
  minCount: z.number().int().min(1).max(1000),
  windowDays: z.number().int().min(1).max(365).optional(),
  active: z.boolean().optional(),
});

export async function GET() {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdminOnly(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const quotas = await db.crmStageActivityQuota.findMany({
    orderBy: [{ stage: "asc" }, { activityType: "asc" }],
  });
  return NextResponse.json({ quotas });
}

export async function PUT(req: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdminOnly(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    const { message, fieldErrors } = describeZodError(parsed.error);
    return NextResponse.json({ error: message, fieldErrors }, { status: 422 });
  }
  const q = await db.crmStageActivityQuota.upsert({
    where: {
      stage_activityType: {
        stage: parsed.data.stage,
        activityType: parsed.data.activityType,
      },
    },
    create: {
      stage: parsed.data.stage,
      activityType: parsed.data.activityType,
      minCount: parsed.data.minCount,
      windowDays: parsed.data.windowDays ?? 30,
      active: parsed.data.active ?? true,
    },
    update: {
      minCount: parsed.data.minCount,
      ...(parsed.data.windowDays !== undefined ? { windowDays: parsed.data.windowDays } : {}),
      ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
    },
  });
  return NextResponse.json({ ok: true, quota: q });
}
