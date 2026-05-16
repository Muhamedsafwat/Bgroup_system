import { NextRequest, NextResponse } from "next/server";
import type { Session } from "next-auth";
import ExcelJS from "exceljs";
import { auth } from "@/lib/auth";

/**
 * GET /api/crm/cold-leads/template?columns=website,contactPerson,...&format=xlsx
 *
 * Returns a downloadable spreadsheet template the admin can fill in (locally,
 * in Excel, or in Google Sheets) and re-upload through the import flow. The
 * `name` and `phone` columns are always included since they're what the rep
 * needs to actually make a call; everything else is opt-in via the `columns`
 * query string so the admin doesn't have to delete 8 empty columns each time.
 *
 * `format=csv` returns a plain comma-separated file with the same headers,
 * for users who prefer CSV or whose Google Sheets workflow is cleaner with
 * CSV imports. Both formats round-trip through Google Sheets without any
 * API integration — open, edit, "Download as Excel/CSV", re-upload.
 */
const COLUMN_LABELS: Record<string, string> = {
  name: "Name",
  phone: "Phone",
  companyName: "Company",
  email: "Email",
  website: "Website",
  contactPerson: "Contact Person",
  contactPosition: "Contact Position",
  industry: "Industry",
  category: "Category",
  location: "Location",
  source: "Source",
  notes: "Notes",
};

const REQUIRED = ["name", "phone"] as const;
const OPTIONAL_ALL = new Set([
  "companyName",
  "email",
  "website",
  "contactPerson",
  "contactPosition",
  "industry",
  "category",
  "location",
  "source",
  "notes",
]);

const SAMPLE_ROW: Record<string, string> = {
  name: "Sample Contact",
  phone: "+201001234567",
  companyName: "Acme Corp",
  email: "contact@acme.example",
  website: "https://acme.example",
  contactPerson: "Sara Hassan",
  contactPosition: "Procurement Manager",
  industry: "Manufacturing",
  category: "Tier 1",
  location: "Cairo",
  source: "LinkedIn",
  notes: "Met at industry expo",
};

export async function GET(req: NextRequest) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const role = session.user.crmRole;
  const platformAdmin =
    !!session.user.hrRoles?.includes("super_admin") ||
    (!!session.user.modules?.includes("partners") && !session.user.partnerId);
  if (!platformAdmin && role !== "ADMIN" && role !== "MANAGER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = req.nextUrl;
  const format = (url.searchParams.get("format") ?? "xlsx").toLowerCase();
  const raw = url.searchParams.get("columns") ?? "";
  const requested = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => OPTIONAL_ALL.has(s));

  // Always lead with `name` + `phone`, then whichever optional columns the
  // admin checked in the dialog. Preserve their request order so the column
  // layout matches what they saw on screen.
  const columns: string[] = [...REQUIRED, ...requested];
  const headers = columns.map((c) => COLUMN_LABELS[c]);
  const sampleRow = columns.map((c) => SAMPLE_ROW[c] ?? "");

  if (format === "csv") {
    // Excel-compatible CSV: header row + one example row so users see what
    // good data looks like. UTF-8 BOM so Excel/Google Sheets pick up Arabic
    // characters in mixed-language imports.
    const escape = (s: string) =>
      /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    const body =
      "﻿" +
      [headers.map(escape).join(","), sampleRow.map(escape).join(",")].join("\r\n");
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="cold-leads-template.csv"`,
      },
    });
  }

  // .xlsx — works in Excel, Numbers, Google Sheets (just upload it as a
  // spreadsheet — Sheets converts automatically). No API needed.
  const wb = new ExcelJS.Workbook();
  wb.creator = "BGroup Super App";
  wb.created = new Date();
  const ws = wb.addWorksheet("Cold leads");

  // Header row — bold + bottom border so it's obvious "fill below this".
  const headerRow = ws.addRow(headers);
  headerRow.font = { bold: true };
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFEEEEEE" },
    };
    cell.border = { bottom: { style: "thin", color: { argb: "FFAAAAAA" } } };
  });

  // Sample row in a lighter style so the user knows to overwrite it.
  const sample = ws.addRow(sampleRow);
  sample.eachCell((cell) => {
    cell.font = { italic: true, color: { argb: "FF888888" } };
  });

  // Reasonable widths based on label length and expected content.
  ws.columns = columns.map((c, i) => ({
    header: headers[i],
    key: c,
    width: Math.max(14, headers[i].length + 2, (SAMPLE_ROW[c] ?? "").length + 2),
  }));

  // Mark required headers with a red asterisk in a separate note row at the
  // top, so the formatting alone tells the user what's mandatory.
  ws.getRow(1).getCell(1).note = "Required";
  ws.getRow(1).getCell(2).note = "Required";

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as ArrayBuffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="cold-leads-template.xlsx"`,
    },
  });
}
