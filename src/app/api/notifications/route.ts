import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export type UnifiedNotification = {
  id: string;
  module: "hr" | "partners" | "crm";
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  // Where the user should land when they click — module-specific routing.
  href?: string;
};

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const modules = session.user.modules ?? [];

  const tasks: Promise<UnifiedNotification[]>[] = [];

  if (modules.includes("hr")) {
    tasks.push(
      db.hrNotification
        .findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          take: 50,
        })
        .then((rows) =>
          rows.map((n) => ({
            id: n.id,
            module: "hr" as const,
            title: n.title,
            message: n.message,
            isRead: n.isRead,
            createdAt: n.createdAt.toISOString(),
            href: hrHref(n.relatedObjectType, n.relatedObjectId),
          }))
        )
    );
  }

  if (modules.includes("partners")) {
    tasks.push(
      db.partnerNotification
        .findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          take: 50,
        })
        .then((rows) =>
          rows.map((n) => ({
            id: n.id,
            module: "partners" as const,
            title: n.title,
            message: n.message,
            isRead: n.isRead,
            createdAt: n.createdAt.toISOString(),
            href: partnersHref(n.type, n.metadata),
          }))
        )
    );
  }

  if (modules.includes("crm")) {
    tasks.push(
      db.crmNotification
        .findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          take: 50,
        })
        .then((rows) =>
          rows.map((n) => ({
            id: n.id,
            module: "crm" as const,
            title: n.title,
            message: n.message,
            isRead: n.isRead,
            createdAt: n.createdAt.toISOString(),
            href: n.href ?? undefined,
          }))
        )
    );
  }

  const [buckets, unreadCount] = await Promise.all([
    Promise.all(tasks),
    // Count unread per bucket directly so a notification past row 50
    // still increments the badge. The previous formulation counted
    // unread within the 50-newest window, which silently dropped
    // older unread items.
    (async () => {
      const counters: Promise<number>[] = [];
      if (modules.includes("hr")) {
        counters.push(db.hrNotification.count({ where: { userId, isRead: false } }));
      }
      if (modules.includes("partners")) {
        counters.push(db.partnerNotification.count({ where: { userId, isRead: false } }));
      }
      if (modules.includes("crm")) {
        counters.push(db.crmNotification.count({ where: { userId, isRead: false } }));
      }
      const totals = await Promise.all(counters);
      return totals.reduce((a, b) => a + b, 0);
    })(),
  ]);
  const all = buckets
    .flat()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 50);

  return NextResponse.json({ notifications: all, unreadCount });
}

function hrHref(type: string, id: string | null): string | undefined {
  if (!type || !id) return undefined;
  switch (type) {
    case "overtime_request":
      return `/hr/overtime/pending`;
    case "leave_request":
      return `/hr/attendance/today`;
    case "incident":
      return `/hr/incidents/all`;
    case "bonus":
      return `/hr/bonuses/all`;
    case "salary":
      return `/hr/payroll/monthly`;
    default:
      return undefined;
  }
}

function partnersHref(type: string, metadata: unknown): string | undefined {
  // metadata is Json? — defensively read fields
  const meta = (metadata ?? {}) as Record<string, unknown>;
  const dealId = typeof meta.dealId === "string" ? meta.dealId : null;
  const commissionId = typeof meta.commissionId === "string" ? meta.commissionId : null;
  const contractId = typeof meta.contractId === "string" ? meta.contractId : null;
  const invoiceId = typeof meta.invoiceId === "string" ? meta.invoiceId : null;

  if (type.startsWith("DEAL_") && dealId) return `/partners/deals/${dealId}`;
  if (type.startsWith("COMMISSION_") && commissionId) return `/partners/commissions`;
  if (type.startsWith("CONTRACT_") && contractId) return `/partners/contracts`;
  if (type.startsWith("INVOICE_") && invoiceId) return `/partners/invoices`;
  return undefined;
}
