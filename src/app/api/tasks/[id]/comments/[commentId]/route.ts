import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isPlatformAdmin } from "@/lib/crm/admin-gates";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; commentId: string }> }
) {
  const { id, commentId } = await params;
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const comment = await db.taskComment.findUnique({
    where: { id: commentId },
    include: {
      task: {
        select: {
          id: true,
          assigneeId: true,
          createdById: true,
          watchers: { select: { userId: true } },
        },
      },
    },
  });
  if (!comment || comment.taskId !== id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Re-verify the caller can still see this task. The previous
  // version let an author delete history on a task they no longer
  // have access to (e.g. unassigned after authoring).
  const userId = session.user.id;
  const canSeeTask =
    comment.task.assigneeId === userId ||
    comment.task.createdById === userId ||
    comment.task.watchers.some((w) => w.userId === userId) ||
    isPlatformAdmin(session);
  if (!canSeeTask) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Author can delete their own comment; platform admins can delete any.
  const canDelete = comment.authorId === userId || isPlatformAdmin(session);
  if (!canDelete) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await db.taskComment.delete({ where: { id: commentId } });
  return NextResponse.json({ success: true });
}
