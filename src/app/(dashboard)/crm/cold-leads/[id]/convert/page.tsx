import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ConvertColdLeadClient } from "./client";

/**
 * Cold-lead → opportunity conversion. Renders the OpportunityForm pre-seeded
 * with the lead's data so the rep can fill in deal-specific fields (entity,
 * value, expected close) without retyping the prospect info.
 */
export default async function ConvertColdLeadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id || !session.user.crmProfileId) redirect("/login");
  const { id } = await params;

  const lead = await db.crmColdLead.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      companyName: true,
      phone: true,
      email: true,
      notes: true,
      status: true,
      assignedToId: true,
      convertedOpportunityId: true,
    },
  });
  if (!lead) notFound();

  // Only the assigned rep, a manager, or an admin can convert.
  const role = session.user.crmRole;
  const isManagerOrAdmin = role === "ADMIN" || role === "MANAGER";
  if (lead.assignedToId !== session.user.crmProfileId && !isManagerOrAdmin) {
    redirect("/crm/cold-leads");
  }
  if (lead.convertedOpportunityId) {
    redirect(`/crm/opportunities/${lead.convertedOpportunityId}`);
  }

  const [entities, products] = await Promise.all([
    db.crmEntity.findMany({
      where: { active: true },
      select: { id: true, code: true, nameEn: true, nameAr: true },
      orderBy: { code: "asc" },
    }),
    db.crmProduct.findMany({
      where: { active: true },
      select: { id: true, code: true, nameEn: true, nameAr: true, entityId: true, basePrice: true, currency: true },
      orderBy: { code: "asc" },
      take: 200,
    }),
  ]);

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Convert lead</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Promote <span className="font-medium text-foreground">{lead.name}</span>
          {lead.companyName ? ` (${lead.companyName})` : ""} into an opportunity.
          A company + contact will be created automatically if they don&apos;t already exist.
        </p>
      </div>
      <ConvertColdLeadClient
        leadId={lead.id}
        leadName={lead.name}
        entities={JSON.parse(JSON.stringify(entities))}
        products={JSON.parse(JSON.stringify(products))}
        defaultEntityId={session.user.crmEntityId ?? entities[0]?.id ?? ""}
      />
    </div>
  );
}
