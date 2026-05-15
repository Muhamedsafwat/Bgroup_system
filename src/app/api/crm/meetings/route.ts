import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { CrmMeetingStatus, CrmMeetingType, type Prisma } from "@/generated/prisma";

const createSchema = z.object({
  startAt: z.string().datetime(),
  durationMinutes: z.number().int().min(15).max(8 * 60),
  meetingType: z.nativeEnum(CrmMeetingType).optional(),
  opportunityId: z.string().nullable().optional(),
  companyId: z.string().nullable().optional(),
  contactName: z.string().trim().max(200).optional().nullable(),
  contactPhone: z.string().trim().max(40).optional().nullable(),
  customerNeed: z.string().trim().max(120).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  status: z.nativeEnum(CrmMeetingStatus).optional(),
  /// Optional override — defaults to the calling rep. Admins can book on behalf of any rep.
  scheduledById: z.string().optional(),
});

async function generateCode(): Promise<string> {
  const last = await db.crmMeeting.findFirst({
    orderBy: { createdAt: "desc" },
    select: { code: true },
  });
  let n = 1;
  if (last?.code) {
    const m = last.code.match(/(\d+)$/);
    if (m) n = parseInt(m[1], 10) + 1;
  }
  return `MTG-${String(n).padStart(5, "0")}`;
}

function isPlatformAdmin(session: Session) {
  return !!session.user.hrRoles?.includes("super_admin");
}

export async function GET(req: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const crmProfileId = session.user.crmProfileId;
  if (!crmProfileId) {
    return NextResponse.json({ error: "No CRM profile" }, { status: 403 });
  }

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const status = url.searchParams.get("status");
  // Default to "all" so the calendar shows every booked slot org-wide. Reps
  // need to see colleagues' meetings to avoid double-booking the same product
  // in the same time-slot. Pass `?scope=mine` to filter to just the caller.
  const scope = url.searchParams.get("scope") ?? "all";

  const where: Prisma.CrmMeetingWhereInput = {};
  const startFilter: { gte?: Date; lt?: Date } = {};
  if (from) startFilter.gte = new Date(from);
  if (to) startFilter.lt = new Date(to);
  if (startFilter.gte || startFilter.lt) where.startAt = startFilter;
  if (status && (Object.values(CrmMeetingStatus) as string[]).includes(status)) {
    where.status = status as CrmMeetingStatus;
  }
  if (scope === "mine") {
    where.scheduledById = crmProfileId;
  }

  const meetings = await db.crmMeeting.findMany({
    where,
    orderBy: { startAt: "asc" },
    include: {
      scheduledBy: { select: { id: true, fullName: true, userId: true } },
      opportunity: { select: { id: true, code: true, title: true } },
      company: { select: { id: true, nameEn: true } },
    },
    take: 500,
  });
  return NextResponse.json({ meetings });
}

export async function POST(req: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const callerCrmProfileId = session.user.crmProfileId;
  if (!callerCrmProfileId) {
    return NextResponse.json({ error: "No CRM profile" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const data = parsed.data;

  // Resolve scheduledById — non-managers can only book for themselves.
  const isManager =
    session.user.crmRole === "MANAGER" ||
    session.user.crmRole === "ADMIN" ||
    isPlatformAdmin(session);
  let scheduledById = callerCrmProfileId;
  if (data.scheduledById && data.scheduledById !== callerCrmProfileId) {
    if (!isManager) {
      return NextResponse.json(
        { error: "Only managers can book meetings on behalf of other reps" },
        { status: 403 }
      );
    }
    const target = await db.crmUserProfile.findUnique({
      where: { id: data.scheduledById },
      select: { id: true },
    });
    if (!target) {
      return NextResponse.json({ error: "Sales rep not found" }, { status: 400 });
    }
    scheduledById = data.scheduledById;
  }

  const startAt = new Date(data.startAt);
  const endAt = new Date(startAt.getTime() + data.durationMinutes * 60_000);

  // Two-layer conflict detection:
  // 1. The same rep can't double-book themselves at the same time (any product).
  // 2. Org-wide: no two meetings for the SAME product can overlap, even when
  //    booked by different reps — the underlying tech-team / demo resource
  //    is shared. Different products in the same slot are fine; they go to
  //    different teams. DENIED + CANCELLED rows free the slot up again.
  const overlapWindow: Prisma.CrmMeetingWhereInput = {
    startAt: { lt: endAt },
    endAt: { gt: startAt },
  };
  const activeStatuses: Prisma.CrmMeetingWhereInput = {
    status: { notIn: [CrmMeetingStatus.CANCELLED, CrmMeetingStatus.DENIED] },
  };

  const selfConflict = await db.crmMeeting.findFirst({
    where: { scheduledById, ...activeStatuses, ...overlapWindow },
    select: { id: true, code: true, startAt: true, endAt: true, contactName: true, customerNeed: true },
  });
  if (selfConflict) {
    return NextResponse.json(
      {
        error: `You already have meeting ${selfConflict.code} (${selfConflict.contactName ?? "—"}) at ${selfConflict.startAt.toISOString()}.`,
        conflict: selfConflict,
      },
      { status: 409 }
    );
  }

  if (data.customerNeed) {
    const productConflict = await db.crmMeeting.findFirst({
      where: {
        customerNeed: data.customerNeed,
        ...activeStatuses,
        ...overlapWindow,
      },
      select: {
        id: true,
        code: true,
        startAt: true,
        endAt: true,
        contactName: true,
        customerNeed: true,
        scheduledBy: { select: { fullName: true } },
      },
    });
    if (productConflict) {
      return NextResponse.json(
        {
          error: `${productConflict.customerNeed} is already booked in this slot by ${productConflict.scheduledBy.fullName} (meeting ${productConflict.code}). Pick a different time or a different product.`,
          conflict: productConflict,
        },
        { status: 409 }
      );
    }
  }

  const code = await generateCode();
  const meeting = await db.crmMeeting.create({
    data: {
      code,
      scheduledById,
      startAt,
      endAt,
      durationMinutes: data.durationMinutes,
      meetingType: data.meetingType ?? "DEMO",
      opportunityId: data.opportunityId ?? null,
      companyId: data.companyId ?? null,
      contactName: data.contactName ?? null,
      contactPhone: data.contactPhone ?? null,
      customerNeed: data.customerNeed ?? null,
      notes: data.notes ?? null,
      // Every newly-booked meeting is a REQUEST until the assistant signs
      // off. Manager-or-above bookings could conceivably skip the queue but
      // we keep the rule uniform: any meeting starts in the approval queue.
      status: data.status ?? "PENDING_APPROVAL",
    },
    include: {
      scheduledBy: { select: { id: true, fullName: true } },
      opportunity: { select: { id: true, code: true, title: true } },
      company: { select: { id: true, nameEn: true } },
    },
  });
  return NextResponse.json({ meeting }, { status: 201 });
}
