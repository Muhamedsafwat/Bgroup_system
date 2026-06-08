import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { requireAuthSession } from "@/lib/admin-auth";
import { describeZodError } from "@/lib/zod-errors";

const createSchema = z.object({
  templateId: z.string().min(1),
  variables: z.record(z.string(), z.string()),
  attachedTo: z.string().optional(),
});

/**
 * Render a document template with variable substitution. Mustache-style:
 *   "Hello {{employee.fullName}}" + { "employee.fullName": "Sara" }
 *   → "Hello Sara"
 */
function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, key) => vars[key.trim()] ?? "");
}

export async function POST(req: Request) {
  const { error } = await requireAuthSession();
  if (error) return error;

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    { const __z = describeZodError(parsed.error); return NextResponse.json({ error: __z.message, fieldErrors: __z.fieldErrors }, { status: 422 }); }
  }

  const template = await db.documentTemplate.findUnique({
    where: { id: parsed.data.templateId },
  });
  if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });

  const rendered = render(template.body, parsed.data.variables);
  const instance = await db.documentInstance.create({
    data: {
      templateId: template.id,
      rendered,
      variables: parsed.data.variables,
      attachedTo: parsed.data.attachedTo,
      status: "DRAFT",
    },
  });
  return NextResponse.json({ instance }, { status: 201 });
}
