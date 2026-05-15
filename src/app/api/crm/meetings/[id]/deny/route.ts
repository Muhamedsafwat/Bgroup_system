import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * POST /api/crm/meetings/[id]/deny
 *
 * Assistant denies a pending meeting (tech team unavailable, room conflict,
 * the request needs more info, etc.). Body: { reason: string }. The reason
 * is surfaced back to the booking rep so they can fix it and re-submit.
 */

const denySchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

function canDeny(session: Session): boolean {
  const r = session.user.crmRole;
  if (r === "ASSISTANT" || r === "MANAGER" || r === "ADMIN") return true;
  if (session.user.hrRoles?.includes("super_admin")) return true;
  return false;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canDeny(session)) {
    return NextResponse.json(
      { error: "Only the assistant or a manager can deny meeting requests" },
      { status: 403 }
    );
  }

  const meeting = await db.crmMeeting.findUnique({ where: { id } });
  if (!meeting) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (meeting.scheduledById === session.user.crmProfileId) {
    return NextResponse.json(
      { error: "You can't deny a meeting you booked yourself" },
      { status: 403 }
    );
  }

  const body = await req.json();
  const parsed = denySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const updated = await db.crmMeeting.update({
    where: { id },
    data: {
      status: "DENIED",
      deniedReason: parsed.data.reason,
      deniedAt: new Date(),
      approvedById: null,
      approvedAt: null,
    },
    include: {
      scheduledBy: { select: { id: true, fullName: true } },
      opportunity: { select: { id: true, code: true, title: true } },
      company: { select: { id: true, nameEn: true } },
    },
  });

  return NextResponse.json({ meeting: updated });
}
