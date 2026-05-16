import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import ExcelJS from "exceljs";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * POST /api/crm/cold-leads/import
 *
 * Bulk-upload cold leads from an Excel/CSV file. Accepts a multipart body
 * with a single `file` field. Column matching is case-insensitive and
 * tolerates the common synonyms below — admins can paste an Excel from
 * anywhere without renaming columns.
 *
 *   name         ← name, full name, contact, lead
 *   company      ← company, organization, account
 *   phone        ← phone, mobile, whatsapp
 *   email        ← email, e-mail
 *   industry     ← industry, sector, vertical
 *   category     ← category, segment, tier
 *   location     ← location, city, region, country
 *   source       ← source, channel, origin
 *   notes        ← notes, comment, remarks
 *
 * The import is bounded at 50,000 rows per call so a single upload can't run
 * the server out of memory; users with bigger files should split first.
 * Duplicates against the existing directory are detected by (phone) when
 * present, falling back to (email) — duplicates are reported in the response
 * but NOT inserted.
 *
 * Only platform admins and CRM ADMIN/MANAGER may import. Reps can't dump
 * data into the org-wide directory.
 */
const MAX_ROWS = 50_000;

const FIELD_SYNONYMS: Record<string, string[]> = {
  name: ["name", "full name", "fullname", "lead", "lead name"],
  companyName: ["company", "company name", "organization", "organisation", "account", "account name"],
  phone: ["phone", "phone number", "mobile", "whatsapp", "tel", "telephone", "number"],
  email: ["email", "e-mail", "mail"],
  website: ["website", "url", "site", "web"],
  contactPerson: ["contact person", "contact", "contact name", "primary contact", "decision maker"],
  contactPosition: ["contact position", "position", "title", "role", "job title", "designation"],
  industry: ["industry", "sector", "vertical"],
  category: ["category", "segment", "tier", "type"],
  location: ["location", "city", "region", "country", "address", "area"],
  source: ["source", "channel", "origin", "lead source"],
  notes: ["notes", "comment", "comments", "remarks", "note"],
};

function buildColumnIndex(headerRow: ExcelJS.Row): Record<string, number> {
  const out: Record<string, number> = {};
  headerRow.eachCell((cell, colNumber) => {
    const raw = String(cell.value ?? "").trim().toLowerCase();
    if (!raw) return;
    for (const [field, syns] of Object.entries(FIELD_SYNONYMS)) {
      if (syns.includes(raw) && out[field] == null) {
        out[field] = colNumber;
      }
    }
  });
  return out;
}

function cellString(cell: ExcelJS.Cell | undefined): string {
  if (!cell) return "";
  const v = cell.value;
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    const o = v as { text?: string; result?: string | number; richText?: { text: string }[] };
    if (o.text) return o.text.trim();
    if (o.result != null) return String(o.result).trim();
    if (Array.isArray(o.richText)) return o.richText.map((r) => r.text).join("").trim();
  }
  return String(v).trim();
}

function isPlatformAdmin(session: Session | null) {
  if (!session?.user) return false;
  return (
    !!session.user.hrRoles?.includes("super_admin") ||
    (!!session.user.modules?.includes("partners") && !session.user.partnerId)
  );
}

