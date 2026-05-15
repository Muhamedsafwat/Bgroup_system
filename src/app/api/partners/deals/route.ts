import { db } from "@/lib/db";
import { requirePartnerAuth, getPaginationParams, jsonPaginated, jsonSuccess, jsonError } from "@/lib/partners/helpers";
import { createDealSchema } from "@/lib/partners/validations";
import { NextRequest } from "next/server";

// GET /api/partners/deals — List deals (admin: all, partner: own)
export async function GET(request: NextRequest) {
  const { user, error } = await requirePartnerAuth();
  if (error) return error;

  const pagination = getPaginationParams(request.nextUrl.searchParams);
  const where = user.isAdmin
    ? { deletedAt: null }
    : { partnerId: user.partnerId!, deletedAt: null };

  const [data, total] = await Promise.all([
    db.partnerDeal.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: { createdAt: "desc" },
      include: {
        client: { select: { id: true, name: true } },
        service: { select: { id: true, name: true } },
      },
    }),
    db.partnerDeal.count({ where }),
  ]);

  return jsonPaginated(data, total, pagination);
}

// POST /api/partners/deals — Partner: create deal
export async function POST(request: NextRequest) {
  const { user, error } = await requirePartnerAuth();
  if (error) return error;

  if (!user.partnerId) {
    return jsonError("Partner profile required", 403);
  }

  const body = await request.json();
  const parsed = createDealSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0].message, 400);
  }

  const { clientId, serviceId, value, notes } = parsed.data;

  // Validate client belongs to partner
  const client = await db.partnerClient.findUnique({ where: { id: clientId } });
  if (!client || client.partnerId !== user.partnerId) {
    return jsonError("Client not found", 404);
  }

  // Validate service exists and is active
  const service = await db.partnerService.findUnique({ where: { id: serviceId } });
  if (!service || !service.isActive) {
    return jsonError("Service not found or inactive", 404);
  }

  const deal = await db.partnerDeal.create({
    data: { partnerId: user.partnerId, clientId, serviceId, value, notes },
    include: {
      client: { select: { id: true, name: true } },
      service: { select: { id: true, name: true } },
    },
  });

  return jsonSuccess(deal, 201);
}
