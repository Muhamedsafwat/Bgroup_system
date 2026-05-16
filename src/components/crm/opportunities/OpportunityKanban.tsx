"use client";

import { useState, useMemo } from "react";
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
const STAGES_NEEDING_MODAL = new Set<CrmOpportunityStage>(["WON", "LOST"]);

const STAGES: { id: CrmOpportunityStage; title: string; headerClass?: string }[] = [
  { id: "NEW", title: "New" },
  { id: "CONTACTED", title: "Contacted" },
  { id: "DISCOVERY", title: "Discovery" },
  { id: "QUALIFIED", title: "Qualified" },
  { id: "TECH_MEETING", title: "Tech Meeting" },
  { id: "PROPOSAL_SENT", title: "Proposal Sent" },
  { id: "NEGOTIATION", title: "Negotiation" },
  { id: "VERBAL_YES", title: "Verbal Yes" },
  {
    id: "POSTPONED",
    title: "Postponed",
    headerClass: "bg-muted/50 text-muted-foreground",
  },
  { id: "WON", title: "Won", headerClass: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" },
  { id: "LOST", title: "Lost", headerClass: "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300" },
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

  const columns: KanbanColumn<CrmOpportunityStage>[] = useMemo(
    () =>
      STAGES.map((s) => {
        const colItems = items.filter((i) => i.columnId === s.id);
        const total = colItems.reduce((sum, i) => sum + Number(i.weightedValueEGP), 0);
        return {
          ...s,
          subtitle: colItems.length > 0
            ? `${colItems.length} · ${Math.round(total / 1000)}k EGP`
            : "0",
        };
      }),
    [items]
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
