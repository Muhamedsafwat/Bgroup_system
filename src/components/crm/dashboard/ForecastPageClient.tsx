"use client";

import Link from "next/link";
import { useLocale } from "@/lib/i18n";
import { KPICard } from "@/components/crm/shared/KPICard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, Target, ShieldCheck, AlertTriangle } from "lucide-react";
import type { Locale } from "@/lib/i18n";

type Leaderboard = {
  userId: string;
  userName: string;
  entityCode: string;
  entityColor: string;
  openOpps: number;
  weightedPipeline: number;
  wonCount: number;
  wonValue: number;
  target: number;
  attainment: number | null;
};

type TopHot = {
  id: string;
  code: string;
  company: string;
  owner: string;
  entity: { code: string; nameEn: string; nameAr: string; color: string };
  stage: string;
  priority: string;
  weightedValueEGP: number;
};

type EntityRow = {
  code: string;
  name: string;
  nameAr: string;
  color: string;
  count: number;
  totalValue: number;
  weightedValue: number;
};

type StageRow = {
  stage: string;
  labelEn: string;
  labelAr: string;
  probabilityPct: number;
  displayOrder: number;
  count: number;
  totalValue: number;
  weightedValue: number;
};

type ForecastData = {
  kpis: {
    weightedPipeline: number;
    wonValueMTD: number;
    wonCountMTD: number;
    openOpps: number;
    teamTarget?: number;
  };
  leaderboard: Leaderboard[];
  topHotOpportunities?: TopHot[];
  pipelineByEntity?: EntityRow[];
  pipelineByStage?: StageRow[];
};

