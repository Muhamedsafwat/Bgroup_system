import { z } from "zod";
import { safeUrlField } from "./url";

// SECURITY (audit v11 HIGH): bound every string field.
export const createContactSchema = z.object({
  companyId: z.string().trim().min(1, "Company is required").max(40),
  fullName: z.string().trim().min(1, "Contact name is required").max(120),
  role: z.string().trim().max(120).optional(),
  email: z.string().email().max(200).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional(),
  whatsapp: z.string().trim().max(40).optional(),
  isPrimary: z.boolean().optional(),
  // linkedIn flows into the contact card as a clickable link →
  // gate scheme + length the same way other URL fields do.
  linkedIn: safeUrlField.optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional(),
});

export const updateContactSchema = createContactSchema.partial().omit({
  companyId: true,
});

export type CreateContactInput = z.infer<typeof createContactSchema>;
export type UpdateContactInput = z.infer<typeof updateContactSchema>;
