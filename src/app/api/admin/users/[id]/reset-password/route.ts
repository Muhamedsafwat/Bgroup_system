import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
// audit v12 MEDIUM (MED-54): use canonical isPlatformAdmin instead of local copy
import { isPlatformAdmin } from "@/lib/crm/admin-gates";

/**
 * POST /api/admin/users/[id]/reset-password
 *
 * Admin-only password reset. Lets a platform admin set any user's password
 * directly — typically used when an employee can't sign in and the standard
 * "forgot password" email flow isn't viable (no inbox configured, contractor
 * needs immediate access, etc.).
 *
 * Unlike the self-service flow, this endpoint does NOT require the user's
 * current password. The admin's authority to act on behalf of the user is
 * derived from the platform-admin check below.
 *
 * Every reset writes a row in `HrAuditLog` so we always have a trail of
 * "who changed whose password, when". Bcrypt cost 10 to match `auth.ts`.
 */

const schema = z.object({
  newPassword: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(200, "Password is too long"),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isPlatformAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0].message,
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
      { status: 422 }
    );
  }

  const target = await db.user.findUnique({
    where: { id },
    select: { id: true, email: true },
  });
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const hash = await bcrypt.hash(parsed.data.newPassword, 10);
  const ipAddress =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  // audit v12 MEDIUM (MED-51) ultra — wrap the password update and audit-log
  // insert in a single transaction so neither commits without the other.
  // The audit row is written unconditionally: when the acting admin has no
  // HrUserProfile, userId is null and actingAdminId carries their identity,
  // ensuring every admin reset is traceable regardless of HR-profile state.
  await db.$transaction(async (tx) => {
    // Force the user to replace this admin-set password on their next login —
    // the admin knows the plaintext temporarily, so it has to be rotated by
    // the actual user before they can do anything else.
    await tx.user.update({
      where: { id: target.id },
      data: { password: hash, mustChangePassword: true },
    });

    // Audit trail — admins reading audit-logs/page.tsx can see every reset.
    // HrAuditLog.userId is a FK to HrUserProfile.userId (User id), so we pass
    // the actor's User id directly. The target user is captured in entityId so
    // a "what happened to user X" filter on the log works correctly. We don't
    // store oldValue/newValue — keeping bcrypt hashes out of the audit table
    // by design; "password was reset" is the only fact we need.
    const actorLinked = await tx.hrUserProfile.findUnique({
      where: { userId: session.user.id },
      select: { userId: true },
    });

    await tx.hrAuditLog.create({
      data: {
        userId: actorLinked?.userId ?? null,
        actingAdminId: session.user.id,
        action: "admin_reset_password",
        entityType: "User",
        entityId: target.id,
        fieldName: "password",
        ipAddress,
      },
    });
  });

  return NextResponse.json({ ok: true, email: target.email });
}
