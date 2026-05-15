import { db } from "@/lib/db";
import { requirePartnerAuth, getPaginationParams, jsonPaginated, jsonSuccess, jsonError } from "@/lib/partners/helpers";
import { createClientSchema } from "@/lib/partners/validations";
import { NextRequest } from "next/server";

// GET /api/partners/clients — List clients (admin: all, partner: own)
export async function GET(request: NextRequest) {
  const { user, error } = await requirePartnerAuth();
  if (error) return error;

  const pagination = getPaginationParams(request.nextUrl.searchParams);
  const where = user.isAdmin
    ? { deletedAt: null }
    : { partnerId: user.partnerId!, deletedAt: null };

  const [data, total] = await Promise.all([
    db.partnerClient.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: { createdAt: "desc" },
      include: { convertedFromLead: { select: { id: true, name: true } } },
    }),
    db.partnerClient.count({ where }),
  ]);

  return jsonPaginated(data, total, pagination);
}

// POST /api/partners/clients — Partner: create client
export async function POST(request: NextRequest) {
  const { user, error } = await requirePartnerAuth();
  if (error) return error;

  if (!user.partnerId) {
    return jsonError("Partner profile required", 403);
  }

  const body = await request.json();
  const parsed = createClientSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0].message, 400);
  }

  const client = await db.partnerClient.create({
    data: { ...parsed.data, partnerId: user.partnerId },
  });

  return jsonSuccess(client, 201);
}
