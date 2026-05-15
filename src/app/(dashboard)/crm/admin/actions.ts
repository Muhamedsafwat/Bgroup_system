"use server";

import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { getRequiredSession } from "@/lib/crm/session";
import { revalidatePath } from "next/cache";
import {
  createUserSchema,
  updateUserSchema,
  createEntitySchema,
  updateEntitySchema,
  updateFxRateSchema,
  updateStageConfigSchema,
  createLossReasonSchema,
  updateLossReasonSchema,
  createLeadSourceSchema,
  updateLeadSourceSchema,
} from "@/lib/crm/validations/admin";

async function requireAdmin() {
  const session = await getRequiredSession();
  if (session.role !== "ADMIN") {
    throw new Error("Unauthorized: Admin access required");
  }
  return session;
}

// ========== USERS ==========

export async function getUsers() {
  await requireAdmin();
  const users = await db.crmUserProfile.findMany({
    include: {
      entity: {
        select: { id: true, code: true, nameEn: true, nameAr: true, color: true },
      },
      // Email lives on the unified User row, not the CRM profile — without
      // this include the Edit Users dialog would open with a blank email
      // field and the user couldn't sign in (saving would write an empty
      // string back to User.email).
      user: { select: { email: true } },
      manager: { select: { id: true, fullName: true } },
    },
    orderBy: [{ active: "desc" }, { fullName: "asc" }],
  });
  // Flatten user.email up to the row so the existing UserItem type works.
  const shaped = users.map((u) => ({
    ...u,
    email: u.user?.email ?? "",
  }));
  return JSON.parse(JSON.stringify(shaped));
}

export async function createUser(data: Record<string, unknown>) {
  await requireAdmin();
  const parsed = createUserSchema.parse(data);

  // Hash the password so the user can sign in via credentials. Without this
  // the unified User row had a null password and login silently failed with
  // "Invalid email or password".
  const hashed = await bcrypt.hash(parsed.password, 12);

  const unifiedUser = await db.user.create({
    data: {
      email: parsed.email,
      name: parsed.fullName,
      password: hashed,
      crmAccess: true,
    },
  });

  const user = await db.crmUserProfile.create({
    data: {
      userId: unifiedUser.id,
      fullName: parsed.fullName,
      fullNameAr: parsed.fullNameAr || null,
      role: parsed.role,
      entityId: parsed.entityId || null,
      monthlyTargetEGP: parsed.monthlyTargetEGP ?? null,
      managerId: parsed.managerId || null,
    },
  });
  revalidatePath("/crm/admin/users");
  return JSON.parse(JSON.stringify(user));
}

export async function updateUser(id: string, data: Record<string, unknown>) {
  await requireAdmin();
  const parsed = updateUserSchema.parse(data);

  // Update email and/or password on the unified User row when provided. Blank
  // password means "don't change it" — we only hash + write when the admin
  // actually typed a new password into the dialog.
  if (parsed.email !== undefined || parsed.password !== undefined || parsed.fullName !== undefined) {
    const profile = await db.crmUserProfile.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (profile) {
      const userPatch: Record<string, unknown> = {};
      if (parsed.email !== undefined) userPatch.email = parsed.email;
      if (parsed.fullName !== undefined) userPatch.name = parsed.fullName;
      if (parsed.password) {
        userPatch.password = await bcrypt.hash(parsed.password, 12);
      }
      if (Object.keys(userPatch).length > 0) {
        await db.user.update({
          where: { id: profile.userId },
          data: userPatch,
        });
      }
    }
  }

  const user = await db.crmUserProfile.update({
    where: { id },
    data: {
      ...(parsed.fullName !== undefined && { fullName: parsed.fullName }),
      ...(parsed.fullNameAr !== undefined && {
        fullNameAr: parsed.fullNameAr || null,
      }),
      ...(parsed.role !== undefined && { role: parsed.role }),
      ...(parsed.entityId !== undefined && {
        entityId: parsed.entityId || null,
      }),
      ...(parsed.monthlyTargetEGP !== undefined && {
        monthlyTargetEGP: parsed.monthlyTargetEGP,
      }),
      ...(parsed.managerId !== undefined && {
        managerId: parsed.managerId || null,
      }),
      ...(parsed.active !== undefined && { active: parsed.active }),
    },
  });
  revalidatePath("/crm/admin/users");
  return JSON.parse(JSON.stringify(user));
}

