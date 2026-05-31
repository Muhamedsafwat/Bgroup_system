import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isManagerOrAdmin } from "@/lib/crm/admin-gates";

/**
 * DELETE /api/crm/opportunities/[id]/comments/[commentId]
 *
 * Soft-delete: sets `deletedAt`. Author can delete their own;
 * MANAGER/ADMIN can delete anyone's (moderation case). The opp-level
 * gate still applies — a user who can't see the opp can't delete
 * its comments. We also leave the CrmOpportunityCommentMention rows
 * + their CrmNotification fan-outs in place: the bell already
 * recorded the mention, and silently rewriting history would feel
 * wrong to the mentioned user.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const crmProfileId = session.user.crmProfileId;
  if (!crmProfileId) {
    return NextResponse.json({ error: "No CRM profile" }, { status: 403 });
  }
  const { id, commentId } = await params;
  const comment = await db.crmOpportunityComment.findFirst({
    where: { id: commentId, opportunityId: id, deletedAt: null },
    select: { id: true, authorId: true },
  });
  if (!comment) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const isAuthor = comment.authorId === crmProfileId;
  if (!isAuthor && !isManagerOrAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  await db.crmOpportunityComment.update({
    where: { id: commentId },
    data: { deletedAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
