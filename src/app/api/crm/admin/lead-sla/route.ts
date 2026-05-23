import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { describeZodError } from "@/lib/zod-errors";
import { isAdminOnly } from "@/lib/crm/admin-gates";

/**
 * Tier-1 #14 — SLA policies for cold-lead statuses.
 *
 *   GET  → list current policies (one per status).
 *   PUT  → upsert (admin sets/replaces the policy for a status).
 *
 * The breach evaluator at /api/crm/admin/lead-sla/evaluate is the
 * runtime side that scans CrmColdLead rows against active policies.
 *
 * Settings-table-class endpoint: ADMIN only (matches /crm/admin/*).
 */

const upsertSchema = z.object({
  status: z.enum([
    "NEW",
    "ASSIGNED",
    "NO_ANSWER",
    "WAITING_LIST",
    "NOT_INTERESTED",
    "CONVERTED",
    "ARCHIVED",
  ]),
  targetMinutes: z.number().int().min(1).max(60 * 24 * 90),
  reminderPct: z.number().int().min(0).max(100).optional(),
  breachAction: z
    .enum(["notify-manager", "reassign-unassigned", "no-op"])
    .optional(),
  active: z.boolean().optional(),
});

export async function GET() {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdminOnly(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const policies = await db.crmLeadSlaPolicy.findMany({
    orderBy: { status: "asc" },
  });
  return NextResponse.json({ policies });
}

export async function PUT(req: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdminOnly(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    const { message, fieldErrors } = describeZodError(parsed.error);
    return NextResponse.json({ error: message, fieldErrors }, { status: 422 });
  }
  const policy = await db.crmLeadSlaPolicy.upsert({
    where: { status: parsed.data.status },
    create: {
      status: parsed.data.status,
      targetMinutes: parsed.data.targetMinutes,
      reminderPct: parsed.data.reminderPct ?? 50,
      breachAction: parsed.data.breachAction ?? "notify-manager",
      active: parsed.data.active ?? true,
    },
    update: {
      targetMinutes: parsed.data.targetMinutes,
      ...(parsed.data.reminderPct !== undefined ? { reminderPct: parsed.data.reminderPct } : {}),
      ...(parsed.data.breachAction !== undefined ? { breachAction: parsed.data.breachAction } : {}),
      ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
    },
  });
  return NextResponse.json({ ok: true, policy });
}
