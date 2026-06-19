import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createOpportunity } from "@/app/(dashboard)/crm/opportunities/actions";
import { describeZodError } from "@/lib/zod-errors";
import { isManagerOrAdmin } from "@/lib/crm/admin-gates";

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
    { const __z = describeZodError(parsed.error); return NextResponse.json({ error: __z.message, fieldErrors: __z.fieldErrors }, { status: 422 }); }
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

  if (
    lead.assignedToId !== session.user.crmProfileId &&
    !isManagerOrAdmin(session as Session)
  ) {
    return NextResponse.json({ error: "This lead isn't assigned to you" }, { status: 403 });
  }

  // Find-or-create the company. Match by exact nameEn (case-insensitive) so
  // a "company already in CRM" doesn't get duplicated by this flow.
  const companyName = (lead.companyName || lead.name).trim();
  let company = await db.crmCompany.findFirst({
    where: { nameEn: { equals: companyName, mode: "insensitive" } },
    select: { id: true },
  });
  let companyWasCreated = false; // audit v12 MEDIUM (MED-8): track so we can clean up on TOCTOU loser path
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
    companyWasCreated = true;
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
    // title is required now (the company step was removed from the form).
    // Derive it from the prospect company + the lead's name when they
    // differ, which keeps it unique across multiple contacts at the same
    // company. Mirrors the prior behaviour where title fell back to the
    // company name.
    title:
      lead.name && lead.name !== companyName
        ? `${companyName} — ${lead.name}`
        : companyName,
    customerCompanyName: companyName,
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

  // Atomic link with TOCTOU guard. Two concurrent POSTs both see
  // `convertedOpportunityId: null` upstream, both create a Company +
  // Contact + Opportunity. The race winner here flips the lead in
  // a single statement gated on `convertedOpportunityId: null`; the
  // loser's updateMany returns count=0, and we soft-archive the
  // duplicate opp via deletedAt so the audit trail records the
  // collision without breaking visibility.
  const linkResult = await db.crmColdLead.updateMany({
    where: { id, convertedOpportunityId: null },
    data: {
      status: "CONVERTED",
      convertedOpportunityId: opp.id,
      lastDispositionAt: new Date(),
    },
  });
  if (linkResult.count === 0) {
    // Another request already linked this lead. Soft-delete the
    // duplicate opportunity so it doesn't pollute pipeline reports.
    await db.crmOpportunity.update({
      where: { id: opp.id },
      data: {
        deletedAt: new Date(),
        deletedById: session.user.crmProfileId,
      },
    });
    // audit v12 MEDIUM (MED-8): clean up orphaned contact and company created by
    // this losing request so they don't linger as unreferenced records.
    if (contactId) {
      await db.crmContact.delete({ where: { id: contactId } });
    }
    if (companyWasCreated) {
      // Only delete the newly created company if nothing else references it now.
      const refs = await db.crmContact.count({ where: { companyId: company.id } });
      if (refs === 0) {
        await db.crmCompany.delete({ where: { id: company.id } });
      }
    }
    const winner = await db.crmColdLead.findUnique({
      where: { id },
      select: { convertedOpportunityId: true },
    });
    return NextResponse.json(
      {
        error: "Already converted",
        opportunityId: winner?.convertedOpportunityId,
      },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true, opportunityId: opp.id });
}
