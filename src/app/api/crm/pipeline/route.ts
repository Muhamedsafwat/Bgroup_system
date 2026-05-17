import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { type Prisma } from "@/generated/prisma";
import { describeZodError } from "@/lib/zod-errors";
import type { CrmOpportunityStage } from "@/types";

function isManager(session: Session) {
  return (
    session.user.crmRole === "MANAGER" ||
    session.user.crmRole === "ADMIN" ||
    !!session.user.hrRoles?.includes("super_admin")
  );
}

/**
 * GET /api/crm/pipeline
 * Returns the opportunity list scoped + filtered for the pipeline view.
 *
 * Query params:
 *   scope=mine|all   default depends on role (rep→mine, manager→all)
 *   repId=...        filter by owner (managers only)
 *   companyId=...    filter by company
 *   productId=...    filter by product attachment
 *   q=...            free-text on title or company name
 */
export async function GET(req: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const scope = url.searchParams.get("scope");
  const repId = url.searchParams.get("repId");
  const companyId = url.searchParams.get("companyId");
  const productId = url.searchParams.get("productId");
  const q = url.searchParams.get("q")?.trim() ?? "";

  // Pipeline visibility mirrors the detail-page scope so a manager never
  // sees an opp here that they'd 404 on if they clicked it. Previously the
  // pipeline showed everything for managers but the detail page restricted
  // to "own + direct reports", which produced confusing 404s.
  //
  //   REP        → own opps only
  //   ASSISTANT  → opps tied to a meeting they handled (matches detail scope)
  //   MANAGER    → own + direct reports (set via CrmUserProfile.managerId)
  //   ADMIN      → everything
  //
  // `scope=mine` and `repId=…` still narrow further within the role-scope.
  const callerId = session.user.crmProfileId ?? "__none__";
  const role = session.user.crmRole;
  const platformAdmin = isManager(session) && !!session.user.hrRoles?.includes("super_admin");
  const where: Prisma.CrmOpportunityWhereInput = {};

  if (role === "ADMIN" || platformAdmin) {
    // No base filter — admin sees everything (still narrowable by repId).
  } else if (role === "MANAGER") {
    if (scope === "mine") {
      where.ownerId = callerId;
    } else if (repId) {
      // Manager picking a specific rep — must still be in their team.
      where.AND = [
        { ownerId: repId },
        { OR: [{ ownerId: callerId }, { owner: { managerId: callerId } }] },
      ];
    } else {
      where.OR = [
        { ownerId: callerId },
        { owner: { managerId: callerId } },
      ];
    }
  } else {
    // REP / ASSISTANT / ACCOUNT_MGR / fallback — always own opps only.
    where.ownerId = callerId;
  }
  if (companyId) where.companyId = companyId;
  if (productId) where.products = { some: { productId } };
  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { company: { nameEn: { contains: q, mode: "insensitive" } } },
    ];
  }

  const opportunities = await db.crmOpportunity.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 500,
    select: {
      id: true,
      code: true,
      title: true,
      stage: true,
      priority: true,
      estimatedValueEGP: true,
      probabilityPct: true,
      weightedValueEGP: true,
      expectedCloseDate: true,
      nextActionText: true,
      nextActionDate: true,
      customerCompanyName: true,
      owner: { select: { id: true, fullName: true } },
      company: { select: { id: true, nameEn: true } },
    },
  });
  return NextResponse.json({ opportunities });
}

// ─── Drag-drop stage change ────────────────────────────────────────────────

const stageSchema = z.object({
  opportunityId: z.string().min(1),
  // Stage is admin-curated free text now, so accept any non-empty string.
  // The opportunity-stage action verifies the value exists in CrmStageConfig.
  newStage: z.string().min(1, "Stage code is required").max(40),
});

export async function PATCH(req: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json();
  const parsed = stageSchema.safeParse(body);
  if (!parsed.success) {
    { const __z = describeZodError(parsed.error); return NextResponse.json({ error: __z.message, fieldErrors: __z.fieldErrors }, { status: 400 }); }
  }

  const opp = await db.crmOpportunity.findUnique({
    where: { id: parsed.data.opportunityId },
    select: { id: true, ownerId: true, stage: true },
  });
  if (!opp) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Reps can only move their own opps; managers can move anything.
  if (
    !isManager(session) &&
    opp.ownerId !== (session.user.crmProfileId ?? "__none__")
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (opp.stage === parsed.data.newStage) {
    return NextResponse.json({ ok: true, unchanged: true });
  }

  const updated = await db.crmOpportunity.update({
    where: { id: opp.id },
    data: {
      stage: parsed.data.newStage,
      ...(parsed.data.newStage === "WON" ? { dateClosed: new Date() } : {}),
      ...(parsed.data.newStage === "LOST" ? { dateClosed: new Date() } : {}),
    },
    select: { id: true, stage: true },
  });

  // Audit the stage change.
  await db.crmStageHistory.create({
    data: {
      opportunityId: opp.id,
      fromStage: opp.stage,
      toStage: parsed.data.newStage,
      changedById: session.user.crmProfileId ?? session.user.id,
    },
  });

  return NextResponse.json({ ok: true, opportunity: updated });
}
