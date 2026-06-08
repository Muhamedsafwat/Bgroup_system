import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { publish } from "@/lib/events/bus";
import { resolveMentions } from "@/lib/tasks/mentions";
import { describeZodError } from "@/lib/zod-errors";

const createSchema = z.object({
  body: z.string().trim().min(1).max(4000),
});

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

  const comments = await db.taskComment.findMany({
    where: { taskId: id },
    orderBy: { createdAt: "asc" },
    include: { author: { select: { id: true, name: true, email: true, image: true } } },
  });
  return NextResponse.json({ comments });
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
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    { const __z = describeZodError(parsed.error); return NextResponse.json({ error: __z.message, fieldErrors: __z.fieldErrors }, { status: 422 }); }
  }

  const comment = await db.taskComment.create({
    data: {
      taskId: id,
      authorId: session.user.id,
      body: parsed.data.body,
    },
    include: { author: { select: { id: true, name: true, email: true, image: true } } },
  });

  // Notify the assignee if someone else commented.
  if (result.task.assigneeId !== session.user.id) {
    publish({
      type: "task.updated",
      userId: result.task.assigneeId,
      payload: { id: result.task.id, status: result.task.status },
    });
  }

  // Auto-watch + notify mentioned users.
  const mentionedIds = await resolveMentions(parsed.data.body, session.user.id);
  if (mentionedIds.length > 0) {
    // Add as watchers (skip duplicates via the @@unique constraint).
    await Promise.all(
      mentionedIds.map((uid) =>
        db.taskWatcher
          .create({ data: { taskId: id, userId: uid } })
          .catch(() => null)
      )
    );
    // Notify each mentioned user via SSE bus.
    for (const uid of mentionedIds) {
      publish({
        type: "task.updated",
        userId: uid,
        payload: { id: result.task.id, status: result.task.status },
      });
    }
  }

  // Notify watchers (other than the author + assignee already pinged).
  const watchers = await db.taskWatcher.findMany({
    where: { taskId: id },
    select: { userId: true },
  });
  const alreadyNotified = new Set([session.user.id, result.task.assigneeId, ...mentionedIds]);
  for (const w of watchers) {
    if (alreadyNotified.has(w.userId)) continue;
    publish({
      type: "task.updated",
      userId: w.userId,
      payload: { id: result.task.id, status: result.task.status },
    });
  }

  return NextResponse.json({ comment }, { status: 201 });
}
