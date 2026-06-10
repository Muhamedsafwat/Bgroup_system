import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { describeZodError } from "@/lib/zod-errors";
import { isManagerOrAdmin } from "@/lib/crm/admin-gates";

/**
 * GET /api/crm/cold-leads/[id]
 * PATCH /api/crm/cold-leads/[id]
 *
 * Reps can backfill the data fields on a cold lead — website, social media,
 * contact person / position, notes, even fix a misspelled name.
 *
 * Admins and managers can ADDITIONALLY change `status` (e.g. resurrect an
 * archived lead, mark one CONVERTED manually) and `assignedToId` (reassign
 * an unassigned lead, or move a lead off a rep who left the team). Reps
 * still go through `/disposition` for the normal status flow because that
 * endpoint records the disposition history; this admin override path skips
 * the history because it's an admin correction, not a sales touch.
 *
 * Deletion is via the DELETE handler below (admin/manager only), and refuses
 * to remove a CONVERTED lead so the linked opportunity isn't orphaned.
 */
const COLD_LEAD_STATUSES = [
  "NEW",
  "ASSIGNED",
  "NO_ANSWER",
  "WAITING_LIST",
  "NOT_INTERESTED",
  "CONVERTED",
  "ARCHIVED",
] as const;

const patchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  companyName: z.string().trim().max(200).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  email: z.string().trim().max(200).nullable().optional(),
  website: z.string().trim().max(300).nullable().optional(),
  contactPerson: z.string().trim().max(200).nullable().optional(),
  contactPosition: z.string().trim().max(200).nullable().optional(),
  socialMedia: z.string().trim().max(500).nullable().optional(),
  industry: z.string().trim().max(120).nullable().optional(),
  category: z.string().trim().max(120).nullable().optional(),
  location: z.string().trim().max(200).nullable().optional(),
  source: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
  status: z.enum(COLD_LEAD_STATUSES).optional(),
  assignedToId: z.string().min(1).nullable().optional(),
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id || !session.user.crmProfileId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const lead = await db.crmColdLead.findUnique({
    where: { id },
    include: {
      assignedTo: { select: { id: true, fullName: true } },
      convertedOpportunity: { select: { id: true, code: true, stage: true } },
      dispositions: {
        orderBy: { dispositionedAt: "desc" },
        take: 10,
        include: { rep: { select: { id: true, fullName: true } } },
      },
    },
  });
  if (!lead) {
    return NextResponse.json({ error: "Cold lead not found" }, { status: 404 });
  }

  // Scope check — rep sees only their own. Managers see their team's +
  // unassigned pool; admin sees everything. Use the canonical helper so
  // platform super_admins (HR role) and platform partners-admins
  // (modules+!partnerId) reach the lead just like CRM ADMIN/MANAGER.
  if (!isManagerOrAdmin(session as Session) && lead.assignedToId !== session.user.crmProfileId) {
    return NextResponse.json({ error: "This lead isn't assigned to you" }, { status: 403 });
  }

  return NextResponse.json({ lead });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id || !session.user.crmProfileId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    const e = describeZodError(parsed.error);
    return NextResponse.json({ error: e.message, fieldErrors: e.fieldErrors }, { status: 422 });
  }

  const lead = await db.crmColdLead.findUnique({
    where: { id },
    select: { id: true, assignedToId: true, status: true },
  });
  if (!lead) {
    return NextResponse.json({ error: "Cold lead not found" }, { status: 404 });
  }

  const isMgrOrAdm = isManagerOrAdmin(session as Session);
  if (!isMgrOrAdm && lead.assignedToId !== session.user.crmProfileId) {
    return NextResponse.json(
      { error: "This lead isn't assigned to you — only the assigned rep, a manager, or an admin can edit it" },
      { status: 403 }
    );
  }

  // `status` and `assignedToId` are admin/manager-only — a rep trying to
  // bypass the disposition flow this way gets a clean 403 rather than a
  // silent no-op.
  if (!isMgrOrAdm && (parsed.data.status !== undefined || parsed.data.assignedToId !== undefined)) {
    return NextResponse.json(
      {
        error: "Only an admin or sales manager can change a lead's status or assigned rep. Use the disposition action for the normal flow.",
      },
      { status: 403 }
    );
  }

  // Validate FK if reassigning: empty-string would slip through Zod's
  // `.min(1)` because Zod's optional-nullable accepts null/undefined/string.
  // We've already required min length, but we still need to confirm the id
  // points at a real profile so we 400 cleanly instead of a Prisma FK 500.
  if (parsed.data.assignedToId) {
    const rep = await db.crmUserProfile.findUnique({
      where: { id: parsed.data.assignedToId },
      select: { id: true, active: true },
    });
    if (!rep) {
      return NextResponse.json({ error: "assignedToId not found" }, { status: 400 });
    }
  }

  // When an admin assigns/unassigns and didn't explicitly pass a status,
  // keep things consistent: unassigning → NEW, assigning a NEW lead →
  // ASSIGNED. The admin can still override by sending status explicitly.
  const data: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.assignedToId !== undefined && parsed.data.status === undefined) {
    if (parsed.data.assignedToId === null) {
      data.status = "NEW";
    } else if (lead.status === "NEW") {
      data.status = "ASSIGNED";
    }
  }

  // audit v12 HIGH (HIGH-29): when an admin transitions a lead OUT of
  // CONVERTED, clear convertedOpportunityId so the FK doesn't keep
  // pointing at a linked opp that no longer represents this lead.
  // Without this, a manager rolling back a mis-convert leaves a
  // half-broken pair: lead.status='NEW' but lead.convertedOpportunityId
  // still set, which then trips every other route that asserts the
  // pairing invariant.
  if (
    parsed.data.status !== undefined &&
    parsed.data.status !== "CONVERTED" &&
    lead.status === "CONVERTED"
  ) {
    data.convertedOpportunityId = null;
  }

  const updated = await db.crmColdLead.update({
    where: { id },
    data,
  });

  return NextResponse.json({ ok: true, lead: updated });
}

