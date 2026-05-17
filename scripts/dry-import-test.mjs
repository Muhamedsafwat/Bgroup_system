import ExcelJS from "exceljs";

const FIELD_SYNONYMS = {
  name: { synonyms: ["name", "fullname", "full name", "lead", "lead name", "businessname", "business name", "company", "companyname", "company name", "organization", "organisation", "account", "account name"] },
  companyName: { synonyms: ["company", "companyname", "company name", "organization", "organisation", "account", "account name", "businessname", "business name"] },
  phone: { synonyms: ["phone", "phone number", "phonenumber", "mobile", "whatsapp", "tel", "telephone", "number", "contact number", "contactnumber"] },
  email: { synonyms: ["email", "emailaddress", "email address", "e-mail", "mail"] },
  website: { synonyms: ["website", "websiteurl", "website url", "url", "site", "web", "domain", "homepage"] },
  contactPerson: { synonyms: ["contact person", "contactperson", "contact", "contact name", "contactname", "primary contact", "decision maker", "decisionmaker", "owner name", "owner"] },
  contactPosition: { synonyms: ["contact position", "contactposition", "position", "title", "role", "job title", "jobtitle", "designation"] },
  socialMedia: { multi: true, synonyms: ["social media", "socialmedia", "social", "social handle", "socialhandle", "linkedin", "linkedinprofile", "linkedin profile", "linkedinurl", "linkedin url", "facebook", "facebookprofile", "facebook profile", "facebookpage", "facebook page", "fb", "facebookmessenger", "facebook messenger", "messenger", "instagram", "instagramprofile", "instagram profile", "instagramaccountname", "instagram account", "twitter", "x", "x profile", "xhandle", "twitterhandle", "twitter handle", "tiktok", "youtube"] },
  industry: { synonyms: ["industry", "sector", "vertical"] },
  category: { synonyms: ["category", "segment", "tier", "type", "maincategory", "main category", "businesscategory", "business category"] },
  location: { multi: true, synonyms: ["location", "area", "neighborhood", "neighbourhood", "address", "streetaddress", "street address", "street", "city", "town", "state", "region", "province", "governorate", "zip", "zipcode", "zip code", "postal", "postalcode", "postal code", "postcode", "country", "nation"] },
  source: { synonyms: ["source", "channel", "origin", "lead source", "leadsource"] },
  notes: { synonyms: ["notes", "comment", "comments", "remarks", "note", "description"] },
};

function normalizeHeader(raw) {
  const lower = raw.toLowerCase().replace(/\s+/g, " ").trim();
  return lower.replace(/[^a-z0-9 ]/g, "");
}

function cellString(cell) {
  if (!cell) return "";
  const v = cell.value;
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    if (v.text) return String(v.text).trim();
    if (v.result != null) return String(v.result).trim();
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join("").trim();
  }
  return String(v).trim();
}

function pickHeaderRow(sheet) {
  const r1 = sheet.getRow(1);
  const r1Values = [];
  r1.eachCell((c) => { const v = cellString(c); if (v) r1Values.push(v); });
  const uniqueR1 = new Set(r1Values);
  const looksLikeBanner = r1Values.length === 0 || (r1Values.length > 1 && uniqueR1.size === 1) || r1Values.length === 1;
  if (!looksLikeBanner) return { headerRow: r1, firstDataRow: 2 };
  for (let i = 2; i <= Math.min(sheet.rowCount, 6); i++) {
    const row = sheet.getRow(i);
    const vals = [];
    row.eachCell((c) => { const v = cellString(c); if (v) vals.push(v); });
    if (vals.length >= 2 && new Set(vals).size > 1) {
      return { headerRow: row, firstDataRow: i + 1 };
    }
  }
  return { headerRow: r1, firstDataRow: 2 };
}

function buildColumnIndex(headerRow) {
  const out = {};
  headerRow.eachCell((cell, colNumber) => {
    const raw = normalizeHeader(cellString(cell));
    if (!raw) return;
    for (const [field, rule] of Object.entries(FIELD_SYNONYMS)) {
      const hit = rule.synonyms.some((s) => normalizeHeader(s) === raw);
      if (!hit) continue;
      if (!out[field]) out[field] = [];
      if (rule.multi || out[field].length === 0) out[field].push(colNumber);
    }
  });
  return out;
}

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile("C:/Users/Ibrahim Elmur/Desktop/Lawyers in Cairo, CAIRO (Report by B-group Team).xlsx");
const sheet = wb.worksheets[0];
const { headerRow, firstDataRow } = pickHeaderRow(sheet);
console.log("Header row number:", headerRow.number, " First data row:", firstDataRow);

const columnIndex = buildColumnIndex(headerRow);
console.log("Column index:", JSON.stringify(columnIndex, null, 2));

const get = (row, key) => {
  const cols = columnIndex[key];
  if (!cols || !cols.length) return "";
  return cellString(row.getCell(cols[0]));
};
const getJoined = (row, key) => {
  const cols = columnIndex[key];
  if (!cols || !cols.length) return "";
  const parts = [];
  for (const c of cols) { const v = cellString(row.getCell(c)); if (v) parts.push(v); }
  return parts.join(" | ");
};

let n = 0;
sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
  if (rowNumber < firstDataRow) return;
  if (n >= 3) return;
  n++;
  const rec = {
    name: get(row, "name") || get(row, "companyName"),
    phone: get(row, "phone"),
    email: get(row, "email"),
    website: get(row, "website"),
    socialMedia: getJoined(row, "socialMedia"),
    category: get(row, "category"),
    location: getJoined(row, "location"),
  };
  console.log("Sample row " + n + ":", JSON.stringify(rec, null, 2));
});
