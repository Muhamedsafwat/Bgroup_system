import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { scopeOpportunityByRole } from "@/lib/crm/rbac";

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
  // The opp-level scope gate must apply even on DELETE — without it,
  // a REP who authored a comment on an opp they later lost ownership
  // of (territory reassign, transfer) could still delete history on
  // an opp they can no longer read.
  const sUser = {
    id: crmProfileId,
    role: session.user.crmRole!,
    email: session.user.email!,
    fullName: session.user.name ?? "",
    entityId: session.user.crmEntityId ?? null,
  };
  const opp = await db.crmOpportunity.findFirst({
    where: { id, ...scopeOpportunityByRole(sUser), deletedAt: null },
    select: { id: true },
  });
  if (!opp) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const comment = await db.crmOpportunityComment.findFirst({
    where: { id: commentId, opportunityId: id, deletedAt: null },
    select: { id: true, authorId: true },
  });
  if (!comment) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const isAuthor = comment.authorId === crmProfileId;
  // CRM-scoped role check rather than the cross-module
  // isManagerOrAdmin — moderation is a CRM-domain action, and the
  // wider helper would (today: guarded by the crmProfileId check
  // above) let a platform partners-admin moderate the CRM if that
  // guard is ever relaxed.
  const isCrmAdmin =
    session.user.crmRole === "ADMIN" || session.user.crmRole === "MANAGER";
  if (!isAuthor && !isCrmAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  await db.crmOpportunityComment.update({
    where: { id: commentId },
    data: { deletedAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
