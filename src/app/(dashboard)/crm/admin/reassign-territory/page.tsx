import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ReassignTerritoryClient } from "./client";

/**
 * Tier-0 #7 — bulk territory reassignment wizard. Three-step flow:
 *   1. pick source rep (one)
 *   2. pick destination rep(s) (one or more for round-robin)
 *   3. preview impact + commit
 *
 * Page just gates + fetches the rep roster; the wizard logic + state
 * lives in the client.
 */
export const dynamic = "force-dynamic";

export default async function ReassignTerritoryPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const role = session.user.crmRole;
  const platformAdmin =
    !!session.user.hrRoles?.includes("super_admin") ||
    (!!session.user.modules?.includes("partners") && !session.user.partnerId);
  if (!platformAdmin && role !== "ADMIN" && role !== "MANAGER") {
    redirect("/crm/my");
  }

  const reps = await db.crmUserProfile.findMany({
    where: { active: true },
    select: { id: true, fullName: true, role: true },
    orderBy: { fullName: "asc" },
  });

  return <ReassignTerritoryClient reps={JSON.parse(JSON.stringify(reps))} />;
}
