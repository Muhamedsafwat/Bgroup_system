import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getServerT } from "@/lib/i18n/server";
import { PipelineClient } from "./client";

export const dynamic = "force-dynamic";

export default async function CrmPipelinePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.crmProfileId) redirect("/");

  const { t } = await getServerT();
  const isManager =
    session.user.crmRole === "MANAGER" ||
    session.user.crmRole === "ADMIN" ||
    !!session.user.hrRoles?.includes("super_admin");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t.pages.pipelineTitle}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {isManager ? t.pages.pipelineSubManager : t.pages.pipelineSubRep}
        </p>
      </div>
      <PipelineClient isManager={isManager} />
    </div>
  );
}
