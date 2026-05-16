"use client";

import Link from "next/link";
import { useLocale } from "@/lib/i18n";
import { KPICard } from "@/components/crm/shared/KPICard";
import { CurrencyDisplay } from "@/components/crm/shared/CurrencyDisplay";
import { StageBadge } from "@/components/crm/shared/StageBadge";
import { PriorityBadge } from "@/components/crm/shared/PriorityBadge";
import { EntityBadge } from "@/components/crm/shared/EntityBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  Target,
  Phone,
  PhoneIncoming,
  Calendar,
  AlertTriangle,
  Handshake,
  AlertCircle,
} from "lucide-react";
import type { Locale } from "@/lib/i18n";

type DashboardData = {
  kpis: {
    openOpps: number;
    weightedPipeline: number;
    wonCountMTD: number;
    wonValueMTD: number;
    /// `null` means no target is set on the rep's CRM profile. The UI
    /// shows "—" + a prompt instead of pretending the rep is at 0%
    /// (which was previously misread as "absurd 500%" when the fallback
    /// target of 50k was tiny next to actual MTD revenue).
    targetAttainment: number | null;
    monthlyTarget: number;
    targetSet?: boolean;
  };
  todayActivity: {
    callsToday: number;
    answeredCalls: number;
    meetingsBooked: number;
    overdueFollowups: number;
    inNegotiation: number;
  };
  pipelineByStage: Array<{
    stage: string;
    count: number;
    totalValue: number;
    weightedValue: number;
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
  topHotOpportunities: Array<{
    id: string;
    code: string;
    company: string;
    entity: { code: string; color: string };
    stage: string;
    priority: string;
    weightedValueEGP: number;
    estimatedValueEGP: number;
    nextActionDate: string | null;
  }>;
  alerts: {
    overdueFollowups: Array<{ opportunityId: string; opportunityCode: string; companyName: string; daysCount: number }>;
    agingProposals: Array<{ opportunityId: string; opportunityCode: string; companyName: string; daysCount: number }>;
    staleLeads: Array<{ opportunityId: string; opportunityCode: string; companyName: string; daysCount: number }>;
    missingNextActions: Array<{ opportunityId: string; opportunityCode: string; companyName: string }>;
  };
  hygieneScore: number;
};

export function MyDashboardClient({
  data,
  locale,
}: {
  data: DashboardData;
  locale: Locale;
}) {
  const { t } = useLocale();
  const fmt = (n: number) =>
    new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-US").format(n);

  const totalAlerts =
    data.alerts.overdueFollowups.length +
    data.alerts.agingProposals.length +
    data.alerts.staleLeads.length +
    data.alerts.missingNextActions.length;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t.nav.myDashboard}</h1>

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
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
        <KPICard
          title={t.kpis.targetAttainment}
          value={
            data.kpis.targetAttainment == null
              ? "—"
              : `${Math.min(data.kpis.targetAttainment, 9999)}%`
          }
          subtitle={
            data.kpis.targetAttainment == null
              ? "No monthly target set"
              : `${fmt(data.kpis.wonValueMTD)} / ${fmt(data.kpis.monthlyTarget)}`
          }
          icon={<Target className="h-5 w-5" />}
        />
      </div>

      {/* Target progress bar — only meaningful when a target is set. */}
      {data.kpis.targetAttainment != null && (
        <Progress value={Math.min(data.kpis.targetAttainment, 100)} className="h-3" />
      )}

      {/* Today's Activity */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <KPICard title={t.kpis.callsToday} value={data.todayActivity.callsToday} icon={<Phone className="h-4 w-4" />} />
        <KPICard title={t.kpis.answeredCalls} value={data.todayActivity.answeredCalls} icon={<PhoneIncoming className="h-4 w-4" />} />
        <KPICard title={t.kpis.meetingsBooked} value={data.todayActivity.meetingsBooked} icon={<Calendar className="h-4 w-4" />} />
        <KPICard title={t.kpis.overdueFollowups} value={data.todayActivity.overdueFollowups} icon={<AlertTriangle className="h-4 w-4" />} />
        <KPICard title={t.kpis.inNegotiation} value={data.todayActivity.inNegotiation} icon={<Handshake className="h-4 w-4" />} />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Pipeline by Stage */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t.kpis.pipelineByStage}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.kpis.stage}</TableHead>
                  <TableHead className="text-center">{t.common.count}</TableHead>
                  <TableHead className="text-end">{t.common.value}</TableHead>
                  <TableHead className="text-end">{t.kpis.weighted}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.pipelineByStage.map((row) => (
                  <TableRow key={row.stage}>
                    <TableCell>
                      <StageBadge stage={row.stage as import("@/types").CrmOpportunityStage} />
                    </TableCell>
                    <TableCell className="text-center ltr-nums">{row.count}</TableCell>
                    <TableCell className="text-end ltr-nums">{fmt(row.totalValue)}</TableCell>
                    <TableCell className="text-end ltr-nums font-medium">{fmt(row.weightedValue)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

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
                      <EntityBadge code={row.code} name={locale === "ar" ? row.nameAr : row.name} color={row.color} />
                    </TableCell>
                    <TableCell className="text-center ltr-nums">{row.count}</TableCell>
                    <TableCell className="text-end ltr-nums">{fmt(row.totalValue)}</TableCell>
                    <TableCell className="text-end ltr-nums font-medium">{fmt(row.weightedValue)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Top Hot Opportunities */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t.kpis.topHotOpportunities}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.topHotOpportunities.map((opp) => (
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
                    <StageBadge stage={opp.stage as import("@/types").CrmOpportunityStage} />
                    <PriorityBadge priority={opp.priority as import("@/types").CrmPriority} />
                  </div>
                </div>
                <div className="text-end">
                  <p className="font-semibold ltr-nums">{fmt(opp.weightedValueEGP)} {t.currencies.EGP}</p>
                </div>
              </Link>
            ))}
            {data.topHotOpportunities.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">{t.common.noResults}</p>
            )}
          </CardContent>
        </Card>

        {/* Alerts */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">{t.alerts.title}</CardTitle>
              {totalAlerts > 0 && (
                <Badge variant="destructive">{totalAlerts}</Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.alerts.overdueFollowups.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="h-4 w-4 text-red-500" />
                  <span className="text-sm font-medium text-red-700">
                    {t.alerts.overdueFollowups} ({data.alerts.overdueFollowups.length})
                  </span>
                </div>
                {data.alerts.overdueFollowups.slice(0, 3).map((a) => (
                  <Link
                    key={a.opportunityId}
                    href={`/opportunities/${a.opportunityId}`}
                    className="block text-sm text-muted-foreground hover:text-foreground ps-6 py-1"
                  >
                    {a.companyName} — <span className="ltr-nums">{a.daysCount}</span> {t.alerts.daysOverdue}
                  </Link>
                ))}
              </div>
            )}

            {data.alerts.agingProposals.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle className="h-4 w-4 text-amber-500" />
                  <span className="text-sm font-medium text-amber-700">
                    {t.alerts.agingProposals} ({data.alerts.agingProposals.length})
                  </span>
                </div>
                {data.alerts.agingProposals.slice(0, 3).map((a) => (
                  <Link
                    key={a.opportunityId}
                    href={`/opportunities/${a.opportunityId}`}
                    className="block text-sm text-muted-foreground hover:text-foreground ps-6 py-1"
                  >
                    {a.companyName} — <span className="ltr-nums">{a.daysCount}</span> {t.alerts.daysAging}
                  </Link>
                ))}
              </div>
            )}

            {data.alerts.staleLeads.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle className="h-4 w-4 text-gray-500" />
                  <span className="text-sm font-medium text-gray-700">
                    {t.alerts.staleLeads} ({data.alerts.staleLeads.length})
                  </span>
                </div>
                {data.alerts.staleLeads.slice(0, 3).map((a) => (
                  <Link
                    key={a.opportunityId}
                    href={`/opportunities/${a.opportunityId}`}
                    className="block text-sm text-muted-foreground hover:text-foreground ps-6 py-1"
                  >
                    {a.companyName} — <span className="ltr-nums">{a.daysCount}</span> {t.alerts.daysStale}
                  </Link>
                ))}
              </div>
            )}

            {totalAlerts === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">{t.alerts.noAlerts}</p>
            )}

            {/* Hygiene Score */}
            <div className="border-t pt-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{t.kpis.hygieneScore}</span>
                <span className={`text-2xl font-bold ltr-nums ${data.hygieneScore >= 70 ? "text-green-600" : "text-red-600"}`}>
                  {data.hygieneScore}/100
                </span>
              </div>
              <Progress value={data.hygieneScore} className="h-2 mt-2" />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
