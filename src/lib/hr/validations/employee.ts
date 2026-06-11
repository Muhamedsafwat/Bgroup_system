import { z } from 'zod'

// SECURITY (audit v11 HIGH): bound every string field; cap salary;
// allowlist currency to ISO-4217-ish codes used in this app.
const ALLOWED_CURRENCIES = ['EGP', 'USD', 'EUR', 'GBP', 'SAR', 'AED'] as const

export const createEmployeeSchema = z.object({
  full_name_en: z.string().min(1, 'Full name is required').max(120),
  full_name_ar: z.string().max(120).optional(),
  national_id: z.string().max(40).optional(),
  email: z.string().email('Invalid email').max(200).optional(),
  work_email: z.string().email('Invalid email').max(200).optional(),
  phone: z.string().max(40).optional(),
  date_of_birth: z.string().max(40).optional(),
  gender: z.enum(['M', 'F', 'male', 'female', '']).optional(),
  address: z.string().max(500).optional(),
  company: z.string({ error: 'Company is required' }).min(1, 'Company is required').max(40),
  department: z.union([z.number(), z.string().max(40)]).optional(),
  shift: z.union([z.number(), z.string().max(40)]).optional(),
  direct_manager: z.union([z.number(), z.string().max(40)]).optional(),
  position_en: z.string().max(120).optional(),
  position_ar: z.string().max(120).optional(),
  level: z.string().max(20).optional(),
  employment_type: z.string().max(20).optional(),
  work_model: z.string().max(20).optional(),
  base_salary: z.union([z.number(), z.string()]).transform((val) => {
    const n = typeof val === 'number' ? val : parseFloat(String(val))
    return isNaN(n) ? undefined : n
  }).pipe(
    z.number({ error: 'Base salary is required' })
      .positive('Salary must be positive')
      .max(10_000_000, 'Salary is unrealistically high')
  ),
  currency: z
    .string()
    .max(3)
    .refine((c) => (ALLOWED_CURRENCIES as readonly string[]).includes(c), {
      message: `Currency must be one of: ${ALLOWED_CURRENCIES.join(', ')}`,
    })
    .default('EGP'),
  bank_name: z.string().max(100).optional(),
  bank_account: z.string().max(40).optional(),
  iban: z.string().max(40).optional(),
  personal_email: z.string().email().max(200).optional().or(z.literal('')),
  emergency_contact_name: z.string().max(120).optional(),
  emergency_contact_phone: z.string().max(40).optional(),
  contract_start: z.string().max(40).optional(),
  contract_end: z.string().max(40).optional(),
  probation_end: z.string().max(40).optional(),
  status: z.string().max(40).optional(),
})
