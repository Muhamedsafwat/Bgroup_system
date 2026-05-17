import type { CrmNextActionType } from "@/generated/prisma";
import { isTerminalStage } from "./stage-transitions";
import type { CrmOpportunityStage } from "@/types";

export function requiresNextAction(stage: CrmOpportunityStage): boolean {
  return !isTerminalStage(stage);
}

export function validateNextAction(opp: {
  stage: CrmOpportunityStage;
  nextAction: CrmNextActionType | null;
  nextActionDate: Date | null;
}): { valid: boolean; error?: string } {
  if (!requiresNextAction(opp.stage)) {
    return { valid: true };
  }

  if (!opp.nextAction || !opp.nextActionDate) {
    return {
      valid: false,
      error: "Next action and date are required for all open opportunities",
    };
  }

  return { valid: true };
}

export function isOverdue(nextActionDate: Date | null): boolean {
  if (!nextActionDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const actionDate = new Date(nextActionDate);
  actionDate.setHours(0, 0, 0, 0);
  return actionDate < today;
}

export function getOverdueOpportunities<
  T extends { nextActionDate: Date | null; stage: CrmOpportunityStage }
>(opps: T[]): T[] {
  return opps.filter(
    (opp) =>
      !isTerminalStage(opp.stage) && isOverdue(opp.nextActionDate)
  );
}
