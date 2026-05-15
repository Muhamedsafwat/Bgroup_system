import { NextResponse } from "next/server";
import { db as prisma } from "@/lib/db";
import { requireAuth } from "@/lib/hr/auth-utils";
import { isHROrAdmin, isSuperAdmin } from "@/lib/hr/permissions";
import { serializeEmployeeDetail } from "@/lib/hr/employee-serializer";

/**
 * POST /api/hr/employees/[id]/upload-photo
 *
 * Accepts a multipart/form-data body with a single `photo` field (image).
 * The image is stored inline as a base64 data URI on `HrEmployee.photo` so
 * we don't need a filesystem or cloud bucket plumbed in for dev. For
 * production scale this should be swapped to S3 / Cloudinary, but the API
 * shape stays the same — only the stored value changes from a `data:` URI
 * to an `https://` URL.
 *
 * Who can upload:
 *   - The employee themselves (self-service from /hr/employee/profile)
 *   - HR / super_admin (managing on behalf of someone)
 *
 * 2 MB cap on raw bytes — anything larger gets a 413 with a clear message
 * instead of silently truncating or letting the DB row balloon.
 */
const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authUser = await requireAuth(request);
    const { id } = await params;

    const target = await prisma.hrEmployee.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });
    if (!target) {
      return NextResponse.json({ detail: "Employee not found." }, { status: 404 });
    }

    const isSelf = target.userId === authUser.id;
    const isHr = isSuperAdmin(authUser) || isHROrAdmin(authUser);
    if (!isSelf && !isHr) {
      return NextResponse.json({ detail: "Not allowed." }, { status: 403 });
    }

    const form = await request.formData();
    const file = form.get("photo");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { detail: "No photo file in the request." },
        { status: 400 }
      );
    }
    if (!ALLOWED_MIME.has(file.type)) {
      return NextResponse.json(
        { detail: `Unsupported image type "${file.type}". Use JPG, PNG, WebP, or GIF.` },
        { status: 415 }
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { detail: `Image is too large (${Math.round(file.size / 1024)} KB). Max is 2 MB.` },
        { status: 413 }
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const dataUri = `data:${file.type};base64,${buf.toString("base64")}`;

    const updated = await prisma.hrEmployee.update({
      where: { id },
      data: { photo: dataUri },
      include: {
        company: true,
        department: true,
        shift: true,
        directManager: true,
        user: true,
      },
    });

    return NextResponse.json(serializeEmployeeDetail(updated));
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("[upload-photo] failed", error);
    return NextResponse.json({ detail: "Server error." }, { status: 500 });
  }
}
