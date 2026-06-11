import { z } from 'zod'

// BUG FIX (audit v11 MEDIUM #58): clamp month + year to sane ranges.
// Previously the schema accepted `month=999999` or `year='NaN'`
// (parseInt converts 'NaN' to NaN → Decimal math poisoned).
const monthNumber = z.union([z.number(), z.string()]).transform((v) => {
  const n = typeof v === 'number' ? v : parseInt(String(v), 10)
  if (!Number.isFinite(n)) throw new Error('month must be a finite number')
  return n
}).pipe(z.number().int().min(1).max(12))

const yearNumber = z.union([z.number(), z.string()]).transform((v) => {
  const n = typeof v === 'number' ? v : parseInt(String(v), 10)
  if (!Number.isFinite(n)) throw new Error('year must be a finite number')
  return n
}).pipe(z.number().int().min(2000).max(2100))

// Calculate uses company_id (note distinct name from monthly endpoints that use company)
export const payrollCalculateSchema = z.object({
  company_id: z.string().min(1, 'company_id is required').max(40),
  month: monthNumber,
  year: yearNumber,
})

// Monthly lock/finalize/paid/recalculate share shape
export const payrollMonthlyActionSchema = z.object({
  company: z.string().min(1, 'company is required').max(40),
  month: monthNumber.optional(),
  year: yearNumber.optional(),
})

// Periods
export const createPayrollPeriodSchema = z.object({
  company: z.string().min(1, 'company is required').max(40),
  month: monthNumber,
  year: yearNumber,
})

export const updatePayrollPeriodSchema = z.object({
  status: z.string().max(20).optional(),
  month: monthNumber.optional(),
  year: yearNumber.optional(),
})

// Monthly salary PATCH (edit notes only)
export const updateMonthlySalarySchema = z.object({
  notes: z.string().max(2000).optional(),
})
