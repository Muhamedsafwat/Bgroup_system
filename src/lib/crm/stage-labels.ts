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

/**
 * Canonical seed stage list, in the order the admin Stage Config seed
 * installs them. This is the SAME 11-stage list every CrmStageConfig
 * row references — keep them aligned so the pipeline fallback (when
 * /api/crm/stages hasn't loaded yet) and the sales-board tiles match
 * what the admin sees in /crm/admin/stage-config. The previous 8-stage
 * subset hid PROPOSAL_SENT / NEGOTIATION / VERBAL_YES from the pipeline
 * during the loading window AND from the sales-board permanently — the
 * "stages in settings vs pipeline" divergence the user reported.
 */
export const SPEC_STAGES: CrmOpportunityStage[] = [
  "NEW",
  "CONTACTED",
  "DISCOVERY",
  "QUALIFIED",
  "TECH_MEETING",
  "PROPOSAL_SENT",
  "NEGOTIATION",
  "VERBAL_YES",
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
