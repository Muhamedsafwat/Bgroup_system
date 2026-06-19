import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { SalesReportClient } from "./client";

export const dynamic = "force-dynamic";

/**
 * Manager / admin sales report. Date filter + KPI preview + Excel
 * download. Page-level role gate matches the export endpoint:
 * MANAGER + ADMIN + super-admin only.
 */
export default async function SalesReportPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const role = session.user.crmRole;
  const platformAdmin =
    !!session.user.hrRoles?.includes("super_admin") ||
    (!!session.user.modules?.includes("partners") && !session.user.partnerId);
  // user-feature 2026-06-18: ADMIN-only — MANAGER (team lead) removed.
  if (!platformAdmin && role !== "ADMIN") {
    redirect("/crm/my");
  }
  return <SalesReportClient />;
}
