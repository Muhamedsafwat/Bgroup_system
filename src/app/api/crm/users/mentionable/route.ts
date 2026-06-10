import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * GET /api/crm/users/mentionable?q=foo
 *
 * Lightweight picker for the @-mention dropdown inside opp comments.
 * Returns active CRM user profiles whose fullName / email matches
 * `q` (top 8). Visible to any CRM user — you can mention anyone in
 * the CRM, not just your direct line of reporting (the comment is
 * tied to the opp, which is already scope-gated).
 */
export async function GET(req: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id || !session.user.modules?.includes("crm")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  // Bound the query length defensively — a multi-MB `q` would still
  // be evaluated by Postgres ILIKE without crashing, but truncating
  // here keeps the planner happy and rejects accidental clipboard
  // dumps from typing handlers.
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);

  // audit v12 MEDIUM (MED-13) ultra: scope the picker to the caller's entity
  // so it only surfaces profiles the POST /comments handler will accept.
  // The POST handler validates mentionIds against opp.entityId; surfacing
  // cross-entity profiles here causes silent mention drops. ADMIN /
  // super_admin have no entityId (null) and remain unscoped — their opps
  // carry a concrete entityId that their own profiles satisfy by definition.
  const callerEntityId =
    (session.user as { crmEntityId?: string | null }).crmEntityId ?? null;

  // audit v12 MEDIUM (MED-14) recheck-hardening: when the caller is
  // scoped to an entity, ALSO include cross-entity mgrs/admins (entityId
  // null) so an entity-scoped rep can still @-mention leadership in a
  // shared comment. Without this, an admin sitting outside any entity
  // would never appear in any rep's picker, blocking escalation
  // workflows.
  const entityClause = callerEntityId
    ? { OR: [{ entityId: callerEntityId }, { entityId: null }] }
    : {};

  const users = await db.crmUserProfile.findMany({
    where: {
      active: true,
      ...entityClause,
      ...(q
        ? {
            OR: [
              { fullName: { contains: q, mode: "insensitive" } },
              { user: { email: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      fullName: true,
      avatarUrl: true,
      role: true,
      user: { select: { email: true } },
    },
    orderBy: [{ role: "asc" }, { fullName: "asc" }],
    take: 8,
  });

  return NextResponse.json({
    users: users.map((u) => ({
      id: u.id,
      fullName: u.fullName,
      email: u.user.email,
      avatarUrl: u.avatarUrl,
      role: u.role,
    })),
  });
}
