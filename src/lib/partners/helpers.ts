import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";

// ---------- Auth helpers ----------

export interface PartnerAuthUser {
  userId: string;
  partnerId: string | undefined;
  isAdmin: boolean;
}

/**
 * Get authenticated user from NextAuth session with partner context.
 * Returns null if not authenticated or doesn't have partners module access.
 */
export async function getPartnerUser(): Promise<PartnerAuthUser | null> {
  const session = await auth();
  if (!session?.user?.id || !session.user.modules?.includes("partners")) {
    return null;
  }
  // In the Partners module, users WITHOUT a partnerProfile are admins
  // (platform operators who manage partners). Regular partners always have a partnerId.
  const isAdmin = !session.user.partnerId;
  return {
    userId: session.user.id,
    partnerId: session.user.partnerId,
    isAdmin,
  };
}

/**
 * Require authenticated partner user. Returns 401 if not authenticated.
 */
export async function requirePartnerAuth(): Promise<
  { user: PartnerAuthUser; error?: never } | { user?: never; error: NextResponse }
> {
  const user = await getPartnerUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { user };
}

/**
 * Require admin role. Returns 403 if not admin.
 */
export async function requireAdmin(): Promise<
  { user: PartnerAuthUser; error?: never } | { user?: never; error: NextResponse }
> {
  const result = await requirePartnerAuth();
  if (result.error) return result;
  if (!result.user.isAdmin) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user: result.user };
}

// ---------- Access control ----------

/**
 * Assert that user has access to a resource owned by partnerId.
 * Admins can access everything; partners can only access their own.
 */
export function assertAccess(user: PartnerAuthUser, resourcePartnerId: string): boolean {
  if (user.isAdmin) return true;
  return user.partnerId === resourcePartnerId;
}

// ---------- Pagination ----------

export interface PaginationParams {
  page: number;
  perPage: number;
  skip: number;
  take: number;
}

export function getPaginationParams(searchParams: URLSearchParams): PaginationParams {
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const perPage = Math.min(100, Math.max(1, parseInt(searchParams.get("perPage") || "10", 10)));
  return { page, perPage, skip: (page - 1) * perPage, take: perPage };
}

// ---------- Response helpers ----------

export function jsonSuccess<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}

export function jsonPaginated<T>(
  data: T[],
  total: number,
  pagination: PaginationParams
) {
  return NextResponse.json({
    success: true,
    data,
    meta: {
      pagination: {
        page: pagination.page,
        perPage: pagination.perPage,
        total,
        totalPages: Math.ceil(total / pagination.perPage),
      },
    },
  });
}

export function jsonError(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

// ---------- Audit logging ----------

export interface PartnerAuditEntry {
  userId: string;
  action: string;
  entity: string;
  entityId: string;
  oldData?: unknown;
  newData?: unknown;
  request?: Request;
  /// auth User.id of the admin when the action ran under
  /// impersonation. userId is the target; this column captures the
  /// admin behind the action. Read from session.user.actingAsUserId.
  actingAdminId?: string;
}

export async function writePartnerAudit(entry: PartnerAuditEntry): Promise<void> {
  try {
    const ipAddress = entry.request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
    await db.partnerAuditLog.create({
      data: {
        userId: entry.userId,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        oldData: entry.oldData == null ? undefined : JSON.parse(JSON.stringify(entry.oldData)),
        newData: entry.newData == null ? undefined : JSON.parse(JSON.stringify(entry.newData)),
        ipAddress,
        actingAdminId: entry.actingAdminId ?? null,
      },
    });
  } catch (err) {
    console.error("Audit log failure (non-fatal):", err);
  }
}
