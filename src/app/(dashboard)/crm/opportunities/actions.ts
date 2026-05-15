"use server";

import { db } from "@/lib/db";
import { scopeOpportunityByRole, scopeCompanyByRole } from "@/lib/crm/rbac";
import { getRequiredSession } from "@/lib/crm/session";
import { generateOpportunityCode } from "@/lib/crm/business/auto-code";
import { recomputeOpportunityFinancials } from "@/lib/crm/business/pipeline";
import {
  canTransition,
  getTransitionRequirements,
} from "@/lib/crm/business/stage-transitions";
import {
  createOpportunitySchema,
  updateOpportunitySchema,
  stageChangeSchema,
  type CreateOpportunityInput,
  type UpdateOpportunityInput,
  type StageChangeInput,
} from "@/lib/crm/validations/opportunity";
import { revalidatePath } from "next/cache";
import type { CrmOpportunityStage, CrmCurrency } from "@/generated/prisma";
import type { FxRateMap } from "@/lib/crm/business/fx";

async function getFxRates(): Promise<FxRateMap> {
  const rates = await db.crmFxRate.findMany();
  const map: FxRateMap = { EGP: 1, USD: 48, SAR: 12.8, AED: 13, QAR: 13.2 };
  for (const r of rates) {
    map[r.currency] = Number(r.toEGP);
  }
  return map;
}

/**
 * Resolve the win-probability for a stage. Prefers a global config row
 * (entityId: null) when set, falls back to ANY per-entity config, and only
 * then to the stage's hard-coded default. The fallback chain matters because
 * the seed installs per-entity configs, not globals — without this we'd
 * always return 5% and weighted-value calculations would be useless.
 */
const STAGE_DEFAULT_PROBABILITY: Record<CrmOpportunityStage, number> = {
  NEW: 5,
  CONTACTED: 15,
  DISCOVERY: 30,
  QUALIFIED: 70,
  TECH_MEETING: 50,
  PROPOSAL_SENT: 75,
  NEGOTIATION: 85,
  VERBAL_YES: 95,
  WON: 100,
  LOST: 0,
  POSTPONED: 0,
};

async function getStageProbability(stage: CrmOpportunityStage): Promise<number> {
  const config =
    (await db.crmStageConfig.findFirst({ where: { stage, entityId: null } })) ??
    (await db.crmStageConfig.findFirst({ where: { stage } }));
  return config?.probabilityPct ?? STAGE_DEFAULT_PROBABILITY[stage];
}

