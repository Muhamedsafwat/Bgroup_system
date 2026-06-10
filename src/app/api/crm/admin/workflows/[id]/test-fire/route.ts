import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { fireWorkflow } from "@/lib/crm/workflows/engine";
import { isAdminOnly } from "@/lib/crm/admin-gates";

/**
 * Tier-2 #44 — admin "test fire" button.
 *
 * Audit v11 LOW: the engine exposes `FireOptions.ignoreSuppression`
 * for exactly this case but the admin UI never wired it. This
 * endpoint accepts {scope, entityId} and re-runs the workflow on
 * that one row, bypassing the suppression window so an admin can
 * verify their predicate without waiting `suppressionDays`.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdminOnly(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const wf = await db.crmWorkflow.findUnique({ where: { id } });
  if (!wf) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const entityId = body?.entityId as string | undefined;
  if (!entityId) {
    return NextResponse.json(
      { error: "Provide `entityId` to test-fire against." },
      { status: 400 }
    );
  }

  // We fire the trigger kind that the workflow listens for, with a
  // synthetic payload built from the entity. The engine handles
  // predicate + action.
  // audit v12 MEDIUM (MED-37): testMode moved into FireOptions so the engine
  // honours the dry-run guard and skips real DB mutations.
  await fireWorkflow(
    wf.triggerKind,
    {
      entityType: wf.triggerKind.startsWith("opp.") ? "opportunity" : "coldLead",
      entityId,
      actorId: session.user.crmProfileId ?? session.user.id,
      actorAdminId: session.user.actingAsCrmProfileId ?? null,
    } as Parameters<typeof fireWorkflow>[1],
    { ignoreSuppression: true, testMode: true }
  );

  return NextResponse.json({ ok: true, message: "Workflow test-fired (dry run — no data was mutated)." });
}
