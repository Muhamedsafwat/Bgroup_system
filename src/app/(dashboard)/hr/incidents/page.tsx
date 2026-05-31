import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * /hr/incidents — managers see the full list, employees go to the
 * submit form (their primary touch-point with incidents).
 */
export default async function HrIncidentsLanding() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const hrRoles = session.user.hrRoles ?? [];
  const canSeeAll = hrRoles.some((r) =>
    ["super_admin", "hr_manager", "team_lead", "ceo"].includes(r),
  );
  redirect(canSeeAll ? "/hr/incidents/all" : "/hr/incidents/submit");
}
