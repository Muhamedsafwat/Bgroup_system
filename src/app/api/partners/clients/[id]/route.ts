import { db } from "@/lib/db";
import { requirePartnerAuth, assertAccess, jsonSuccess, jsonError } from "@/lib/partners/helpers";
import { updateClientSchema } from "@/lib/partners/validations";
import { NextRequest } from "next/server";

// GET /api/partners/clients/[id]
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, error } = await requirePartnerAuth();
  if (error) return error;

  const { id } = await params;
  const client = await db.partnerClient.findFirst({
    where: { id, deletedAt: null },
    include: { convertedFromLead: { select: { id: true, name: true } } },
  });
  if (!client || !assertAccess(user, client.partnerId)) {
    return jsonError("Client not found", 404);
  }

  return jsonSuccess(client);
}

// PATCH /api/partners/clients/[id]
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, error } = await requirePartnerAuth();
  if (error) return error;

  const { id } = await params;
  const existing = await db.partnerClient.findFirst({ where: { id, deletedAt: null } });
  if (!existing || !assertAccess(user, existing.partnerId)) {
    return jsonError("Client not found", 404);
  }

  const body = await request.json();
  const parsed = updateClientSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0].message, 400);
  }

  const updated = await db.partnerClient.update({
    where: { id },
    data: parsed.data,
  });

  return jsonSuccess(updated);
}

// DELETE /api/partners/clients/[id] — soft-delete.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, error } = await requirePartnerAuth();
  if (error) return error;

  const { id } = await params;
  const existing = await db.partnerClient.findFirst({ where: { id, deletedAt: null } });
  if (!existing || !assertAccess(user, existing.partnerId)) {
    return jsonError("Client not found", 404);
  }

  await db.partnerClient.update({
    where: { id },
    data: { deletedAt: new Date(), deletedById: user.userId },
  });
  return jsonSuccess({ message: "Client deleted" });
}
