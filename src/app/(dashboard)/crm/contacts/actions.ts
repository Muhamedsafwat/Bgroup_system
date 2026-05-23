"use server";

import { db } from "@/lib/db";
import { scopeCompanyByRole, scopeOpportunityByRole } from "@/lib/crm/rbac";
import {
  createContactSchema,
  updateContactSchema,
  type CreateContactInput,
  type UpdateContactInput,
} from "@/lib/crm/validations/contact";
import { revalidatePath } from "next/cache";
import type { SessionUser } from "@/types";

export type ContactFilters = {
  search?: string;
  companyId?: string;
  page?: number;
  pageSize?: number;
};

/**
 * Unified shape returned to the contacts page. Two sources feed in:
 *
 *   source = "directory"   — curated CrmContact rows tied to a CrmCompany.
 *   source = "opportunity" — opp-level contacts: either the new
 *                            CrmOpportunityContact rows (id present) or
 *                            the legacy `customerContact*` columns from
 *                            CrmOpportunity itself (synthetic id =
 *                            `opp:<oppId>`).
 *
 * `scopeLabel` is what we render in the second column ("Company" header
 * still works for both sources because the opp's customerCompanyName is
 * the prospect's company in plain text). `scopeHref` is where the row
 * links to — the company page for directory rows, the opp page for opp
 * contacts.
 */
type UnifiedContact = {
  id: string;
  source: "directory" | "opportunity";
  fullName: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  scopeId: string;
  scopeLabel: string;
  scopeHref: string;
};

const DEFAULT_PAGE_SIZE = 20;

