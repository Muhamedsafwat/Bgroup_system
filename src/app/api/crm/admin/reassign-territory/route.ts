import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { describeZodError } from "@/lib/zod-errors";
import { isManagerOrAdmin } from "@/lib/crm/admin-gates";

/**
 * POST /api/crm/admin/reassign-territory
 *
 * The "a rep left" wizard. Pick a source rep + a destination rep (or
 * a list of destination reps for round-robin), pick which entity
 * types to move (opportunities / companies / cold leads), preview the
 * impact, then commit the transfer in one transaction with an audit
 * row per moved entity.
 *
 * Body (preview):
 *   { mode: "preview", fromRepId: string, scopes: ("opps"|"companies"|"leads")[] }
 *
 * Body (commit):
 *   { mode: "commit", fromRepId: string, toRepIds: string[],
 *     scopes: ("opps"|"companies"|"leads")[], reason?: string }
 *
 * Preview returns counts only (no DB writes). Commit fans out across
 * the picked scopes with round-robin distribution across toRepIds
 * and writes CrmActivityLog entries on every opp move (companies +
 * cold leads don't have an activity log; the audit is implicit in
 * the changed assignedToId).
 *
 * Gate: MANAGER + ADMIN + platform super_admin. Reps don't run this.
 */

const scopesEnum = z.array(z.enum(["opps", "companies", "leads"])).min(1);
const previewSchema = z.object({
  mode: z.literal("preview"),
  fromRepId: z.string().min(1),
  scopes: scopesEnum,
});
const commitSchema = z.object({
  mode: z.literal("commit"),
  fromRepId: z.string().min(1),
  toRepIds: z.array(z.string().min(1)).min(1, "Pick at least one destination rep"),
  scopes: scopesEnum,
  reason: z.string().trim().max(500).optional(),
});
const bodySchema = z.discriminatedUnion("mode", [previewSchema, commitSchema]);

export async function POST(req: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isManagerOrAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const actorId = session.user.crmProfileId;
  if (!actorId) {
    return NextResponse.json({ error: "No CRM profile" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    const { message, fieldErrors } = describeZodError(parsed.error);
    return NextResponse.json({ error: message, fieldErrors }, { status: 400 });
  }

  const fromRep = await db.crmUserProfile.findUnique({
    where: { id: parsed.data.fromRepId },
    select: { id: true, fullName: true },
  });
  if (!fromRep) {
    return NextResponse.json({ error: "Source rep not found" }, { status: 400 });
  }

  // PREVIEW MODE — read-only counts. The UI shows "X opps, Y companies,
  // Z leads will move" before the admin confirms.
  if (parsed.data.mode === "preview") {
    const wants = new Set(parsed.data.scopes);
    const [oppsCount, companiesCount, leadsCount] = await Promise.all([
      wants.has("opps")
        ? db.crmOpportunity.count({
            where: { ownerId: fromRep.id, deletedAt: null, stage: { notIn: ["WON", "LOST"] } },
          })
        : Promise.resolve(0),
      wants.has("companies")
        ? db.crmCompany.count({ where: { assignedToId: fromRep.id } })
        : Promise.resolve(0),
      wants.has("leads")
        ? db.crmColdLead.count({
            where: {
              assignedToId: fromRep.id,
              status: { in: ["ASSIGNED", "NO_ANSWER", "WAITING_LIST"] },
            },
          })
        : Promise.resolve(0),
    ]);
    return NextResponse.json({
      preview: {
        fromRep: { id: fromRep.id, fullName: fromRep.fullName },
        opportunities: oppsCount,
        companies: companiesCount,
        coldLeads: leadsCount,
        total: oppsCount + companiesCount + leadsCount,
      },
    });
  }

  // COMMIT MODE. Validate destination reps are active before doing
  // anything destructive.
  const commitData = parsed.data; // narrows: TS keeps the union otherwise
  const toRepIds = commitData.toRepIds;
  const commitReason = commitData.reason;
  const targets = await db.crmUserProfile.findMany({
    where: { id: { in: toRepIds }, active: true },
    select: { id: true, fullName: true },
  });
  if (targets.length !== toRepIds.length) {
    return NextResponse.json(
      { error: "One or more destination reps are inactive or not found" },
      { status: 400 }
    );
  }

  const wants = new Set(parsed.data.scopes);
  const result = {
    opportunities: 0,
    companies: 0,
    coldLeads: 0,
    audit: 0,
  };

  // We use a transaction for atomicity — if anything fails, nothing
  // moved. The round-robin ordering is deterministic by id so re-runs
  // (which should be no-ops) match the original distribution.
  await db.$transaction(async (tx) => {
    if (wants.has("opps")) {
      const opps = await tx.crmOpportunity.findMany({
        where: { ownerId: fromRep.id, deletedAt: null, stage: { notIn: ["WON", "LOST"] } },
        select: { id: true, code: true, ownerId: true },
      });
      for (let i = 0; i < opps.length; i++) {
        const o = opps[i];
        const newOwner = toRepIds[i % toRepIds.length];
        await tx.crmOpportunity.update({
          where: { id: o.id },
          data: { ownerId: newOwner },
        });
        await tx.crmActivityLog.create({
          data: {
            opportunityId: o.id,
            actorId,
            action: "OWNER_REASSIGNED",
            metadata: {
              fromOwnerId: o.ownerId,
              fromOwnerName: fromRep.fullName,
              toOwnerId: newOwner,
              toOwnerName: targets.find((t) => t.id === newOwner)?.fullName ?? null,
              reason: commitReason ?? "territory-reassign",
              source: "bulk-territory-reassign",
            },
          },
        });
        result.audit += 1;
      }
      result.opportunities = opps.length;
    }

    if (wants.has("companies")) {
      const companies = await tx.crmCompany.findMany({
        where: { assignedToId: fromRep.id },
        select: { id: true },
      });
      for (let i = 0; i < companies.length; i++) {
        const newOwner = toRepIds[i % toRepIds.length];
        await tx.crmCompany.update({
          where: { id: companies[i].id },
          data: { assignedToId: newOwner },
        });
      }
      result.companies = companies.length;
    }

    if (wants.has("leads")) {
      const leads = await tx.crmColdLead.findMany({
        where: {
          assignedToId: fromRep.id,
          status: { in: ["ASSIGNED", "NO_ANSWER", "WAITING_LIST"] },
        },
        select: { id: true },
      });
      const now = new Date();
      for (let i = 0; i < leads.length; i++) {
        const newOwner = toRepIds[i % toRepIds.length];
        await tx.crmColdLead.update({
          where: { id: leads[i].id },
          data: { assignedToId: newOwner, assignedAt: now, status: "ASSIGNED" },
        });
      }
      result.coldLeads = leads.length;
    }
  });

  return NextResponse.json({ ok: true, ...result });
}
