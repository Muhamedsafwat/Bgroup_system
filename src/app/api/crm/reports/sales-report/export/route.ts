import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import ExcelJS from "exceljs";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isAdminOnly } from "@/lib/crm/admin-gates";

/**
 * GET /api/crm/reports/sales-report/export?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Single-sheet sales report mirroring the layout the user shared as
 * a reference (`Sales Report .xlsx`). Sections top to bottom:
 *
 *   Row 1   — Big title "SALES REPORT"
 *   Row 2-3 — Company / Sales manager / Date range
 *   Row 5   — Section bar "Leads Revenue"
 *   Row 6   — Headers: Customer / Service / Service cost /
 *             Total income / Lead stage / Contact # / Source /
 *             Quality / Deal type / Handing over / Closing %
 *   Rows 7+ — One row per opp in the window
 *   Then    — "Total Estimated Revenue" bar + per-service SUMIF +
 *             % share row
 *   Then    — REVENUE BREAKDOWN / TOTAL INCOME PER ITEM bars
 *   Then    — Three side-by-side bucket tables: source / quality /
 *             lead stage counts
 *   Then    — Period KPIs (calls / opened / won / lost / ongoing)
 *
 * Reference embedded three pie charts; we ship the underlying numbers
 * and skip chart-XML embedding (ExcelJS chart API is finicky and the
 * tables answer the question on their own).
 */

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// audit v12 HIGH (HIGH-38): Prevent formula-injection by prefixing any cell
// value that begins with a formula-trigger character (=, +, -, @, tab, CR)
// with a single-quote so Excel treats it as plain text.
function safeLabel(v: string | null | undefined, fallback = "—"): string {
  const s = v ?? fallback;
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

// Maps internal priority codes to the reference's "Quality" labels.
const PRIORITY_TO_QUALITY: Record<string, string> = {
  HOT: "Excellent",
  WARM: "Good",
  COLD: "Medium",
};

function styleSectionBar(row: ExcelJS.Row, height = 24) {
  row.height = height;
  row.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 13 };
    c.alignment = { horizontal: "center", vertical: "middle" };
    c.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF2E7D32" },
    };
  });
}

function styleHeaderRow(row: ExcelJS.Row) {
  row.height = 32;
  row.eachCell((c) => {
    c.font = { bold: true, size: 11 };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    c.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF1F3F4" },
    };
    c.border = {
      top: { style: "thin", color: { argb: "FFCCCCCC" } },
      bottom: { style: "thin", color: { argb: "FFCCCCCC" } },
      left: { style: "thin", color: { argb: "FFCCCCCC" } },
      right: { style: "thin", color: { argb: "FFCCCCCC" } },
    };
  });
}

function styleDataRow(row: ExcelJS.Row) {
  row.height = 22;
  row.eachCell((c) => {
    c.alignment = { vertical: "middle" };
    c.border = {
      top: { style: "hair", color: { argb: "FFE0E0E0" } },
      bottom: { style: "hair", color: { argb: "FFE0E0E0" } },
      left: { style: "hair", color: { argb: "FFE0E0E0" } },
      right: { style: "hair", color: { argb: "FFE0E0E0" } },
    };
  });
}

