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

  // Edit is allowed for: the owner, ADMIN, and MANAGER. Managers run the
  // whole sales floor and need to edit any opp (used to be ADMIN-only,
  // which forced managers to bounce through the bulk transfer endpoint
  // to do simple stuff like fix a typo on another rep's deal).
  const canEdit =
    opp.ownerId === session.id || session.role === "ADMIN" || session.role === "MANAGER";
  if (!canEdit) {
    redirect(`/crm/opportunities/${id}`);
  }

  const canActAsRep = session.role === "MANAGER" || session.role === "ADMIN";

  const [entities, leadSources, companies, products, reps] = await Promise.all([
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
    canActAsRep
      ? db.crmUserProfile.findMany({
          where: { active: true, role: { in: ["REP", "ACCOUNT_MGR", "MANAGER", "ADMIN"] } },
          select: { id: true, fullName: true, fullNameAr: true, role: true },
          orderBy: { fullName: "asc" },
        })
      : Promise.resolve([]),
  ]);

  const initial = {
    id: opp.id,
    // Prefer the modern free-text field; fall back to the legacy linked
    // CrmCompany.nameEn so opps created before the schema change still
    // render meaningfully in edit mode.
    customerCompanyName: opp.customerCompanyName ?? opp.company?.nameEn ?? "",
    customerContactName: opp.customerContactName,
    customerContactPhone: opp.customerContactPhone,
    customerContactEmail: opp.customerContactEmail,
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
    contacts: (opp.contacts ?? []).map(
      (c: { id: string; name: string; role: string | null; phone: string | null; email: string | null }) => ({
        id: c.id,
        name: c.name,
        role: c.role,
        phone: c.phone,
        email: c.email,
      })
    ),
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
        reps={canActAsRep ? JSON.parse(JSON.stringify(reps)) : undefined}
        currentUserId={session.id}
        currentOwnerId={opp.ownerId}
      />
    </div>
  );
}
