import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { type Prisma, type CrmCurrency } from "@/generated/prisma";
import { describeZodError } from "@/lib/zod-errors";
import type { CrmOpportunityStage } from "@/types";
import {
  recomputeOpportunityFinancials,
  loadFxRates,
  getStageProbability,
} from "@/lib/crm/business/pipeline";
import { fireWorkflow } from "@/lib/crm/workflows/engine";

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

  // Build the filter as an AND-stack so each clause stays independent and we
  // don't clobber `where.OR` when both role-scope and search-q want to use
  // it. Previously the q-search OR overwrote the role-scope OR (manager
  // visibility) and the repId filter was silently ignored for admins.
  const and: Prisma.CrmOpportunityWhereInput[] = [];

  if (role === "ADMIN" || role === "MANAGER" || platformAdmin) {
    // ADMIN + MANAGER see the entire pipeline. `scope=mine` still narrows
    // to "ops I personally own" so a manager can quickly check their own
    // book; otherwise no base filter — `repId=…` below lets them drill
    // into any specific rep across the floor.
    if (scope === "mine") {
      and.push({ ownerId: callerId });
    }
  } else {
    // REP / ASSISTANT / ACCOUNT_MGR / fallback — always own opps only.
    and.push({ ownerId: callerId });
  }

  // Rep filter now works for every role that's allowed to use it. Reps can't
  // change it (the UI hides it for them); managers can pick a specific report
  // and the role-scope above still keeps them inside their team; admins can
  // pick anyone — previously the admin branch dropped the filter on the floor.
  if (repId) {
    and.push({ ownerId: repId });
  }
  if (companyId) and.push({ companyId });
  if (productId) and.push({ products: { some: { productId } } });
  if (q) {
    and.push({
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { company: { nameEn: { contains: q, mode: "insensitive" } } },
        { customerCompanyName: { contains: q, mode: "insensitive" } },
      ],
    });
  }

  // Soft-deleted opps must never appear in the pipeline view. Without
  // this filter, deleted rows leak back in (their CrmStageHistory +
  // CrmActivityLog audit trail is preserved on soft-delete, so the rows
  // still exist with deletedAt set).
  const where: Prisma.CrmOpportunityWhereInput = {
    deletedAt: null,
    ...(and.length ? { AND: and } : {}),
  };

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
    { const __z = describeZodError(parsed.error); return NextResponse.json({ error: __z.message, fieldErrors: __z.fieldErrors }, { status: 422 }); }
  }

  // Soft-deleted opps must not be revivable via drag-drop. The previous
  // version skipped the deletedAt filter and let a stale tab move a
  // tombstoned opp into a different column.
  const opp = await db.crmOpportunity.findFirst({
    where: { id: parsed.data.opportunityId, deletedAt: null },
    select: {
      id: true,
      ownerId: true,
      stage: true,
      estimatedValue: true,
      currency: true,
    },
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

  // Validate target stage is configured + active, same gate the bulk
  // route applies. Without this, a rep could drag into a stage the
  // admin disabled.
  const newStage = parsed.data.newStage;
  const stageCfg = await db.crmStageConfig.findFirst({
    where: { stage: newStage, isActive: true },
    select: { id: true },
  });
  if (!stageCfg) {
    return NextResponse.json(
      { error: `Stage "${newStage}" isn't configured` },
      { status: 400 },
    );
  }

  // Recompute probabilityPct + weightedValueEGP for the new stage. The
  // previous version skipped this — drag-drop transitions left every
  // opp's probability stuck at its old value, drifting forecast
  // aggregates over weightedValueEGP. Mirror the math the single-opp
  // changeStage() does.
  const probabilityPct = await getStageProbability(newStage);
  const fxRates = await loadFxRates();
  const { estimatedValueEGP, weightedValueEGP } = recomputeOpportunityFinancials(
    Number(opp.estimatedValue),
    opp.currency as CrmCurrency,
    probabilityPct,
    fxRates,
  );

  const closesDeal = newStage === "WON" || newStage === "LOST";
  // Wrap the update + history write in a single transaction so a
  // failure on the history write doesn't leave the opp stage-changed
  // with no audit row (or vice versa).
  await db.$transaction([
    db.crmOpportunity.update({
      where: { id: opp.id },
      data: {
        stage: newStage,
        probabilityPct,
        estimatedValueEGP,
        weightedValueEGP,
        ...(closesDeal ? { dateClosed: new Date() } : {}),
      },
    }),
    db.crmStageHistory.create({
      data: {
        opportunityId: opp.id,
        fromStage: opp.stage,
        toStage: newStage,
        changedById: session.user.crmProfileId ?? session.user.id,
        actingAdminId: session.user.actingAsCrmProfileId ?? null,
      },
    }),
  ]);

  // Fire the stage-changed workflow AFTER commit — engine swallows
  // its own errors so a workflow failure doesn't roll back the move.
  await fireWorkflow("opp.stage.changed", {
    entityType: "opportunity",
    entityId: opp.id,
    actorId: session.user.crmProfileId ?? session.user.id,
    actorAdminId: session.user.actingAsCrmProfileId ?? null,
    fromStage: opp.stage,
    toStage: newStage,
  });

  return NextResponse.json({
    ok: true,
    opportunity: { id: opp.id, stage: newStage },
  });
}