// ========== ENTITIES ==========

export async function getEntitiesAdmin() {
  await requireAdmin();
  const entities = await db.crmEntity.findMany({
    orderBy: { code: "asc" },
  });
  return JSON.parse(JSON.stringify(entities));
}

export async function updateEntity(id: string, data: Record<string, unknown>) {
  await requireAdmin();
  const parsed = updateEntitySchema.parse(data);
  const entity = await db.crmEntity.update({
    where: { id },
    data: parsed,
  });
  revalidatePath("/crm/admin/entities");
  return JSON.parse(JSON.stringify(entity));
}

export async function createEntity(data: Record<string, unknown>) {
  await requireAdmin();
  const parsed = createEntitySchema.parse(data);
  const existing = await db.crmEntity.findUnique({ where: { code: parsed.code } });
  if (existing) {
    throw new Error(`Entity code "${parsed.code}" already exists`);
  }
  const entity = await db.crmEntity.create({ data: parsed });
  revalidatePath("/crm/admin/entities");
  return JSON.parse(JSON.stringify(entity));
}

/**
 * Hard-delete an entity. Refuses if anything (users, opportunities, products,
 * loss reasons, stage configs, lead sources) still references it — those FKs
 * have no `onDelete: Cascade`, so a forced delete would fail at the DB layer
 * and leave a confusing error in the UI. We pre-check and return a helpful
 * message instead. Admins who really want to remove a live entity should
 * deactivate it via `updateEntity({ active: false })`.
 */
export async function deleteEntity(id: string) {
  await requireAdmin();
  const counts = await db.crmEntity.findUnique({
    where: { id },
    select: {
      _count: {
        select: {
          users: true,
          opportunities: true,
          products: true,
          lossReasons: true,
          stageConfigs: true,
          leadSources: true,
        },
      },
    },
  });
  if (!counts) throw new Error("Entity not found");
  const c = counts._count;
  const blocking: string[] = [];
  if (c.users) blocking.push(`${c.users} user(s)`);
  if (c.opportunities) blocking.push(`${c.opportunities} opportunity(ies)`);
  if (c.products) blocking.push(`${c.products} product(s)`);
  if (c.lossReasons) blocking.push(`${c.lossReasons} loss reason(s)`);
  if (c.stageConfigs) blocking.push(`${c.stageConfigs} stage config(s)`);
  if (c.leadSources) blocking.push(`${c.leadSources} lead source(s)`);
  if (blocking.length) {
    throw new Error(
      `Cannot delete: still referenced by ${blocking.join(", ")}. Deactivate it instead.`
    );
  }
  await db.crmEntity.delete({ where: { id } });
  revalidatePath("/crm/admin/entities");
  return { ok: true };
}

// ========== FX RATES ==========

export async function getFxRates() {
  await requireAdmin();
  const rates = await db.crmFxRate.findMany({
    orderBy: { currency: "asc" },
  });
  return JSON.parse(JSON.stringify(rates));
}

export async function updateFxRate(currency: string, rate: number) {
  await requireAdmin();
  const parsed = updateFxRateSchema.parse({ currency, rate });
  const fxRate = await db.crmFxRate.update({
    where: { currency: parsed.currency as never },
    data: { toEGP: parsed.rate },
  });
  revalidatePath("/crm/admin/fx-rates");
  return JSON.parse(JSON.stringify(fxRate));
}

// ========== STAGE CONFIGS ==========

export async function getStageConfigs() {
  await requireAdmin();
  const configs = await db.crmStageConfig.findMany({
    include: {
      entity: {
        select: { id: true, code: true, nameEn: true, nameAr: true },
      },
    },
    orderBy: [{ displayOrder: "asc" }],
  });
  return JSON.parse(JSON.stringify(configs));
}

