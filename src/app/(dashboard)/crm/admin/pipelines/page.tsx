import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { PipelinesClient } from "./client";

export const dynamic = "force-dynamic";

export default async function PipelinesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const role = session.user.crmRole;
  const platformAdmin =
    !!session.user.hrRoles?.includes("super_admin") ||
    (!!session.user.modules?.includes("partners") && !session.user.partnerId);
  if (!platformAdmin && role !== "ADMIN") {
    return <div className="p-6 text-destructive">Unauthorized</div>;
  }
  return <PipelinesClient />;
}
