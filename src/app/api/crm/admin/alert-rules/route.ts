import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { describeZodError } from "@/lib/zod-errors";
import type { Prisma } from "@/generated/prisma";
import { isAdminOnly } from "@/lib/crm/admin-gates";

/**
 * Tier-2 #39 — alert-rules engine CRUD. The nightly evaluator (separate
 * cron endpoint) scans rules against opps / cold leads and fires
 * channels. Rule shape:
 *
 *   predicateJson:  [ { field: "stage", op: "in", value: ["LOST"] },
 *                     { field: "amount", op: "gt", value: 50000 } ]
 *   channels:       ["in-app","email","slack"]
 *   suppressionDays: don't re-fire on same entity within N days.
 *
 * Gate: ADMIN.
 */

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  scope: z.enum(["opportunity", "coldLead"]),
  predicateJson: z.array(z.record(z.string(), z.unknown())).min(1),
  channels: z.array(z.string().min(1)).default(["in-app"]),
  suppressionDays: z.number().int().min(0).max(365).optional(),
  isActive: z.boolean().optional(),
});

const patchSchema = createSchema.partial().extend({ id: z.string().min(1) });

export async function GET() {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdminOnly(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const rules = await db.crmAlertRule.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
  return NextResponse.json({ rules });
}

export async function POST(req: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdminOnly(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    const { message, fieldErrors } = describeZodError(parsed.error);
    return NextResponse.json({ error: message, fieldErrors }, { status: 422 });
  }
  const r = await db.crmAlertRule.create({
    data: {
      name: parsed.data.name,
      scope: parsed.data.scope,
      predicateJson: parsed.data.predicateJson as unknown as Prisma.InputJsonValue,
      channels: parsed.data.channels,
      suppressionDays: parsed.data.suppressionDays ?? 1,
      isActive: parsed.data.isActive ?? true,
    },
  });
  return NextResponse.json({ ok: true, rule: r });
}

export async function PATCH(req: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdminOnly(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    const { message, fieldErrors } = describeZodError(parsed.error);
    return NextResponse.json({ error: message, fieldErrors }, { status: 422 });
  }
  const { id, predicateJson, ...rest } = parsed.data;
  const r = await db.crmAlertRule.update({
    where: { id },
    data: {
      ...rest,
      ...(predicateJson !== undefined
        ? { predicateJson: predicateJson as unknown as Prisma.InputJsonValue }
        : {}),
    },
  });
  return NextResponse.json({ ok: true, rule: r });
}
