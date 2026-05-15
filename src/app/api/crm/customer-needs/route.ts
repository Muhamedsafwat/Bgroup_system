import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * GET /api/crm/customer-needs
 *
 * Read-only list of active customer-need labels, ordered by sortOrder.
 * Used by the meeting booking form and opportunity tagging UI. Admins
 * manage the underlying list at /crm/admin/customer-needs.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const needs = await db.crmCustomerNeed.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: "asc" }, { labelEn: "asc" }],
    select: { id: true, labelEn: true, labelAr: true, category: true },
  });
  return NextResponse.json({ needs });
}
