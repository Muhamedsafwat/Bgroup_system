import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { describeZodError } from "@/lib/zod-errors";
import { isAdminOnly } from "@/lib/crm/admin-gates";

/**
 * Tier-2 #31 — multiple named pipelines CRUD.
 * Gate: ADMIN (settings-class).
 */

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.string().trim().max(40).optional(),
  defaultForKind: z.boolean().optional(),
  displayOrder: z.number().int().min(0).max(99).optional(),
  description: z.string().trim().max(500).optional(),
});

const patchSchema = createSchema.partial().extend({ id: z.string().min(1), isActive: z.boolean().optional() });

export async function GET() {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id || !session.user.modules?.includes("crm")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const pipelines = await db.crmPipeline.findMany({
    where: { isActive: true },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
  });
  return NextResponse.json({ pipelines });
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
  const p = await db.crmPipeline.create({
    data: {
      name: parsed.data.name,
      kind: parsed.data.kind ?? "new-business",
      defaultForKind: parsed.data.defaultForKind ?? false,
      displayOrder: parsed.data.displayOrder ?? 0,
      description: parsed.data.description ?? null,
    },
  });
  return NextResponse.json({ ok: true, pipeline: p });
}

export async function PATCH(req: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdminOnly(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    const { message, fieldErrors } = describeZodError(parsed.error);
    return NextResponse.json({ error: message, fieldErrors }, { status: 422 });
  }
  const { id, ...rest } = parsed.data;
  const p = await db.crmPipeline.update({ where: { id }, data: rest });
  return NextResponse.json({ ok: true, pipeline: p });
}
