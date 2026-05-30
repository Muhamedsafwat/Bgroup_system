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
  const q = (url.searchParams.get("q") ?? "").trim();

  const users = await db.crmUserProfile.findMany({
    where: {
      active: true,
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
