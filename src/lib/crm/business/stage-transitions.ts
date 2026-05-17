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

  // Moving to WON
  if (toStage === "WON") {
    const fromOrder = STAGE_ORDER[fromStage];
    if (fromOrder < STAGE_ORDER.NEGOTIATION) {
      return {
        allowed: true,
        warning: "Closing from an early stage — are you sure?",
      };
    }
    return { allowed: true };
  }

  const fromOrder = STAGE_ORDER[fromStage];
  const toOrder = STAGE_ORDER[toStage];

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
