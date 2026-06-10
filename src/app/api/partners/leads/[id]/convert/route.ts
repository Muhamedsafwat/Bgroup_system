import { db } from "@/lib/db";
import { requirePartnerAuth, assertAccess, jsonSuccess, jsonError } from "@/lib/partners/helpers";
import { convertLeadSchema } from "@/lib/partners/validations";
import { NextRequest } from "next/server";

// POST /api/partners/leads/[id]/convert — Convert lead to client
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, error } = await requirePartnerAuth();
  if (error) return error;

  const { id } = await params;
  const lead = await db.partnerLead.findUnique({ where: { id } });
  if (!lead || !assertAccess(user, lead.partnerId)) {
    return jsonError("Lead not found", 404);
  }

  // audit v12 MEDIUM (MED-46): fast-path hint only — atomic check is inside the transaction
  if (lead.convertedToClientId) {
    return jsonError("Lead already converted", 400);
  }

  const body = await request.json();
  const parsed = convertLeadSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0].message, 400);
  }

  let client;
  try {
    client = await db.$transaction(async (tx) => {
      const newClient = await tx.partnerClient.create({
        data: {
          partnerId: lead.partnerId,
          name: parsed.data.name || lead.name,
          email: parsed.data.email || lead.email,
          phone: parsed.data.phone || lead.phone,
          company: parsed.data.company || lead.company,
        },
      });

      // audit v12 MEDIUM (MED-46): conditional update guards against concurrent conversions —
      // only succeeds when convertedToClientId is still null, preventing duplicate clients
      const updated = await tx.partnerLead.updateMany({
        where: { id, convertedToClientId: null },
        data: { status: "QUALIFIED", convertedToClientId: newClient.id },
      });
      if (updated.count === 0) {
        throw new Error("ALREADY_CONVERTED");
      }

      return newClient;
    });
  } catch (err) {
    if (err instanceof Error && err.message === "ALREADY_CONVERTED") {
      return jsonError("Lead already converted", 400);
    }
    throw err;
  }

  return jsonSuccess(client, 201);
}
