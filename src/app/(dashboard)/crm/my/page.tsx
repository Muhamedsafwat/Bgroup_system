import { getRequiredSession } from "@/lib/crm/session";
import { getServerT } from "@/lib/i18n/server";
import { getMyDashboardData } from "./data";
import { MyDashboardClient } from "@/components/crm/dashboard/MyDashboardClient";
import { WelcomeBanner } from "@/components/shared/WelcomeHero";
import { firstNameOf } from "@/lib/welcome";

export default async function MyDashboardPage() {
  const session = await getRequiredSession();
  const { locale } = await getServerT();
  const data = await getMyDashboardData(session);

  const crmRole = session.role;
  const rolePill =
    crmRole === "ACCOUNT_MGR" ? "Account manager" :
    crmRole === "MANAGER" ? "Sales manager" :
    crmRole === "ASSISTANT" ? "Assistant" :
    crmRole === "ADMIN" ? "CRM admin" :
    "Sales rep";

  return (
    <div className="space-y-6">
      <WelcomeBanner
        firstName={firstNameOf(session.fullName, session.email)}
        rolePill={rolePill}
        pillTone="sky"
        email={session.email}
        subtitle="Today’s calls, meetings, and open pipeline"
      />
      <MyDashboardClient
        data={JSON.parse(JSON.stringify(data))}
        locale={locale}
      />
    </div>
  );
}
