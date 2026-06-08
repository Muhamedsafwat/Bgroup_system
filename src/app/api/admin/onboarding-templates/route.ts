import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { TaskPriority, TaskType } from "@/generated/prisma";
import { uniqueViolationMessage } from "@/lib/prisma-errors";
import { describeZodError } from "@/lib/zod-errors";

const itemSchema = z.object({
  position: z.number().int().min(0).max(200).optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().default(""),
  taskType: z.nativeEnum(TaskType).optional(),
  priority: z.nativeEnum(TaskPriority).optional(),
  dueInDays: z.number().int().min(0).max(365).default(0),
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional().default(""),
  scope: z.string().trim().max(60).optional(),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  items: z.array(itemSchema).max(100).optional().default([]),
});

function isHrAdmin(session: Session) {
  return (
    !!session.user.hrRoles?.includes("super_admin") ||
    !!session.user.hrRoles?.includes("hr_manager")
  );
}

export async function GET() {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Anyone can read template list (used by the onboarding button to choose).
  const templates = await db.onboardingTemplate.findMany({
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    include: { items: { orderBy: { position: "asc" } } },
  });
  return NextResponse.json({ templates });
}

export async function POST(req: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isHrAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    { const __z = describeZodError(parsed.error); return NextResponse.json({ error: __z.message, fieldErrors: __z.fieldErrors }, { status: 422 }); }
  }
  const data = parsed.data;

  try {
    // If marking as default, clear any existing default first.
    if (data.isDefault) {
      await db.onboardingTemplate.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }
    const tpl = await db.onboardingTemplate.create({
      data: {
        name: data.name,
        description: data.description ?? "",
        scope: data.scope ?? "general",
        isActive: data.isActive ?? true,
        isDefault: !!data.isDefault,
        createdById: session.user.id,
        items: {
          create: (data.items ?? []).map((it, idx) => ({
            position: it.position ?? idx,
            title: it.title,
            description: it.description ?? "",
            taskType: it.taskType ?? "GENERAL",
            priority: it.priority ?? "MEDIUM",
            dueInDays: it.dueInDays,
          })),
        },
      },
      include: { items: { orderBy: { position: "asc" } } },
    });
    return NextResponse.json({ template: tpl }, { status: 201 });
  } catch (e) {
    const dup = uniqueViolationMessage(e, "name");
    if (dup) return NextResponse.json({ error: dup }, { status: 409 });
    throw e;
  }
}