export async function getOpportunities(filters?: {
  search?: string;
  stage?: CrmOpportunityStage[];
  entityId?: string;
  priority?: string;
  ownerId?: string;
  page?: number;
  pageSize?: number;
}) {
  const session = await getRequiredSession();
  const scope = scopeOpportunityByRole(session);
  const page = filters?.page || 1;
  const pageSize = filters?.pageSize || 50;

  const where: Record<string, unknown> = { ...scope, deletedAt: null };

  if (filters?.stage && filters.stage.length > 0) {
    where.stage = { in: filters.stage };
  }
  if (filters?.entityId) {
    where.entityId = filters.entityId;
  }
  if (filters?.priority) {
    where.priority = filters.priority;
  }
  if (filters?.ownerId) {
    where.ownerId = filters.ownerId;
  }
  if (filters?.search) {
    where.OR = [
      { code: { contains: filters.search, mode: "insensitive" } },
      { title: { contains: filters.search, mode: "insensitive" } },
      { company: { nameEn: { contains: filters.search, mode: "insensitive" } } },
    ];
  }

  const [data, total] = await Promise.all([
    db.crmOpportunity.findMany({
      where: where as any,
      include: {
        company: { select: { id: true, nameEn: true, nameAr: true } },
        primaryContact: { select: { id: true, fullName: true, phone: true } },
        owner: { select: { id: true, fullName: true, fullNameAr: true } },
        entity: { select: { id: true, code: true, nameEn: true, nameAr: true, color: true } },
        products: {
          include: { product: { select: { id: true, code: true, nameEn: true, nameAr: true } } },
        },
      },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.crmOpportunity.count({ where: where as any }),
  ]);

  return JSON.parse(JSON.stringify({ data, total, page, pageSize }));
}

export async function getOpportunity(id: string) {
  const session = await getRequiredSession();
  const scope = scopeOpportunityByRole(session);

  const result = await db.crmOpportunity.findFirst({
    where: { id, ...scope, deletedAt: null },
    include: {
      company: { select: { id: true, nameEn: true, nameAr: true, phone: true } },
      primaryContact: { select: { id: true, fullName: true, phone: true, email: true, whatsapp: true } },
      owner: { select: { id: true, fullName: true, fullNameAr: true } },
      entity: { select: { id: true, code: true, nameEn: true, nameAr: true, color: true } },
      techSupport: { select: { id: true, fullName: true } },
      deliveryOwner: { select: { id: true, fullName: true } },
      lossReason: { select: { id: true, labelEn: true, labelAr: true } },
      products: {
        include: { product: { select: { id: true, code: true, nameEn: true, nameAr: true } } },
      },
      stageChanges: {
        orderBy: { changedAt: "desc" },
        take: 20,
      },
      calls: {
        orderBy: { callAt: "desc" },
        take: 20,
        include: { caller: { select: { fullName: true } } },
      },
      notes: {
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { author: { select: { fullName: true } } },
      },
      activityLogs: {
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { actor: { select: { fullName: true } } },
      },
      attachments: {
        orderBy: { createdAt: "desc" },
      },
    },
  });
  return result ? JSON.parse(JSON.stringify(result)) : null;
}

export async function createOpportunity(input: CreateOpportunityInput) {
  const session = await getRequiredSession();
  const parsed = createOpportunitySchema.parse(input);

  // RBAC: verify user has access to the target company
  const companyScope = scopeCompanyByRole(session);
  const company = await db.crmCompany.findFirst({
    where: { id: parsed.companyId, ...companyScope },
    select: { nameEn: true },
  });
  if (!company) throw new Error("Company not found or access denied");

  const fxRates = await getFxRates();
  const probabilityPct = await getStageProbability("NEW");
  const { estimatedValueEGP, weightedValueEGP } = recomputeOpportunityFinancials(
    parsed.estimatedValue,
    parsed.currency as CrmCurrency,
    probabilityPct,
    fxRates
  );

  const code = await generateOpportunityCode();
  const title = parsed.title || company.nameEn || code;

  const opp = await db.$transaction(async (tx) => {
    const created = await tx.crmOpportunity.create({
      data: {
        code,
        companyId: parsed.companyId,
        primaryContactId: parsed.primaryContactId || null,
        ownerId: session.id,
        entityId: parsed.entityId,
        title,
        stage: "NEW",
        priority: parsed.priority,
        leadSource: parsed.leadSource || null,
        dealType: parsed.dealType,
        estimatedValue: parsed.estimatedValue,
        currency: parsed.currency as CrmCurrency,
        estimatedValueEGP,
        probabilityPct,
        weightedValueEGP,
        expectedCloseDate: parsed.expectedCloseDate
          ? new Date(parsed.expectedCloseDate)
          : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        nextAction: parsed.nextAction,
        nextActionText: parsed.nextActionText || null,
        nextActionDate: new Date(parsed.nextActionDate),
        description: parsed.description || null,
        techRequirements: parsed.techRequirements || null,
      },
    });

    await tx.crmStageHistory.create({
      data: {
        opportunityId: created.id,
        fromStage: null,
        toStage: "NEW",
        changedById: session.id,
      },
    });

    await tx.crmActivityLog.create({
      data: {
        opportunityId: created.id,
        actorId: session.id,
        action: "created",
        metadata: { code: created.code },
      },
    });

    // Attach products / services the customer is interested in. Default
    // qty = 1, unitPriceEGP from the product's basePrice (converted if it's
    // priced in a non-EGP currency), discountPct = 0. Users can refine
    // line-item math in the edit view later.
    if (parsed.productIds && parsed.productIds.length) {
      const uniqueIds = Array.from(new Set(parsed.productIds));
      const products = await tx.crmProduct.findMany({
        where: { id: { in: uniqueIds }, active: true },
        select: { id: true, basePrice: true, currency: true },
      });
      for (const p of products) {
        const fx = fxRates[p.currency] ?? 1;
        const unitPriceEGP = Number(p.basePrice) * fx;
        await tx.crmOpportunityProduct.create({
          data: {
            opportunityId: created.id,
            productId: p.id,
            quantity: 1,
            unitPriceEGP,
            discountPct: 0,
          },
        });
      }
    }

    return created;
  });

  revalidatePath("/crm/opportunities");
  revalidatePath("/my");
  return JSON.parse(JSON.stringify(opp));
}

export async function updateOpportunity(id: string, input: UpdateOpportunityInput) {
  const session = await getRequiredSession();
  const parsed = updateOpportunitySchema.parse(input);

  const existing = await db.crmOpportunity.findFirst({
    where: { id, ...scopeOpportunityByRole(session), deletedAt: null },
  });
  if (!existing) throw new Error("Opportunity not found");

  const updateData: Record<string, unknown> = {};

  // productIds is handled separately (joins through CrmOpportunityProduct) —
  // don't push it onto the CrmOpportunity update payload or Prisma will reject.
  for (const [key, value] of Object.entries(parsed)) {
    if (value === undefined) continue;
    if (key === "productIds") continue;
    if (key === "expectedCloseDate" || key === "nextActionDate") {
      updateData[key] = value ? new Date(value as string) : null;
    } else {
      updateData[key] = value;
    }
  }

  // Recompute financials if value or currency changed
  if (parsed.estimatedValue !== undefined || parsed.currency !== undefined) {
    const fxRates = await getFxRates();
    const value = parsed.estimatedValue ?? Number(existing.estimatedValue);
    const currency = (parsed.currency ?? existing.currency) as CrmCurrency;
    const { estimatedValueEGP, weightedValueEGP } = recomputeOpportunityFinancials(
      value,
      currency,
      existing.probabilityPct,
      fxRates
    );
    updateData.estimatedValueEGP = estimatedValueEGP;
    updateData.weightedValueEGP = weightedValueEGP;
  }

  const updated = await db.$transaction(async (tx) => {
    const result = await tx.crmOpportunity.update({
      where: { id },
      data: updateData,
    });

    // Sync product line-up: insert new picks, remove ones the user cleared.
    // Existing rows that stay are left untouched so any manual qty/unit-price
    // overrides aren't wiped on a routine save.
    if (parsed.productIds) {
      const desired = new Set(parsed.productIds);
      const currentRows = await tx.crmOpportunityProduct.findMany({
        where: { opportunityId: id },
        select: { id: true, productId: true },
      });
      const current = new Set(currentRows.map((r) => r.productId));
      const toRemove = currentRows.filter((r) => !desired.has(r.productId));
      const toAdd = parsed.productIds.filter((pid) => !current.has(pid));
      if (toRemove.length) {
        await tx.crmOpportunityProduct.deleteMany({
          where: { id: { in: toRemove.map((r) => r.id) } },
        });
      }
      if (toAdd.length) {
        const fxRates = await getFxRates();
        const products = await tx.crmProduct.findMany({
          where: { id: { in: toAdd }, active: true },
          select: { id: true, basePrice: true, currency: true },
        });
        for (const p of products) {
          const fx = fxRates[p.currency] ?? 1;
          await tx.crmOpportunityProduct.create({
            data: {
              opportunityId: id,
              productId: p.id,
              quantity: 1,
              unitPriceEGP: Number(p.basePrice) * fx,
              discountPct: 0,
            },
          });
        }
      }
    }

    await tx.crmActivityLog.create({
      data: {
        opportunityId: id,
        actorId: session.id,
        action: "updated",
        metadata: { fields: Object.keys(parsed) },
      },
    });

    return result;
  });

  revalidatePath(`/crm/opportunities/${id}`);
  revalidatePath("/crm/opportunities");
  revalidatePath("/my");
  return JSON.parse(JSON.stringify(updated));
}

/**
 * Soft-delete an opportunity. Row stays in the DB (marked `deletedAt`) so
 * downstream commission / forecast history doesn't get broken. List queries
 * must filter `deletedAt: null` to keep deleted opps out of the UI.
 *
 * Only the opportunity owner or an ADMIN can delete.
 */
export async function deleteOpportunity(id: string) {
  const session = await getRequiredSession();
  const existing = await db.crmOpportunity.findFirst({
    where: { id, ...scopeOpportunityByRole(session) },
    select: { id: true, ownerId: true, deletedAt: true },
  });
  if (!existing || existing.deletedAt) throw new Error("Opportunity not found");
  if (existing.ownerId !== session.id && session.role !== "ADMIN") {
    throw new Error("Only the owner or an admin can delete this opportunity");
  }

  await db.$transaction(async (tx) => {
    await tx.crmOpportunity.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: session.id },
    });
    await tx.crmActivityLog.create({
      data: {
        opportunityId: id,
        actorId: session.id,
        action: "deleted",
        metadata: {},
      },
    });
  });

  revalidatePath("/crm/opportunities");
  revalidatePath("/my");
  return { ok: true };
}

