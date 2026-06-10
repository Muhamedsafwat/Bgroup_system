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

  // If transitioning to WON, auto-create commission in a transaction.
  // TOCTOU: the `existing.status !== "WON"` check at the route level
  // runs BEFORE the tx; two concurrent PATCH requests both see
  // status=APPROVED, both enter the tx, both create a commission row.
  // Gate the transition itself with `updateMany({ where: { id,
  // status: not WON } })` — only the race winner sees count=1 and
  // proceeds to write the commission; loser bails out cleanly.
  if (status === "WON" && existing.status !== "WON") {
    const result = await db.$transaction(async (tx) => {
      const winner = await tx.partnerDeal.updateMany({
        where: { id, status: { not: "WON" }, deletedAt: null },
        data: { status: "WON", wonAt: new Date(), value, notes },
      });
      if (winner.count === 0) {
        // Another request already flipped this deal to WON; bail.
        return null;
      }

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

      return tx.partnerDeal.findUnique({
        where: { id },
        include: {
          client: { select: { id: true, name: true } },
          service: { select: { id: true, name: true } },
        },
      });
    });

    if (!result) {
      return jsonError("Deal already marked as WON", 409);
    }
    return jsonSuccess(result);
  }

  // Normal update (non-WON transition)
  // audit v12 MEDIUM (MED-47) recheck — block value/status mutations on WON deals to
  // prevent stale commission amounts and orphaned commission rows from status reversals.
  if (existing.status === "WON") {
    if (value !== undefined || (status && status !== "WON")) {
      return jsonError(
        "Cannot change value or status of a WON deal after commission has been created",
        400
      );
    }
  }

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
