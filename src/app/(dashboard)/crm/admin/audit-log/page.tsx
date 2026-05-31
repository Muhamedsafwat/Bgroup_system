import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AuditLogClient } from "./client";

/**
 * Tier-0 #8 — cross-table CRM audit feed. Manager + admin only.
 * Merges CrmActivityLog + CrmStageHistory + CrmColdLeadDisposition.
 */
export const dynamic = "force-dynamic";

export default async function AuditLogPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const role = session.user.crmRole;
  const platformAdmin =
    !!session.user.hrRoles?.includes("super_admin") ||
    (!!session.user.modules?.includes("partners") && !session.user.partnerId);
  if (!platformAdmin && role !== "ADMIN" && role !== "MANAGER") {
    redirect("/crm/my");
  }
  return <AuditLogClient />;
}
