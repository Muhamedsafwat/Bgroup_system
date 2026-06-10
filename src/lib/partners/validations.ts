import { z } from "zod";
import {
  PartnerLeadStatus,
  PartnerDealStatus,
  PartnerCommissionStatus,
} from "@/generated/prisma";

// ---------- Partners ----------

export const createPartnerSchema = z.object({
  email: z.email(),
  password: z.string().min(6).max(255),
  name: z.string().min(2).max(255),
  companyName: z.string().min(2).max(255),
  contactPhone: z.string().max(20).optional(),
  commissionRate: z.number().min(0).max(100).optional(),
});

export const updatePartnerSchema = z.object({
  companyName: z.string().max(255).optional(),
  contactPhone: z.string().max(20).optional(),
  commissionRate: z.number().min(0).max(100).optional(),
  isActive: z.boolean().optional(),
});

export const updateMyProfileSchema = z.object({
  companyName: z.string().max(255).optional(),
  contactPhone: z.string().max(20).optional(),
  name: z.string().max(255).optional(),
});

// ---------- Services ----------

export const createServiceSchema = z.object({
  name: z.string().min(2).max(255),
  description: z.string().max(1000).optional(),
  basePrice: z.number().min(0),
});

export const updateServiceSchema = z.object({
  name: z.string().max(255).optional(),
  description: z.string().max(1000).optional(),
  basePrice: z.number().min(0).optional(),
  isActive: z.boolean().optional(),
});

// ---------- Leads ----------

export const createLeadSchema = z.object({
  name: z.string().min(2).max(255),
  email: z.email().optional(),
  phone: z.string().max(20).optional(),
  company: z.string().max(255).optional(),
  notes: z.string().max(2000).optional(),
});

export const updateLeadSchema = z.object({
  name: z.string().max(255).optional(),
  email: z.email().optional(),
  phone: z.string().max(20).optional(),
  company: z.string().max(255).optional(),
  status: z.nativeEnum(PartnerLeadStatus).optional(),
  notes: z.string().max(2000).optional(),
});

export const convertLeadSchema = z.object({
  name: z.string().max(255).optional(),
  email: z.email().optional(),
  phone: z.string().max(20).optional(),
  company: z.string().max(255).optional(),
});

// ---------- Clients ----------

export const createClientSchema = z.object({
  name: z.string().min(2).max(255),
  email: z.email().optional(),
  phone: z.string().max(20).optional(),
  company: z.string().max(255).optional(),
});

export const updateClientSchema = z.object({
  name: z.string().max(255).optional(),
  email: z.email().optional(),
  phone: z.string().max(20).optional(),
  company: z.string().max(255).optional(),
});

// ---------- Deals ----------

export const createDealSchema = z.object({
  clientId: z.string(),
  serviceId: z.string(),
  value: z.number().min(0),
  notes: z.string().max(2000).optional(),
});

export const updateDealSchema = z.object({
  status: z.nativeEnum(PartnerDealStatus).optional(),
  value: z.number().min(0).optional(),
  notes: z.string().max(2000).optional(),
});

// ---------- Contracts ----------

export const requestContractSchema = z.object({
  dealId: z.string(),
});

export const reviewContractSchema = z.object({
  action: z.enum(["APPROVED", "REJECTED"]),
  rejectionReason: z.string().max(2000).optional(),
});

// ---------- Invoices ----------

export const requestInvoiceSchema = z.object({
  dealId: z.string(),
  // audit v12 MEDIUM (MED-64): reject zero-value invoices at schema layer
  amount: z.number().positive("Amount must be greater than zero").optional(),
});

export const reviewInvoiceSchema = z.object({
  action: z.enum(["APPROVED", "REJECTED"]),
  rejectionReason: z.string().max(2000).optional(),
});

// ---------- Commissions ----------

export const updateCommissionStatusSchema = z.object({
  status: z.nativeEnum(PartnerCommissionStatus),
});
