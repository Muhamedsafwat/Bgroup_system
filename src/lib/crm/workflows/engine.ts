import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma";

/**
 * Tier-2 #36 — workflow engine runtime.
 *
 * The CRUD endpoint at `/api/crm/admin/workflows` writes `CrmWorkflow`
 * rows; this module is the **evaluator** that turns those rows into
 * actual behaviour. Callers fire an event via `fireWorkflow(eventName,
 * payload, opts)` from the relevant write path (stage change,
 * disposition write, opp create, etc.). The engine:
 *
 *   1. Loads every active workflow whose `triggerKind` matches.
 *   2. Filters by `triggerConfig` ("only when stage is X", etc.).
 *   3. Evaluates `conditionJson` (predicate array against payload).
 *   4. Checks the suppression window (no re-fire on same entity
 *      within `suppressionWindowMinutes`).
 *   5. Runs the configured action(s) and writes a `CrmWorkflowRun`.
 *
 * Designed to never throw at the caller site — every error path is
 * captured as a `failed` run row so the admin can see what went
 * wrong without a deploy or a tail of logs. The caller's primary
 * mutation must NOT depend on workflow success.
 *
 * Supported actions (extensible — keyed by `action.kind` in the
 * stored JSON):
 *
 *   "notify-in-app"   — write to CrmActivityLog with action="workflow-notify"
 *                       and the payload metadata. Listeners surface this in
 *                       the in-app notification center.
 *   "set-field"       — patch `field` on the entity (opportunity only for
 *                       v1) with `value`. Skipped if the field is unknown.
 *   "create-task"     — insert a Task row attached to the actor. Needs
 *                       `title` and optionally `dueInDays`.
 *   "tag-priority"    — shortcut for set-field priority. Useful template.
 *   "log-only"        — no DB side-effect; just records the run.
 *
 * Adding a new action is one switch arm + one row in this comment.
 */

type WorkflowPayload = Record<string, unknown> & {
  entityType?: "opportunity" | "coldLead" | "company";
  entityId?: string;
  actorId?: string | null;
  /// When the original action was performed under impersonation, the
  /// admin's CrmUserProfile id. Audit-log rows written by the engine
  /// propagate this so the audit trail can reveal who triggered the
  /// chain. Optional — undefined for self-acted events.
  actorAdminId?: string | null;
};

type FireOptions = {
  // When true, skip suppression-window check (used for the manual
  // "test fire" admin button). Default false in production hooks.
  ignoreSuppression?: boolean;
  // audit v12 MEDIUM (MED-37): when true, runAction returns immediately
  // without touching the DB — prevents destructive writes during admin
  // test-fire requests.
  testMode?: boolean;
};

/**
 * Predicate evaluator. `conditionJson` shape:
 *
 *   { all: [{ field, op, value }, ...] }   — every clause must match
 *   { any: [{ field, op, value }, ...] }   — at least one
 *   { field, op, value }                   — single clause
 *
 * Operators: eq, neq, gt, gte, lt, lte, in, contains, exists.
 * Field paths use dot notation against the payload — `opp.amount`,
 * `opp.owner.id`. Unknown ops or fields are treated as "no match"
 * (return false) — never throw.
 */
type Predicate =
  | { all: Predicate[] }
  | { any: Predicate[] }
  | { field: string; op: string; value?: unknown };

// Reserved keys that would let a malicious workflow condition walk
// the prototype chain or reach constructor internals. Admin-authored
// conditions are stored as JSON and evaluated at runtime; without
// this guard, `{ field: "__proto__.polluted", op: "eq", value: true }`
// would trigger a real prototype lookup. Blocklist beats allowlist
// here because legitimate payload paths are open-ended (entityId,
// fromStage, durationDays, etc. — we shouldn't have to register
// every one).
const RESERVED_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

