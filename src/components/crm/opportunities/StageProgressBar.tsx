"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { stageLabel } from "@/lib/crm/stage-labels";

// stages-fix (2026-06-18): the progress bar now reads the admin's
// CrmStageConfig (via /api/crm/stages) instead of a hardcoded list, so
// renamed / added / reordered stages on the detail page match what the
// admin configured and what the pipeline board shows. Falls back to the
// canonical seed order only if the API is unreachable.
const FALLBACK_STAGES: string[] = [
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

type StageDef = { stage: string; labelEn: string; labelAr: string };

export function StageProgressBar({
  currentStage,
  onStageClick,
}: {
  currentStage: string;
  // user-feature 2026-06-19: when provided, each stage segment becomes a
  // clickable button that asks the parent to move the opp to that stage.
  onStageClick?: (stage: string) => void;
}) {
  const { t, locale } = useLocale();
  const [stages, setStages] = useState<StageDef[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/crm/stages")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d?.stages?.length) return;
        setStages(d.stages as StageDef[]);
      })
      .catch(() => {
        /* keep fallback */
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  // Build the linear active path. Exclude the terminal LOST/POSTPONED
  // columns (they render as banners above), keep the admin order.
  const path: { stage: string; label: string }[] = stages
    ? stages
        .filter((s) => s.stage !== "LOST" && s.stage !== "POSTPONED")
        .map((s) => ({
          stage: s.stage,
          label: locale === "ar" ? s.labelAr || s.labelEn : s.labelEn,
        }))
    : FALLBACK_STAGES.map((s) => ({
        stage: s,
        label: (t.stages as Record<string, string>)[s] ?? stageLabel(s),
      }));

  // Order is the index in the resolved path. If the current stage is a
  // custom one not on the path (shouldn't happen, but be safe), treat it
  // as not-yet-reached so nothing is wrongly marked "past".
  const currentIndex = path.findIndex((p) => p.stage === currentStage);

  return (
    <div className="flex items-center gap-1 overflow-x-auto py-2">
      {path.map((p, idx) => {
        const isCurrent = p.stage === currentStage;
        const isPast = currentIndex >= 0 && idx < currentIndex;
        const isFuture = currentIndex < 0 || idx > currentIndex;
        const className = cn(
          "flex-1 min-w-[80px] text-center py-2 px-1 rounded-md text-xs font-medium transition-colors",
          isCurrent && "bg-primary text-primary-foreground",
          isPast && "bg-primary/20 text-primary",
          isFuture && "bg-muted text-muted-foreground",
          onStageClick && !isCurrent && "cursor-pointer hover:ring-2 hover:ring-primary/40",
        );

        // Clickable when a handler is provided and this isn't the current
        // stage. Otherwise render a plain, non-interactive segment.
        return onStageClick && !isCurrent ? (
          <button
            key={p.stage}
            type="button"
            onClick={() => onStageClick(p.stage)}
            className={className}
            title={locale === "ar" ? `الانتقال إلى ${p.label}` : `Move to ${p.label}`}
          >
            {p.label}
          </button>
        ) : (
          <div key={p.stage} className={className}>
            {p.label}
          </div>
        );
      })}
    </div>
  );
}
