"use client";

import { useEffect, useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, Users, Handshake, ListChecks, Loader2 } from "lucide-react";
import { useLocale } from "@/lib/i18n";

type Period = "daily" | "weekly" | "monthly";

type BoardData = {
  period: Period;
  generatedAt: string;
  pipeline: {
    openOpportunityCount: number;
    weightedPipelineValueEGP: number;
    newOpportunitiesInPeriod: number;
    newOpportunitiesValueEGP: number;
    callsInPeriod: number;
    wonInPeriod: number;
    wonValueEGP: number;
  };
  people: {
    activeEmployees: number;
    newHiresInPeriod: number;
    pendingOvertime: number;
    pendingLeave: number;
    incidentsInPeriod: number;
    bonusesInPeriod: number;
    attendanceRateOnTime: number | null;
  };
  partners: {
    activePartners: number;
    leadsInPeriod: number;
    dealsWonInPeriod: number;
    dealsWonValueUSD: number;
    pendingContracts: number;
    pendingInvoices: number;
  };
  execution: {
    tasksOpen: number;
    tasksOverdue: number;
    tasksCompletedInPeriod: number;
    workflowRunsCompleted: number;
    workflowRunsRunning: number;
    slaLateCount: number;
    slaEarlyCount: number;
  };
  leaders: {
    topCrmReps: Array<{ name: string; wonValueEGP: number }>;
    topPartners: Array<{ name: string; wonValueUSD: number }>;
  };
};

const PERIOD_LABEL: Record<Period, string> = {
  daily: "Today",
  weekly: "Last 7 days",
  monthly: "Last 30 days",
};

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

function formatCurrency(n: number, currency: string): string {
  return `${currency} ${formatNumber(n)}`;
}

export function BoardClient() {
  const { locale } = useLocale();
  const isAr = locale === "ar";
  const [period, setPeriod] = useState<Period>("weekly");
  const [data, setData] = useState<BoardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/board?period=${period}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .finally(() => setLoading(false));
  }, [period]);

  return (
    <div className="space-y-4">
      <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
        <TabsList>
          <TabsTrigger value="daily">{isAr ? "يومي" : "Daily"}</TabsTrigger>
          <TabsTrigger value="weekly">{isAr ? "أسبوعي" : "Weekly"}</TabsTrigger>
          <TabsTrigger value="monthly">{isAr ? "شهري" : "Monthly"}</TabsTrigger>
        </TabsList>
      </Tabs>

      <p className="text-xs text-muted-foreground">
        Window: {PERIOD_LABEL[period]}
        {data && ` · Generated ${new Date(data.generatedAt).toLocaleString()}`}
      </p>

      {loading || !data ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-4 w-4 me-2 animate-spin" />
          {isAr ? "جاري التحميل..." : "Loading..."}
        </div>
      ) : (
        <>
          {/* Pipeline / Sales */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" />
                Sales pipeline
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Kpi label="Open opps" value={String(data.pipeline.openOpportunityCount)} />
                <Kpi label="Weighted pipeline" value={formatCurrency(data.pipeline.weightedPipelineValueEGP, "EGP")} />
                <Kpi label={`New (${PERIOD_LABEL[period]})`} value={String(data.pipeline.newOpportunitiesInPeriod)} sub={formatCurrency(data.pipeline.newOpportunitiesValueEGP, "EGP")} />
                <Kpi label="Calls logged" value={String(data.pipeline.callsInPeriod)} />
                <Kpi label="Won in period" value={String(data.pipeline.wonInPeriod)} />
                <Kpi label="Won value" value={formatCurrency(data.pipeline.wonValueEGP, "EGP")} />
              </div>
            </CardContent>
          </Card>

          {/* People */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" />
                People & HR
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Kpi label="Active employees" value={String(data.people.activeEmployees)} />
                <Kpi label={`New hires (${PERIOD_LABEL[period]})`} value={String(data.people.newHiresInPeriod)} />
                <Kpi label="Pending leave" value={String(data.people.pendingLeave)} />
                <Kpi label="Pending overtime" value={String(data.people.pendingOvertime)} />
                <Kpi label="Incidents in period" value={String(data.people.incidentsInPeriod)} />
                <Kpi label="Bonuses in period" value={String(data.people.bonusesInPeriod)} />
                <Kpi
                  label="On-time attendance"
                  value={
                    data.people.attendanceRateOnTime === null
                      ? "—"
                      : `${(data.people.attendanceRateOnTime * 100).toFixed(0)}%`
                  }
                />
              </div>
            </CardContent>
          </Card>

          {/* Partners */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Handshake className="h-4 w-4 text-primary" />
                Partners
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Kpi label="Active partners" value={String(data.partners.activePartners)} />
                <Kpi label={`Leads (${PERIOD_LABEL[period]})`} value={String(data.partners.leadsInPeriod)} />
                <Kpi label="Deals won" value={String(data.partners.dealsWonInPeriod)} sub={formatCurrency(data.partners.dealsWonValueUSD, "USD")} />
                <Kpi label="Pending contracts" value={String(data.partners.pendingContracts)} />
                <Kpi label="Pending invoices" value={String(data.partners.pendingInvoices)} />
              </div>
            </CardContent>
          </Card>

          {/* Execution */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <ListChecks className="h-4 w-4 text-primary" />
                Execution & workflows
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Kpi label="Open tasks" value={String(data.execution.tasksOpen)} />
                <Kpi label="Overdue tasks" value={String(data.execution.tasksOverdue)} />
                <Kpi label={`Completed (${PERIOD_LABEL[period]})`} value={String(data.execution.tasksCompletedInPeriod)} />
                <Kpi label="Active workflow runs" value={String(data.execution.workflowRunsRunning)} />
                <Kpi label={`Workflow runs done (${PERIOD_LABEL[period]})`} value={String(data.execution.workflowRunsCompleted)} />
                <Kpi label="SLA late steps" value={String(data.execution.slaLateCount)} />
                <Kpi label="SLA early-bonus steps" value={String(data.execution.slaEarlyCount)} />
              </div>
            </CardContent>
          </Card>

          {/* Leaderboards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Top CRM reps (won value)</CardTitle>
              </CardHeader>
              <CardContent>
                {data.leaders.topCrmReps.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No deals won in this period.</p>
                ) : (
                  <ol className="space-y-1.5">
                    {data.leaders.topCrmReps.map((r, i) => (
                      <li key={i} className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2">
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] font-semibold">
                            {i + 1}
                          </span>
                          {r.name}
                        </span>
                        <span className="font-semibold ltr-nums">{formatCurrency(r.wonValueEGP, "EGP")}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Top partners (won value)</CardTitle>
              </CardHeader>
              <CardContent>
                {data.leaders.topPartners.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No partner deals won in this period.</p>
                ) : (
                  <ol className="space-y-1.5">
                    {data.leaders.topPartners.map((p, i) => (
                      <li key={i} className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2">
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] font-semibold">
                            {i + 1}
                          </span>
                          {p.name}
                        </span>
                        <span className="font-semibold ltr-nums">{formatCurrency(p.wonValueUSD, "USD")}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-bold text-foreground ltr-nums mt-1">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground ltr-nums mt-0.5">{sub}</p>}
    </div>
  );
}
