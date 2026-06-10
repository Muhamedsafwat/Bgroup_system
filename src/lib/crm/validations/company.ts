import { z } from "zod";
import { safeUrlField } from "./url";

// SECURITY (audit v11 HIGH): bound every string. Defends against
// multi-MB inputs that bloat the DB and reach UI surfaces.
export const createCompanySchema = z.object({
  nameEn: z.string().trim().min(1, "Company name is required").max(200),
  nameAr: z.string().trim().max(200).optional(),
  brandName: z.string().trim().max(120).optional(),
  industry: z.string().trim().max(120).optional(),
  // safeUrlField enforces http/https only — blocks javascript: / data:
  // schemes that would otherwise render as live links in the UI.
  website: safeUrlField.optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional(),
  address: z.string().trim().max(500).optional(),
  country: z.string().trim().max(80).optional(),
  city: z.string().trim().max(80).optional(),
  category: z
    .enum(["A_PLUS", "A", "B_PLUS", "B", "C_PLUS", "C"])
    .optional(),
  notes: z.string().trim().max(5000).optional(),
});

export const updateCompanySchema = createCompanySchema.partial();

export type CreateCompanyInput = z.infer<typeof createCompanySchema>;
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;
