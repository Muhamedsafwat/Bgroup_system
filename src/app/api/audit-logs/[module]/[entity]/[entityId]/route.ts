import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { UnifiedAuditEntry } from "@/app/api/audit-logs/route";

/**
 * Per-entity activity feed. Use from entity-detail "Activity" tabs.
 *
 * Auth model:
 *   - HR audit: super_admin only.
 *   - Partners audit: platform admin (no partnerId), OR a partner viewing
 *     their own resource (entity rows are scoped by partnerId at write time).
 *
 * For Partners we additionally filter to records the caller is allowed to see.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ module: string; entity: string; entityId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { module, entity, entityId } = await params;

  if (module === "hr") {
    const isSuperAdmin = session.user.hrRoles?.includes("super_admin");
    if (!isSuperAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const rows = await db.hrAuditLog.findMany({
      where: { entityType: entity, entityId },
      orderBy: { timestamp: "desc" },
      take: 100,
      include: { user: { include: { user: { select: { email: true } } } } },
    });
    const entries: UnifiedAuditEntry[] = rows.map((r) => ({
      id: r.id,
      module: "hr",
      userId: r.userId,
      userLabel: r.user?.user?.email ?? null,
      action: r.action,
      entity: r.entityType,
      entityId: r.entityId,
      fieldName: r.fieldName || undefined,
      oldValue: r.oldValue,
      newValue: r.newValue,
      ipAddress: r.ipAddress,
      timestamp: r.timestamp.toISOString(),
    }));
    return NextResponse.json({ entries });
  }

  if (module === "partners") {
    // audit v12 LOW (LOW-7): allow platform admins OR partner users viewing their own resources
    const isPartnersAdmin =
      session.user.modules?.includes("partners") && !session.user.partnerId;
    const isPartner = !!session.user.partnerId;
    if (!isPartnersAdmin && !isPartner) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const rows = await db.partnerAuditLog.findMany({
      where: {
        entity,
        entityId,
        ...(isPartner ? { partnerId: session.user.partnerId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const userIds = Array.from(new Set(rows.map((r) => r.userId)));
    const users = userIds.length
      ? await db.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, email: true },
        })
      : [];
    const emailById = new Map(users.map((u) => [u.id, u.email]));
    const entries: UnifiedAuditEntry[] = rows.map((r) => ({
      id: r.id,
      module: "partners",
      userId: r.userId,
      userLabel: emailById.get(r.userId) ?? null,
      action: r.action,
      entity: r.entity,
      entityId: r.entityId,
      oldValue: r.oldData ? JSON.stringify(r.oldData) : null,
      newValue: r.newData ? JSON.stringify(r.newData) : null,
      ipAddress: r.ipAddress,
      timestamp: r.createdAt.toISOString(),
    }));
    return NextResponse.json({ entries });
  }

  return NextResponse.json({ error: "Unknown module" }, { status: 400 });
}
