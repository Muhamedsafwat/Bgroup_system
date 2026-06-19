import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isAdminOnly } from "@/lib/crm/admin-gates";

/**
 * Browser launcher with serverless detection.
 *
 * The bundled `puppeteer` package ships a ~170 MB Chromium binary,
 * which exceeds Vercel's 50 MB function-size cap AND is the wrong
 * binary for Lambda's runtime anyway. On serverless we lazily import
 * `puppeteer-core` + `@sparticuz/chromium-min` which provides the
 * right binary. Local dev keeps the convenient `puppeteer.launch()`
 * with a system-installed Chromium so devs don't have to set up the
 * @sparticuz path on Windows/macOS.
 *
 * Detection: `process.env.AWS_LAMBDA_FUNCTION_NAME` is set on every
 * Vercel serverless function. Override with `PDF_FORCE_CHROMIUM_MIN=1`
 * if a self-hosted deploy also needs the minimal binary.
 */
async function launchBrowser() {
  const isServerless =
    !!process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.PDF_FORCE_CHROMIUM_MIN === "1";
  if (isServerless) {
    const chromium = (await import("@sparticuz/chromium-min")).default;
    const puppeteerCore = (await import("puppeteer-core")).default;
    return puppeteerCore.launch({
      args: chromium.args,
      defaultViewport: { width: 1280, height: 800 },
      executablePath: await chromium.executablePath(
        process.env.CHROMIUM_REMOTE_URL ??
          "https://github.com/Sparticuz/chromium/releases/download/v131.0.1/chromium-v131.0.1-pack.tar",
      ),
      headless: true,
    });
  }
  const puppeteer = (await import("puppeteer")).default;
  return puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
}

