import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { CrmAttachmentKind } from "@/generated/prisma";
import { describeZodError } from "@/lib/zod-errors";
import { scopeOpportunityByRole } from "@/lib/crm/rbac";

/**
 * GET  /api/crm/opportunities/[id]/attachments  → list
 * POST /api/crm/opportunities/[id]/attachments  → upload
 *
 * Anyone with CRM access who can see the opportunity (owner, manager, admin)
 * can attach. Files are stored on local disk under
 * /public/uploads/crm/opportunities/<oppId>/<hash>-<name>. When the
 * opportunity later triggers a sequential workflow, every attachment is
 * forwarded to the first task's TaskAttachment list so the team picking
 * up the work has the same artifacts the sales rep was looking at.
 */

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const KINDS: CrmAttachmentKind[] = ["PROPOSAL", "CONTRACT", "INVOICE", "OTHER"] as never;

// MIME allowlist: documents + presentations + images that a sales rep
// legitimately attaches to an opp. Outside this set is rejected to
// prevent stored XSS (HTML/SVG with embedded script) and to keep the
// served `Content-Type` reliable.
const ALLOWED_MIME_TYPES = new Set<string>([
  // Documents
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
  // Images
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  // Archives
  "application/zip",
  "application/x-zip-compressed",
]);

const uploadSchema = z.object({
  filename: z.string().trim().min(1).max(200),
  mimeType: z.string().trim().min(1).max(120),
  sizeBytes: z.number().int().nonnegative().max(MAX_BYTES),
  kind: z.nativeEnum(CrmAttachmentKind).optional().default("OTHER"),
  contentBase64: z.string().min(1),
});

// Use the canonical scope helper so attachments visibility matches
// the rest of the opp surface. The previous inline check excluded
// ASSISTANT (who legitimately sees opps via a touched meeting) and
// ACCOUNT_MGR (delivery owner of WON deals).
async function canAccessOpp(opportunityId: string, session: Session): Promise<boolean> {
  if (!session.user.crmProfileId) return false;
  const sUser = {
    id: session.user.crmProfileId,
    role: session.user.crmRole!,
    email: session.user.email!,
    fullName: session.user.name ?? "",
    entityId: session.user.crmEntityId ?? null,
  };
  const opp = await db.crmOpportunity.findFirst({
    where: { id: opportunityId, ...scopeOpportunityByRole(sUser), deletedAt: null },
    select: { id: true },
  });
  return !!opp;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessOpp(id, session))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const attachments = await db.crmAttachment.findMany({
    where: { opportunityId: id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ attachments });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessOpp(id, session))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await req.json();
  const parsed = uploadSchema.safeParse(body);
  if (!parsed.success) {
    { const __z = describeZodError(parsed.error); return NextResponse.json({ error: __z.message, fieldErrors: __z.fieldErrors }, { status: 422 }); }
  }
  const { filename, mimeType, sizeBytes, kind, contentBase64 } = parsed.data;

  // MIME allowlist. Free-form mimeType lets a caller upload an HTML or
  // SVG file and have it served back to other reps with the supplied
  // Content-Type — stored XSS. Reject anything not on the allowlist.
  if (!ALLOWED_MIME_TYPES.has(mimeType.toLowerCase())) {
    return NextResponse.json(
      {
        error: `File type "${mimeType}" isn't accepted. Allowed: PDF, Office docs, plain text, images, and zip.`,
      },
      { status: 415 },
    );
  }

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

  const safeName = filename.replace(/[\\/]/g, "_").slice(0, 200);
  const hash = crypto.randomBytes(8).toString("hex");
  const relDir = `uploads/crm/opportunities/${id}`;
  const relPath = `${relDir}/${hash}-${safeName}`;
  const absDir = path.join(process.cwd(), "public", relDir);
  const absPath = path.join(process.cwd(), "public", relPath);
  await fs.mkdir(absDir, { recursive: true });
  await fs.writeFile(absPath, buf);

  const created = await db.crmAttachment.create({
    data: {
      opportunityId: id,
      filename: safeName,
      mimeType,
      sizeBytes,
      kind,
      uploadedById: session.user.crmProfileId ?? session.user.id,
      url: `/${relPath}`,
    },
  });

  return NextResponse.json({ attachment: created }, { status: 201 });
}