function readPath(obj: unknown, path: string): unknown {
  if (obj == null) return undefined;
  const segments = path.split(".");
  for (const seg of segments) {
    if (RESERVED_PATH_SEGMENTS.has(seg)) return undefined;
  }
  let cur: unknown = obj;
  for (const seg of segments) {
    // hasOwnProperty (not `in`) so inherited prototype slots aren't
    // reachable even when reserved-segment check is bypassed by
    // future code edits.
    if (
      cur &&
      typeof cur === "object" &&
      Object.prototype.hasOwnProperty.call(cur, seg)
    ) {
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return cur;
}

// Pathological nesting (`{ all: [{ all: [{ all: [...] }] }] }`) would
// blow the call stack. 50 is well past anything an admin would write
// by hand via the ClauseBuilder UI; the JSON API path is the only way
// to hit this limit and that's also admin-gated.
const MAX_PREDICATE_DEPTH = 50;

// v12 CRITICAL CRIT-6: numeric ops must accept Prisma Decimal (object),
// numeric strings, and bigint. Returns NaN when v isn't a finite number.
function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  }
  if (v && typeof v === "object" && typeof (v as { toNumber?: () => number }).toNumber === "function") {
    try {
      const n = (v as { toNumber: () => number }).toNumber();
      return Number.isFinite(n) ? n : NaN;
    } catch {
      return NaN;
    }
  }
  return NaN;
}

// audit v11 LOW #9: caller can opt into strict mode where `pred == null`
// means "no match" (fail-closed). Default still matches for workflow
// back-compat ("no filter ⇒ every event"); alert-rules pass strict:true.
export function evalPredicate(
  pred: unknown,
  payload: WorkflowPayload,
  depth = 0,
  opts: { strict?: boolean } = {},
): boolean {
  if (depth > MAX_PREDICATE_DEPTH) return false;
  if (pred == null) return !opts.strict;
  // audit v11 HIGH: legacy alert-rule predicates are stored as a flat
  // clause array. Treat as implicit AND across clauses.
  if (Array.isArray(pred)) {
    return pred.every((c) => evalPredicate(c, payload, depth + 1, opts));
  }
  if (typeof pred !== "object") return false;
  const p = pred as Predicate;
  if ("all" in p && Array.isArray(p.all)) {
    return p.all.every((c) => evalPredicate(c, payload, depth + 1, opts));
  }
  if ("any" in p && Array.isArray(p.any)) {
    return p.any.some((c) => evalPredicate(c, payload, depth + 1, opts));
  }
  if ("field" in p && "op" in p) {
    const left = readPath(payload, p.field);
    const right = p.value;
    switch (p.op) {
      case "eq":
        return left === right;
      case "neq":
        return left !== right;
      case "gt": {
        const a = toNumber(left), b = toNumber(right);
        return Number.isFinite(a) && Number.isFinite(b) && a > b;
      }
      case "gte": {
        const a = toNumber(left), b = toNumber(right);
        return Number.isFinite(a) && Number.isFinite(b) && a >= b;
      }
      case "lt": {
        const a = toNumber(left), b = toNumber(right);
        return Number.isFinite(a) && Number.isFinite(b) && a < b;
      }
      case "lte": {
        const a = toNumber(left), b = toNumber(right);
        return Number.isFinite(a) && Number.isFinite(b) && a <= b;
      }
      case "in":
        return Array.isArray(right) && right.includes(left as never);
      case "contains":
        return typeof left === "string" && typeof right === "string" && left.includes(right);
      case "exists":
      case "notNull":
        return left !== undefined && left !== null;
      case "isNull":
        return left === undefined || left === null;
      default:
        return false;
    }
  }
  return false;
}

/**
 * Run a single action. Returns the result blob to be stored on the run row.
 * Errors are caught at the caller; this function throws on actionable
 * failure (unknown action kind = caller logs and marks failed).
 */
