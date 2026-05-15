import { z } from "zod";

export const createOpportunitySchema = z.object({
  companyId: z.string().min(1, "Company is required"),
  primaryContactId: z.string().optional(),
  entityId: z.string().min(1, "Entity is required"),
  title: z.string().optional(),
  priority: z.enum(["HOT", "WARM", "COLD"]).optional(),
  leadSource: z.string().optional(),
  dealType: z
    .enum(["ONE_TIME", "MONTHLY", "ANNUAL", "SAAS", "MIXED", "RETAINER"])
    .optional(),
  estimatedValue: z.number().positive("Value must be positive"),
  currency: z.enum(["EGP", "USD", "SAR", "AED", "QAR"]).optional(),
  expectedCloseDate: z.string().optional(),
  nextAction: z.enum([
    "FOLLOW_UP",
    "CALL_LATER",
    "REOFFER_REPRICE",
    "PROPOSAL_REQUIRED",
    "WHATSAPP_MESSAGE",
    "SCHEDULE_MEETING",
    "SEND_CONTRACT",
    "COLLECT_PAYMENT",
    "INTERNAL_REVIEW",
    "CEO_APPROVAL",
  ]),
  nextActionText: z.string().optional(),
  nextActionDate: z.string().min(1, "Next action date is required"),
  description: z.string().optional(),
  techRequirements: z.string().optional(),
  productIds: z.array(z.string()).optional(),
});

export const updateOpportunitySchema = z.object({
  title: z.string().optional(),
  priority: z.enum(["HOT", "WARM", "COLD"]).optional(),
  leadSource: z.string().optional(),
  dealType: z
    .enum(["ONE_TIME", "MONTHLY", "ANNUAL", "SAAS", "MIXED", "RETAINER"])
    .optional(),
  estimatedValue: z.number().positive().optional(),
  currency: z.enum(["EGP", "USD", "SAR", "AED", "QAR"]).optional(),
  expectedCloseDate: z.string().optional(),
  nextAction: z
    .enum([
      "FOLLOW_UP",
      "CALL_LATER",
      "REOFFER_REPRICE",
      "PROPOSAL_REQUIRED",
      "WHATSAPP_MESSAGE",
      "SCHEDULE_MEETING",
      "SEND_CONTRACT",
      "COLLECT_PAYMENT",
      "INTERNAL_REVIEW",
      "CEO_APPROVAL",
    ])
    .optional(),
  nextActionText: z.string().optional(),
  nextActionDate: z.string().optional(),
  description: z.string().optional(),
  techRequirements: z.string().optional(),
  techSupportId: z.string().optional(),
  deliveryOwnerId: z.string().optional(),
  primaryContactId: z.string().optional(),
  /// When present, REPLACES the current product line-up. The action diffs
  /// against the existing rows so unchanged products are preserved and any
  /// removed ones are deleted (cascade-safe — quote/commission FK references
  /// the opportunity, not these line rows).
  productIds: z.array(z.string()).optional(),
});

export const stageChangeSchema = z.object({
  toStage: z.enum([
    "NEW",
    "CONTACTED",
    "DISCOVERY",
    "QUALIFIED",
    "TECH_MEETING",
    "PROPOSAL_SENT",
    "NEGOTIATION",
    "VERBAL_YES",
    "POSTPONED",
    "WON",
    "LOST",
  ]),
  lossReasonId: z.string().optional(),
  lostToCompetitor: z.string().optional(),
  proposalUrl: z.string().optional(),
  depositAmount: z.number().optional(),
  depositDate: z.string().optional(),
  contractUrl: z.string().optional(),
});

export type CreateOpportunityInput = z.infer<typeof createOpportunitySchema>;
export type UpdateOpportunityInput = z.infer<typeof updateOpportunitySchema>;
export type StageChangeInput = z.infer<typeof stageChangeSchema>;
