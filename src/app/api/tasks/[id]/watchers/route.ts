import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { describeZodError } from "@/lib/zod-errors";

const createSchema = z.object({
  userId: z.string().min(1),
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

  const watchers = await db.taskWatcher.findMany({
    where: { taskId: id },
    orderBy: { createdAt: "asc" },
    include: { user: { select: { id: true, name: true, email: true, image: true } } },
  });
  return NextResponse.json({ watchers });
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
    { const __z = describeZodError(parsed.error); return NextResponse.json({ error: __z.message, fieldErrors: __z.fieldErrors }, { status: 400 }); }
  }

  // Verify target user exists.
  const exists = await db.user.findUnique({
    where: { id: parsed.data.userId },
    select: { id: true },
  });
  if (!exists) return NextResponse.json({ error: "userId not found" }, { status: 400 });

  try {
    const watcher = await db.taskWatcher.create({
      data: { taskId: id, userId: parsed.data.userId },
      include: { user: { select: { id: true, name: true, email: true, image: true } } },
    });
    return NextResponse.json({ watcher }, { status: 201 });
  } catch (e) {
    // Unique-constraint violation = already watching → return idempotent OK.
    if (typeof e === "object" && e && "code" in e && (e as { code?: string }).code === "P2002") {
      const existing = await db.taskWatcher.findUnique({
        where: { taskId_userId: { taskId: id, userId: parsed.data.userId } },
        include: { user: { select: { id: true, name: true, email: true, image: true } } },
      });
      return NextResponse.json({ watcher: existing }, { status: 200 });
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
  const userId = url.searchParams.get("userId") ?? session.user.id;

  // Allow unwatching self always; only platform admins can remove others.
  if (userId !== session.user.id && !isPlatformAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await db.taskWatcher.deleteMany({ where: { taskId: id, userId } });
  return NextResponse.json({ success: true });
}
