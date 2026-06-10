import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { stageLabel } from "@/lib/crm/stage-labels";

/**
 * GET /api/crm/stages
 *
 * Returns the admin-curated active pipeline stages, ordered by displayOrder.
 * This is the single source of truth for what appears as a column in the
 * pipeline kanban, in the stage dropdowns, and in the stage badges.
 *
 * Why this exists: stages used to be a hardcoded enum + a static label map
 * (`STAGE_LABEL_EN` in stage-labels.ts). The admin Stage Config screen could
 * change probabilities + SLAs but the column headers in the kanban stayed
 * "Waiting for call" / "Waiting for demo" no matter what the admin typed.
 * This endpoint fixes that — labels come from `customLabelEn/customLabelAr`
 * on the CrmStageConfig row, falling back to the dictionary label, falling
 * back to a humanised stage code so the UI never shows "TECH_MEETING" raw.
 *
 * Dedup rule: when multiple entities share a stage code (e.g. one entity
 * configures CONTACTED and the default entity-null row also configures it),
 * the lowest displayOrder wins. For now the system runs one entity ("BGroup")
 * so the dedupe rarely fires, but it keeps the door open for multi-entity.
 */
export async function GET() {
  const session = await auth();
  // Any authenticated user with CRM module access can read the stage
  // list. Previously the route required `crmProfileId` which excluded
  // platform super_admins (HR role) who have no CRM profile row — they
  // got 401 here and the pipeline fell back to the hardcoded SPEC_STAGES,
  // showing a stale 8-stage column set that diverged from the 11 they
  // saw in /crm/admin/stage-config.
  if (!session?.user?.id || !session.user.modules?.includes("crm")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // audit v11 HIGH + v12 HIGH-26: filter by caller's entity (with
  // global entityId=null as the fallback) and order per-entity rows
  // BEFORE global rows. Postgres's default ORDER BY DESC puts NULLs
  // FIRST, so the previous `entityId desc` ordering inverted the
  // intent — global rows beat per-entity overrides. The explicit
  // `nulls: 'last'` keeps non-null entityId rows first; the Set-based
  // dedupe then preserves the per-entity row.
  const callerEntityId = session.user.crmEntityId ?? null;
  const rows = await db.crmStageConfig.findMany({
    where: {
      isActive: true,
      OR: [
        { entityId: null },
        ...(callerEntityId ? [{ entityId: callerEntityId }] : []),
      ],
    },
    orderBy: [
      { entityId: { sort: "desc", nulls: "last" } },
      { displayOrder: "asc" },
      { stage: "asc" },
    ],
    select: {
      stage: true,
      entityId: true,
      customLabelEn: true,
      customLabelAr: true,
      displayOrder: true,
      probabilityPct: true,
      slaHours: true,
    },
  });

  // Dedupe by stage code — per-entity row wins because of the orderBy.
  const seen = new Set<string>();
  const stages = rows
    .filter((r) => {
      if (seen.has(r.stage)) return false;
      seen.add(r.stage);
      return true;
    })
    .map((r) => ({
      stage: r.stage,
      labelEn: r.customLabelEn ?? stageLabel(r.stage, "en"),
      labelAr: r.customLabelAr ?? stageLabel(r.stage, "ar"),
      displayOrder: r.displayOrder,
      probabilityPct: r.probabilityPct,
      slaHours: r.slaHours,
    }));

  return NextResponse.json({ stages });
}
