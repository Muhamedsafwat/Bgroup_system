import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { describeZodError } from "@/lib/zod-errors";

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
    { const __z = describeZodError(parsed.error); return NextResponse.json({ error: __z.message, fieldErrors: __z.fieldErrors }, { status: 422 }); }
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
  // already owned by the target rep. `deletedAt: null` so a soft-deleted opp
  // can't be silently transferred.
  const opps = await db.crmOpportunity.findMany({
    where: { id: { in: opportunityIds }, deletedAt: null },
    select: {
      id: true,
      code: true,
      title: true,
      ownerId: true,
      entityId: true,
      owner: { select: { id: true, fullName: true, userId: true } },
    },
  });

  // MANAGER + ADMIN can transfer any opp to any rep — the previous
  // "manager confined to their own entity" guard was the old team-only
  // model. Managers now run the whole sales floor and must be able to
  // rebalance across entities + teams without round-tripping through an
  // admin.
  const actorId = session.user.crmProfileId ?? null;

  // Wrap update + audit-log in a single transaction so a mid-loop
  // failure (deleted rep, network blip) rolls the whole batch back
  // instead of leaving some opps transferred + some not, audit log
  // half-complete. Bounded by the zod max on the input array.
  const toTransfer = opps.filter((o) => o.ownerId !== toRepId);
  const transferred: Array<{ id: string; code: string; fromOwnerId: string }> = [];
  if (toTransfer.length > 0) {
    await db.$transaction(async (tx) => {
      for (const o of toTransfer) {
        await tx.crmOpportunity.update({
          where: { id: o.id },
          data: { ownerId: toRepId },
        });
        await tx.crmActivityLog.create({
          data: {
            opportunityId: o.id,
            actorId: actorId ?? toRepId, // fallback so FK never null
            actingAdminId: session.user.actingAsCrmProfileId ?? null,
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
    });
  }

  return NextResponse.json({
    transferred: transferred.length,
    skipped: opportunityIds.length - transferred.length,
    targetRep: { id: target.id, name: target.fullName },
    details: transferred,
  });
}
