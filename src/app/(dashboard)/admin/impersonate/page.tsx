import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ImpersonateClient } from "./client";

/**
 * Tier-1 #30 — admin "act as" / impersonation. Lists every user in
 * the platform; clicking one starts an impersonation session.
 *
 * Gate: super_admin only.
 */
export const dynamic = "force-dynamic";

export default async function ImpersonatePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const isPlatformAdmin =
    !!session.user.hrRoles?.includes("super_admin") ||
    (!!session.user.modules?.includes("partners") && !session.user.partnerId);
  if (!isPlatformAdmin) {
    return <div className="p-6 text-destructive">Unauthorized</div>;
  }

  const [users, recent] = await Promise.all([
    db.user.findMany({
      where: { id: { not: session.user.id } },
      select: {
        id: true,
        email: true,
        name: true,
        hrAccess: true,
        crmAccess: true,
        partnersAccess: true,
      },
      orderBy: { email: "asc" },
      take: 2000, // audit v12 LOW (LOW-11): raised from 200 so all users are reachable
    }),
    db.crmImpersonationAudit.findMany({
      orderBy: { at: "desc" },
      take: 20,
    }),
  ]);

  return (
    <ImpersonateClient
      users={JSON.parse(JSON.stringify(users))}
      recent={JSON.parse(JSON.stringify(recent))}
    />
  );
}
