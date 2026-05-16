import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

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
  leadIds: z.array(z.string()).min(1),
  repIds: z.array(z.string()).optional(),
  resetStatus: z.boolean().optional(),
});

function callerCanRedistribute(session: Session | null) {
  if (!session?.user) return false;
  const role = session.user.crmRole;
  const platformAdmin =
    !!session.user.hrRoles?.includes("super_admin") ||
    (!!session.user.modules?.includes("partners") && !session.user.partnerId);
  return platformAdmin || role === "ADMIN" || role === "MANAGER";
}

export async function POST(request: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!callerCanRedistribute(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 422 });
  }

  const now = new Date();
  const updates: Promise<unknown>[] = [];

  if (parsed.data.repIds && parsed.data.repIds.length > 0) {
    // Round-robin redistribution to the supplied reps.
    for (let i = 0; i < parsed.data.leadIds.length; i++) {
      const repId = parsed.data.repIds[i % parsed.data.repIds.length];
      updates.push(
        db.crmColdLead.update({
          where: { id: parsed.data.leadIds[i] },
          data: {
            assignedToId: repId,
            assignedAt: now,
            status: "ASSIGNED",
            recycleEligibleAt: null,
          },
        })
      );
    }
  } else if (parsed.data.resetStatus) {
    // Send back to the shared unassigned pool.
    updates.push(
      db.crmColdLead.updateMany({
        where: { id: { in: parsed.data.leadIds } },
        data: {
          status: "NEW",
          assignedToId: null,
          assignedAt: null,
          recycleEligibleAt: null,
        },
      })
    );
  } else {
    return NextResponse.json(
      { error: "Provide repIds or set resetStatus=true" },
      { status: 400 }
    );
  }

  await Promise.all(updates);
  return NextResponse.json({ ok: true, count: parsed.data.leadIds.length });
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
  if (!callerCanRedistribute(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  const parsed = z.object({ leadIds: z.array(z.string()).min(1) }).safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 422 });
  }
  await db.crmColdLead.updateMany({
    where: { id: { in: parsed.data.leadIds } },
    data: { status: "ARCHIVED", recycleEligibleAt: null },
  });
  return NextResponse.json({ ok: true, count: parsed.data.leadIds.length });
}
