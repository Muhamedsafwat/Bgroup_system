import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { describeZodError } from "@/lib/zod-errors";
import { isManagerOrAdmin } from "@/lib/crm/admin-gates";

/**
 * POST /api/crm/cold-leads/bulk-delete
 *
 * Hard-deletes a batch of cold leads in one call. Admin/manager only.
 * Refuses CONVERTED leads because they're linked to live opportunities —
 * the caller has to archive those instead (so the linked opp doesn't end up
 * with a dangling FK).
 *
 * Why a dedicated endpoint instead of looping on /[id] DELETE: large
 * selections (the admin import-mass-cleanup case) would burn ~N round trips
 * with N auth() resolutions, each grabbing a connection from the pool. A
 * single transaction here is one auth, one connection, two queries.
 */
const schema = z.object({
  leadIds: z.array(z.string().min(1)).min(1).max(5000),
});

export async function POST(request: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isManagerOrAdmin(session)) {
    return NextResponse.json(
      { error: "Only admin or sales manager can bulk-delete cold leads" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const { message, fieldErrors } = describeZodError(parsed.error);
    return NextResponse.json({ error: message, fieldErrors }, { status: 422 });
  }

  // Surface a clear message if any of the chosen rows are CONVERTED — the
  // caller usually doesn't know which sub-selection is the problem child.
  // Returning the names lets the UI tell the user "X, Y, Z are linked to
  // opportunities; uncheck them or archive instead".
  const blocked = await db.crmColdLead.findMany({
    where: { id: { in: parsed.data.leadIds }, convertedOpportunityId: { not: null } },
    select: { id: true, name: true },
    take: 10,
  });
  if (blocked.length > 0) {
    const names = blocked.map((b) => `"${b.name}"`).join(", ");
    return NextResponse.json(
      {
        error: `${blocked.length} of the selected leads are converted (linked to opportunities) and can't be deleted: ${names}. Archive them instead.`,
        blockedIds: blocked.map((b) => b.id),
      },
      { status: 409 }
    );
  }

  // Cascade-delete disposition history with the leads. The schema has
  // `onDelete: Cascade` so the disposition rows would go anyway, but
  // making it explicit documents the contract and means we can sanity-check
  // the count in the response.
  const [dispDeleted, leadDeleted] = await db.$transaction([
    db.crmColdLeadDisposition.deleteMany({ where: { coldLeadId: { in: parsed.data.leadIds } } }),
    db.crmColdLead.deleteMany({ where: { id: { in: parsed.data.leadIds } } }),
  ]);

  return NextResponse.json({
    ok: true,
    deleted: leadDeleted.count,
    dispositionsRemoved: dispDeleted.count,
  });
}
