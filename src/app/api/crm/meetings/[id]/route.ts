import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { CrmMeetingStatus, CrmMeetingType } from "@/generated/prisma";

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
  if (meeting.scheduledById !== ownProfile && !isManager(session)) {
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
      opportunity: { select: { id: true, code: true, title: true } },
      company: { select: { id: true, nameEn: true } },
    },
  });
  return NextResponse.json({ meeting });
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
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
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

  if (slotChanged && (data.status ?? result.meeting.status) !== "CANCELLED") {
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
