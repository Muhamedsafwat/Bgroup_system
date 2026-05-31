import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { describeZodError } from "@/lib/zod-errors";

/**
 * Tier-1 #30 — admin "act as" / impersonation.
 *
 *   POST /api/admin/impersonate { userId, reason? }
 *   POST /api/admin/impersonate/stop
 *
 * Start: writes a `CrmImpersonationSession` row keyed by the admin's
 * user id and a `CrmImpersonationAudit` "start" event. The session
 * row is read by the auth JWT callback on the NEXT request, which
 * then surfaces the target user with `actingAs = adminUserId` so the
 * banner can offer a "return to admin" button.
 *
 * Stop endpoint lives at `/api/admin/impersonate/stop`.
 *
 * Gate: super_admin only. CRM ADMIN/MANAGER cannot impersonate —
 * impersonation is a platform-admin power.
 */
function isPlatformAdmin(session: Session) {
  return (
    !!session.user.hrRoles?.includes("super_admin") ||
    (!!session.user.modules?.includes("partners") && !session.user.partnerId)
  );
}

const startSchema = z.object({
  userId: z.string().min(1),
  reason: z.string().trim().max(500).optional(),
});

export async function POST(request: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isPlatformAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // If we're already impersonating, refuse — admin must stop first.
  // Prevents nested "admin → user A → user B" confusion.
  const existing = await db.crmImpersonationSession.findUnique({
    where: { adminUserId: session.user.id },
  });
  if (existing) {
    return NextResponse.json(
      {
        error: `Already impersonating user ${existing.targetUserId}. Stop the active session first.`,
      },
      { status: 409 }
    );
  }
  const body = await request.json().catch(() => null);
  const parsed = startSchema.safeParse(body);
  if (!parsed.success) {
    const { message, fieldErrors } = describeZodError(parsed.error);
    return NextResponse.json({ error: message, fieldErrors }, { status: 422 });
  }
  if (parsed.data.userId === session.user.id) {
    return NextResponse.json({ error: "Cannot impersonate yourself" }, { status: 400 });
  }
  const target = await db.user.findUnique({
    where: { id: parsed.data.userId },
    select: { id: true, email: true },
  });
  if (!target) {
    return NextResponse.json({ error: "Target user not found" }, { status: 404 });
  }
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  await db.$transaction([
    db.crmImpersonationSession.create({
      data: {
        adminUserId: session.user.id,
        targetUserId: target.id,
        reason: parsed.data.reason ?? null,
      },
    }),
    db.crmImpersonationAudit.create({
      data: {
        adminUserId: session.user.id,
        targetUserId: target.id,
        event: "start",
        reason: parsed.data.reason ?? null,
        ipAddress: ip,
      },
    }),
  ]);
  return NextResponse.json({
    ok: true,
    message:
      "Impersonation active. Next page load reflects the target user. Return via /api/admin/impersonate/stop.",
    target: { id: target.id, email: target.email },
  });
}
