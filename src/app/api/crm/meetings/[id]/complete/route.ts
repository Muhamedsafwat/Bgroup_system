import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { describeZodError } from "@/lib/zod-errors";

/**
 * POST /api/crm/meetings/[id]/complete
 *
 * Marks a meeting as DONE and lands the assistant's outcome notes on the
 * linked opportunity. The whole point of the assistant role is this last
 * mile: after the meeting they confirm it happened, write what was said,
 * and the note becomes the "last update" the closer / sales manager reads.
 *
 * Body:
 *   {
 *     note?: string,           // free-text outcome — copied to the opp
 *     meetingLink?: string,    // optional Zoom/Meet/Teams URL stored in the
 *                              // meeting's notes for the rep to share
 *     attendees?: string,      // optional list, appended to the note
 *   }
 *
 * Allowed callers:
 *   - The meeting's approver (assistant who signed off on it)
 *   - The rep who scheduled it (the rep also confirms after their own meetings)
 *   - Any MANAGER / ADMIN / platform admin
 *
 * Side effects:
 *   1. meeting.status = DONE
 *   2. If the meeting has an opportunityId, a CrmNote is appended to the
 *      opportunity AND a CrmActivityLog row records the assistant action —
 *      the closer reading the opp's activity tab sees the outcome inline.
 *   3. The meeting's `notes` column is updated with the meeting link +
 *      attendees so the calendar dialog can show them.
 */
const schema = z.object({
  note: z.string().trim().max(5000).optional(),
  meetingLink: z.string().trim().max(500).url("Meeting link must be a URL").optional().or(z.literal("")),
  attendees: z.string().trim().max(500).optional(),
});

function isPlatformAdmin(session: Session) {
  return (
    !!session.user.hrRoles?.includes("super_admin") ||
    (!!session.user.modules?.includes("partners") && !session.user.partnerId)
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id || !session.user.crmProfileId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    { const __z = describeZodError(parsed.error); return NextResponse.json({ error: __z.message, fieldErrors: __z.fieldErrors }, { status: 422 }); }
  }

  const meeting = await db.crmMeeting.findUnique({
    where: { id },
    select: {
      id: true,
      code: true,
      status: true,
      scheduledById: true,
      approvedById: true,
      opportunityId: true,
      notes: true,
    },
  });
  if (!meeting) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  }

  const callerId = session.user.crmProfileId;
  const role = session.user.crmRole;
  const isManager =
    role === "MANAGER" || role === "ADMIN" || isPlatformAdmin(session);
  const isApprover = meeting.approvedById === callerId;
  const isScheduler = meeting.scheduledById === callerId;
  // ASSISTANT can complete any meeting they approved. If they didn't approve
  // a specific meeting (someone else did), they shouldn't be writing its
  // outcome — that prevents two assistants stepping on each other.
  if (!isManager && !isApprover && !isScheduler) {
    return NextResponse.json(
      { error: "Only the meeting's approver, scheduler, or a manager can complete it" },
      { status: 403 }
    );
  }

  // Idempotent — if it's already DONE, append the note (assistants may add
  // a second observation after the first) rather than erroring out.
  if (meeting.status !== "DONE" && meeting.status !== "APPROVED" && meeting.status !== "CONFIRMED") {
    return NextResponse.json(
      {
        error: `Can't complete a meeting in status ${meeting.status}. Approve it first.`,
      },
      { status: 409 }
    );
  }

  // Build the outcome note. Empty notes are fine — marking the meeting done
  // is itself useful (it locks the slot status and feeds the calendar). But
  // if there IS text, we copy it across to the opp so the closer sees it.
  const lines: string[] = [];
  if (parsed.data.attendees) lines.push(`Attendees: ${parsed.data.attendees}`);
  if (parsed.data.note) lines.push(parsed.data.note);
  const oppNoteContent = lines.join("\n\n");

  // The meeting's own `notes` column carries the link + attendees so the
  // calendar dialog can render them next session.
  const meetingNotesParts: string[] = [];
  if (meeting.notes) meetingNotesParts.push(meeting.notes);
  if (parsed.data.meetingLink) meetingNotesParts.push(`Meeting link: ${parsed.data.meetingLink}`);
  if (parsed.data.attendees) meetingNotesParts.push(`Attendees: ${parsed.data.attendees}`);
  if (parsed.data.note) meetingNotesParts.push(`Outcome:\n${parsed.data.note}`);

  await db.$transaction(async (tx) => {
    await tx.crmMeeting.update({
      where: { id },
      data: {
        status: "DONE",
        notes: meetingNotesParts.join("\n\n").slice(0, 2000),
      },
    });

    // Write the note to the linked opportunity (when there is one) so the
    // closer + sales manager see it in the standard activity feed. We also
    // log a structured activity entry so timeline views can render a
    // "Meeting completed by X" banner without parsing the free text.
    if (meeting.opportunityId && oppNoteContent.length > 0) {
      await tx.crmNote.create({
        data: {
          opportunityId: meeting.opportunityId,
          authorId: callerId,
          content: `[Meeting ${meeting.code}] ${oppNoteContent}`,
        },
      });
    }
    if (meeting.opportunityId) {
      await tx.crmActivityLog.create({
        data: {
          opportunityId: meeting.opportunityId,
          actorId: callerId,
          action: "meeting_completed",
          metadata: {
            meetingId: id,
            meetingCode: meeting.code,
            hasNote: oppNoteContent.length > 0,
          },
        },
      });
    }
  });

  return NextResponse.json({ ok: true });
}