export function ForecastPageClient({
  data,
  locale,
  showDetail = false,
}: {
  data: ForecastData;
  locale: Locale;
  showDetail?: boolean;
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

      {/* The admin/manager detail view. Reps don't see these — they have a
          simpler page showing only their own number. */}
      {showDetail && data.pipelineByStage && data.pipelineByStage.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pipeline by stage</CardTitle>
            <p className="text-xs text-muted-foreground">
              Open opportunities grouped by their current stage. Weighted value applies the stage's probability.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground border-b">
                  <tr>
                    <th className="text-start py-2 px-3 text-xs font-medium uppercase">Stage</th>
                    <th className="text-end py-2 px-3 text-xs font-medium uppercase">Prob</th>
                    <th className="text-end py-2 px-3 text-xs font-medium uppercase">Count</th>
                    <th className="text-end py-2 px-3 text-xs font-medium uppercase">Pipeline value</th>
                    <th className="text-end py-2 px-3 text-xs font-medium uppercase">Weighted</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.pipelineByStage.map((s) => (
                    <tr key={s.stage}>
                      <td className="py-2 px-3 font-medium">
                        {locale === "ar" ? s.labelAr : s.labelEn}
                      </td>
                      <td className="py-2 px-3 text-end ltr-nums text-muted-foreground">
                        {s.probabilityPct}%
                      </td>
                      <td className="py-2 px-3 text-end ltr-nums">{s.count}</td>
                      <td className="py-2 px-3 text-end ltr-nums">
                        {fmt(Math.round(s.totalValue))} {t.currencies.EGP}
                      </td>
                      <td className="py-2 px-3 text-end ltr-nums font-medium">
                        {fmt(Math.round(s.weightedValue))} {t.currencies.EGP}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t bg-muted/30">
                  <tr>
                    <td className="py-2 px-3 text-xs font-semibold uppercase">Total</td>
                    <td className="py-2 px-3" />
                    <td className="py-2 px-3 text-end ltr-nums font-semibold">
                      {data.pipelineByStage.reduce((s, r) => s + r.count, 0)}
                    </td>
                    <td className="py-2 px-3 text-end ltr-nums font-semibold">
                      {fmt(Math.round(data.pipelineByStage.reduce((s, r) => s + r.totalValue, 0)))} {t.currencies.EGP}
                    </td>
                    <td className="py-2 px-3 text-end ltr-nums font-semibold">
                      {fmt(Math.round(data.pipelineByStage.reduce((s, r) => s + r.weightedValue, 0)))} {t.currencies.EGP}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {showDetail && data.leaderboard.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Per-rep breakdown</CardTitle>
            <p className="text-xs text-muted-foreground">
              How each rep is tracking against their monthly target. Attainment is won-value ÷ target.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground border-b">
                  <tr>
                    <th className="text-start py-2 px-3 text-xs font-medium uppercase">Rep</th>
                    <th className="text-end py-2 px-3 text-xs font-medium uppercase">Open</th>
                    <th className="text-end py-2 px-3 text-xs font-medium uppercase">Pipeline (weighted)</th>
                    <th className="text-end py-2 px-3 text-xs font-medium uppercase">Won (MTD)</th>
                    <th className="text-end py-2 px-3 text-xs font-medium uppercase">Target</th>
                    <th className="text-end py-2 px-3 text-xs font-medium uppercase">Attainment</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.leaderboard.map((r) => (
                    <tr key={r.userId}>
                      <td className="py-2 px-3 font-medium">{r.userName}</td>
                      <td className="py-2 px-3 text-end ltr-nums">{r.openOpps}</td>
                      <td className="py-2 px-3 text-end ltr-nums">
                        {fmt(r.weightedPipeline)} {t.currencies.EGP}
                      </td>
                      <td className="py-2 px-3 text-end ltr-nums text-green-700">
                        {fmt(r.wonValue)} {t.currencies.EGP} <span className="text-muted-foreground">({r.wonCount})</span>
                      </td>
                      <td className="py-2 px-3 text-end ltr-nums text-muted-foreground">
                        {r.target > 0 ? `${fmt(r.target)} ${t.currencies.EGP}` : "—"}
                      </td>
                      <td className={`py-2 px-3 text-end ltr-nums font-semibold ${
                        r.attainment == null
                          ? "text-muted-foreground"
                          : r.attainment >= 100
                            ? "text-emerald-600"
                            : r.attainment >= 60
                              ? "text-amber-600"
                              : "text-rose-600"
                      }`}>
                        {r.attainment == null ? "—" : `${r.attainment}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {showDetail && data.topHotOpportunities && data.topHotOpportunities.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Hot opportunities most likely to close</CardTitle>
            <p className="text-xs text-muted-foreground">
              HOT-priority or late-stage opps, ranked by weighted value.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground border-b">
                  <tr>
                    <th className="text-start py-2 px-3 text-xs font-medium uppercase">Code</th>
                    <th className="text-start py-2 px-3 text-xs font-medium uppercase">Company</th>
                    <th className="text-start py-2 px-3 text-xs font-medium uppercase">Owner</th>
                    <th className="text-start py-2 px-3 text-xs font-medium uppercase">Stage</th>
                    <th className="text-end py-2 px-3 text-xs font-medium uppercase">Weighted value</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.topHotOpportunities.map((o) => (
                    <tr key={o.id} className="hover:bg-muted/30">
                      <td className="py-2 px-3 font-mono text-xs">
                        <Link href={`/crm/opportunities/${o.id}`} className="hover:underline">{o.code}</Link>
                      </td>
                      <td className="py-2 px-3">{o.company}</td>
                      <td className="py-2 px-3 text-muted-foreground">{o.owner}</td>
                      <td className="py-2 px-3 text-xs">
                        <span className="rounded-md px-1.5 py-0.5 bg-muted">{o.stage}</span>
                      </td>
                      <td className="py-2 px-3 text-end ltr-nums font-medium">
                        {fmt(o.weightedValueEGP)} {t.currencies.EGP}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {showDetail && data.pipelineByEntity && data.pipelineByEntity.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pipeline by entity</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground border-b">
                  <tr>
                    <th className="text-start py-2 px-3 text-xs font-medium uppercase">Entity</th>
                    <th className="text-end py-2 px-3 text-xs font-medium uppercase">Open</th>
                    <th className="text-end py-2 px-3 text-xs font-medium uppercase">Pipeline value</th>
                    <th className="text-end py-2 px-3 text-xs font-medium uppercase">Weighted</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.pipelineByEntity.map((e) => (
                    <tr key={e.code}>
                      <td className="py-2 px-3 font-medium">
                        {locale === "ar" ? e.nameAr : e.name}
                      </td>
                      <td className="py-2 px-3 text-end ltr-nums">{e.count}</td>
                      <td className="py-2 px-3 text-end ltr-nums">
                        {fmt(Math.round(e.totalValue))} {t.currencies.EGP}
                      </td>
                      <td className="py-2 px-3 text-end ltr-nums font-medium">
                        {fmt(Math.round(e.weightedValue))} {t.currencies.EGP}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
