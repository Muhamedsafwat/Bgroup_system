import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { randomBytes } from "node:crypto";
import { describeZodError } from "@/lib/zod-errors";

const lineSchema = z.object({
  productId: z.string().optional(),
  description: z.string().trim().min(1).max(500),
  qty: z.number().positive(),
  unitPrice: z.number().nonnegative(),
});

const createSchema = z.object({
  opportunityId: z.string().optional(),
  currency: z.string().length(3).optional().default("EGP"),
  taxRatePct: z.number().min(0).max(100).optional().default(0),
  discountPct: z.number().min(0).max(100).optional().default(0),
  validUntil: z.string().datetime().optional(),
  lines: z.array(lineSchema).min(1),
});

function generateQuoteNumber(): string {
  const year = new Date().getFullYear();
  const suffix = randomBytes(3).toString("hex").toUpperCase();
  return `Q-${year}-${suffix}`;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id || !session.user.modules?.includes("crm")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const quotes = await db.quote.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { lines: true },
  });
  return NextResponse.json({ quotes });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.modules?.includes("crm")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    { const __z = describeZodError(parsed.error); return NextResponse.json({ error: __z.message, fieldErrors: __z.fieldErrors }, { status: 400 }); }
  }

  const quote = await db.quote.create({
    data: {
      number: generateQuoteNumber(),
      opportunityId: parsed.data.opportunityId,
      currency: parsed.data.currency,
      taxRatePct: parsed.data.taxRatePct,
      discountPct: parsed.data.discountPct,
      validUntil: parsed.data.validUntil ? new Date(parsed.data.validUntil) : undefined,
      lines: {
        create: parsed.data.lines.map((l) => ({
          productId: l.productId,
          description: l.description,
          qty: l.qty,
          unitPrice: l.unitPrice,
        })),
      },
    },
    include: { lines: true },
  });
  return NextResponse.json({ quote }, { status: 201 });
}
