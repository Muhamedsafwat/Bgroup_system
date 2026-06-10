import { z } from "zod";

/**
 * URL field shared across opportunity write surfaces. Accepts http/https
 * only — rejects javascript:/data:/file: URIs that would otherwise be
 * rendered as &lt;a href&gt; in the opp detail UI (stored XSS). Allows empty
 * string and null so optional fields stay clearable.
 */
const safeUrlField = z
  .string()
  .trim()
  .max(2000, "URL is too long")
  .refine(
    (v) => {
      if (!v) return true;
      try {
        const u = new URL(v);
        return u.protocol === "http:" || u.protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "Must be an http(s) URL" },
  );

// Reasonable upper bound on opportunity monetary values to keep Decimal
// math + Number conversions inside safe-integer range. The DB column is
// Decimal(14,2) → max ~99,999,999,999.99. We cap below that to leave
// headroom for weighted/EGP-converted derivatives.
const MAX_OPPORTUNITY_VALUE = 1_000_000_000_000; // 1 trillion

/**
 * Repeatable contact row attached to an opportunity. `name` is the only
 * required field — the rep often knows "Ahmed from procurement" before
 * they've captured a phone or email. `id` is present on rows that already
 * exist (used to update in place); new rows omit it.
 */
export const opportunityContactSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "Contact name is required").max(200),
  role: z.string().trim().max(120).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  email: z.string().trim().max(200).optional().nullable(),
  whatsapp: z.string().trim().max(40).optional().nullable(),
  isPrimary: z.boolean().optional(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

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
  title: z.string().trim().max(200).optional(),
  priority: z.enum(["HOT", "WARM", "COLD"]).optional(),
  leadSource: z.string().trim().max(120).optional(),
  dealType: z
    .enum(["ONE_TIME", "MONTHLY", "ANNUAL", "SAAS", "MIXED", "RETAINER"])
    .optional(),
  estimatedValue: z
    .number()
    .positive("Value must be positive")
    .max(MAX_OPPORTUNITY_VALUE, "Value is unrealistically large"),
  currency: z.enum(["EGP", "USD", "SAR", "AED", "QAR"]).optional(),
  expectedCloseDate: z.string().trim().max(40).optional(),
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
  // Long-form fields can be substantial — a tech requirements doc
  // or a deal description copied from email can run into many KB.
  // 100_000 chars covers any realistic input without truncating
  // legacy rows whose payloads exceed the older 10k cap. (A 10k cap
  // here silently broke the edit form's client-side validation for
  // any opp whose description / techRequirements exceeded that — no
  // submit, no toast, the user assumed "Update" did nothing.)
  nextActionText: z.string().trim().max(2_000).optional(),
  nextActionDate: z.string().trim().min(1, "Next action date is required").max(40),
  description: z.string().trim().max(100_000).optional(),
  techRequirements: z.string().trim().max(100_000).optional(),
  productIds: z.array(z.string().min(1)).max(50).optional(),
  /// Owner override — MANAGER + ADMIN can create an opp "on behalf of"
  /// any active rep. The server action enforces the role gate; for REPs
  /// this field is ignored and the caller is always the owner.
  ownerId: z.string().optional(),
  /// Repeatable contact roster — replaces the single-trio
  /// customerContactName/Phone/Email pattern. The first entry (or the
  /// one with `isPrimary: true`) is also written into the legacy free-text
  /// columns so search/list views keep working without a UI sweep.
  contacts: z.array(opportunityContactSchema).optional(),
});

export const updateOpportunitySchema = z.object({
  title: z.string().trim().max(200).optional(),
  customerCompanyName: z.string().trim().min(1).max(200).optional(),
  customerContactName: z.string().trim().max(200).optional(),
  customerContactPhone: z.string().trim().max(40).optional(),
  customerContactEmail: z.string().trim().max(200).optional(),
  priority: z.enum(["HOT", "WARM", "COLD"]).optional(),
  leadSource: z.string().trim().max(120).optional(),
  dealType: z
    .enum(["ONE_TIME", "MONTHLY", "ANNUAL", "SAAS", "MIXED", "RETAINER"])
    .optional(),
  estimatedValue: z
    .number()
    .positive()
    .max(MAX_OPPORTUNITY_VALUE)
    .optional(),
  currency: z.enum(["EGP", "USD", "SAR", "AED", "QAR"]).optional(),
  expectedCloseDate: z.string().trim().max(40).optional(),
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
  // See createOpportunitySchema for the rationale on these caps —
  // the previous 10k / 500 maxes silently blocked the edit form
  // from submitting whenever existing payloads exceeded them.
  nextActionText: z.string().trim().max(2_000).optional(),
  // audit v12 LOW (LOW-1): add .min(1) to reject empty strings, mirroring createOpportunitySchema
  nextActionDate: z.string().trim().min(1, "Next action date is required").max(40).optional(),
  description: z.string().trim().max(100_000).optional(),
  techRequirements: z.string().trim().max(100_000).optional(),
  techSupportId: z.string().optional(),
  deliveryOwnerId: z.string().optional(),
  primaryContactId: z.string().optional(),
  /// When present, REPLACES the current product line-up. The action diffs
  /// against the existing rows so unchanged products are preserved and any
  /// removed ones are deleted (cascade-safe — quote/commission FK references
  /// the opportunity, not these line rows).
  productIds: z.array(z.string()).optional(),
  /// Owner reassignment — MANAGER + ADMIN can move an opp to a different
  /// active rep without going through the bulk-transfer endpoint. The
  /// server action enforces the role gate.
  ownerId: z.string().optional(),
  /// Full contact roster to sync. Rows with an `id` are updated in place;
  /// rows without an id are inserted; previously-existing ids not in this
  /// array are deleted. Pass an empty array to clear every contact.
  contacts: z.array(opportunityContactSchema).optional(),
});

export const stageChangeSchema = z.object({
  // Stage codes are admin-curated free text. The server action verifies
  // the target stage exists in CrmStageConfig before applying it.
  toStage: z.string().trim().min(1, "Stage is required").max(40),
  lossReasonId: z.string().optional(),
  lostToCompetitor: z.string().trim().max(200).optional(),
  // proposalUrl + contractUrl are rendered as `<a href>` on the opp
  // detail page. Without the scheme check, `javascript:alert(1)` would
  // be persisted and clicked. safeUrlField enforces http(s) only.
  proposalUrl: safeUrlField.optional(),
  depositAmount: z
    .number()
    .nonnegative()
    .max(MAX_OPPORTUNITY_VALUE)
    .optional(),
  depositDate: z.string().trim().max(40).optional(),
  contractUrl: safeUrlField.optional(),
});

export type CreateOpportunityInput = z.infer<typeof createOpportunitySchema>;
export type UpdateOpportunityInput = z.infer<typeof updateOpportunitySchema>;
export type StageChangeInput = z.infer<typeof stageChangeSchema>;
