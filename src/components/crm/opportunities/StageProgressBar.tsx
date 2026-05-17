"use client";

import { useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { STAGE_ORDER } from "@/lib/crm/business/stage-transitions";
import { stageLabel } from "@/lib/crm/stage-labels";
import type { CrmOpportunityStage } from "@/types";

const VISIBLE_STAGES: CrmOpportunityStage[] = [
  "NEW",
  "CONTACTED",
  "DISCOVERY",
  "QUALIFIED",
  "TECH_MEETING",
  "PROPOSAL_SENT",
  "NEGOTIATION",
  "VERBAL_YES",
  "WON",
];

export function StageProgressBar({ currentStage }: { currentStage: string }) {
  const { t } = useLocale();
  const currentOrder = STAGE_ORDER[currentStage as CrmOpportunityStage] ?? 0;

  if (currentStage === "LOST") {
    return (
      <div className="flex items-center justify-center py-3 px-4 bg-red-50 text-red-800 rounded-lg font-medium">
        {t.stages.LOST}
      </div>
    );
  }

  if (currentStage === "POSTPONED") {
    return (
      <div className="flex items-center justify-center py-3 px-4 bg-gray-50 text-gray-800 rounded-lg font-medium">
        {t.stages.POSTPONED}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 overflow-x-auto py-2">
      {VISIBLE_STAGES.map((stage) => {
        const order = STAGE_ORDER[stage];
        const isCurrent = stage === currentStage;
        const isPast = order < currentOrder;
        const isFuture = order > currentOrder;

        return (
          <div
            key={stage}
            className={cn(
              "flex-1 min-w-[80px] text-center py-2 px-1 rounded-md text-xs font-medium transition-colors",
              isCurrent && "bg-primary text-primary-foreground",
              isPast && "bg-primary/20 text-primary",
              isFuture && "bg-muted text-muted-foreground"
            )}
          >
            {(t.stages as Record<string, string>)[stage] ?? stageLabel(stage)}
          </div>
        );
      })}
    </div>
  );
}
