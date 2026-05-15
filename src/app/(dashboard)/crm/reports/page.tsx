import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { DailyReportsClient } from "./client";

export const dynamic = "force-dynamic";

export default async function CrmReportsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.crmProfileId) redirect("/");

  const isManager =
    session.user.crmRole === "MANAGER" ||
    session.user.crmRole === "ADMIN" ||
    !!session.user.hrRoles?.includes("super_admin");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">
          {isManager ? "Daily reports" : "My daily reports"}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {isManager
            ? "What every rep did each day — calls, meetings booked/held, new leads. Weekly + monthly totals roll up from these rows."
            : "Submit today's activity. Update any past day if you forgot to log."}
        </p>
      </div>
      <DailyReportsClient isManager={isManager} />
    </div>
  );
}
