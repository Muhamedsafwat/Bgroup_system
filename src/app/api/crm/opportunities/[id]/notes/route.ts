import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { scopeOpportunityByRole } from "@/lib/crm/rbac";
import type { SessionUser } from "@/types";
import { describeZodError } from "@/lib/zod-errors";

/**
 * POST /api/crm/opportunities/[id]/notes
 *
 * Adds a free-text note (meeting minutes, post-call summary, internal
 * comment, etc.) to an opportunity. Uses the standard role-scope check so
 * ASSISTANT can write notes only on opportunities tied to a meeting they
 * scheduled or approved — that's the whole point of their role in the new
 * lock-down: write what happened after the meeting without seeing the rest
 * of the pipeline.
 */
const schema = z.object({
  content: z
    .string()
    .trim()
    .min(1, "Note can't be empty")
    .max(5000, "Note is too long — split it into multiple entries"),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id || !session.user.crmProfileId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    { const __z = describeZodError(parsed.error); return NextResponse.json({ error: __z.message, fieldErrors: __z.fieldErrors }, { status: 422 }); }
  }

  // Use the same scope helper every read goes through — so the asssitant
  // can ONLY add notes to opportunities tied to meetings they handled, reps
  // to their own opps, managers to their team's, etc.
  const sessionUser: SessionUser = {
    id: session.user.crmProfileId,
    email: session.user.email!,
    fullName: session.user.name!,
    role: session.user.crmRole!,
    entityId: session.user.crmEntityId ?? null,
  };
  const scope = scopeOpportunityByRole(sessionUser);
  const opp = await db.crmOpportunity.findFirst({
    where: { id, ...scope, deletedAt: null },
    select: { id: true },
  });
  if (!opp) {
    return NextResponse.json(
      { error: "Opportunity not found or not in your scope" },
      { status: 404 }
    );
  }

  const [note] = await db.$transaction([
    db.crmNote.create({
      data: {
        opportunityId: id,
        authorId: session.user.crmProfileId,
        actingAdminId: session.user.actingAsCrmProfileId ?? null,
        content: parsed.data.content,
      },
      include: {
        author: { select: { id: true, fullName: true } },
      },
    }),
    db.crmActivityLog.create({
      data: {
        opportunityId: id,
        actorId: session.user.crmProfileId,
        actingAdminId: session.user.actingAsCrmProfileId ?? null,
        action: "note_added",
        metadata: {},
      },
    }),
  ]);

  return NextResponse.json({ ok: true, note: JSON.parse(JSON.stringify(note)) });
}
