import { getRequiredSession } from "@/lib/crm/session";
import { getServerT } from "@/lib/i18n/server";
import { getEntities, getLeadSources } from "../actions";
import { db } from "@/lib/db";
import { OpportunityForm } from "@/components/crm/opportunities/OpportunityForm";

export default async function NewOpportunityPage() {
  const session = await getRequiredSession();
  const { t, locale } = await getServerT();

  // MANAGER/ADMIN get the rep list so the form can render the "Assign to"
  // picker — that's the "act as the rep" workflow. For REPs we skip the
  // query entirely so a regular rep can't even see the dropdown.
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
      select: { id: true, code: true, nameEn: true, nameAr: true, entityId: true, basePrice: true, currency: true },
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

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">{t.common.newOpportunity}</h1>
      <OpportunityForm
        entities={JSON.parse(JSON.stringify(entities))}
        leadSources={JSON.parse(JSON.stringify(leadSources))}
        companies={JSON.parse(JSON.stringify(companies))}
        products={JSON.parse(JSON.stringify(products))}
        userEntityId={session.entityId}
        locale={locale}
        reps={canActAsRep ? JSON.parse(JSON.stringify(reps)) : undefined}
        currentUserId={session.id}
      />
    </div>
  );
}
