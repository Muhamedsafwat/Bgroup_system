"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Loader2, TrendingUp, Flame, Calendar, Users, X, ArrowUpRight } from "lucide-react";
import { STAGE_LABEL_EN, STAGE_LABEL_AR, SPEC_STAGES } from "@/lib/crm/stage-labels";

type Board = {
  scope: "team" | "mine";
  kpi: {
    total: number;
    stageCounts: Record<string, number>;
    conversionRate: number;
    active: number;
    newOppsThisMonth: number;
    highPriority: number;
  };
  repTable: Array<{
    repId: string;
    name: string;
    total: number;
    perStage: Record<string, number>;
    active: number;
    conversion: number;
  }>;
  serviceDistribution: Array<{ name: string; code: string; count: number; pct: number }>;
  meetings: {
    total: number;
    today: number;
    thisWeek: number;
    confirmed: number;
    done: number;
    cancelled: number;
  };
  stages: string[];
};

type FilterOptions = {
  companies: Array<{ id: string; nameEn: string }>;
  reps: Array<{ id: string; fullName: string; role: string }>;
  products: Array<{ id: string; nameEn: string; code: string }>;
};

const SERVICE_BARS = [
  "bg-indigo-500", "bg-violet-500", "bg-emerald-500", "bg-amber-500", "bg-rose-500", "bg-sky-500",
];

