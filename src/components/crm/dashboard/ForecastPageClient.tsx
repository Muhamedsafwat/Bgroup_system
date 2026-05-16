"use client";

import { useLocale } from "@/lib/i18n";
import { KPICard } from "@/components/crm/shared/KPICard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, Target, ShieldCheck, AlertTriangle } from "lucide-react";
import type { Locale } from "@/lib/i18n";

type ForecastData = {
  kpis: {
    weightedPipeline: number;
    wonValueMTD: number;
    /// New: team target (sum of `monthlyTargetEGP` for the reps in the caller's
    /// scope). Source of truth — the leaderboard-derived sum used to come up
    /// zero when reps had no opps yet, but their target is still real.
    teamTarget?: number;
  };
  leaderboard: Array<{
    wonValue: number;
    target: number;
    weightedPipeline: number;
  }>;
};

export function ForecastPageClient({
  data,
  locale,
}: {
  data: ForecastData;
  locale: Locale;
}) {
  const { t } = useLocale();
  const fmt = (n: number) =>
    new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-US").format(n);

  // Prefer the server-computed team target (sum of reps' monthlyTargetEGP).
  // Fall back to the per-row sum in the leaderboard for backwards-compat with
  // any cached forecast payload that doesn't include the new field yet.
  const totalTarget =
    data.kpis.teamTarget ??
    data.leaderboard.reduce((s, r) => s + r.target, 0);
  const commitForecast = data.kpis.wonValueMTD + data.kpis.weightedPipeline * 0.7;
  const bestCase = data.kpis.wonValueMTD + data.kpis.weightedPipeline;
  const worstCase = data.kpis.wonValueMTD + data.kpis.weightedPipeline * 0.3;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t.forecast.title}</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard
          title={t.forecast.committed}
          value={`${fmt(Math.round(data.kpis.wonValueMTD))} ${t.currencies.EGP}`}
          subtitle={t.forecast.wonDeals}
          icon={<ShieldCheck className="h-5 w-5 text-green-600" />}
        />
        <KPICard
          title={t.forecast.commit}
          value={`${fmt(Math.round(commitForecast))} ${t.currencies.EGP}`}
          subtitle="70% weighted"
          icon={<Target className="h-5 w-5 text-blue-600" />}
        />
        <KPICard
          title={t.forecast.bestCase}
          value={`${fmt(Math.round(bestCase))} ${t.currencies.EGP}`}
          subtitle="100% weighted"
          icon={<TrendingUp className="h-5 w-5 text-emerald-600" />}
        />
        <KPICard
          title={t.forecast.worstCase}
          value={`${fmt(Math.round(worstCase))} ${t.currencies.EGP}`}
          subtitle="30% weighted"
          icon={<AlertTriangle className="h-5 w-5 text-amber-600" />}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t.forecast.gap}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex justify-between text-sm">
              <span>{t.forms.target}</span>
              <span className="ltr-nums font-medium">{fmt(totalTarget)} {t.currencies.EGP}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>{t.forecast.committed}</span>
              <span className="ltr-nums font-medium text-green-600">
                {fmt(Math.round(data.kpis.wonValueMTD))} {t.currencies.EGP}
              </span>
            </div>
            <div className="flex justify-between text-sm border-t pt-2">
              <span className="font-medium">{t.forecast.gap}</span>
              <span className="ltr-nums font-bold text-red-600">
                {fmt(Math.max(0, totalTarget - data.kpis.wonValueMTD))} {t.currencies.EGP}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
