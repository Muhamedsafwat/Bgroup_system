import { notFound, redirect } from "next/navigation";
import { getRequiredSession } from "@/lib/crm/session";
import { getServerT } from "@/lib/i18n/server";
import { getEntities, getLeadSources, getOpportunity } from "../../actions";
import { db } from "@/lib/db";
import { OpportunityForm } from "@/components/crm/opportunities/OpportunityForm";

type OppRaw = NonNullable<Awaited<ReturnType<typeof getOpportunity>>>;

export default async function EditOpportunityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getRequiredSession();
  const { t, locale } = await getServerT();

  const opp: OppRaw | null = await getOpportunity(id);
  if (!opp) notFound();

  // Only the owner or an ADMIN can edit. The detail page already hides the
  // Edit button for everyone else, but block direct URL access too.
  if (opp.ownerId !== session.id && session.role !== "ADMIN") {
    redirect(`/crm/opportunities/${id}`);
  }

  const [entities, leadSources, companies, products] = await Promise.all([
    getEntities(),
    getLeadSources(),
    db.crmCompany.findMany({
      select: { id: true, nameEn: true, nameAr: true },
      orderBy: { nameEn: "asc" },
      take: 100,
    }),
    db.crmProduct.findMany({
      where: { active: true },
      select: {
        id: true,
        code: true,
        nameEn: true,
        nameAr: true,
        entityId: true,
        basePrice: true,
        currency: true,
      },
      orderBy: { code: "asc" },
    }),
  ]);

  const initial = {
    id: opp.id,
    companyId: opp.companyId,
    primaryContactId: opp.primaryContactId,
    entityId: opp.entityId,
    title: opp.title,
    priority: opp.priority,
    leadSource: opp.leadSource,
    dealType: opp.dealType,
    estimatedValue: Number(opp.estimatedValue),
    currency: opp.currency,
    expectedCloseDate: opp.expectedCloseDate
      ? new Date(opp.expectedCloseDate).toISOString().split("T")[0]
      : undefined,
    nextAction: opp.nextAction,
    nextActionText: opp.nextActionText,
    nextActionDate: opp.nextActionDate
      ? new Date(opp.nextActionDate).toISOString().split("T")[0]
      : undefined,
    description: opp.description,
    techRequirements: opp.techRequirements,
    productIds: (opp.products ?? []).map((p: { productId: string }) => p.productId),
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">
        {t.common.edit} · {opp.code}
      </h1>
      <OpportunityForm
        entities={JSON.parse(JSON.stringify(entities))}
        leadSources={JSON.parse(JSON.stringify(leadSources))}
        companies={JSON.parse(JSON.stringify(companies))}
        products={JSON.parse(JSON.stringify(products))}
        userEntityId={session.entityId}
        locale={locale}
        initial={JSON.parse(JSON.stringify(initial))}
      />
    </div>
  );
}
