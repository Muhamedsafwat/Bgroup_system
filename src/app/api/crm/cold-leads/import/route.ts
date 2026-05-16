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
  socialMedia: ["social media", "social", "linkedin", "facebook", "instagram", "twitter", "x", "social handle"],
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
  // Append vs. dedupe. By default every uploaded row is inserted as a fresh
  // lead — the cold-lead pool is a *directory* the admin re-uploads into
  // hundreds of times, and silently dropping rows that look like dupes was
  // making it feel like new uploads "overwrote" earlier ones. Pass
  // `skipDuplicates=true` to bring the old behavior back when re-uploading
  // a near-identical batch.
  const skipDuplicates = form.get("skipDuplicates") === "true";

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

  type Record = {
    name: string;
    companyName: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
    contactPerson: string | null;
    contactPosition: string | null;
    socialMedia: string | null;
    industry: string | null;
    category: string | null;
    location: string | null;
    source: string | null;
    notes: string | null;
  };
  const records: Record[] = [];

  // Use `actualRowCount` (the number of rows that contain data) instead of
  // `rowCount` — `rowCount` is the max row index ExcelJS saw, which can
  // include trailing empty rows AND can stop short on certain xlsx variants.
  // `eachRow({ includeEmpty: false })` walks every row that actually has
  // content, even ones past `rowCount`, and skips blank-middle rows so we
  // don't silently drop data the user can see in their spreadsheet.
  const get = (row: ExcelJS.Row, key: string) =>
    columnIndex[key] != null ? cellString(row.getCell(columnIndex[key])) : "";

  let rowIdx = 0;
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // header
    if (records.length >= MAX_ROWS) return;
    rowIdx++;
    const name = get(row, "name");
    const companyName = get(row, "companyName");
    // Accept the row even if `name` is blank but `phone` or `email` is
    // present — a phone-only row is still actionable for a rep. Only
    // truly empty rows (no name, no company, no phone, no email) are
    // skipped. This was the silent-drop bug: rows with only a phone +
    // notes were being thrown away because `name` was empty.
    const phone = get(row, "phone");
    const email = get(row, "email");
    if (!name && !companyName && !phone && !email) return;
    records.push({
      name: name || companyName || phone || email || "(no name)",
      companyName: companyName || null,
      phone: phone || null,
      email: email || null,
      website: get(row, "website") || null,
      contactPerson: get(row, "contactPerson") || null,
      contactPosition: get(row, "contactPosition") || null,
      socialMedia: get(row, "socialMedia") || null,
      industry: get(row, "industry") || null,
      category: get(row, "category") || null,
      location: get(row, "location") || null,
      source: get(row, "source") || null,
      notes: get(row, "notes") || null,
    });
  });

  if (records.length === 0) {
    return NextResponse.json(
      { error: "No data rows found. Check that your file has a header row plus at least one row of data." },
      { status: 400 }
    );
  }

  // Two duplicate counters reported back to the UI:
  //   - duplicatesAgainstExisting: rows whose phone/email already exists in
  //     the directory (only filtered out when skipDuplicates is true).
  //   - duplicatesInFile: rows that match another row in the SAME file.
  // The default behavior is APPEND EVERYTHING — both classes are inserted —
  // because the user wants this pool to grow without surprises.
  let toInsert: Record[] = records;
  let duplicatesAgainstExisting = 0;
  let duplicatesInFile = 0;

  if (skipDuplicates) {
    const phones = Array.from(
      new Set(records.map((r) => r.phone).filter(Boolean))
    ) as string[];
    const emails = Array.from(
      new Set(records.map((r) => r.email).filter(Boolean))
    ) as string[];
    const dupes = phones.length || emails.length
      ? await db.crmColdLead.findMany({
          where: {
            OR: [
              phones.length ? { phone: { in: phones } } : { id: "__none__" },
              emails.length ? { email: { in: emails } } : { id: "__none__" },
            ],
          },
          select: { phone: true, email: true },
        })
      : [];
    const dupPhones = new Set(
      dupes
        .map((d: { phone: string | null }) => d.phone)
        .filter(Boolean) as string[]
    );
    const dupEmails = new Set(
      dupes
        .map((d: { email: string | null }) => d.email)
        .filter(Boolean) as string[]
    );

    const seenPhones = new Set<string>();
    const seenEmails = new Set<string>();
    toInsert = [];
    for (const r of records) {
      const phoneHit = r.phone && dupPhones.has(r.phone);
      const emailHit = r.email && dupEmails.has(r.email);
      if (phoneHit || emailHit) {
        duplicatesAgainstExisting++;
        continue;
      }
      if (r.phone && seenPhones.has(r.phone)) {
        duplicatesInFile++;
        continue;
      }
      if (r.email && seenEmails.has(r.email)) {
        duplicatesInFile++;
        continue;
      }
      if (r.phone) seenPhones.add(r.phone);
      if (r.email) seenEmails.add(r.email);
      toInsert.push(r);
    }
  }

  const batch = await db.crmColdLeadImport.create({
    data: {
      importedById: crmProfileId,
      fileName: file.name.slice(0, 200),
      rowCount: toInsert.length,
      duplicateCount: duplicatesAgainstExisting + duplicatesInFile,
    },
  });

  // createMany in batches of 1000 to keep individual INSERTs from blowing
  // past the wire/transaction limits on huge files.
  const CHUNK = 1000;
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const slice = toInsert.slice(i, i + CHUNK).map((r) => ({
      ...r,
      importBatchId: batch.id,
    }));
    await db.crmColdLead.createMany({ data: slice });
  }

  return NextResponse.json({
    ok: true,
    batchId: batch.id,
    totalRowsRead: rowIdx,
    truncatedToMax: rowIdx > MAX_ROWS,
    inserted: toInsert.length,
    duplicates: duplicatesAgainstExisting + duplicatesInFile,
    duplicatesAgainstExisting,
    duplicatesInFile,
    appendMode: !skipDuplicates,
  });
}
