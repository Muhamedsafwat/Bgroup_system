import type {
  CrmRole,
  CrmPriority,
  CrmCurrency,
  CrmDealType,
  CrmCallType,
  CrmCallOutcome,
  CrmNextActionType,
} from "@/generated/prisma";

/**
 * Stage codes are free-text now (no Prisma enum). The default seed gives
 * the 11 canonical stages, but admins can add new ones from the stage-
 * config admin page — this type just narrows the shape, not the values.
 *
 * Anywhere the code branches on a specific stage (WON / LOST etc.) keeps
 * working because string equality still matches; nothing assumes "every
 * stage must be in this union" anymore.
 */
export type CrmOpportunityStage = string;

// CRM types

export type SessionUser = {
  id: string;
  email: string;
  fullName: string;
  role: CrmRole;
  entityId: string | null;
  /// When the request is running under impersonation, the admin's
  /// own CrmUserProfile id. Audit writers record this on
  /// `actingAdminId` alongside the normal actor/changedBy/authorId
  /// fields so the audit trail can reveal who actually triggered
  /// the action. Undefined when the user is acting as themselves.
  actingAdminId?: string;
};

export type OpportunityWithRelations = {
  id: string;
  code: string;
  title: string;
  stage: CrmOpportunityStage;
  priority: CrmPriority;
  estimatedValue: number;
  currency: CrmCurrency;
  estimatedValueEGP: number;
  weightedValueEGP: number;
  probabilityPct: number;
  dealType: CrmDealType;
  leadSource: string | null;
  nextAction: CrmNextActionType | null;
  nextActionText: string | null;
  nextActionDate: Date | null;
  expectedCloseDate: Date | null;
  dateProposalSent: Date | null;
  dateClosed: Date | null;
  createdAt: Date;
  updatedAt: Date;
  company: { id: string; nameEn: string; nameAr: string | null };
  primaryContact: { id: string; fullName: string; phone: string | null } | null;
  owner: { id: string; fullName: string; fullNameAr: string | null };
  entity: { id: string; code: string; nameEn: string; nameAr: string; color: string };
  products: Array<{
    id: string;
    product: { id: string; code: string; nameEn: string; nameAr: string };
    quantity: number;
    unitPriceEGP: number;
    discountPct: number;
  }>;
};

export type DashboardKPIs = {
  openOpps: number;
  weightedPipeline: number;
  wonCountMTD: number;
  wonValueMTD: number;
  targetAttainment: number;
  monthlyTarget: number;
};

export type TodayActivity = {
  callsToday: number;
  answeredCalls: number;
  meetingsBooked: number;
  overdueFollowups: number;
  inNegotiation: number;
};

export type PipelineStageSummary = {
  stage: CrmOpportunityStage;
  count: number;
  totalValue: number;
  weightedValue: number;
  percentage: number;
};

export type PipelineEntitySummary = {
  entityCode: string;
  entityName: string;
  entityColor: string;
  count: number;
  totalValue: number;
  weightedValue: number;
};

export type AlertItem = {
  type: "overdue_followup" | "aging_proposal" | "stale_lead" | "missing_next_action";
  opportunityId: string;
  opportunityCode: string;
  companyName: string;
  daysCount: number;
};

export type LeaderboardEntry = {
  userId: string;
  userName: string;
  entityCode: string;
  entityColor: string;
  openOpps: number;
  weightedPipeline: number;
  wonCount: number;
  wonValue: number;
  attainment: number;
};

export type {
  CrmRole,
  CrmPriority,
  CrmCurrency,
  CrmDealType,
  CrmCallType,
  CrmCallOutcome,
  CrmNextActionType,
};
