import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/admin-auth";
import { generateApiKey } from "@/lib/api-keys";
import { describeZodError } from "@/lib/zod-errors";

/**
 * Known scope keys for the public API. Treat as an allowlist; unknown
 * values are rejected so admins can't accidentally attach typo'd
 * scopes that downstream pattern-matchers later misinterpret. Use `*`
 * suffixes for wildcards (e.g. `crm:*`).
 */
const KNOWN_API_SCOPES = [
  "crm:read",
  "crm:write",
  "crm:*",
  "hr:read",
  "hr:write",
  "hr:*",
  "partners:read",
  "partners:write",
  "partners:*",
  "admin:audit",
  "*",
] as const;

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(z.enum(KNOWN_API_SCOPES)).min(1).max(KNOWN_API_SCOPES.length),
  // Reasonable upper bound: 10k req/sec is more than enough headroom
  // for an integration; anything higher is a typo. The previous
  // unbounded `int.nonnegative()` accepted Number.MAX_SAFE_INTEGER
  // which downstream throttlers treat as "no limit".
  rateLimit: z.number().int().nonnegative().max(10_000).optional().default(0),
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
    const __z = describeZodError(parsed.error);
    return NextResponse.json({ error: __z.message, fieldErrors: __z.fieldErrors }, { status: 422 });
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
