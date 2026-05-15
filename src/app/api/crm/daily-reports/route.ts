import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma";

const upsertSchema = z.object({
  reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "reportDate must be YYYY-MM-DD"),
  callsCount: z.number().int().min(0).max(500).optional(),
  meetingsBooked: z.number().int().min(0).max(50).optional(),
  meetingsHeld: z.number().int().min(0).max(50).optional(),
  newLeads: z.number().int().min(0).max(100).optional(),
  notes: z.string().trim().max(2000).optional(),
});

function isManagerOrAdmin(session: Session) {
  return (
    session.user.crmRole === "MANAGER" ||
    session.user.crmRole === "ADMIN" ||
    !!session.user.hrRoles?.includes("super_admin")
  );
}

/**
 * GET /api/crm/daily-reports
 * Query params: from=YYYY-MM-DD, to=YYYY-MM-DD, repId=<id>, scope=mine|all
 * Reps see only their own reports. Managers/admins see everyone.
 */
export async function GET(req: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const crmProfileId = session.user.crmProfileId;
  if (!crmProfileId) return NextResponse.json({ error: "No CRM profile" }, { status: 403 });

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const repIdParam = url.searchParams.get("repId");
  const scope = url.searchParams.get("scope") ?? "mine";

  const where: Prisma.CrmDailyReportWhereInput = {};
  const dateFilter: { gte?: Date; lte?: Date } = {};
  if (from) dateFilter.gte = new Date(`${from}T00:00:00.000Z`);
  if (to) dateFilter.lte = new Date(`${to}T23:59:59.999Z`);
  if (dateFilter.gte || dateFilter.lte) where.reportDate = dateFilter;

  if (isManagerOrAdmin(session)) {
    if (repIdParam) where.repId = repIdParam;
    else if (scope === "mine") where.repId = crmProfileId;
  } else {
    // Reps always see only their own.
    where.repId = crmProfileId;
  }

  const reports = await db.crmDailyReport.findMany({
    where,
    orderBy: { reportDate: "desc" },
    take: 200,
    include: { rep: { select: { id: true, fullName: true } } },
  });

  // Aggregate totals for the filtered set.
  const totals = reports.reduce(
    (acc, r) => ({
      callsCount: acc.callsCount + r.callsCount,
      meetingsBooked: acc.meetingsBooked + r.meetingsBooked,
      meetingsHeld: acc.meetingsHeld + r.meetingsHeld,
      newLeads: acc.newLeads + r.newLeads,
    }),
    { callsCount: 0, meetingsBooked: 0, meetingsHeld: 0, newLeads: 0 }
  );

  return NextResponse.json({ reports, totals });
}

/**
 * POST /api/crm/daily-reports
 * Upserts the report for (rep, reportDate). Reps can only upsert their own;
 * managers can upsert on behalf of any rep by passing `repId` in the body
 * (managers using `?repId=` query is supported via the GET endpoint).
 */
export async function POST(req: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const crmProfileId = session.user.crmProfileId;
  if (!crmProfileId) return NextResponse.json({ error: "No CRM profile" }, { status: 403 });

  const body = await req.json();
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const data = parsed.data;

  // Always upsert for the caller (managers reporting on behalf of others
  // should switch context — keeping the API simple for now).
  const repId = crmProfileId;
  const reportDate = new Date(`${data.reportDate}T00:00:00.000Z`);

  const report = await db.crmDailyReport.upsert({
    where: { repId_reportDate: { repId, reportDate } },
    create: {
      repId,
      reportDate,
      callsCount: data.callsCount ?? 0,
      meetingsBooked: data.meetingsBooked ?? 0,
      meetingsHeld: data.meetingsHeld ?? 0,
      newLeads: data.newLeads ?? 0,
      notes: data.notes ?? "",
    },
    update: {
      callsCount: data.callsCount ?? 0,
      meetingsBooked: data.meetingsBooked ?? 0,
      meetingsHeld: data.meetingsHeld ?? 0,
      newLeads: data.newLeads ?? 0,
      notes: data.notes ?? "",
    },
    include: { rep: { select: { id: true, fullName: true } } },
  });
  return NextResponse.json({ report }, { status: 201 });
}
