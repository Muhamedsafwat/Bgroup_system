import { NextResponse } from 'next/server'
import { db as prisma } from '@/lib/db'
import { requireAuth } from '@/lib/hr/auth-utils'
import { isHROrAdmin, canAccessCompany } from '@/lib/hr/permissions'

export async function POST(
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
    const now = new Date()

    const lr = await prisma.hrLeaveRequest.findUnique({
      where: { id: pk },
      include: { employee: true, leaveType: true },
    })
    if (!lr) return NextResponse.json({ detail: 'Not found.' }, { status: 404 })

    // audit v12 HIGH: cross-company gate — HR manager in Company A must not deny leave for Company B
    if (!canAccessCompany(authUser, lr.employee.companyId)) {
      return NextResponse.json({ detail: 'Permission denied.' }, { status: 403 })
    }

    if (lr.status !== 'pending') {
      return NextResponse.json({ detail: 'Leave request is not pending.' }, { status: 400 })
    }

    // audit v12 HIGH (HIGH-59) ultra: wrap updateMany + notification in a single transaction so a
    // failed notification cannot leave the leave request permanently denied with no notification sent;
    // mirrors the atomicity guarantee already present in the approve route (MED-56).
    let updateCount = 0
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.hrLeaveRequest.updateMany({
        where: { id: pk, status: 'pending' },
        data: {
          status: 'denied',
          updatedAt: now,
        },
      })
      updateCount = count

      if (count > 0 && lr.employee?.userId) {
        await tx.hrNotification.create({
          data: {
            userId: lr.employee.userId,
            notificationType: 'leave',
            title: 'Leave Request Denied',
            message: `Your ${lr.leaveType?.nameEn || 'leave'} request from ${lr.startDate.toISOString().split('T')[0]} to ${lr.endDate.toISOString().split('T')[0]} has been denied.`,
            isRead: false,
            relatedObjectType: 'leave_request',
            relatedObjectId: lr.id,
            createdAt: now,
          },
        })
      }
    })

    if (updateCount === 0) {
      return NextResponse.json({ detail: 'Leave request is no longer pending.' }, { status: 409 })
    }

    // Return updated leave request
    const updated = await prisma.hrLeaveRequest.findUnique({
      where: { id: pk },
      include: { employee: true, leaveType: true, approvedBy: true },
    })

    return NextResponse.json({
      id: updated!.id,
      employee: updated!.employeeId,
      employee_name: updated!.employee?.fullNameEn || '',
      leave_type: updated!.leaveTypeId,
      leave_type_name: updated!.leaveType?.nameEn || '',
      start_date: updated!.startDate.toISOString().split('T')[0],
      end_date: updated!.endDate.toISOString().split('T')[0],
      days_count: updated!.daysCount,
      reason: updated!.reason,
      status: updated!.status,
      approved_by: updated!.approvedById,
      approved_by_name: updated!.approvedBy
        ? `${updated!.approvedBy.firstName} ${updated!.approvedBy.lastName}`.trim()
        : null,
      approved_at: updated!.approvedAt ? updated!.approvedAt.toISOString() : null,
      created_at: updated!.createdAt.toISOString(),
      updated_at: updated!.updatedAt.toISOString(),
    })
  } catch (error) {
    if (error instanceof Response) return error
    console.error('Leave deny error:', error)
    return NextResponse.json({ detail: 'Server error.' }, { status: 500 })
  }
}
