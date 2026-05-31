import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isManagerOrAdmin } from "@/lib/crm/admin-gates";

/**
 * GET /api/crm/cold-leads/folders
 *
 * Returns the list of upload batches — one row per file an admin/manager
 * has imported via /api/crm/cold-leads/import. Each row is a "folder" in
 * the new folder-grid view of the cold-lead directory: name = original
 * file name, count = live lead count (not the import-time count, which
 * may have changed if leads were converted/archived), uploadedBy + date.
 *
 * Also returns a synthetic "unfiled" row that aggregates every cold lead
 * with no `importBatchId` — leads created manually or whose folder was
 * deleted in detach mode. Lets the UI show "Unfiled (N)" as a sibling
 * folder so no lead is hidden just because it has no batch.
 *
 * Gate: MANAGER + ADMIN (or platform super_admin). Reps don't manage
 * folders — they receive assignments from the unified list.
 */
export async function GET() {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isManagerOrAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const folders = await db.crmColdLeadImport.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      fileName: true,
      rowCount: true,
      duplicateCount: true,
      createdAt: true,
      notes: true,
      importedBy: { select: { id: true, fullName: true } },
      _count: { select: { leads: true } },
    },
  });
  const unfiledCount = await db.crmColdLead.count({
    where: { importBatchId: null },
  });

  return NextResponse.json({
    folders: folders.map((f) => ({
      id: f.id,
      fileName: f.fileName,
      uploadedAt: f.createdAt,
      uploadedBy: f.importedBy,
      // Original count is preserved for context; `liveCount` is what the
      // UI shows because some leads may have been converted/archived.
      originalCount: f.rowCount,
      duplicateCount: f.duplicateCount,
      liveCount: f._count.leads,
      notes: f.notes,
    })),
    unfiledCount,
  });
}
