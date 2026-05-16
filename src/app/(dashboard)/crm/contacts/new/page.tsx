import { getRequiredSession } from "@/lib/crm/session";
import { db } from "@/lib/db";
import { scopeCompanyByRole } from "@/lib/crm/rbac";
import { ContactForm } from "@/components/crm/contacts/ContactForm";
import { NewContactCompanyPicker } from "./company-picker";

/**
 * `/crm/contacts/new` — sidebar shortcut to "New contact". Contacts are
 * always attached to a company, so we either:
 *   - render the create form prefilled when the caller passes `?companyId=…`
 *     (deep-link from a company detail page), or
 *   - show an in-page company picker that hops to the same route with the id
 *     attached. Picking a company is a one-click step, no form pre-step.
 */
export default async function NewContactPage({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string }>;
}) {
  const session = await getRequiredSession();
  const { companyId } = await searchParams;

  if (companyId) {
    // Verify the caller actually has access to the company before letting
    // them attach a contact. Reps shouldn't be able to drop a contact onto
    // a company outside their scope by guessing the id in the URL.
    const company = await db.crmCompany.findFirst({
      where: { id: companyId, ...scopeCompanyByRole(session) },
      select: { id: true, nameEn: true, nameAr: true },
    });
    if (!company) {
      return (
        <div className="max-w-2xl mx-auto py-12 text-center">
          <p className="text-sm text-muted-foreground">
            That company isn&apos;t in your scope. Pick one from the list below.
          </p>
        </div>
      );
    }
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="text-sm text-muted-foreground">
          Adding a contact to <span className="font-medium text-foreground">{company.nameEn}</span>
        </div>
        <ContactForm companyId={company.id} />
      </div>
    );
  }

  // No companyId in the URL — show a picker. Reuse the scoped company list
  // so reps only see companies they can attach contacts to.
  const companies = await db.crmCompany.findMany({
    where: scopeCompanyByRole(session),
    select: { id: true, nameEn: true, nameAr: true },
    orderBy: { nameEn: "asc" },
    take: 500,
  });

  return (
    <div className="max-w-2xl mx-auto py-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">New contact</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Pick the company this contact belongs to. You can change the rest in the next step.
        </p>
      </div>
      <NewContactCompanyPicker companies={JSON.parse(JSON.stringify(companies))} />
    </div>
  );
}
