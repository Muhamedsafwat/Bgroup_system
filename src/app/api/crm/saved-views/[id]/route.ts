import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { describeZodError } from "@/lib/zod-errors";
import type { Prisma } from "@/generated/prisma";

/**
 * PATCH /api/crm/saved-views/[id]
 * DELETE /api/crm/saved-views/[id]
 *
 * Edit (rename / change filters / re-share) and delete a saved view.
 * Only the OWNER can edit or delete their own view. Shared views
 * created by someone else are read-only for non-owners — they can
 * "fork" by saving a new view with a tweaked name.
 */
const patchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  filtersJson: z.record(z.string(), z.unknown()).optional(),
  isShared: z.boolean().optional(),
});

async function ownerOrForbid(
  session: Session,
  id: string
): Promise<{ ok: true; view: { id: string; ownerId: string } } | { ok: false; res: NextResponse }> {
  const crmProfileId = session.user.crmProfileId;
  if (!crmProfileId) {
    return { ok: false, res: NextResponse.json({ error: "No CRM profile" }, { status: 403 }) };
  }
  const view = await db.crmSavedView.findUnique({
    where: { id },
    select: { id: true, ownerId: true },
  });
  if (!view) {
    return { ok: false, res: NextResponse.json({ error: "View not found" }, { status: 404 }) };
  }
  // Platform super-admin can always edit; otherwise must be owner.
  const isPlatformAdmin =
    !!session.user.hrRoles?.includes("super_admin") ||
    (!!session.user.modules?.includes("partners") && !session.user.partnerId);
  if (view.ownerId !== crmProfileId && !isPlatformAdmin) {
    return { ok: false, res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true, view };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const gate = await ownerOrForbid(session, id);
  if (!gate.ok) return gate.res;

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    const { message, fieldErrors } = describeZodError(parsed.error);
    return NextResponse.json({ error: message, fieldErrors }, { status: 422 });
  }
  // Publishing-to-shared still needs manager/admin approval — even if
  // the owner created it, they can't flip it shared unless they're
  // privileged. Avoids reps spamming the org-wide dropdown.
  if (parsed.data.isShared === true) {
    const canShare =
      session.user.crmRole === "MANAGER" ||
      session.user.crmRole === "ADMIN" ||
      !!session.user.hrRoles?.includes("super_admin");
    if (!canShare) {
      return NextResponse.json(
        { error: "Only manager/admin can publish a shared view" },
        { status: 403 }
      );
    }
  }
  // Same Prisma Json cast as the POST handler — Zod validates the
  // shape, but Prisma's structural type wants the InputJsonValue
  // brand explicitly. Splitting filtersJson out keeps the rest of
  // the patch payload type-safe.
  const { filtersJson, ...rest } = parsed.data;
  const updated = await db.crmSavedView.update({
    where: { id },
    data: {
      ...rest,
      ...(filtersJson !== undefined
        ? { filtersJson: filtersJson as Prisma.InputJsonValue }
        : {}),
    },
  });
  return NextResponse.json({ ok: true, view: updated });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const gate = await ownerOrForbid(session, id);
  if (!gate.ok) return gate.res;
  await db.crmSavedView.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