/**
 * GET /api/crm/reports/sales-report/pdf?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * High-design sales report rendered as PDF. Same data backbone as the
 * .xlsx export at /api/crm/reports/sales-report/export, but delivered
 * as a polished landscape A4 PDF — full-bleed gradient header, KPI
 * tiles with colour bands, alternating-row opportunities table, and
 * three side-by-side summary panels.
 *
 * Implementation: build an inline HTML string with embedded CSS, hand
 * it to Puppeteer, screenshot to PDF. No external fonts / network
 * fetches inside the page so the render is deterministic + fast.
 *
 * Gate: MANAGER + ADMIN + super-admin.
 */

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const PRIORITY_TO_QUALITY: Record<string, string> = {
  HOT: "Excellent",
  WARM: "Good",
  COLD: "Medium",
};

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function fmt(n: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(n));
}
// XSS-safe escape — user-provided strings (customer names, notes,
// rep names) flow into the HTML template. Without this an opp called
// `<script>alert(1)` could escape the report.
function esc(v: unknown): string {
  if (v == null) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

  // Same widened window as the xlsx export so the two reports agree.
  const [opps, dailyReports, currentlyOpen] = await Promise.all([
    db.crmOpportunity.findMany({
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
        products: { include: { product: { select: { nameEn: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 5000,
    }),
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

  // ── Aggregates ───────────────────────────────────────────────
  const activity = dailyReports.reduce(
    (acc, r) => ({
      calls: acc.calls + r.callsCount,
      meetingsBooked: acc.meetingsBooked + r.meetingsBooked,
      meetingsHeld: acc.meetingsHeld + r.meetingsHeld,
      newLeads: acc.newLeads + r.newLeads,
    }),
    { calls: 0, meetingsBooked: 0, meetingsHeld: 0, newLeads: 0 },
  );
  const opened = opps.filter(
    (o) => o.createdAt >= from && o.createdAt <= to,
  ).length;
  const wonOpps = opps.filter(
    (o) =>
      o.stage === "WON" &&
      o.dateClosed &&
      o.dateClosed >= from &&
      o.dateClosed <= to,
  );
  const lostOpps = opps.filter(
    (o) =>
      o.stage === "LOST" &&
      o.dateClosed &&
      o.dateClosed >= from &&
      o.dateClosed <= to,
  );
  const wonValue = wonOpps.reduce(
    (s, o) => s + Number(o.estimatedValueEGP),
    0,
  );
  const totalEstimatedRevenue = opps.reduce(
    (s, o) => s + Number(o.estimatedValueEGP),
    0,
  );

  // Bucket aggregations for the three summary panels.
  type Bucket = { count: number; value: number };
  const bumpBucket = (m: Map<string, Bucket>, key: string, v: number) => {
    const cur = m.get(key) ?? { count: 0, value: 0 };
    cur.count += 1;
    cur.value += v;
    m.set(key, cur);
  };
  const bySource = new Map<string, Bucket>();
  const byQuality = new Map<string, Bucket>();
  const byStage = new Map<string, Bucket>();
  const byService = new Map<string, Bucket>();
  for (const o of opps) {
    const v = Number(o.estimatedValueEGP);
    bumpBucket(bySource, o.leadSource ?? "(unknown)", v);
    bumpBucket(byQuality, PRIORITY_TO_QUALITY[o.priority] ?? o.priority, v);
    bumpBucket(byStage, o.stage, v);
    const service =
      o.products.map((p) => p.product?.nameEn).filter(Boolean).join(", ") ||
      o.title ||
      "—";
    bumpBucket(byService, service, v);
  }

  // ── HTML template ────────────────────────────────────────────
  const managerName = session.user.name ?? session.user.email ?? "—";
  const dateLabel = `${ymd(from)} → ${ymd(to)}`;
  const generatedAt = new Date().toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  const html = renderHtml({
    title: "Sales Report",
    companyName: "BGroup",
    managerName,
    dateLabel,
    generatedAt,
    kpis: {
      calls: activity.calls,
      meetingsBooked: activity.meetingsBooked,
      meetingsHeld: activity.meetingsHeld,
      newLeads: activity.newLeads,
      opened,
      won: wonOpps.length,
      lost: lostOpps.length,
      ongoing: currentlyOpen,
      wonValue,
      totalEstimatedRevenue,
    },
    opps: opps.map((o) => ({
      customer: o.customerCompanyName ?? "—",
      service:
        o.products.map((p) => p.product?.nameEn).filter(Boolean).join(", ") ||
        o.title ||
        "—",
      serviceCost: o.products.reduce(
        (s, p) => s + Number(p.unitPriceEGP) * Number(p.quantity),
        0,
      ),
      totalIncome: Number(o.estimatedValueEGP),
      stage: o.stage,
      contact: o.customerContactPhone ?? "—",
      source: o.leadSource ?? "—",
      quality: PRIORITY_TO_QUALITY[o.priority] ?? o.priority,
      dealType: o.dealType,
      owner: o.owner?.fullName ?? "—",
      closingPct: o.probabilityPct,
    })),
    bySource: Array.from(bySource.entries())
      .map(([k, v]) => ({ label: k, ...v }))
      .sort((a, b) => b.value - a.value),
    byQuality: Array.from(byQuality.entries())
      .map(([k, v]) => ({ label: k, ...v }))
      .sort((a, b) => b.count - a.count),
    byStage: Array.from(byStage.entries())
      .map(([k, v]) => ({ label: k, ...v }))
      .sort((a, b) => b.count - a.count),
    byService: Array.from(byService.entries())
      .map(([k, v]) => ({ label: k, ...v }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 12),
  });

  // ── Puppeteer render ─────────────────────────────────────────
  // Launches a Chromium that fits the current runtime — bundled
  // puppeteer on dev, puppeteer-core + @sparticuz/chromium-min on
  // serverless (see `launchBrowser` for the env detection).
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    const pdfBuffer = await page.pdf({
      format: "A4",
      landscape: true,
      printBackground: true,
      margin: { top: "12mm", bottom: "12mm", left: "10mm", right: "10mm" },
      preferCSSPageSize: false,
    });
    const filename = `sales-report-${ymd(from)}_to_${ymd(to)}.pdf`;
    return new Response(pdfBuffer as unknown as ArrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } finally {
    await browser.close();
  }
}

// ─────────────────────────────────────────────────────────────────
// HTML template
// ─────────────────────────────────────────────────────────────────
type RenderArgs = {
  title: string;
  companyName: string;
  managerName: string;
  dateLabel: string;
  generatedAt: string;
  kpis: {
    calls: number;
    meetingsBooked: number;
    meetingsHeld: number;
    newLeads: number;
    opened: number;
    won: number;
    lost: number;
    ongoing: number;
    wonValue: number;
    totalEstimatedRevenue: number;
  };
  opps: {
    customer: string;
    service: string;
    serviceCost: number;
    totalIncome: number;
    stage: string;
    contact: string;
    source: string;
    quality: string;
    dealType: string;
    owner: string;
    closingPct: number;
  }[];
  bySource: { label: string; count: number; value: number }[];
  byQuality: { label: string; count: number; value: number }[];
  byStage: { label: string; count: number; value: number }[];
  byService: { label: string; count: number; value: number }[];
};

function renderHtml(a: RenderArgs): string {
  // Embedded CSS — no external fetches. Color system: deep green
  // (`#1b5e20`) for the brand band, brighter green (`#2e7d32`) for
  // section bars, and neutral grays for body. Status colors:
  // emerald for won, red for lost, blue for opened, amber for
  // ongoing. Avoid Tailwind: we don't have a build step inside
  // Puppeteer.
  const totalValue =
    a.kpis.totalEstimatedRevenue > 0 ? a.kpis.totalEstimatedRevenue : 1;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(a.title)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
                 "Helvetica Neue", Arial, sans-serif;
    color: #1a1a1a;
    font-size: 10px;
    line-height: 1.4;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page { padding: 0 4mm; }

  /* ── Top header band ─────────────────────────── */
  .hero {
    background: linear-gradient(135deg, #1b5e20 0%, #2e7d32 100%);
    color: #fff;
    padding: 18px 22px;
    border-radius: 6px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 14px;
  }
  .hero h1 {
    font-size: 26px;
    font-weight: 800;
    letter-spacing: 0.02em;
    margin: 0;
  }
  .hero .meta {
    text-align: right;
    font-size: 11px;
    opacity: 0.92;
    line-height: 1.5;
  }
  .hero .meta strong { font-size: 13px; font-weight: 700; }

  /* ── Info row (Company / Manager / Range) ───── */
  .info-row {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    margin-bottom: 14px;
  }
  .info-card {
    border: 1px solid #d4d4d4;
    border-radius: 6px;
    padding: 9px 14px;
    background: #fafafa;
  }
  .info-card .label {
    font-size: 9px;
    text-transform: uppercase;
    color: #6b7280;
    font-weight: 600;
    letter-spacing: 0.06em;
  }
  .info-card .value {
    font-size: 14px;
    font-weight: 700;
    color: #111;
    margin-top: 2px;
  }

  /* ── KPI tiles ───────────────────────────────── */
  .kpis {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 8px;
    margin-bottom: 14px;
  }
  .kpi {
    background: #fff;
    border: 1px solid #e6e6e6;
    border-radius: 6px;
    padding: 10px 12px;
    border-left: 4px solid #2e7d32;
  }
  .kpi.opened   { border-left-color: #2563eb; }
  .kpi.won      { border-left-color: #16a34a; }
  .kpi.lost     { border-left-color: #dc2626; }
  .kpi.ongoing  { border-left-color: #d97706; }
  .kpi .label {
    font-size: 9px;
    text-transform: uppercase;
    color: #6b7280;
    font-weight: 600;
    letter-spacing: 0.04em;
    line-height: 1.2;
  }
  .kpi .value {
    font-size: 22px;
    font-weight: 800;
    color: #111;
    margin-top: 4px;
    line-height: 1;
  }
  .kpi .sub {
    font-size: 9px;
    color: #6b7280;
    margin-top: 4px;
    font-weight: 500;
  }
  .kpi .sub.green { color: #16a34a; font-weight: 600; }

  /* ── Section title bar ───────────────────────── */
  .section-bar {
    background: #2e7d32;
    color: #fff;
    padding: 7px 14px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin: 14px 0 8px;
  }

  /* ── Opportunities table ─────────────────────── */
  table.opps {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    margin-top: 0;
    font-size: 9.5px;
  }
  table.opps thead th {
    background: #f3f4f6;
    color: #374151;
    font-weight: 700;
    text-align: left;
    padding: 7px 8px;
    border-bottom: 2px solid #2e7d32;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  table.opps thead th.num { text-align: right; }
  table.opps tbody td {
    padding: 6px 8px;
    border-bottom: 1px solid #efefef;
    vertical-align: middle;
  }
  table.opps tbody td.num { text-align: right; font-variant-numeric: tabular-nums; }
  table.opps tbody tr:nth-child(even) td { background: #fafafa; }
  table.opps tbody tr:hover td { background: #f0fdf4; }

  table.opps tbody td.value { font-weight: 700; color: #111; }
  table.opps tbody td.pct { font-weight: 600; }

  /* Status pills inside the table */
  .pill {
    display: inline-block;
    padding: 2px 7px;
    border-radius: 999px;
    font-size: 8.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }
  .pill.stage-won      { background: #dcfce7; color: #14532d; }
  .pill.stage-lost     { background: #fee2e2; color: #7f1d1d; }
  .pill.stage-default  { background: #e0e7ff; color: #1e3a8a; }
  .pill.q-excellent    { background: #dcfce7; color: #14532d; }
  .pill.q-good         { background: #fef3c7; color: #78350f; }
  .pill.q-medium       { background: #ffedd5; color: #7c2d12; }
  .pill.q-poor         { background: #fee2e2; color: #7f1d1d; }
  .pill.q-default      { background: #e5e7eb; color: #374151; }

  /* ── Summary panels ──────────────────────────── */
  .panels {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    margin-top: 8px;
  }
  .panel {
    background: #fff;
    border: 1px solid #e6e6e6;
    border-radius: 6px;
    overflow: hidden;
    page-break-inside: avoid;
  }
  .panel-head {
    background: #f3f4f6;
    padding: 7px 12px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #374151;
    border-bottom: 1px solid #e6e6e6;
  }
  .panel-body table { width: 100%; border-collapse: collapse; }
  .panel-body td {
    padding: 6px 12px;
    font-size: 10px;
    border-bottom: 1px solid #f1f1f1;
  }
  .panel-body td:nth-child(2) {
    text-align: right;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .panel-body td:nth-child(3) {
    text-align: right;
    color: #6b7280;
    font-size: 9px;
    font-variant-numeric: tabular-nums;
  }
  .panel-body tr:last-child td { border-bottom: none; }

  /* Revenue bar inline visual */
  .bar-wrap {
    background: #eef2f7;
    border-radius: 4px;
    height: 6px;
    margin-top: 3px;
    overflow: hidden;
  }
  .bar-fill {
    height: 100%;
    background: linear-gradient(90deg, #16a34a, #2e7d32);
    border-radius: 4px;
  }

  /* Two-column service grid */
  .service-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
    margin-top: 4px;
  }
  .service-card {
    border: 1px solid #e6e6e6;
    border-radius: 6px;
    padding: 9px 12px;
    background: #fff;
  }
  .service-card .label {
    font-size: 9px;
    text-transform: uppercase;
    color: #6b7280;
    font-weight: 600;
    letter-spacing: 0.04em;
  }
  .service-card .row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-top: 3px;
  }
  .service-card .amount {
    font-size: 14px;
    font-weight: 800;
    color: #111;
  }
  .service-card .pct {
    font-size: 11px;
    color: #2e7d32;
    font-weight: 700;
  }

  /* ── Empty / footer ──────────────────────────── */
  .empty {
    text-align: center;
    padding: 30px 0;
    color: #6b7280;
    font-style: italic;
  }
  .footer {
    margin-top: 16px;
    padding-top: 8px;
    border-top: 1px solid #e6e6e6;
    font-size: 8.5px;
    color: #9ca3af;
    display: flex;
    justify-content: space-between;
  }
  /* Avoid breaking sections across pages awkwardly. */
  .section-bar, .kpi, .panel, .service-card { break-inside: avoid; }
  thead { display: table-header-group; }
</style>
</head>
<body>
<div class="page">

  <!-- Hero -->
  <div class="hero">
    <h1>SALES REPORT</h1>
    <div class="meta">
      <strong>${esc(a.companyName)}</strong><br>
      ${esc(a.dateLabel)}
    </div>
  </div>

  <!-- Info row -->
  <div class="info-row">
    <div class="info-card">
      <div class="label">Company</div>
      <div class="value">${esc(a.companyName)}</div>
    </div>
    <div class="info-card">
      <div class="label">Sales Manager</div>
      <div class="value">${esc(a.managerName)}</div>
    </div>
    <div class="info-card">
      <div class="label">Period</div>
      <div class="value">${esc(a.dateLabel)}</div>
    </div>
  </div>

  <!-- KPI tiles -->
  <div class="kpis">
    <div class="kpi">
      <div class="label">Calls made</div>
      <div class="value">${fmt(a.kpis.calls)}</div>
    </div>
    <div class="kpi">
      <div class="label">Meetings booked</div>
      <div class="value">${fmt(a.kpis.meetingsBooked)}</div>
    </div>
    <div class="kpi">
      <div class="label">Meetings held</div>
      <div class="value">${fmt(a.kpis.meetingsHeld)}</div>
    </div>
    <div class="kpi">
      <div class="label">New leads</div>
      <div class="value">${fmt(a.kpis.newLeads)}</div>
    </div>
    <div class="kpi opened">
      <div class="label">Opportunities opened</div>
      <div class="value">${fmt(a.kpis.opened)}</div>
    </div>
    <div class="kpi won">
      <div class="label">Won</div>
      <div class="value">${fmt(a.kpis.won)}</div>
      <div class="sub green">EGP ${fmt(a.kpis.wonValue)}</div>
    </div>
    <div class="kpi lost">
      <div class="label">Lost</div>
      <div class="value">${fmt(a.kpis.lost)}</div>
    </div>
    <div class="kpi ongoing">
      <div class="label">Ongoing</div>
      <div class="value">${fmt(a.kpis.ongoing)}</div>
      <div class="sub">live pipeline</div>
    </div>
  </div>

  <!-- Opportunities table -->
  <div class="section-bar">Leads · Revenue</div>
  ${a.opps.length === 0 ? `
    <div class="empty">No opportunities in this window.</div>
  ` : `
    <table class="opps">
      <thead>
        <tr>
          <th>Customer</th>
          <th>Service</th>
          <th class="num">Service cost</th>
          <th class="num">Total income</th>
          <th>Stage</th>
          <th>Contact</th>
          <th>Source</th>
          <th>Quality</th>
          <th>Deal type</th>
          <th>Owner</th>
          <th class="num">Closing %</th>
        </tr>
      </thead>
      <tbody>
        ${a.opps.map((o) => {
          const stageClass =
            o.stage === "WON" ? "stage-won" :
            o.stage === "LOST" ? "stage-lost" : "stage-default";
          const qualityClass =
            o.quality === "Excellent" ? "q-excellent" :
            o.quality === "Good"      ? "q-good" :
            o.quality === "Medium"    ? "q-medium" :
            o.quality === "Poor"      ? "q-poor" : "q-default";
          return `
            <tr>
              <td><strong>${esc(o.customer)}</strong></td>
              <td>${esc(o.service)}</td>
              <td class="num">${fmt(o.serviceCost)}</td>
              <td class="num value">${fmt(o.totalIncome)}</td>
              <td><span class="pill ${stageClass}">${esc(o.stage)}</span></td>
              <td>${esc(o.contact)}</td>
              <td>${esc(o.source)}</td>
              <td><span class="pill ${qualityClass}">${esc(o.quality)}</span></td>
              <td>${esc(o.dealType)}</td>
              <td>${esc(o.owner)}</td>
              <td class="num pct">${o.closingPct}%</td>
            </tr>`;
        }).join("")}
      </tbody>
    </table>
  `}

  <!-- Revenue breakdown by service -->
  ${a.byService.length > 0 ? `
    <div class="section-bar">Total Estimated Revenue by Service</div>
    <div class="service-grid">
      ${a.byService.map((s) => {
        const pct = totalValue > 0 ? Math.round((s.value / totalValue) * 1000) / 10 : 0;
        return `
          <div class="service-card">
            <div class="label">${esc(s.label)}</div>
            <div class="row">
              <span class="amount">EGP ${fmt(s.value)}</span>
              <span class="pct">${pct}%</span>
            </div>
            <div class="bar-wrap">
              <div class="bar-fill" style="width:${Math.max(2, Math.min(100, pct))}%"></div>
            </div>
          </div>`;
      }).join("")}
    </div>
  ` : ``}

  <!-- Three summary panels -->
  <div class="section-bar">Revenue Breakdown · Total Income Per Item</div>
  <div class="panels">
    <div class="panel">
      <div class="panel-head">Source Summary</div>
      <div class="panel-body">
        <table>
          ${a.bySource.length === 0 ? `
            <tr><td colspan="3" class="empty">No data</td></tr>
          ` : a.bySource.map((s) => {
            const pct = totalValue > 0 ? Math.round((s.value / totalValue) * 100) : 0;
            return `<tr>
              <td>${esc(s.label)}</td>
              <td>${s.count}</td>
              <td>${pct}%</td>
            </tr>`;
          }).join("")}
        </table>
      </div>
    </div>
    <div class="panel">
      <div class="panel-head">Quality Summary</div>
      <div class="panel-body">
        <table>
          ${a.byQuality.length === 0 ? `
            <tr><td colspan="3" class="empty">No data</td></tr>
          ` : a.byQuality.map((s) => {
            const pct = totalValue > 0 ? Math.round((s.value / totalValue) * 100) : 0;
            return `<tr>
              <td>${esc(s.label)}</td>
              <td>${s.count}</td>
              <td>${pct}%</td>
            </tr>`;
          }).join("")}
        </table>
      </div>
    </div>
    <div class="panel">
      <div class="panel-head">Lead Stage Summary</div>
      <div class="panel-body">
        <table>
          ${a.byStage.length === 0 ? `
            <tr><td colspan="3" class="empty">No data</td></tr>
          ` : a.byStage.map((s) => {
            const pct = totalValue > 0 ? Math.round((s.value / totalValue) * 100) : 0;
            return `<tr>
              <td>${esc(s.label)}</td>
              <td>${s.count}</td>
              <td>${pct}%</td>
            </tr>`;
          }).join("")}
        </table>
      </div>
    </div>
  </div>

  <div class="footer">
    <span>Generated ${esc(a.generatedAt)} by ${esc(a.managerName)}</span>
    <span>BGroup Super App · Sales Report</span>
  </div>

</div>
</body>
</html>`;
}
