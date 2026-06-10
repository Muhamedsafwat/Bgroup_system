import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { evalPredicate } from "@/lib/crm/workflows/engine";
import { publish } from "@/lib/events/bus";

/**
 * Tier-2 #39 — alert-rules evaluator.
 *
 * Scans every active CrmAlertRule against the latest entities in its
 * scope ("opportunity" / "coldLead"), fires the configured channels
 * for any entity matching the rule's predicate, and writes a
 * CrmAlertRuleFire row so the same entity isn't re-fired inside the
 * suppression window.
 *
 * Audit v11 HIGH: this evaluator did not exist before. The CRUD
 * endpoint accepted rules but nothing read them. The route is
 * cron-only (Bearer CRON_SECRET) or platform-super_admin.
 *
 * Run cadence: every 15 minutes is fine — the suppressionDays gate
 * means a misconfigured rule won't spam if you happen to hit refresh.
 */

// Constant-time secret comparison (mirrors recurring-tasks route).
function timingSafeEqualsStrings(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function authorised(req: Request, session: Session | null): boolean {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get("authorization") ?? "";
    if (timingSafeEqualsStrings(auth, `Bearer ${expected}`)) return true;
  }
  if (session?.user?.id && session.user.hrRoles?.includes("super_admin")) {
    return true;
  }
  return false;
}

type Rule = {
  id: string;
  name: string;
  scope: string;
  predicateJson: unknown;
  channels: string[];
  suppressionDays: number;
};

// v12 CRITICAL: augment each entity with computed `ageDays` (elapsed since updatedAt)
// and cast Decimal `estimatedValueEGP` to number so numeric predicates work.
async function loadEntities(scope: string): Promise<Array<Record<string, unknown>>> {
  const nowMs = Date.now();
  if (scope === "opportunity") {
    // audit v12 MEDIUM (MED-59): add take + orderBy to prevent unbounded full-table scan each cron tick.
    const rows = await db.crmOpportunity.findMany({
      where: { deletedAt: null },
      take: 500,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        ownerId: true,
        owner: { select: { userId: true, fullName: true } },
        stage: true,
        priority: true,
        estimatedValueEGP: true,
        weightedValueEGP: true,
        probabilityPct: true,
        title: true,
        code: true,
        expectedCloseDate: true,
        nextActionDate: true,
        updatedAt: true,
      },
    });
    return rows.map((r) => ({
      ...r,
      // Cast Prisma Decimal → number so numeric operators (gt/lt/gte/lte) work.
      estimatedValueEGP: Number(r.estimatedValueEGP),
      weightedValueEGP: Number(r.weightedValueEGP),
      // ageDays: whole days elapsed since last update — approximates time in current stage.
      ageDays: Math.floor((nowMs - r.updatedAt.getTime()) / 86_400_000),
    }));
  }
  if (scope === "coldLead") {
    // audit v12 MEDIUM (MED-59): add take + orderBy to prevent unbounded full-table scan each cron tick;
    // filter out archived leads so soft-deleted/inactive rows are excluded.
    const rows = await db.crmColdLead.findMany({
      where: { status: { not: "ARCHIVED" } },
      take: 500,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        assignedToId: true,
        assignedTo: { select: { userId: true, fullName: true } },
        status: true,
        companyName: true,
        recycleEligibleAt: true,
        updatedAt: true,
      },
    });
    return rows.map((r) => ({
      ...r,
      // ageDays: whole days elapsed since last status change (updatedAt proxy).
      ageDays: Math.floor((nowMs - r.updatedAt.getTime()) / 86_400_000),
    }));
  }
  return [];
}

