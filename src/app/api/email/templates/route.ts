import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";

const createSchema = z.object({
  scope: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  subject: z.string().trim().min(1).max(200),
  bodyHtml: z.string().min(1),
  variables: z.array(z.string()).optional().default([]),
});

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const scope = url.searchParams.get("scope");
  const templates = await db.emailTemplate.findMany({
    where: scope ? { scope } : {},
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ templates });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Only CRM admins / platform admins can create templates.
  const isCrmAdmin = session.user.crmRole === "ADMIN";
  const isPlatformAdmin =
    !!session.user.hrRoles?.includes("super_admin") ||
    (!!session.user.modules?.includes("partners") && !session.user.partnerId);
  if (!isCrmAdmin && !isPlatformAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const created = await db.emailTemplate.create({
    data: { ...parsed.data, createdById: session.user.id },
  });
  return NextResponse.json({ template: created }, { status: 201 });
}
