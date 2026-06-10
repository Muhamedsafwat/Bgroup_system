import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { CrmMeetingStatus, CrmMeetingType, type Prisma } from "@/generated/prisma";
import { describeZodError } from "@/lib/zod-errors";
import { isPlatformAdmin } from "@/lib/crm/admin-gates";
// audit v12 HIGH (HIGH-48): import transactional code generator so that
// MTG codes are assigned inside the advisory-locked transaction, preventing
// duplicate codes under concurrent POST requests.
import { generateMeetingCodeInTx } from "@/lib/crm/business/auto-code";

const createSchema = z.object({
  startAt: z.string().datetime(),
  durationMinutes: z.number().int().min(15).max(8 * 60),
  meetingType: z.nativeEnum(CrmMeetingType).optional(),
  // Every meeting must be tied to an opportunity. The assistant workflow
  // (write minutes / update what happened after the meeting) hinges on the
  // opportunity link — without it there's no deal to land the outcome on.
  // The column itself stays nullable for legacy rows; the API rejects new
  // meetings without one.
  opportunityId: z.string().min(1, "Pick the opportunity this meeting is about"),
  companyId: z.string().nullable().optional(),
  contactName: z.string().trim().max(200).optional().nullable(),
  contactPhone: z.string().trim().max(40).optional().nullable(),
  customerNeed: z.string().trim().max(120).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  // audit v12 HIGH (HIGH-46): `status` intentionally omitted — clients must not be able to bypass the approval queue.
  /// Optional override — defaults to the calling rep. Admins can book on behalf of any rep.
  scheduledById: z.string().optional(),
});

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

  // audit v12 MEDIUM (MED-27): require a full ISO 8601 datetime with an
  // explicit UTC offset or Z so the server always receives an unambiguous
  // instant. Bare YYYY-MM-DD strings are rejected because JS parses them as
  // UTC midnight, silently misplacing meetings in the user's local late-evening
  // hours. Clients must pass e.g. "2026-06-10T00:00:00+03:00" or
  // "2026-06-10T00:00:00Z".
  const ISO_DATETIME_WITH_TZ =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?([+-]\d{2}:?\d{2}|Z)$/;
  function isValidDateString(s: string): boolean {
    return ISO_DATETIME_WITH_TZ.test(s) && !Number.isNaN(new Date(s).getTime());
  }
  if (from && !isValidDateString(from)) {
    return NextResponse.json(
      { error: "`from` must be a full ISO 8601 datetime with timezone, e.g. \"2026-06-10T00:00:00+03:00\"" },
      { status: 400 },
    );
  }
  if (to && !isValidDateString(to)) {
    return NextResponse.json(
      { error: "`to` must be a full ISO 8601 datetime with timezone, e.g. \"2026-06-10T23:59:59+03:00\"" },
      { status: 400 },
    );
  }

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
  // audit v12 HIGH (HIGH-49) recheck: mask PII fields for callers who are not
  // the scheduling rep and are not managers/admins. Mirrors the exact mask
  // applied in the per-id GET handler so the list endpoint cannot be used as
  // a bypass to retrieve customer PII for meetings the caller did not schedule.
  const ownProfile = session.user.crmProfileId;
  const callerIsManager =
    session.user.crmRole === "MANAGER" ||
    session.user.crmRole === "ADMIN" ||
    !!session.user.hrRoles?.includes("super_admin");
  const safeMeetings = callerIsManager
    ? meetings
    : meetings.map((m) =>
        m.scheduledById === ownProfile
          ? m
          : { ...m, contactPhone: null, contactName: null, customerNeed: null, notes: null, deniedReason: null },
      );
  return NextResponse.json({ meetings: safeMeetings });
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
    { const __z = describeZodError(parsed.error); return NextResponse.json({ error: __z.message, fieldErrors: __z.fieldErrors }, { status: 422 }); }
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

  // Verify the opportunity is real and belongs to scheduledById.
  // audit v12 HIGH (HIGH-50): ownerId is now enforced unconditionally —
  // previously managers spread an empty object, removing ownership validation
  // entirely and allowing a manager to bind any rep's meeting to any opp.
  // scheduledById is already resolved to the target rep's ID (line 138) or the
  // caller (line 123), so this constraint is correct in both cases.
  const oppOwnerCheck = await db.crmOpportunity.findFirst({
    where: {
      id: data.opportunityId,
      deletedAt: null,
      ownerId: scheduledById,
    },
    select: { id: true, companyId: true },
  });
  if (!oppOwnerCheck) {
    return NextResponse.json(
      { error: "Opportunity not found or not yours to schedule" },
      { status: 400 }
    );
  }
  // Auto-fill `companyId` from the opportunity if the caller didn't provide
  // one — keeps the meeting → opp → company graph consistent.
  if (!data.companyId) {
    data.companyId = oppOwnerCheck.companyId;
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

  // audit v12 HIGH: wrap INSERT + product-overlap re-check in an
  // advisory-locked transaction so concurrent cross-rep bookings for the
  // SAME product in the SAME time-slot serialise. The pre-tx checks above
  // are a best-effort fast path only. Without a second lock keyed on
  // hash(customerNeed + startHourBucket), Rep A and Rep B both pass the
  // pre-tx product findFirst (their per-rep lock keys differ), then both
  // proceed to INSERT, double-booking the product slot.
  //
  // Lock key 1: hash(scheduledById)                   -- serialises per-rep
  // Lock key 2: hash(customerNeed + startHourBucket)  -- serialises cross-rep
  //             product-slot contention (new lock added by this fix).
  function strHash(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    }
    return h;
  }

  const txResult = await db.$transaction(async (tx) => {
    // Lock 1: per-rep advisory lock.
    await tx.$queryRawUnsafe(
      `SELECT pg_advisory_xact_lock($1::bigint)`,
      strHash(scheduledById),
    );

    // Lock 2 (audit v12 HIGH): per-product-slot advisory lock so that
    // concurrent bookings for the same product by different reps serialise.
    if (data.customerNeed) {
      const startHourBucket = Math.floor(startAt.getTime() / (60 * 60 * 1000));
      const productSlotHash = strHash(
        `${data.customerNeed.toLowerCase()}:${startHourBucket}`,
      );
      await tx.$queryRawUnsafe(
        `SELECT pg_advisory_xact_lock($1::bigint)`,
        productSlotHash,
      );

      // Re-run the product-overlap check inside the lock -- race-free.
      const productConflictInTx = await tx.crmMeeting.findFirst({
        where: {
          customerNeed: { equals: data.customerNeed, mode: "insensitive" },
          status: { notIn: ["CANCELLED", "DENIED"] },
          startAt: { lt: endAt },
          endAt: { gt: startAt },
        },
        select: {
          id: true,
          code: true,
          customerNeed: true,
          scheduledBy: { select: { fullName: true } },
        },
      });
      if (productConflictInTx) {
        throw new Error(
          `__PRODUCT_CONFLICT__:${productConflictInTx.customerNeed ?? ""}:${productConflictInTx.scheduledBy.fullName}:${productConflictInTx.code}`,
        );
      }
    }

    // audit v12 HIGH (HIGH-48): generate the meeting code inside the
    // advisory-locked transaction so concurrent requests cannot read the
    // same last row and produce a duplicate MTG code (P2002 race fix).
    const code = await generateMeetingCodeInTx(tx);

    return tx.crmMeeting.create({
      data: {
        code,
        scheduledById,
        actingAdminId: session.user.actingAsCrmProfileId ?? null,
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
        // audit v12 HIGH (HIGH-46): hardcoded — client-supplied status is rejected at schema level above.
        status: "PENDING_APPROVAL",
      },
      include: {
        scheduledBy: { select: { id: true, fullName: true } },
        opportunity: { select: { id: true, code: true, title: true } },
        company: { select: { id: true, nameEn: true } },
      },
    });
  }).catch((e: unknown) => {
    if (e instanceof Error && e.message.startsWith("__PRODUCT_CONFLICT__:")) {
      const parts = e.message.replace("__PRODUCT_CONFLICT__:", "").split(":");
      const [productNeed, repName, conflictCode] = parts;
      return { __product_conflict: true, productNeed, repName, conflictCode } as const;
    }
    throw e;
  });

  if (txResult && "__product_conflict" in txResult) {
    return NextResponse.json(
      {
        error: `${txResult.productNeed} is already booked in this slot by ${txResult.repName} (meeting ${txResult.conflictCode}). Pick a different time or a different product.`,
      },
      { status: 409 },
    );
  }
  return NextResponse.json({ meeting: txResult }, { status: 201 });
}