export async function updateStageConfig(id: string, data: Record<string, unknown>) {
  await requireAdmin();
  const parsed = updateStageConfigSchema.parse(data);
  const config = await db.crmStageConfig.update({
    where: { id },
    data: parsed,
  });
  revalidatePath("/crm/admin/stage-config");
  return JSON.parse(JSON.stringify(config));
}

/**
 * Create a stage-config row for a stage that doesn't yet have one. Useful for
 * "adding" a stage to the pipeline — the enum value already exists, but it
 * isn't surfaced until a CrmStageConfig row marks it active and gives it a
 * probability + display order.
 */
export async function createStageConfig(input: {
  stage: string;
  entityId?: string | null;
  probabilityPct: number;
  slaHours?: number | null;
  displayOrder: number;
  customLabelEn?: string | null;
  customLabelAr?: string | null;
}) {
  await requireAdmin();
  // Reject if a config for this (entity, stage) pair already exists — the
  // unique constraint would 500 with a confusing message otherwise. Use
  // findFirst because the compound unique key requires entityId be string,
  // not null, in the Prisma generated type.
  const dupe = await db.crmStageConfig.findFirst({
    where: {
      entityId: input.entityId ?? null,
      stage: input.stage as never,
    },
  });
  if (dupe) throw new Error("This stage is already configured for this entity");

  const config = await db.crmStageConfig.create({
    data: {
      stage: input.stage as never,
      entityId: input.entityId ?? null,
      probabilityPct: input.probabilityPct,
      slaHours: input.slaHours ?? null,
      displayOrder: input.displayOrder,
      customLabelEn: input.customLabelEn ?? null,
      customLabelAr: input.customLabelAr ?? null,
      isActive: true,
    },
  });
  revalidatePath("/crm/admin/stage-config");
  return JSON.parse(JSON.stringify(config));
}

/**
 * Soft-delete a stage from the pipeline. We don't hard-delete because
 * historical opportunities still reference the enum value in their `stage`
 * column and CrmStageHistory has audit rows tied to it. Setting isActive=false
 * removes the stage from the dropdown / kanban without breaking that data.
 */
export async function deleteStageConfig(id: string) {
  await requireAdmin();
  const config = await db.crmStageConfig.update({
    where: { id },
    data: { isActive: false },
  });
  revalidatePath("/crm/admin/stage-config");
  return JSON.parse(JSON.stringify(config));
}

/**
 * Restore a soft-deleted stage. Symmetrical with deleteStageConfig.
 */
export async function restoreStageConfig(id: string) {
  await requireAdmin();
  const config = await db.crmStageConfig.update({
    where: { id },
    data: { isActive: true },
  });
  revalidatePath("/crm/admin/stage-config");
  return JSON.parse(JSON.stringify(config));
}

// ========== LOSS REASONS ==========

export async function getLossReasons() {
  await requireAdmin();
  const reasons = await db.crmLossReason.findMany({
    include: {
      entity: {
        select: { id: true, code: true, nameEn: true, nameAr: true },
      },
    },
    orderBy: [{ active: "desc" }, { labelEn: "asc" }],
  });
  return JSON.parse(JSON.stringify(reasons));
}

export async function createLossReason(data: Record<string, unknown>) {
  await requireAdmin();
  const parsed = createLossReasonSchema.parse(data);
  const reason = await db.crmLossReason.create({
    data: {
      code: parsed.code,
      labelEn: parsed.labelEn,
      labelAr: parsed.labelAr,
      entityId: parsed.entityId || null,
    },
  });
  revalidatePath("/crm/admin/loss-reasons");
  return JSON.parse(JSON.stringify(reason));
}

export async function updateLossReason(id: string, data: Record<string, unknown>) {
  await requireAdmin();
  const parsed = updateLossReasonSchema.parse(data);
  const reason = await db.crmLossReason.update({
    where: { id },
    data: parsed,
  });
  revalidatePath("/crm/admin/loss-reasons");
  return JSON.parse(JSON.stringify(reason));
}

