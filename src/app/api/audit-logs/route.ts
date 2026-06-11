import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma";
import { z } from "zod";

export type UnifiedAuditEntry = {
  id: string;
  module: "hr" | "partners";
  userId: string | null;
  userLabel: string | null;
  action: string;
  entity: string;
  entityId: string;
  fieldName?: string;
  oldValue?: string | null;
  newValue?: string | null;
  ipAddress: string | null;
  timestamp: string;
};

const PAGE_SIZE = 50;

// audit v12 HIGH (HIGH-40): validate date query params before they reach new Date() / Prisma
const dateStringSchema = z.string().refine(
  (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s).getTime()),
  { message: "Must be a valid ISO date string (YYYY-MM-DD)" }
);

// audit v12 MEDIUM (MED-57) recheck: bound and sanitise the three remaining free-text filter params
// to prevent DoS-style oversized queries and log-injection via arbitrarily long strings.
const filterStringSchema = z.string().max(256).regex(/^[\w\s.\-:@]+$/, {
  message: "Filter value contains invalid characters",
});

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Only platform-level admins can browse all audit logs.
  const hrSuperAdmin = session.user.hrRoles?.includes("super_admin");
  const partnersAdmin =
    session.user.modules?.includes("partners") && !session.user.partnerId;
  if (!hrSuperAdmin && !partnersAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  // audit v12 MEDIUM (MED-57) recheck: validate module against the known enum rather than a raw cast
  const moduleRaw = url.searchParams.get("module");
  const moduleFilter = moduleRaw === "hr" || moduleRaw === "partners" ? moduleRaw : null;
  const entityFilter = url.searchParams.get("entity");
  const userFilter = url.searchParams.get("userId");
  const actionFilter = url.searchParams.get("action");
  const startDate = url.searchParams.get("startDate");
  const endDate = url.searchParams.get("endDate");
  // audit v12 HIGH: clamp page to prevent huge-skip scans on both tables in parallel
  const rawPage = Math.max(1, Number(url.searchParams.get("page") ?? 1));

  // audit v12 HIGH (HIGH-40): reject malformed date strings before they reach new Date() / Prisma
  if (startDate) {
    const r = dateStringSchema.safeParse(startDate);
    if (!r.success) {
      return NextResponse.json({ error: "Invalid startDate", details: r.error.flatten() }, { status: 400 });
    }
  }
  if (endDate) {
    const r = dateStringSchema.safeParse(endDate);
    if (!r.success) {
      return NextResponse.json({ error: "Invalid endDate", details: r.error.flatten() }, { status: 400 });
    }
  }

  // audit v12 MEDIUM (MED-57) recheck: validate unbounded string filters before they reach Prisma
  if (entityFilter) {
    const r = filterStringSchema.safeParse(entityFilter);
    if (!r.success) return NextResponse.json({ error: "Invalid entity filter" }, { status: 400 });
  }
  if (userFilter) {
    const r = z.string().uuid().safeParse(userFilter);
    if (!r.success) return NextResponse.json({ error: "Invalid userId filter" }, { status: 400 });
  }
  if (actionFilter) {
    const r = filterStringSchema.safeParse(actionFilter);
    if (!r.success) return NextResponse.json({ error: "Invalid action filter" }, { status: 400 });
  }

  const dateRange =
    startDate || endDate
      ? {
          gte: startDate ? new Date(startDate) : undefined,
          lte: endDate ? endOfDay(endDate) : undefined,
        }
      : undefined;

  // Build where clauses up front so counts reuse the same filters
  const hrWhere: Prisma.HrAuditLogWhereInput = {};
  if (entityFilter) hrWhere.entityType = entityFilter;
  if (userFilter) hrWhere.userId = userFilter;
  if (actionFilter) hrWhere.action = actionFilter;
  if (dateRange) hrWhere.timestamp = dateRange;

  const partnerWhere: Prisma.PartnerAuditLogWhereInput = {};
  if (entityFilter) partnerWhere.entity = entityFilter;
  if (userFilter) partnerWhere.userId = userFilter;
  if (actionFilter) partnerWhere.action = actionFilter;
  if (dateRange) partnerWhere.createdAt = dateRange;

  const shouldQueryHr = (!moduleFilter || moduleFilter === "hr") && hrSuperAdmin;
  const shouldQueryPartners = (!moduleFilter || moduleFilter === "partners") && partnersAdmin;

  // audit v12 HIGH: fetch total counts first so we can clamp rawPage and avoid runaway skips
  const [hrTotal, partnerTotal] = await Promise.all([
    shouldQueryHr ? db.hrAuditLog.count({ where: hrWhere }) : Promise.resolve(0),
    shouldQueryPartners
      ? db.partnerAuditLog.count({ where: partnerWhere })
      : Promise.resolve(0),
  ]);

  const combinedTotal = hrTotal + partnerTotal;
  const maxPage = Math.max(1, Math.ceil(combinedTotal / PAGE_SIZE));
  const page = Math.min(rawPage, maxPage);
  const skip = (page - 1) * PAGE_SIZE;

  const tasks: Promise<UnifiedAuditEntry[]>[] = [];

  // audit v12 MEDIUM (MED-34): fetch skip+PAGE_SIZE rows from each module without a per-module
  // skip, merge+sort globally, then slice to the correct page window so cross-module rows are
  // not silently dropped on pages > 1.
  if (shouldQueryHr) {
    tasks.push(
      db.hrAuditLog
        .findMany({
          where: hrWhere,
          orderBy: { timestamp: "desc" },
          take: skip + PAGE_SIZE,
          include: { user: { include: { user: { select: { email: true } } } } },
        })
        .then((rows) =>
          rows.map<UnifiedAuditEntry>((r) => ({
            id: r.id,
            module: "hr",
            userId: r.userId,
            userLabel: r.user?.user?.email ?? null,
            action: r.action,
            entity: r.entityType,
            entityId: r.entityId,
            fieldName: r.fieldName || undefined,
            oldValue: r.oldValue,
            newValue: r.newValue,
            ipAddress: r.ipAddress,
            timestamp: r.timestamp.toISOString(),
          }))
        )
    );
  }

  if (shouldQueryPartners) {
    tasks.push(
      db.partnerAuditLog
        .findMany({
          where: partnerWhere,
          orderBy: { createdAt: "desc" },
          take: skip + PAGE_SIZE,
        })
        .then(async (rows) => {
          const userIds = Array.from(new Set(rows.map((r) => r.userId).filter(Boolean)));
          const users = userIds.length
            ? await db.user.findMany({
                where: { id: { in: userIds } },
                select: { id: true, email: true },
              })
            : [];
          const emailById = new Map(users.map((u) => [u.id, u.email]));
          return rows.map<UnifiedAuditEntry>((r) => ({
            id: r.id,
            module: "partners",
            userId: r.userId,
            userLabel: emailById.get(r.userId) ?? null,
            action: r.action,
            entity: r.entity,
            entityId: r.entityId,
            oldValue: r.oldData ? JSON.stringify(r.oldData) : null,
            newValue: r.newData ? JSON.stringify(r.newData) : null,
            ipAddress: r.ipAddress,
            timestamp: r.createdAt.toISOString(),
          }));
        })
    );
  }

  const buckets = await Promise.all(tasks);
  const all = buckets
    .flat()
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(skip, skip + PAGE_SIZE);

  return NextResponse.json({
    entries: all,
    page,
    pageSize: PAGE_SIZE,
    totalCount: combinedTotal,
  });
}

function endOfDay(s: string): Date {
  const d = new Date(s);
  // audit v12 MEDIUM (MED-33): use setUTCHours so the boundary is always
  // 23:59:59.999 UTC regardless of server local timezone, since new Date(s)
  // for a YYYY-MM-DD string anchors to UTC midnight.
  d.setUTCHours(23, 59, 59, 999);
  return d;
}