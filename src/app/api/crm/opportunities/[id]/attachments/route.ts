import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { CrmAttachmentKind } from "@/generated/prisma";

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

const uploadSchema = z.object({
  filename: z.string().trim().min(1).max(200),
  mimeType: z.string().trim().min(1).max(120),
  sizeBytes: z.number().int().nonnegative().max(MAX_BYTES),
  kind: z.nativeEnum(CrmAttachmentKind).optional().default("OTHER"),
  contentBase64: z.string().min(1),
});

async function canAccessOpp(opportunityId: string, session: Session): Promise<boolean> {
  if (session.user.hrRoles?.includes("super_admin")) return true;
  if (
    session.user.crmRole === "MANAGER" ||
    session.user.crmRole === "ADMIN"
  )
    return true;
  if (!session.user.crmProfileId) return false;
  const opp = await db.crmOpportunity.findFirst({
    where: { id: opportunityId, ownerId: session.user.crmProfileId },
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
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { filename, mimeType, sizeBytes, kind, contentBase64 } = parsed.data;

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
