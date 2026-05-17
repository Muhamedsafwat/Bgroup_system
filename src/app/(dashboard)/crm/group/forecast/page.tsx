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
  const isAdminOrManager = session.role === "ADMIN" || session.role === "MANAGER";

  return (
    <ForecastPageClient
      data={JSON.parse(JSON.stringify(data))}
      locale={locale}
      showDetail={isAdminOrManager}
    />
  );
}
