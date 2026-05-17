import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { Prisma, TaskStatus, TaskPriority, TaskType, TaskEntityType } from "@/generated/prisma";
import { recurrenceSchema, spawnNextRecurrence } from "@/lib/tasks/recurrence";
import { findUnblockedTasks } from "@/lib/tasks/dependencies";
import { publish } from "@/lib/events/bus";
import { advanceRunOnTaskDone, markRunStepStarted } from "@/lib/sequential-workflows/engine";
import { describeZodError } from "@/lib/zod-errors";

const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  type: z.nativeEnum(TaskType).optional(),
  priority: z.nativeEnum(TaskPriority).optional(),
  status: z.nativeEnum(TaskStatus).optional(),
  assigneeId: z.string().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  remindAt: z.string().datetime().nullable().optional(),
  entityType: z.nativeEnum(TaskEntityType).nullable().optional(),
  entityId: z.string().nullable().optional(),
  recurrence: recurrenceSchema.nullable().optional(),
  /// Optional human-readable note attached as a system comment when reassigning.
  delegationNote: z.string().trim().max(500).optional(),
});

async function loadTaskOrError(id: string, userId: string, isPlatformAdmin: boolean) {
  const task = await db.task.findUnique({ where: { id } });
  if (!task) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  if (!isPlatformAdmin && task.assigneeId !== userId && task.createdById !== userId) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  return { task };
}

