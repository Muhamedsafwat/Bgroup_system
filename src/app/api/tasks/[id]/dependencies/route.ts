import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { wouldCreateCycle } from "@/lib/tasks/dependencies";
import { describeZodError } from "@/lib/zod-errors";

const createSchema = z.object({
  blockedById: z.string().min(1),
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

  const [blockedBy, blocks] = await Promise.all([
    db.taskDependency.findMany({
      where: { taskId: id },
      include: { blockedBy: { select: { id: true, title: true, status: true, dueAt: true } } },
    }),
    db.taskDependency.findMany({
      where: { blockedById: id },
      include: { task: { select: { id: true, title: true, status: true, dueAt: true } } },
    }),
  ]);

  return NextResponse.json({ blockedBy, blocks });
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

  if (parsed.data.blockedById === id) {
    return NextResponse.json({ error: "A task cannot depend on itself" }, { status: 400 });
  }

  // Confirm the blocker exists and is visible to this user.
  const blocker = await db.task.findUnique({
    where: { id: parsed.data.blockedById },
    select: { id: true, assigneeId: true, createdById: true },
  });
  if (!blocker) {
    return NextResponse.json({ error: "Blocker task not found" }, { status: 400 });
  }
  if (
    !isPlatformAdmin(session) &&
    blocker.assigneeId !== session.user.id &&
    blocker.createdById !== session.user.id
  ) {
    return NextResponse.json({ error: "Blocker task not found" }, { status: 400 });
  }

  const cycle = await wouldCreateCycle(id, parsed.data.blockedById);
  if (cycle) {
    return NextResponse.json({ error: "This would create a circular dependency" }, { status: 400 });
  }

  try {
    const dep = await db.taskDependency.create({
      data: { taskId: id, blockedById: parsed.data.blockedById },
      include: {
        blockedBy: { select: { id: true, title: true, status: true, dueAt: true } },
      },
    });
    return NextResponse.json({ dependency: dep }, { status: 201 });
  } catch (e) {
    if (typeof e === "object" && e && "code" in e && (e as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "Dependency already exists" }, { status: 409 });
    }
    throw e;
  }
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
  const blockedById = url.searchParams.get("blockedById");
  if (!blockedById) {
    return NextResponse.json({ error: "blockedById required" }, { status: 400 });
  }

  await db.taskDependency.deleteMany({ where: { taskId: id, blockedById } });
  return NextResponse.json({ success: true });
}
