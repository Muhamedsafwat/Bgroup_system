import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { LossAnalyticsClient } from "./client";

/**
 * Tier-0 #4 — loss-reason analytics page. Manager + admin only;
 * REPs have a separate per-deal loss debrief flow.
 */
export const dynamic = "force-dynamic";

export default async function LossAnalyticsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const role = session.user.crmRole;
  const platformAdmin =
    !!session.user.hrRoles?.includes("super_admin") ||
    (!!session.user.modules?.includes("partners") && !session.user.partnerId);
  if (!platformAdmin && role !== "ADMIN" && role !== "MANAGER") {
    redirect("/crm/my");
  }
  return <LossAnalyticsClient />;
}
