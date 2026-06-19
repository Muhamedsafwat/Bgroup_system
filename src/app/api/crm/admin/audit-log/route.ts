import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isAdminOnly } from "@/lib/crm/admin-gates";

/**
 * GET /api/crm/admin/audit-log
 *
 * Cross-table audit feed scoped to the CRM module. Today the CRM has
 * three audit-relevant tables:
 *
 *   CrmActivityLog   — created/updated/stage-change/owner-reassign on opps
 *   CrmStageHistory  — every stage transition (audit-grade)
 *   CrmColdLeadDisposition — every rep touch on a cold lead
 *
 * This endpoint merges them into a single time-ordered feed so admins
 * can answer "what happened in the CRM today?" in one place. Filters
 * via query string:
 *
 *   from=YYYY-MM-DD, to=YYYY-MM-DD   (defaults to last 7 days)
 *   actorId=<crmProfileId>           (filter to one rep/admin)
 *   action=<action>                  (e.g. "OWNER_REASSIGNED", "stage")
 *   entityId=<oppId>                 (filter to one opp's history)
 *
 * Returns up to 500 rows for one request — admins paginate via
 * narrowing the date range.
 *
 * Gate: MANAGER + ADMIN + platform super_admin. Reps don't see this.
 */

type AuditEntry = {
  source: "activity" | "stage" | "disposition";
  at: string;
  action: string;
  actor: { id: string; fullName: string } | null;
  entityType: "opportunity" | "coldLead";
  entityId: string;
  entityLabel: string | null;
  detail: Record<string, unknown>;
};

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

export async function GET(req: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdminOnly(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const url = new URL(req.url);
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const to = toParam ? new Date(`${toParam}T23:59:59.999Z`) : new Date();
  const from = fromParam
    ? new Date(`${fromParam}T00:00:00.000Z`)
    : new Date(to.getTime() - SEVEN_DAYS);
  const actorId = url.searchParams.get("actorId");
  const actionFilter = url.searchParams.get("action");
  const entityIdFilter = url.searchParams.get("entityId");

  // Three parallel queries, capped at ~166 rows each so the merged
  // page stays under 500. Each source uses its own time column.
  const TAKE = 200;
  const [activity, stageHistory, dispositions] = await Promise.all([
    db.crmActivityLog.findMany({
      where: {
        createdAt: { gte: from, lte: to },
        ...(actorId ? { actorId } : {}),
        ...(actionFilter ? { action: actionFilter } : {}),
        ...(entityIdFilter ? { opportunityId: entityIdFilter } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: TAKE,
      include: {
        actor: { select: { id: true, fullName: true } },
        opportunity: { select: { id: true, code: true, title: true } },
      },
    }),
    db.crmStageHistory.findMany({
      where: {
        changedAt: { gte: from, lte: to },
        ...(actorId ? { changedById: actorId } : {}),
        ...(entityIdFilter ? { opportunityId: entityIdFilter } : {}),
      },
      orderBy: { changedAt: "desc" },
      take: TAKE,
      include: {
        opportunity: { select: { id: true, code: true, title: true } },
      },
    }),
    db.crmColdLeadDisposition.findMany({
      where: {
        dispositionedAt: { gte: from, lte: to },
        ...(actorId ? { repId: actorId } : {}),
        ...(entityIdFilter ? { coldLeadId: entityIdFilter } : {}),
      },
      orderBy: { dispositionedAt: "desc" },
      take: TAKE,
      include: {
        rep: { select: { id: true, fullName: true } },
        coldLead: { select: { id: true, name: true } },
      },
    }),
  ]);

  // Resolve stage-history actor names in a single follow-up query.
  // The schema has changedById as a plain string FK without a back
  // relation declared, so we hydrate manually here.
  const stageActorIds = Array.from(
    new Set(stageHistory.map((s) => s.changedById).filter(Boolean))
  );
  const stageActors = stageActorIds.length
    ? await db.crmUserProfile.findMany({
        where: { id: { in: stageActorIds } },
        select: { id: true, fullName: true },
      })
    : [];
  const stageActorMap = new Map(stageActors.map((a) => [a.id, a]));

  const merged: AuditEntry[] = [
    // Drop activity rows with no opportunity link (system-level
    // entries with a null opportunityId) — they can't be navigated to
    // from the audit list anyway, and the entityId field is non-null
    // by design.
    ...activity
      .filter((a) => a.opportunityId)
      .map<AuditEntry>((a) => ({
        source: "activity",
        at: a.createdAt.toISOString(),
        action: a.action,
        actor: a.actor,
        entityType: "opportunity",
        entityId: a.opportunityId as string,
        entityLabel: a.opportunity?.code ?? null,
        detail: (a.metadata as Record<string, unknown>) ?? {},
      })),
    ...stageHistory.map<AuditEntry>((s) => ({
      source: "stage",
      at: s.changedAt.toISOString(),
      action: "stage-change",
      actor: stageActorMap.get(s.changedById) ?? null,
      entityType: "opportunity",
      entityId: s.opportunityId,
      entityLabel: s.opportunity?.code ?? null,
      detail: {
        fromStage: s.fromStage,
        toStage: s.toStage,
        durationDays: s.durationDays,
      },
    })),
    ...dispositions.map<AuditEntry>((d) => ({
      source: "disposition",
      at: d.dispositionedAt.toISOString(),
      action: `disposition:${d.disposition}`,
      actor: d.rep,
      entityType: "coldLead",
      entityId: d.coldLeadId,
      entityLabel: d.coldLead?.name ?? null,
      detail: { notes: d.notes ?? null },
    })),
  ];

  // Apply the action filter post-merge too so it catches stage-change
  // and disposition: rows alongside CrmActivityLog rows.
  const filtered = actionFilter
    ? merged.filter((e) => e.action === actionFilter)
    : merged;

  filtered.sort((a, b) => b.at.localeCompare(a.at));
  const trimmed = filtered.slice(0, 500);

  return NextResponse.json({
    from: from.toISOString(),
    to: to.toISOString(),
    count: trimmed.length,
    truncated: filtered.length > 500,
    entries: trimmed,
  });
}
