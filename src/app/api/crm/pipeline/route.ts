import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { CrmOpportunityStage, type Prisma } from "@/generated/prisma";

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

  const where: Prisma.CrmOpportunityWhereInput = {};
  // Visibility: rep sees own by default; managers see all unless scope=mine.
  if (!isManager(session)) {
    where.ownerId = session.user.crmProfileId ?? "__none__";
  } else if (scope === "mine") {
    where.ownerId = session.user.crmProfileId ?? "__none__";
  } else if (repId) {
    where.ownerId = repId;
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
      owner: { select: { id: true, fullName: true } },
      company: { select: { id: true, nameEn: true } },
    },
  });
  return NextResponse.json({ opportunities });
}

// ─── Drag-drop stage change ────────────────────────────────────────────────

const stageSchema = z.object({
  opportunityId: z.string().min(1),
  newStage: z.nativeEnum(CrmOpportunityStage),
});

export async function PATCH(req: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json();
  const parsed = stageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
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
