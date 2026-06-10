import { NextResponse } from 'next/server'
import { db as prisma } from '@/lib/db'
import { requireAuth } from '@/lib/hr/auth-utils'
import { canManagePayroll } from '@/lib/hr/permissions'
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

    // audit v12 MEDIUM (MED-55): wrap status-gate + updates + notifications in a single
    // transaction with an atomic conditional update so concurrent requests cannot both
    // pass the finalized check, double-flip the period, or fire duplicate notifications.
    const txResult = await prisma.$transaction(async (tx) => {
      // Atomically transition only if status is currently 'finalized'; 0-row update = race lost.
      const updated = await tx.hrPayrollPeriod.updateMany({
        where: { companyId, month: m, year: y, status: 'finalized' },
        data: { status: 'paid', paidById: authUser.id, paidAt: now, updatedAt: now },
      })

      if (updated.count === 0) {
        return { conflict: true }
      }

      const period = await tx.hrPayrollPeriod.findFirst({
        where: { companyId, month: m, year: y },
      })

      await tx.hrMonthlySalary.updateMany({
        where: {
          employee: { companyId },
          month: m,
          year: y,
        },
        data: { status: 'paid' },
      })

      // Notify employees; skip duplicate notifications (extra guard against races).
      const employees = await tx.hrEmployee.findMany({
        where: {
          companyId,
          status: { in: ['active', 'probation'] },
          userId: { not: null },
        },
        select: { userId: true },
      })

      for (const emp of employees) {
        if (emp.userId) {
          const alreadyNotified = await tx.hrNotification.findFirst({
            where: {
              userId: emp.userId,
              notificationType: 'salary_slip',
              relatedObjectId: period!.id,
            },
          })
          if (!alreadyNotified) {
            await tx.hrNotification.create({
              data: {
                userId: emp.userId,
                notificationType: 'salary_slip',
                title: 'Salary Paid',
                message: `Your salary for ${String(m).padStart(2, '0')}/${y} has been paid.`,
                isRead: false,
                relatedObjectType: 'PayrollPeriod',
                relatedObjectId: period!.id,
                createdAt: now,
              },
            })
          }
        }
      }

      return { conflict: false }
    })

    if (txResult.conflict) {
      return NextResponse.json({ detail: 'Only finalized periods can be marked as paid.' }, { status: 400 })
    }

    return NextResponse.json({ detail: 'Payroll marked as paid.', status: 'PAID' })
  } catch (error) {
    if (error instanceof Response) return error
    console.error('Mark paid error:', error)
    return NextResponse.json({ detail: 'Server error.' }, { status: 500 })
  }
}
