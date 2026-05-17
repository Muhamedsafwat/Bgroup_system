import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { scopeOpportunityByRole } from "@/lib/crm/rbac";
import { describeZodError } from "@/lib/zod-errors";
import type { SessionUser } from "@/types";

/**
 * PATCH /api/crm/opportunities/[id]/contact
 *
 * Edit the inline contact-person fields on an opportunity. Backs the
 * Contacts card on the opp detail page. Uses the standard scope helper
 * so a rep only edits their own opps, manager their team's, etc.
 *
 * Empty strings null the field out — handy when the rep realises the
 * phone they captured was wrong and wants to clear it.
 */
const schema = z.object({
  customerContactName: z.string().trim().max(200).nullable().optional(),
  customerContactPhone: z.string().trim().max(40).nullable().optional(),
  customerContactEmail: z.string().trim().max(200).nullable().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id || !session.user.crmProfileId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const e = describeZodError(parsed.error);
    return NextResponse.json({ error: e.message, fieldErrors: e.fieldErrors }, { status: 422 });
  }

  const sessionUser: SessionUser = {
    id: session.user.crmProfileId,
    email: session.user.email!,
    fullName: session.user.name!,
    role: session.user.crmRole!,
    entityId: session.user.crmEntityId ?? null,
  };
  const scope = scopeOpportunityByRole(sessionUser);
  const opp = await db.crmOpportunity.findFirst({
    where: { id, ...scope, deletedAt: null },
    select: { id: true },
  });
  if (!opp) {
    return NextResponse.json(
      { error: "Opportunity not found or not in your scope" },
      { status: 404 }
    );
  }

  const updated = await db.crmOpportunity.update({
    where: { id },
    data: {
      customerContactName: parsed.data.customerContactName ?? null,
      customerContactPhone: parsed.data.customerContactPhone ?? null,
      customerContactEmail: parsed.data.customerContactEmail ?? null,
    },
    select: {
      id: true,
      customerContactName: true,
      customerContactPhone: true,
      customerContactEmail: true,
    },
  });
  return NextResponse.json({ ok: true, opp: updated });
}
