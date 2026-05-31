import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { SectionLanding } from "@/components/layout/SectionLanding";
import { FileSpreadsheet, FileText } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function HrReportsLanding() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.modules?.includes("hr")) redirect("/");
  return (
    <SectionLanding
      title="HR reports"
      description="Pre-built downloads for finance and ops."
      groups={[
        {
          links: [
            {
              href: "/hr/reports/excel",
              title: "Excel exports",
              description: "Attendance, overtime, payroll, employee directory.",
              icon: FileSpreadsheet,
            },
            {
              href: "/hr/reports/pdf",
              title: "PDF reports",
              description: "Print-ready monthly summaries.",
              icon: FileText,
            },
          ],
        },
      ]}
    />
  );
}
