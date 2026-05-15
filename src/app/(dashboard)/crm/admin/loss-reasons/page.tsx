import { getRequiredSession } from "@/lib/crm/session";
import { getServerT } from "@/lib/i18n/server";
import { getLossReasons } from "../actions";
import { LossReasonsClient } from "./loss-reasons-client";

export default async function LossReasonsPage() {
  const [session, { t, locale }] = await Promise.all([
    getRequiredSession(),
    getServerT(),
  ]);

  if (session.role !== "ADMIN") {
    return <div className="p-6 text-destructive">Unauthorized</div>;
  }

  const reasons = await getLossReasons();

  return <LossReasonsClient reasons={reasons} />;
}
