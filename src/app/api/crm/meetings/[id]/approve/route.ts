import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * POST /api/crm/meetings/[id]/approve
 *
 * Assistant approves a pending meeting after coordinating with the technical
 * team. The booking transitions PENDING_APPROVAL → APPROVED so the sales rep
 * can confirm the date/time with the client.
 *
 * Authorized callers:
 *   - CRM role ASSISTANT, MANAGER, CEO, or ADMIN
 *   - HR super_admin (platform admin)
 *
 * The sales rep who booked the meeting cannot approve their own request
 * (preserves the two-sets-of-eyes flow).
 */

function canApprove(session: Session): boolean {
  const r = session.user.crmRole;
  if (r === "ASSISTANT" || r === "MANAGER" || r === "ADMIN") return true;
  if (session.user.hrRoles?.includes("super_admin")) return true;
  return false;
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canApprove(session)) {
    return NextResponse.json(
      { error: "Only the assistant or a manager can approve meeting requests" },
      { status: 403 }
    );
  }

  const meeting = await db.crmMeeting.findUnique({ where: { id } });
  if (!meeting) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // The sales rep who booked it can't sign off on their own request.
  if (meeting.scheduledById === session.user.crmProfileId) {
    return NextResponse.json(
      { error: "You can't approve a meeting you booked yourself" },
      { status: 403 }
    );
  }

  // Idempotent: if already approved, just return current state.
  if (meeting.status === "APPROVED" || meeting.status === "CONFIRMED" || meeting.status === "DONE") {
    return NextResponse.json({ meeting });
  }

  const updated = await db.crmMeeting.update({
    where: { id },
    data: {
      status: "APPROVED",
      approvedById: session.user.crmProfileId ?? null,
      approvedAt: new Date(),
      deniedReason: null,
      deniedAt: null,
    },
    include: {
      scheduledBy: { select: { id: true, fullName: true } },
      approvedBy: { select: { id: true, fullName: true } },
      opportunity: { select: { id: true, code: true, title: true } },
      company: { select: { id: true, nameEn: true } },
    },
  });

  return NextResponse.json({ meeting: updated });
}
