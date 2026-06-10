import { z } from 'zod'

// BUG FIX (audit v11 MEDIUM #58): clamp numeric inputs. NaN/Infinity
// would otherwise poison `calculatedAmount` math; unbounded strings
// reached the DB.
const finiteNumber = z.union([z.number(), z.string()]).transform((v) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  if (!Number.isFinite(n)) throw new Error('must be a finite number')
  return n
}).pipe(z.number().nonnegative().max(10_000))

const hoursNumber = z.union([z.number(), z.string()]).transform((v) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  if (!Number.isFinite(n)) throw new Error('must be a finite number')
  return n
}).pipe(z.number().nonnegative().max(24))

// Policies
export const createOvertimePolicySchema = z.object({
  type_code: z.string().min(1, 'type_code is required').max(40),
  name_en: z.string().min(1, 'name_en is required').max(120),
  name_ar: z.string().max(120).optional(),
  rate_multiplier: finiteNumber,
  min_hours: hoursNumber.optional(),
  max_hours_per_day: hoursNumber.optional(),
  max_hours_per_month: finiteNumber.optional(),
  requires_pre_approval: z.boolean().optional(),
  approval_authority: z.string().max(60).optional(),
})

export const updateOvertimePolicySchema = createOvertimePolicySchema.partial()

// Requests
export const createOvertimeRequestSchema = z.object({
  employee: z.string().max(40).optional(),
  overtime_type: z.string().min(1, 'overtime_type is required').max(40),
  date: z.string().min(1, 'date is required').max(40),
  hours_requested: hoursNumber,
  reason: z.string().max(2000).optional(),
  evidence: z.string().max(2000).optional().nullable(),
})

export const updateOvertimeRequestSchema = z.object({
  overtime_type: z.string().max(40).optional(),
  date: z.string().max(40).optional(),
  hours_requested: hoursNumber.optional(),
  reason: z.string().max(2000).optional(),
  evidence: z.string().max(2000).optional().nullable(),
})

export const denyOvertimeRequestSchema = z.object({
  denial_reason: z.string().max(2000).optional(),
  reason: z.string().max(2000).optional(),
})
