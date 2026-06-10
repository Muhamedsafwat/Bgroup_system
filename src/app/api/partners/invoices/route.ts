import { db } from "@/lib/db";
import { requirePartnerAuth, getPaginationParams, jsonPaginated, jsonSuccess, jsonError } from "@/lib/partners/helpers";
import { requestInvoiceSchema } from "@/lib/partners/validations";
import { NextRequest } from "next/server";

// GET /api/partners/invoices — List invoices (admin: all, partner: own)
export async function GET(request: NextRequest) {
  const { user, error } = await requirePartnerAuth();
  if (error) return error;

  const pagination = getPaginationParams(request.nextUrl.searchParams);
  const where = user.isAdmin ? {} : { partnerId: user.partnerId! };

  const [data, total] = await Promise.all([
    db.partnerInvoice.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: { createdAt: "desc" },
      include: {
        deal: {
          select: {
            id: true,
            value: true,
            client: { select: { id: true, name: true } },
            service: { select: { id: true, name: true } },
          },
        },
      },
    }),
    db.partnerInvoice.count({ where }),
  ]);

  return jsonPaginated(data, total, pagination);
}

// POST /api/partners/invoices — Partner: request invoice for a WON deal
export async function POST(request: NextRequest) {
  const { user, error } = await requirePartnerAuth();
  if (error) return error;

  if (!user.partnerId) {
    return jsonError("Partner profile required", 403);
  }

  const body = await request.json();
  const parsed = requestInvoiceSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0].message, 400);
  }

  const deal = await db.partnerDeal.findUnique({ where: { id: parsed.data.dealId } });
  if (!deal || deal.partnerId !== user.partnerId) {
    return jsonError("Deal not found", 404);
  }

  if (deal.status !== "WON") {
    return jsonError("Invoices can only be requested for won deals", 400);
  }

  // audit v12 MEDIUM (MED-64): capture resolved amount and ensure it does not exceed deal value
  const requestedAmount = parsed.data.amount ?? deal.value;
  if (requestedAmount > deal.value) {
    return jsonError("Invoice amount cannot exceed deal value", 400);
  }

  const invoice = await db.partnerInvoice.create({
    data: {
      partnerId: user.partnerId,
      dealId: deal.id,
      amount: requestedAmount,
    },
    include: {
      deal: {
        select: {
          id: true,
          value: true,
          client: { select: { id: true, name: true } },
        },
      },
    },
  });

  return jsonSuccess(invoice, 201);
}
