import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { scopeColdLeadsByRole } from "@/lib/crm/cold-leads";
// audit v12 MEDIUM (MED-9): import project-wide helper so super_admin is covered
import { isManagerOrAdmin } from "@/lib/crm/admin-gates";
import type { Session } from "next-auth";
import type { SessionUser } from "@/types";
import type { Prisma, CrmColdLeadStatus } from "@/generated/prisma";

const PAGE_SIZE = 100;
const VALID_STATUSES = new Set<CrmColdLeadStatus>([
  "NEW",
  "ASSIGNED",
  "NO_ANSWER",
  "WAITING_LIST",
  "NOT_INTERESTED",
  "CONVERTED",
  "ARCHIVED",
]);

/**
 * GET /api/crm/cold-leads
 *
 * The filtered directory. Query params:
 *   status         CrmColdLeadStatus (NEW / ASSIGNED / NO_ANSWER / …)
 *   industry       partial match
 *   category       partial match
 *   location       partial match
 *   q              free text — name, company, phone, email
 *   assignedToId   filter by rep (manager/admin only)
 *   page           1-indexed
 *
 * Scope is enforced by `scopeColdLeadsByRole` — reps see only their own
 * assignments, managers see their team + the unassigned pool, admin sees
 * everything.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  // audit v12 MEDIUM (MED-9): allow platform super_admins who have no CRM profile row
  if (!session?.user?.id || (!session.user.crmProfileId && !session.user.hrRoles?.includes("super_admin"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // audit v12 MEDIUM (MED-9): super_admin may have no crmProfileId/crmRole;
  // give them ADMIN scope so scopeColdLeadsByRole returns an unrestricted filter.
  const isSuperAdmin = session.user.hrRoles?.includes("super_admin") ?? false;
  const sessionUser: SessionUser = {
    id: session.user.crmProfileId ?? session.user.id,
    email: session.user.email!,
    fullName: session.user.name!,
    role: isSuperAdmin ? "ADMIN" : session.user.crmRole!,
    entityId: session.user.crmEntityId ?? null,
  };

  const url = req.nextUrl;
  const status = url.searchParams.get("status");
  // audit v12 MEDIUM (MED-62) ultra: cap free-text params to prevent DoS via
  // arbitrarily long LIKE queries driving full-scan over the cold-leads table.
  const MAX_FREE_TEXT = 200;
  const rawQ = url.searchParams.get("q")?.trim();
  if (rawQ && rawQ.length > MAX_FREE_TEXT) {
    return NextResponse.json(
      { error: "Query parameter too long (max 200 characters)" },
      { status: 400 },
    );
  }
  const q = rawQ;
  const industry = url.searchParams.get("industry")?.trim().slice(0, MAX_FREE_TEXT);
  const category = url.searchParams.get("category")?.trim().slice(0, MAX_FREE_TEXT);
  const location = url.searchParams.get("location")?.trim().slice(0, MAX_FREE_TEXT);
  const assignedToId = url.searchParams.get("assignedToId");
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  // Folder-drilldown: `?batchId=<id>` narrows the list to one upload's
  // worth of leads (one CrmColdLeadImport row). `?batchId=unfiled` shows
  // leads that have no import batch attached — typically rows created
  // manually or whose folder was deleted in detach mode.
  const batchId = url.searchParams.get("batchId");

  const where: Prisma.CrmColdLeadWhereInput = {
    ...scopeColdLeadsByRole(sessionUser),
  };
  if (status && VALID_STATUSES.has(status as CrmColdLeadStatus)) {
    where.status = status as CrmColdLeadStatus;
  }
  if (industry) where.industry = { contains: industry, mode: "insensitive" };
  if (category) where.category = { contains: category, mode: "insensitive" };
  if (location) where.location = { contains: location, mode: "insensitive" };
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { companyName: { contains: q, mode: "insensitive" } },
      { phone: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
    ];
  }
  // audit v12 MEDIUM (MED-9): use project-wide helper so super_admin gets full visibility
  if (assignedToId && isManagerOrAdmin(session as Session)) {
    where.assignedToId = assignedToId === "unassigned" ? null : assignedToId;
  }
  if (batchId) {
    where.importBatchId = batchId === "unfiled" ? null : batchId;
  }

  const [rows, total, bucketCounts] = await Promise.all([
    db.crmColdLead.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      include: {
        assignedTo: { select: { id: true, fullName: true } },
      },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.crmColdLead.count({ where }),
    // Bucket counts (across the SAME scope, without the status filter) so the
    // UI's bucket-tabs always show how many rows live in each pool.
    db.crmColdLead.groupBy({
      by: ["status"],
      where: scopeColdLeadsByRole(sessionUser),
      _count: { _all: true },
    }),
  ]);

  const counts: Record<string, number> = {};
  for (const b of bucketCounts) counts[b.status] = b._count._all;

  return NextResponse.json({
    rows,
    total,
    page,
    pageSize: PAGE_SIZE,
    counts,
  });
}
