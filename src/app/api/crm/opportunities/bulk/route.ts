import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { describeZodError } from "@/lib/zod-errors";
import { scopeOpportunityByRole } from "@/lib/crm/rbac";
import type { SessionUser } from "@/types";
import { isManagerOrAdmin } from "@/lib/crm/admin-gates";

/**
 * POST /api/crm/opportunities/bulk
 *
 * Single-call multi-edit for the opportunities list. Replaces 50
 * individual clicks during reorgs / quarterly reassignments. The
 * action shape is a tagged union — pick exactly one of:
 *
 *   { ids: string[], action: "reassign-owner", ownerId: string }
 *   { ids: string[], action: "set-priority",   priority: "HOT"|"WARM"|"COLD" }
 *   { ids: string[], action: "set-stage",      newStage: string }
 *   { ids: string[], action: "soft-delete" }
 *
 * Scope: every id passed must already be readable by the caller via
 * `scopeOpportunityByRole` — REPs can only bulk-edit their own opps;
 * MANAGER/ADMIN can edit anyone's. Cross-tenant id-guessing is
 * defeated by checking the readable-set BEFORE the write.
 *
 * Returns `{ ok: true, affected: N }` so the UI knows how many rows
 * actually changed (silent skips happen when an id wasn't visible).
 */
const baseSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, "Pick at least one opportunity").max(500),
});
const reassignSchema = baseSchema.extend({
  action: z.literal("reassign-owner"),
  ownerId: z.string().min(1, "Pick a target owner"),
});
const prioritySchema = baseSchema.extend({
  action: z.literal("set-priority"),
  priority: z.enum(["HOT", "WARM", "COLD"]),
});
const stageSchema = baseSchema.extend({
  action: z.literal("set-stage"),
  newStage: z.string().trim().min(1).max(40),
});
const deleteSchema = baseSchema.extend({
  action: z.literal("soft-delete"),
});
const bodySchema = z.discriminatedUnion("action", [
  reassignSchema,
  prioritySchema,
  stageSchema,
  deleteSchema,
]);

export async function POST(req: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const crmProfileId = session.user.crmProfileId;
  if (!crmProfileId) {
    return NextResponse.json({ error: "No CRM profile" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    const { message, fieldErrors } = describeZodError(parsed.error);
    return NextResponse.json({ error: message, fieldErrors }, { status: 400 });
  }
  const { ids, action } = parsed.data;

  // Reassign + delete are manager/admin-only — REPs shouldn't be able
  // to mass-move their own opps to someone else or wipe them.
  // set-stage is ALSO manager/admin-only: a rep mass-jumping their
  // own opps to WON would skip every forecasting / audit / commission
  // signal (the single-opp pipeline route validates and history-logs;
  // here we batch, and the right answer for non-managers is "no").
  // set-priority stays open so reps can re-tier their own pipeline.
  if (
    (action === "reassign-owner" || action === "soft-delete" || action === "set-stage") &&
    !isManagerOrAdmin(session)
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Determine which ids the caller can actually touch. The scope
  // helper is the gate — only rows it returns are eligible. Ids the
  // caller can't see are silently skipped and counted as such.
  const sessionUser: SessionUser = {
    id: crmProfileId,
    email: session.user.email!,
    fullName: session.user.name!,
    role: session.user.crmRole!,
    entityId: session.user.crmEntityId ?? null,
  };
  const visible = await db.crmOpportunity.findMany({
    where: {
      id: { in: ids },
      ...scopeOpportunityByRole(sessionUser),
      deletedAt: null,
    },
    select: { id: true },
  });
  const visibleIds = visible.map((v) => v.id);

  if (visibleIds.length === 0) {
    return NextResponse.json({ ok: true, affected: 0, skipped: ids.length });
  }

  let affected = 0;

  if (action === "reassign-owner") {
    // Validate target rep exists + is active. Same check the single-
    // opp transfer endpoint runs.
    const target = await db.crmUserProfile.findUnique({
      where: { id: parsed.data.ownerId },
      select: { id: true, active: true },
    });
    if (!target || !target.active) {
      return NextResponse.json(
        { error: "Target owner is not an active CRM rep" },
        { status: 400 }
      );
    }
    const res = await db.crmOpportunity.updateMany({
      where: { id: { in: visibleIds } },
      data: { ownerId: target.id },
    });
    affected = res.count;
  } else if (action === "set-priority") {
    const res = await db.crmOpportunity.updateMany({
      where: { id: { in: visibleIds } },
      data: { priority: parsed.data.priority },
    });
    affected = res.count;
  } else if (action === "set-stage") {
    // Validate the target stage is configured + active.
    const stageCfg = await db.crmStageConfig.findFirst({
      where: { stage: parsed.data.newStage, isActive: true },
      select: { id: true },
    });
    if (!stageCfg) {
      return NextResponse.json(
        { error: `Stage "${parsed.data.newStage}" isn't configured` },
        { status: 400 }
      );
    }
    // Fetch fromStage per row so we can write history (the single-
    // opp path at /api/crm/pipeline does the same). Mirror dateClosed
    // semantics for WON/LOST. We skip rows that are already in the
    // target stage so the audit log doesn't gain no-op rows.
    const newStage = parsed.data.newStage;
    const rows = await db.crmOpportunity.findMany({
      where: { id: { in: visibleIds } },
      select: { id: true, stage: true },
    });
    const toChange = rows.filter((r) => r.stage !== newStage);
    const closesDeal = newStage === "WON" || newStage === "LOST";
    // Transaction so partial failure doesn't leave history rows
    // pointing at unchanged opps (or vice versa). Bounded by max 500
    // ids per request (zod) so the tx stays inside Neon's window.
    await db.$transaction([
      db.crmOpportunity.updateMany({
        where: { id: { in: toChange.map((r) => r.id) } },
        data: {
          stage: newStage,
          ...(closesDeal ? { dateClosed: new Date() } : {}),
        },
      }),
      db.crmStageHistory.createMany({
        data: toChange.map((r) => ({
          opportunityId: r.id,
          fromStage: r.stage,
          toStage: newStage,
          changedById: crmProfileId,
        })),
      }),
    ]);
    affected = toChange.length;
  } else if (action === "soft-delete") {
    const res = await db.crmOpportunity.updateMany({
      where: { id: { in: visibleIds } },
      data: { deletedAt: new Date(), deletedById: crmProfileId },
    });
    affected = res.count;
  }

  return NextResponse.json({
    ok: true,
    affected,
    skipped: ids.length - visibleIds.length,
  });
}
