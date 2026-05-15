import { getRequiredSession } from "@/lib/crm/session";
import { getServerT } from "@/lib/i18n/server";
import { getLeadSources } from "../actions";
import { LeadSourcesClient } from "./lead-sources-client";

export default async function LeadSourcesPage() {
  const [session, { t, locale }] = await Promise.all([
    getRequiredSession(),
    getServerT(),
  ]);

  if (session.role !== "ADMIN") {
    return <div className="p-6 text-destructive">Unauthorized</div>;
  }

  const sources = await getLeadSources();

  return <LeadSourcesClient sources={sources} />;
}
