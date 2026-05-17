import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { requireAuthSession } from "@/lib/admin-auth";
import { describeZodError } from "@/lib/zod-errors";

type FieldDef = {
  name: string;
  type: "text" | "number" | "date" | "boolean" | "select" | "reference";
  required?: boolean;
  options?: string[];
};

const dataSchema = z.record(z.string(), z.unknown());

/** Build a Zod validator from a dynamic field schema. */
function buildValidator(fields: FieldDef[]): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of fields) {
    let s: z.ZodTypeAny;
    switch (f.type) {
      case "text":
        s = z.string();
        break;
      case "number":
        s = z.number();
        break;
      case "date":
        s = z.string().datetime();
        break;
      case "boolean":
        s = z.boolean();
        break;
      case "select":
        s = f.options?.length ? z.enum(f.options as [string, ...string[]]) : z.string();
        break;
      case "reference":
        s = z.string().min(1);
        break;
    }
    shape[f.name] = f.required ? s : s.optional();
  }
  return z.object(shape);
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { error } = await requireAuthSession();
  if (error) return error;
  const { slug } = await params;
  const obj = await db.customObject.findUnique({ where: { slug } });
  if (!obj) return NextResponse.json({ error: "Object not found" }, { status: 404 });
  const records = await db.customRecord.findMany({
    where: { objectId: obj.id },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return NextResponse.json({ records });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { error } = await requireAuthSession();
  if (error) return error;
  const { slug } = await params;

  const obj = await db.customObject.findUnique({ where: { slug } });
  if (!obj) return NextResponse.json({ error: "Object not found" }, { status: 404 });

  const fields = (obj.fields ?? []) as FieldDef[];
  const validator = buildValidator(fields);

  const body = await req.json();
  const parsedData = dataSchema.safeParse(body.data ?? {});
  if (!parsedData.success) {
    { const __z = describeZodError(parsedData.error); return NextResponse.json({ error: __z.message, fieldErrors: __z.fieldErrors }, { status: 400 }); }
  }
  const dataCheck = validator.safeParse(parsedData.data);
  if (!dataCheck.success) {
    { const __z = describeZodError(dataCheck.error); return NextResponse.json({ error: __z.message, fieldErrors: __z.fieldErrors }, { status: 400 }); }
  }

  const record = await db.customRecord.create({
    data: {
      objectId: obj.id,
      data: parsedData.data as object,
      refs: (body.refs ?? {}) as object,
    },
  });
  return NextResponse.json({ record }, { status: 201 });
}
