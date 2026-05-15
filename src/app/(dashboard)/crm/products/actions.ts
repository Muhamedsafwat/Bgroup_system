"use server";

import { db } from "@/lib/db";
import { getRequiredSession } from "@/lib/crm/session";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const CURRENCIES = ["EGP", "USD", "SAR", "AED", "QAR"] as const;
const DEAL_TYPES = ["ONE_TIME", "MONTHLY", "ANNUAL", "SAAS", "MIXED", "RETAINER"] as const;

const productCreateSchema = z.object({
  code: z.string().trim().min(1).max(40),
  entityId: z.string().min(1),
  category: z.string().trim().min(1).max(60),
  nameEn: z.string().trim().min(1).max(120),
  nameAr: z.string().trim().max(120).optional().default(""),
  description: z.string().trim().max(2000).optional().nullable(),
  descriptionAr: z.string().trim().max(2000).optional().nullable(),
  basePrice: z.number().nonnegative().max(1_000_000_000),
  currency: z.enum(CURRENCIES),
  dealType: z.enum(DEAL_TYPES),
  active: z.boolean().optional().default(true),
});

const productUpdateSchema = productCreateSchema.partial();

async function requireProductAdmin() {
  const session = await getRequiredSession();
  if (session.role !== "ADMIN") {
    throw new Error("Unauthorized: Admin access required");
  }
  return session;
}

export type ProductFilters = {
  entityId?: string;
  category?: string;
  active?: boolean;
  search?: string;
};

function isCrossEntityRole(role: string | null | undefined): boolean {
  return role === "ADMIN";
}

export async function getProducts(filters?: ProductFilters) {
  const session = await getRequiredSession();
  const where: Record<string, unknown> = {};

  // Non-admin roles only see their own entity's products
  if (!isCrossEntityRole(session.role) && session.entityId) {
    where.entityId = session.entityId;
  } else if (filters?.entityId) {
    where.entityId = filters.entityId;
  }

  if (filters?.category) {
    where.category = filters.category;
  }
  if (filters?.active !== undefined) {
    where.active = filters.active;
  }
  if (filters?.search) {
    where.OR = [
      { nameEn: { contains: filters.search, mode: "insensitive" as const } },
      { nameAr: { contains: filters.search, mode: "insensitive" as const } },
      { code: { contains: filters.search, mode: "insensitive" as const } },
    ];
  }

  const products = await db.crmProduct.findMany({
    where,
    include: {
      entity: {
        select: { id: true, code: true, nameEn: true, nameAr: true, color: true },
      },
    },
    orderBy: [{ entity: { code: "asc" } }, { category: "asc" }, { nameEn: "asc" }],
  });

  return JSON.parse(JSON.stringify(products));
}

export async function getProduct(id: string) {
  const session = await getRequiredSession();
  const product = await db.crmProduct.findUnique({
    where: { id },
    include: {
      entity: {
        select: { id: true, code: true, nameEn: true, nameAr: true, color: true },
      },
    },
  });

  if (!product) return null;
  if (!isCrossEntityRole(session.role) && session.entityId && product.entityId !== session.entityId) {
    return null;
  }

  return JSON.parse(JSON.stringify(product));
}

/**
 * List active CRM entities — used by the create/edit product dialog to
 * populate the entity dropdown.
 */
export async function listEntitiesForProductForm() {
  await getRequiredSession();
  const entities = await db.crmEntity.findMany({
    where: { active: true },
    select: { id: true, code: true, nameEn: true, nameAr: true, color: true },
    orderBy: { code: "asc" },
  });
  return JSON.parse(JSON.stringify(entities));
}

export async function createProduct(input: Record<string, unknown>) {
  await requireProductAdmin();
  const parsed = productCreateSchema.parse(input);
  const product = await db.crmProduct.create({
    data: {
      code: parsed.code,
      entityId: parsed.entityId,
      category: parsed.category,
      nameEn: parsed.nameEn,
      nameAr: parsed.nameAr ?? "",
      description: parsed.description ?? null,
      descriptionAr: parsed.descriptionAr ?? null,
      basePrice: parsed.basePrice,
      currency: parsed.currency,
      dealType: parsed.dealType,
      active: parsed.active ?? true,
    },
    include: { entity: { select: { id: true, code: true, nameEn: true, nameAr: true, color: true } } },
  });
  revalidatePath("/crm/products");
  return JSON.parse(JSON.stringify(product));
}

export async function updateProduct(id: string, input: Record<string, unknown>) {
  await requireProductAdmin();
  const parsed = productUpdateSchema.parse(input);
  const product = await db.crmProduct.update({
    where: { id },
    data: {
      ...(parsed.code !== undefined && { code: parsed.code }),
      ...(parsed.entityId !== undefined && { entityId: parsed.entityId }),
      ...(parsed.category !== undefined && { category: parsed.category }),
      ...(parsed.nameEn !== undefined && { nameEn: parsed.nameEn }),
      ...(parsed.nameAr !== undefined && { nameAr: parsed.nameAr ?? "" }),
      ...(parsed.description !== undefined && { description: parsed.description }),
      ...(parsed.descriptionAr !== undefined && { descriptionAr: parsed.descriptionAr }),
      ...(parsed.basePrice !== undefined && { basePrice: parsed.basePrice }),
      ...(parsed.currency !== undefined && { currency: parsed.currency }),
      ...(parsed.dealType !== undefined && { dealType: parsed.dealType }),
      ...(parsed.active !== undefined && { active: parsed.active }),
    },
    include: { entity: { select: { id: true, code: true, nameEn: true, nameAr: true, color: true } } },
  });
  revalidatePath("/crm/products");
  return JSON.parse(JSON.stringify(product));
}

/**
 * Soft-delete a product. Hard delete would FK-fail when historical
 * opportunities reference this product line — instead we mark it inactive
 * so it falls out of pickers but the audit trail is preserved.
 */
export async function deleteProduct(id: string) {
  await requireProductAdmin();
  const product = await db.crmProduct.update({
    where: { id },
    data: { active: false },
  });
  revalidatePath("/crm/products");
  return JSON.parse(JSON.stringify(product));
}
