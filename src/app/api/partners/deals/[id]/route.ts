import { db } from "@/lib/db";
import { requirePartnerAuth, assertAccess, jsonSuccess, jsonError } from "@/lib/partners/helpers";
import { updateDealSchema } from "@/lib/partners/validations";
import { NextRequest } from "next/server";

// GET /api/partners/deals/[id]
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, error } = await requirePartnerAuth();
  if (error) return error;

  const { id } = await params;
  const deal = await db.partnerDeal.findFirst({
    where: { id, deletedAt: null },
    include: {
      client: { select: { id: true, name: true, email: true } },
      service: { select: { id: true, name: true, basePrice: true } },
    },
  });
  if (!deal || !assertAccess(user, deal.partnerId)) {
    return jsonError("Deal not found", 404);
  }

  return jsonSuccess(deal);
}

// PATCH /api/partners/deals/[id] — Update deal (with WON → auto-commission)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, error } = await requirePartnerAuth();
  if (error) return error;

  const { id } = await params;
  const existing = await db.partnerDeal.findFirst({ where: { id, deletedAt: null } });
  if (!existing || !assertAccess(user, existing.partnerId)) {
    return jsonError("Deal not found", 404);
  }

  const body = await request.json();
  const parsed = updateDealSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0].message, 400);
  }

  const { status, value, notes } = parsed.data;

  // If transitioning to WON, auto-create commission in a transaction
  if (status === "WON" && existing.status !== "WON") {
    const result = await db.$transaction(async (tx) => {
      const updated = await tx.partnerDeal.update({
        where: { id },
        data: { status: "WON", wonAt: new Date(), value, notes },
        include: {
          client: { select: { id: true, name: true } },
          service: { select: { id: true, name: true } },
        },
      });

      // Get partner's commission rate
      const partner = await tx.partnerProfile.findUnique({
        where: { id: existing.partnerId },
        select: { commissionRate: true },
      });

      const rate = partner?.commissionRate ?? 10;
      const dealValue = value ?? existing.value;
      const commissionAmount = dealValue * (rate / 100);

      await tx.partnerCommission.create({
        data: {
          partnerId: existing.partnerId,
          dealId: id,
          amount: commissionAmount,
          rate,
        },
      });

      return updated;
    });

    return jsonSuccess(result);
  }

  // Normal update (non-WON transition)
  const updated = await db.partnerDeal.update({
    where: { id },
    data: { ...(status && { status }), ...(value !== undefined && { value }), ...(notes !== undefined && { notes }) },
    include: {
      client: { select: { id: true, name: true } },
      service: { select: { id: true, name: true } },
    },
  });

  return jsonSuccess(updated);
}

// DELETE /api/partners/deals/[id] — soft-delete. Only PENDING deals can be deleted
// (WON deals already have a commission row that would leave dangling FK).
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, error } = await requirePartnerAuth();
  if (error) return error;

  const { id } = await params;
  const existing = await db.partnerDeal.findFirst({ where: { id, deletedAt: null } });
  if (!existing || !assertAccess(user, existing.partnerId)) {
    return jsonError("Deal not found", 404);
  }

  if (existing.status !== "PENDING") {
    return jsonError("Only pending deals can be deleted", 400);
  }

  await db.partnerDeal.update({
    where: { id },
    data: { deletedAt: new Date(), deletedById: user.userId },
  });
  return jsonSuccess({ message: "Deal deleted" });
}
