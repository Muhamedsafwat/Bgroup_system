"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale } from "@/lib/i18n";
import { KPICard } from "@/components/crm/shared/KPICard";
import { StageBadge } from "@/components/crm/shared/StageBadge";
import { PriorityBadge } from "@/components/crm/shared/PriorityBadge";
import { EntityBadge } from "@/components/crm/shared/EntityBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Briefcase,
  TrendingUp,
  Trophy,
  DollarSign,
  AlertTriangle,
  ShieldCheck,
} from "lucide-react";
import type { Locale } from "@/lib/i18n";
import type { CrmOpportunityStage, CrmPriority } from "@/types";

type GroupData = {
  kpis: {
    openOpps: number;
    weightedPipeline: number;
    wonCountMTD: number;
    wonValueMTD: number;
  };
  leaderboard: Array<{
    userId: string;
    userName: string;
    entityCode: string;
    entityColor: string;
    openOpps: number;
    weightedPipeline: number;
    wonCount: number;
    wonValue: number;
    target: number;
    /// `null` means "no monthly target set on this rep" — leaderboard
    /// shows "—" instead of a misleading 0% or absurd 500%.
    attainment: number | null;
  }>;
  topHotOpportunities: Array<{
    id: string;
    code: string;
    company: string;
    owner: string;
    entity: { code: string; nameEn: string; nameAr: string; color: string };
    stage: string;
    priority: string;
    weightedValueEGP: number;
  }>;
  pipelineByEntity: Array<{
    code: string;
    name: string;
    nameAr: string;
    color: string;
    count: number;
    totalValue: number;
    weightedValue: number;
  }>;
  totalAlerts: number;
  hygieneScore: number;
};

type Entity = {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  color: string;
};

