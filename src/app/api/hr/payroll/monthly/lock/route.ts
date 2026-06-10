import { NextResponse } from 'next/server'
import { db as prisma } from '@/lib/db'
import { requireAuth } from '@/lib/hr/auth-utils'
import { canManagePayroll } from '@/lib/hr/permissions'
import { createAuditLog, getClientIp } from '@/lib/hr/audit'
import { payrollMonthlyActionSchema } from '@/lib/hr/validations'

export async function POST(request: Request) {
  try {
    const authUser = await requireAuth(request)
    if (!canManagePayroll(authUser)) {
      return NextResponse.json({ detail: 'Permission denied.' }, { status: 403 })
    }

    const body = await request.json()
    const parsed = payrollMonthlyActionSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ detail: parsed.error.issues[0].message }, { status: 400 })
    }
    const { company, month, year } = parsed.data

    const now = new Date()
    const m = month !== undefined ? parseInt(String(month), 10) : now.getMonth() + 1
    const y = year !== undefined ? parseInt(String(year), 10) : now.getFullYear()
    const companyId = company

    // audit v12 MEDIUM (MED-55): wrap create-if-missing + status-gate + updates + notifications
    // in a single transaction so concurrent requests cannot both pass the status check,
    // produce a duplicate lock, or fire duplicate notifications.
    const txResult = await prisma.$transaction(async (tx) => {
      let period = await tx.hrPayrollPeriod.findFirst({
        where: { month: m, year: y, companyId },
      })

      if (!period) {
        // Create as open first, then lock
        period = await tx.hrPayrollPeriod.create({
          data: {
            companyId,
            month: m,
            year: y,
            status: 'open',
            createdAt: now,
            updatedAt: now,
          },
        })
      }

      if (period.status === 'locked') {
        return { conflict: 'already_locked' as const, periodId: period.id }
      }
      if (period.status === 'finalized') {
        return { conflict: 'finalized' as const, periodId: period.id }
      }

      // Atomically lock only if status is still not locked/finalized (race-safe check).
      const lockResult = await tx.hrPayrollPeriod.updateMany({
        where: { id: period.id, status: { notIn: ['locked', 'finalized'] } },
        data: { status: 'locked', lockedById: authUser.id, lockedAt: now, updatedAt: now },
      })
      if (lockResult.count === 0) {
        return { conflict: 'already_locked' as const, periodId: period.id }
      }

      await tx.hrMonthlySalary.updateMany({
        where: {
          employee: { companyId },
          month: m,
          year: y,
          status: 'open',
        },
        data: { status: 'locked' },
      })

      // Notify accountants and CEOs; skip duplicate notifications (extra guard against races).
      const notifyUsers = await tx.hrUserRole.findMany({
        where: { role: { name: { in: ['accountant', 'ceo'] } } },
        select: { userId: true },
      })
      const uniqueUserIds = Array.from(new Set(notifyUsers.map((u) => u.userId)))
      for (const uid of uniqueUserIds) {
        const alreadyNotified = await tx.hrNotification.findFirst({
          where: {
            userId: uid,
            notificationType: 'payroll_locked',
            relatedObjectId: period.id,
          },
        })
        if (!alreadyNotified) {
          await tx.hrNotification.create({
            data: {
              userId: uid,
              notificationType: 'payroll_locked',
              title: 'Payroll Locked',
              message: `Payroll for ${String(m).padStart(2, '0')}/${y} has been locked and is ready for review.`,
              isRead: false,
              relatedObjectType: 'PayrollPeriod',
              relatedObjectId: period.id,
              createdAt: now,
            },
          })
        }
      }

      return { conflict: null, periodId: period.id }
    })

    if (txResult.conflict === 'already_locked') {
      return NextResponse.json({ detail: 'Payroll period is already locked.' }, { status: 400 })
    }
    if (txResult.conflict === 'finalized') {
      return NextResponse.json({ detail: 'Cannot lock a finalized payroll period.' }, { status: 400 })
    }

    await createAuditLog({
      userId: authUser.id,
      action: 'lock',
      entityType: 'payroll',
      entityId: txResult.periodId,
      details: `Locked payroll for company ${companyId}, ${m}/${y}`,
      ipAddress: getClientIp(request),
    })

    return NextResponse.json({ detail: 'Payroll locked.', status: 'LOCKED' })
  } catch (error) {
    if (error instanceof Response) return error
    console.error('Lock error:', error)
    return NextResponse.json({ detail: 'Server error.' }, { status: 500 })
  }
}
