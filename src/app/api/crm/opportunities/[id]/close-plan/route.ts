import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { describeZodError } from "@/lib/zod-errors";
import { scopeOpportunityByRole } from "@/lib/crm/rbac";
import type { SessionUser } from "@/types";
import { randomBytes } from "crypto";

/**
 * Tier-1 #23 — Mutual Action Plan (close plan).
 *
 *   GET    → fetch the plan + items (creates a stub plan if missing).
 *   POST   → upsert a single item (id present = update, absent = create).
 *   DELETE ?itemId= → remove one item.
 *   POST   /share → mint a public read-only share token.
 *
 * All gated through the opp's scope helper so REPs can only manage
 * plans on their own opps; managers can manage anyone's.
 */
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

const itemSchema = z.object({
  id: z.string().optional(),
  title: z.string().trim().min(1).max(160),
  ownerSide: z.enum(["us", "them"]).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  status: z.enum(["open", "done", "blocked"]).optional(),
  orderIndex: z.number().int().min(0).max(999).optional(),
  notes: z.string().trim().max(1000).optional(),
});

async function gate(session: SessionUser, oppId: string) {
  const opp = await db.crmOpportunity.findFirst({
    where: { id: oppId, ...scopeOpportunityByRole(session), deletedAt: null },
    select: { id: true },
  });
  return !!opp;
}

async function loadOrCreatePlan(opportunityId: string) {
  const existing = await db.crmClosePlan.findUnique({
    where: { opportunityId },
    include: { items: { orderBy: { orderIndex: "asc" } } },
  });
  if (existing) return existing;
  return db.crmClosePlan.create({
    data: { opportunityId },
    include: { items: true },
  });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = (await auth()) as Session | null;
  const sUser = sessionOrNull(session);
  if (!session?.user?.id || !sUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!(await gate(sUser, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const plan = await loadOrCreatePlan(id);
  return NextResponse.json({ plan });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = (await auth()) as Session | null;
  const sUser = sessionOrNull(session);
  if (!session?.user?.id || !sUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!(await gate(sUser, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await req.json().catch(() => null);
  // Special-case the "mint share token" sub-action since it's a single
  // POST hit with no item payload.
  if (body && body.action === "share") {
    const plan = await loadOrCreatePlan(id);
    const token = plan.shareToken ?? randomBytes(24).toString("hex");
    const updated = await db.crmClosePlan.update({
      where: { id: plan.id },
      data: { shareToken: token },
    });
    return NextResponse.json({ ok: true, shareToken: updated.shareToken });
  }
  const parsed = itemSchema.safeParse(body);
  if (!parsed.success) {
    const { message, fieldErrors } = describeZodError(parsed.error);
    return NextResponse.json({ error: message, fieldErrors }, { status: 422 });
  }
  const plan = await loadOrCreatePlan(id);
  const dueDate = parsed.data.dueDate
    ? new Date(`${parsed.data.dueDate}T00:00:00.000Z`)
    : parsed.data.dueDate === null
      ? null
      : undefined;
  const itemData = {
    title: parsed.data.title,
    ownerSide: parsed.data.ownerSide ?? "us",
    status: parsed.data.status ?? "open",
    orderIndex: parsed.data.orderIndex ?? plan.items.length,
    notes: parsed.data.notes ?? null,
    ...(dueDate !== undefined ? { dueDate } : {}),
  };
  if (parsed.data.id) {
    // Verify the referenced item belongs to THIS opp's plan. Without
    // this guard, a REP with access to opp O1 could pass an itemId
    // from O2's plan and rewrite it — the URL-level gate() only
    // covers O1.
    const existing = await db.crmClosePlanItem.findUnique({
      where: { id: parsed.data.id },
      select: { planId: true },
    });
    if (!existing || existing.planId !== plan.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }
  const item = parsed.data.id
    ? await db.crmClosePlanItem.update({
        where: { id: parsed.data.id },
        data: itemData,
      })
    : await db.crmClosePlanItem.create({
        data: { ...itemData, planId: plan.id },
      });
  return NextResponse.json({ ok: true, item });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = (await auth()) as Session | null;
  const sUser = sessionOrNull(session);
  if (!session?.user?.id || !sUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!(await gate(sUser, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const url = new URL(req.url);
  const itemId = url.searchParams.get("itemId");
  if (!itemId) {
    return NextResponse.json({ error: "itemId is required" }, { status: 400 });
  }
  // Same cross-opp tampering vector as the POST update path:
  // verify the item's planId belongs to THIS opp before deleting.
  const plan = await loadOrCreatePlan(id);
  const existing = await db.crmClosePlanItem.findUnique({
    where: { id: itemId },
    select: { planId: true },
  });
  if (!existing || existing.planId !== plan.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await db.crmClosePlanItem.delete({ where: { id: itemId } });
  return NextResponse.json({ ok: true });
}
