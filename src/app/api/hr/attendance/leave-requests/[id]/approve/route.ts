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

    // audit v12 HIGH: cross-company gate — HR manager in Company A must not approve leave for Company B
    if (!canAccessCompany(authUser, lr.employee.companyId)) {
      return NextResponse.json({ detail: 'Permission denied.' }, { status: 403 })
    }

    if (lr.status !== 'pending') {
      return NextResponse.json({ detail: 'Leave request is not pending.' }, { status: 400 })
    }

    // audit v12 MEDIUM (MED-56): wrap all mutations in an interactive transaction for atomicity;
    // a mid-loop failure now rolls back the entire operation instead of leaving a partial state.
    await prisma.$transaction(async (tx) => {
      // audit v12 HIGH (HIGH-60) recheck-hardening: gate the status flip via
      // updateMany with status='pending' so two concurrent approves race
      // each other at the DB layer (mirrors the pattern HIGH-59 added to
      // deny). The findUnique up top closes the most-common TOCTOU but
      // not the simultaneous-click case.
      const flip = await tx.hrLeaveRequest.updateMany({
        where: { id: pk, status: 'pending' },
        data: {
          status: 'approved',
          approvedById: authUser.id,
          approvedAt: now,
          updatedAt: now,
        },
      })
      if (flip.count === 0) {
        // Lost the race — another admin approved first. Throwing rolls
        // back the surrounding tx so no attendance logs are written.
        throw Object.assign(new Error('LEAVE_NOT_PENDING'), { isRace: true })
      }

      // Create attendance logs with status 'leave' for each day of the leave
      const startDate = new Date(lr.startDate)
      const endDate = new Date(lr.endDate)
      for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        const logDate = new Date(d)
        logDate.setHours(0, 0, 0, 0)

        // audit v12 MEDIUM (MED-56): read existing log inside the transaction
        const existing = await tx.hrAttendanceLog.findUnique({
          where: { employeeId_date: { employeeId: lr.employeeId, date: logDate } },
        })

        if (!existing) {
          await tx.hrAttendanceLog.create({
            data: {
              employeeId: lr.employeeId,
              date: logDate,
              status: 'leave',
              hoursWorked: 0,
              overtimeHours: 0,
              isManual: false,
              manualReason: '',
              createdAt: now,
              updatedAt: now,
            },
          })
        } else {
          // audit v12 MEDIUM (MED-56): guard against overwriting terminal real-attendance statuses
          // (e.g. 'present' or 'absent') — only overwrite non-terminal placeholder statuses.
          if (existing.status !== 'present' && existing.status !== 'absent') {
            await tx.hrAttendanceLog.update({
              where: { id: existing.id },
              data: { status: 'leave', updatedAt: now },
            })
          } else {
            console.warn(
              `[MED-56] Skipping attendance log overwrite for employee ${lr.employeeId} on ${logDate.toISOString().split('T')[0]}: existing status is '${existing.status}'`
            )
          }
        }
      }

      // Create notification for the employee
      if (lr.employee?.userId) {
        await tx.hrNotification.create({
          data: {
            userId: lr.employee.userId,
            notificationType: 'leave',
            title: 'Leave Request Approved',
            message: `Your ${lr.leaveType?.nameEn || 'leave'} request from ${lr.startDate.toISOString().split('T')[0]} to ${lr.endDate.toISOString().split('T')[0]} has been approved.`,
            isRead: false,
            relatedObjectType: 'leave_request',
            relatedObjectId: lr.id,
            createdAt: now,
          },
        })
      }
    })

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
    // audit v12 HIGH (HIGH-60) recheck-hardening: surface race losses as 409.
    if ((error as { isRace?: boolean }).isRace) {
      return NextResponse.json(
        { detail: 'Leave request was already approved by another admin.' },
        { status: 409 },
      )
    }
    console.error('Leave approve error:', error)
    return NextResponse.json({ detail: 'Server error.' }, { status: 500 })
  }
}
