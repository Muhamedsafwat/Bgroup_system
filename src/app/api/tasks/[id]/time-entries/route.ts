import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { markRunStepStarted } from "@/lib/sequential-workflows/engine";
import { describeZodError } from "@/lib/zod-errors";

const startSchema = z.object({
  action: z.literal("start"),
  note: z.string().trim().max(500).optional(),
});

const stopSchema = z.object({
  action: z.literal("stop"),
});

const manualSchema = z.object({
  action: z.literal("log"),
  durationMinutes: z.number().int().positive().max(24 * 60),
  note: z.string().trim().max(500).optional(),
});

const requestSchema = z.discriminatedUnion("action", [startSchema, stopSchema, manualSchema]);

function isPlatformAdmin(session: Session) {
  return (
    !!session.user.hrRoles?.includes("super_admin") ||
    (!!session.user.modules?.includes("partners") && !session.user.partnerId)
  );
}

async function loadTaskOrError(id: string, session: Session) {
  const task = await db.task.findUnique({ where: { id } });
  if (!task) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  const userId = session.user.id;
  const ok =
    isPlatformAdmin(session) ||
    task.assigneeId === userId ||
    task.createdById === userId;
  if (!ok) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  return { task };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await loadTaskOrError(id, session);
  if ("error" in result) return result.error;

  const entries = await db.taskTimeEntry.findMany({
    where: { taskId: id },
    orderBy: { startedAt: "desc" },
    include: { user: { select: { id: true, name: true, email: true, image: true } } },
  });
  const totalMinutes = entries.reduce((acc, e) => acc + (e.durationMinutes ?? 0), 0);
  const running = entries.find((e) => e.endedAt === null) ?? null;

  return NextResponse.json({ entries, totalMinutes, running });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await loadTaskOrError(id, session);
  if ("error" in result) return result.error;

  const body = await req.json();
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    { const __z = describeZodError(parsed.error); return NextResponse.json({ error: __z.message, fieldErrors: __z.fieldErrors }, { status: 422 }); }
  }

  if (parsed.data.action === "start") {
    // Allow only one running entry per (task, user). If one exists, return it.
    const existing = await db.taskTimeEntry.findFirst({
      where: { taskId: id, userId: session.user.id, endedAt: null },
    });
    if (existing) {
      return NextResponse.json({ entry: existing, alreadyRunning: true }, { status: 200 });
    }
    const entry = await db.taskTimeEntry.create({
      data: {
        taskId: id,
        userId: session.user.id,
        startedAt: new Date(),
        note: parsed.data.note ?? "",
      },
    });
    // Workflow integration: starting the timer on a workflow-bound task
    // also marks the run-step as started (used for SLA evaluation).
    await markRunStepStarted(id);
    return NextResponse.json({ entry }, { status: 201 });
  }

  if (parsed.data.action === "stop") {
    const open = await db.taskTimeEntry.findFirst({
      where: { taskId: id, userId: session.user.id, endedAt: null },
    });
    if (!open) {
      return NextResponse.json({ error: "No running timer to stop" }, { status: 400 });
    }
    const endedAt = new Date();
    const minutes = Math.max(1, Math.round((endedAt.getTime() - open.startedAt.getTime()) / 60000));
    const entry = await db.taskTimeEntry.update({
      where: { id: open.id },
      data: { endedAt, durationMinutes: minutes },
    });
    return NextResponse.json({ entry });
  }

  // Manual log entry — useful for retroactive logging.
  const entry = await db.taskTimeEntry.create({
    data: {
      taskId: id,
      userId: session.user.id,
      startedAt: new Date(Date.now() - parsed.data.durationMinutes * 60_000),
      endedAt: new Date(),
      durationMinutes: parsed.data.durationMinutes,
      note: parsed.data.note ?? "",
    },
  });
  return NextResponse.json({ entry }, { status: 201 });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await loadTaskOrError(id, session);
  if ("error" in result) return result.error;

  const url = new URL(req.url);
  const entryId = url.searchParams.get("entryId");
  if (!entryId) {
    return NextResponse.json({ error: "entryId required" }, { status: 400 });
  }
  const entry = await db.taskTimeEntry.findUnique({ where: { id: entryId } });
  if (!entry || entry.taskId !== id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (entry.userId !== session.user.id && !isPlatformAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  await db.taskTimeEntry.delete({ where: { id: entryId } });
  return NextResponse.json({ success: true });
}
