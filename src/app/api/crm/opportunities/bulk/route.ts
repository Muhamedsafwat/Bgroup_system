import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { describeZodError } from "@/lib/zod-errors";
import { scopeOpportunityByRole } from "@/lib/crm/rbac";
import type { SessionUser } from "@/types";
import { isManagerOrAdmin } from "@/lib/crm/admin-gates";
import {
  recomputeOpportunityFinancials,
  loadFxRates,
  getStageProbability,
} from "@/lib/crm/business/pipeline";
import { fireWorkflow } from "@/lib/crm/workflows/engine";
import type { CrmCurrency } from "@/generated/prisma";
import { canTransition } from "@/lib/crm/business/stage-transitions";
import type { CrmOpportunityStage } from "@/types";
// audit v12 HIGH: import activity-quota gate so bulk set-stage applies
// the same policy as single-opp changeStage() and drag-drop paths.
import { checkActivityQuota } from "@/lib/crm/business/activity-quota";

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
  // Cap at 200 so the per-row tx loop (set-stage does ~3 round-trips
  // per id: update + history + workflow) stays well under Neon's
  // transaction-timeout window. Larger batches should be split by
  // the client.
  ids: z.array(z.string().min(1)).min(1, "Pick at least one opportunity").max(200),
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
      select: { id: true, active: true, fullName: true },
    });
    if (!target || !target.active) {
      return NextResponse.json(
        { error: "Target owner is not an active CRM rep" },
        { status: 400 }
      );
    }
    // Fetch current owners so we can audit the from→to pairing
    // per row instead of a single opaque updateMany. Matches the
    // single-opp transfer's per-row CrmActivityLog fan-out.
    const rows = await db.crmOpportunity.findMany({
      where: { id: { in: visibleIds } },
      select: { id: true, ownerId: true, code: true },
    });
    const toMove = rows.filter((r) => r.ownerId !== target.id);
    await db.$transaction(async (tx) => {
      for (const r of toMove) {
        await tx.crmOpportunity.update({
          where: { id: r.id },
          data: { ownerId: target.id },
        });
        await tx.crmActivityLog.create({
          data: {
            opportunityId: r.id,
            actorId: crmProfileId,
            actingAdminId: session.user.actingAsCrmProfileId ?? null,
            action: "OWNER_REASSIGNED",
            metadata: {
              fromOwnerId: r.ownerId,
              toOwnerId: target.id,
              toOwnerName: target.fullName,
              source: "bulk",
            },
          },
        });
      }
    });
    affected = toMove.length;
  } else if (action === "set-priority") {
    // Per-row update + audit so the activity log records who tiered
    // the opp and to what. Previously the updateMany made priority
    // changes invisible in the audit trail.
    const newPriority = parsed.data.priority;
    const rows = await db.crmOpportunity.findMany({
      where: { id: { in: visibleIds } },
      select: { id: true, priority: true },
    });
    const toChange = rows.filter((r) => r.priority !== newPriority);
    await db.$transaction(async (tx) => {
      for (const r of toChange) {
        await tx.crmOpportunity.update({
          where: { id: r.id },
          data: { priority: newPriority },
        });
        await tx.crmActivityLog.create({
          data: {
            opportunityId: r.id,
            actorId: crmProfileId,
            actingAdminId: session.user.actingAsCrmProfileId ?? null,
            action: "PRIORITY_CHANGED",
            metadata: {
              fromPriority: r.priority,
              toPriority: newPriority,
              source: "bulk",
            },
          },
        });
      }
    });
    affected = toChange.length;
  } else if (action === "set-stage") {
    // Validate the target stage is configured + active.
    const stageCfg = await db.crmStageConfig.findFirst({
      where: { stage: parsed.data.newStage, isActive: true },
      select: { id: true, stageType: true },
    });
    if (!stageCfg) {
      return NextResponse.json(
        { error: `Stage "${parsed.data.newStage}" isn't configured` },
        { status: 400 }
      );
    }
    const newStage = parsed.data.newStage;
    // Fetch the rows we're about to move, with every column the
    // source-stage `requiredFieldsJson` could reference. The
    // single-opp changeStage() gate (Tier-0 #1) reads the source
    // stage's required-fields and refuses to move out of it if any
    // are missing — without this same gate, a manager can bulk-jump
    // 500 NEW opps to CONTACTED with no nextAction populated and
    // defeat the policy the admin configured.
    const rows = await db.crmOpportunity.findMany({
      where: { id: { in: visibleIds } },
    });
    // Load every source stage's required-fields in one shot.
    const sourceStages = Array.from(new Set(rows.map((r) => r.stage)));
    const sourceCfgs = sourceStages.length
      ? await db.crmStageConfig.findMany({
          where: { stage: { in: sourceStages }, isActive: true },
          select: { stage: true, requiredFieldsJson: true },
        })
      : [];
    const requiredByStage = new Map<string, string[]>();
    for (const c of sourceCfgs) {
      if (Array.isArray(c.requiredFieldsJson)) {
        requiredByStage.set(c.stage, c.requiredFieldsJson as string[]);
      }
    }
    // Filter to rows we'd actually move AND whose source-stage gates
    // are satisfied. Rows that fail the gate are reported in the
    // response as `blocked` so the manager knows which opps need a
    // touch first.
    const blocked: { id: string; missing: string[]; fromStage: string; reason?: string }[] = [];
    const toChange: typeof rows = [];
    for (const r of rows) {
      if (r.stage === newStage) continue; // skip no-op
      // SECURITY (audit v11 CRIT #1): the bulk path previously
      // skipped canTransition() entirely. That let managers
      // mass-reopen WON/LOST deals, skip-forward more than two
      // stages, and jump Postponed → Won without the matrix's
      // intervening checks. Apply the same matrix the single-opp
      // path uses.
      const transition = canTransition(
        r.stage as CrmOpportunityStage,
        newStage as CrmOpportunityStage,
      );
      if (!transition.allowed) {
        blocked.push({
          id: r.id,
          missing: [],
          fromStage: r.stage,
          reason: transition.error ?? "Transition not allowed",
        });
        continue;
      }
      // SECURITY (audit v11 CRIT #1): bulk-LOST without a lossReasonId
      // would silently land 50 opps with lossReasonId=null and
      // disappear from loss-reason dashboards. The single-opp gate
      // forces a reason via the StageChangeModal; the bulk path
      // never collects it. Refuse the operation outright — the UI
      // should pick the reason first.
      if (newStage === "LOST" && r.lossReasonId == null) {
        blocked.push({
          id: r.id,
          missing: ["lossReasonId"],
          fromStage: r.stage,
          reason: "LOST requires a loss reason — set it on each opp first.",
        });
        continue;
      }
      const required = requiredByStage.get(r.stage) ?? [];
      const missing: string[] = [];
      for (const field of required) {
        const val = (r as unknown as Record<string, unknown>)[field];
        const isMissing =
          val === null ||
          val === undefined ||
          (typeof val === "string" && val.trim().length === 0) ||
          (Array.isArray(val) && val.length === 0);
        if (isMissing) missing.push(field);
      }
      if (missing.length) {
        blocked.push({ id: r.id, missing, fromStage: r.stage });
        continue;
      }
      // audit v12 HIGH: activity-quota gate — parity with single-opp
      // changeStage() and drag-drop paths. Without this gate, managers
      // could bulk-move DISCOVERY→CONTACTED while bypassing the admin-
      // configured minimum-calls/meetings policy entirely.
      //
      // audit v12 HIGH (HIGH-21): SKIP the quota check when moving INTO
      // a terminal loss/abandon stage. A rep can't satisfy "log 3
      // calls" before being allowed to mark a dead deal LOST/POSTPONED.
      // Honor the admin's stageType column when present; fall back to
      // the seed codes.
      const isTerminalLoss =
        newStage === "LOST" ||
        newStage === "POSTPONED" ||
        stageCfg.stageType === "lost" ||
        stageCfg.stageType === "abandoned";
      if (!isTerminalLoss) {
        // eslint-disable-next-line no-await-in-loop
        const quotaError = await checkActivityQuota(r.id, r.stage);
        if (quotaError) {
          blocked.push({ id: r.id, missing: [], fromStage: r.stage, reason: quotaError });
          continue;
        }
      }
      toChange.push(r);
    }
    // Honor CrmStageConfig.stageType so custom terminal stages
    // (e.g. stageType='won' on 'WON_DEAL') stamp dateClosed and
    // appear in won-rate KPIs. Fall back to the seed codes for installs
    // that haven't populated stageType yet.
    const closesDeal =
      stageCfg.stageType === "won" ||
      stageCfg.stageType === "lost" ||
      newStage === "WON" ||
      newStage === "LOST";
    // audit v12 HIGH: build per-target-stage date-stamp fields once so
    // each row gets the canonical side-effect timestamps that SLA
    // reports and conversion dashboards depend on. The old bulk path
    // only stamped dateClosed, so dateContacted/dateDiscovery/
    // dateProposalSent were never set and SLA reports drifted.
    const now = new Date();
    const stageDateStamps: Record<string, unknown> = {};
    if (newStage === "CONTACTED") stageDateStamps.dateContacted = now;
    if (newStage === "DISCOVERY") stageDateStamps.dateDiscovery = now;
    if (newStage === "PROPOSAL_SENT") stageDateStamps.dateProposalSent = now;
    // Bulk parity with the single-opp changeStage path:
    //   1. Resolve the target stage's probabilityPct ONCE (same target
    //      stage for every row in this call).
    //   2. Load FX rates ONCE.
    //   3. Per row: recompute weightedValueEGP with the new
    //      probability + the row's existing currency, write the
    //      update + history + activity-log together.
    //   4. After commit: fan out `opp.stage.changed` workflows.
    // Without (1)+(3), forecast aggregates over `weightedValueEGP`
    // drift after every bulk move; without (4), workflows admins
    // configured for stage transitions silently skip.
    const probabilityPct = await getStageProbability(newStage);
    const fxRates = toChange.length ? await loadFxRates() : null;
    // audit v12 HIGH: track per-row race-gate results so concurrency
    // conflicts are reported back to the caller rather than silently
    // clobbering a newer stage set by a concurrent rep.
    const conflicted: string[] = [];
    if (toChange.length > 0 && fxRates) {
      await db.$transaction(async (tx) => {
        for (const r of toChange) {
          const { estimatedValueEGP, weightedValueEGP } =
            recomputeOpportunityFinancials(
              Number(r.estimatedValue),
              r.currency as CrmCurrency,
              probabilityPct,
              fxRates,
            );
          // audit v12 HIGH: race-gate — pin the WHERE clause to the
          // source stage we validated against. A concurrent rep who
          // already moved this opp to a different stage will cause
          // claim.count === 0, skipping the history/log writes for
          // this row and surfacing it in `conflicted` instead of
          // silently clobbering the newer state (ATOMICITY fix).
          const claim = await tx.crmOpportunity.updateMany({
            where: { id: r.id, stage: r.stage },
            data: {
              stage: newStage,
              probabilityPct,
              estimatedValueEGP,
              weightedValueEGP,
              ...(closesDeal ? { dateClosed: now } : {}),
              ...stageDateStamps,
            },
          });
          if (claim.count === 0) {
            // Concurrently moved — skip history + log for this row.
            conflicted.push(r.id);
            continue;
          }
          await tx.crmStageHistory.create({
            data: {
              opportunityId: r.id,
              fromStage: r.stage,
              toStage: newStage,
              changedById: crmProfileId,
              actingAdminId: session.user.actingAsCrmProfileId ?? null,
            },
          });
          // audit v12 HIGH: write CrmActivityLog per row so the
          // activity feed reflects every bulk stage move. Previously
          // the bulk set-stage path wrote no activity-log entries at
          // all, leaving the feed empty after manager bulk-moves and
          // making audit trails incomplete.
          await tx.crmActivityLog.create({
            data: {
              opportunityId: r.id,
              actorId: crmProfileId,
              actingAdminId: session.user.actingAsCrmProfileId ?? null,
              action: "stage_changed",
              metadata: {
                from: r.stage,
                to: newStage,
                source: "bulk",
              },
            },
          });
        }
      });
      // Fire the stage-changed workflow per row AFTER commit. Engine
      // swallows its own errors so a workflow failure on row N
      // doesn't block rows N+1...M from getting their notifications.
      for (const r of toChange) {
        if (conflicted.includes(r.id)) continue;
        await fireWorkflow("opp.stage.changed", {
          entityType: "opportunity",
          entityId: r.id,
          actorId: crmProfileId,
          actorAdminId: session.user.actingAsCrmProfileId ?? null,
          fromStage: r.stage,
          toStage: newStage,
        });
      }
    }
    affected = toChange.length - conflicted.length;
    return NextResponse.json({
      ok: true,
      affected,
      skipped: ids.length - visibleIds.length,
      blocked: blocked.length ? blocked : undefined,
      conflicted: conflicted.length ? conflicted : undefined,
    });
  } else if (action === "soft-delete") {
    // Per-row soft-delete + audit so the activity log records the
    // deletion event for each opp rather than just the row's
    // `deletedAt` field (which is invisible in the audit-log feed).
    const rows = await db.crmOpportunity.findMany({
      where: { id: { in: visibleIds }, deletedAt: null },
      select: { id: true, code: true },
    });
    const now = new Date();
    await db.$transaction(async (tx) => {
      for (const r of rows) {
        await tx.crmOpportunity.update({
          where: { id: r.id },
          data: { deletedAt: now, deletedById: crmProfileId },
        });
        await tx.crmActivityLog.create({
          data: {
            opportunityId: r.id,
            actorId: crmProfileId,
            actingAdminId: session.user.actingAsCrmProfileId ?? null,
            action: "deleted",
            metadata: { code: r.code, source: "bulk" },
          },
        });
      }
    });
    affected = rows.length;
  }

  return NextResponse.json({
    ok: true,
    affected,
    skipped: ids.length - visibleIds.length,
  });
}
