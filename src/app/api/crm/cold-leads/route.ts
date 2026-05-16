import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { scopeColdLeadsByRole } from "@/lib/crm/cold-leads";
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
  if (!session?.user?.id || !session.user.crmProfileId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sessionUser: SessionUser = {
    id: session.user.crmProfileId,
    email: session.user.email!,
    fullName: session.user.name!,
    role: session.user.crmRole!,
    entityId: session.user.crmEntityId ?? null,
  };

  const url = req.nextUrl;
  const status = url.searchParams.get("status");
  const industry = url.searchParams.get("industry");
  const category = url.searchParams.get("category");
  const location = url.searchParams.get("location");
  const q = url.searchParams.get("q")?.trim();
  const assignedToId = url.searchParams.get("assignedToId");
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));

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
  if (assignedToId && (sessionUser.role === "ADMIN" || sessionUser.role === "MANAGER")) {
    where.assignedToId = assignedToId === "unassigned" ? null : assignedToId;
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