export async function POST(req: Request) {
  const session = (await auth().catch(() => null)) as Session | null;
  if (!authorised(req, session)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rules = (await db.crmAlertRule.findMany({
    where: { isActive: true },
  })) as Rule[];

  // audit v12 MEDIUM (MED-39): results now includes an optional `error` field so
  // a single failing rule is isolated and does not abort subsequent rules.
  const results: Array<{ ruleId: string; fired: number; skipped: number; error?: string }> = [];

  for (const rule of rules) {
    // audit v12 MEDIUM (MED-39): wrap each rule in its own try/catch so an
    // unhandled exception (bad predicateJson, DB FK violation, null owner, etc.)
    // does not propagate out of the loop and silently skip all remaining rules.
    try {
    const entities = await loadEntities(rule.scope);
    const suppressionCutoff = new Date(
      Date.now() - rule.suppressionDays * 24 * 60 * 60 * 1000
    );
    let fired = 0;
    let skipped = 0;

    for (const e of entities) {
      // audit v12 MEDIUM (MED-39): per-entity try/catch so a single entity
      // failure (e.g. evalPredicate throw, DB error) only skips that entity.
      try {
      // Predicate test — engine's evalPredicate handles legacy flat
      // arrays + {all|any} trees uniformly.
      // strict:true so a misconfigured null/missing predicate fails
      // closed instead of spam-firing for every entity.
      if (!evalPredicate(rule.predicateJson, e as Parameters<typeof evalPredicate>[1], 0, { strict: true })) {
        continue;
      }

      // Suppression check — has this entity already fired in the
      // window?
      const recent = await db.crmAlertRuleFire.findFirst({
        where: {
          ruleId: rule.id,
          entityId: String(e.id),
          firedAt: { gte: suppressionCutoff },
        },
        select: { id: true },
      });
      if (recent) {
        skipped += 1;
        continue;
      }

      // Fire the channels. Today "in-app" is the only wired channel —
      // email/slack would route through their own adapters later.
      // audit v12 HIGH: track whether at least one channel actually delivered
      // so the suppression row is only written when a real notification went out.
      const owner = (e as { owner?: { userId?: string; fullName?: string } }).owner;
      const assignee = (e as { assignedTo?: { userId?: string; fullName?: string } }).assignedTo;
      const targetUserId = owner?.userId ?? assignee?.userId;
      let delivered = false;
      if (rule.channels.includes("in-app") && targetUserId) {
        const title = `Alert: ${rule.name}`;
        const message = rule.scope === "opportunity"
          ? `Opportunity ${(e as { code?: string }).code ?? (e as { title?: string }).title ?? e.id} matches the alert.`
          : `Cold lead ${(e as { companyName?: string }).companyName ?? e.id} matches the alert.`;
        await db.crmNotification.create({
          data: {
            userId: targetUserId,
            type: "alert",
            title,
            message,
            href:
              rule.scope === "opportunity"
                ? `/crm/opportunities/${e.id}`
                : `/crm/cold-leads/${e.id}`,
            metadata: { ruleId: rule.id, scope: rule.scope, entityId: e.id } as unknown as object,
          },
        });
        publish({
          type: "notification.created",
          userId: targetUserId,
          payload: { title, message, module: "crm" },
        });
        delivered = true;
      }

      // audit v12 HIGH: only record the suppression row when a notification
      // was actually delivered — avoids permanent-skip when channels=['slack']
      // (no adapter wired) or targetUserId is null.
      if (delivered) {
        await db.crmAlertRuleFire.create({
          data: { ruleId: rule.id, entityId: String(e.id) },
        });
        fired += 1;
      } else {
        // audit v12 HIGH (HIGH-43) recheck-hardening: when a rule's channels
        // are exclusively un-wired (e.g. only 'slack' or 'email' with no
        // adapter), or the entity has no targetUserId, write the
        // suppression row anyway. Without this guard the rule re-checks
        // the same entity every tick forever, churning the skipped
        // counter and burning DB queries. Once an adapter is wired the
        // suppression row will naturally expire after suppressionDays.
        const wiredChannels = rule.channels.filter((c) => c === "in-app");
        if (wiredChannels.length === 0 || !targetUserId) {
          await db.crmAlertRuleFire.create({
            data: { ruleId: rule.id, entityId: String(e.id) },
          });
        }
      }
      } catch (entityErr) {
        // audit v12 MEDIUM (MED-39): log and count the failed entity as skipped.
        console.error("[alert-rules] rule", rule.id, "entity", e.id, "failed:", entityErr);
        skipped += 1;
      }
    }

    results.push({ ruleId: rule.id, fired, skipped });
    } catch (err) {
      // audit v12 MEDIUM (MED-39): log and record error so remaining rules still run.
      console.error("[alert-rules] rule", rule.id, "failed:", err);
      results.push({ ruleId: rule.id, fired: 0, skipped: 0, error: String(err) });
    }
  }

  return NextResponse.json({ ok: true, results });
}
