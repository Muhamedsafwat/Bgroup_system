import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { SalesBoardClient } from "./client";
import { WelcomeBanner } from "@/components/shared/WelcomeHero";
import { firstNameOf } from "@/lib/welcome";

export const dynamic = "force-dynamic";

export default async function CrmSalesBoardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.crmProfileId) redirect("/");

  const crmRole = session.user.crmRole;
  const rolePill =
    crmRole === "MANAGER" ? "Sales manager" :
    crmRole === "ADMIN" ? "CRM admin" :
    "CRM";

  return (
    <div className="space-y-4">
      <WelcomeBanner
        firstName={firstNameOf(session.user.name, session.user.email)}
        rolePill={rolePill}
        pillTone="indigo"
        email={session.user.email}
        subtitle="Pipeline KPIs, per-rep performance, service mix, and meeting health"
      />
      <SalesBoardClient />
    </div>
  );
}
