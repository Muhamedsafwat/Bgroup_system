import { db } from "@/lib/db";
import type { Session } from "next-auth";

export type TodayBucket<T> = { items: T[]; total: number };

export type TodayApprovalRow = {
  id: string;
  module: "hr" | "partners";
  type: string;
  label: string;
  sublabel?: string;
  href: string;
  createdAt: string;
};

export type TodayCallRow = {
  id: string;
  company: string;
  outcome: string | null;
  callAt: string;
  href: string;
};

export type TodayClosingRow = {
  id: string;
  code: string;
  company: string;
  expectedCloseDate: string;
  weightedValueEGP: number;
  href: string;
};

export type TodayMilestoneRow = {
  id: string;
  type: "birthday" | "anniversary" | "probation_end" | "contract_end";
  employeeName: string;
  date: string;
  href: string;
};

export type TodayTaskRow = {
  id: string;
  title: string;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  dueAt: string | null;
  module: string;
  isOverdue: boolean;
};

export type TodayData = {
  approvals: TodayBucket<TodayApprovalRow>;
  callsToday: TodayBucket<TodayCallRow>;
  closingThisWeek: TodayBucket<TodayClosingRow>;
  milestones: TodayBucket<TodayMilestoneRow>;
  tasks: TodayBucket<TodayTaskRow>;
};

const EMPTY_BUCKET = <T>(): TodayBucket<T> => ({ items: [], total: 0 });

/**
 * Aggregates "what should I do today" rows across HR, CRM, and Partners.
 * Honours the session's modules + roles — never returns rows the caller
 * shouldn't see.
 */
