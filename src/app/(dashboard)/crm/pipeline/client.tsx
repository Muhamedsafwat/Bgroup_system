"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, LayoutGrid, List, GripVertical, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { STAGE_LABEL_EN, STAGE_LABEL_AR, SPEC_STAGES } from "@/lib/crm/stage-labels";
import type { CrmOpportunityStage } from "@/generated/prisma";

type Opp = {
  id: string;
  code: string;
  title: string;
  stage: CrmOpportunityStage;
  priority: "HOT" | "WARM" | "COLD";
  estimatedValueEGP: string;
  probabilityPct: number;
  weightedValueEGP: string;
  expectedCloseDate: string | null;
  nextActionText: string | null;
  nextActionDate: string | null;
  owner: { id: string; fullName: string };
  company: { id: string; nameEn: string };
};

type FilterOptions = {
  companies: Array<{ id: string; nameEn: string }>;
  reps: Array<{ id: string; fullName: string; role: string }>;
  products: Array<{ id: string; nameEn: string; code: string }>;
};

const PRIORITY_DOT: Record<Opp["priority"], string> = {
  HOT: "bg-rose-500",
  WARM: "bg-amber-500",
  COLD: "bg-sky-500",
};

const STAGE_HUE: Partial<Record<CrmOpportunityStage, string>> = {
  NEW: "from-indigo-500/20 to-indigo-500/5",
  CONTACTED: "from-sky-500/20 to-sky-500/5",
  DISCOVERY: "from-violet-500/20 to-violet-500/5",
  TECH_MEETING: "from-amber-500/20 to-amber-500/5",
  QUALIFIED: "from-fuchsia-500/20 to-fuchsia-500/5",
  WON: "from-emerald-500/30 to-emerald-500/5",
  LOST: "from-rose-500/20 to-rose-500/5",
  POSTPONED: "from-slate-500/20 to-slate-500/5",
};

function formatEGP(s: string): string {
  const n = Number(s);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return `${Math.round(n)}`;
}

