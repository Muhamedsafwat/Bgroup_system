import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/admin-auth";
import { generateApiKey } from "@/lib/api-keys";
import { describeZodError } from "@/lib/zod-errors";

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(z.string()).min(1),
  rateLimit: z.number().int().nonnegative().optional().default(0),
});

export async function GET() {
  const { error } = await requirePlatformAdmin();
  if (error) return error;
  const keys = await db.apiKey.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      prefix: true,
      scopes: true,
      rateLimit: true,
      isActive: true,
      lastUsedAt: true,
      createdAt: true,
    },
  });
  return NextResponse.json({ keys });
}

export async function POST(req: Request) {
  const { session, error } = await requirePlatformAdmin();
  if (error) return error;
  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    { const __z = describeZodError(parsed.error); return NextResponse.json({ error: __z.message, fieldErrors: __z.fieldErrors }, { status: 400 }); }
  }
  const { plaintext, hash, prefix } = generateApiKey();
  const key = await db.apiKey.create({
    data: {
      ownerId: session.user.id!,
      hash,
      prefix,
      name: parsed.data.name,
      scopes: parsed.data.scopes,
      rateLimit: parsed.data.rateLimit,
    },
  });
  // The plaintext is returned exactly once. The client must save it now.
  return NextResponse.json(
    { key: { id: key.id, name: key.name, prefix: key.prefix }, plaintext },
    { status: 201 }
  );
}
