import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { describeZodError } from "@/lib/zod-errors";
import { isManagerOrAdmin } from "@/lib/crm/admin-gates";

/**
 * POST /api/crm/cold-leads/redistribute
 *
 * Manager/admin action to recycle a batch of dispositioned leads back into
 * the active call pool. Used when:
 *   - the WAITING_LIST cooldown expires and the manager wants to push the
 *     leads back to a rep
 *   - the manager decides a NO_ANSWER batch should be retried (different
 *     time of day, different rep)
 *   - the admin needs to send NOT_INTERESTED rows to a different team for
 *     a second try
 *
 *   { leadIds: string[], repIds?: string[], resetStatus?: boolean }
 *
 *   resetStatus=true flips the status back to NEW (so the leads land in the
 *   shared pool until distributed); leaving it false keeps the bucket but
 *   re-assigns to the named reps for a re-try.
 */
const schema = z.object({
  // Bound the array so a manager (or runaway script) can't push a
  // 100k-element list into a transaction.
  leadIds: z.array(z.string().min(1)).min(1).max(2000),
  repIds: z.array(z.string().min(1)).max(50).optional(),
  resetStatus: z.boolean().optional(),
});

export async function POST(request: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isManagerOrAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    { const __z = describeZodError(parsed.error); return NextResponse.json({ error: __z.message, fieldErrors: __z.fieldErrors }, { status: 422 }); }
  }

  const now = new Date();

  // Pre-validate the lead set so the response counts reflect actual
  // hits, not "we tried this many". Lets a manager see which ids were
  // bogus instead of getting an opaque success.
  const existingLeads = await db.crmColdLead.findMany({
    where: { id: { in: parsed.data.leadIds } },
    select: { id: true },
  });
  const existingIds = new Set(existingLeads.map((l) => l.id));
  const skipped = parsed.data.leadIds.length - existingIds.size;

  if (parsed.data.repIds && parsed.data.repIds.length > 0) {
    // Round-robin redistribution to the supplied reps. Wrap in a tx
    // so a mid-loop failure rolls back the whole batch instead of
    // leaving leads partially reassigned with no error signal.
    const eligible = parsed.data.leadIds.filter((id) => existingIds.has(id));
    await db.$transaction(async (tx) => {
      for (let i = 0; i < eligible.length; i++) {
        const repId = parsed.data.repIds![i % parsed.data.repIds!.length];
        await tx.crmColdLead.update({
          where: { id: eligible[i] },
          data: {
            assignedToId: repId,
            assignedAt: now,
            status: "ASSIGNED",
            recycleEligibleAt: null,
          },
        });
      }
    });
    return NextResponse.json({ ok: true, count: eligible.length, skipped });
  } else if (parsed.data.resetStatus) {
    // Send back to the shared unassigned pool — atomic updateMany.
    const result = await db.crmColdLead.updateMany({
      where: { id: { in: parsed.data.leadIds } },
      data: {
        status: "NEW",
        assignedToId: null,
        assignedAt: null,
        recycleEligibleAt: null,
      },
    });
    return NextResponse.json({ ok: true, count: result.count, skipped });
  } else {
    return NextResponse.json(
      { error: "Provide repIds or set resetStatus=true" },
      { status: 400 }
    );
  }
}

/**
 * DELETE /api/crm/cold-leads/redistribute
 *
 * Quick "archive these" overload for the manager who wants to permanently
 * remove a batch of NOT_INTERESTED rows. Soft-archives by setting status
 * ARCHIVED — keeps the audit trail intact but pulls them out of every view.
 */
export async function DELETE(request: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isManagerOrAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  // audit v12 MEDIUM (MED-61): cap batch size; tighten element schema
  const parsed = z.object({ leadIds: z.array(z.string().min(1)).min(1).max(2000) }).safeParse(body);
  if (!parsed.success) {
    { const __z = describeZodError(parsed.error); return NextResponse.json({ error: __z.message, fieldErrors: __z.fieldErrors }, { status: 422 }); }
  }
  // audit v12 MEDIUM (MED-5): capture real DB count; guard terminal states
  const result = await db.crmColdLead.updateMany({
    where: {
      id: { in: parsed.data.leadIds },
      status: { notIn: ["CONVERTED", "ARCHIVED"] }, // terminal-state guard
    },
    data: { status: "ARCHIVED", recycleEligibleAt: null },
  });
  return NextResponse.json({ ok: true, count: result.count });
}
