import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { requireAuthSession, requirePlatformAdmin } from "@/lib/admin-auth";
import { describeZodError } from "@/lib/zod-errors";

const createSchema = z.object({
  scope: z.enum(["hr", "partners", "global"]),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).optional().default(""),
  body: z.string().min(1),
  variables: z.array(z.string()).optional().default([]),
});

export async function GET(req: Request) {
  const { error } = await requireAuthSession();
  if (error) return error;
  const url = new URL(req.url);
  const scope = url.searchParams.get("scope");
  const templates = await db.documentTemplate.findMany({
    where: scope ? { scope } : {},
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ templates });
}

export async function POST(req: Request) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;
  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    { const __z = describeZodError(parsed.error); return NextResponse.json({ error: __z.message, fieldErrors: __z.fieldErrors }, { status: 422 }); }
  }
  const template = await db.documentTemplate.create({ data: parsed.data });
  return NextResponse.json({ template }, { status: 201 });
}
