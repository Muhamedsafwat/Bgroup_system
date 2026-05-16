import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { describeZodError } from "@/lib/zod-errors";

/**
 * GET /api/crm/cold-leads/[id]
 * PATCH /api/crm/cold-leads/[id]
 *
 * The PATCH endpoint lets the assigned rep (or a manager/admin) backfill
 * missing data on a cold lead — website, social media, contact person /
 * position, notes, even fix a misspelled name. They CAN'T change `status`
 * here (that goes through the dispositions endpoint) and they CAN'T
 * reassign it (that's a manager-only operation via /distribute).
 *
 * Deletion isn't supported on purpose. The user said "they can update it,
 * not delete anything" — admins archive in bulk via /redistribute DELETE.
 */
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
  // unassigned pool; admin sees everything.
  const role = session.user.crmRole;
  const isManagerOrAdmin = role === "ADMIN" || role === "MANAGER";
  if (!isManagerOrAdmin && lead.assignedToId !== session.user.crmProfileId) {
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

  const role = session.user.crmRole;
  const isManagerOrAdmin = role === "ADMIN" || role === "MANAGER";
  if (!isManagerOrAdmin && lead.assignedToId !== session.user.crmProfileId) {
    return NextResponse.json(
      { error: "This lead isn't assigned to you — only the assigned rep, a manager, or an admin can edit it" },
      { status: 403 }
    );
  }

  const updated = await db.crmColdLead.update({
    where: { id },
    data: parsed.data,
  });

  return NextResponse.json({ ok: true, lead: updated });
}