/**
 * DELETE /api/crm/cold-leads/[id]
 *
 * Hard-delete a single cold lead. Only platform admins + CRM ADMIN/MANAGER
 * can run this — reps should never destroy directory data, just disposition
 * it. Refuses to delete a CONVERTED lead because that would orphan the
 * link from the linked opportunity (CrmOpportunity.convertedFromColdLead);
 * admins can archive those instead.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const role = session.user.crmRole;
  const platformAdmin =
    !!session.user.hrRoles?.includes("super_admin") ||
    (!!session.user.modules?.includes("partners") && !session.user.partnerId);
  if (!platformAdmin && role !== "ADMIN" && role !== "MANAGER") {
    return NextResponse.json(
      { error: "Only admin or sales manager can delete cold leads" },
      { status: 403 }
    );
  }

  const { id } = await params;
  const lead = await db.crmColdLead.findUnique({
    where: { id },
    select: { id: true, status: true, convertedOpportunityId: true, name: true },
  });
  if (!lead) {
    return NextResponse.json({ error: "Cold lead not found" }, { status: 404 });
  }
  if (lead.convertedOpportunityId) {
    return NextResponse.json(
      {
        error: `"${lead.name}" is linked to an opportunity. Archive it instead — deleting would orphan the link.`,
      },
      { status: 409 }
    );
  }

  // Cascade-delete the disposition history with the lead so we don't leave
  // dangling FK rows. The schema has `onDelete: Cascade` on the relation,
  // but being explicit here documents the intent.
  await db.$transaction([
    db.crmColdLeadDisposition.deleteMany({ where: { coldLeadId: id } }),
    db.crmColdLead.delete({ where: { id } }),
  ]);
  return NextResponse.json({ ok: true });
}
