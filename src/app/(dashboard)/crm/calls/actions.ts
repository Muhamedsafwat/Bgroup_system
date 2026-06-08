"use server";

import { db } from "@/lib/db";
import { scopeCallByRole, scopeCompanyByRole, scopeOpportunityByRole } from "@/lib/crm/rbac";
import { getRequiredSession } from "@/lib/crm/session";
import { generateCallCode } from "@/lib/crm/business/auto-code";
import { createCallSchema, type CreateCallInput } from "@/lib/crm/validations/call";
import { revalidatePath } from "next/cache";
import type { SessionUser } from "@/types";
import type { CrmCallType, CrmCallOutcome } from "@/generated/prisma";

export type CallFilters = {
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  outcome?: string;
  callType?: string;
  page?: number;
  pageSize?: number;
};

const DEFAULT_PAGE_SIZE = 30;

export async function createCall(session: SessionUser, data: CreateCallInput) {
  const parsed = createCallSchema.parse(data);

  // RBAC: verify access to linked opportunity and company (parallel)
  const rbacChecks: Promise<void>[] = [];
  if (parsed.opportunityId) {
    const oppScope = scopeOpportunityByRole(session);
    rbacChecks.push(
      db.crmOpportunity.findFirst({ where: { id: parsed.opportunityId, ...oppScope } })
        .then((opp) => { if (!opp) throw new Error("Opportunity not found or access denied"); })
    );
  }
  if (parsed.companyId) {
    const compScope = scopeCompanyByRole(session);
    rbacChecks.push(
      db.crmCompany.findFirst({ where: { id: parsed.companyId, ...compScope } })
        .then((company) => { if (!company) throw new Error("Company not found or access denied"); })
    );
  }
  await Promise.all(rbacChecks);

  const code = await generateCallCode();

  const call = await db.$transaction(async (tx) => {
    const created = await tx.crmCall.create({
      data: {
        code,
        callerId: session.id,
        actingAdminId: session.actingAdminId ?? null,
        opportunityId: parsed.opportunityId || null,
        companyId: parsed.companyId || null,
        contactId: parsed.contactId || null,
        contactName: parsed.contactName || null,
        callType: parsed.callType as CrmCallType,
        outcome: parsed.outcome as CrmCallOutcome,
        durationMins: parsed.durationMins ?? 0,
        callAt: parsed.callAt ? new Date(parsed.callAt) : new Date(),
        nextActionText: parsed.nextActionText || null,
        nextActionDate: parsed.nextActionDate
          ? new Date(parsed.nextActionDate)
          : null,
        notes: parsed.notes || null,
      },
    });

    if (parsed.opportunityId) {
      await tx.crmActivityLog.create({
        data: {
          opportunityId: parsed.opportunityId,
          actorId: session.id,
          actingAdminId: session.actingAdminId ?? null,
          action: "call_logged",
          metadata: {
            callCode: code,
            callType: parsed.callType,
            outcome: parsed.outcome,
            durationMins: parsed.durationMins,
          },
        },
      });

      if (parsed.nextActionText && parsed.nextActionDate) {
        await tx.crmOpportunity.update({
          where: { id: parsed.opportunityId },
          data: {
            nextActionText: parsed.nextActionText,
            nextActionDate: new Date(parsed.nextActionDate),
            nextAction: "FOLLOW_UP",
          },
        });
      }
    }

    return created;
  });

  revalidatePath("/crm/calls");
  revalidatePath("/crm/my/calls");
  if (parsed.opportunityId) {
    revalidatePath(`/crm/opportunities/${parsed.opportunityId}`);
  }

  return JSON.parse(JSON.stringify(call));
}

export async function getCalls(session: SessionUser, filters?: CallFilters) {
  const page = filters?.page ?? 1;
  const pageSize = filters?.pageSize ?? DEFAULT_PAGE_SIZE;
  const skip = (page - 1) * pageSize;

  const scopeWhere = scopeCallByRole(session);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = { ...scopeWhere };

  if (filters?.dateFrom || filters?.dateTo) {
    where.callAt = {};
    if (filters.dateFrom) {
      where.callAt.gte = new Date(filters.dateFrom);
    }
    if (filters.dateTo) {
      // End of the day
      const endDate = new Date(filters.dateTo);
      endDate.setHours(23, 59, 59, 999);
      where.callAt.lte = endDate;
    }
  }

  if (filters?.outcome) {
    where.outcome = filters.outcome;
  }

  if (filters?.callType) {
    where.callType = filters.callType;
  }

  if (filters?.search) {
    where.OR = [
      { code: { contains: filters.search, mode: "insensitive" as const } },
      {
        contactName: {
          contains: filters.search,
          mode: "insensitive" as const,
        },
      },
      {
        company: {
          nameEn: { contains: filters.search, mode: "insensitive" as const },
        },
      },
    ];
  }

  const [calls, total] = await Promise.all([
    db.crmCall.findMany({
      where,
      include: {
        caller: {
          select: { id: true, fullName: true, fullNameAr: true },
        },
        company: {
          select: { id: true, nameEn: true, nameAr: true },
        },
        opportunity: {
          select: { id: true, code: true, title: true },
        },
      },
      orderBy: { callAt: "desc" },
      skip,
      take: pageSize,
    }),
    db.crmCall.count({ where }),
  ]);

  return {
    calls,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

export async function getCall(session: SessionUser, id: string) {
  const scopeWhere = scopeCallByRole(session);

  const call = await db.crmCall.findFirst({
    where: { id, ...scopeWhere },
    include: {
      caller: {
        select: {
          id: true,
          fullName: true,
          fullNameAr: true,
                  },
      },
      company: {
        select: { id: true, nameEn: true, nameAr: true, phone: true },
      },
      opportunity: {
        select: {
          id: true,
          code: true,
          title: true,
          stage: true,
          company: { select: { nameEn: true, nameAr: true } },
        },
      },
    },
  });

  return call;
}

export async function searchCompanies(search: string) {
  if (!search || search.length < 2) return [];

  const session = await getRequiredSession();
  const scope = scopeCompanyByRole(session);

  const companies = await db.crmCompany.findMany({
    where: {
      ...scope,
      OR: [
        { nameEn: { contains: search, mode: "insensitive" } },
        { nameAr: { contains: search, mode: "insensitive" } },
      ],
    },
    select: { id: true, nameEn: true, nameAr: true },
    take: 10,
    orderBy: { nameEn: "asc" },
  });

  return companies;
}
