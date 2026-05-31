import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { describeZodError } from "@/lib/zod-errors";
import { isAdminOnly } from "@/lib/crm/admin-gates";

/**
 * Tier-2 #34 — configurable lead status state machine CRUD.
 * Settings-class: ADMIN only.
 */

const status = z.enum([
  "NEW",
  "ASSIGNED",
  "NO_ANSWER",
  "WAITING_LIST",
  "NOT_INTERESTED",
  "CONVERTED",
  "ARCHIVED",
]);

const upsertSchema = z.object({
  fromStatus: status,
  toStatus: status,
  requiresReason: z.boolean().optional(),
  allowedRoles: z.array(z.string().min(1).max(40)).optional(),
  active: z.boolean().optional(),
});

export async function GET() {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdminOnly(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const rows = await db.crmLeadStatusTransition.findMany({
    orderBy: [{ fromStatus: "asc" }, { toStatus: "asc" }],
  });
  return NextResponse.json({ transitions: rows });
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
  const row = await db.crmLeadStatusTransition.upsert({
    where: {
      fromStatus_toStatus: {
        fromStatus: parsed.data.fromStatus,
        toStatus: parsed.data.toStatus,
      },
    },
    create: {
      fromStatus: parsed.data.fromStatus,
      toStatus: parsed.data.toStatus,
      requiresReason: parsed.data.requiresReason ?? false,
      allowedRoles: parsed.data.allowedRoles ?? [],
      active: parsed.data.active ?? true,
    },
    update: {
      ...(parsed.data.requiresReason !== undefined ? { requiresReason: parsed.data.requiresReason } : {}),
      ...(parsed.data.allowedRoles !== undefined ? { allowedRoles: parsed.data.allowedRoles } : {}),
      ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
    },
  });
  return NextResponse.json({ ok: true, transition: row });
}
