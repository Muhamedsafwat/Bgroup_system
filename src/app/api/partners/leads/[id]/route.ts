import { db } from "@/lib/db";
import { requirePartnerAuth, assertAccess, jsonSuccess, jsonError } from "@/lib/partners/helpers";
import { updateLeadSchema } from "@/lib/partners/validations";
import { NextRequest } from "next/server";

// GET /api/partners/leads/[id]
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, error } = await requirePartnerAuth();
  if (error) return error;

  const { id } = await params;
  const lead = await db.partnerLead.findFirst({ where: { id, deletedAt: null } });
  if (!lead || !assertAccess(user, lead.partnerId)) {
    return jsonError("Lead not found", 404);
  }

  return jsonSuccess(lead);
}

// PATCH /api/partners/leads/[id]
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, error } = await requirePartnerAuth();
  if (error) return error;

  const { id } = await params;
  const existing = await db.partnerLead.findFirst({ where: { id, deletedAt: null } });
  if (!existing || !assertAccess(user, existing.partnerId)) {
    return jsonError("Lead not found", 404);
  }

  const body = await request.json();
  const parsed = updateLeadSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0].message, 400);
  }

  const updated = await db.partnerLead.update({
    where: { id },
    data: parsed.data,
  });

  return jsonSuccess(updated);
}

// DELETE /api/partners/leads/[id] — soft-delete.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, error } = await requirePartnerAuth();
  if (error) return error;

  const { id } = await params;
  const existing = await db.partnerLead.findFirst({ where: { id, deletedAt: null } });
  if (!existing || !assertAccess(user, existing.partnerId)) {
    return jsonError("Lead not found", 404);
  }

  await db.partnerLead.update({
    where: { id },
    data: { deletedAt: new Date(), deletedById: user.userId },
  });
  return jsonSuccess({ message: "Lead deleted" });
}
