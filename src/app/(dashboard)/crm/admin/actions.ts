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
  createFxRateSchema,
  updateFxRateSchema,
  createStageConfigSchema,
  updateStageConfigSchema,
  createLossReasonSchema,
  updateLossReasonSchema,
  createLeadSourceSchema,
  updateLeadSourceSchema,
  createCustomerNeedSchema,
  updateCustomerNeedSchema,
  createMeetingTypeConfigSchema,
  updateMeetingTypeConfigSchema,
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

/**
 * Create an FX rate row for a currency we haven't tracked before. The CrmFxRate
 * table is keyed by currency, so duplicates would 500 with a confusing Prisma
 * error — pre-check and surface a friendly conflict message instead.
 */
export async function createFxRate(input: { currency: string; rate: number }) {
  await requireAdmin();
  const parsed = createFxRateSchema.parse(input);
  const existing = await db.crmFxRate.findUnique({
    where: { currency: parsed.currency as never },
  });
  if (existing) {
    throw new Error(`${parsed.currency} rate already exists — edit it instead`);
  }
  const fxRate = await db.crmFxRate.create({
    data: { currency: parsed.currency as never, toEGP: parsed.rate },
  });
  revalidatePath("/crm/admin/fx-rates");
  return JSON.parse(JSON.stringify(fxRate));
}

/**
 * Hard-delete an FX rate. Refuses if any opportunity still references the
 * currency (FX rates are looked up by currency code at write time, not via
 * FK — but historical opps reference the currency on their rows). Pre-checking
 * gives the admin a clear "deactivate by setting to 0 or migrate first" cue
 * instead of a silently broken financial calculation later.
 */
