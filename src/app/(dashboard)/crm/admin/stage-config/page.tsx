import { getRequiredSession } from "@/lib/crm/session";
import { getServerT } from "@/lib/i18n/server";
import { getStageConfigs } from "../actions";
import { StageConfigClient } from "./stage-config-client";

export default async function StageConfigPage() {
  const [session, { t, locale }] = await Promise.all([
    getRequiredSession(),
    getServerT(),
  ]);

  if (session.role !== "ADMIN") {
    return <div className="p-6 text-destructive">Unauthorized</div>;
  }

  const configs = await getStageConfigs();

  return <StageConfigClient configs={configs} />;
}