export async function changeStage(opportunityId: string, input: StageChangeInput) {
  const session = await getRequiredSession();
  const parsed = stageChangeSchema.parse(input);

  const opp = await db.crmOpportunity.findFirst({
    where: { id: opportunityId, ...scopeOpportunityByRole(session), deletedAt: null },
  });
  if (!opp) throw new Error("Opportunity not found");

  // Validate transition
  const transition = canTransition(opp.stage, parsed.toStage as CrmOpportunityStage);
  if (!transition.allowed) {
    throw new Error(transition.error || "Transition not allowed");
  }

  // Check requirements
  const requirements = getTransitionRequirements(parsed.toStage as CrmOpportunityStage);

  if (requirements.lossReasonRequired && !parsed.lossReasonId) {
    throw new Error("Loss reason is required when marking as Lost");
  }

  // Get new probability
  const probabilityPct = await getStageProbability(parsed.toStage as CrmOpportunityStage);
  const fxRates = await getFxRates();
  const { weightedValueEGP } = recomputeOpportunityFinancials(
    Number(opp.estimatedValue),
    opp.currency,
    probabilityPct,
    fxRates
  );

  // Calculate duration in previous stage
  const lastStageChange = await db.crmStageHistory.findFirst({
    where: { opportunityId },
    orderBy: { changedAt: "desc" },
  });
  const durationDays = lastStageChange
    ? Math.floor(
        (Date.now() - lastStageChange.changedAt.getTime()) /
          (1000 * 60 * 60 * 24)
      )
    : 0;

  // Build update data
  const updateData: Record<string, unknown> = {
    stage: parsed.toStage,
    probabilityPct,
    weightedValueEGP,
  };

  if (parsed.toStage === "LOST") {
    updateData.lossReasonId = parsed.lossReasonId;
    updateData.lostToCompetitor = parsed.lostToCompetitor || null;
    updateData.dateClosed = new Date();
  }

  if (parsed.toStage === "WON") {
    updateData.dateClosed = new Date();
    if (parsed.contractUrl) updateData.contractUrl = parsed.contractUrl;
  }

  if (parsed.toStage === "PROPOSAL_SENT") {
    updateData.dateProposalSent = new Date();
    if (parsed.proposalUrl) updateData.proposalUrl = parsed.proposalUrl;
  }

  if (parsed.toStage === "CONTACTED") {
    updateData.dateContacted = new Date();
  }

  if (parsed.toStage === "DISCOVERY") {
    updateData.dateDiscovery = new Date();
  }

  await db.$transaction(async (tx) => {
    await tx.crmOpportunity.update({
      where: { id: opportunityId },
      data: updateData,
    });

    await tx.crmStageHistory.create({
      data: {
        opportunityId,
        fromStage: opp.stage,
        toStage: parsed.toStage as CrmOpportunityStage,
        changedById: session.id,
        durationDays,
      },
    });

    await tx.crmActivityLog.create({
      data: {
        opportunityId,
        actorId: session.id,
        action: "stage_changed",
        metadata: {
          from: opp.stage,
          to: parsed.toStage,
          durationDays,
        },
      },
    });
  });

  revalidatePath(`/crm/opportunities/${opportunityId}`);
  revalidatePath("/crm/opportunities");
  revalidatePath("/my");

  return { warning: transition.warning };
}

