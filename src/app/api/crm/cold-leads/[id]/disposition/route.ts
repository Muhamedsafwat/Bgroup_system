import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { computeRecycleEligibility } from "@/lib/crm/cold-leads";
import type { CrmColdLeadStatus } from "@/generated/prisma";
import { describeZodError } from "@/lib/zod-errors";
import { fireWorkflow } from "@/lib/crm/workflows/engine";
import { isManagerOrAdmin } from "@/lib/crm/admin-gates";

/**
 * POST /api/crm/cold-leads/[id]/disposition
 *
 * Rep records what happened on a call. Updates the lead's status, writes a
 * row in `CrmColdLeadDisposition` (audit trail), and decides whether the
 * lead is eligible for recycling back to the pool.
 *
 *   { disposition: "NO_ANSWER" | "WAITING_LIST" | "NOT_INTERESTED",  notes?: string }
 *
 * Only the rep currently assigned to the lead (or a manager/admin) may call
 * this — prevents reps from disposing of each other's queues.
 */
const schema = z.object({
  disposition: z.enum(["NO_ANSWER", "WAITING_LIST", "NOT_INTERESTED"]),
  notes: z.string().trim().max(2000).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id || !session.user.crmProfileId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    { const __z = describeZodError(parsed.error); return NextResponse.json({ error: __z.message, fieldErrors: __z.fieldErrors }, { status: 422 }); }
  }

  const now = new Date();
  const recycleAt = computeRecycleEligibility(parsed.data.disposition);

  // audit v12 LOW (LOW-2): collapse the standalone findUnique + separate
  // $transaction into a single interactive transaction so the auth check and
  // the write are one serializable unit, eliminating the TOCTOU window where a
  // concurrent distribute call could reassign the lead between the read and write.
  const txResult = await db.$transaction(async (tx) => {
    const lead = await tx.crmColdLead.findUnique({
      where: { id },
      select: { id: true, assignedToId: true, status: true },
    });
    if (!lead) return { error: "not_found" as const };

    // Canonical helper so platform super_admin + partners-admin
    // see disposition the same way CRM ADMIN/MANAGER do.
    const canTouch =
      lead.assignedToId === session.user.crmProfileId ||
      isManagerOrAdmin(session as Session);
    if (!canTouch) return { error: "forbidden" as const };

    const updated = await tx.crmColdLead.update({
      where: { id },
      data: {
        status: parsed.data.disposition as CrmColdLeadStatus,
        lastDispositionAt: now,
        recycleEligibleAt: recycleAt,
      },
    });
    // repId is non-nullable in the schema. Reps always have a
    // crmProfileId; super_admins without a CRM profile fall through
    // assignedToId so we use the lead's assigned rep as the audit
    // attribution (which is the legacy behaviour anyway).
    const auditRepId = session.user.crmProfileId ?? lead.assignedToId;
    if (!auditRepId) {
      return { error: "no_audit_rep" as const };
    }
    await tx.crmColdLeadDisposition.create({
      data: {
        coldLeadId: id,
        repId: auditRepId,
        actingAdminId: session.user.actingAsCrmProfileId ?? null,
        disposition: parsed.data.disposition as CrmColdLeadStatus,
        notes: parsed.data.notes ?? null,
      },
    });
    return { ok: true as const, lead: updated };
  });

  if (txResult.error === "not_found") {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }
  if (txResult.error === "forbidden") {
    return NextResponse.json(
      { error: "This lead isn't assigned to you" },
      { status: 403 }
    );
  }
  if (txResult.error === "no_audit_rep") {
    return NextResponse.json(
      { error: "No rep is assigned to this lead — cannot record disposition" },
      { status: 409 },
    );
  }

  const updated = txResult.lead!

  // Tier-2 #36 — fire workflow on disposition write. Engine swallows
  // its own errors; the rep's primary write is already committed.
  await fireWorkflow("lead.disposition", {
    entityType: "coldLead",
    entityId: id,
    actorId: session.user.crmProfileId,
    actorAdminId: session.user.actingAsCrmProfileId ?? null,
    disposition: parsed.data.disposition,
  });

  return NextResponse.json({ ok: true, lead: updated });
}
