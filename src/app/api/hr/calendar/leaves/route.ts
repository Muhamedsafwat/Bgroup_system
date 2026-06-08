import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";
import { describeZodError } from "@/lib/zod-errors";

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  companyId: z.string().optional(),
  departmentId: z.string().optional(),
});

export type LeaveOnCalendar = {
  id: string;
  employeeId: string;
  employeeName: string;
  departmentId: string | null;
  departmentName: string | null;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  daysCount: number;
  status: string;
  leaveType: string | null;
};

/**
 * Returns approved + pending leave requests in [from, to], scoped by company.
 * Used by /hr/calendar to render a team view.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.modules?.includes("hr")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
    companyId: url.searchParams.get("companyId") ?? undefined,
    departmentId: url.searchParams.get("departmentId") ?? undefined,
  });
  if (!parsed.success) {
    { const __z = describeZodError(parsed.error); return NextResponse.json({ error: __z.message, fieldErrors: __z.fieldErrors }, { status: 422 }); }
  }
  const { from, to, companyId, departmentId } = parsed.data;

  const isCrossCompany =
    session.user.hrRoles?.includes("super_admin") ||
    session.user.hrRoles?.includes("ceo");
  const allowed = session.user.hrCompanies ?? [];

  // Build the company filter on the EMPLOYEE relation (HrLeaveRequest has no
  // companyId of its own).
  const employeeFilter: { companyId?: string | { in: string[] }; departmentId?: string } = {};
  if (companyId) {
    if (!isCrossCompany && !allowed.includes(companyId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    employeeFilter.companyId = companyId;
  } else if (!isCrossCompany && allowed.length > 0) {
    employeeFilter.companyId = { in: allowed };
  }
  if (departmentId) employeeFilter.departmentId = departmentId;

  const fromDate = new Date(from);
  const toDate = new Date(to);
  toDate.setHours(23, 59, 59, 999);

  const leaves = await db.hrLeaveRequest.findMany({
    where: {
      status: { in: ["pending", "approved"] },
      // Overlap test: the leave overlaps the window if start <= to and end >= from.
      startDate: { lte: toDate },
      endDate: { gte: fromDate },
      ...(Object.keys(employeeFilter).length
        ? { employee: employeeFilter }
        : {}),
    },
    orderBy: { startDate: "asc" },
    include: {
      employee: {
        select: {
          fullNameEn: true,
          departmentId: true,
          department: { select: { nameEn: true } },
        },
      },
      leaveType: { select: { nameEn: true } },
    },
  });

  const data: LeaveOnCalendar[] = leaves.map((l) => ({
    id: l.id,
    employeeId: l.employeeId,
    employeeName: l.employee.fullNameEn,
    departmentId: l.employee.departmentId,
    departmentName: l.employee.department?.nameEn ?? null,
    startDate: l.startDate.toISOString().slice(0, 10),
    endDate: l.endDate.toISOString().slice(0, 10),
    daysCount: l.daysCount,
    status: l.status,
    leaveType: l.leaveType?.nameEn ?? null,
  }));

  return NextResponse.json({ leaves: data });
}
