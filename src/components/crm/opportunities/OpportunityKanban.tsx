"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Kanban, type KanbanColumn } from "@/components/shared/Kanban/Kanban";
import { StageChangeModal } from "@/components/crm/opportunities/StageChangeModal";
import { CurrencyDisplay } from "@/components/crm/shared/CurrencyDisplay";
import { PriorityBadge } from "@/components/crm/shared/PriorityBadge";
import type { Locale } from "@/lib/i18n";
import type { CrmOpportunityStage, CrmPriority } from "@/types";

type Opportunity = {
  id: string;
  code: string;
  stage: string;
  priority: string;
  estimatedValueEGP: number;
  weightedValueEGP: number;
  probabilityPct: number;
  nextAction: string | null;
  nextActionDate: string | null;
  customerCompanyName: string | null;
  company: { id: string; nameEn: string; nameAr: string | null } | null;
  owner: { id: string; fullName: string; fullNameAr: string | null };
};

// Stages that need extra fields when transitioning into them. Drag-drop into
// these opens the existing StageChangeModal for the user to fill in details.
const STAGES_NEEDING_MODAL = new Set<string>(["WON", "LOST"]);

type StageCol = { id: string; title: string; headerClass?: string };

// Per-code styling for terminal/postponed columns. Applied on top of
// whatever stages the admin config returns, keyed by the canonical code
// so a renamed label keeps its colour.
const STAGE_HEADER_CLASS: Record<string, string> = {
  POSTPONED: "bg-muted/50 text-muted-foreground",
  LOST: "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  WON: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
};

// audit/stages-fix (2026-06-18): fallback ONLY — used when /api/crm/stages
// is unreachable. The live board reads the admin's CrmStageConfig so the
// pipeline always matches what /crm/admin/stage-config shows.
const FALLBACK_STAGES: StageCol[] = [
  { id: "NEW", title: "New" },
  { id: "CONTACTED", title: "Contacted" },
  { id: "DISCOVERY", title: "Discovery" },
  { id: "QUALIFIED", title: "Qualified" },
  { id: "TECH_MEETING", title: "Tech Meeting" },
  { id: "PROPOSAL_SENT", title: "Proposal Sent" },
  { id: "NEGOTIATION", title: "Negotiation" },
  { id: "VERBAL_YES", title: "Verbal Yes" },
  { id: "POSTPONED", title: "Postponed", headerClass: STAGE_HEADER_CLASS.POSTPONED },
  { id: "WON", title: "Won", headerClass: STAGE_HEADER_CLASS.WON },
  { id: "LOST", title: "Lost", headerClass: STAGE_HEADER_CLASS.LOST },
];

export function OpportunityKanban({
  opportunities,
  locale,
}: {
  opportunities: Opportunity[];
  locale: Locale;
}) {
  const router = useRouter();
  const [items, setItems] = useState(() =>
    opportunities.map((o) => ({ ...o, columnId: o.stage as CrmOpportunityStage }))
  );
  const [modalState, setModalState] = useState<{
    opportunityId: string;
    currentStage: CrmOpportunityStage;
  } | null>(null);

  // stages-fix (2026-06-18): read the admin-configured stage list so the
  // board matches /crm/admin/stage-config exactly (renamed / added /
  // disabled / reordered stages all flow through). Falls back to the
  // canonical seed only if the API is unreachable.
  const [stageDefs, setStageDefs] = useState<StageCol[]>(FALLBACK_STAGES);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/crm/stages")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d?.stages?.length) return;
        type ApiStage = { stage: string; labelEn: string; labelAr: string };
        setStageDefs(
          (d.stages as ApiStage[]).map((s) => ({
            id: s.stage,
            title: locale === "ar" ? s.labelAr || s.labelEn : s.labelEn,
            headerClass: STAGE_HEADER_CLASS[s.stage],
          })),
        );
      })
      .catch(() => {
        /* keep fallback */
      });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  const columns: KanbanColumn<CrmOpportunityStage>[] = useMemo(
    () => {
      // Ensure any stage present on a card but missing from the config
      // (e.g. a legacy code) still gets a column so cards never vanish.
      const known = new Set(stageDefs.map((s) => s.id));
      const extras = Array.from(
        new Set(items.map((i) => i.columnId).filter((s) => !known.has(s))),
      ).map((id) => ({ id, title: String(id).replace(/_/g, " ") }));
      return [...stageDefs, ...extras].map((s) => {
        const colItems = items.filter((i) => i.columnId === s.id);
        const total = colItems.reduce((sum, i) => sum + Number(i.weightedValueEGP), 0);
        return {
          ...s,
          id: s.id as CrmOpportunityStage,
          subtitle: colItems.length > 0
            ? `${colItems.length} · ${Math.round(total / 1000)}k EGP`
            : "0",
        };
      });
    },
    [items, stageDefs]
  );

  async function handleMove(
    item: typeof items[number],
    toStage: CrmOpportunityStage,
    fromStage: CrmOpportunityStage
  ) {
    if (STAGES_NEEDING_MODAL.has(toStage)) {
      setModalState({ opportunityId: item.id, currentStage: fromStage });
      return;
    }

    // Optimistic update
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, columnId: toStage, stage: toStage } : i))
    );

    try {
      const res = await fetch(`/api/crm/opportunities/${item.id}/stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toStage }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to change stage");
      }
      toast.success(`Moved to ${toStage.replace("_", " ").toLowerCase()}`);
      router.refresh();
    } catch (e) {
      // Rollback
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, columnId: fromStage, stage: fromStage } : i))
      );
      toast.error(e instanceof Error ? e.message : "Failed to move card");
    }
  }

  return (
    <>
      <Kanban
        columns={columns}
        items={items}
        onMove={handleMove}
        renderCard={(item) => (
          <div
            className="rounded border bg-background p-3 hover:border-primary/50 transition-colors"
            onClick={() => router.push(`/crm/opportunities/${item.id}`)}
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <div className="font-medium text-sm leading-snug">
                {item.customerCompanyName ??
                  (locale === "ar"
                    ? item.company?.nameAr || item.company?.nameEn || "—"
                    : item.company?.nameEn ?? "—")}
              </div>
              <PriorityBadge priority={item.priority as CrmPriority} />
            </div>
            <div className="text-xs text-muted-foreground mb-2 ltr-nums">{item.code}</div>
            <div className="flex items-center justify-between text-xs">
              <CurrencyDisplay
                amount={Number(item.weightedValueEGP)}
                currency="EGP"
                className="font-medium"
              />
              <span className="text-muted-foreground">{item.probabilityPct}%</span>
            </div>
            <div className="text-xs text-muted-foreground mt-2 truncate">
              {locale === "ar"
                ? item.owner.fullNameAr || item.owner.fullName
                : item.owner.fullName}
            </div>
          </div>
        )}
      />

      {modalState && (
        <StageChangeModal
          open
          onOpenChange={(open) => !open && setModalState(null)}
          opportunityId={modalState.opportunityId}
          currentStage={modalState.currentStage}
          locale={locale}
        />
      )}
    </>
  );
}
