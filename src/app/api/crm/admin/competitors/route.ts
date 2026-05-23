import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { describeZodError } from "@/lib/zod-errors";
import { isAdminOnly } from "@/lib/crm/admin-gates";

/**
 * Tier-1 #27 — competitor master list.
 *   GET → list active competitors (open to any CRM user for picker).
 *   POST → create (ADMIN only).
 *   PATCH → activate/deactivate or rename (ADMIN only).
 *   DELETE → cascade-delete (ADMIN only). Refuses if any opp still
 *            references this competitor — admin must deactivate.
 */

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  notes: z.string().trim().max(2000).optional(),
});

const patchSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(120).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  active: z.boolean().optional(),
});

export async function GET() {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id || !session.user.modules?.includes("crm")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const competitors = await db.crmCompetitor.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ competitors });
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
  const c = await db.crmCompetitor.create({
    data: { name: parsed.data.name, notes: parsed.data.notes ?? null },
  });
  return NextResponse.json({ ok: true, competitor: c });
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
  const c = await db.crmCompetitor.update({ where: { id }, data: rest });
  return NextResponse.json({ ok: true, competitor: c });
}

export async function DELETE(req: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdminOnly(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const inUse = await db.crmOpportunityCompetitor.count({
    where: { competitorId: id },
  });
  if (inUse > 0) {
    return NextResponse.json(
      {
        error: `Can't delete: ${inUse} opportunit${inUse === 1 ? "y" : "ies"} still reference this competitor. Deactivate instead.`,
      },
      { status: 400 }
    );
  }
  await db.crmCompetitor.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
