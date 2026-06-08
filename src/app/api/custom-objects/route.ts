import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { requireAuthSession, requirePlatformAdmin } from "@/lib/admin-auth";
import { uniqueViolationMessage } from "@/lib/prisma-errors";
import { describeZodError } from "@/lib/zod-errors";

const fieldSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["text", "number", "date", "boolean", "select", "reference"]),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  /// For "reference" fields, the slug of the referenced object.
  refObject: z.string().optional(),
});

const createSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/).min(2).max(40),
  name: z.string().trim().min(1).max(80),
  description: z.string().max(400).optional().default(""),
  fields: z.array(fieldSchema).min(1),
  permissions: z.record(z.string(), z.array(z.string())).optional().default({}),
});

export async function GET() {
  const { error } = await requireAuthSession();
  if (error) return error;
  const objects = await db.customObject.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { records: true } } },
  });
  return NextResponse.json({ objects });
}

export async function POST(req: Request) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;
  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    { const __z = describeZodError(parsed.error); return NextResponse.json({ error: __z.message, fieldErrors: __z.fieldErrors }, { status: 422 }); }
  }
  try {
    const obj = await db.customObject.create({
      data: {
        slug: parsed.data.slug,
        name: parsed.data.name,
        description: parsed.data.description,
        fields: parsed.data.fields as object,
        permissions: parsed.data.permissions as object,
      },
    });
    return NextResponse.json({ object: obj }, { status: 201 });
  } catch (e) {
    const dup = uniqueViolationMessage(e, "slug");
    if (dup) return NextResponse.json({ error: dup }, { status: 409 });
    throw e;
  }
}
