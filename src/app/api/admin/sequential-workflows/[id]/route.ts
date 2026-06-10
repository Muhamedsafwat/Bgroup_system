import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { describeZodError } from "@/lib/zod-errors";
// audit v12 MEDIUM (MED-54): use canonical isPlatformAdmin instead of local copy
import { isPlatformAdmin } from "@/lib/crm/admin-gates";

const stepSchema = z.object({
  position: z.number().int().min(0).max(100).optional(),
  name: z.string().trim().min(1).max(120),
  taskTitle: z.string().trim().min(1).max(200),
  taskDescription: z.string().trim().max(2000).optional().default(""),
  assigneeUserId: z.string().nullable().optional(),
  assigneeRole: z.string().nullable().optional(),
  budgetHours: z.number().positive().max(720).default(8),
  slaIncidentOnLate: z.boolean().optional(),
  slaBonusOnEarly: z.boolean().optional(),
  taskType: z.string().optional(),
  taskPriority: z.string().optional(),
});

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(1000).optional(),
  module: z.enum(["hr", "crm", "partners", "general"]).optional(),
  isActive: z.boolean().optional(),
  /** When supplied, fully replaces the workflow's step list. */
  steps: z.array(stepSchema).max(50).optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const wf = await db.sequentialWorkflow.findUnique({
    where: { id },
    include: { steps: { orderBy: { position: "asc" } } },
  });
  if (!wf) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ workflow: wf });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isPlatformAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    { const __z = describeZodError(parsed.error); return NextResponse.json({ error: __z.message, fieldErrors: __z.fieldErrors }, { status: 422 }); }
  }
  const data = parsed.data;

  const existing = await db.sequentialWorkflow.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updated = await db.$transaction(async (tx) => {
    const wf = await tx.sequentialWorkflow.update({
      where: { id },
      data: {
        name: data.name,
        description: data.description,
        module: data.module,
        isActive: data.isActive,
      },
    });
    if (data.steps) {
      // Replace step list. Only safe when no in-flight runs are mid-step;
      // for now we just overwrite — runs already in-flight keep their old
      // step references via SequentialWorkflowRunStep.stepId (FK preserved
      // because we don't delete steps that are referenced by run steps).
      const existingSteps = await tx.sequentialWorkflowStep.findMany({
        where: { workflowId: id },
        select: { id: true, runSteps: { select: { id: true }, take: 1 } },
      });
      const inUse = new Set(existingSteps.filter((s) => s.runSteps.length > 0).map((s) => s.id));
      const safeToDelete = existingSteps.filter((s) => !inUse.has(s.id)).map((s) => s.id);
      if (safeToDelete.length > 0) {
        await tx.sequentialWorkflowStep.deleteMany({
          where: { id: { in: safeToDelete } },
        });
      }
      // Re-insert steps. For in-use rows we keep them but bump their position
      // out of the way.
      let cursor = 1000;
      for (const ex of existingSteps.filter((s) => inUse.has(s.id))) {
        await tx.sequentialWorkflowStep.update({
          where: { id: ex.id },
          data: { position: cursor++ },
        });
      }
      await tx.sequentialWorkflowStep.createMany({
        data: data.steps.map((s, idx) => ({
          workflowId: id,
          position: s.position ?? idx,
          name: s.name,
          taskTitle: s.taskTitle,
          taskDescription: s.taskDescription ?? "",
          assigneeUserId: s.assigneeUserId ?? null,
          assigneeRole: s.assigneeRole ?? null,
          budgetHours: s.budgetHours,
          slaIncidentOnLate: s.slaIncidentOnLate ?? true,
          slaBonusOnEarly: s.slaBonusOnEarly ?? true,
          taskType: s.taskType ?? "GENERAL",
          taskPriority: s.taskPriority ?? "MEDIUM",
        })),
      });
    }
    return wf;
  });

  const full = await db.sequentialWorkflow.findUnique({
    where: { id: updated.id },
    include: { steps: { orderBy: { position: "asc" } } },
  });
  return NextResponse.json({ workflow: full });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isPlatformAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const existing = await db.sequentialWorkflow.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.sequentialWorkflow.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
