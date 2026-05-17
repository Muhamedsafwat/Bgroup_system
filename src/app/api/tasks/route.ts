import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { Prisma, TaskStatus, TaskPriority, TaskType, TaskEntityType } from "@/generated/prisma";
import { moduleForEntityType } from "@/lib/tasks/helpers";
import { recurrenceSchema } from "@/lib/tasks/recurrence";
import { describeZodError } from "@/lib/zod-errors";

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().default(""),
  type: z.nativeEnum(TaskType).optional(),
  priority: z.nativeEnum(TaskPriority).optional(),
  status: z.nativeEnum(TaskStatus).optional(),
  assigneeId: z.string().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  remindAt: z.string().datetime().nullable().optional(),
  entityType: z.nativeEnum(TaskEntityType).nullable().optional(),
  entityId: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
  module: z.enum(["hr", "crm", "partners", "general"]).optional(),
  recurrence: recurrenceSchema.nullable().optional(),
});

const BUCKETS = ["today", "overdue", "upcoming", "someday", "done", "all"] as const;

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const url = new URL(req.url);

  const scope = url.searchParams.get("scope") ?? "mine";
  const bucketParam = url.searchParams.get("bucket");
  const bucket = bucketParam && (BUCKETS as readonly string[]).includes(bucketParam) ? bucketParam : null;
  const statusParam = url.searchParams.get("status");
  const status =
    statusParam && (Object.values(TaskStatus) as string[]).includes(statusParam)
      ? (statusParam as TaskStatus)
      : null;
  const moduleParam = url.searchParams.get("module");
  const entityType = url.searchParams.get("entityType") as TaskEntityType | null;
  const entityId = url.searchParams.get("entityId");
  const q = url.searchParams.get("q")?.trim() ?? "";
  const priorityParam = url.searchParams.get("priority");
  const priority =
    priorityParam && (Object.values(TaskPriority) as string[]).includes(priorityParam)
      ? (priorityParam as TaskPriority)
      : null;
  const typeParam = url.searchParams.get("type");
  const taskType =
    typeParam && (Object.values(TaskType) as string[]).includes(typeParam)
      ? (typeParam as TaskType)
      : null;
  const take = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
  const skip = Number(url.searchParams.get("offset") ?? 0);

  const where: Prisma.TaskWhereInput = {};

  // ── Scope: who's tasks ────────────────────────────────────────────────
  if (scope === "mine") {
    where.assigneeId = userId;
  } else if (scope === "created") {
    where.createdById = userId;
  } else if (scope === "all") {
    // Platform admins see everything; everyone else sees own.
    const isPlatformAdmin =
      !!session.user.hrRoles?.includes("super_admin") ||
      (!!session.user.modules?.includes("partners") && !session.user.partnerId);
    if (!isPlatformAdmin) where.assigneeId = userId;
  } else {
    where.assigneeId = userId;
  }

  if (status) where.status = status;
  if (moduleParam) where.module = moduleParam;
  if (entityType) where.entityType = entityType;
  if (entityId) where.entityId = entityId;
  if (priority) where.priority = priority;
  if (taskType) where.type = taskType;
  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
    ];
  }

  if (bucket) {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(startOfToday);
    endOfToday.setDate(endOfToday.getDate() + 1);
    const sevenDays = new Date(startOfToday);
    sevenDays.setDate(sevenDays.getDate() + 7);

    if (bucket === "today") {
      where.status = { not: "DONE" };
      where.dueAt = { gte: startOfToday, lt: endOfToday };
    } else if (bucket === "overdue") {
      where.status = { not: "DONE" };
      where.dueAt = { lt: startOfToday };
    } else if (bucket === "upcoming") {
      where.status = { not: "DONE" };
      where.dueAt = { gte: endOfToday, lt: sevenDays };
    } else if (bucket === "someday") {
      where.status = { not: "DONE" };
      where.OR = [
        ...(where.OR ?? []),
        { dueAt: null },
        { dueAt: { gte: sevenDays } },
      ];
    } else if (bucket === "done") {
      where.status = "DONE";
    }
  }

  const [tasks, total] = await Promise.all([
    db.task.findMany({
      where,
      orderBy: [
        { status: "asc" }, // TODO < IN_PROGRESS < DONE < CANCELLED
        { dueAt: "asc" },
        { priority: "desc" },
        { createdAt: "desc" },
      ],
      take,
      skip,
      include: {
        assignee: { select: { id: true, name: true, email: true, image: true } },
        createdBy: { select: { id: true, name: true, email: true } },
      },
    }),
    db.task.count({ where }),
  ]);

  return NextResponse.json({ tasks, total });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    { const __z = describeZodError(parsed.error); return NextResponse.json({ error: __z.message, fieldErrors: __z.fieldErrors }, { status: 400 }); }
  }
  const data = parsed.data;

  // Cross-validate entity link.
  if ((data.entityType && !data.entityId) || (!data.entityType && data.entityId)) {
    return NextResponse.json(
      { error: "entityType and entityId must both be provided" },
      { status: 400 }
    );
  }

  const assigneeId = data.assigneeId ?? session.user.id;
  // If assigneeId differs from current user, verify the user actually exists.
  if (assigneeId !== session.user.id) {
    const exists = await db.user.findUnique({ where: { id: assigneeId }, select: { id: true } });
    if (!exists) {
      return NextResponse.json({ error: "assigneeId not found" }, { status: 400 });
    }
  }

  const taskModule = data.module ?? moduleForEntityType(data.entityType);

  // If parentId is set, the parent must exist and the user must own/create it.
  if (data.parentId) {
    const parent = await db.task.findUnique({
      where: { id: data.parentId },
      select: { id: true, assigneeId: true, createdById: true, entityType: true, entityId: true, module: true },
    });
    const isAdmin =
      !!session.user.hrRoles?.includes("super_admin") ||
      (!!session.user.modules?.includes("partners") && !session.user.partnerId);
    if (!parent || (!isAdmin && parent.assigneeId !== session.user.id && parent.createdById !== session.user.id)) {
      return NextResponse.json({ error: "Parent task not found" }, { status: 400 });
    }
  }

  const task = await db.task.create({
    data: {
      title: data.title,
      description: data.description ?? "",
      type: data.type ?? "GENERAL",
      priority: data.priority ?? "MEDIUM",
      status: data.status ?? "TODO",
      assigneeId,
      createdById: session.user.id,
      entityType: data.entityType ?? null,
      entityId: data.entityId ?? null,
      dueAt: data.dueAt ? new Date(data.dueAt) : null,
      remindAt: data.remindAt ? new Date(data.remindAt) : null,
      parentId: data.parentId ?? null,
      module: taskModule,
      recurrence: data.recurrence ?? Prisma.DbNull,
    },
    include: {
      assignee: { select: { id: true, name: true, email: true, image: true } },
      createdBy: { select: { id: true, name: true, email: true } },
    },
  });

  return NextResponse.json({ task }, { status: 201 });
}
