import { z } from 'zod'

// audit v12 HIGH (HIGH-56) recheck: shared bounded deduction_pct — clamp to [0, 100] for all incident and offense schemas
const boundedDeductionPct = z.union([
  z.number().min(0, 'deduction_pct must be >= 0').max(100, 'deduction_pct must be <= 100'),
  z.string().transform((val) => {
    const n = parseFloat(val)
    return isNaN(n) ? 0 : n
  }).pipe(z.number().min(0, 'deduction_pct must be >= 0').max(100, 'deduction_pct must be <= 100')),
]).optional()

export const createIncidentSchema = z.object({
  employee: z.string().min(1, 'employee is required'),
  violation_rule: z.string().min(1, 'violation_rule is required'),
  incident_date: z.string().min(1, 'incident_date is required'),
  deduction_pct: boundedDeductionPct,
  action_taken: z.string().optional(),
  status: z.string().optional(),
  comments: z.string().optional(),
  evidence: z.string().optional().nullable(),
})

export const updateIncidentSchema = z.object({
  employee: z.string().optional(),
  violation_rule: z.string().optional(),
  incident_date: z.string().optional(),
  action_taken: z.string().optional(),
  deduction_pct: boundedDeductionPct,
  deduction_amount: z.union([z.number().min(0), z.string()]).optional(),
  status: z.string().optional(),
  comments: z.string().optional(),
  evidence: z.string().optional().nullable(),
  dismissed_reason: z.string().optional(),
})

export const resolveIncidentSchema = z.object({
  action: z.enum(['apply', 'dismiss']).optional(),
  dismissed_reason: z.string().optional(),
})

// Violation categories
export const createViolationCategorySchema = z.object({
  code: z.string().min(1, 'code is required'),
  name_en: z.string().min(1, 'name_en is required'),
  name_ar: z.string().optional(),
  reset_period_months: z.number().optional(),
})

export const updateViolationCategorySchema = createViolationCategorySchema.partial()

// Violation rules
const offenseSchema = z.object({
  action: z.string().optional(),
  deduction_pct: boundedDeductionPct,
}).optional()

export const createViolationRuleSchema = z.object({
  code: z.string().min(1, 'code is required'),
  name_en: z.string().min(1, 'name_en is required'),
  name_ar: z.string().optional(),
  category: z.string().min(1, 'category is required'),
  offense_1: offenseSchema,
  offense_2: offenseSchema,
  offense_3: offenseSchema,
  offense_4: offenseSchema,
  offense_5: offenseSchema,
})

export const updateViolationRuleSchema = createViolationRuleSchema.partial()
