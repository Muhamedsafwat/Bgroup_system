import { NextRequest, NextResponse } from "next/server";
import type { Session } from "next-auth";
import ExcelJS from "exceljs";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { scopeColdLeadsByRole } from "@/lib/crm/cold-leads";
import type { SessionUser } from "@/types";
import type { Prisma, CrmColdLeadStatus } from "@/generated/prisma";

/**
 * GET /api/crm/cold-leads/export
 *
 * Streams the current cold-lead directory as a downloadable .xlsx so the
 * admin can pull the entire pool (or a filtered slice of it) into Excel /
 * Google Sheets without going through the API. Same filters as the list
 * endpoint — status, industry, category, location, free text, assignedToId.
 *
 * Scoped via the standard role-based filter, so a rep only exports their
 * own queue, a manager exports their team + unassigned pool, and admin
 * exports everything.
 *
 * Format mirrors the import template so a round-trip — export, edit in
 * Sheets, re-import — works without any column renaming.
 */
const VALID_STATUSES = new Set<CrmColdLeadStatus>([
  "NEW",
  "ASSIGNED",
  "NO_ANSWER",
  "WAITING_LIST",
  "NOT_INTERESTED",
  "CONVERTED",
  "ARCHIVED",
]);

const EXPORT_LIMIT = 50_000;

export async function GET(req: NextRequest) {
  const session = (await auth()) as Session | null;
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
  // audit v12 MEDIUM (MED-7): cap free-text params to prevent DoS via
  // arbitrarily large LIKE queries driving full-scan over up to 50 000 rows
  // and an oversized in-memory Excel workbook.
  const MAX_FREE_TEXT = 200;
  const rawQ = url.searchParams.get("q")?.trim();
  if (rawQ !== undefined && rawQ !== null && rawQ.length > MAX_FREE_TEXT) {
    return NextResponse.json(
      { error: "Query parameter too long (max 200 characters)" },
      { status: 400 },
    );
  }
  const industry = url.searchParams.get("industry")?.trim().slice(0, MAX_FREE_TEXT);
  const category = url.searchParams.get("category")?.trim().slice(0, MAX_FREE_TEXT);
  const location = url.searchParams.get("location")?.trim().slice(0, MAX_FREE_TEXT);
  const q = rawQ;
  const assignedToId = url.searchParams.get("assignedToId");

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
  if (
    assignedToId &&
    (sessionUser.role === "ADMIN" || sessionUser.role === "MANAGER")
  ) {
    where.assignedToId = assignedToId === "unassigned" ? null : assignedToId;
  }

  const rows = await db.crmColdLead.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      assignedTo: { select: { fullName: true } },
    },
    take: EXPORT_LIMIT,
  });

  // Build the workbook with the same column order as the import template so
  // a round-trip (export → edit → re-import) doesn't need column renames.
  const wb = new ExcelJS.Workbook();
  wb.creator = "BGroup Super App";
  wb.created = new Date();
  const ws = wb.addWorksheet("Cold leads");

  ws.columns = [
    { header: "Name", key: "name", width: 24 },
    { header: "Phone", key: "phone", width: 18 },
    { header: "Company", key: "companyName", width: 24 },
    { header: "Email", key: "email", width: 26 },
    { header: "Website", key: "website", width: 26 },
    { header: "Contact Person", key: "contactPerson", width: 20 },
    { header: "Contact Position", key: "contactPosition", width: 18 },
    { header: "Social Media", key: "socialMedia", width: 26 },
    { header: "Industry", key: "industry", width: 16 },
    { header: "Category", key: "category", width: 14 },
    { header: "Location", key: "location", width: 16 },
    { header: "Source", key: "source", width: 14 },
    { header: "Notes", key: "notes", width: 36 },
    // Status columns at the end — they're info-only on re-import (the
    // importer doesn't read them; new rows start as NEW), but admins want
    // to see the current disposition next to the lead while editing.
    { header: "Status", key: "status", width: 14 },
    { header: "Assigned To", key: "assignedTo", width: 20 },
    { header: "Created", key: "createdAt", width: 18 },
  ];

  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFEEEEEE" },
    };
    cell.border = { bottom: { style: "thin", color: { argb: "FFAAAAAA" } } };
  });

  for (const r of rows) {
    ws.addRow({
      name: r.name,
      phone: r.phone ?? "",
      companyName: r.companyName ?? "",
      email: r.email ?? "",
      website: r.website ?? "",
      contactPerson: r.contactPerson ?? "",
      contactPosition: r.contactPosition ?? "",
      socialMedia: r.socialMedia ?? "",
      industry: r.industry ?? "",
      category: r.category ?? "",
      location: r.location ?? "",
      source: r.source ?? "",
      notes: r.notes ?? "",
      status: r.status,
      assignedTo: r.assignedTo?.fullName ?? "",
      createdAt: r.createdAt.toISOString().slice(0, 10),
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(buf as ArrayBuffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="cold-leads-${stamp}.xlsx"`,
    },
  });
}
