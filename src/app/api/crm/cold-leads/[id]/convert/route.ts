import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createOpportunity } from "@/app/(dashboard)/crm/opportunities/actions";

/**
 * POST /api/crm/cold-leads/[id]/convert
 *
 * Promote a cold lead into a CrmOpportunity. The rep provides the deal
 * details (estimated value, entity, expected close date, etc.); we create
 * the company if one doesn't exist for the lead's `companyName`, optionally
 * create a contact, then call the regular `createOpportunity` action so the
 * new deal lands in the standard pipeline with the normal stage history.
 *
 * On success we link the lead → opportunity and flip status to CONVERTED so
 * it stops appearing in the rep's call queue.
 */
const schema = z.object({
  entityId: z.string().min(1),
  estimatedValue: z.number().positive(),
  currency: z.enum(["EGP", "USD", "SAR", "AED", "QAR"]).default("EGP"),
  priority: z.enum(["HOT", "WARM", "COLD"]).default("WARM"),
  dealType: z
    .enum(["ONE_TIME", "MONTHLY", "ANNUAL", "SAAS", "MIXED", "RETAINER"])
    .default("ONE_TIME"),
  productIds: z.array(z.string()).optional(),
  notes: z.string().optional(),
  nextActionDate: z.string().min(1),
});

export async function POST(
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
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 422 });
  }

  const lead = await db.crmColdLead.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      companyName: true,
      phone: true,
      email: true,
      assignedToId: true,
      status: true,
      convertedOpportunityId: true,
    },
  });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  if (lead.convertedOpportunityId) {
    return NextResponse.json(
      { error: "Already converted", opportunityId: lead.convertedOpportunityId },
      { status: 409 }
    );
  }

  const role = session.user.crmRole;
  const isManagerOrAdmin = role === "ADMIN" || role === "MANAGER";
  if (lead.assignedToId !== session.user.crmProfileId && !isManagerOrAdmin) {
    return NextResponse.json({ error: "This lead isn't assigned to you" }, { status: 403 });
  }

  // Find-or-create the company. Match by exact nameEn (case-insensitive) so
  // a "company already in CRM" doesn't get duplicated by this flow.
  const companyName = (lead.companyName || lead.name).trim();
  let company = await db.crmCompany.findFirst({
    where: { nameEn: { equals: companyName, mode: "insensitive" } },
    select: { id: true },
  });
  if (!company) {
    const created = await db.crmCompany.create({
      data: {
        nameEn: companyName,
        nameAr: companyName,
        industry: "",
        phone: lead.phone ?? "",
        assignedToId: session.user.crmProfileId,
      },
      select: { id: true },
    });
    company = created;
  }

  // Find-or-create primary contact for this lead.
  let contactId: string | null = null;
  if (lead.name && lead.name !== companyName) {
    const contact = await db.crmContact.create({
      data: {
        companyId: company.id,
        fullName: lead.name,
        phone: lead.phone ?? null,
        email: lead.email ?? null,
        isPrimary: true,
      },
      select: { id: true },
    });
    contactId = contact.id;
  }

  const opp = await createOpportunity({
    companyId: company.id,
    primaryContactId: contactId ?? undefined,
    entityId: parsed.data.entityId,
    estimatedValue: parsed.data.estimatedValue,
    currency: parsed.data.currency,
    priority: parsed.data.priority,
    dealType: parsed.data.dealType,
    nextAction: "FOLLOW_UP",
    nextActionDate: parsed.data.nextActionDate,
    description: parsed.data.notes ?? `Converted from cold lead ${lead.name}`,
    productIds: parsed.data.productIds,
  });

  await db.crmColdLead.update({
    where: { id },
    data: {
      status: "CONVERTED",
      convertedOpportunityId: opp.id,
      lastDispositionAt: new Date(),
    },
  });

  return NextResponse.json({ ok: true, opportunityId: opp.id });
}
