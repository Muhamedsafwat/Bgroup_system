import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { DashboardsClient } from "./client";

export const dynamic = "force-dynamic";

export default async function DashboardsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // Dashboards are owner-scoped; any CRM user can manage their own.
  // But the admin page lives under /crm/admin/* so the sidebar wires
  // it up alongside the other admin tools.
  if (!session.user.modules?.includes("crm")) {
    return <div className="p-6 text-destructive">Unauthorized</div>;
  }
  return <DashboardsClient />;
}
