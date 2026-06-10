import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";
import { describeZodError } from "@/lib/zod-errors";

// audit v12 HIGH (HIGH-36) recheck: per-field 8 KB cap mirrors the boundedJson
// guard in route.ts (POST). Previously missing from PATCH — added here.
const boundedJson = z
  .unknown()
  .refine((v) => JSON.stringify(v ?? {}).length <= 8192, {
    message: "Field is too large (max 8 KB).",
  });

const patchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  filters: boundedJson.optional(),
  sort: boundedJson.optional(),
  columns: boundedJson.optional(),
  isShared: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const view = await db.savedView.findUnique({ where: { id } });
  if (!view || view.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // audit v12 HIGH (HIGH-36) recheck: 32 KB total-body ceiling guard.
  const rawText = await req.text();
  if (rawText.length > 32768) {
    return NextResponse.json({ error: "Request body too large (max 32 KB)." }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(rawText);
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    { const __z = describeZodError(parsed.error); return NextResponse.json({ error: __z.message, fieldErrors: __z.fieldErrors }, { status: 422 }); }
  }

  const updated = await db.savedView.update({
    where: { id },
    data: {
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
      ...(parsed.data.filters !== undefined && {
        filters: parsed.data.filters as object,
      }),
      ...(parsed.data.sort !== undefined && {
        sort: parsed.data.sort as object,
      }),
      ...(parsed.data.columns !== undefined && {
        columns: parsed.data.columns as object,
      }),
      ...(parsed.data.isShared !== undefined && { isShared: parsed.data.isShared }),
      ...(parsed.data.isDefault !== undefined && { isDefault: parsed.data.isDefault }),
    },
  });
  return NextResponse.json({ view: updated });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const r = await db.savedView.deleteMany({
    where: { id, userId: session.user.id },
  });
  if (r.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
