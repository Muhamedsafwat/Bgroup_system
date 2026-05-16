import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * POST /api/account/change-password
 *
 * Self-service. Any signed-in user can change their own password. Requires
 * the CURRENT password so a stolen session cookie alone can't take over the
 * account — the attacker would also need the live password. The new password
 * is bcrypt-hashed with cost 10 (matching the rest of the codebase) and the
 * write happens atomically so a half-applied state isn't possible.
 *
 * 4xx codes are deliberately specific (401 = current wrong, 422 = new doesn't
 * meet policy) so the UI can show targeted error text instead of a generic
 * "something failed".
 */
const schema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z
      .string()
      .min(8, "New password must be at least 8 characters")
      .max(200, "New password is too long"),
  })
  .refine((d) => d.currentPassword !== d.newPassword, {
    path: ["newPassword"],
    message: "New password must be different from the current one",
  });

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, password: true },
  });
  if (!user || !user.password) {
    // Magic-link / SSO accounts have no local password. Those users can't
    // change a password they don't have — they should go through their IdP.
    return NextResponse.json(
      { error: "This account doesn't use a local password. Sign in via your identity provider." },
      { status: 400 }
    );
  }

  const ok = await bcrypt.compare(parsed.data.currentPassword, user.password);
  if (!ok) {
    return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
  }

  const hash = await bcrypt.hash(parsed.data.newPassword, 10);
  // Clear `mustChangePassword` on a successful change. Users invited with a
  // temporary admin-set password are gated to this endpoint until they pick
  // their own; once they do, normal navigation unlocks via the JWT refresh
  // on the very next request.
  await db.user.update({
    where: { id: user.id },
    data: { password: hash, mustChangePassword: false },
  });

  return NextResponse.json({ ok: true });
}
