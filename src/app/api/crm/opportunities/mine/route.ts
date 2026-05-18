import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { scopeOpportunityByRole } from "@/lib/crm/rbac";
import type { SessionUser } from "@/types";

/**
 * GET /api/crm/opportunities/mine?q=...
 *
 * Lightweight picker endpoint for surfaces that need the rep's own (or
 * scope-visible) opportunities — currently the meeting-booking dialog,
 * which the user wanted switched away from picking contacts. Returns only
 * the minimal fields the picker renders: id + code + title + company name
 * + the contact details captured on the opp row.
 *
 * Open opps only — WON/LOST/POSTPONED are filtered out because the picker
 * is for "I want to book a meeting on a deal I'm actively working", not
 * for resurfacing closed deals.
 *
 * Scope mirrors `scopeOpportunityByRole` so a REP sees only their own opps,
 * a MANAGER sees their team's, and an ADMIN sees everything. Same rules as
 * the detail page, so the user can never pick an opp they'd 404 on.
 */
export async function GET(request: Request) {
  const session = await auth();
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
  const scope = scopeOpportunityByRole(sessionUser);

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";

  const opportunities = await db.crmOpportunity.findMany({
    where: {
      ...scope,
      deletedAt: null,
      stage: { notIn: ["WON", "LOST", "POSTPONED"] },
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { code: { contains: q, mode: "insensitive" } },
              { customerCompanyName: { contains: q, mode: "insensitive" } },
              { customerContactName: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: {
      id: true,
      code: true,
      title: true,
      stage: true,
      customerCompanyName: true,
      customerContactName: true,
      customerContactPhone: true,
      company: { select: { id: true, nameEn: true } },
    },
  });

  return NextResponse.json({ opportunities });
}
