import { z } from "zod";

// ========== USERS ==========

export const createUserSchema = z.object({
  fullName: z.string().min(1, "Full name is required"),
  fullNameAr: z.string().optional(),
  email: z.string().email("Valid email is required"),
  password: z.string().min(6, "Password must be at least 6 characters").max(200),
  role: z.enum(["ADMIN", "MANAGER", "ASSISTANT", "REP", "ACCOUNT_MGR"]),
  entityId: z.string().optional(),
  monthlyTargetEGP: z.number().min(0).optional(),
  /// The sales manager this rep reports to. Only meaningful for REPs and
  /// ACCOUNT_MGRs; other roles ignore this field.
  managerId: z.string().optional(),
});

export const updateUserSchema = z.object({
  fullName: z.string().min(1).optional(),
  fullNameAr: z.string().optional(),
  email: z.string().email().optional(),
  /// Only set when the admin explicitly wants to change the password — blank
  /// in the form means "leave it alone", so this stays undefined.
  password: z.string().min(6).max(200).optional(),
  role: z.enum(["ADMIN", "MANAGER", "ASSISTANT", "REP", "ACCOUNT_MGR"]).optional(),
  entityId: z.string().nullable().optional(),
  monthlyTargetEGP: z.number().min(0).nullable().optional(),
  managerId: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

// ========== ENTITIES ==========

const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export const createEntitySchema = z.object({
  code: z
    .string()
    .min(1, "Code is required")
    .max(20)
    .regex(/^[A-Za-z0-9_-]+$/, "Code: letters, numbers, _ and - only"),
  nameEn: z.string().min(1, "English name is required").max(80),
  nameAr: z.string().min(1, "Arabic name is required").max(80),
  color: z.string().regex(HEX_COLOR, "Color must be a hex like #3b82f6"),
});

export const updateEntitySchema = z.object({
  nameEn: z.string().min(1).max(80).optional(),
  nameAr: z.string().min(1).max(80).optional(),
  color: z.string().regex(HEX_COLOR, "Color must be a hex like #3b82f6").optional(),
  active: z.boolean().optional(),
});

// ========== FX RATES ==========

export const updateFxRateSchema = z.object({
  currency: z.string().min(1, "CrmCurrency is required"),
  rate: z.number().positive("Rate must be positive"),
});

// ========== STAGE CONFIGS ==========

export const updateStageConfigSchema = z.object({
  probabilityPct: z.number().min(0).max(100).optional(),
  slaHours: z.number().min(0).nullable().optional(),
  displayOrder: z.number().int().min(0).max(99).optional(),
  customLabelEn: z.string().trim().max(80).nullable().optional(),
  customLabelAr: z.string().trim().max(80).nullable().optional(),
  isActive: z.boolean().optional(),
});

// ========== LOSS REASONS ==========

export const createLossReasonSchema = z.object({
  labelEn: z.string().min(1, "English label is required"),
  labelAr: z.string().min(1, "Arabic label is required"),
  code: z.string().min(1, "Code is required"),
  entityId: z.string().optional(),
});

export const updateLossReasonSchema = z.object({
  labelEn: z.string().min(1).optional(),
  labelAr: z.string().min(1).optional(),
  active: z.boolean().optional(),
});

// ========== LEAD SOURCES ==========

export const createLeadSourceSchema = z.object({
  labelEn: z.string().min(1, "English label is required"),
  labelAr: z.string().min(1, "Arabic label is required"),
  code: z.string().min(1, "Code is required"),
  entityId: z.string().optional(),
});

export const updateLeadSourceSchema = z.object({
  labelEn: z.string().min(1).optional(),
  labelAr: z.string().min(1).optional(),
  code: z.string().min(1).optional(),
  active: z.boolean().optional(),
});
