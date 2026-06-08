import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";
import { describeZodError } from "@/lib/zod-errors";

const createSchema = z.object({
  scope: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(60),
  filters: z.unknown(),
  sort: z.unknown().optional(),
  columns: z.unknown().optional(),
  isShared: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

/**
 * Map a saved-view `scope` string to the module it belongs to. Used to
 * gate access so a CRM-only user can't list / create HR saved views.
 * Returns null if the scope is unknown — those are rejected as 400.
 */
function moduleForScope(scope: string): "hr" | "crm" | "partners" | null {
  if (
    scope.startsWith("hr-") ||
    scope === "hr" ||
    scope.startsWith("hr:") ||
    scope.startsWith("hr/")
  ) {
    return "hr";
  }
  if (
    scope.startsWith("crm-") ||
    scope === "crm" ||
    scope.startsWith("crm:") ||
    scope.startsWith("crm/")
  ) {
    return "crm";
  }
  if (
    scope.startsWith("partners-") ||
    scope === "partners" ||
    scope.startsWith("partners:") ||
    scope.startsWith("partners/")
  ) {
    return "partners";
  }
  return null;
}

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

  // Per-module gate: a user without the relevant module shouldn't be
  // able to read shared saved-views from another module. The previous
  // version returned every shared row for any `scope` value, leaking
  // HR filter sets to CRM-only users (and vice versa).
  const module = moduleForScope(scope);
  if (!module || !session.user.modules?.includes(module)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
    const __z = describeZodError(parsed.error);
    return NextResponse.json({ error: __z.message, fieldErrors: __z.fieldErrors }, { status: 422 });
  }

  // Per-module gate: don't let a user create a saved view in a module
  // they don't have access to (e.g. a CRM-only ADMIN creating a shared
  // HR view that pollutes every HR user's view menu).
  const module = moduleForScope(parsed.data.scope);
  if (!module || !session.user.modules?.includes(module)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
