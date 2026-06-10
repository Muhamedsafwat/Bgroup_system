import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { describeZodError } from "@/lib/zod-errors";
import { Prisma } from "@/generated/prisma";
import { isAdminOnly } from "@/lib/crm/admin-gates";

/**
 * Tier-2 #36 — workflow / automation builder.
 *
 *   GET     → list workflows
 *   POST    → create a new workflow
 *   PATCH   → update (id required in body)
 *   DELETE  → soft-delete by id (sets isActive=false)
 *
 * The actual trigger/condition/action evaluator lives in
 * `src/lib/crm/workflows/engine.ts` (called by stage-change /
 * disposition handlers + a cron tick for time-based triggers).
 * This endpoint is purely the CRUD surface.
 *
 * Gate: ADMIN (settings-class).
 */

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  triggerKind: z.string().trim().min(1).max(60),
  triggerConfig: z.record(z.string(), z.unknown()).optional(),
  conditionJson: z.record(z.string(), z.unknown()).optional(),
  actionJson: z.record(z.string(), z.unknown()),
  suppressionWindowMinutes: z.number().int().min(0).max(60 * 24 * 30).optional(),
  isActive: z.boolean().optional(),
});

const patchSchema = createSchema.partial().extend({ id: z.string().min(1) });

export async function GET() {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdminOnly(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const workflows = await db.crmWorkflow.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
  return NextResponse.json({ workflows });
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
  const wf = await db.crmWorkflow.create({
    data: {
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      triggerKind: parsed.data.triggerKind,
      ...(parsed.data.triggerConfig
        ? { triggerConfig: parsed.data.triggerConfig as Prisma.InputJsonValue }
        : {}),
      ...(parsed.data.conditionJson
        ? { conditionJson: parsed.data.conditionJson as Prisma.InputJsonValue }
        : {}),
      actionJson: parsed.data.actionJson as Prisma.InputJsonValue,
      suppressionWindowMinutes: parsed.data.suppressionWindowMinutes ?? 1440,
      isActive: parsed.data.isActive ?? true,
    },
  });
  return NextResponse.json({ ok: true, workflow: wf });
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
  const { id, triggerConfig, conditionJson, actionJson, ...rest } = parsed.data;

  // audit v12 MEDIUM (MED-40): if triggerKind is being changed without a new
  // triggerConfig, explicitly null out the stale config so the old toStage/
  // fromStage (or equivalent) fields don't silently persist and fail to match.
  const triggerConfigUpdate =
    triggerConfig !== undefined
      ? { triggerConfig: triggerConfig as Prisma.InputJsonValue }
      : rest.triggerKind !== undefined
      ? { triggerConfig: Prisma.JsonNull } // clear stale config on kind change
      : {};

  const wf = await db.crmWorkflow.update({
    where: { id },
    data: {
      ...rest,
      ...triggerConfigUpdate,
      ...(conditionJson !== undefined
        ? { conditionJson: conditionJson as Prisma.InputJsonValue }
        : {}),
      ...(actionJson !== undefined
        ? { actionJson: actionJson as Prisma.InputJsonValue }
        : {}),
    },
  });
  return NextResponse.json({ ok: true, workflow: wf });
}

export async function DELETE(req: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdminOnly(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  await db.crmWorkflow.update({ where: { id }, data: { isActive: false } });
  return NextResponse.json({ ok: true });
}
