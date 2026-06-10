import { z } from 'zod'

// SECURITY (audit v11 HIGH): bound every string field. Previously
// `comments`, `evidence`, etc. accepted multi-MB inputs.
export const createBonusSchema = z.object({
  employee: z.string().min(1, 'employee is required').max(40),
  bonus_rule: z.string().min(1, 'bonus_rule is required').max(40),
  bonus_date: z.string().min(1, 'bonus_date is required').max(40),
  comments: z.string().max(2000).optional(),
  evidence: z.string().max(2000).optional().nullable(),
})

export const updateBonusSchema = z.object({
  employee: z.string().max(40).optional(),
  bonus_rule: z.string().max(40).optional(),
  bonus_date: z.string().max(40).optional(),
  comments: z.string().max(2000).optional(),
  evidence: z.string().max(2000).optional().nullable(),
})

export const cancelBonusSchema = z.object({
  dismissed_reason: z.string().max(2000).optional(),
})

// Bonus categories
export const createBonusCategorySchema = z.object({
  code: z.string().min(1, 'code is required').max(40),
  name_en: z.string().min(1, 'name_en is required').max(200),
  name_ar: z.string().max(200).optional(),
})

export const updateBonusCategorySchema = createBonusCategorySchema.partial()

// Bonus rules
export const createBonusRuleSchema = z.object({
  code: z.string().min(1, 'code is required').max(40),
  name_en: z.string().min(1, 'name_en is required').max(200),
  name_ar: z.string().max(200).optional(),
  category: z.string().min(1, 'category is required').max(40),
  value_type: z.string().min(1, 'value_type is required').max(20),
  value: z.union([z.number().finite().max(1_000_000_000), z.string().max(40)]),
  frequency: z.string().max(40).optional(),
  max_per_month: z.number().int().min(0).max(1000).optional(),
  approval_authority: z.string().max(60).optional(),
  trigger_condition: z.string().max(2000).optional(),
})

export const updateBonusRuleSchema = createBonusRuleSchema.partial()
