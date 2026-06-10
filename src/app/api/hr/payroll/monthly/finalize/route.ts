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

    // audit v12 MEDIUM (MED-55): wrap all reads+writes in a single transaction with
    // an atomic conditional update so concurrent requests cannot both pass the status
    // gate, double-flip the period, or fire duplicate notifications.
    const txResult = await prisma.$transaction(async (tx) => {
      // Atomically transition only if status is currently 'locked'; 0-row update = race lost.
      const updated = await tx.hrPayrollPeriod.updateMany({
        where: { companyId, month: m, year: y, status: 'locked' },
        data: { status: 'finalized', finalizedAt: now, updatedAt: now },
      })

      if (updated.count === 0) {
        // Either period doesn't exist or is already finalized/not locked — reject.
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
        data: { status: 'finalized', finalizedAt: now },
      })

      // Notify each employee in this payroll period that their salary slip is ready;
      // skip if a duplicate notification already exists (extra guard against races).
      const salaries = await tx.hrMonthlySalary.findMany({
        where: { employee: { companyId }, month: m, year: y },
        include: { employee: true },
      })
      for (const sal of salaries) {
        if (sal.employee.userId) {
          const alreadyNotified = await tx.hrNotification.findFirst({
            where: {
              userId: sal.employee.userId,
              notificationType: 'salary_slip_ready',
              relatedObjectId: sal.id,
            },
          })
          if (!alreadyNotified) {
            await tx.hrNotification.create({
              data: {
                userId: sal.employee.userId,
                notificationType: 'salary_slip_ready',
                title: 'Salary Slip Ready',
                message: `Your salary slip for ${String(m).padStart(2, '0')}/${y} is now available.`,
                isRead: false,
                relatedObjectType: 'MonthlySalary',
                relatedObjectId: sal.id,
                createdAt: now,
              },
            })
          }
        }
      }

      return { conflict: false, periodId: period!.id }
    })

    if (txResult.conflict) {
      return NextResponse.json({ detail: 'Only locked periods can be finalized.' }, { status: 400 })
    }

    await createAuditLog({
      userId: authUser.id,
      action: 'finalize',
      entityType: 'payroll',
      entityId: txResult.periodId!,
      details: `Finalized payroll for company ${companyId}, ${m}/${y}`,
      ipAddress: getClientIp(request),
    })

    return NextResponse.json({ detail: 'Payroll finalized.', status: 'FINALIZED' })
  } catch (error) {
    if (error instanceof Response) return error
    console.error('Finalize error:', error)
    return NextResponse.json({ detail: 'Server error.' }, { status: 500 })
  }
}