export async function getTodayData(session: Session): Promise<TodayData> {
  const userId = session.user.id;
  const modules = session.user.modules ?? [];
  const hrRoles = session.user.hrRoles ?? [];
  const isHrAdmin = hrRoles.some((r) =>
    ["super_admin", "hr_manager"].includes(r)
  );
  const isHrApprover = isHrAdmin || hrRoles.includes("team_lead");
  const isPartnersAdmin = modules.includes("partners") && !session.user.partnerId;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const sevenDaysFromNow = new Date(today);
  sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

  const tasks: Promise<Partial<TodayData>>[] = [];

  // ── HR pending approvals (managers/leads/admins only) ────────────────────
  if (modules.includes("hr") && isHrApprover) {
    tasks.push(
      Promise.all([
        db.hrOvertimeRequest.findMany({
          where: { status: "pending" },
          orderBy: { createdAt: "desc" },
          take: 10,
          include: { employee: { select: { fullNameEn: true } } },
        }),
        db.hrLeaveRequest.findMany({
          where: { status: "pending" },
          orderBy: { createdAt: "desc" },
          take: 10,
          include: { employee: { select: { fullNameEn: true } } },
        }),
      ]).then(([overtimes, leaves]) => {
        const items: TodayApprovalRow[] = [
          ...overtimes.map((o) => ({
            id: o.id,
            module: "hr" as const,
            type: "overtime",
            label: `Overtime · ${o.employee.fullNameEn}`,
            sublabel: `${Number(o.hoursRequested)}h on ${o.date.toISOString().split("T")[0]}`,
            href: `/hr/overtime/pending`,
            createdAt: o.createdAt.toISOString(),
          })),
          ...leaves.map((l) => ({
            id: l.id,
            module: "hr" as const,
            type: "leave",
            label: `Leave · ${l.employee.fullNameEn}`,
            sublabel: `${l.daysCount} day(s)`,
            href: `/hr/attendance/today`,
            createdAt: l.createdAt.toISOString(),
          })),
        ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return {
          approvals: { items: items.slice(0, 10), total: items.length },
        };
      })
    );
  }

  // ── Partners admin approvals (contracts, invoices, commissions) ──────────
  if (isPartnersAdmin) {
    tasks.push(
      Promise.all([
        db.partnerContract.findMany({
          where: { status: "REQUESTED" },
          orderBy: { requestedAt: "desc" },
          take: 10,
          include: {
            partner: { select: { companyName: true } },
            deal: { select: { value: true } },
          },
        }),
        db.partnerInvoice.findMany({
          where: { status: "REQUESTED" },
          orderBy: { requestedAt: "desc" },
          take: 10,
          include: {
            partner: { select: { companyName: true } },
            deal: { select: { value: true } },
          },
        }),
        db.partnerCommission.findMany({
          where: { status: "PENDING" },
          orderBy: { createdAt: "desc" },
          take: 10,
          include: { partner: { select: { companyName: true } } },
        }),
      ]).then(([contracts, invoices, commissions]) => {
        const items: TodayApprovalRow[] = [
          ...contracts.map((c) => ({
            id: c.id,
            module: "partners" as const,
            type: "contract",
            label: `Contract · ${c.partner.companyName}`,
            sublabel: `Deal value $${c.deal.value.toLocaleString()}`,
            href: `/partners/admin/contracts`,
            createdAt: c.requestedAt.toISOString(),
          })),
          ...invoices.map((i) => ({
            id: i.id,
            module: "partners" as const,
            type: "invoice",
            label: `Invoice · ${i.partner.companyName}`,
            sublabel: `Deal value $${i.deal.value.toLocaleString()}`,
            href: `/partners/admin/invoices`,
            createdAt: i.requestedAt.toISOString(),
          })),
          ...commissions.map((c) => ({
            id: c.id,
            module: "partners" as const,
            type: "commission",
            label: `Commission · ${c.partner.companyName}`,
            sublabel: `$${c.amount.toLocaleString()} pending approval`,
            href: `/partners/admin/commissions`,
            createdAt: c.createdAt.toISOString(),
          })),
        ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return {
          approvals: { items: items.slice(0, 10), total: items.length },
        };
      })
    );
  }

  // ── CRM: today's calls + deals closing this week ─────────────────────────
  if (modules.includes("crm") && session.user.crmRole) {
    const crmId = session.user.crmProfileId || userId;

    tasks.push(
      Promise.all([
        db.crmCall.findMany({
          where: {
            callerId: crmId,
            callAt: { gte: today, lt: tomorrow },
          },
          orderBy: { callAt: "asc" },
          take: 20,
          include: { company: { select: { nameEn: true } } },
        }),
        db.crmOpportunity.findMany({
          where: {
            ownerId: crmId,
            stage: { notIn: ["WON", "LOST"] },
            expectedCloseDate: { gte: today, lt: sevenDaysFromNow },
          },
          orderBy: { expectedCloseDate: "asc" },
          take: 10,
          include: { company: { select: { nameEn: true } } },
        }),
      ]).then(([calls, closing]) => ({
        callsToday: {
          items: calls.map((c) => ({
            id: c.id,
            company: c.company?.nameEn ?? "—",
            outcome: c.outcome,
            callAt: c.callAt.toISOString(),
            href: `/crm/calls`,
          })),
          total: calls.length,
        },
        closingThisWeek: {
          items: closing.map((o) => ({
            id: o.id,
            code: o.code,
            company: o.customerCompanyName ?? o.company?.nameEn ?? "—",
            expectedCloseDate: o.expectedCloseDate?.toISOString() ?? "",
            weightedValueEGP: Number(o.weightedValueEGP),
            href: `/crm/opportunities/${o.id}`,
          })),
          total: closing.length,
        },
      }))
    );
  }

  // ── Tasks: due today + overdue, scoped to current user ──────────────────
  tasks.push(
    db.task
      .findMany({
        where: {
          assigneeId: userId,
          status: { not: "DONE" },
          OR: [
            { dueAt: { lt: tomorrow } }, // today or overdue
            { dueAt: null, priority: { in: ["HIGH", "URGENT"] } },
          ],
        },
        orderBy: [{ dueAt: "asc" }, { priority: "desc" }],
        take: 20,
      })
      .then((rows) => ({
        tasks: {
          items: rows.map((t) => ({
            id: t.id,
            title: t.title,
            priority: t.priority,
            dueAt: t.dueAt?.toISOString() ?? null,
            module: t.module,
            isOverdue: !!(t.dueAt && t.dueAt < today),
          })),
          total: rows.length,
        },
      }))
  );

  // ── HR milestones (probation/contract endings + birthdays) ───────────────
  if (modules.includes("hr") && isHrApprover) {
    const ninetyDaysFromNow = new Date(today);
    ninetyDaysFromNow.setDate(ninetyDaysFromNow.getDate() + 90);

    tasks.push(
      db.hrEmployee
        .findMany({
          where: {
            status: { in: ["active", "probation"] },
            OR: [
              { probationEnd: { gte: today, lt: ninetyDaysFromNow } },
              { contractEnd: { gte: today, lt: ninetyDaysFromNow } },
            ],
          },
          select: {
            id: true,
            fullNameEn: true,
            probationEnd: true,
            contractEnd: true,
          },
          take: 20,
        })
        .then((rows) => {
          const items: TodayMilestoneRow[] = [];
          for (const e of rows) {
            if (e.probationEnd) {
              items.push({
                id: `prob-${e.id}`,
                type: "probation_end",
                employeeName: e.fullNameEn,
                date: e.probationEnd.toISOString(),
                href: `/hr/employees/${e.id}`,
              });
            }
            if (e.contractEnd) {
              items.push({
                id: `cont-${e.id}`,
                type: "contract_end",
                employeeName: e.fullNameEn,
                date: e.contractEnd.toISOString(),
                href: `/hr/employees/${e.id}`,
              });
            }
          }
          items.sort((a, b) => a.date.localeCompare(b.date));
          return { milestones: { items: items.slice(0, 10), total: items.length } };
        })
    );
  }

  const partials = await Promise.all(tasks);

  // Merge — last writer wins for any single bucket; but we structured so each
  // task fills only its own buckets.
  const merged: TodayData = {
    approvals: EMPTY_BUCKET<TodayApprovalRow>(),
    callsToday: EMPTY_BUCKET<TodayCallRow>(),
    closingThisWeek: EMPTY_BUCKET<TodayClosingRow>(),
    milestones: EMPTY_BUCKET<TodayMilestoneRow>(),
    tasks: EMPTY_BUCKET<TodayTaskRow>(),
  };
  for (const p of partials) {
    if (p.approvals) {
      // Concatenate when both HR and Partners contribute approvals.
      merged.approvals.items = [...merged.approvals.items, ...p.approvals.items]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 10);
      merged.approvals.total += p.approvals.total;
    }
    if (p.callsToday) merged.callsToday = p.callsToday;
    if (p.closingThisWeek) merged.closingThisWeek = p.closingThisWeek;
    if (p.milestones) merged.milestones = p.milestones;
    if (p.tasks) merged.tasks = p.tasks;
  }

  return merged;
}
