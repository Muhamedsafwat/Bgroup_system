import { getRequiredSession } from "@/lib/crm/session";
import { getServerT } from "@/lib/i18n/server";
import { getEntitiesAdmin } from "../actions";
import { EntitiesClient } from "./entities-client";

export default async function EntitiesPage() {
  const [session, { t, locale }] = await Promise.all([
    getRequiredSession(),
    getServerT(),
  ]);

  if (session.role !== "ADMIN") {
    return <div className="p-6 text-destructive">Unauthorized</div>;
  }

  const entities = await getEntitiesAdmin();

  return <EntitiesClient entities={entities} />;
}
