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

/**
 * Field synonyms used to detect which column holds which data.
 *
 * `multi: true` fields aggregate across every matching column rather than
 * picking the first hit. We need this because business-report-style sheets
 * (e.g. "Lawyers in Cairo, CAIRO (Report by B-group Team).xlsx") have
 * separate columns for Linkedin, FacebookProfile, Instagram, Twitter that
 * should all roll up into our single `socialMedia` field, and separate
 * Address / City / State / ZIP / Country columns that should roll up into
 * `location`. Matching is case-insensitive after stripping whitespace and
 * non-alphanumeric punctuation, so "WebsiteURL", "website url", and
 * "WEBSITE_URL" all collapse to "websiteurl".
 */
type SynonymRule = { synonyms: string[]; multi?: boolean };
const FIELD_SYNONYMS: Record<string, SynonymRule> = {
  name: { synonyms: ["name", "fullname", "full name", "lead", "lead name", "businessname", "business name", "company", "companyname", "company name", "organization", "organisation", "account", "account name"] },
  companyName: { synonyms: ["company", "companyname", "company name", "organization", "organisation", "account", "account name", "businessname", "business name"] },
  phone: { synonyms: ["phone", "phone number", "phonenumber", "mobile", "whatsapp", "tel", "telephone", "number", "contact number", "contactnumber"] },
  email: { synonyms: ["email", "emailaddress", "email address", "e-mail", "mail"] },
  website: { synonyms: ["website", "websiteurl", "website url", "url", "site", "web", "domain", "homepage"] },
  contactPerson: { synonyms: ["contact person", "contactperson", "contact", "contact name", "contactname", "primary contact", "decision maker", "decisionmaker", "owner name", "owner"] },
  contactPosition: { synonyms: ["contact position", "contactposition", "position", "title", "role", "job title", "jobtitle", "designation"] },
  socialMedia: {
    multi: true,
    synonyms: [
      "social media", "socialmedia", "social", "social handle", "socialhandle",
      "linkedin", "linkedinprofile", "linkedin profile", "linkedinurl", "linkedin url",
      "facebook", "facebookprofile", "facebook profile", "facebookpage", "facebook page", "fb",
      "facebookmessenger", "facebook messenger", "messenger",
      "instagram", "instagramprofile", "instagram profile",
      "twitter", "x", "x profile", "xhandle", "twitterhandle", "twitter handle",
      "tiktok", "youtube",
    ],
  },
  industry: { synonyms: ["industry", "sector", "vertical"] },
  category: { synonyms: ["category", "segment", "tier", "type", "maincategory", "main category", "businesscategory", "business category"] },
  location: {
    multi: true,
    synonyms: [
      "location", "area", "neighborhood", "neighbourhood",
      "address", "streetaddress", "street address", "street",
      "city", "town",
      "state", "region", "province", "governorate",
      "zip", "zipcode", "zip code", "postal", "postalcode", "postal code", "postcode",
      "country", "nation",
    ],
  },
  source: { synonyms: ["source", "channel", "origin", "lead source", "leadsource"] },
  notes: { synonyms: ["notes", "comment", "comments", "remarks", "note", "description"] },
};

function normalizeHeader(raw: string): string {
  // Lower-case + strip every non-alphanumeric character so "Website URL",
  // "WebsiteURL", "website_url" and "website-url" all collapse to the same
  // key. Also normalize internal whitespace to single spaces for the
  // synonym table entries that still contain spaces.
  const lower = raw.toLowerCase().replace(/\s+/g, " ").trim();
  const compact = lower.replace(/[^a-z0-9 ]/g, "");
  return compact;
}

/**
 * Some business-report exporters (the "Report by B-group Team" template
 * being the prototypical one) put the document title on row 1 as a merged
 * banner cell and the actual header on row 2. Detect this by checking
 * whether row 1's cells are dominated by a single value — if so, the next
 * non-empty row is the real header.
 */
function pickHeaderRow(sheet: ExcelJS.Worksheet): { headerRow: ExcelJS.Row; firstDataRow: number } {
  const r1 = sheet.getRow(1);
  const r1Values: string[] = [];
  r1.eachCell((c) => {
    const v = cellString(c);
    if (v) r1Values.push(v);
  });
  const uniqueR1 = new Set(r1Values);
  const looksLikeBanner =
    r1Values.length === 0 ||
    (r1Values.length > 1 && uniqueR1.size === 1) || // merged banner repeated in every cell
    r1Values.length === 1; // single-cell title
  if (!looksLikeBanner) {
    return { headerRow: r1, firstDataRow: 2 };
  }
  // Walk forward until we hit a row whose values aren't all the banner.
  for (let i = 2; i <= Math.min(sheet.rowCount, 6); i++) {
    const row = sheet.getRow(i);
    const vals: string[] = [];
    row.eachCell((c) => {
      const v = cellString(c);
      if (v) vals.push(v);
    });
    if (vals.length >= 2 && new Set(vals).size > 1) {
      return { headerRow: row, firstDataRow: i + 1 };
    }
  }
  // Fallback — original behavior.
  return { headerRow: r1, firstDataRow: 2 };
}

function buildColumnIndex(headerRow: ExcelJS.Row): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  headerRow.eachCell((cell, colNumber) => {
    // Use the smart cell reader instead of `String(cell.value)` — Google
    // Sheets exports header cells as { richText: [{ text: "Name" }] } and
    // the naive coercion gave us "[object Object]" which never matched
    // any synonym, so the upload was rejected with "Header needs Name or
    // Company" even though the file clearly had those columns.
    const raw = normalizeHeader(cellString(cell));
    if (!raw) return;
    for (const [field, rule] of Object.entries(FIELD_SYNONYMS)) {
      const hit = rule.synonyms.some((s) => normalizeHeader(s) === raw);
      if (!hit) continue;
      if (!out[field]) out[field] = [];
      // Single-column fields: keep the first hit only. Multi-column fields
      // (socialMedia, location): collect every matching column so we can
      // concatenate later.
      if (rule.multi || out[field].length === 0) {
        out[field].push(colNumber);
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

  const { headerRow, firstDataRow } = pickHeaderRow(sheet);
  const columnIndex = buildColumnIndex(headerRow);
  if (!columnIndex.name && !columnIndex.companyName && !columnIndex.phone && !columnIndex.email) {
    return NextResponse.json(
      {
        error:
          "Header row needs at least one of: Name, Company, Phone, or Email. Other supported headers: website, social (linkedin/facebook/instagram/twitter), industry, category, location (address/city/state/zip/country), source, notes.",
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
  //
  // `get` returns the first matching column's value. `getJoined` concatenates
  // every matching column with a " | " separator — used for socialMedia and
  // location which can span 4-5 source columns.
  const get = (row: ExcelJS.Row, key: string) => {
    const cols = columnIndex[key];
    if (!cols || cols.length === 0) return "";
    return cellString(row.getCell(cols[0]));
  };
  const getJoined = (row: ExcelJS.Row, key: string) => {
    const cols = columnIndex[key];
    if (!cols || cols.length === 0) return "";
    const parts: string[] = [];
    for (const c of cols) {
      const v = cellString(row.getCell(c));
      if (v) parts.push(v);
    }
    return parts.join(" | ");
  };

  let rowIdx = 0;
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber < firstDataRow) return; // banner + header
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
      socialMedia: getJoined(row, "socialMedia") || null,
      industry: get(row, "industry") || null,
      category: get(row, "category") || null,
      location: getJoined(row, "location") || null,
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