function isPlatformAdmin(session: Session) {
  return (
    !!session.user.hrRoles?.includes("super_admin") ||
    (!!session.user.modules?.includes("partners") && !session.user.partnerId)
  );
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await loadTaskOrError(id, session.user.id, isPlatformAdmin(session));
  if ("error" in result) return result.error;

  const full = await db.task.findUnique({
    where: { id },
    include: {
      assignee: { select: { id: true, name: true, email: true, image: true } },
      createdBy: { select: { id: true, name: true, email: true } },
      children: {
        orderBy: { createdAt: "asc" },
        include: { assignee: { select: { id: true, name: true } } },
      },
    },
  });
  return NextResponse.json({ task: full });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = isPlatformAdmin(session);
  const result = await loadTaskOrError(id, session.user.id, admin);
  if ("error" in result) return result.error;

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    { const __z = describeZodError(parsed.error); return NextResponse.json({ error: __z.message, fieldErrors: __z.fieldErrors }, { status: 400 }); }
  }
  const { delegationNote, recurrence, ...rest } = parsed.data;

  // Permission model: a task's CREATOR (or a platform admin) has full edit
  // authority. The ASSIGNEE, when they didn't author the task, can only act
  // on it — Start/End it (status transitions) and comment on it. Trying to
  // change any other field is a 403, by design. This makes downstream workflow
  // steps tamper-proof: the upstream assignee can't rewrite the task someone
  // else handed them.
  const isCreator = result.task.createdById === session.user.id;
  if (!admin && !isCreator) {
    const ALLOWED_FIELDS_FOR_ASSIGNEE = new Set(["status"]);
    const violating = Object.keys(rest).filter(
      (k) => rest[k as keyof typeof rest] !== undefined && !ALLOWED_FIELDS_FOR_ASSIGNEE.has(k)
    );
    if (violating.length > 0 || recurrence !== undefined || delegationNote) {
      return NextResponse.json(
        {
          error: `Only the task creator can edit ${violating.join(", ") || "this"}. You can Start/End the task, add comments, or attach files.`,
        },
        { status: 403 }
      );
    }
    // Assignees can move TODO → IN_PROGRESS → DONE; revoking DONE is allowed
    // so they can re-open work in progress, but cancelling is creator-only.
    if (rest.status && !["TODO", "IN_PROGRESS", "DONE"].includes(rest.status)) {
      return NextResponse.json(
        { error: "Only the creator can cancel a task." },
        { status: 403 }
      );
    }
  }

  const next = { ...rest } as Record<string, unknown>;

  // Auto-fill completedAt / completedById when transitioning to DONE.
  const completing = rest.status === "DONE" && result.task.status !== "DONE";
  const starting = rest.status === "IN_PROGRESS" && result.task.status === "TODO";
  if (completing) {
    next.completedAt = new Date();
    next.completedById = session.user.id;
  } else if (rest.status && rest.status !== "DONE" && result.task.status === "DONE") {
    next.completedAt = null;
    next.completedById = null;
  }
  if (rest.dueAt !== undefined) next.dueAt = rest.dueAt ? new Date(rest.dueAt) : null;
  if (rest.remindAt !== undefined) next.remindAt = rest.remindAt ? new Date(rest.remindAt) : null;

  // Recurrence: explicitly null clears it, undefined leaves it untouched.
  if (recurrence === null) next.recurrence = Prisma.DbNull;
  else if (recurrence !== undefined) next.recurrence = recurrence;

  // If reassigning to a different user, validate target exists.
  const reassigning =
    rest.assigneeId !== undefined && rest.assigneeId !== result.task.assigneeId;
  if (reassigning) {
    const exists = await db.user.findUnique({
      where: { id: rest.assigneeId! },
      select: { id: true },
    });
    if (!exists) return NextResponse.json({ error: "assigneeId not found" }, { status: 400 });
  }

  const previousAssigneeId = result.task.assigneeId;

  const task = await db.task.update({
    where: { id },
    data: next,
    include: {
      assignee: { select: { id: true, name: true, email: true, image: true } },
      createdBy: { select: { id: true, name: true, email: true } },
    },
  });

  // Drop a system comment on delegation so the assignee + watchers see why.
  if (reassigning) {
    const noteText = delegationNote
      ? `Reassigned by ${session.user.name ?? session.user.email}: ${delegationNote}`
      : `Reassigned from ${previousAssigneeId} to ${task.assigneeId} by ${session.user.name ?? session.user.email}`;
    await db.taskComment.create({
      data: {
        taskId: id,
        authorId: session.user.id,
        body: noteText,
        isSystem: true,
      },
    });
  }

  // Recurrence-on-complete: spawn next instance.
  if (completing) {
    const nextId = await spawnNextRecurrence(result.task);
    if (nextId) {
      await db.taskComment.create({
        data: {
          taskId: id,
          authorId: session.user.id,
          body: `Next recurrence spawned (${nextId}).`,
          isSystem: true,
        },
      });
    }

    // Unblock dependent tasks: any task whose ALL blockers are now done.
    const unblockedIds = await findUnblockedTasks(id);
    if (unblockedIds.length > 0) {
      const unblockedTasks = await db.task.findMany({
        where: { id: { in: unblockedIds } },
        select: { id: true, title: true, assigneeId: true },
      });
      for (const t of unblockedTasks) {
        publish({
          type: "task.updated",
          userId: t.assigneeId,
          payload: { id: t.id, status: "TODO" },
        });
        await db.taskComment.create({
          data: {
            taskId: t.id,
            authorId: session.user.id,
            body: `Unblocked: blocker "${result.task.title}" was completed.`,
            isSystem: true,
          },
        });
      }
    }
  }

  // Sequential workflow integration: start timer when transitioning to
  // IN_PROGRESS, advance to next step + evaluate SLA on DONE.
  if (starting) {
    await markRunStepStarted(id);
  }
  if (completing) {
    const advance = await advanceRunOnTaskDone(id);
    if (advance.ok) {
      const slaLabel =
        advance.sla === "LATE"
          ? `LATE (${advance.durationMinutes}m vs ${advance.budgetMinutes}m budget — incident logged)`
          : advance.sla === "EARLY_BONUS"
          ? `EARLY (${advance.durationMinutes}m vs ${advance.budgetMinutes}m budget — bonus logged)`
          : `ON TIME (${advance.durationMinutes}m vs ${advance.budgetMinutes}m budget)`;
      await db.taskComment.create({
        data: {
          taskId: id,
          authorId: session.user.id,
          body: `Workflow SLA: ${slaLabel}`,
          isSystem: true,
        },
      });
      if (advance.runCompleted) {
        await db.taskComment.create({
          data: {
            taskId: id,
            authorId: session.user.id,
            body: "Workflow run completed.",
            isSystem: true,
          },
        });
      }
    }
  }

  return NextResponse.json({ task });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = isPlatformAdmin(session);
  const result = await loadTaskOrError(id, session.user.id, admin);
  if ("error" in result) return result.error;

  // Same permission model as PATCH: only the creator (or a platform admin) can
  // delete. Assignees can't unilaterally make a task assigned to them vanish.
  if (!admin && result.task.createdById !== session.user.id) {
    return NextResponse.json(
      { error: "Only the task creator can delete this task." },
      { status: 403 }
    );
  }

  await db.task.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
