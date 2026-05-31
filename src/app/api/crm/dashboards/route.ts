import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { describeZodError } from "@/lib/zod-errors";
import type { Prisma } from "@/generated/prisma";

/**
 * Tier-2 #38 — saved dashboard layouts CRUD.
 *
 *   GET  → list user's dashboards + any shared.
 *   POST → create a new dashboard.
 *   PATCH → rename / re-share / replace layout (owner only).
 *   DELETE ?id= → owner-only.
 *
 * `layoutJson` is an opaque array the client-side dashboard renderer
 * interprets: `[{ kind: "kpi.pipeline", x, y, w, h }, ...]`. Schema
 * doesn't validate the inside — the renderer ignores unknown kinds.
 */
function ownerOrNull(session: Session | null) {
  return session?.user?.crmProfileId ?? null;
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  layoutJson: z.array(z.record(z.string(), z.unknown())),
  isShared: z.boolean().optional(),
});

const patchSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80).optional(),
  layoutJson: z.array(z.record(z.string(), z.unknown())).optional(),
  isShared: z.boolean().optional(),
});

export async function GET() {
  const session = (await auth()) as Session | null;
  const ownerId = ownerOrNull(session);
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const dashboards = await db.crmDashboard.findMany({
    where: { OR: [{ ownerId }, { isShared: true }] },
    orderBy: [{ ownerId: "asc" }, { name: "asc" }],
    include: { owner: { select: { id: true, fullName: true } } },
  });
  return NextResponse.json({
    dashboards: dashboards.map((d) => ({ ...d, mine: d.ownerId === ownerId })),
  });
}

export async function POST(req: Request) {
  const session = (await auth()) as Session | null;
  const ownerId = ownerOrNull(session);
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    const { message, fieldErrors } = describeZodError(parsed.error);
    return NextResponse.json({ error: message, fieldErrors }, { status: 422 });
  }
  const d = await db.crmDashboard.create({
    data: {
      ownerId,
      name: parsed.data.name,
      layoutJson: parsed.data.layoutJson as unknown as Prisma.InputJsonValue,
      isShared: parsed.data.isShared ?? false,
    },
  });
  return NextResponse.json({ ok: true, dashboard: d });
}

export async function PATCH(req: Request) {
  const session = (await auth()) as Session | null;
  const ownerId = ownerOrNull(session);
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    const { message, fieldErrors } = describeZodError(parsed.error);
    return NextResponse.json({ error: message, fieldErrors }, { status: 422 });
  }
  const existing = await db.crmDashboard.findUnique({
    where: { id: parsed.data.id },
    select: { ownerId: true },
  });
  if (!existing || existing.ownerId !== ownerId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { id, layoutJson, ...rest } = parsed.data;
  const d = await db.crmDashboard.update({
    where: { id },
    data: {
      ...rest,
      ...(layoutJson !== undefined
        ? { layoutJson: layoutJson as unknown as Prisma.InputJsonValue }
        : {}),
    },
  });
  return NextResponse.json({ ok: true, dashboard: d });
}

export async function DELETE(req: Request) {
  const session = (await auth()) as Session | null;
  const ownerId = ownerOrNull(session);
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const existing = await db.crmDashboard.findUnique({ where: { id }, select: { ownerId: true } });
  if (!existing || existing.ownerId !== ownerId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await db.crmDashboard.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
