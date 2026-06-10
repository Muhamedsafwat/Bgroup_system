import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
// audit v12 MEDIUM (MED-54): use canonical isPlatformAdmin instead of local copy
import { isPlatformAdmin } from "@/lib/crm/admin-gates";

/**
 * Tier-1 #30 — stop impersonation. Three legitimate callers:
 *
 *   1. The admin currently impersonating (token.actingAs is set,
 *      session.user.id is the TARGET, actingAs is the admin's id).
 *      This is the "Return to admin" banner button.
 *   2. The admin themselves, back on their own session, cleaning up
 *      a hanging row (session.user.id matches the row's adminUserId,
 *      no actingAs set).
 *   3. A platform super-admin force-stopping someone else's session
 *      (oversight / incident response).
 *
 * Anyone else (including the impersonation target if they somehow
 * came into possession of the JWT) is rejected — and the audit row
 * records the actual initiator so an admin can tell whether the
 * stop was self-service or forced by another admin.
 */

export async function POST(request: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const initiatorId = session.user.id;
  const actingAs = session.user.actingAs;
  // audit v12 MEDIUM (MED-50): parse optional targeting fields so a
  // platform admin can identify the exact session to force-stop,
  // preventing arbitrary row selection when multiple admins are active.
  const body = await request.json().catch(() => ({}));
  const targetSessionId: string | undefined = body?.sessionId;
  const targetAdminUserId: string | undefined = body?.adminUserId;
  // Candidate adminUserId values for the row lookup. When
  // impersonation is active, the actual admin's id lives on
  // `actingAs`; when the admin is on their own session, it's
  // `user.id`. We never include the bare target id from another
  // user's session — that's how the previous version let the target
  // accidentally cancel an impersonation.
  const adminCandidates = [actingAs, !actingAs ? initiatorId : null].filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
  const row = adminCandidates.length
    ? await db.crmImpersonationSession.findFirst({
        where: { adminUserId: { in: adminCandidates } },
      })
    : null;
  // Platform admins can force-stop ANY active session. They don't
  // need their id to match the row's adminUserId.
  // audit v12 MEDIUM (MED-50): use the caller-supplied session id or
  // admin id to target the specific row; fall back to most-recent row
  // (orderBy createdAt desc) to avoid returning an arbitrary record.
  const rowForForceStop =
    !row && isPlatformAdmin(session)
      ? targetSessionId
        ? await db.crmImpersonationSession.findUnique({
            where: { id: targetSessionId },
          })
        : await db.crmImpersonationSession.findFirst({
            where: {
              adminUserId: targetAdminUserId
                ? targetAdminUserId
                : { not: initiatorId },
            },
            orderBy: { startedAt: "desc" },
          })
      : null;
  // audit v12 MEDIUM (MED-50): explicit ownership check — the force-stopped
  // row must not belong to the initiator themselves.
  if (rowForForceStop && rowForForceStop.adminUserId === initiatorId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const finalRow = row ?? rowForForceStop;
  if (!finalRow) {
    return NextResponse.json({ ok: true, message: "No active impersonation" });
  }
  // Authorisation gate: only the admin who started OR a platform
  // admin can stop. (At this point row is non-null because we found
  // a candidate match, so the actingAs / id match is implicit; the
  // platform-admin path is implicit in rowForForceStop.)
  const isOwner =
    finalRow.adminUserId === actingAs ||
    (!actingAs && finalRow.adminUserId === initiatorId);
  const isForced = !!rowForForceStop && isPlatformAdmin(session);
  if (!isOwner && !isForced) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  await db.$transaction([
    db.crmImpersonationSession.delete({ where: { id: finalRow.id } }),
    db.crmImpersonationAudit.create({
      data: {
        adminUserId: finalRow.adminUserId,
        targetUserId: finalRow.targetUserId,
        event: "stop",
        // Carry the actual initiator id in `reason` so the audit
        // shows whether the stop was self-service (initiator ===
        // adminUserId) or force-stopped by another admin. The
        // schema doesn't have a separate initiator column yet.
        reason:
          initiatorId === finalRow.adminUserId
            ? "stopped by admin"
            : `force-stopped by ${initiatorId}`,
        ipAddress: ip,
      },
    }),
  ]);
  return NextResponse.json({ ok: true });
}
