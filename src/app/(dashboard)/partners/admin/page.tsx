import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { SectionLanding } from "@/components/layout/SectionLanding";
import { Users, FileText, Receipt, DollarSign, ClipboardList } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function PartnersAdminLanding() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // The proxy already gates /partners/admin to platform-admin only,
  // but we double-check here so a missing rule doesn't silently leak.
  const platformAdmin =
    !!session.user.hrRoles?.includes("super_admin") ||
    (!!session.user.modules?.includes("partners") && !session.user.partnerId);
  if (!platformAdmin) redirect("/partners/dashboard");

  return (
    <SectionLanding
      title="Partners admin"
      description="Manage every partner's commercial relationship."
      groups={[
        {
          links: [
            {
              href: "/partners/admin/partners",
              title: "Partners",
              description: "The partner directory.",
              icon: Users,
            },
            {
              href: "/partners/admin/contracts",
              title: "Contracts",
              description: "Commercial agreements.",
              icon: FileText,
            },
            {
              href: "/partners/admin/invoices",
              title: "Invoices",
              description: "Approve and track payments.",
              icon: Receipt,
            },
            {
              href: "/partners/admin/commissions",
              title: "Commissions",
              description: "Calculated payouts.",
              icon: DollarSign,
            },
            {
              href: "/partners/admin/audit-logs",
              title: "Audit logs",
              description: "Who changed what, when.",
              icon: ClipboardList,
            },
          ],
        },
      ]}
    />
  );
}
