import { NextResponse } from "next/server";
import { db as prisma } from "@/lib/db";
import { requireAuth } from "@/lib/hr/auth-utils";
import { can, canAccessCompany, isTeamLead } from "@/lib/hr/permissions";
import { getSubordinateEmployeeIds } from "@/lib/hr/subordinates";
import { createAuditLog, getClientIp } from "@/lib/hr/audit";
import { z } from "zod";
import { publish } from "@/lib/events/bus";

const bodySchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
});

export async function POST(request: Request) {
  try {
    const authUser = await requireAuth(request);
    // audit v12 HIGH (HIGH-51) recheck: use can() so team_lead is admitted,
    // then scope the update to company and (for team_lead) subordinate chain.
    if (!can(authUser, "overtime:approve")) {
      return NextResponse.json({ detail: "Permission denied." }, { status: 403 });
    }

    const body = await request.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { detail: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { ids } = parsed.data;
    const now = new Date();

    // Fetch pending requests so we can apply company-scope and subordinate filters
    // before updateMany (which cannot join across tables).
    const requests = await prisma.hrOvertimeRequest.findMany({
      where: { id: { in: ids }, status: "pending" },
      include: { employee: { select: { id: true, companyId: true } } },
    });

    // Company-scope filter: non-superAdmin/non-CEO users may only touch employees
    // whose companyId is in their own companies list.
    let eligible = requests.filter(
      (r) => !r.employee || canAccessCompany(authUser, r.employee.companyId)
    );

    // team_lead subordinate filter: further restrict to their direct/indirect reports.
    if (isTeamLead(authUser)) {
      const myEmployee = await prisma.hrEmployee.findFirst({
        where: { userId: authUser.id },
        select: { id: true },
      });
      if (!myEmployee) return NextResponse.json({ detail: "Permission denied." }, { status: 403 });
      const subordinateIds = await getSubordinateEmployeeIds(myEmployee.id);
      eligible = eligible.filter((r) => r.employee && subordinateIds.has(r.employee.id));
    }

    const eligibleIds = eligible.map((r) => r.id);

    // Only flip rows that are still pending — avoids accidentally re-approving
    // already-actioned ones if the client list is stale.
    const result = await prisma.hrOvertimeRequest.updateMany({
      where: { id: { in: eligibleIds }, status: "pending" },
      data: { status: "approved", approvedById: authUser.id, approvedAt: now },
    });

    await createAuditLog({
      userId: authUser.id,
      action: "bulk_approve",
      entityType: "overtime_request",
      ipAddress: getClientIp(request),
      details: `Bulk-approved ${result.count} of ${ids.length} overtime requests`,
    });

    publish({
      type: "data.invalidate",
      userId: authUser.id,
      payload: { queryKeys: [["overtime", "pending"]] },
    });

    return NextResponse.json({ approved: result.count, requested: ids.length });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("bulk-approve error", error);
    return NextResponse.json({ detail: "Server error." }, { status: 500 });
  }
}
