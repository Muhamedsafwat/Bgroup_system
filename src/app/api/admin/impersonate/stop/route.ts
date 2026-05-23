import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * Tier-1 #30 — stop impersonation. Works in two modes:
 *
 *   1. Admin POSTs while still on their own account but with a row
 *      in CrmImpersonationSession — we just delete the row.
 *
 *   2. The session is currently impersonated (token.actingAs is set)
 *      — we look up the active session by adminUserId from the token
 *      and delete + audit.
 */
export async function POST(request: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // When the user is currently impersonating, the session's user.id
  // is the TARGET — the admin's id is on `actingAs`. Either column
  // can be the adminUserId we need to clear, so try both lookups.
  const adminCandidates = [session.user.id, session.user.actingAs].filter(
    Boolean,
  ) as string[];
  const row = await db.crmImpersonationSession.findFirst({
    where: { adminUserId: { in: adminCandidates } },
  });
  if (!row) {
    return NextResponse.json({ ok: true, message: "No active impersonation" });
  }
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  await db.$transaction([
    db.crmImpersonationSession.delete({ where: { id: row.id } }),
    db.crmImpersonationAudit.create({
      data: {
        adminUserId: row.adminUserId,
        targetUserId: row.targetUserId,
        event: "stop",
        ipAddress: ip,
      },
    }),
  ]);
  return NextResponse.json({ ok: true });
}
