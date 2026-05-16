import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * POST /api/account/upload-photo
 *
 * Self-service profile photo for ANY signed-in user (HR employee, partner,
 * platform admin — anyone with a User row). The image is stored inline as a
 * base64 data URI on `User.image` so we don't need a filesystem or cloud
 * bucket plumbed in. In production this should be swapped for S3/Cloudinary,
 * but the API surface stays the same — only the stored value flips from a
 * `data:` URI to an `https://` URL.
 *
 * 2 MB cap so a single user can't bloat the row to megabytes.
 */
const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const form = await request.formData();
  const file = form.get("photo");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No photo file in the request." }, { status: 400 });
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { error: `Unsupported image type "${file.type}". Use JPG, PNG, WebP, or GIF.` },
      { status: 415 }
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `Image is too large (${Math.round(file.size / 1024)} KB). Max is 2 MB.` },
      { status: 413 }
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const dataUri = `data:${file.type};base64,${buf.toString("base64")}`;

  await db.user.update({ where: { id: session.user.id }, data: { image: dataUri } });

  // Best-effort: also update the linked HrEmployee.photo so the HR profile page
  // and the photo on the welcome banner stay in sync without a second upload.
  const emp = await db.hrEmployee.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });
  if (emp) {
    await db.hrEmployee.update({ where: { id: emp.id }, data: { photo: dataUri } });
  }

  return NextResponse.json({ ok: true, image: dataUri });
}
