import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { describeZodError } from "@/lib/zod-errors";
import { isManagerOrAdmin } from "@/lib/crm/admin-gates";

/**
 * POST /api/crm/cold-leads/folders/[id]/assign
 *
 * Round-robin assign every lead in a folder to one or more reps in a
 * single call. Mirrors the contract of /api/crm/cold-leads/distribute
 * but the lead set is implicit (everything with `importBatchId=<id>`)
 * so the caller doesn't have to pass thousands of leadIds for "assign
 * the whole upload to Sara".
 *
 * Body: { repIds: string[], onlyUnassigned?: boolean }
 *
 *   repIds         the reps to round-robin across.
 *   onlyUnassigned default true — skip leads that already have an owner
 *                  so re-running this endpoint isn't a destructive
 *                  reset for in-progress reps. Pass false to forcibly
 *                  re-assign every lead in the folder.
 *
 * Gate: MANAGER + ADMIN. Reps don't assign — they receive.
 */
const schema = z.object({
  repIds: z.array(z.string().min(1)).min(1, "Pick at least one rep"),
  onlyUnassigned: z.boolean().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isManagerOrAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: folderId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const { message, fieldErrors } = describeZodError(parsed.error);
    return NextResponse.json({ error: message, fieldErrors }, { status: 422 });
  }
  const onlyUnassigned = parsed.data.onlyUnassigned !== false;

  const folder = await db.crmColdLeadImport.findUnique({
    where: { id: folderId },
    select: { id: true },
  });
  if (!folder) {
    return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }

  // Validate every rep exists + is active. Same guard the bulk-distribute
  // endpoint uses — keeps disabled / typo'd ids out of the assignment.
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

  // audit v12 HIGH (HIGH-27): exclude CONVERTED + ARCHIVED so a stale
  // selection that included a CONVERTED row doesn't silently flip
  // its status to ASSIGNED while leaving convertedOpportunityId set.
  const leadIds = (
    await db.crmColdLead.findMany({
      where: {
        importBatchId: folderId,
        status: { notIn: ["CONVERTED", "ARCHIVED"] },
        ...(onlyUnassigned ? { assignedToId: null } : {}),
      },
      select: { id: true },
    })
  ).map((l) => l.id);

  if (leadIds.length === 0) {
    return NextResponse.json({
      ok: true,
      assigned: 0,
      perRep: 0,
      message: onlyUnassigned
        ? "No unassigned leads in this folder"
        : "Folder is empty",
    });
  }

  // audit v12 HIGH (HIGH-27): wrap in a single tx so a mid-loop failure
  // doesn't leave the folder half-assigned. Write a per-row audit via
  // CrmColdLeadDisposition to mirror the distribute endpoint.
  const now = new Date();
  await db.$transaction(async (tx) => {
    for (let i = 0; i < leadIds.length; i++) {
      const repId = parsed.data.repIds[i % parsed.data.repIds.length];
      await tx.crmColdLead.update({
        where: { id: leadIds[i] },
        data: { assignedToId: repId, assignedAt: now, status: "ASSIGNED" },
      });
      // audit v12 HIGH (HIGH-30) recheck: skip disposition row when actor
      // has no crmProfileId (super_admin / partners-admin pass isManagerOrAdmin
      // without a CRM profile, so crmProfileId can be undefined at runtime).
      if (session.user.crmProfileId) {
        await tx.crmColdLeadDisposition.create({
          data: {
            coldLeadId: leadIds[i],
            repId: session.user.crmProfileId,
            actingAdminId: session.user.actingAsCrmProfileId ?? null,
            disposition: "ASSIGNED",
            notes: `Folder bulk-assign to rep ${repId}`,
          },
        });
      }
    }
  });

  return NextResponse.json({
    ok: true,
    assigned: leadIds.length,
    perRep: Math.floor(leadIds.length / parsed.data.repIds.length),
  });
}
