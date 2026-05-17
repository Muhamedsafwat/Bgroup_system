import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";
import { describeZodError } from "@/lib/zod-errors";

const createSchema = z.object({
  module: z.enum(["hr", "crm", "partners", "global"]),
  name: z.string().trim().min(1).max(80),
  description: z.string().max(400).optional().default(""),
  definition: z.object({
    source: z.string().min(1),
    filters: z.record(z.string(), z.unknown()).optional().default({}),
    groupBy: z.array(z.string()).optional().default([]),
    metric: z.string().optional().default("count"),
    chart: z.enum(["bar", "line", "pie", "table"]).optional().default("table"),
  }),
  isShared: z.boolean().optional().default(false),
});

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const moduleFilter = url.searchParams.get("module");

  const reports = await db.savedReport.findMany({
    where: {
      AND: [
        moduleFilter ? { module: moduleFilter } : {},
        { OR: [{ ownerId: session.user.id }, { isShared: true }] },
      ],
    },
    orderBy: { updatedAt: "desc" },
  });
  return NextResponse.json({ reports });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    { const __z = describeZodError(parsed.error); return NextResponse.json({ error: __z.message, fieldErrors: __z.fieldErrors }, { status: 400 }); }
  }

  const created = await db.savedReport.create({
    data: {
      ownerId: session.user.id,
      module: parsed.data.module,
      name: parsed.data.name,
      description: parsed.data.description,
      definition: JSON.parse(JSON.stringify(parsed.data.definition)),
      isShared: parsed.data.isShared,
    },
  });
  return NextResponse.json({ report: created }, { status: 201 });
}
