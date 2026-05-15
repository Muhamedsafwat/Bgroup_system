import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { scopeCompanyByRole } from "@/lib/crm/rbac";
import type { SessionUser } from "@/types";

/**
 * Lightweight contact lookup for in-modal pickers (e.g. the meeting booking
 * dialog). Returns id, full name, phone, and the linked company so the UI can
 * auto-populate the phone field when a contact is chosen.
 *
 * Results are scoped by the caller's CRM role — reps see contacts on companies
 * they're assigned to, managers/assistants see their entity, admins see all.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.user.modules?.includes("crm") || !session.user.crmProfileId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sessionUser: SessionUser = {
    id: session.user.crmProfileId,
    email: session.user.email!,
    fullName: session.user.name!,
    role: session.user.crmRole!,
    entityId: session.user.crmEntityId ?? null,
  };

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const companyScope = scopeCompanyByRole(sessionUser);

  const where = q
    ? {
        company: companyScope,
        OR: [
          { fullName: { contains: q, mode: "insensitive" as const } },
          { phone: { contains: q, mode: "insensitive" as const } },
          { email: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : { company: companyScope };

  const contacts = await db.crmContact.findMany({
    where,
    select: {
      id: true,
      fullName: true,
      phone: true,
      whatsapp: true,
      email: true,
      isPrimary: true,
      company: { select: { id: true, nameEn: true, nameAr: true } },
    },
    orderBy: [{ isPrimary: "desc" }, { fullName: "asc" }],
    take: 25,
  });

  return NextResponse.json({ contacts });
}
