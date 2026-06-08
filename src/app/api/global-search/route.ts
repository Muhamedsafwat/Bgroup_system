import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { scopeOpportunityByRole, scopeCompanyByRole } from "@/lib/crm/rbac";
import type { SessionUser } from "@/types";
import type { CrmRole } from "@/generated/prisma";

// Unified result shape used by the command palette.
export type GlobalSearchResult = {
  type:
    | "company"
    | "contact"
    | "opportunity"
    | "employee"
    | "hr-company"
    | "hr-department"
    | "lead"
    | "client"
    | "deal"
    | "partner";
  module: "hr" | "crm" | "partners";
  id: string;
  label: string;
  sublabel?: string;
  href: string;
};

const PER_TYPE_LIMIT = 5;

export async function GET(req: NextRequest) {
  const authSession = await auth();
  if (!authSession?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Bound the query length so a multi-MB `q` can't tie up parallel
  // ILIKE scans across ~12 tables. The trigram indexes can't help
  // with arbitrarily long needles either.
  const rawQ = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const q = rawQ.slice(0, 100);
  if (!q || q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const modules = authSession.user.modules ?? [];
  const typesParam = req.nextUrl.searchParams.get("types");
  const requestedTypes = typesParam
    ? new Set(typesParam.split(",").map((s) => s.trim()))
    : null;
  const wants = (t: GlobalSearchResult["type"]) =>
    !requestedTypes || requestedTypes.has(t);

  const contains = { contains: q, mode: "insensitive" as const };
  const tasks: Promise<GlobalSearchResult[]>[] = [];

  // ─── CRM ─────────────────────────────────────────────────────────────────
  if (modules.includes("crm") && authSession.user.crmRole) {
    const crmSession: SessionUser = {
      id: authSession.user.crmProfileId || authSession.user.id,
      email: authSession.user.email!,
      fullName: authSession.user.name!,
      role: authSession.user.crmRole as CrmRole,
      entityId: authSession.user.crmEntityId ?? null,
    };

    if (wants("company")) {
      tasks.push(
        db.crmCompany
          .findMany({
            where: {
              ...scopeCompanyByRole(crmSession),
              OR: [
                { nameEn: contains },
                { nameAr: contains },
                { phone: contains },
              ],
            },
            select: { id: true, nameEn: true, phone: true },
            take: PER_TYPE_LIMIT,
          })
          .then((rows) =>
            rows.map((c) => ({
              type: "company" as const,
              module: "crm" as const,
              id: c.id,
              label: c.nameEn,
              sublabel: c.phone || undefined,
              href: `/crm/companies/${c.id}`,
            }))
          )
      );
    }

    if (wants("contact")) {
      tasks.push(
        db.crmContact
          .findMany({
            where: {
              company: scopeCompanyByRole(crmSession),
              OR: [
                { fullName: contains },
                { email: contains },
                { phone: contains },
              ],
            },
            select: { id: true, fullName: true, email: true, phone: true },
            take: PER_TYPE_LIMIT,
          })
          .then((rows) =>
            rows.map((c) => ({
              type: "contact" as const,
              module: "crm" as const,
              id: c.id,
              label: c.fullName,
              sublabel: c.email || c.phone || undefined,
              href: `/crm/contacts/${c.id}`,
            }))
          )
      );
    }

    if (wants("opportunity")) {
      tasks.push(
        db.crmOpportunity
          .findMany({
            where: {
              ...scopeOpportunityByRole(crmSession),
              OR: [
                { code: contains },
                { title: contains },
                { customerCompanyName: contains },
                { company: { nameEn: contains } },
              ],
            },
            select: {
              id: true,
              code: true,
              title: true,
              customerCompanyName: true,
              company: { select: { nameEn: true } },
            },
            take: PER_TYPE_LIMIT,
          })
          .then((rows) =>
            rows.map((o) => ({
              type: "opportunity" as const,
              module: "crm" as const,
              id: o.id,
              label: `${o.code} — ${o.customerCompanyName ?? o.company?.nameEn ?? ""}`,
              sublabel: o.title || undefined,
              href: `/crm/opportunities/${o.id}`,
            }))
          )
      );
    }
  }

  // ─── HR ──────────────────────────────────────────────────────────────────
  if (modules.includes("hr")) {
    const hrRoles = authSession.user.hrRoles ?? [];
    const isHrAdmin = hrRoles.some((r) =>
      ["super_admin", "hr_manager", "ceo", "accountant"].includes(r)
    );
    const hrCompanies = authSession.user.hrCompanies ?? [];

    // Employees: only HR admins / managers see the full directory; others see no employee results.
    if (wants("employee") && isHrAdmin) {
      tasks.push(
        db.hrEmployee
          .findMany({
            where: {
              ...(hrRoles.includes("super_admin") || hrRoles.includes("ceo")
                ? {}
                : hrCompanies.length
                  ? { companyId: { in: hrCompanies } }
                  : {}),
              OR: [
                { fullNameEn: contains },
                { fullNameAr: contains },
                { employeeId: contains },
                { personalEmail: contains },
                { phone: contains },
              ],
            },
            select: {
              id: true,
              fullNameEn: true,
              employeeId: true,
              positionEn: true,
            },
            take: PER_TYPE_LIMIT,
          })
          .then((rows) =>
            rows.map((e) => ({
              type: "employee" as const,
              module: "hr" as const,
              id: e.id,
              label: `${e.employeeId} — ${e.fullNameEn}`,
              sublabel: e.positionEn || undefined,
              href: `/hr/employees/${e.id}`,
            }))
          )
      );
    }

    if (wants("hr-company") && isHrAdmin) {
      tasks.push(
        db.hrCompany
          .findMany({
            where: {
              ...(hrRoles.includes("super_admin") || hrRoles.includes("ceo")
                ? {}
                : hrCompanies.length
                  ? { id: { in: hrCompanies } }
                  : {}),
              OR: [{ nameEn: contains }, { nameAr: contains }],
            },
            select: { id: true, nameEn: true, industry: true },
            take: PER_TYPE_LIMIT,
          })
          .then((rows) =>
            rows.map((c) => ({
              type: "hr-company" as const,
              module: "hr" as const,
              id: c.id,
              label: c.nameEn,
              sublabel: c.industry || undefined,
              href: `/hr/management/companies`,
            }))
          )
      );
    }

    if (wants("hr-department") && isHrAdmin) {
      tasks.push(
        db.hrDepartment
          .findMany({
            where: {
              ...(hrRoles.includes("super_admin") || hrRoles.includes("ceo")
                ? {}
                : hrCompanies.length
                  ? { companyId: { in: hrCompanies } }
                  : {}),
              OR: [{ nameEn: contains }, { nameAr: contains }],
            },
            select: { id: true, nameEn: true, company: { select: { nameEn: true } } },
            take: PER_TYPE_LIMIT,
          })
          .then((rows) =>
            rows.map((d) => ({
              type: "hr-department" as const,
              module: "hr" as const,
              id: d.id,
              label: d.nameEn,
              sublabel: d.company?.nameEn || undefined,
              href: `/hr/settings/departments`,
            }))
          )
      );
    }
  }

  // ─── Partners ────────────────────────────────────────────────────────────
  if (modules.includes("partners")) {
    const partnerId = authSession.user.partnerId; // undefined = admin
    const partnerScope = partnerId ? { partnerId } : {};

    if (wants("lead")) {
      tasks.push(
        db.partnerLead
          .findMany({
            where: {
              ...partnerScope,
              OR: [
                { name: contains },
                { email: contains },
                { phone: contains },
                { company: contains },
              ],
            },
            select: { id: true, name: true, company: true, status: true },
            take: PER_TYPE_LIMIT,
          })
          .then((rows) =>
            rows.map((l) => ({
              type: "lead" as const,
              module: "partners" as const,
              id: l.id,
              label: l.name,
              sublabel: [l.company, l.status].filter(Boolean).join(" · "),
              href: `/partners/leads/${l.id}`,
            }))
          )
      );
    }

    if (wants("client")) {
      tasks.push(
        db.partnerClient
          .findMany({
            where: {
              ...partnerScope,
              OR: [
                { name: contains },
                { email: contains },
                { phone: contains },
                { company: contains },
              ],
            },
            select: { id: true, name: true, company: true },
            take: PER_TYPE_LIMIT,
          })
          .then((rows) =>
            rows.map((c) => ({
              type: "client" as const,
              module: "partners" as const,
              id: c.id,
              label: c.name,
              sublabel: c.company || undefined,
              href: `/partners/clients/${c.id}`,
            }))
          )
      );
    }

    if (wants("deal")) {
      tasks.push(
        db.partnerDeal
          .findMany({
            where: {
              ...partnerScope,
              OR: [
                { notes: contains },
                { client: { name: contains } },
                { client: { company: contains } },
                { service: { name: contains } },
              ],
            },
            select: {
              id: true,
              value: true,
              status: true,
              client: { select: { name: true } },
              service: { select: { name: true } },
            },
            take: PER_TYPE_LIMIT,
          })
          .then((rows) =>
            rows.map((d) => ({
              type: "deal" as const,
              module: "partners" as const,
              id: d.id,
              label: `${d.client.name} · ${d.service.name}`,
              sublabel: `${d.value} · ${d.status}`,
              href: `/partners/deals/${d.id}`,
            }))
          )
      );
    }

    // Admin-only: search across partners
    if (wants("partner") && !partnerId) {
      tasks.push(
        db.partnerProfile
          .findMany({
            where: {
              OR: [
                { companyName: contains },
                { contactPhone: contains },
                { user: { email: contains } },
                { user: { name: contains } },
              ],
            },
            select: {
              id: true,
              companyName: true,
              user: { select: { email: true, name: true } },
            },
            take: PER_TYPE_LIMIT,
          })
          .then((rows) =>
            rows.map((p) => ({
              type: "partner" as const,
              module: "partners" as const,
              id: p.id,
              label: p.companyName,
              sublabel: p.user.name || p.user.email,
              href: `/partners/admin/partners`,
            }))
          )
      );
    }
  }

  const buckets = await Promise.all(tasks);
  const results = buckets.flat();

  return NextResponse.json({ results });
}
