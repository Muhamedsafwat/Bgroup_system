import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * POST /api/crm/cold-leads/distribute
 *
 * Manager/admin action: assign a batch of cold leads to one or more reps.
 *
 *   { leadIds: string[],  repIds: string[] }
 *
 * Distribution is round-robin across `repIds` for a clean even split — if
 * the caller passes 30 leadIds and 3 reps, each rep gets 10. Status flips
 * to ASSIGNED and `assignedAt` is stamped.
 *
 * The action is idempotent: re-running with the same leadIds re-rotates the
 * assignment, which is what managers want when reps swap shifts.
 */
const schema = z.object({
  leadIds: z.array(z.string()).min(1, "Pick at least one lead"),
  repIds: z.array(z.string()).min(1, "Pick at least one rep"),
});

function callerCanDistribute(session: Session | null) {
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
  if (!callerCanDistribute(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 422 }
    );
  }

  // Validate every rep exists + is active.
  const reps = await db.crmUserProfile.findMany({
    where: { id: { in: parsed.data.repIds }, active: true },
    select: { id: true },
  });
  if (reps.length !== parsed.data.repIds.length) {
    return NextResponse.json(
      { error: "One or more reps are inactive or not found" },
      { status: 400 }
    );
  }

  // If the caller is a sales MANAGER (not platform admin / CRM ADMIN), they
  // can only distribute to their own direct reports. Cross-team handoffs
  // should go through the admin.
  if (session.user.crmRole === "MANAGER") {
    const mine = await db.crmUserProfile.findMany({
      where: { id: { in: parsed.data.repIds }, managerId: session.user.crmProfileId },
      select: { id: true },
    });
    if (mine.length !== parsed.data.repIds.length) {
      return NextResponse.json(
        { error: "Managers can only distribute to their own direct reports" },
        { status: 403 }
      );
    }
  }

  // Round-robin assignment.
  const now = new Date();
  const updates: Promise<unknown>[] = [];
  for (let i = 0; i < parsed.data.leadIds.length; i++) {
    const repId = parsed.data.repIds[i % parsed.data.repIds.length];
    updates.push(
      db.crmColdLead.update({
        where: { id: parsed.data.leadIds[i] },
        data: {
          assignedToId: repId,
          assignedAt: now,
          status: "ASSIGNED",
        },
      })
    );
  }
  await Promise.all(updates);

  return NextResponse.json({
    ok: true,
    assigned: parsed.data.leadIds.length,
    perRep: Math.floor(parsed.data.leadIds.length / parsed.data.repIds.length),
  });
}