export function PipelineClient({ isManager }: { isManager: boolean }) {
  const [view, setView] = useState<"board" | "list">("board");
  const [opps, setOpps] = useState<Opp[]>([]);
  const [options, setOptions] = useState<FilterOptions>({ companies: [], reps: [], products: [] });
  const [filterRep, setFilterRep] = useState<string>("ALL");
  const [filterCompany, setFilterCompany] = useState<string>("ALL");
  const [filterProduct, setFilterProduct] = useState<string>("ALL");
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<"mine" | "all">(isManager ? "all" : "mine");
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    fetch("/api/crm/filters")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setOptions(d));
  }, []);

  async function refresh() {
    setLoading(true);
    const params = new URLSearchParams();
    if (scope === "mine") params.set("scope", "mine");
    if (filterRep !== "ALL") params.set("repId", filterRep);
    if (filterCompany !== "ALL") params.set("companyId", filterCompany);
    if (filterProduct !== "ALL") params.set("productId", filterProduct);
    if (q.trim()) params.set("q", q.trim());
    try {
      const res = await fetch(`/api/crm/pipeline?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setOpps(data.opportunities ?? []);
      }
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, filterRep, filterCompany, filterProduct]);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(refresh, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  async function moveStage(oppId: string, newStage: CrmOpportunityStage) {
    const prev = opps;
    setOpps((cur) => cur.map((o) => (o.id === oppId ? { ...o, stage: newStage } : o)));
    const res = await fetch("/api/crm/pipeline", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ opportunityId: oppId, newStage }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast.error(d.error ?? "Stage change failed");
      setOpps(prev);
      return;
    }
    toast.success(`Moved to ${STAGE_LABEL_EN[newStage]}`);
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    if (!e.over) return;
    const oppId = String(e.active.id);
    const newStage = String(e.over.id) as CrmOpportunityStage;
    const opp = opps.find((o) => o.id === oppId);
    if (!opp || opp.stage === newStage) return;
    moveStage(oppId, newStage);
  }

  const oppsByStage: Partial<Record<CrmOpportunityStage, Opp[]>> = {};
  for (const s of SPEC_STAGES) oppsByStage[s] = [];
  for (const o of opps) {
    const arr = oppsByStage[o.stage] ?? (oppsByStage[o.stage] = []);
    arr.push(o);
  }

  return (
    <div className="space-y-3">
      {/* Filter + view bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-xs flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title or company..." className="ps-8 h-9" />
        </div>

        {isManager && (
          <>
            <Tabs value={scope} onValueChange={(v) => setScope(v as "mine" | "all")}>
              <TabsList>
                <TabsTrigger value="mine">Mine</TabsTrigger>
                <TabsTrigger value="all">All reps</TabsTrigger>
              </TabsList>
            </Tabs>
            <Select value={filterRep} onValueChange={(v) => setFilterRep(v ?? "ALL")}>
              <SelectTrigger className="h-9 w-40">
                <SelectValue placeholder="Rep">
                  {(v) => (v === "ALL" || !v) ? "All reps" : (options.reps.find((r) => r.id === v)?.fullName ?? "Rep")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All reps</SelectItem>
                {options.reps.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.fullName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
        <Select value={filterCompany} onValueChange={(v) => setFilterCompany(v ?? "ALL")}>
          <SelectTrigger className="h-9 w-44">
            <SelectValue placeholder="Company">
              {(v) => (v === "ALL" || !v) ? "All companies" : (options.companies.find((c) => c.id === v)?.nameEn ?? "Company")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All companies</SelectItem>
            {options.companies.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.nameEn}</SelectItem>
            ))}
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
            {options.products.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.nameEn}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {(filterRep !== "ALL" || filterCompany !== "ALL" || filterProduct !== "ALL" || q) && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9"
            onClick={() => {
              setFilterRep("ALL");
              setFilterCompany("ALL");
              setFilterProduct("ALL");
              setQ("");
            }}
          >
            <X className="h-4 w-4 me-1" />
            Clear
          </Button>
        )}

        <div className="flex-1" />
        <Tabs value={view} onValueChange={(v) => setView(v as "board" | "list")}>
          <TabsList>
            <TabsTrigger value="board"><LayoutGrid className="h-3.5 w-3.5 me-1.5" />Board</TabsTrigger>
            <TabsTrigger value="list"><List className="h-3.5 w-3.5 me-1.5" />List</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground py-12 text-center">Loading...</p>
      ) : view === "board" ? (
        <DndContext
          sensors={sensors}
          onDragStart={(e) => setActiveId(String(e.active.id))}
          onDragEnd={onDragEnd}
          onDragCancel={() => setActiveId(null)}
        >
          <div className="overflow-x-auto pb-2">
            <div className="flex gap-3 min-w-fit">
              {SPEC_STAGES.map((stage) => (
                <StageColumn
                  key={stage}
                  stage={stage}
                  opps={oppsByStage[stage] ?? []}
                  activeId={activeId}
                />
              ))}
            </div>
          </div>
        </DndContext>
      ) : (
        <ListView opps={opps} />
      )}
    </div>
  );
}

function StageColumn({
  stage,
  opps,
  activeId,
}: {
  stage: CrmOpportunityStage;
  opps: Opp[];
  activeId: string | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const total = opps.reduce((acc, o) => acc + Number(o.weightedValueEGP), 0);
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "w-72 shrink-0 rounded-2xl border bg-gradient-to-b p-3 transition-colors",
        STAGE_HUE[stage] ?? "from-muted/40 to-muted/10",
        isOver && "ring-2 ring-primary/50 -translate-y-0.5"
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">{STAGE_LABEL_EN[stage]}</p>
          <p className="text-[10px] text-muted-foreground truncate">{STAGE_LABEL_AR[stage]}</p>
        </div>
        <span className="text-xs text-muted-foreground shrink-0">
          {opps.length} · {formatEGP(String(total))} EGP
        </span>
      </div>
      <div className="space-y-2 min-h-[6rem]">
        {opps.length === 0 ? (
          <div className="text-[10px] text-muted-foreground italic text-center py-6">
            Drop here
          </div>
        ) : (
          opps.map((o) => <OppCard key={o.id} opp={o} active={activeId === o.id} />)
        )}
      </div>
    </div>
  );
}

function OppCard({ opp, active }: { opp: Opp; active: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: opp.id });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50 }
    : undefined;
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "rounded-xl border bg-card p-3 shadow-sm hover:shadow-md transition-shadow",
        (isDragging || active) && "opacity-80 cursor-grabbing ring-2 ring-primary/40"
      )}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="mt-0.5 text-muted-foreground hover:text-foreground cursor-grab"
          aria-label="Drag"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", PRIORITY_DOT[opp.priority])} />
            <Link
              href={`/crm/opportunities/${opp.id}`}
              className="text-sm font-medium truncate hover:underline"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {opp.title}
            </Link>
          </div>
          <p className="text-[11px] text-muted-foreground truncate">{opp.company.nameEn}</p>
          <div className="flex items-center justify-between mt-1.5 text-[11px]">
            <span className="text-muted-foreground ltr-nums">{formatEGP(opp.estimatedValueEGP)} EGP</span>
            <span className="text-muted-foreground">{opp.probabilityPct}%</span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{opp.owner.fullName}</p>
        </div>
      </div>
    </div>
  );
}

function ListView({ opps }: { opps: Opp[] }) {
  if (opps.length === 0) {
    return <p className="text-sm text-muted-foreground py-12 text-center">No opportunities match.</p>;
  }
  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground border-b">
              <tr>
                <th className="text-start py-2 px-3 text-xs font-medium uppercase">Code</th>
                <th className="text-start py-2 px-3 text-xs font-medium uppercase">Title</th>
                <th className="text-start py-2 px-3 text-xs font-medium uppercase">Company</th>
                <th className="text-start py-2 px-3 text-xs font-medium uppercase">Owner</th>
                <th className="text-start py-2 px-3 text-xs font-medium uppercase">Stage</th>
                <th className="text-end py-2 px-3 text-xs font-medium uppercase">Value</th>
                <th className="text-end py-2 px-3 text-xs font-medium uppercase">Prob</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {opps.map((o) => (
                <tr key={o.id} className="hover:bg-muted/30">
                  <td className="py-2 px-3 font-mono text-xs">
                    <Link href={`/crm/opportunities/${o.id}`} className="hover:underline">{o.code}</Link>
                  </td>
                  <td className="py-2 px-3">{o.title}</td>
                  <td className="py-2 px-3 text-muted-foreground">{o.company.nameEn}</td>
                  <td className="py-2 px-3 text-muted-foreground">{o.owner.fullName}</td>
                  <td className="py-2 px-3">
                    <span className="text-[10px] uppercase rounded px-1.5 py-0.5 bg-muted">
                      {STAGE_LABEL_EN[o.stage]}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-end ltr-nums">{formatEGP(o.estimatedValueEGP)} EGP</td>
                  <td className="py-2 px-3 text-end ltr-nums">{o.probabilityPct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