export async function getContacts(session: SessionUser, filters?: ContactFilters) {
  const page = filters?.page ?? 1;
  const pageSize = filters?.pageSize ?? DEFAULT_PAGE_SIZE;

  const companyScope = scopeCompanyByRole(session);
  const oppScope = scopeOpportunityByRole(session);
  const search = filters?.search?.trim() ?? "";

  // 1. Directory contacts (CrmContact). Stays company-scoped + uses the
  //    existing contains-search across name/email/phone.
  const directorySearch = search
    ? {
        OR: [
          { fullName: { contains: search, mode: "insensitive" as const } },
          { email: { contains: search, mode: "insensitive" as const } },
          { phone: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : {};
  const directoryWhere = {
    ...directorySearch,
    ...(filters?.companyId ? { companyId: filters.companyId } : {}),
    company: companyScope,
  };

  const directoryRows = await db.crmContact.findMany({
    where: directoryWhere,
    include: { company: { select: { id: true, nameEn: true, nameAr: true } } },
    orderBy: [{ isPrimary: "desc" }, { fullName: "asc" }],
  });

  // 2. Opp-level contacts. Two sub-sources: the new CrmOpportunityContact
  //    join rows (preferred, multiple per opp) and the legacy headline
  //    columns directly on CrmOpportunity (kept for backwards compat
  //    with rows created before the join existed). Both are filtered
  //    through the role-aware opp scope so a REP sees only their own
  //    deals' contacts.
  // Defensive against a stale `globalThis.prisma` reference in dev —
  // when a new model is added to the schema, the generated client is
  // updated but the cached PrismaClient instance keeps its old shape
  // until the dev server restarts. Without this guard, getContacts
  // throws "Cannot read properties of undefined (reading 'findMany')"
  // and the entire /crm/contacts page 500s. In production the cache
  // is rebuilt on cold start so this branch is unreachable.
  const oppContactRows =
    typeof db.crmOpportunityContact?.findMany === "function"
      ? await db.crmOpportunityContact.findMany({
          where: {
            ...(search
              ? {
                  OR: [
                    { name: { contains: search, mode: "insensitive" as const } },
                    { email: { contains: search, mode: "insensitive" as const } },
                    { phone: { contains: search, mode: "insensitive" as const } },
                  ],
                }
              : {}),
            opportunity: { ...oppScope, deletedAt: null },
          },
          include: {
            opportunity: {
              select: { id: true, code: true, title: true, customerCompanyName: true },
            },
          },
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        })
      : [];
  if (oppContactRows.length === 0 && typeof db.crmOpportunityContact?.findMany !== "function") {
    console.warn(
      "[getContacts] db.crmOpportunityContact unavailable — stale Prisma client. Restart dev server."
    );
  }

  const inlineOpps = await db.crmOpportunity.findMany({
    where: {
      ...oppScope,
      deletedAt: null,
      // Only opps that actually have a headline contact name; ignore
      // rows where the rep used only the new join table.
      customerContactName: { not: null },
      ...(search
        ? {
            OR: [
              { customerContactName: { contains: search, mode: "insensitive" as const } },
              { customerContactEmail: { contains: search, mode: "insensitive" as const } },
              { customerContactPhone: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      code: true,
      title: true,
      customerCompanyName: true,
      customerContactName: true,
      customerContactPhone: true,
      customerContactEmail: true,
    },
  });

  // 3. Merge into the unified shape. Dedupe (phone OR email match between
  //    directory + opp) collapses the same human appearing twice when a
  //    rep both linked a directory contact AND typed it inline. Directory
  //    rows win the tie because they carry richer metadata.
  const dedupeKey = (phone: string | null, email: string | null) =>
    [phone?.replace(/\D/g, "") ?? "", email?.toLowerCase() ?? ""].filter(Boolean).join("|");
  const seen = new Set<string>();

  const directoryUnified: UnifiedContact[] = directoryRows.map((c) => {
    const k = dedupeKey(c.phone, c.email);
    if (k) seen.add(k);
    return {
      id: c.id,
      source: "directory",
      fullName: c.fullName,
      role: c.role,
      email: c.email,
      phone: c.phone,
      isPrimary: c.isPrimary,
      scopeId: c.company.id,
      scopeLabel: c.company.nameEn,
      scopeHref: `/crm/companies/${c.company.id}`,
    };
  });

  const oppContactsUnified: UnifiedContact[] = oppContactRows
    .map((c): UnifiedContact => ({
      id: c.id,
      source: "opportunity",
      fullName: c.name,
      role: c.role,
      email: c.email,
      phone: c.phone,
      isPrimary: c.isPrimary,
      scopeId: c.opportunity.id,
      scopeLabel:
        c.opportunity.customerCompanyName ??
        c.opportunity.title ??
        c.opportunity.code,
      scopeHref: `/crm/opportunities/${c.opportunity.id}`,
    }))
    .filter((c) => {
      const k = dedupeKey(c.phone, c.email);
      if (k && seen.has(k)) return false;
      if (k) seen.add(k);
      return true;
    });

  const inlineUnified: UnifiedContact[] = inlineOpps
    .map((o): UnifiedContact => ({
      id: `opp:${o.id}`,
      source: "opportunity",
      fullName: o.customerContactName ?? "",
      role: null,
      email: o.customerContactEmail,
      phone: o.customerContactPhone,
      isPrimary: true,
      scopeId: o.id,
      scopeLabel: o.customerCompanyName ?? o.title ?? o.code,
      scopeHref: `/crm/opportunities/${o.id}`,
    }))
    .filter((c) => c.fullName.trim().length > 0)
    .filter((c) => {
      const k = dedupeKey(c.phone, c.email);
      if (k && seen.has(k)) return false;
      if (k) seen.add(k);
      return true;
    });

  const merged = [...directoryUnified, ...oppContactsUnified, ...inlineUnified].sort(
    (a, b) => {
      // Primary first within source, then alphabetical. Directory rows
      // outrank opp rows so the curated directory leads the list.
      if (a.source !== b.source) {
        return a.source === "directory" ? -1 : 1;
      }
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      return a.fullName.localeCompare(b.fullName);
    }
  );

  const total = merged.length;
  const skip = (page - 1) * pageSize;
  const contacts = merged.slice(skip, skip + pageSize);

  return JSON.parse(
    JSON.stringify({
      contacts,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    })
  );
}

export async function getContact(session: SessionUser, id: string) {
  const companyScope = scopeCompanyByRole(session);

  const contact = await db.crmContact.findFirst({
    where: { id, company: companyScope },
    include: {
      company: {
        select: {
          id: true,
          nameEn: true,
          nameAr: true,
          industry: true,
          phone: true,
          city: true,
          category: true,
          assignedToId: true,
        },
      },
      opportunities: {
        include: {
          owner: { select: { id: true, fullName: true } },
          entity: { select: { id: true, code: true, nameEn: true, nameAr: true, color: true } },
        },
        orderBy: { updatedAt: "desc" },
      },
    },
  });

  return contact ? JSON.parse(JSON.stringify(contact)) : null;
}

export async function createContact(session: SessionUser, data: CreateContactInput) {
  const parsed = createContactSchema.parse(data);

  // Verify user has access to the target company
  const companyScope = scopeCompanyByRole(session);
  const company = await db.crmCompany.findFirst({
    where: { id: parsed.companyId, ...companyScope },
  });
  if (!company) throw new Error("Company not found or access denied");

  // CRM Req. spec — phone numbers must be unique across the entire CRM. Block
  // creation if any existing contact already has the same digits.
  if (parsed.phone) {
    const normalized = parsed.phone.replace(/[^\d]/g, "");
    if (normalized.length >= 7) {
      const existing = await db.crmContact.findFirst({
        where: { phone: { contains: normalized } },
        select: { id: true, fullName: true, company: { select: { nameEn: true } } },
      });
      if (existing) {
        throw new Error(
          `Phone number already exists on contact "${existing.fullName}" (${existing.company?.nameEn ?? "—"})`
        );
      }
    }
  }

  const contact = await db.crmContact.create({
    data: parsed,
  });

  revalidatePath("/crm/contacts");
  revalidatePath(`/crm/companies/${parsed.companyId}`);
  return contact;
}

export async function updateContact(session: SessionUser, id: string, data: UpdateContactInput) {
  const parsed = updateContactSchema.parse(data);

  // Verify user has access to this contact's company
  const companyScope = scopeCompanyByRole(session);
  const existing = await db.crmContact.findFirst({
    where: { id, company: companyScope },
  });
  if (!existing) throw new Error("Contact not found or access denied");

  const contact = await db.crmContact.update({
    where: { id },
    data: parsed,
  });

  revalidatePath("/crm/contacts");
  revalidatePath(`/crm/contacts/${id}`);
  return contact;
}
