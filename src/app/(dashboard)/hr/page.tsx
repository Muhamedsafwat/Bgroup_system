import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * /hr index — role-aware redirect. Without this the bare /hr URL
 * 404'd. Managers / leadership land on the dashboard; everyone else
 * goes to the employee home (their personal page).
 */
export default async function HrLanding() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.modules?.includes("hr")) redirect("/");
  const hrRoles = session.user.hrRoles ?? [];
  const isManager = hrRoles.some((r) =>
    ["super_admin", "hr_manager", "ceo", "accountant", "team_lead"].includes(r),
  );
  redirect(isManager ? "/hr/dashboard" : "/hr/employee/home");
}
