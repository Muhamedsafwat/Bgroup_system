import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { describeZodError } from "@/lib/zod-errors";
import { scopeOpportunityByRole } from "@/lib/crm/rbac";
import type { SessionUser } from "@/types";

/**
 * GET  /api/crm/opportunities/[id]/meddpicc — read snapshot (creates
 *                                              an empty row on first read)
 * PATCH /api/crm/opportunities/[id]/meddpicc — partial update of
 *                                              any of the 8 letters
 *
 * Tier-1 #11 — MEDDPICC qualification. 8 letters × (0-3 score + free
 * text notes). Visibility / mutation is gated by the same scope helper
 * as the opp itself — REP can only edit their own; MANAGER/ADMIN can
 * edit anyone's.
 *
 * Returns `{ snapshot, healthScore, healthBand }` where healthScore is
 * the sum of all 8 scores out of 24, and healthBand is one of
 * "strong" | "decent" | "weak" | "unknown" (when no fields scored).
 */
const scoreField = z.number().int().min(0).max(3).nullable().optional();
const notesField = z.string().trim().max(2000).nullable().optional();
const patchSchema = z.object({
  metricsScore: scoreField,
  metricsNotes: notesField,
  economicBuyerScore: scoreField,
  economicBuyerNotes: notesField,
  decisionCriteriaScore: scoreField,
  decisionCriteriaNotes: notesField,
  decisionProcessScore: scoreField,
  decisionProcessNotes: notesField,
  paperProcessScore: scoreField,
  paperProcessNotes: notesField,
  identifyPainScore: scoreField,
  identifyPainNotes: notesField,
  championScore: scoreField,
  championNotes: notesField,
  competitionScore: scoreField,
  competitionNotes: notesField,
});

function sessionOrNull(session: Session | null): SessionUser | null {
  if (!session?.user?.crmProfileId) return null;
  return {
    id: session.user.crmProfileId,
    email: session.user.email!,
    fullName: session.user.name!,
    role: session.user.crmRole!,
    entityId: session.user.crmEntityId ?? null,
  };
}

function computeHealth(snap: Record<string, number | null | undefined> | null) {
  if (!snap) return { healthScore: 0, healthBand: "unknown" as const };
  const keys = [
    "metricsScore",
    "economicBuyerScore",
    "decisionCriteriaScore",
    "decisionProcessScore",
    "paperProcessScore",
    "identifyPainScore",
    "championScore",
    "competitionScore",
  ];
  let sum = 0;
  let assessed = 0;
  for (const k of keys) {
    const v = snap[k];
    if (typeof v === "number") {
      sum += v;
      assessed += 1;
    }
  }
  if (assessed === 0) return { healthScore: 0, healthBand: "unknown" as const };
  // Health band relative to max possible across assessed fields.
  const ratio = sum / (assessed * 3);
  const band = ratio >= 0.7 ? "strong" : ratio >= 0.4 ? "decent" : "weak";
  return { healthScore: sum, healthBand: band };
}

async function loadOrCreate(opportunityId: string) {
  const existing = await db.crmOpportunityMeddpicc.findUnique({
    where: { opportunityId },
  });
  if (existing) return existing;
  return db.crmOpportunityMeddpicc.create({
    data: { opportunityId },
  });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sUser = sessionOrNull(session);
  if (!sUser) {
    return NextResponse.json({ error: "No CRM profile" }, { status: 403 });
  }
  const { id } = await params;
  const opp = await db.crmOpportunity.findFirst({
    where: { id, ...scopeOpportunityByRole(sUser), deletedAt: null },
    select: { id: true },
  });
  if (!opp) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const snapshot = await loadOrCreate(id);
  return NextResponse.json({
    snapshot,
    ...computeHealth(snapshot as unknown as Record<string, number | null>),
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sUser = sessionOrNull(session);
  if (!sUser) {
    return NextResponse.json({ error: "No CRM profile" }, { status: 403 });
  }
  const { id } = await params;
  const opp = await db.crmOpportunity.findFirst({
    where: { id, ...scopeOpportunityByRole(sUser), deletedAt: null },
    select: { id: true },
  });
  if (!opp) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    const { message, fieldErrors } = describeZodError(parsed.error);
    return NextResponse.json({ error: message, fieldErrors }, { status: 422 });
  }
  await loadOrCreate(id); // ensure row exists
  const updated = await db.crmOpportunityMeddpicc.update({
    where: { opportunityId: id },
    data: parsed.data,
  });
  return NextResponse.json({
    snapshot: updated,
    ...computeHealth(updated as unknown as Record<string, number | null>),
  });
}
