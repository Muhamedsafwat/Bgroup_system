import { NextResponse } from 'next/server'
import { db as prisma } from '@/lib/db'
import { requireAuth } from '@/lib/hr/auth-utils'
import { isHROrAdmin } from '@/lib/hr/permissions'
import { updateLeaveRequestSchema } from '@/lib/hr/validations'

function serializeLeaveRequest(lr: any) {
  return {
    id: lr.id,
    employee: lr.employeeId,
    employee_name: lr.employee?.fullNameEn || '',
    leave_type: lr.leaveTypeId,
    leave_type_name: lr.leaveType?.nameEn || '',
    start_date: lr.startDate.toISOString().split('T')[0],
    end_date: lr.endDate.toISOString().split('T')[0],
    days_count: lr.daysCount,
    reason: lr.reason,
    status: lr.status,
    approved_by: lr.approvedById,
    approved_by_name: lr.approvedBy
      ? `${lr.approvedBy.firstName} ${lr.approvedBy.lastName}`.trim()
      : null,
    approved_at: lr.approvedAt ? lr.approvedAt.toISOString() : null,
    created_at: lr.createdAt.toISOString(),
    updated_at: lr.updatedAt.toISOString(),
  }
}

const leaveRequestIncludes = {
  employee: true,
  leaveType: true,
  approvedBy: true,
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authUser = await requireAuth(request)
    const { id } = await params

    const lr = await prisma.hrLeaveRequest.findUnique({
      where: { id: id },
      include: leaveRequestIncludes,
    })
    if (!lr) return NextResponse.json({ detail: 'Not found.' }, { status: 404 })

    if (!isHROrAdmin(authUser)) {
      const ownEmp = await prisma.hrEmployee.findUnique({
        where: { userId: authUser.id },
        select: { id: true },
      })
      if (!ownEmp || lr.employeeId !== ownEmp.id) {
        return NextResponse.json({ detail: 'Not found.' }, { status: 404 })
      }
    }

    return NextResponse.json(serializeLeaveRequest(lr))
  } catch (error) {
    if (error instanceof Response) return error
    return NextResponse.json({ detail: 'Server error.' }, { status: 500 })
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authUser = await requireAuth(request)
    if (!isHROrAdmin(authUser)) {
      return NextResponse.json({ detail: 'Permission denied.' }, { status: 403 })
    }

    const { id } = await params
    const pk = id
    const body = await request.json()
    // audit v12 HIGH (HIGH-58) ultra: block status transitions via PATCH at
    // the raw-body layer so the rejection fires before Zod strips the field.
    // Approved/denied transitions must go through the dedicated /approve or
    // /deny sub-routes which set approvedById/approvedAt, fan out attendance
    // logs, enforce canAccessCompany, and send notifications.
    if (body && typeof body === 'object' && 'status' in body) {
      return NextResponse.json(
        {
          detail:
            'Status transitions are not allowed via PATCH. ' +
            'Use POST /approve or POST /deny instead.',
        },
        { status: 409 }
      )
    }
    const parsed = updateLeaveRequestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ detail: parsed.error.issues[0].message }, { status: 400 })
    }
    const data = parsed.data

    // audit v12 HIGH: guard against rewriting date/type on a finalised request,
    // which would orphan approved attendance-log rows (20-24 stay 'leave') and
    // leave the new range (27-31) with 'absent' rows.
    // Approved/denied requests must be revoked and re-created instead.
    const existing = await prisma.hrLeaveRequest.findUnique({
      where: { id: pk },
      select: { status: true },
    })
    if (!existing) {
      return NextResponse.json({ detail: 'Not found.' }, { status: 404 })
    }
    const isDateOrTypeChange =
      data.start_date !== undefined ||
      data.end_date !== undefined ||
      data.leave_type !== undefined ||
      data.days_count !== undefined
    if (
      (existing.status === 'approved' || existing.status === 'denied') &&
      isDateOrTypeChange
    ) {
      return NextResponse.json(
        {
          detail:
            'Cannot modify dates or leave type on an approved/denied request. ' +
            'Revoke the request and create a new one.',
        },
        { status: 409 }
      )
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() }

    if (data.leave_type !== undefined) updateData.leaveTypeId = data.leave_type
    if (data.start_date !== undefined) updateData.startDate = new Date(data.start_date)
    if (data.end_date !== undefined) updateData.endDate = new Date(data.end_date)
    if (data.days_count !== undefined) updateData.daysCount = data.days_count
    if (data.reason !== undefined) updateData.reason = data.reason

    await prisma.hrLeaveRequest.update({ where: { id: pk }, data: updateData })

    const lr = await prisma.hrLeaveRequest.findUnique({
      where: { id: pk },
      include: leaveRequestIncludes,
    })

    return NextResponse.json(serializeLeaveRequest(lr!))
  } catch (error) {
    if (error instanceof Response) return error
    console.error('Leave request update error:', error)
    return NextResponse.json({ detail: 'Server error.' }, { status: 500 })
  }
}
