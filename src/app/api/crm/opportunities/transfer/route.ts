import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * POST /api/crm/opportunities/transfer
 * Body: { opportunityIds: string[], toRepId: string, reason?: string }
 *
 * Bulk reassigns opportunities from their current owners to a new sales rep.
 * Used when:
 *   - A rep goes on leave / leaves the team
 *   - A rep isn't successful with a set of leads and the manager wants
 *     to redistribute them
 *   - General workload rebalancing
 *
 * Gate: MANAGER (their own subordinates' opps), ADMIN, or super_admin.
 * Each transfer writes a CrmActivityLog row so the audit trail shows
 * who moved what, when, and why.
 */

const transferSchema = z.object({
  opportunityIds: z.array(z.string().min(1)).min(1).max(500),
  toRepId: z.string().min(1),
  /// Optional human-readable reason — surfaced in the activity log.
  reason: z.string().trim().max(500).optional(),
});

function canTransfer(session: Session): boolean {
  if (session.user.hrRoles?.includes("super_admin")) return true;
  const r = session.user.crmRole;
  return r === "MANAGER" || r === "ADMIN";
}

export async function POST(req: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canTransfer(session)) {
    return NextResponse.json(
      { error: "Only a manager or admin can transfer opportunities" },
      { status: 403 }
    );
  }

  const body = await req.json();
  const parsed = transferSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { opportunityIds, toRepId, reason } = parsed.data;

  // Verify the target rep exists + is active.
  const target = await db.crmUserProfile.findUnique({
    where: { id: toRepId },
    select: { id: true, fullName: true, active: true, userId: true },
  });
  if (!target || !target.active) {
    return NextResponse.json(
      { error: "Target sales rep not found or inactive" },
      { status: 400 }
    );
  }

  // Look up the opportunities (deduped) so we can scope, audit, and skip ones
  // already owned by the target rep.
  const opps = await db.crmOpportunity.findMany({
    where: { id: { in: opportunityIds } },
    select: {
      id: true,
      code: true,
      title: true,
      ownerId: true,
      entityId: true,
      owner: { select: { id: true, fullName: true, userId: true } },
    },
  });

  // Manager-scoped transfer: a non-admin manager can only move opps owned by
  // reps in their own entity. Admin moves anything.
  const actorId = session.user.crmProfileId ?? null;
  const isAdmin =
    session.user.crmRole === "ADMIN" ||
    !!session.user.hrRoles?.includes("super_admin");
  let allowedIds = new Set(opps.map((o) => o.id));
  if (!isAdmin) {
    // Confine to the manager's own entity. (A future tightening: confine to
    // opps owned by reps whose managerId === actorId.)
    const myEntity = (await db.crmUserProfile.findUnique({
      where: { id: actorId ?? "" },
      select: { entityId: true },
    }))?.entityId ?? null;
    if (!myEntity) {
      return NextResponse.json(
        { error: "Manager has no entity scope; ask an admin to move these" },
        { status: 403 }
      );
    }
    allowedIds = new Set(opps.filter((o) => o.entityId === myEntity).map((o) => o.id));
  }

  const transferred: Array<{ id: string; code: string; fromOwnerId: string }> = [];
  for (const o of opps) {
    if (!allowedIds.has(o.id)) continue;
    if (o.ownerId === toRepId) continue; // already owned by target — no-op
    await db.crmOpportunity.update({
      where: { id: o.id },
      data: { ownerId: toRepId },
    });
    await db.crmActivityLog.create({
      data: {
        opportunityId: o.id,
        actorId: actorId ?? toRepId, // fallback so FK never null
        action: "OWNER_REASSIGNED",
        metadata: {
          fromOwnerId: o.ownerId,
          fromOwnerName: o.owner?.fullName ?? null,
          toOwnerId: toRepId,
          toOwnerName: target.fullName,
          reason: reason ?? null,
          by: session.user.name ?? session.user.email,
        },
      },
    });
    transferred.push({ id: o.id, code: o.code, fromOwnerId: o.ownerId });
  }

  return NextResponse.json({
    transferred: transferred.length,
    skipped: opportunityIds.length - transferred.length,
    targetRep: { id: target.id, name: target.fullName },
    details: transferred,
  });
}
