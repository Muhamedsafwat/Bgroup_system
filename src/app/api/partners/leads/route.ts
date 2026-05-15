import { db } from "@/lib/db";
import { requirePartnerAuth, getPaginationParams, jsonPaginated, jsonSuccess, jsonError } from "@/lib/partners/helpers";
import { createLeadSchema } from "@/lib/partners/validations";
import { NextRequest } from "next/server";

// GET /api/partners/leads — List leads (admin: all, partner: own)
export async function GET(request: NextRequest) {
  const { user, error } = await requirePartnerAuth();
  if (error) return error;

  const pagination = getPaginationParams(request.nextUrl.searchParams);
  const where = user.isAdmin
    ? { deletedAt: null }
    : { partnerId: user.partnerId!, deletedAt: null };

  const [data, total] = await Promise.all([
    db.partnerLead.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: { createdAt: "desc" },
    }),
    db.partnerLead.count({ where }),
  ]);

  return jsonPaginated(data, total, pagination);
}

// POST /api/partners/leads — Partner: create lead
export async function POST(request: NextRequest) {
  const { user, error } = await requirePartnerAuth();
  if (error) return error;

  if (!user.partnerId) {
    return jsonError("Partner profile required", 403);
  }

  const body = await request.json();
  const parsed = createLeadSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0].message, 400);
  }

  const lead = await db.partnerLead.create({
    data: { ...parsed.data, partnerId: user.partnerId },
  });

  return jsonSuccess(lead, 201);
}
