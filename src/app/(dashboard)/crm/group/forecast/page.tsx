import { getRequiredSession } from "@/lib/crm/session";
import { getServerT } from "@/lib/i18n/server";
import { getGroupDashboardData } from "../data";
import { ForecastPageClient } from "@/components/crm/dashboard/ForecastPageClient";

export default async function ForecastPage() {
  const session = await getRequiredSession();
  const { locale } = await getServerT();
  const data = await getGroupDashboardData(session);
  // Admins and managers get the full detail view; reps see only their own
  // numbers and don't need the per-rep leaderboard or per-stage roll-up.
  // audit v12 MEDIUM (MED-35): also grant detail view to super_admin users
  // who have no CrmRole but must see the full team forecast.
  const isAdminOrManager =
    session.role === "ADMIN" ||
    session.role === "MANAGER" ||
    !!session.isSuperAdmin;

  return (
    <ForecastPageClient
      data={JSON.parse(JSON.stringify(data))}
      locale={locale}
      showDetail={isAdminOrManager}
    />
  );
}