export function SalesBoardClient() {
  const [data, setData] = useState<Board | null>(null);
  const [options, setOptions] = useState<FilterOptions>({ companies: [], reps: [], products: [] });
  const [filterCompany, setFilterCompany] = useState<string>("ALL");
  const [filterRep, setFilterRep] = useState<string>("ALL");
  const [filterProduct, setFilterProduct] = useState<string>("ALL");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/crm/filters")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setOptions(d));
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterCompany !== "ALL") params.set("companyId", filterCompany);
    if (filterRep !== "ALL") params.set("repId", filterRep);
    if (filterProduct !== "ALL") params.set("productId", filterProduct);
    fetch(`/api/crm/sales-board?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .finally(() => setLoading(false));
  }, [filterCompany, filterRep, filterProduct]);

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="h-4 w-4 me-2 animate-spin" />
        Loading sales board...
      </div>
    );
  }

  function pipelineLink(stage?: string): string {
    const params = new URLSearchParams();
    if (filterCompany !== "ALL") params.set("companyId", filterCompany);
    if (filterRep !== "ALL") params.set("repId", filterRep);
    if (filterProduct !== "ALL") params.set("productId", filterProduct);
    if (stage) params.set("stage", stage);
    return `/crm/pipeline${params.toString() ? `?${params.toString()}` : ""}`;
  }
  const hasFilter = filterCompany !== "ALL" || filterRep !== "ALL" || filterProduct !== "ALL";

  return (
    <div className="space-y-4">
      {/* Filter bar — drives every widget below */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={filterCompany} onValueChange={(v) => setFilterCompany(v ?? "ALL")}>
          <SelectTrigger className="h-9 w-44">
            <SelectValue placeholder="Company">
              {(v) => (v === "ALL" || !v) ? "All companies" : (options.companies.find((c) => c.id === v)?.nameEn ?? "Company")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All companies</SelectItem>
            {options.companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.nameEn}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterRep} onValueChange={(v) => setFilterRep(v ?? "ALL")}>
          <SelectTrigger className="h-9 w-44">
            <SelectValue placeholder="Rep">
              {(v) => (v === "ALL" || !v) ? "All reps" : (options.reps.find((r) => r.id === v)?.fullName ?? "Rep")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All reps</SelectItem>
            {options.reps.map((r) => <SelectItem key={r.id} value={r.id}>{r.fullName}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterProduct} onValueChange={(v) => setFilterProduct(v ?? "ALL")}>
          <SelectTrigger className="h-9 w-44">
            <SelectValue placeholder="Product">
              {(v) => (v === "ALL" || !v) ? "All products" : (options.products.find((p) => p.id === v)?.nameEn ?? "Product")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All products</SelectItem>
            {options.products.map((p) => <SelectItem key={p.id} value={p.id}>{p.nameEn}</SelectItem>)}
          </SelectContent>
        </Select>
        {hasFilter && (
          <Button
            variant="ghost" size="sm" className="h-9"
            onClick={() => { setFilterCompany("ALL"); setFilterRep("ALL"); setFilterProduct("ALL"); }}
          >
            <X className="h-4 w-4 me-1" />Clear
          </Button>
        )}
        <div className="flex-1" />
        <Link href="/crm/pipeline">
          <Button variant="outline" size="sm">
            Open pipeline<ArrowUpRight className="h-3.5 w-3.5 ms-1.5" />
          </Button>
        </Link>
      </div>

      {/* 8 stage tiles — each click drills into the pipeline */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        {SPEC_STAGES.map((s) => (
          <Link key={s} href={pipelineLink(s)}>
            <Card className="hover:-translate-y-0.5 transition-transform cursor-pointer h-full">
              <CardContent className="p-4">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{STAGE_LABEL_EN[s]}</p>
                <p className="text-[10px] text-muted-foreground/70 mt-0.5">{STAGE_LABEL_AR[s]}</p>
                <p className="text-2xl font-bold text-foreground mt-1.5 ltr-nums">
                  {data.kpi.stageCounts[s] ?? 0}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Headline KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Link href={pipelineLink()}>
          <KpiCard label="Total opportunities" value={data.kpi.total} icon={Users} tile="tile-indigo" />
        </Link>
        <KpiCard label="Conversion rate" value={`${data.kpi.conversionRate}%`} icon={TrendingUp} tile="tile-emerald" />
        <Link href={pipelineLink()}>
          <KpiCard label="Active deals" value={data.kpi.active} icon={Flame} tile="tile-amber" />
        </Link>
        <KpiCard label="High priority" value={data.kpi.highPriority} icon={Flame} tile="tile-rose" />
      </div>

      {/* Per-rep performance + service distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Sales team performance</CardTitle>
          </CardHeader>
          <CardContent>
            {data.repTable.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No reps to display.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="border-b">
                      <th className="px-2 py-2 text-start font-medium">Rep</th>
                      <th className="px-2 py-2 text-end font-medium">Total</th>
                      {SPEC_STAGES.filter((s) => s !== "NEW").map((s) => (
                        <th key={s} className="px-1.5 py-2 text-end font-medium whitespace-nowrap" title={STAGE_LABEL_EN[s]}>
                          {STAGE_LABEL_EN[s].split(" ").slice(-2).join(" ")}
                        </th>
                      ))}
                      <th className="px-2 py-2 text-end font-medium">Active</th>
                      <th className="px-2 py-2 text-end font-medium">Conv %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.repTable.map((r) => (
                      <tr key={r.repId} className="border-b hover:bg-muted/30">
                        <td className="px-2 py-2 truncate max-w-[10rem]">
                          <Link href={`/crm/pipeline?repId=${r.repId}`} className="hover:underline">{r.name}</Link>
                        </td>
                        <td className="px-2 py-2 text-end font-semibold">{r.total}</td>
                        {SPEC_STAGES.filter((s) => s !== "NEW").map((s) => (
                          <td key={s} className="px-1.5 py-2 text-end ltr-nums">{r.perStage[s] || ""}</td>
                        ))}
                        <td className="px-2 py-2 text-end font-semibold text-primary">{r.active}</td>
                        <td className="px-2 py-2 text-end font-medium">{r.conversion}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Service mix</CardTitle>
          </CardHeader>
          <CardContent>
            {data.serviceDistribution.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No products on opportunities yet.</p>
            ) : (
              <ul className="space-y-2">
                {data.serviceDistribution.map((s, i) => {
                  const prodId = options.products.find((p) => p.code === s.code)?.id ?? "";
                  return (
                    <li key={s.code} className="text-xs">
                      <div className="flex items-center justify-between mb-0.5">
                        <Link
                          href={prodId ? `/crm/pipeline?productId=${prodId}` : pipelineLink()}
                          className="truncate hover:underline"
                        >
                          {s.name}
                        </Link>
                        <span className="text-muted-foreground ms-2 shrink-0">{s.count} · {s.pct}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className={`h-full ${SERVICE_BARS[i % SERVICE_BARS.length]}`} style={{ width: `${s.pct}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Meetings panel */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="h-4 w-4 text-primary" />
            Technical meetings
          </CardTitle>
          <Link href="/crm/meetings" className="text-xs text-primary hover:underline">
            Open meetings →
          </Link>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <MiniStat label="Total" value={data.meetings.total} />
            <MiniStat label="Today" value={data.meetings.today} />
            <MiniStat label="This week" value={data.meetings.thisWeek} />
            <MiniStat label="Confirmed" value={data.meetings.confirmed} />
            <MiniStat label="Done" value={data.meetings.done} />
            <MiniStat label="Cancelled" value={data.meetings.cancelled} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({ label, value, icon: Icon, tile }: { label: string; value: number | string; icon: typeof TrendingUp; tile: string }) {
  return (
    <Card className="hover:-translate-y-0.5 transition-transform">
      <CardContent className="p-4 flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold text-foreground mt-1 ltr-nums">{value}</p>
        </div>
        <div className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${tile}`}>
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-xl font-bold text-foreground mt-1 ltr-nums">{value}</p>
    </div>
  );
}
