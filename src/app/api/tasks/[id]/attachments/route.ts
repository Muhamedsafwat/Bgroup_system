import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { describeZodError } from "@/lib/zod-errors";

/**
 * POST /api/tasks/[id]/attachments
 *
 * Anyone with task access (creator, assignee, watcher, platform admin) can
 * attach a file. Attachments persist for the lifetime of the task, so when a
 * sequential workflow advances to the next step, the next assignee sees every
 * artifact uploaded by upstream steps. That cascade is by design — the spec
 * says comments + attachments are how workflow participants hand work off.
 *
 * MVP storage: local disk under /public/uploads/tasks/<taskId>/<hash>-<name>.
 * Swap to S3/GCS later by changing this handler only.
 */

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

function isPlatformAdmin(session: Session) {
  return (
    !!session.user.hrRoles?.includes("super_admin") ||
    (!!session.user.modules?.includes("partners") && !session.user.partnerId)
  );
}

async function canAccessTask(taskId: string, userId: string, admin: boolean) {
  if (admin) {
    const t = await db.task.findUnique({ where: { id: taskId }, select: { id: true } });
    return !!t;
  }
  const t = await db.task.findFirst({
    where: {
      id: taskId,
      OR: [
        { assigneeId: userId },
        { createdById: userId },
        { watchers: { some: { userId } } },
      ],
    },
    select: { id: true },
  });
  return !!t;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessTask(id, session.user.id, isPlatformAdmin(session)))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const attachments = await db.taskAttachment.findMany({
    where: { taskId: id },
    orderBy: { createdAt: "desc" },
    include: {
      uploadedBy: { select: { id: true, name: true, email: true, image: true } },
    },
  });
  return NextResponse.json({ attachments });
}

const metaSchema = z.object({
  filename: z.string().trim().min(1).max(200),
  mimeType: z.string().trim().min(1).max(120),
  sizeBytes: z.number().int().nonnegative().max(MAX_BYTES),
  /// Base64-encoded body. Caller is responsible for encoding the file client-side.
  // audit v12 MEDIUM (MED-60): cap base64 length before any decoding to prevent memory exhaustion
  contentBase64: z.string().min(1).max(Math.ceil(MAX_BYTES * (4 / 3)) + 4),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessTask(id, session.user.id, isPlatformAdmin(session)))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json();
  const parsed = metaSchema.safeParse(body);
  if (!parsed.success) {
    { const __z = describeZodError(parsed.error); return NextResponse.json({ error: __z.message, fieldErrors: __z.fieldErrors }, { status: 422 }); }
  }
  const { filename, mimeType, sizeBytes, contentBase64 } = parsed.data;

  // Reject anything that doesn't look like clean base64 of the claimed size.
  let buf: Buffer;
  try {
    buf = Buffer.from(contentBase64, "base64");
  } catch {
    return NextResponse.json({ error: "Invalid base64 payload" }, { status: 400 });
  }
  if (buf.byteLength !== sizeBytes) {
    return NextResponse.json(
      { error: `sizeBytes (${sizeBytes}) mismatches decoded length (${buf.byteLength})` },
      { status: 400 }
    );
  }

  // Sanitize filename: keep extension but strip path separators.
  const safeName = filename.replace(/[\\/]/g, "_").slice(0, 200);
  const hash = crypto.randomBytes(8).toString("hex");
  const relDir = `uploads/tasks/${id}`;
  const relPath = `${relDir}/${hash}-${safeName}`;
  const absDir = path.join(process.cwd(), "public", relDir);
  const absPath = path.join(process.cwd(), "public", relPath);
  await fs.mkdir(absDir, { recursive: true });
  await fs.writeFile(absPath, buf);

  const created = await db.taskAttachment.create({
    data: {
      taskId: id,
      uploadedById: session.user.id,
      filename: safeName,
      mimeType,
      sizeBytes,
      url: `/${relPath}`,
    },
    include: {
      uploadedBy: { select: { id: true, name: true, email: true, image: true } },
    },
  });

  // System comment so the cascade is visible alongside the audit trail.
  await db.taskComment.create({
    data: {
      taskId: id,
      authorId: session.user.id,
      body: `📎 Attached ${safeName} (${(sizeBytes / 1024).toFixed(1)} KB)`,
      isSystem: true,
    },
  });

  return NextResponse.json({ attachment: created }, { status: 201 });
}