async function runAction(
  action: Record<string, unknown>,
  payload: WorkflowPayload,
  opts: FireOptions = {}
): Promise<Record<string, unknown>> {
  // audit v12 MEDIUM (MED-37): dry-run guard — no real DB mutations during test-fire.
  if (opts.testMode) return { kind: String(action.kind ?? "unknown"), ok: true, dryRun: true };
  const kind = action.kind;
  if (kind === "log-only") {
    return { kind, ok: true };
  }
  if (kind === "notify-in-app") {
    // Best-effort: requires an opportunity in scope (the in-app
    // notification center is opportunity-centric for now). CrmActivityLog
    // has actorId as NOT NULL — workflows that fire without a human
    // actor (cron / system events) can't write a log row, so we
    // surface that explicitly instead of crashing the engine.
    if (payload.entityType !== "opportunity" || !payload.entityId) {
      return { kind, ok: false, reason: "no opportunity in payload" };
    }
    if (!payload.actorId) {
      return { kind, ok: false, reason: "actorId required for activity-log notify" };
    }
    await db.crmActivityLog.create({
      data: {
        opportunityId: payload.entityId,
        actorId: payload.actorId as string,
        actingAdminId: (payload.actorAdminId as string | null | undefined) ?? null,
        action: "workflow-notify",
        metadata: {
          message: action.message ?? "Workflow notification",
          triggeredBy: action,
        } as Prisma.InputJsonValue,
      },
    });
    return { kind, ok: true, notifiedOn: payload.entityId };
  }
  if (kind === "set-field") {
    const field = action.field as string;
    const value = action.value;
    if (payload.entityType !== "opportunity" || !payload.entityId || !field) {
      return { kind, ok: false, reason: "set-field requires opportunity entity + field" };
    }
    // Whitelist to prevent malicious workflows from rewriting FK
    // columns or audit timestamps. `stage` is deliberately NOT in
    // the list: the stage-change pipeline (CrmStageHistory write,
    // requiredFieldsJson gate, dateClosed, re-entrant
    // `opp.stage.changed` fire) must run on every transition. A
    // direct set-field on stage would skip all of it. If a workflow
    // needs to advance stage, it should call a dedicated action
    // that goes through changeStage().
    const allowed = new Set([
      "priority",
      "nextAction",
      "nextActionText",
      "leadSource",
      "description",
      "techRequirements",
    ]);
    if (!allowed.has(field)) {
      return { kind, ok: false, reason: `field "${field}" not in whitelist` };
    }
    await db.crmOpportunity.update({
      where: { id: payload.entityId },
      data: { [field]: value },
    });
    return { kind, ok: true, field, value };
  }
  if (kind === "tag-priority") {
    if (payload.entityType !== "opportunity" || !payload.entityId) {
      return { kind, ok: false, reason: "tag-priority requires opportunity entity" };
    }
    const priority = action.priority as "HOT" | "WARM" | "COLD" | undefined;
    if (!priority) return { kind, ok: false, reason: "missing priority" };
    await db.crmOpportunity.update({
      where: { id: payload.entityId },
      data: { priority },
    });
    return { kind, ok: true, priority };
  }
  if (kind === "create-task") {
    // Lightweight log-only fallback. CrmActivityLog requires actorId
    // so workflows running without a human actor skip the marker.
    if (payload.entityType !== "opportunity" || !payload.entityId) {
      return { kind, ok: false, reason: "create-task v1 requires opportunity" };
    }
    if (!payload.actorId) {
      return { kind, ok: false, reason: "actorId required" };
    }
    await db.crmActivityLog.create({
      data: {
        opportunityId: payload.entityId,
        actorId: payload.actorId as string,
        actingAdminId: (payload.actorAdminId as string | null | undefined) ?? null,
        action: "workflow-create-task",
        metadata: {
          taskTitle: action.title ?? "Untitled task",
          dueInDays: action.dueInDays ?? null,
        } as Prisma.InputJsonValue,
      },
    });
    return { kind, ok: true };
  }
  return { kind: kind ?? "unknown", ok: false, reason: "unknown action kind" };
}

