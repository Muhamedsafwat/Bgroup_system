import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { describeZodError } from "@/lib/zod-errors";

const stepSchema = z.object({
  position: z.number().int().positive(),
  kind: z.enum(["EMAIL", "CALL_TASK", "LINKEDIN_TASK", "WAIT"]),
  dayOffset: z.number().int().nonnegative(),
  emailTemplateId: z.string().optional(),
  taskTitle: z.string().optional(),
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).optional().default(""),
  steps: z.array(stepSchema).min(1),
});

async function requireCrm() {
  const session = await auth();
  if (!session?.user?.id || !session.user.modules?.includes("crm")) {
    return null;
  }
  return session;
}

export async function GET() {
  const session = await requireCrm();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const cadences = await db.cadence.findMany({
    orderBy: { createdAt: "desc" },
    include: { steps: { orderBy: { position: "asc" } } },
  });
  return NextResponse.json({ cadences });
}

export async function POST(req: Request) {
  const session = await requireCrm();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    { const __z = describeZodError(parsed.error); return NextResponse.json({ error: __z.message, fieldErrors: __z.fieldErrors }, { status: 400 }); }
  }
  const cadence = await db.cadence.create({
    data: {
      name: parsed.data.name,
      description: parsed.data.description,
      steps: { create: parsed.data.steps },
    },
    include: { steps: { orderBy: { position: "asc" } } },
  });
  return NextResponse.json({ cadence }, { status: 201 });
}
