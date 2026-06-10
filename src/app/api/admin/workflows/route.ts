import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";
import { ACTIONS, findAction } from "@/lib/workflows/actions";
import { describeZodError } from "@/lib/zod-errors";
// audit v12 MEDIUM (MED-54): use canonical isPlatformAdmin instead of local copy
import { isPlatformAdmin } from "@/lib/crm/admin-gates";

const stepSchema = z.object({
  kind: z.string().min(1),
  config: z.record(z.string(), z.unknown()),
  branchOnError: z.enum(["continue", "stop"]).optional(),
});

const createSchema = z.object({
  module: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  description: z.string().max(400).optional().default(""),
  triggerKind: z.enum([
    "ENTITY_CREATED",
    "ENTITY_UPDATED",
    "FIELD_CHANGED",
    "TIME_BASED",
    "WEBHOOK",
    "MANUAL",
  ]),
  triggerConfig: z.record(z.string(), z.unknown()),
  steps: z.array(stepSchema).min(1),
  isActive: z.boolean().optional().default(true),
});

export async function GET() {
  const session = (await auth()) as Session | null;
  if (!isPlatformAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const workflows = await db.workflow.findMany({
    orderBy: { createdAt: "desc" },
  });
  // Also expose the action catalogue so the builder UI knows what to render.
  const catalogue = ACTIONS.map((a) => ({
    id: a.id,
    label: a.label,
    description: a.description,
  }));
  return NextResponse.json({ workflows, catalogue });
}

export async function POST(req: Request) {
  const session = (await auth()) as Session | null;
  if (!isPlatformAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    { const __z = describeZodError(parsed.error); return NextResponse.json({ error: __z.message, fieldErrors: __z.fieldErrors }, { status: 422 }); }
  }
  // Validate each step's config against its action's schema before saving.
  for (const [i, step] of parsed.data.steps.entries()) {
    const action = findAction(step.kind);
    if (!action) {
      return NextResponse.json(
        { error: `Step ${i + 1}: unknown action "${step.kind}"` },
        { status: 400 }
      );
    }
    const cfgCheck = action.config.safeParse(step.config);
    if (!cfgCheck.success) {
      return NextResponse.json(
        { error: `Step ${i + 1} (${step.kind}): ${cfgCheck.error.issues[0].message}` },
        { status: 400 }
      );
    }
  }

  // Json columns: round-trip through JSON to satisfy Prisma's InputJsonValue.
  const triggerConfigJson = JSON.parse(JSON.stringify(parsed.data.triggerConfig));
  const stepsJson = JSON.parse(JSON.stringify(parsed.data.steps));

  const created = await db.workflow.create({
    data: {
      module: parsed.data.module,
      name: parsed.data.name,
      description: parsed.data.description,
      triggerKind: parsed.data.triggerKind,
      triggerConfig: triggerConfigJson,
      steps: stepsJson,
      isActive: parsed.data.isActive,
      createdById: session!.user!.id!,
    },
  });
  return NextResponse.json({ workflow: created }, { status: 201 });
}