/**
 * Public entry point. Call from any write path that's a workflow
 * trigger. Always returns — never throws — so the caller's primary
 * mutation is decoupled from workflow side-effects.
 */
export async function fireWorkflow(
  eventName: string,
  payload: WorkflowPayload,
  opts: FireOptions = {}
): Promise<{ fired: number; matched: number; suppressed: number }> {
  let fired = 0;
  let matched = 0;
  let suppressed = 0;
  try {
    const workflows = await db.crmWorkflow.findMany({
      where: { isActive: true, triggerKind: eventName },
    });
    if (workflows.length === 0) return { fired: 0, matched: 0, suppressed: 0 };

    for (const wf of workflows) {
      const triggerOk = wf.triggerConfig
        ? evalPredicate(wf.triggerConfig as unknown, payload)
        : true;
      if (!triggerOk) continue;

      const conditionOk = wf.conditionJson
        ? evalPredicate(wf.conditionJson as unknown, payload)
        : true;
      if (!conditionOk) continue;

      matched += 1;

      // Suppression: skip if ANY recent run for this workflow on this
      // entity fired within the window — success OR failure. If we
      // only counted successes, a workflow with an unknown action
      // kind would fail-and-retry on every triggering event forever
      // (no success row ever, suppression never engages), polluting
      // the run table and any downstream alerting. Including
      // "failed" makes a broken workflow fail noisily once per
      // window so the admin notices, instead of silently spamming.
      if (!opts.ignoreSuppression && wf.suppressionWindowMinutes > 0 && payload.entityId) {
        const cutoff = new Date(
          Date.now() - wf.suppressionWindowMinutes * 60_000
        );
        const recent = await db.crmWorkflowRun.findFirst({
          where: {
            workflowId: wf.id,
            entityId: payload.entityId,
            status: { in: ["success", "failed"] },
            firedAt: { gte: cutoff },
          },
          select: { id: true },
        });
        if (recent) {
          suppressed += 1;
          // Record a "suppressed" run so the audit trail is honest
          // about why nothing happened.
          await db.crmWorkflowRun.create({
            data: {
              workflowId: wf.id,
              status: "suppressed",
              // audit v12 LOW (LOW-8): use undefined (not null) so Prisma uses
              // the column default in both branches, keeping behaviour consistent.
              entityType: payload.entityType ?? undefined,
              entityId: payload.entityId ?? undefined,
              payloadJson: payload as unknown as Prisma.InputJsonValue,
              finishedAt: new Date(),
            },
          });
          continue;
        }
      }

      const run = await db.crmWorkflowRun.create({
        data: {
          workflowId: wf.id,
          status: "running",
          entityType: payload.entityType ?? undefined,
          entityId: payload.entityId ?? undefined,
          payloadJson: payload as unknown as Prisma.InputJsonValue,
        },
      });
      try {
        const result = await runAction(wf.actionJson as Record<string, unknown>, payload, opts);
        await db.crmWorkflowRun.update({
          where: { id: run.id },
          data: {
            status: result.ok ? "success" : "failed",
            resultJson: result as Prisma.InputJsonValue,
            error: result.ok ? null : String(result.reason ?? "action returned ok=false"),
            finishedAt: new Date(),
          },
        });
        if (result.ok) {
          fired += 1;
          await db.crmWorkflow.update({
            where: { id: wf.id },
            data: { lastFiredAt: new Date() },
          });
        }
      } catch (e) {
        await db.crmWorkflowRun.update({
          where: { id: run.id },
          data: {
            status: "failed",
            error: e instanceof Error ? e.message : String(e),
            finishedAt: new Date(),
          },
        });
      }
    }
  } catch (e) {
    // Never let a workflow problem break the primary write path.
    console.error("[workflow engine] fireWorkflow swallowed error:", e);
  }
  return { fired, matched, suppressed };
}
