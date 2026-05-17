import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { uniqueViolationMessage } from "@/lib/prisma-errors";
import { describeZodError } from "@/lib/zod-errors";

const stepSchema = z.object({
  position: z.number().int().min(0).max(100).optional(),
  name: z.string().trim().min(1).max(120),
  taskTitle: z.string().trim().min(1).max(200),
  taskDescription: z.string().trim().max(2000).optional().default(""),
  assigneeUserId: z.string().nullable().optional(),
  assigneeRole: z.string().nullable().optional(),
  budgetHours: z.number().positive().max(720).default(8),
  /// For CUSTOM workflows: the absolute deadline this step must be completed
  /// by. ISO 8601 datetime. Required when kind === "CUSTOM", ignored otherwise.
  deadlineAt: z.string().datetime().nullable().optional(),
  slaIncidentOnLate: z.boolean().optional(),
  slaBonusOnEarly: z.boolean().optional(),
  taskType: z.string().optional(),
  taskPriority: z.string().optional(),
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional().default(""),
  module: z.enum(["hr", "crm", "partners", "general"]).optional(),
  isActive: z.boolean().optional(),
  /// TEMPLATE (default) is reusable; CUSTOM is one-shot and uses absolute
  /// deadlines per step. The picker hides CUSTOM workflows after they've run.
  kind: z.enum(["TEMPLATE", "CUSTOM"]).optional().default("TEMPLATE"),
  steps: z.array(stepSchema).min(1).max(50),
}).refine(
  (d) => d.kind !== "CUSTOM" || d.steps.every((s) => !!s.deadlineAt),
  { message: "Every step in a CUSTOM workflow must have an absolute deadline (deadlineAt)" }
);

function isPlatformAdmin(session: Session) {
  return (
    !!session.user.hrRoles?.includes("super_admin") ||
    (!!session.user.modules?.includes("partners") && !session.user.partnerId)
  );
}

export async function GET(req: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Default GET hides consumed CUSTOM workflows. Pass ?includeConsumed=1 to
  // see them (audit trail).
  const url = new URL(req.url);
  const includeConsumed = url.searchParams.get("includeConsumed") === "1";
  const workflows = await db.sequentialWorkflow.findMany({
    where: includeConsumed ? {} : { consumedAt: null },
    orderBy: { updatedAt: "desc" },
    include: { steps: { orderBy: { position: "asc" } } },
  });
  return NextResponse.json({ workflows });
}

export async function POST(req: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isPlatformAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    { const __z = describeZodError(parsed.error); return NextResponse.json({ error: __z.message, fieldErrors: __z.fieldErrors }, { status: 400 }); }
  }
  const data = parsed.data;

  try {
    const workflow = await db.sequentialWorkflow.create({
      data: {
        name: data.name,
        description: data.description ?? "",
        module: data.module ?? "general",
        isActive: data.isActive ?? true,
        kind: data.kind,
        createdById: session.user.id,
        steps: {
          create: data.steps.map((s, idx) => ({
            position: s.position ?? idx,
            name: s.name,
            taskTitle: s.taskTitle,
            taskDescription: s.taskDescription ?? "",
            assigneeUserId: s.assigneeUserId ?? null,
            assigneeRole: s.assigneeRole ?? null,
            budgetHours: s.budgetHours,
            deadlineAt: s.deadlineAt ? new Date(s.deadlineAt) : null,
            slaIncidentOnLate: s.slaIncidentOnLate ?? true,
            slaBonusOnEarly: s.slaBonusOnEarly ?? true,
            taskType: s.taskType ?? "GENERAL",
            taskPriority: s.taskPriority ?? "MEDIUM",
          })),
        },
      },
      include: { steps: { orderBy: { position: "asc" } } },
    });
    return NextResponse.json({ workflow }, { status: 201 });
  } catch (e) {
    const dup = uniqueViolationMessage(e, "name");
    if (dup) return NextResponse.json({ error: dup }, { status: 409 });
    throw e;
  }
}