export async function POST(request: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const role = session.user.crmRole;
  const allowed =
    isPlatformAdmin(session) || role === "ADMIN" || role === "MANAGER";
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const crmProfileId = session.user.crmProfileId;
  if (!crmProfileId) {
    return NextResponse.json({ error: "Missing CRM profile" }, { status: 403 });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file in the request" }, { status: 400 });
  }

  const arrayBuf = await file.arrayBuffer();
  const buf = Buffer.from(arrayBuf);
  const workbook = new ExcelJS.Workbook();
  try {
    if (file.name.toLowerCase().endsWith(".csv")) {
      // exceljs's csv loader takes a stream
      const { Readable } = await import("node:stream");
      await workbook.csv.read(Readable.from(buf));
    } else {
      await workbook.xlsx.load(arrayBuf as ArrayBuffer);
    }
  } catch {
    return NextResponse.json(
      { error: "Couldn't parse the file. Use .xlsx or .csv." },
      { status: 400 }
    );
  }

  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount === 0) {
    return NextResponse.json({ error: "The file is empty" }, { status: 400 });
  }

  const headerRow = sheet.getRow(1);
  const columnIndex = buildColumnIndex(headerRow);
  if (columnIndex.name == null && columnIndex.companyName == null) {
    return NextResponse.json(
      {
        error:
          "Header row needs at least a 'Name' or 'Company' column. Other supported headers: phone, email, industry, category, location, source, notes.",
      },
      { status: 400 }
    );
  }

  const totalRows = Math.min(sheet.rowCount - 1, MAX_ROWS);
  const records: Array<{
    name: string;
    companyName: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
    contactPerson: string | null;
    contactPosition: string | null;
    industry: string | null;
    category: string | null;
    location: string | null;
    source: string | null;
    notes: string | null;
  }> = [];

  for (let i = 2; i <= sheet.rowCount && records.length < MAX_ROWS; i++) {
    const row = sheet.getRow(i);
    const get = (key: string) =>
      columnIndex[key] != null ? cellString(row.getCell(columnIndex[key])) : "";
    const name = get("name");
    const companyName = get("companyName");
    if (!name && !companyName) continue; // empty row
    records.push({
      name: name || companyName,
      companyName: companyName || null,
      phone: get("phone") || null,
      email: get("email") || null,
      website: get("website") || null,
      contactPerson: get("contactPerson") || null,
      contactPosition: get("contactPosition") || null,
      industry: get("industry") || null,
      category: get("category") || null,
      location: get("location") || null,
      source: get("source") || null,
      notes: get("notes") || null,
    });
  }

  if (records.length === 0) {
    return NextResponse.json({ error: "No data rows found" }, { status: 400 });
  }

  // Duplicate detection — match against the existing directory by phone, then
  // email. Keeps Big Directory clean so the manager isn't redistributing the
  // same prospect twice from two different uploads.
  const phones = Array.from(new Set(records.map((r) => r.phone).filter(Boolean))) as string[];
  const emails = Array.from(new Set(records.map((r) => r.email).filter(Boolean))) as string[];
  const dupes = await db.crmColdLead.findMany({
    where: {
      OR: [
        phones.length ? { phone: { in: phones } } : { id: "__none__" },
        emails.length ? { email: { in: emails } } : { id: "__none__" },
      ],
    },
    select: { phone: true, email: true },
  });
  const dupPhones = new Set(
    dupes.map((d: { phone: string | null }) => d.phone).filter(Boolean) as string[]
  );
  const dupEmails = new Set(
    dupes.map((d: { email: string | null }) => d.email).filter(Boolean) as string[]
  );

  const fresh = records.filter(
    (r) => (!r.phone || !dupPhones.has(r.phone)) && (!r.email || !dupEmails.has(r.email))
  );

  const batch = await db.crmColdLeadImport.create({
    data: {
      importedById: crmProfileId,
      fileName: file.name.slice(0, 200),
      rowCount: fresh.length,
      duplicateCount: records.length - fresh.length,
    },
  });

  // createMany in batches of 1000 to keep individual INSERTs from blowing
  // past the wire/transaction limits on huge files.
  const CHUNK = 1000;
  for (let i = 0; i < fresh.length; i += CHUNK) {
    const slice = fresh.slice(i, i + CHUNK).map((r) => ({
      ...r,
      importBatchId: batch.id,
    }));
    await db.crmColdLead.createMany({ data: slice });
  }

  return NextResponse.json({
    ok: true,
    batchId: batch.id,
    totalRowsRead: records.length,
    truncatedToMax: sheet.rowCount - 1 > MAX_ROWS,
    inserted: fresh.length,
    duplicates: records.length - fresh.length,
  });
}
