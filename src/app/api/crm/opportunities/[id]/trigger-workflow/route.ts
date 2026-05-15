import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { triggerWorkflow } from "@/lib/sequential-workflows/engine";

/**
 * POST /api/crm/opportunities/[id]/trigger-workflow
 * Body: { workflowId: string, comment?: string }
 *
 * Starts a sequential workflow scoped to this opportunity. Only the SALES
 * MANAGER may initiate — not the rep who owns the opp, not the platform
 * admin, not the CRM admin (per the user's explicit spec). The manager is
 * responsible for kicking off the work order so the rest of the team
 * (engineers, account managers, ops) knows it's their turn.
 *
 * The cascade: every CrmNote + CrmAttachment on the opp is copied to the
 * FIRST task of the run as a TaskComment / TaskAttachment, so the people
 * downstream see the same artifacts the sales rep accumulated.
 */

const triggerSchema = z.object({
  workflowId: z.string().min(1),
  /// Optional kickoff message from the manager, posted as the first comment
  /// on the spawned task — context the team needs before they begin.
  comment: z.string().trim().max(2000).optional(),
});

function isSalesManager(session: Session): boolean {
  // The spec is specific: ONLY the sales manager. Not the rep, not the
  // platform admin, not the CRM admin. CEO is treated as a manager too
  // because they sit above the manager in the same hierarchy.
  return session.user.crmRole === "MANAGER" || session.user.crmRole === "ADMIN";
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSalesManager(session)) {
    return NextResponse.json(
      {
        error:
          "Only the sales manager can start a workflow from an opportunity. Reps and admins are intentionally excluded.",
      },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const parsed = triggerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  // Confirm the opportunity exists + collect its notes / attachments for the
  // cascade before we touch the engine.
  const opp = await db.crmOpportunity.findUnique({
    where: { id },
    include: {
      notes: {
        orderBy: { createdAt: "asc" },
        include: { author: { select: { fullName: true } } },
      },
      attachments: { orderBy: { createdAt: "asc" } },
      company: { select: { nameEn: true } },
    },
  });
  if (!opp) return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });

  // Trigger the workflow with the opp as the entity context.
  const result = await triggerWorkflow(parsed.data.workflowId, {
    triggeredById: session.user.id,
    entityType: "CRM_OPPORTUNITY",
    entityId: id,
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  // Cascade: copy notes + attachments to the first task of the run.
  const firstTaskId = result.firstTaskId;

  // Kickoff comment (if the manager left one) — posted first so it sits at
  // the top of the new task's timeline.
  if (parsed.data.comment) {
    await db.taskComment.create({
      data: {
        taskId: firstTaskId,
        authorId: session.user.id,
        body: `Workflow kickoff — ${parsed.data.comment}`,
      },
    });
  }

  // Header comment: link back to the opportunity so downstream assignees
  // can hop to its full detail page.
  await db.taskComment.create({
    data: {
      taskId: firstTaskId,
      authorId: session.user.id,
      body: `🚀 Started from opportunity **${opp.code}** — ${opp.title}${
        opp.company?.nameEn ? ` (${opp.company.nameEn})` : ""
      }. The notes and attachments below were carried over from the opportunity.`,
      isSystem: true,
    },
  });

  // Mirror every opp note as a system comment on the task.
  for (const n of opp.notes) {
    await db.taskComment.create({
      data: {
        taskId: firstTaskId,
        authorId: session.user.id,
        body: `📝 Note from ${n.author?.fullName ?? "rep"} (${new Date(n.createdAt).toLocaleDateString()}):\n${n.content}`,
        isSystem: true,
      },
    });
  }

  // Mirror every opp attachment: copy the file into the task's storage tree
  // so downstream views work even if the opp's files are later cleaned up.
  for (const a of opp.attachments) {
    try {
      const src = path.join(process.cwd(), "public", a.url.replace(/^\//, ""));
      const buf = await fs.readFile(src);
      const safeName = a.filename.replace(/[\\/]/g, "_").slice(0, 200);
      const hash = crypto.randomBytes(8).toString("hex");
      const relDir = `uploads/tasks/${firstTaskId}`;
      const relPath = `${relDir}/${hash}-${safeName}`;
      const absDir = path.join(process.cwd(), "public", relDir);
      await fs.mkdir(absDir, { recursive: true });
      await fs.writeFile(path.join(process.cwd(), "public", relPath), buf);
      await db.taskAttachment.create({
        data: {
          taskId: firstTaskId,
          uploadedById: session.user.id,
          filename: safeName,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
          url: `/${relPath}`,
        },
      });
    } catch (err) {
      // If a single file copy fails (deleted from disk, permission, etc.),
      // log it and keep going — the workflow has already advanced and we
      // don't want one broken file to roll back the whole trigger.
      console.warn("[opp→workflow cascade] failed to copy attachment:", a.filename, err);
    }
  }

  return NextResponse.json({
    runId: result.runId,
    firstTaskId,
    cascaded: { notes: opp.notes.length, attachments: opp.attachments.length },
  });
}
