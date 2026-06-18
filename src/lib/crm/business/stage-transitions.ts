import type { CrmOpportunityStage } from "@/types";
export const STAGE_ORDER: Record<CrmOpportunityStage, number> = {
  NEW: 0,
  CONTACTED: 1,
  DISCOVERY: 2,
  QUALIFIED: 3,
  TECH_MEETING: 4,
  PROPOSAL_SENT: 5,
  NEGOTIATION: 6,
  VERBAL_YES: 7,
  POSTPONED: 8,
  WON: 9,
  LOST: 10,
};

export const ACTIVE_STAGES: CrmOpportunityStage[] = [
  "NEW",
  "CONTACTED",
  "DISCOVERY",
  "QUALIFIED",
  "TECH_MEETING",
  "PROPOSAL_SENT",
  "NEGOTIATION",
  "VERBAL_YES",
  "POSTPONED",
];

export const TERMINAL_STAGES: CrmOpportunityStage[] = ["WON", "LOST"];

export function isTerminalStage(stage: CrmOpportunityStage): boolean {
  return stage === "WON" || stage === "LOST";
}

export function isActiveStage(stage: CrmOpportunityStage): boolean {
  return !isTerminalStage(stage);
}

export type TransitionResult = {
  allowed: boolean;
  warning?: string;
  error?: string;
};

/**
 * Check if a stage transition is allowed.
 * Forward moves: max 2 stages ahead (with warning if skipping 1).
 * Backward moves: always allowed.
 * Terminal stages: WON/LOST can't move forward. POSTPONED can reopen.
 */
export function canTransition(
  fromStage: CrmOpportunityStage,
  toStage: CrmOpportunityStage
): TransitionResult {
  if (fromStage === toStage) {
    return { allowed: false, error: "Already in this stage" };
  }

  // Can't move from WON/LOST to anything except POSTPONED -> reopen
  if (fromStage === "WON" || fromStage === "LOST") {
    return { allowed: false, error: "Cannot transition from a terminal stage" };
  }

  // POSTPONED can go to any earlier stage (reopen)
  if (fromStage === "POSTPONED") {
    if (toStage === "WON") {
      return { allowed: false, error: "Cannot go directly from Postponed to Won" };
    }
    return { allowed: true };
  }

  // Moving to LOST or POSTPONED is always allowed
  if (toStage === "LOST" || toStage === "POSTPONED") {
    return { allowed: true };
  }

  // stages-fix (2026-06-18): admins can define CUSTOM stages in
  // CrmStageConfig (e.g. PILOT, FIELD_TRIAL) that aren't in the seed
  // STAGE_ORDER. The previous HIGH-24 guard hard-rejected anything not
  // in STAGE_ORDER, which made every custom stage un-enterable — the
  // exact "stages in settings don't match the pipeline" complaint.
  //
  // New rule: the skip-distance / ordering checks only apply when BOTH
  // stages are part of the canonical ordered set. If either side is a
  // custom stage we can't reason about its position, so we allow the
  // move (the terminal-stage guards above still hold). This keeps the
  // ordered seed pipeline strict while letting custom stages work.
  const fromOrder = STAGE_ORDER[fromStage];
  const toOrder = STAGE_ORDER[toStage];
  const bothOrdered = fromOrder !== undefined && toOrder !== undefined;

  // Moving to WON
  if (toStage === "WON") {
    if (bothOrdered && fromOrder < STAGE_ORDER.NEGOTIATION) {
      return {
        allowed: true,
        warning: "Closing from an early stage — are you sure?",
      };
    }
    return { allowed: true };
  }

  // One or both stages are custom (outside the ordered seed) — allow.
  if (!bothOrdered) {
    return { allowed: true };
  }

  // Backward always allowed
  if (toOrder < fromOrder) {
    return { allowed: true };
  }

  // Forward: max 2 stages
  const diff = toOrder - fromOrder;
  if (diff > 2) {
    return {
      allowed: false,
      error: "Cannot skip more than 2 stages forward",
    };
  }

  if (diff === 2) {
    return {
      allowed: true,
      warning: "Skipping one stage — make sure the entry criteria are met",
    };
  }

  return { allowed: true };
}

export type TransitionRequirements = {
  lossReasonRequired: boolean;
  depositRequired: boolean;
  proposalUrlRequired: boolean;
};

export function getTransitionRequirements(
  toStage: CrmOpportunityStage
): TransitionRequirements {
  return {
    lossReasonRequired: toStage === "LOST",
    depositRequired: toStage === "WON",
    proposalUrlRequired: toStage === "PROPOSAL_SENT",
  };
}
