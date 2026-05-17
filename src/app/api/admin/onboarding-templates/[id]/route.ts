import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { TaskPriority, TaskType } from "@/generated/prisma";
import { describeZodError } from "@/lib/zod-errors";

const itemSchema = z.object({
  position: z.number().int().min(0).max(200).optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().default(""),
  taskType: z.nativeEnum(TaskType).optional(),
  priority: z.nativeEnum(TaskPriority).optional(),
  dueInDays: z.number().int().min(0).max(365).default(0),
});

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(1000).optional(),
  scope: z.string().trim().max(60).optional(),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  /** Replaces the entire items list when supplied. */
  items: z.array(itemSchema).max(100).optional(),
});

function isHrAdmin(session: Session) {
  return (
    !!session.user.hrRoles?.includes("super_admin") ||
    !!session.user.hrRoles?.includes("hr_manager")
  );
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tpl = await db.onboardingTemplate.findUnique({
    where: { id },
    include: { items: { orderBy: { position: "asc" } } },
  });
  if (!tpl) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ template: tpl });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isHrAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    { const __z = describeZodError(parsed.error); return NextResponse.json({ error: __z.message, fieldErrors: __z.fieldErrors }, { status: 400 }); }
  }
  const data = parsed.data;

  const existing = await db.onboardingTemplate.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (data.isDefault) {
    await db.onboardingTemplate.updateMany({
      where: { isDefault: true, id: { not: id } },
      data: { isDefault: false },
    });
  }

  const tpl = await db.$transaction(async (tx) => {
    const updated = await tx.onboardingTemplate.update({
      where: { id },
      data: {
        name: data.name,
        description: data.description,
        scope: data.scope,
        isActive: data.isActive,
        isDefault: data.isDefault,
      },
    });
    if (data.items) {
      await tx.onboardingTemplateItem.deleteMany({ where: { templateId: id } });
      await tx.onboardingTemplateItem.createMany({
        data: data.items.map((it, idx) => ({
          templateId: id,
          position: it.position ?? idx,
          title: it.title,
          description: it.description ?? "",
          taskType: it.taskType ?? "GENERAL",
          priority: it.priority ?? "MEDIUM",
          dueInDays: it.dueInDays,
        })),
      });
    }
    return updated;
  });

  const full = await db.onboardingTemplate.findUnique({
    where: { id: tpl.id },
    include: { items: { orderBy: { position: "asc" } } },
  });
  return NextResponse.json({ template: full });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isHrAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const existing = await db.onboardingTemplate.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.onboardingTemplate.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
