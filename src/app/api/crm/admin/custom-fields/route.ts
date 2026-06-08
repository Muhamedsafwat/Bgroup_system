import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { describeZodError } from "@/lib/zod-errors";
import type { Prisma } from "@/generated/prisma";
import { isAdminOnly } from "@/lib/crm/admin-gates";

/**
 * Tier-2 #37 — custom-field meta-schema CRUD.
 *
 * Each field def has a `kind` (text/number/picklist/date/boolean/lookup)
 * and an optional `definition` JSON with kind-specific config. Values
 * live in the owning entity's `customValuesJson` column.
 *
 * Gate: ADMIN.
 */

/// Outer-size bound on the `definition` JSON blob — keeps an admin
/// from storing megabytes of options that the entity-render path
/// reads on every form load. 32 KB is plenty for the picklist /
/// lookup configs we actually need.
const MAX_DEFINITION_BYTES = 32_000;

const createSchema = z.object({
  objectType: z.enum(["opportunity", "contact", "coldLead", "company"]),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{0,38}$/, "slug must be snake_case starting with a letter")
    .max(40),
  label: z.string().trim().min(1).max(80),
  kind: z.enum(["text", "number", "picklist", "date", "boolean", "lookup"]),
  required: z.boolean().optional(),
  definition: z
    .record(z.string(), z.unknown())
    .optional()
    .refine(
      (v) => v === undefined || JSON.stringify(v).length <= MAX_DEFINITION_BYTES,
      `definition must serialise to <= ${MAX_DEFINITION_BYTES} bytes`,
    ),
  displayOrder: z.number().int().min(0).max(99).optional(),
});

export async function GET(req: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id || !session.user.modules?.includes("crm")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const url = new URL(req.url);
  const objectType = url.searchParams.get("objectType");
  const defs = await db.crmCustomFieldDef.findMany({
    where: {
      active: true,
      ...(objectType ? { objectType } : {}),
    },
    orderBy: [{ objectType: "asc" }, { displayOrder: "asc" }, { slug: "asc" }],
  });
  return NextResponse.json({ defs });
}

export async function POST(req: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdminOnly(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    const { message, fieldErrors } = describeZodError(parsed.error);
    return NextResponse.json({ error: message, fieldErrors }, { status: 422 });
  }
  const d = await db.crmCustomFieldDef.create({
    data: {
      objectType: parsed.data.objectType,
      slug: parsed.data.slug,
      label: parsed.data.label,
      kind: parsed.data.kind,
      required: parsed.data.required ?? false,
      ...(parsed.data.definition
        ? { definition: parsed.data.definition as Prisma.InputJsonValue }
        : {}),
      displayOrder: parsed.data.displayOrder ?? 0,
    },
  });
  return NextResponse.json({ ok: true, def: d });
}

export async function DELETE(req: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdminOnly(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  // Soft-delete via active=false so existing customValuesJson stays
  // readable; hard-delete would orphan the JSON keys silently.
  await db.crmCustomFieldDef.update({ where: { id }, data: { active: false } });
  return NextResponse.json({ ok: true });
}
