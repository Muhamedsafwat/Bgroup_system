import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma";

export async function generateOpportunityCode(): Promise<string> {
  return db.$transaction(async (tx) => {
    const last = await tx.crmOpportunity.findFirst({
      orderBy: { code: "desc" },
      select: { code: true },
    });

    if (!last) return "OPP-0001";

    const num = parseInt(last.code.replace("OPP-", ""), 10);
    return `OPP-${String(num + 1).padStart(4, "0")}`;
  });
}

export async function generateCallCode(): Promise<string> {
  return db.$transaction(async (tx) => {
    const last = await tx.crmCall.findFirst({
      orderBy: { code: "desc" },
      select: { code: true },
    });

    if (!last) return "CL-0001";

    const num = parseInt(last.code.replace("CL-", ""), 10);
    return `CL-${String(num + 1).padStart(4, "0")}`;
  });
}

// audit v12 HIGH (HIGH-48): generate the MTG code inside the caller's
// transaction so two concurrent POSTs cannot read the same "last row" and
// produce a duplicate code (which would previously cause a P2002 unique
// constraint violation). The advisory lock serialises all concurrent callers.
export async function generateMeetingCodeInTx(
  tx: Prisma.TransactionClient,
): Promise<string> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(7141003)`;
  const last = await tx.crmMeeting.findFirst({
    orderBy: { createdAt: "desc" },
    select: { code: true },
  });
  let n = 1;
  if (last?.code) {
    const m = last.code.match(/(\d+)$/);
    if (m) n = parseInt(m[1], 10) + 1;
  }
  return `MTG-${String(n).padStart(5, "0")}`;
}
