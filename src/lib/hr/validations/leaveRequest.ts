import { z } from 'zod'

export const createLeaveRequestSchema = z.object({
  employee: z.string().optional(),
  leave_type: z.string().min(1, 'leave_type is required'),
  start_date: z.string().min(1, 'start_date is required'),
  end_date: z.string().min(1, 'end_date is required'),
  days_count: z.number().optional(),
  reason: z.string().optional(),
})

export const updateLeaveRequestSchema = z.object({
  leave_type: z.string().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  days_count: z.number().optional(),
  reason: z.string().optional(),
  // audit v12 HIGH (HIGH-58) ultra: status removed — PATCH no longer accepts it
})

// Leave types
export const createLeaveTypeSchema = z.object({
  name_en: z.string().optional(),
  name_ar: z.string().optional(),
  annual_days: z.union([z.number(), z.string()]).optional(),
  is_paid: z.boolean().optional(),
  carry_over_allowed: z.boolean().optional(),
  max_carry_over_days: z.union([z.number(), z.string()]).optional(),
})

export const updateLeaveTypeSchema = createLeaveTypeSchema.partial()