// ========== LEAD SOURCES ==========

export async function getLeadSources() {
  await requireAdmin();
  const sources = await db.crmLeadSource.findMany({
    include: {
      entity: {
        select: { id: true, code: true, nameEn: true, nameAr: true },
      },
    },
    orderBy: [{ active: "desc" }, { labelEn: "asc" }],
  });
  return JSON.parse(JSON.stringify(sources));
}

export async function createLeadSource(data: Record<string, unknown>) {
  await requireAdmin();
  const parsed = createLeadSourceSchema.parse(data);
  const source = await db.crmLeadSource.create({
    data: {
      code: parsed.code,
      labelEn: parsed.labelEn,
      labelAr: parsed.labelAr,
      entityId: parsed.entityId || null,
    },
  });
  revalidatePath("/crm/admin/lead-sources");
  return JSON.parse(JSON.stringify(source));
}

export async function updateLeadSource(id: string, data: Record<string, unknown>) {
  await requireAdmin();
  const parsed = updateLeadSourceSchema.parse(data);
  const source = await db.crmLeadSource.update({
    where: { id },
    data: parsed,
  });
  revalidatePath("/crm/admin/lead-sources");
  return JSON.parse(JSON.stringify(source));
}

// ========== CUSTOMER NEEDS ==========

export async function listCustomerNeeds() {
  await getRequiredSession();
  const rows = await db.crmCustomerNeed.findMany({
    orderBy: [{ active: "desc" }, { sortOrder: "asc" }, { labelEn: "asc" }],
  });
  return JSON.parse(JSON.stringify(rows));
}

export async function createCustomerNeed(input: {
  labelEn: string;
  labelAr?: string;
  category?: string;
  sortOrder?: number;
}) {
  await requireAdmin();
  const label = input.labelEn.trim();
  if (!label) throw new Error("Label is required");
  const existing = await db.crmCustomerNeed.findUnique({ where: { labelEn: label } });
  if (existing) throw new Error("A customer need with that label already exists");
  const row = await db.crmCustomerNeed.create({
    data: {
      labelEn: label,
      labelAr: input.labelAr?.trim() ?? "",
      category: input.category?.trim() ?? "",
      sortOrder: input.sortOrder ?? 0,
      active: true,
    },
  });
  revalidatePath("/crm/admin/customer-needs");
  return JSON.parse(JSON.stringify(row));
}

export async function updateCustomerNeed(
  id: string,
  input: { labelEn?: string; labelAr?: string; category?: string; sortOrder?: number; active?: boolean }
) {
  await requireAdmin();
  const row = await db.crmCustomerNeed.update({
    where: { id },
    data: {
      ...(input.labelEn !== undefined && { labelEn: input.labelEn.trim() }),
      ...(input.labelAr !== undefined && { labelAr: input.labelAr.trim() }),
      ...(input.category !== undefined && { category: input.category.trim() }),
      ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
      ...(input.active !== undefined && { active: input.active }),
    },
  });
  revalidatePath("/crm/admin/customer-needs");
  return JSON.parse(JSON.stringify(row));
}

// ========== MEETING TYPE CONFIGS ==========

export async function listMeetingTypeConfigs() {
  await getRequiredSession();
  const rows = await db.crmMeetingTypeConfig.findMany({
    orderBy: [{ active: "desc" }, { sortOrder: "asc" }],
  });
  return JSON.parse(JSON.stringify(rows));
}

export async function updateMeetingTypeConfig(
  id: string,
  input: { labelEn?: string; labelAr?: string; active?: boolean; sortOrder?: number }
) {
  await requireAdmin();
  const row = await db.crmMeetingTypeConfig.update({
    where: { id },
    data: {
      ...(input.labelEn !== undefined && { labelEn: input.labelEn.trim() }),
      ...(input.labelAr !== undefined && { labelAr: input.labelAr.trim() }),
      ...(input.active !== undefined && { active: input.active }),
      ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
    },
  });
  revalidatePath("/crm/admin/meeting-types");
  return JSON.parse(JSON.stringify(row));
}