export async function GET(req: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdminOnly(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  for (const [name, val] of [["from", fromParam], ["to", toParam]] as const) {
    if (val && !DATE_RE.test(val)) {
      return NextResponse.json({ error: `${name} must be YYYY-MM-DD` }, { status: 400 });
    }
  }
  const to = toParam ? new Date(`${toParam}T23:59:59.999Z`) : new Date();
  const from = fromParam
    ? new Date(`${fromParam}T00:00:00.000Z`)
    : new Date(to.getTime() - SEVEN_DAYS);

  // Window of relevance: opps either created, closed, OR updated
  // inside the window. Widened so deals touched during the week
  // (stage moves, owner reassign, notes) show up even if created
  // earlier — matches what "this week's activity" should mean.
  const opps = await db.crmOpportunity.findMany({
    where: {
      deletedAt: null,
      OR: [
        { createdAt: { gte: from, lte: to } },
        { dateClosed: { gte: from, lte: to } },
        { updatedAt: { gte: from, lte: to } },
      ],
    },
    include: {
      owner: { select: { fullName: true } },
      products: {
        include: { product: { select: { nameEn: true } } },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 10_000,
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = session.user.name ?? "BGroup CRM";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Sales Report");
  sheet.columns = [
    { width: 20 },
    { width: 22 },
    { width: 14 },
    { width: 14 },
    { width: 18 },
    { width: 16 },
    { width: 14 },
    { width: 12 },
    { width: 16 },
    { width: 16 },
    { width: 14 },
  ];
  sheet.views = [{ showGridLines: false }];

  // Row 1: title.
  sheet.mergeCells("A1:K1");
  const titleRow = sheet.getRow(1);
  const titleCell = titleRow.getCell("A");
  titleCell.value = "SALES REPORT";
  titleCell.font = { bold: true, size: 28, color: { argb: "FFFFFFFF" } };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  titleCell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1B5E20" },
  };
  titleRow.height = 50;

  // Row 2: labels.
  sheet.mergeCells("A2:C2");
  sheet.mergeCells("D2:F2");
  sheet.mergeCells("G2:K2");
  sheet.getCell("A2").value = "Company Name";
  sheet.getCell("D2").value = "Sales Manager";
  sheet.getCell("G2").value = "Week Starting & Ending";
  for (const ref of ["A2", "D2", "G2"]) {
    const c = sheet.getCell(ref);
    c.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
    c.alignment = { horizontal: "center", vertical: "middle" };
    c.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF2E7D32" },
    };
  }
  sheet.getRow(2).height = 22;

  // Row 3: values.
  sheet.mergeCells("A3:C3");
  sheet.mergeCells("D3:F3");
  sheet.mergeCells("G3:K3");
  sheet.getCell("A3").value = "BGroup";
  sheet.getCell("D3").value = session.user.name ?? session.user.email ?? "—";
  sheet.getCell("G3").value = `${ymd(from)} → ${ymd(to)}`;
  for (const ref of ["A3", "D3", "G3"]) {
    const c = sheet.getCell(ref);
    c.font = { size: 12 };
    c.alignment = { horizontal: "center", vertical: "middle" };
    c.border = {
      top: { style: "thin", color: { argb: "FFCCCCCC" } },
      bottom: { style: "thin", color: { argb: "FFCCCCCC" } },
      left: { style: "thin", color: { argb: "FFCCCCCC" } },
      right: { style: "thin", color: { argb: "FFCCCCCC" } },
    };
  }
  sheet.getRow(3).height = 28;

  // Row 4: spacer.
  sheet.getRow(4).height = 8;

  // Row 5: "Leads Revenue" section bar.
  sheet.mergeCells("A5:K5");
  sheet.getCell("A5").value = "Leads Revenue";
  styleSectionBar(sheet.getRow(5), 28);

  // Row 6: headers.
  const headerRow = sheet.getRow(6);
  const headers = [
    "Customer Name",
    "Service Name",
    "Service Cost",
    "Total Income",
    "Lead Stage",
    "Contact Number",
    "Source",
    "Quality",
    "Deal Type",
    "Handing Over",
    "Closing Percentage",
  ];
  headers.forEach((h, i) => {
    headerRow.getCell(i + 1).value = h;
  });
  styleHeaderRow(headerRow);

  // Rows 7+: opportunities.
  const firstDataRow = 7;
  let currentRow = firstDataRow;

  if (opps.length === 0) {
    const r = sheet.getRow(currentRow);
    sheet.mergeCells(`A${currentRow}:K${currentRow}`);
    r.getCell("A").value = `No opportunities in this window (${ymd(from)} → ${ymd(to)})`;
    r.getCell("A").alignment = { horizontal: "center", vertical: "middle" };
    r.getCell("A").font = { italic: true, color: { argb: "FF888888" } };
    r.height = 30;
    currentRow += 1;
  } else {
    for (const o of opps) {
      const r = sheet.getRow(currentRow);
      const serviceName =
        o.products.map((p) => p.product?.nameEn).filter(Boolean).join(", ") ||
        o.title ||
        "—";
      const serviceCost = o.products.reduce(
        (s, p) => s + Number(p.unitPriceEGP) * Number(p.quantity),
        0,
      );
      r.getCell(1).value = safeLabel(o.customerCompanyName);
      r.getCell(2).value = safeLabel(serviceName);
      r.getCell(3).value = serviceCost > 0
        ? Math.round(serviceCost)
        : Math.round(Number(o.estimatedValueEGP));
      r.getCell(3).numFmt = "#,##0";
      r.getCell(4).value = Math.round(Number(o.estimatedValueEGP));
      r.getCell(4).numFmt = "#,##0";
      r.getCell(5).value = safeLabel(o.stage);
      r.getCell(6).value = safeLabel(o.customerContactPhone);
      r.getCell(7).value = safeLabel(o.leadSource);
      r.getCell(8).value = safeLabel(PRIORITY_TO_QUALITY[o.priority] ?? o.priority);
      r.getCell(9).value = safeLabel(o.dealType);
      r.getCell(10).value = safeLabel(o.owner?.fullName);
      r.getCell(11).value = o.probabilityPct / 100;
      r.getCell(11).numFmt = "0%";
      styleDataRow(r);
      currentRow += 1;
    }
  }
  const lastDataRow = Math.max(currentRow - 1, firstDataRow);
  currentRow += 1; // one-row gap

  // "Total Estimated Revenue" section bar.
  const totalBarRow = currentRow;
  sheet.mergeCells(`A${totalBarRow}:K${totalBarRow}`);
  sheet.getCell(`A${totalBarRow}`).value = "Total Estimated Revenue";
  styleSectionBar(sheet.getRow(totalBarRow), 26);
  currentRow += 1;

  // Pivot: unique service labels → SUMIF totals + % share row.
  // audit v12 MEDIUM (MED-32): wrap with safeLabel() so these pivot labels
  // match exactly what is stored in col B data cells (also wrapped with
  // safeLabel), allowing SUMIF formulas to find the correct rows.
  const serviceLabels = Array.from(
    new Set(
      opps.map((o) =>
        safeLabel(
          o.products.map((p) => p.product?.nameEn).filter(Boolean).join(", ") ||
          o.title ||
          null,
          "—",
        ),
      ),
    ),
  ).slice(0, 10);

  const serviceLabelRow = currentRow;
  const sLR = sheet.getRow(serviceLabelRow);
  serviceLabels.forEach((label, i) => {
    sLR.getCell(i + 1).value = label;
  });
  sLR.getCell(serviceLabels.length + 1).value = "Total";
  styleHeaderRow(sLR);
  currentRow += 1;

  const totalRow = currentRow;
  const tR = sheet.getRow(totalRow);
  serviceLabels.forEach((label, i) => {
    tR.getCell(i + 1).value = opps.length > 0
      ? {
          formula: `SUMIF($B$${firstDataRow}:$B$${lastDataRow},"${label.replace(/"/g, '""')}",$D$${firstDataRow}:$D$${lastDataRow})`,
        }
      : 0;
    tR.getCell(i + 1).numFmt = "#,##0";
  });
  if (serviceLabels.length > 0) {
    tR.getCell(serviceLabels.length + 1).value = {
      formula: `SUM(A${totalRow}:${String.fromCharCode(64 + serviceLabels.length)}${totalRow})`,
    };
    tR.getCell(serviceLabels.length + 1).numFmt = "#,##0";
  }
  tR.eachCell((c) => {
    c.font = { bold: true };
    c.alignment = { horizontal: "center", vertical: "middle" };
  });
  tR.height = 24;
  currentRow += 1;

  const pctRow = currentRow;
  const pR = sheet.getRow(pctRow);
  serviceLabels.forEach((_, i) => {
    const colLetter = String.fromCharCode(65 + i);
    const totalCol = String.fromCharCode(64 + serviceLabels.length + 1);
    pR.getCell(i + 1).value = {
      formula: `IF($${totalCol}$${totalRow}=0,0,${colLetter}${totalRow}/$${totalCol}$${totalRow})`,
    };
    pR.getCell(i + 1).numFmt = "0%";
  });
  if (serviceLabels.length > 0) {
    pR.getCell(serviceLabels.length + 1).value = {
      formula: `SUM(A${pctRow}:${String.fromCharCode(64 + serviceLabels.length)}${pctRow})`,
    };
    pR.getCell(serviceLabels.length + 1).numFmt = "0%";
  }
  pR.eachCell((c) => {
    c.alignment = { horizontal: "center", vertical: "middle" };
  });
  pR.height = 22;
  currentRow += 2; // one-row gap

  // Section bars: REVENUE BREAKDOWN | TOTAL INCOME PER ITEM.
  const breakdownBarRow = currentRow;
  sheet.mergeCells(`A${breakdownBarRow}:D${breakdownBarRow}`);
  sheet.mergeCells(`E${breakdownBarRow}:K${breakdownBarRow}`);
  sheet.getCell(`A${breakdownBarRow}`).value = "REVENUE BREAKDOWN";
  sheet.getCell(`E${breakdownBarRow}`).value = "TOTAL INCOME PER ITEM";
  styleSectionBar(sheet.getRow(breakdownBarRow), 24);
  currentRow += 1;

  // Three bucket tables side-by-side: source / quality / lead stage.
  // audit v12 MEDIUM (MED-32): use safeLabel() on leadSource and stage so
  // these bucket labels match the values stored in cols G and E respectively,
  // enabling COUNTIF formulas to return correct counts for affected labels.
  const sourceBuckets = Array.from(
    new Set(opps.map((o) => safeLabel(o.leadSource, "(unknown)"))),
  );
  const qualityBuckets = Array.from(
    new Set(opps.map((o) => PRIORITY_TO_QUALITY[o.priority] ?? o.priority)),
  );
  const stageBuckets = Array.from(new Set(opps.map((o) => safeLabel(o.stage))));

  const subHeaderRow = currentRow;
  const sub = sheet.getRow(subHeaderRow);
  sub.getCell(1).value = "Source";
  sub.getCell(2).value = "Count";
  sub.getCell(4).value = "Quality";
  sub.getCell(5).value = "Count";
  sub.getCell(7).value = "Lead Stage";
  sub.getCell(8).value = "Count";
  for (const col of [1, 2, 4, 5, 7, 8]) {
    const c = sub.getCell(col);
    c.font = { bold: true };
    c.alignment = { horizontal: "center", vertical: "middle" };
    c.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF1F3F4" },
    };
    c.border = {
      top: { style: "thin", color: { argb: "FFCCCCCC" } },
      bottom: { style: "thin", color: { argb: "FFCCCCCC" } },
    };
  }
  sub.height = 24;
  currentRow += 1;

  const maxBucketRows = Math.max(
    sourceBuckets.length,
    qualityBuckets.length,
    stageBuckets.length,
    1,
  );
  for (let i = 0; i < maxBucketRows; i++) {
    const r = sheet.getRow(currentRow + i);
    if (i < sourceBuckets.length) {
      const label = sourceBuckets[i];
      r.getCell(1).value = label;
      r.getCell(2).value =
        opps.length > 0
          ? { formula: `COUNTIF($G$${firstDataRow}:$G$${lastDataRow},"${label.replace(/"/g, '""')}")` }
          : 0;
      r.getCell(2).alignment = { horizontal: "center" };
    }
    if (i < qualityBuckets.length) {
      const label = qualityBuckets[i];
      r.getCell(4).value = label;
      r.getCell(5).value =
        opps.length > 0
          ? { formula: `COUNTIF($H$${firstDataRow}:$H$${lastDataRow},"${label.replace(/"/g, '""')}")` }
          : 0;
      r.getCell(5).alignment = { horizontal: "center" };
    }
    if (i < stageBuckets.length) {
      const label = stageBuckets[i];
      r.getCell(7).value = label;
      r.getCell(8).value =
        opps.length > 0
          ? { formula: `COUNTIF($E$${firstDataRow}:$E$${lastDataRow},"${label.replace(/"/g, '""')}")` }
          : 0;
      r.getCell(8).alignment = { horizontal: "center" };
    }
    r.height = 22;
  }
  currentRow += maxBucketRows + 1;

  // Period KPIs block — the manager's explicit ask alongside the
  // reference's reporting layout.
  const [dailyReports, currentlyOpen] = await Promise.all([
    db.crmDailyReport.findMany({
      where: { reportDate: { gte: from, lte: to } },
      select: {
        callsCount: true,
        meetingsBooked: true,
        meetingsHeld: true,
        newLeads: true,
      },
    }),
    db.crmOpportunity.count({
      where: { deletedAt: null, stage: { notIn: ["WON", "LOST"] } },
    }),
  ]);
  const activity = dailyReports.reduce(
    (acc, r) => ({
      calls: acc.calls + r.callsCount,
      meetingsBooked: acc.meetingsBooked + r.meetingsBooked,
      meetingsHeld: acc.meetingsHeld + r.meetingsHeld,
      newLeads: acc.newLeads + r.newLeads,
    }),
    { calls: 0, meetingsBooked: 0, meetingsHeld: 0, newLeads: 0 },
  );
  const opened = opps.filter((o) => o.createdAt >= from && o.createdAt <= to).length;
  const won = opps.filter(
    (o) => o.stage === "WON" && o.dateClosed && o.dateClosed >= from && o.dateClosed <= to,
  ).length;
  const lost = opps.filter(
    (o) => o.stage === "LOST" && o.dateClosed && o.dateClosed >= from && o.dateClosed <= to,
  ).length;

  sheet.mergeCells(`A${currentRow}:K${currentRow}`);
  sheet.getCell(`A${currentRow}`).value = "Period KPIs";
  styleSectionBar(sheet.getRow(currentRow), 24);
  currentRow += 1;

  const kpiPairs: [string, number | string][] = [
    ["Calls made", activity.calls],
    ["Meetings booked", activity.meetingsBooked],
    ["Meetings held", activity.meetingsHeld],
    ["New leads (from daily reports)", activity.newLeads],
    ["Opportunities opened", opened],
    ["Opportunities won", won],
    ["Opportunities lost", lost],
    ["Opportunities ongoing (live)", currentlyOpen],
  ];
  for (const [label, value] of kpiPairs) {
    const r = sheet.getRow(currentRow);
    sheet.mergeCells(`A${currentRow}:F${currentRow}`);
    r.getCell("A").value = label;
    r.getCell("A").font = { bold: true };
    r.getCell("A").alignment = { vertical: "middle" };
    sheet.mergeCells(`G${currentRow}:K${currentRow}`);
    r.getCell("G").value = value;
    r.getCell("G").alignment = { horizontal: "center", vertical: "middle" };
    r.getCell("G").font = { size: 12 };
    r.height = 22;
    currentRow += 1;
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `sales-report-${ymd(from)}_to_${ymd(to)}.xlsx`;
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
