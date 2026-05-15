import { getRequiredSession } from "@/lib/crm/session";
import { getServerT } from "@/lib/i18n/server";
import { getFxRates } from "../actions";
import { FxRatesClient } from "./fx-rates-client";

export default async function FxRatesPage() {
  const [session, { t, locale }] = await Promise.all([
    getRequiredSession(),
    getServerT(),
  ]);

  if (session.role !== "ADMIN") {
    return <div className="p-6 text-destructive">Unauthorized</div>;
  }

  const rates = await getFxRates();

  return <FxRatesClient rates={rates} />;
}
