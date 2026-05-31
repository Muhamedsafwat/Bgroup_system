import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { describeZodError } from "@/lib/zod-errors";
import type { Prisma } from "@/generated/prisma";

/**
 * GET /api/crm/saved-views?scope=crm:opportunities
 * POST /api/crm/saved-views
 *
 * Saved smart views — URL-shareable filtered views on a list resource.
 * One row per (owner, scope, name). Visible views = mine ∪ shared.
 *
 * `scope` is "<module>:<resource>" so the same table serves every list
 * page (`crm:opportunities`, `crm:cold-leads`, `crm:contacts`,
 * `crm:calls`, ...). `filtersJson` is the encoded query string the
 * list page already accepts. The list endpoint reads it as-is when
 * the view is selected — no schema-per-page coupling.
 */
const scopeRegex = /^[a-z]+:[a-z0-9-]+$/;

const createSchema = z.object({
  scope: z.string().regex(scopeRegex, "scope must be like crm:opportunities"),
  name: z.string().trim().min(1, "Name is required").max(80),
  filtersJson: z.record(z.string(), z.unknown()),
  isShared: z.boolean().optional(),
});

export async function GET(req: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const crmProfileId = session.user.crmProfileId;
  if (!crmProfileId) {
    return NextResponse.json({ error: "No CRM profile" }, { status: 403 });
  }
  const url = new URL(req.url);
  const scope = url.searchParams.get("scope");
  if (!scope || !scopeRegex.test(scope)) {
    return NextResponse.json(
      { error: "scope query param is required (e.g. ?scope=crm:opportunities)" },
      { status: 400 }
    );
  }
  // Mine ∪ everyone-else's-shared. Owner ordering puts personal views
  // first so the user's own list isn't buried behind shared ones.
  const views = await db.crmSavedView.findMany({
    where: {
      scope,
      OR: [{ ownerId: crmProfileId }, { isShared: true }],
    },
    orderBy: [{ ownerId: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      filtersJson: true,
      isShared: true,
      ownerId: true,
      owner: { select: { id: true, fullName: true } },
      createdAt: true,
      updatedAt: true,
    },
  });
  return NextResponse.json({
    views: views.map((v) => ({
      ...v,
      mine: v.ownerId === crmProfileId,
    })),
  });
}

export async function POST(req: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const crmProfileId = session.user.crmProfileId;
  if (!crmProfileId) {
    return NextResponse.json({ error: "No CRM profile" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    const { message, fieldErrors } = describeZodError(parsed.error);
    return NextResponse.json({ error: message, fieldErrors }, { status: 400 });
  }
  // Only MANAGER/ADMIN can mark a view as shared (avoids reps cluttering
  // everyone's dropdown with their personal filters).
  const wantsShared = parsed.data.isShared === true;
  const canShare =
    session.user.crmRole === "MANAGER" ||
    session.user.crmRole === "ADMIN" ||
    !!session.user.hrRoles?.includes("super_admin");
  if (wantsShared && !canShare) {
    return NextResponse.json(
      { error: "Only manager/admin can publish a shared view" },
      { status: 403 }
    );
  }
  const view = await db.crmSavedView.create({
    data: {
      ownerId: crmProfileId,
      scope: parsed.data.scope,
      name: parsed.data.name,
      // Zod validated this as a plain object; Prisma's Json column
      // accepts InputJsonValue which a plain object satisfies at
      // runtime, but the structural type check needs an assertion.
      filtersJson: parsed.data.filtersJson as Prisma.InputJsonValue,
      isShared: wantsShared,
    },
  });
  return NextResponse.json({ view }, { status: 201 });
}
