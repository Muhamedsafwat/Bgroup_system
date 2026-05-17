import type { CrmNextActionType } from "@/generated/prisma";
import { isTerminalStage } from "./stage-transitions";
import type { CrmOpportunityStage } from "@/types";

type AlertableOpp = {
  id: string;
  code: string;
  stage: CrmOpportunityStage;
  nextAction: CrmNextActionType | null;
  nextActionDate: Date | null;
  dateProposalSent: Date | null;
  createdAt: Date;
  company: { nameEn: string };
};

function daysSince(date: Date | null): number {
  if (!date) return 0;
  const now = new Date();
  const d = new Date(date);
  return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}

export function getOverdueFollowups(opps: AlertableOpp[]) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return opps
    .filter((opp) => {
      if (isTerminalStage(opp.stage)) return false;
      if (!opp.nextActionDate) return false;
      const actionDate = new Date(opp.nextActionDate);
      actionDate.setHours(0, 0, 0, 0);
      return actionDate < today;
    })
    .map((opp) => ({
      type: "overdue_followup" as const,
      opportunityId: opp.id,
      opportunityCode: opp.code,
      companyName: opp.company.nameEn,
      daysCount: daysSince(opp.nextActionDate),
    }));
}

export function getAgingProposals(
  opps: AlertableOpp[],
  agingDays: number = 14
) {
  return opps
    .filter(
      (opp) =>
        opp.stage === "PROPOSAL_SENT" &&
        opp.dateProposalSent &&
        daysSince(opp.dateProposalSent) > agingDays
    )
    .map((opp) => ({
      type: "aging_proposal" as const,
      opportunityId: opp.id,
      opportunityCode: opp.code,
      companyName: opp.company.nameEn,
      daysCount: daysSince(opp.dateProposalSent),
    }));
}

export function getStaleLeads(opps: AlertableOpp[], staleDays: number = 30) {
  return opps
    .filter(
      (opp) =>
        (opp.stage === "NEW" || opp.stage === "CONTACTED") &&
        daysSince(opp.createdAt) > staleDays
    )
    .map((opp) => ({
      type: "stale_lead" as const,
      opportunityId: opp.id,
      opportunityCode: opp.code,
      companyName: opp.company.nameEn,
      daysCount: daysSince(opp.createdAt),
    }));
}

export function getMissingNextActions(opps: AlertableOpp[]) {
  return opps
    .filter(
      (opp) => !isTerminalStage(opp.stage) && !opp.nextAction
    )
    .map((opp) => ({
      type: "missing_next_action" as const,
      opportunityId: opp.id,
      opportunityCode: opp.code,
      companyName: opp.company.nameEn,
      daysCount: 0,
    }));
}

/**
 * Pipeline hygiene score (0-100):
 * - 40% weight: % of opps with valid nextAction
 * - 30% weight: % of opps within SLA (not overdue)
 * - 30% weight: % of opps with recent activity (placeholder — always 100 in v1)
 */
export function computeHygieneScore(opps: AlertableOpp[]): number {
  const active = opps.filter((opp) => !isTerminalStage(opp.stage));
  if (active.length === 0) return 100;

  const withNextAction = active.filter((o) => o.nextAction && o.nextActionDate);
  const nextActionPct = (withNextAction.length / active.length) * 100;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const notOverdue = active.filter((o) => {
    if (!o.nextActionDate) return false;
    const d = new Date(o.nextActionDate);
    d.setHours(0, 0, 0, 0);
    return d >= today;
  });
  const slaPct = (notOverdue.length / active.length) * 100;

  // v1: assume 100% for recent activity
  const activityPct = 100;

  return Math.round(nextActionPct * 0.4 + slaPct * 0.3 + activityPct * 0.3);
}
