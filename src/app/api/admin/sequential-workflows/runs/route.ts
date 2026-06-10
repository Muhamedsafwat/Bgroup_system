import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma";
// audit v12 MEDIUM (MED-54): use canonical isPlatformAdmin instead of local copy
import { isPlatformAdmin } from "@/lib/crm/admin-gates";

export async function GET(req: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const workflowId = url.searchParams.get("workflowId");
  const statusParam = url.searchParams.get("status");

  const where: Prisma.SequentialWorkflowRunWhereInput = {};
  if (workflowId) where.workflowId = workflowId;
  if (statusParam === "RUNNING" || statusParam === "COMPLETED" || statusParam === "CANCELLED") {
    where.status = statusParam;
  }
  if (!isPlatformAdmin(session)) {
    where.triggeredById = session.user.id;
  }

  const runs = await db.sequentialWorkflowRun.findMany({
    where,
    orderBy: { startedAt: "desc" },
    take: 100,
    include: {
      workflow: { select: { id: true, name: true, module: true } },
      steps: {
        orderBy: { position: "asc" },
        include: {
          step: { select: { id: true, name: true, budgetHours: true } },
          task: { select: { id: true, title: true, status: true, assigneeId: true } },
        },
      },
    },
  });
  return NextResponse.json({ runs });
}
