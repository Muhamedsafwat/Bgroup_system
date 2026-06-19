import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AuditLogClient } from "./client";

/**
 * Tier-0 #8 — cross-table CRM audit feed. ADMIN-only (user-feature
 * 2026-06-18: team leads / MANAGERs no longer see the audit log).
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
  // user-feature 2026-06-18: ADMIN-only — MANAGER (team lead) removed.
  if (!platformAdmin && role !== "ADMIN") {
    redirect("/crm/my");
  }
  return <AuditLogClient />;
}
