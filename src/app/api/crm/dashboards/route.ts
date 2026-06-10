import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { describeZodError } from "@/lib/zod-errors";
import type { Prisma } from "@/generated/prisma";
import { Prisma as PrismaRuntime } from "@/generated/prisma"; // audit v12 MEDIUM (MED-19) — value import needed for instanceof check

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

// audit v12 LOW (LOW-6) recheck — constrain widget entries so arbitrary keys/values cannot be stored
const widgetSchema = z.object({
  kind: z.string().min(1).max(64),
  x: z.number().int().min(0).max(100),
  y: z.number().int().min(0).max(100),
  w: z.number().int().min(1).max(24),
  h: z.number().int().min(1).max(24),
  params: z
    .record(
      z.string().max(64),
      z.union([z.string().max(256), z.number(), z.boolean(), z.null()])
    )
    .optional(),
}).strict();

// audit v12 MEDIUM (MED-20) ultra — accept visibility + targetUserIds; refine rejects SPECIFIC with no targets
const createSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    layoutJson: z.array(widgetSchema).max(50),
    isShared: z.boolean().optional(),
    visibility: z.enum(["OWNER", "SPECIFIC", "EVERYONE"]).optional(),
    targetUserIds: z.array(z.string().min(1)).max(50).optional(),
  })
  .refine(
    (v) => !(v.visibility === "SPECIFIC" && (!v.targetUserIds || v.targetUserIds.length === 0)),
    { message: "targetUserIds must not be empty when visibility is SPECIFIC", path: ["targetUserIds"] }
  );

// audit v12 MEDIUM (MED-20) ultra — same extension for PATCH
const patchSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().trim().min(1).max(80).optional(),
    layoutJson: z.array(widgetSchema).max(50).optional(),
    isShared: z.boolean().optional(),
    visibility: z.enum(["OWNER", "SPECIFIC", "EVERYONE"]).optional(),
    targetUserIds: z.array(z.string().min(1)).max(50).optional(),
  })
  .refine(
    (v) => !(v.visibility === "SPECIFIC" && (!v.targetUserIds || v.targetUserIds.length === 0)),
    { message: "targetUserIds must not be empty when visibility is SPECIFIC", path: ["targetUserIds"] }
  );

export async function GET() {
  const session = (await auth()) as Session | null;
  const ownerId = ownerOrNull(session);
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // audit v12 MEDIUM (MED-20) ultra — include SPECIFIC dashboards shared to this user via CrmDashboardShare
  const dashboards = await db.crmDashboard.findMany({
    where: {
      OR: [
        { ownerId },
        { visibility: "EVERYONE" },
        { visibility: "SPECIFIC", shares: { some: { userId: ownerId } } },
      ],
    },
    orderBy: [{ ownerId: "asc" }, { name: "asc" }],
    include: {
      owner: { select: { id: true, fullName: true } },
      shares: { select: { userId: true } },
    },
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
  // audit v12 HIGH (HIGH-34) / audit v12 MEDIUM (MED-20) ultra — only ADMINs may broadcast to all users (EVERYONE)
  const resolvedVisibility = parsed.data.visibility ?? (parsed.data.isShared ? "EVERYONE" : "OWNER");
  if (resolvedVisibility === "EVERYONE" && session?.user?.crmRole !== "ADMIN") {
    return NextResponse.json(
      { error: "Only CRM administrators may create globally shared dashboards." },
      { status: 403 }
    );
  }
  // audit v12 MEDIUM (MED-19) — catch P2002 unique constraint on (ownerId, name) and return 409
  try {
    const d = await db.crmDashboard.create({
      data: {
        ownerId,
        name: parsed.data.name,
        layoutJson: parsed.data.layoutJson as unknown as Prisma.InputJsonValue,
        // audit v12 MEDIUM (MED-20) ultra — write visibility and mirror isShared for back-compat
        visibility: resolvedVisibility,
        isShared: resolvedVisibility === "EVERYONE",
      },
    });
    // audit v12 MEDIUM (MED-20) ultra — create share rows for SPECIFIC visibility
    if (resolvedVisibility === "SPECIFIC" && parsed.data.targetUserIds?.length) {
      await db.crmDashboardShare.createMany({
        data: parsed.data.targetUserIds.map((userId) => ({ dashboardId: d.id, userId })),
        skipDuplicates: true,
      });
    }
    return NextResponse.json({ ok: true, dashboard: d });
  } catch (err) {
    if (err instanceof PrismaRuntime.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "A dashboard with that name already exists." }, { status: 409 });
    }
    throw err;
  }
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
  // audit v12 HIGH (HIGH-34) / audit v12 MEDIUM (MED-20) ultra — only ADMINs may promote to EVERYONE
  const patchVisibility =
    parsed.data.visibility ?? (parsed.data.isShared !== undefined ? (parsed.data.isShared ? "EVERYONE" : "OWNER") : undefined);
  if (patchVisibility === "EVERYONE" && session?.user?.crmRole !== "ADMIN") {
    return NextResponse.json(
      { error: "Only CRM administrators may share dashboards globally." },
      { status: 403 }
    );
  }
  // audit v12 MEDIUM (MED-22) recheck-hardening: reject the payload when
  // the caller provides targetUserIds alongside a non-SPECIFIC visibility.
  // Previously the list was silently discarded, which masked an admin's
  // mistaken assumption that EVERYONE could be narrowed to a subset.
  if (
    parsed.data.targetUserIds &&
    parsed.data.targetUserIds.length > 0 &&
    patchVisibility !== undefined &&
    patchVisibility !== "SPECIFIC"
  ) {
    return NextResponse.json(
      {
        error:
          "targetUserIds is only valid when visibility=SPECIFIC. To restrict to a list, send visibility=SPECIFIC.",
      },
      { status: 400 },
    );
  }
  // audit v12 MEDIUM (MED-20) ultra — strip client-supplied fields; handle visibility + share rows
  const { id, layoutJson, visibility: _vis, targetUserIds, isShared: _is, ...nameRest } = parsed.data;
  // audit v12 MEDIUM (MED-19) — catch P2002 unique constraint on (ownerId, name) and return 409
  try {
    const d = await db.crmDashboard.update({
      where: { id },
      data: {
        ...nameRest,
        ...(layoutJson !== undefined
          ? { layoutJson: layoutJson as unknown as Prisma.InputJsonValue }
          : {}),
        // audit v12 MEDIUM (MED-20) ultra — write visibility and mirror isShared
        ...(patchVisibility !== undefined
          ? { visibility: patchVisibility, isShared: patchVisibility === "EVERYONE" }
          : {}),
      },
    });
    // audit v12 MEDIUM (MED-20) ultra — sync share rows when visibility changes
    if (patchVisibility !== undefined) {
      if (patchVisibility === "SPECIFIC") {
        await db.crmDashboardShare.deleteMany({ where: { dashboardId: id } });
        if (targetUserIds?.length) {
          await db.crmDashboardShare.createMany({
            data: targetUserIds.map((userId) => ({ dashboardId: id, userId })),
            skipDuplicates: true,
          });
        }
      } else {
        // OWNER or EVERYONE — remove any leftover share rows
        await db.crmDashboardShare.deleteMany({ where: { dashboardId: id } });
      }
    }
    return NextResponse.json({ ok: true, dashboard: d });
  } catch (err) {
    if (err instanceof PrismaRuntime.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "A dashboard with that name already exists." }, { status: 409 });
    }
    throw err;
  }
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
