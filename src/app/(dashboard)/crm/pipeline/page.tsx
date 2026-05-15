import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { PipelineClient } from "./client";

export const dynamic = "force-dynamic";

export default async function CrmPipelinePage() {
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
        <h1 className="text-2xl font-bold text-foreground">Pipeline</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {isManager
            ? "Drag opportunities between stages. Toggle to list view for a sortable table."
            : "Your opportunities. Drag a card across stages — your changes are saved instantly."}
        </p>
      </div>
      <PipelineClient isManager={isManager} />
    </div>
  );
}
