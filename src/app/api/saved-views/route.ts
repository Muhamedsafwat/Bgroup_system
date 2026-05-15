import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";

const createSchema = z.object({
  scope: z.string().min(1),
  name: z.string().trim().min(1).max(60),
  filters: z.unknown(),
  sort: z.unknown().optional(),
  columns: z.unknown().optional(),
  isShared: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const scope = url.searchParams.get("scope");
  if (!scope) {
    return NextResponse.json({ error: "scope is required" }, { status: 400 });
  }

  const views = await db.savedView.findMany({
    where: {
      scope,
      OR: [{ userId: session.user.id }, { isShared: true }],
    },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
  return NextResponse.json({ views });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  // Only allow sharing if user is admin in any module — defensive.
  const isAdmin =
    session.user.crmRole === "ADMIN" ||
    session.user.hrRoles?.includes("super_admin") ||
    (session.user.modules?.includes("partners") && !session.user.partnerId);

  const view = await db.savedView.create({
    data: {
      userId: session.user.id,
      scope: parsed.data.scope,
      name: parsed.data.name,
      filters: parsed.data.filters as object,
      sort: parsed.data.sort as object | undefined,
      columns: parsed.data.columns as object | undefined,
      isShared: !!parsed.data.isShared && !!isAdmin,
      isDefault: !!parsed.data.isDefault,
    },
  });

  return NextResponse.json({ view }, { status: 201 });
}
