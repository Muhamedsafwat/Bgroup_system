import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { CrmMeetingStatus, CrmMeetingType } from "@/generated/prisma";
import { describeZodError } from "@/lib/zod-errors";

const patchSchema = z.object({
  startAt: z.string().datetime().optional(),
  durationMinutes: z.number().int().min(15).max(8 * 60).optional(),
  meetingType: z.nativeEnum(CrmMeetingType).optional(),
  contactName: z.string().trim().max(200).nullable().optional(),
  contactPhone: z.string().trim().max(40).nullable().optional(),
  customerNeed: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  status: z.nativeEnum(CrmMeetingStatus).optional(),
});

function isManager(session: Session) {
  return (
    session.user.crmRole === "MANAGER" ||
    session.user.crmRole === "ADMIN" ||
    !!session.user.hrRoles?.includes("super_admin")
  );
}

async function loadOrError(id: string, session: Session) {
  const meeting = await db.crmMeeting.findUnique({ where: { id } });
  if (!meeting) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  const ownProfile = session.user.crmProfileId;
  // The assistant who APPROVED the meeting needs read access — that's their
  // post-meeting workflow (write outcome to the linked opp). But "ASSISTANT
  // role can see any meeting" was a security bypass: it let any assistant
  // GET/PATCH/DELETE every meeting org-wide regardless of whether they
  // ever touched it. Now ASSISTANTS only see meetings they scheduled OR
  // approved — same scope semantics as ASSISTANT visibility on
  // opportunities (scopeOpportunityByRole).
  const isAuthorized =
    meeting.scheduledById === ownProfile ||
    meeting.approvedById === ownProfile ||
    isManager(session);
  if (!isAuthorized) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  return { meeting };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await loadOrError(id, session);
  if ("error" in result) return result.error;
  const meeting = await db.crmMeeting.findUnique({
    where: { id },
    include: {
      scheduledBy: { select: { id: true, fullName: true, userId: true } },
      approvedBy: { select: { id: true, fullName: true } },
      opportunity: { select: { id: true, code: true, title: true, stage: true } },
      company: { select: { id: true, nameEn: true } },
    },
  });

  // Pull the linked opportunity's recent notes + activity so the meeting
  // dialog can render the "last update" timeline without a second round-trip.
  // Limited to 5 of each — the dialog only shows a preview; full history
  // lives on the opportunity detail page.
  let recentNotes: Array<{
    id: string;
    content: string;
    createdAt: string;
    author: { id: string; fullName: string };
  }> = [];
  let recentActivity: Array<{
    id: string;
    action: string;
    metadata: unknown;
    createdAt: string;
    actor: { id: string; fullName: string };
  }> = [];
  if (meeting?.opportunityId) {
    const [notes, activity] = await Promise.all([
      db.crmNote.findMany({
        where: { opportunityId: meeting.opportunityId },
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { author: { select: { id: true, fullName: true } } },
      }),
      db.crmActivityLog.findMany({
        where: { opportunityId: meeting.opportunityId },
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { actor: { select: { id: true, fullName: true } } },
      }),
    ]);
    recentNotes = JSON.parse(JSON.stringify(notes));
    recentActivity = JSON.parse(JSON.stringify(activity));
  }

  // SECURITY (audit v12 HIGH): apply the same PII mask that the list
  // endpoint uses — contactPhone, contactName, customerNeed, notes, and
  // deniedReason are only visible to the rep who scheduled the meeting or to
  // managers/admins. An approver who did not schedule the meeting must not
  // be able to read customer PII through this per-id endpoint.
  const ownProfile = session.user.crmProfileId;
  const safeMeeting =
    meeting?.scheduledById === ownProfile || isManager(session)
      ? meeting
      : meeting
        ? {
            ...meeting,
            contactPhone: null,
            contactName: null,
            customerNeed: null,
            notes: null,
            deniedReason: null,
          }
        : meeting;

  return NextResponse.json({ meeting: safeMeeting, recentNotes, recentActivity });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await loadOrError(id, session);
  if ("error" in result) return result.error;

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    { const __z = describeZodError(parsed.error); return NextResponse.json({ error: __z.message, fieldErrors: __z.fieldErrors }, { status: 422 }); }
  }
  const data = parsed.data;

  // Recompute endAt if start or duration changed; also recheck conflicts.
  let startAt = result.meeting.startAt;
  let durationMinutes = result.meeting.durationMinutes;
  if (data.startAt) startAt = new Date(data.startAt);
  if (data.durationMinutes) durationMinutes = data.durationMinutes;
  const endAt = new Date(startAt.getTime() + durationMinutes * 60_000);

  const slotChanged =
    startAt.getTime() !== result.meeting.startAt.getTime() ||
    durationMinutes !== result.meeting.durationMinutes;

  // audit v12 MEDIUM (MED-28): also run the conflict check when a status-only
  // PATCH reactivates a previously CANCELLED meeting, so two meetings can never
  // share the same slot even when the slot itself did not change.
  const newStatus = data.status ?? result.meeting.status;
  const statusBecomesActive =
    data.status !== undefined &&
    data.status !== "CANCELLED" &&
    result.meeting.status === "CANCELLED";

  if ((slotChanged || statusBecomesActive) && newStatus !== "CANCELLED") {
    const conflict = await db.crmMeeting.findFirst({
      where: {
        scheduledById: result.meeting.scheduledById,
        status: { not: "CANCELLED" },
        id: { not: id },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      select: { id: true, code: true, startAt: true, endAt: true, contactName: true },
    });
    if (conflict) {
      return NextResponse.json(
        {
          error: `Time slot conflicts with meeting ${conflict.code} (${conflict.contactName ?? "—"})`,
          conflict,
        },
        { status: 409 }
      );
    }
  }

  const meeting = await db.crmMeeting.update({
    where: { id },
    data: {
      ...data,
      startAt,
      endAt,
      durationMinutes,
    },
    include: {
      scheduledBy: { select: { id: true, fullName: true } },
      opportunity: { select: { id: true, code: true, title: true } },
      company: { select: { id: true, nameEn: true } },
    },
  });
  return NextResponse.json({ meeting });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await loadOrError(id, session);
  if ("error" in result) return result.error;
  await db.crmMeeting.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
