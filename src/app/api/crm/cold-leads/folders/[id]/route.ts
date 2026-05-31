import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { describeZodError } from "@/lib/zod-errors";
import { isManagerOrAdmin } from "@/lib/crm/admin-gates";

/**
 * PATCH /api/crm/cold-leads/folders/[id]   — rename folder
 * DELETE /api/crm/cold-leads/folders/[id]  — delete folder
 *
 * Rename just updates `fileName` on the CrmColdLeadImport row so the
 * folder grid shows the new label. Original filename is overwritten —
 * no audit history for this yet.
 *
 * Delete defaults to DETACH: the CrmColdLeadImport row is removed and
 * every lead's `importBatchId` is set null (enforced by the schema's
 * `onDelete: SetNull` FK), so the leads survive and move to "Unfiled".
 * Pass `?deleteLeads=true` to also delete every lead in the folder —
 * use this when an entire upload was a mistake (wrong file, test data,
 * etc.). The destructive mode is opt-in; the UI surfaces it as a
 * checkbox in the confirm dialog.
 *
 * Gate: MANAGER + ADMIN (or platform super_admin). Same surface as the
 * folder-list endpoint — reps don't touch folders.
 */
const renameSchema = z.object({
  fileName: z.string().trim().min(1, "Folder name is required").max(200),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export async function PATCH(
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

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = renameSchema.safeParse(body);
  if (!parsed.success) {
    const { message, fieldErrors } = describeZodError(parsed.error);
    return NextResponse.json({ error: message, fieldErrors }, { status: 422 });
  }

  const existing = await db.crmColdLeadImport.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }

  const updated = await db.crmColdLeadImport.update({
    where: { id },
    data: {
      fileName: parsed.data.fileName,
      ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
    },
    select: { id: true, fileName: true, notes: true },
  });

  return NextResponse.json({ ok: true, folder: updated });
}

export async function DELETE(
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

  const { id } = await params;
  const url = new URL(request.url);
  const deleteLeads = url.searchParams.get("deleteLeads") === "true";

  const existing = await db.crmColdLeadImport.findUnique({
    where: { id },
    select: { id: true, _count: { select: { leads: true } } },
  });
  if (!existing) {
    return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }

  const leadCount = existing._count.leads;

  if (deleteLeads) {
    // Destructive path — wipe every lead in this folder, then the folder
    // itself. `crmColdLead.deleteMany` cascades through child rows
    // (dispositions) because their FK has onDelete:Cascade in the schema.
    await db.$transaction(async (tx) => {
      await tx.crmColdLead.deleteMany({ where: { importBatchId: id } });
      await tx.crmColdLeadImport.delete({ where: { id } });
    });
    return NextResponse.json({
      ok: true,
      mode: "cascade",
      leadsDeleted: leadCount,
    });
  }

  // Detach path — schema FK has onDelete:SetNull, so deleting the
  // CrmColdLeadImport row automatically clears `importBatchId` on every
  // child lead. Leads survive as "Unfiled".
  await db.crmColdLeadImport.delete({ where: { id } });
  return NextResponse.json({
    ok: true,
    mode: "detach",
    leadsDetached: leadCount,
  });
}
