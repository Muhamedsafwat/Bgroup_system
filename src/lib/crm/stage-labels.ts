import type { CrmOpportunityStage } from "@/types";
/**
 * Static fallback labels for the seed stage codes. These are only consulted
 * when no admin-curated CrmStageConfig row exists for a given stage — the
 * pipeline UI now fetches admin labels from /api/crm/stages and prefers
 * those. Keep these in sync with the dictionaries.ts entries so that any
 * server-rendered surface that hasn't fetched stages yet renders the same
 * names the admin sees in Stage Config.
 */
export const STAGE_LABEL_AR: Record<string, string> = {
  NEW: "فرصة جديدة",
  CONTACTED: "تم التواصل",
  DISCOVERY: "اجتماع استكشافي",
  QUALIFIED: "مؤهل",
  TECH_MEETING: "اجتماع فني ثاني",
  PROPOSAL_SENT: "إرسال العرض",
  NEGOTIATION: "تفاوض",
  VERBAL_YES: "موافقة شفهية",
  POSTPONED: "مؤجل",
  WON: "ربحت",
  LOST: "خسرت",
};

export const STAGE_LABEL_EN: Record<string, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  DISCOVERY: "Discovery",
  QUALIFIED: "Qualified",
  TECH_MEETING: "Tech Meeting",
  PROPOSAL_SENT: "Proposal Sent",
  NEGOTIATION: "Negotiation",
  VERBAL_YES: "Verbal Yes",
  POSTPONED: "Postponed",
  WON: "Won",
  LOST: "Lost",
};

/** The 8 stages the sales-board dashboard renders by default. */
export const SPEC_STAGES: CrmOpportunityStage[] = [
  "NEW",
  "CONTACTED",
  "DISCOVERY",
  "TECH_MEETING",
  "QUALIFIED",
  "WON",
  "LOST",
  "POSTPONED",
];

/** Categorical bucket — useful for color-coding charts. */
export function stageBucket(stage: CrmOpportunityStage): "active" | "won" | "lost" | "paused" {
  if (stage === "WON") return "won";
  if (stage === "LOST") return "lost";
  if (stage === "POSTPONED") return "paused";
  return "active";
}

/**
 * Resolve a display label for any stage — seeded or admin-added. Falls
 * back to humanising the code (e.g. "FIELD_TRIAL" → "Field Trial") so the
 * UI never shows the raw upper-snake code to end users.
 */
export function stageLabel(stage: string, locale: "en" | "ar" = "en"): string {
  const dict = locale === "ar" ? STAGE_LABEL_AR : STAGE_LABEL_EN;
  return (
    dict[stage] ??
    stage
      .toLowerCase()
      .split("_")
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
}
