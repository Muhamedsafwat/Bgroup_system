import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { requireAuthSession, requirePlatformAdmin } from "@/lib/admin-auth";
import { uniqueViolationMessage } from "@/lib/prisma-errors";
import { describeZodError } from "@/lib/zod-errors";

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  minRevenue90d: z.number().nonnegative(),
  commissionRate: z.number().min(0).max(100),
  // audit v12 LOW (LOW-10): cap per-string length and array size to prevent unbounded jsonb payloads
  perks: z.array(z.string().max(200)).max(50).optional().default([]),
  rank: z.number().int().optional().default(0),
});

export async function GET() {
  const { error } = await requireAuthSession();
  if (error) return error;
  const tiers = await db.partnerTier.findMany({
    orderBy: [{ rank: "asc" }, { minRevenue90d: "asc" }],
  });
  return NextResponse.json({ tiers });
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
    const tier = await db.partnerTier.create({
      data: {
        name: parsed.data.name,
        minRevenue90d: parsed.data.minRevenue90d,
        commissionRate: parsed.data.commissionRate,
        perks: parsed.data.perks as object,
        rank: parsed.data.rank,
      },
    });
    return NextResponse.json({ tier }, { status: 201 });
  } catch (e) {
    const dup = uniqueViolationMessage(e, "name");
    if (dup) return NextResponse.json({ error: dup }, { status: 409 });
    throw e;
  }
}
