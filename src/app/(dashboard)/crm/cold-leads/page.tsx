import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ColdLeadsClient } from "./client";

/**
 * Cold-leads directory. ADMINs see the org-wide pool; MANAGERs see their
 * team's pool + the unassigned bucket; REPs see their own queue.
 *
 * Filters (industry / category / location), bucket tabs (NEW / ASSIGNED /
 * NO_ANSWER / WAITING_LIST / NOT_INTERESTED / CONVERTED / ARCHIVED), import
 * button, and distribute action all live in the client component below.
 */
export const dynamic = "force-dynamic";

export default async function ColdLeadsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.modules?.includes("crm")) redirect("/");

  const role = session.user.crmRole;
  const isManagerOrAdmin = role === "ADMIN" || role === "MANAGER";

  // Manager / admin needs the rep list for the distribute dropdown. Reps
  // never see this widget so we skip the fetch for them.
  const reps = isManagerOrAdmin
    ? await db.crmUserProfile.findMany({
        where:
          role === "ADMIN"
            ? { active: true, role: { in: ["REP", "ACCOUNT_MGR"] } }
            : {
                active: true,
                role: { in: ["REP", "ACCOUNT_MGR"] },
                managerId: session.user.crmProfileId,
              },
        select: { id: true, fullName: true, fullNameAr: true },
        orderBy: { fullName: "asc" },
      })
    : [];

  return (
    <ColdLeadsClient
      isManagerOrAdmin={isManagerOrAdmin}
      reps={JSON.parse(JSON.stringify(reps))}
    />
  );
}