export function GroupDashboardClient({
  data,
  entities,
  locale,
}: {
  data: GroupData;
  entities: Entity[];
  locale: Locale;
}) {
  const { t } = useLocale();
  const [selectedEntity, setSelectedEntity] = useState<string | null>(null);
  const fmt = (n: number) =>
    new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-US").format(n);

  // Filter leaderboard by entity
  const filteredLeaderboard = selectedEntity
    ? data.leaderboard.filter((r) => r.entityCode === selectedEntity)
    : data.leaderboard;

  const filteredHot = selectedEntity
    ? data.topHotOpportunities.filter((o) => o.entity.code === selectedEntity)
    : data.topHotOpportunities;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-2xl font-bold">{t.nav.groupDashboard}</h1>

        {/* Entity filter chips */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant={selectedEntity === null ? "default" : "outline"}
            onClick={() => setSelectedEntity(null)}
          >
            {t.common.all}
          </Button>
          {entities.map((e) => (
            <Button
              key={e.id}
              size="sm"
              variant={selectedEntity === e.code ? "default" : "outline"}
              onClick={() => setSelectedEntity(e.code)}
              style={
                selectedEntity === e.code
                  ? { backgroundColor: e.color, borderColor: e.color }
                  : {}
              }
            >
              {locale === "ar" ? e.nameAr : e.nameEn}
            </Button>
          ))}
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard
          title={t.kpis.openOpportunities}
          value={data.kpis.openOpps}
          icon={<Briefcase className="h-5 w-5" />}
        />
        <KPICard
          title={t.kpis.weightedPipeline}
          value={`${fmt(data.kpis.weightedPipeline)} ${t.currencies.EGP}`}
          icon={<TrendingUp className="h-5 w-5" />}
        />
        <KPICard
          title={t.kpis.wonThisMonth}
          value={data.kpis.wonCountMTD}
          icon={<Trophy className="h-5 w-5" />}
        />
        <KPICard
          title={t.kpis.wonValueMTD}
          value={`${fmt(data.kpis.wonValueMTD)} ${t.currencies.EGP}`}
          icon={<DollarSign className="h-5 w-5" />}
        />
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        {/* Leaderboard */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">{t.leaderboard.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>{t.leaderboard.rep}</TableHead>
                  <TableHead>{t.forms.entity}</TableHead>
                  <TableHead className="text-center">{t.leaderboard.openOpps}</TableHead>
                  <TableHead className="text-end">{t.leaderboard.weightedPipeline}</TableHead>
                  <TableHead className="text-center">{t.leaderboard.wonCount}</TableHead>
                  <TableHead className="text-end">{t.leaderboard.wonValue}</TableHead>
                  <TableHead className="text-end">{t.leaderboard.attainment}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLeaderboard.map((rep, i) => (
                  <TableRow key={rep.userId}>
                    <TableCell className="ltr-nums font-medium">{i + 1}</TableCell>
                    <TableCell className="font-medium">{rep.userName}</TableCell>
                    <TableCell>
                      <EntityBadge code={rep.entityCode} color={rep.entityColor} />
                    </TableCell>
                    <TableCell className="text-center ltr-nums">{rep.openOpps}</TableCell>
                    <TableCell className="text-end ltr-nums">{fmt(rep.weightedPipeline)}</TableCell>
                    <TableCell className="text-center ltr-nums">{rep.wonCount}</TableCell>
                    <TableCell className="text-end ltr-nums">{fmt(rep.wonValue)}</TableCell>
                    <TableCell className="text-end">
                      {rep.attainment == null ? (
                        <span
                          className="text-xs text-muted-foreground"
                          title="No monthly target set for this rep"
                        >
                          —
                        </span>
                      ) : (
                        <div className="flex items-center justify-end gap-2">
                          <Progress value={Math.min(rep.attainment, 100)} className="h-2 w-16" />
                          <span
                            className={`ltr-nums text-sm font-medium ${
                              rep.attainment >= 100
                                ? "text-green-600"
                                : rep.attainment >= 50
                                  ? "text-amber-600"
                                  : "text-red-600"
                            }`}
                          >
                            {rep.attainment}%
                          </span>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {filteredLeaderboard.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                      {t.common.noResults}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Alerts & Hygiene */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">{t.alerts.title}</CardTitle>
              {data.totalAlerts > 0 && (
                <Badge variant="destructive">{data.totalAlerts}</Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.totalAlerts > 0 ? (
              <div className="flex items-center gap-2 text-sm text-amber-700">
                <AlertTriangle className="h-4 w-4" />
                <span>
                  {data.totalAlerts} {t.alerts.title}
                </span>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t.alerts.noAlerts}</p>
            )}

            <div className="border-t pt-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{t.kpis.hygieneScore}</span>
                </div>
                <span
                  className={`text-2xl font-bold ltr-nums ${
                    data.hygieneScore >= 70 ? "text-green-600" : "text-red-600"
                  }`}
                >
                  {data.hygieneScore}/100
                </span>
              </div>
              <Progress value={data.hygieneScore} className="h-2 mt-2" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Pipeline by Entity */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t.kpis.pipelineByEntity}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.forms.entity}</TableHead>
                  <TableHead className="text-center">{t.common.count}</TableHead>
                  <TableHead className="text-end">{t.common.value}</TableHead>
                  <TableHead className="text-end">{t.kpis.weighted}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.pipelineByEntity.map((row) => (
                  <TableRow key={row.code}>
                    <TableCell>
                      <EntityBadge
                        code={row.code}
                        name={locale === "ar" ? row.nameAr : row.name}
                        color={row.color}
                      />
                    </TableCell>
                    <TableCell className="text-center ltr-nums">{row.count}</TableCell>
                    <TableCell className="text-end ltr-nums">{fmt(row.totalValue)}</TableCell>
                    <TableCell className="text-end ltr-nums font-medium">
                      {fmt(row.weightedValue)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Top Hot Opportunities */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t.kpis.topHotOpportunities}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {filteredHot.map((opp) => (
              <Link
                key={opp.id}
                href={`/opportunities/${opp.id}`}
                className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{opp.company}</span>
                    <EntityBadge code={opp.entity.code} color={opp.entity.color} />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground ltr-nums">{opp.code}</span>
                    <StageBadge stage={opp.stage as CrmOpportunityStage} />
                    <PriorityBadge priority={opp.priority as CrmPriority} />
                  </div>
                  <span className="text-xs text-muted-foreground">{opp.owner}</span>
                </div>
                <div className="text-end">
                  <p className="font-semibold ltr-nums">
                    {fmt(opp.weightedValueEGP)} {t.currencies.EGP}
                  </p>
                </div>
              </Link>
            ))}
            {filteredHot.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                {t.common.noResults}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
