import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { TaskStatus, TaskPriority } from "@/generated/prisma";
import { describeZodError } from "@/lib/zod-errors";

const bulkSchema = z.object({
  ids: z.array(z.string()).min(1).max(200),
  action: z.enum(["complete", "uncomplete", "delete", "reassign", "set_priority", "set_status"]),
  assigneeId: z.string().optional(),
  priority: z.nativeEnum(TaskPriority).optional(),
  status: z.nativeEnum(TaskStatus).optional(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const body = await req.json();
  const parsed = bulkSchema.safeParse(body);
  if (!parsed.success) {
    { const __z = describeZodError(parsed.error); return NextResponse.json({ error: __z.message, fieldErrors: __z.fieldErrors }, { status: 422 }); }
  }
  const { ids, action } = parsed.data;

  const isPlatformAdmin =
    !!session.user.hrRoles?.includes("super_admin") ||
    (!!session.user.modules?.includes("partners") && !session.user.partnerId);

  // Scope: only act on tasks the user owns/created (or any if platform admin).
  const where = isPlatformAdmin
    ? { id: { in: ids } }
    : { id: { in: ids }, OR: [{ assigneeId: userId }, { createdById: userId }] };

  if (action === "delete") {
    const { count } = await db.task.deleteMany({ where });
    return NextResponse.json({ success: true, count });
  }

  if (action === "complete") {
    const { count } = await db.task.updateMany({
      where: { ...where, status: { not: "DONE" } },
      data: { status: "DONE", completedAt: new Date(), completedById: userId },
    });
    return NextResponse.json({ success: true, count });
  }

  if (action === "uncomplete") {
    const { count } = await db.task.updateMany({
      where: { ...where, status: "DONE" },
      data: { status: "TODO", completedAt: null, completedById: null },
    });
    return NextResponse.json({ success: true, count });
  }

  if (action === "reassign") {
    if (!parsed.data.assigneeId) {
      return NextResponse.json({ error: "assigneeId required" }, { status: 400 });
    }
    const exists = await db.user.findUnique({
      where: { id: parsed.data.assigneeId },
      select: { id: true },
    });
    if (!exists) return NextResponse.json({ error: "assigneeId not found" }, { status: 400 });
    const { count } = await db.task.updateMany({
      where,
      data: { assigneeId: parsed.data.assigneeId },
    });
    return NextResponse.json({ success: true, count });
  }

  if (action === "set_priority") {
    if (!parsed.data.priority) {
      return NextResponse.json({ error: "priority required" }, { status: 400 });
    }
    const { count } = await db.task.updateMany({
      where,
      data: { priority: parsed.data.priority },
    });
    return NextResponse.json({ success: true, count });
  }

  if (action === "set_status") {
    if (!parsed.data.status) {
      return NextResponse.json({ error: "status required" }, { status: 400 });
    }
    const data: Record<string, unknown> = { status: parsed.data.status };
    if (parsed.data.status === "DONE") {
      data.completedAt = new Date();
      data.completedById = userId;
    } else {
      data.completedAt = null;
      data.completedById = null;
    }
    const { count } = await db.task.updateMany({ where, data });
    return NextResponse.json({ success: true, count });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