export async function deleteFxRate(currency: string) {
  await requireAdmin();
  if (currency === "EGP") {
    throw new Error("EGP is the base currency and cannot be deleted");
  }
  const inUse = await db.crmOpportunity.count({
    where: { currency: currency as never, deletedAt: null },
  });
  if (inUse > 0) {
    throw new Error(
      `Cannot delete: ${inUse} open opportunity(ies) priced in ${currency}. Convert them first.`
    );
  }
  await db.crmFxRate.delete({ where: { currency: currency as never } });
  revalidatePath("/crm/admin/fx-rates");
  return { ok: true };
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
export async function createStageConfig(input: Record<string, unknown>) {
  await requireAdmin();
  const parsed = createStageConfigSchema.parse(input);
  // Reject if a config for this (entity, stage) pair already exists — the
  // unique constraint would 500 with a confusing message otherwise.
  const dupe = await db.crmStageConfig.findFirst({
    where: {
      entityId: parsed.entityId ?? null,
      stage: parsed.stage,
    },
  });
  if (dupe) throw new Error("This stage is already configured for this entity");

  const config = await db.crmStageConfig.create({
    data: {
      stage: parsed.stage,
      entityId: parsed.entityId ?? null,
      probabilityPct: parsed.probabilityPct,
      slaHours: parsed.slaHours ?? null,
      displayOrder: parsed.displayOrder,
      customLabelEn: parsed.customLabelEn ?? null,
      customLabelAr: parsed.customLabelAr ?? null,
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

/**
 * Hard-delete a loss reason. Refuses if any historical opportunity still
 * references it — those `LOST` rows carry the reason's id on `lossReasonId`
 * and deleting would break the post-mortem reporting on why deals were lost.
 * Admins can deactivate (active:false) to hide from the dropdown instead.
 */
export async function deleteLossReason(id: string) {
  await requireAdmin();
  const refs = await db.crmOpportunity.count({ where: { lossReasonId: id } });
  if (refs > 0) {
    throw new Error(
      `Cannot delete: ${refs} lost opportunity(ies) still cite this reason. Deactivate it instead.`
    );
  }
  await db.crmLossReason.delete({ where: { id } });
  revalidatePath("/crm/admin/loss-reasons");
  return { ok: true };
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

/**
 * Hard-delete a lead source. Refuses if any opportunity still references the
 * code — historical leadSource is stored as a free-text code on the opp row.
 * Admins can deactivate to hide from the dropdown without losing history.
 */
export async function deleteLeadSource(id: string) {
  await requireAdmin();
  const source = await db.crmLeadSource.findUnique({ where: { id } });
  if (!source) throw new Error("Lead source not found");
  const refs = await db.crmOpportunity.count({ where: { leadSource: source.code } });
  if (refs > 0) {
    throw new Error(
      `Cannot delete: ${refs} opportunity(ies) cite this lead source. Deactivate it instead.`
    );
  }
  await db.crmLeadSource.delete({ where: { id } });
  revalidatePath("/crm/admin/lead-sources");
  return { ok: true };
}

// ========== CUSTOMER NEEDS ==========

export async function listCustomerNeeds() {
  await getRequiredSession();
  const rows = await db.crmCustomerNeed.findMany({
    orderBy: [{ active: "desc" }, { sortOrder: "asc" }, { labelEn: "asc" }],
  });
  return JSON.parse(JSON.stringify(rows));
}

export async function createCustomerNeed(input: Record<string, unknown>) {
  await requireAdmin();
  const parsed = createCustomerNeedSchema.parse(input);
  const existing = await db.crmCustomerNeed.findUnique({ where: { labelEn: parsed.labelEn } });
  if (existing) throw new Error("A customer need with that label already exists");
  const row = await db.crmCustomerNeed.create({
    data: {
      labelEn: parsed.labelEn,
      labelAr: parsed.labelAr ?? "",
      category: parsed.category ?? "",
      sortOrder: parsed.sortOrder ?? 0,
      active: true,
    },
  });
  revalidatePath("/crm/admin/customer-needs");
  return JSON.parse(JSON.stringify(row));
}

export async function updateCustomerNeed(id: string, input: Record<string, unknown>) {
  await requireAdmin();
  const parsed = updateCustomerNeedSchema.parse(input);
  const row = await db.crmCustomerNeed.update({
    where: { id },
    data: parsed,
  });
  revalidatePath("/crm/admin/customer-needs");
  return JSON.parse(JSON.stringify(row));
}

/**
 * Hard-delete a customer need. Refuses if any meeting still references the
 * label — `CrmMeeting.customerNeed` is a denormalised label string, so a
 * deletion would orphan past meetings. Deactivate instead to hide from the
 * "Book meeting" dropdown while preserving history.
 */
export async function deleteCustomerNeed(id: string) {
  await requireAdmin();
  const need = await db.crmCustomerNeed.findUnique({ where: { id } });
  if (!need) throw new Error("Customer need not found");
  const refs = await db.crmMeeting.count({ where: { customerNeed: need.labelEn } });
  if (refs > 0) {
    throw new Error(
      `Cannot delete: ${refs} meeting(s) cite "${need.labelEn}". Deactivate it instead.`
    );
  }
  await db.crmCustomerNeed.delete({ where: { id } });
  revalidatePath("/crm/admin/customer-needs");
  return { ok: true };
}

// ========== MEETING TYPE CONFIGS ==========

export async function listMeetingTypeConfigs() {
  await getRequiredSession();
  const rows = await db.crmMeetingTypeConfig.findMany({
    orderBy: [{ active: "desc" }, { sortOrder: "asc" }],
  });
  return JSON.parse(JSON.stringify(rows));
}

export async function updateMeetingTypeConfig(id: string, input: Record<string, unknown>) {
  await requireAdmin();
  const parsed = updateMeetingTypeConfigSchema.parse(input);
  const row = await db.crmMeetingTypeConfig.update({
    where: { id },
    data: parsed,
  });
  revalidatePath("/crm/admin/meeting-types");
  return JSON.parse(JSON.stringify(row));
}

/**
 * Create a new meeting type. Code must be UPPER_SNAKE so it pairs cleanly
 * with the `CrmMeetingType` enum values used as `meetingType` on CrmMeeting.
 * Note: the enum itself can't be extended at runtime — these custom codes
 * are stored as the `code` column and validated against the enum at write
 * time on the meeting create endpoint. Adding a brand-new code here without
 * also extending the enum will let it appear in the dropdown but reject on
 * save; that's why we keep this admin-only and pre-warn in the UI.
 */
export async function createMeetingTypeConfig(input: Record<string, unknown>) {
  await requireAdmin();
  const parsed = createMeetingTypeConfigSchema.parse(input);
  const existing = await db.crmMeetingTypeConfig.findUnique({ where: { code: parsed.code } });
  if (existing) throw new Error(`Code "${parsed.code}" already exists`);
  const row = await db.crmMeetingTypeConfig.create({
    data: {
      code: parsed.code,
      labelEn: parsed.labelEn,
      labelAr: parsed.labelAr ?? "",
      sortOrder: parsed.sortOrder ?? 0,
      active: true,
    },
  });
  revalidatePath("/crm/admin/meeting-types");
  return JSON.parse(JSON.stringify(row));
}

/**
 * Hard-delete a meeting type. Refuses if any meeting still has this type —
 * deactivate via update({active:false}) to hide from the booking dropdown
 * without dropping the historical row.
 */
export async function deleteMeetingTypeConfig(id: string) {
  await requireAdmin();
  const cfg = await db.crmMeetingTypeConfig.findUnique({ where: { id } });
  if (!cfg) throw new Error("Meeting type not found");
  const refs = await db.crmMeeting.count({
    where: { meetingType: cfg.code as never },
  });
  if (refs > 0) {
    throw new Error(
      `Cannot delete: ${refs} meeting(s) use this type. Deactivate it instead.`
    );
  }
  await db.crmMeetingTypeConfig.delete({ where: { id } });
  revalidatePath("/crm/admin/meeting-types");
  return { ok: true };
}