export async function addNote(opportunityId: string, content: string) {
  const session = await getRequiredSession();

  // Verify user has access to this opportunity
  const scope = scopeOpportunityByRole(session);
  const opp = await db.crmOpportunity.findFirst({ where: { id: opportunityId, ...scope } });
  if (!opp) throw new Error("Opportunity not found or access denied");

  const note = await db.$transaction(async (tx) => {
    const created = await tx.crmNote.create({
      data: {
        opportunityId,
        authorId: session.id,
        content,
      },
    });

    await tx.crmActivityLog.create({
      data: {
        opportunityId,
        actorId: session.id,
        action: "note_added",
      },
    });

    return created;
  });

  revalidatePath(`/crm/opportunities/${opportunityId}`);
  return JSON.parse(JSON.stringify(note));
}

export async function getEntities() {
  await getRequiredSession();
  return db.crmEntity.findMany({
    where: { active: true },
    orderBy: { code: "asc" },
  });
}

export async function getLossReasons() {
  await getRequiredSession();
  return db.crmLossReason.findMany({
    where: { active: true },
    orderBy: { code: "asc" },
  });
}

export async function getLeadSources() {
  await getRequiredSession();
  return db.crmLeadSource.findMany({
    where: { active: true },
    orderBy: { code: "asc" },
  });
}
