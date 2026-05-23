import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import ExcelJS from "exceljs";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma";

/**
 * GET /api/crm/daily-reports/export
 *
 * Streams the filtered daily-reports set as an .xlsx attachment.
 *
 * Query params (all optional):
 *   from       YYYY-MM-DD — inclusive lower bound on reportDate
 *   to         YYYY-MM-DD — inclusive upper bound on reportDate
 *   day        YYYY-MM-DD — exact-day shortcut. Overrides from/to.
 *   repId      Filter to one rep. Managers/admins only; REPs are
 *              always forced to their own profile and the param is
 *              ignored if they try to use it.
 *
 * Filtering examples:
 *   ?day=2026-05-19              — just that day
 *   ?from=2026-05-01&to=2026-05-19 — May 1 through May 19 inclusive
 *   ?from=2026-05-01             — May 1 onward
 *
 * Permission model:
 *   - ADMIN / MANAGER / super_admin: see every rep's reports by
 *     default, or filter to a specific rep via repId. Used to pull
 *     "all of last month" or "Sara's last 7 days" into a spreadsheet
 *     for review.
 *   - REP / other: forced to their own profile regardless of repId.
 *     Returns their reports for the requested window so they can
 *     download their own activity log.
 *
 * The sheet has one row per daily report plus a trailing TOTAL row,
 * with columns: Date, Rep, Calls, Meetings booked, Meetings held,
 * New leads, Notes. The filename is the date range so re-downloads
 * don't collide.
 */
function isManagerOrAdmin(session: Session) {
  return (
    session.user.crmRole === "MANAGER" ||
    session.user.crmRole === "ADMIN" ||
    !!session.user.hrRoles?.includes("super_admin")
  );
}

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const crmProfileId = session.user.crmProfileId;
  if (!crmProfileId) {
    return NextResponse.json({ error: "No CRM profile" }, { status: 403 });
  }

  const url = new URL(req.url);
  const day = url.searchParams.get("day");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const repIdParam = url.searchParams.get("repId");
  // `scope=mine` mirrors the list endpoint: for managers/admins, it
  // narrows the export to just their own reports (defaults to all
  // reps otherwise). REPs are forced to their own profile below
  // regardless of this param.
  const scope = url.searchParams.get("scope");

  // Validate date inputs up-front so we don't construct invalid Date
  // ranges that pull every row in the table.
  for (const [name, val] of [["day", day], ["from", from], ["to", to]] as const) {
    if (val && !DATE_REGEX.test(val)) {
      return NextResponse.json(
        { error: `${name} must be in YYYY-MM-DD format` },
        { status: 400 }
      );
    }
  }

  const where: Prisma.CrmDailyReportWhereInput = {};
  if (day) {
    // Exact-day shortcut. UTC midnight ↔ UTC midnight + 24h gives a
    // half-open range that catches everything stored for that date.
    const dayStart = new Date(`${day}T00:00:00.000Z`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    where.reportDate = { gte: dayStart, lt: dayEnd };
  } else {
    const dateFilter: { gte?: Date; lte?: Date } = {};
    if (from) dateFilter.gte = new Date(`${from}T00:00:00.000Z`);
    if (to) dateFilter.lte = new Date(`${to}T23:59:59.999Z`);
    if (dateFilter.gte || dateFilter.lte) where.reportDate = dateFilter;
  }

  // Rep scope. REPs always see their own; managers/admins can pick
  // a specific rep via repId, narrow to themselves via scope=mine,
  // or fall back to org-wide.
  if (isManagerOrAdmin(session)) {
    if (repIdParam) where.repId = repIdParam;
    else if (scope === "mine") where.repId = crmProfileId;
  } else {
    where.repId = crmProfileId;
  }

  const reports = await db.crmDailyReport.findMany({
    where,
    orderBy: [{ reportDate: "asc" }, { repId: "asc" }],
    include: { rep: { select: { id: true, fullName: true, fullNameAr: true } } },
    // Cap so a "from-only" with no upper bound on a large dataset
    // doesn't OOM the worker; managers needing more should narrow
    // the date range.
    take: 10_000,
  });

  // Build the workbook in memory. ExcelJS is already a dep (used by
  // the cold-leads import); writeBuffer is the streaming path for a
  // Response body.
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "BGroup Super App";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Daily reports");

  sheet.columns = [
    { header: "Date", key: "date", width: 12 },
    { header: "Rep", key: "rep", width: 24 },
    { header: "Calls", key: "calls", width: 8 },
    { header: "Meetings booked", key: "booked", width: 16 },
    { header: "Meetings held", key: "held", width: 14 },
    { header: "New leads", key: "newLeads", width: 11 },
    { header: "Notes", key: "notes", width: 60 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { vertical: "middle" };

  // YYYY-MM-DD without timezone surprises — the column stores midnight
  // UTC so .toISOString() picks the right calendar day.
  const ymd = (d: Date) => d.toISOString().slice(0, 10);

  let totalCalls = 0;
  let totalBooked = 0;
  let totalHeld = 0;
  let totalNewLeads = 0;

  for (const r of reports) {
    sheet.addRow({
      date: ymd(r.reportDate),
      rep: r.rep?.fullName ?? "—",
      calls: r.callsCount,
      booked: r.meetingsBooked,
      held: r.meetingsHeld,
      newLeads: r.newLeads,
      notes: r.notes ?? "",
    });
    totalCalls += r.callsCount;
    totalBooked += r.meetingsBooked;
    totalHeld += r.meetingsHeld;
    totalNewLeads += r.newLeads;
  }

  // Totals row — bold, with sum across the date range. Skipped when
  // there are no rows so the user doesn't open an empty file with a
  // stray "TOTAL 0 0 0 0" line.
  if (reports.length > 0) {
    const totalsRow = sheet.addRow({
      date: "TOTAL",
      rep: "",
      calls: totalCalls,
      booked: totalBooked,
      held: totalHeld,
      newLeads: totalNewLeads,
      notes: `${reports.length} report${reports.length === 1 ? "" : "s"}`,
    });
    totalsRow.font = { bold: true };
    totalsRow.alignment = { vertical: "middle" };
  } else {
    sheet.addRow({
      date: "",
      rep: "",
      calls: 0,
      booked: 0,
      held: 0,
      newLeads: 0,
      notes: "No reports in this window",
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();

  // Filename reflects the filter so consecutive downloads don't
  // overwrite each other in the user's Downloads folder.
  const filenameDateLabel = day
    ? day
    : from && to
      ? `${from}_to_${to}`
      : from
        ? `from_${from}`
        : to
          ? `to_${to}`
          : "all";
  const filename = `daily-reports-${filenameDateLabel}.xlsx`;

  return new Response(buffer as ArrayBuffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
