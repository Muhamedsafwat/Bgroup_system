import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { computeRecycleEligibility } from "@/lib/crm/cold-leads";
import type { CrmColdLeadStatus } from "@/generated/prisma";

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
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 422 });
  }

  const lead = await db.crmColdLead.findUnique({
    where: { id },
    select: { id: true, assignedToId: true, status: true },
  });
  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  const role = session.user.crmRole;
  const isManagerOrAdmin = role === "ADMIN" || role === "MANAGER";
  const canTouch = lead.assignedToId === session.user.crmProfileId || isManagerOrAdmin;
  if (!canTouch) {
    return NextResponse.json(
      { error: "This lead isn't assigned to you" },
      { status: 403 }
    );
  }

  const now = new Date();
  const recycleAt = computeRecycleEligibility(parsed.data.disposition);

  const [updated] = await db.$transaction([
    db.crmColdLead.update({
      where: { id },
      data: {
        status: parsed.data.disposition as CrmColdLeadStatus,
        lastDispositionAt: now,
        recycleEligibleAt: recycleAt,
      },
    }),
    db.crmColdLeadDisposition.create({
      data: {
        coldLeadId: id,
        repId: session.user.crmProfileId,
        disposition: parsed.data.disposition as CrmColdLeadStatus,
        notes: parsed.data.notes ?? null,
      },
    }),
  ]);

  return NextResponse.json({ ok: true, lead: updated });
}
