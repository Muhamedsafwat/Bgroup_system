import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { describeZodError } from "@/lib/zod-errors";
// audit v12 MEDIUM (MED-54): use canonical isPlatformAdmin instead of local copy
import { isPlatformAdmin } from "@/lib/crm/admin-gates";

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
  // audit v12 MEDIUM (MED-49) recheck — include active flags so we can guard deactivated users
  // audit v12 LOW (LOW-12) recheck — also fetch partnersAccess + partnerProfile to cover partner deactivation
  const target = await db.user.findUnique({
    where: { id: parsed.data.userId },
    select: {
      id: true,
      email: true,
      partnersAccess: true,
      crmProfile: { select: { active: true } },
      hrProfile: { select: { isActive: true } },
      partnerProfile: { select: { isActive: true } },
    },
  });
  if (!target) {
    return NextResponse.json({ error: "Target user not found" }, { status: 404 });
  }
  const isDeactivated =
    (target.crmProfile && !target.crmProfile.active) ||
    (target.hrProfile && !target.hrProfile.isActive) ||
    (target.partnersAccess && target.partnerProfile != null && !target.partnerProfile.isActive);
  if (isDeactivated) {
    return NextResponse.json({ error: "Target user is deactivated" }, { status: 403 });
  }
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  // Use an interactive transaction so the active-status re-read and the session creation
  // are atomic — a concurrent deactivation that commits before our write will be caught here.
  try {
    await db.$transaction(async (tx) => {
      const locked = await tx.user.findUnique({
        where: { id: parsed.data.userId },
        select: {
          id: true,
          partnersAccess: true,
          crmProfile: { select: { active: true } },
          hrProfile: { select: { isActive: true } },
          partnerProfile: { select: { isActive: true } },
        },
      });
      if (!locked) throw new Error("NOT_FOUND");
      // audit v12 LOW (LOW-12) recheck — include partner profile in deactivation guard
      const deactivated =
        (locked.crmProfile && !locked.crmProfile.active) ||
        (locked.hrProfile && !locked.hrProfile.isActive) ||
        (locked.partnersAccess && locked.partnerProfile != null && !locked.partnerProfile.isActive);
      if (deactivated) throw new Error("DEACTIVATED");
      await tx.crmImpersonationSession.create({
        data: {
          adminUserId: session.user.id,
          targetUserId: target.id,
          reason: parsed.data.reason ?? null,
        },
      });
      await tx.crmImpersonationAudit.create({
        data: {
          adminUserId: session.user.id,
          targetUserId: target.id,
          event: "start",
          reason: parsed.data.reason ?? null,
          ipAddress: ip,
        },
      });
    });
  } catch (err) {
    if (err instanceof Error && err.message === "NOT_FOUND") {
      return NextResponse.json({ error: "Target user not found" }, { status: 404 });
    }
    if (err instanceof Error && err.message === "DEACTIVATED") {
      return NextResponse.json({ error: "Target user is deactivated" }, { status: 403 });
    }
    throw err;
  }
  return NextResponse.json({
    ok: true,
    message:
      "Impersonation active. Next page load reflects the target user. Return via /api/admin/impersonate/stop.",
    target: { id: target.id, email: target.email },
  });
}
