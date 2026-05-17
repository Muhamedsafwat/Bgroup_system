import { z } from "zod";

export const createOpportunitySchema = z.object({
  /// Customer company name as free text. Reps type the prospect's company
  /// name here — there's no curated directory of customer companies. The
  /// `companyId` FK is kept for backwards-compat with admin-curated /
  /// principal records but isn't required on create.
  customerCompanyName: z.string().trim().min(1, "Customer company name is required").max(200),
  /// Contact info captured directly on the opp. All optional — reps often
  /// log an opp before they've talked to a named person.
  customerContactName: z.string().trim().max(200).optional(),
  customerContactPhone: z.string().trim().max(40).optional(),
  customerContactEmail: z.string().trim().max(200).optional(),
  companyId: z.string().optional(),
  primaryContactId: z.string().optional(),
  entityId: z.string().min(1, "Select the company we're selling for"),
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
  customerCompanyName: z.string().trim().min(1).max(200).optional(),
  customerContactName: z.string().trim().max(200).optional(),
  customerContactPhone: z.string().trim().max(40).optional(),
  customerContactEmail: z.string().trim().max(200).optional(),
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
  // Stage codes are admin-curated free text. The server action verifies
  // the target stage exists in CrmStageConfig before applying it.
  toStage: z.string().trim().min(1, "Stage is required").max(40),
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
