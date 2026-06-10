import { NextResponse } from 'next/server'
import { db as prisma } from '@/lib/db'
import { requireAuth } from '@/lib/hr/auth-utils'
import { isHROrAdmin, hasAnyRole, canAccessCompany } from '@/lib/hr/permissions'
import { createAuditLog, getClientIp } from '@/lib/hr/audit'
import { createBonusSchema } from '@/lib/hr/validations'

const bonusIncludes = {
  employee: {
    include: {
      company: true,
      department: true,
    },
  },
  bonusRule: {
    include: {
      category: true,
    },
  },
  submittedBy: true,
  approvedBy: true,
}

function serializeBonus(b: any) {
  return {
    id: b.id,
    employee: b.employeeId,
    employee_name: b.employee?.fullNameEn || '',
    employee_id_str: b.employee?.employeeId || '',
    company_name: b.employee?.company?.nameEn || '',
    department_name: b.employee?.department?.nameEn || '',
    category_name: b.bonusRule?.category?.nameEn || '',
    bonus_rule: b.bonusRuleId,
    bonus_rule_name: b.bonusRule?.nameEn || '',
    bonus_date: b.bonusDate instanceof Date ? b.bonusDate.toISOString().split('T')[0] : b.bonusDate,
    bonus_amount: parseFloat(String(b.bonusAmount)),
    comments: b.comments || '',
    reason: b.comments || '',
    dismissed_reason: b.status === 'dismissed' ? (b.comments || null) : null,
    evidence: b.evidence || null,
    status: b.status,
    status_display: b.status.charAt(0).toUpperCase() + b.status.slice(1),
    submitted_by: b.submittedById,
    submitted_by_email: b.submittedBy?.email || '',
    submitted_by_name: b.submittedBy
      ? `${b.submittedBy.firstName} ${b.submittedBy.lastName}`.trim() || b.submittedBy.email
      : '',
    approved_by: b.approvedById,
    approved_by_email: b.approvedBy?.email || null,
    approved_by_name: b.approvedBy
      ? `${b.approvedBy.firstName} ${b.approvedBy.lastName}`.trim() || b.approvedBy.email
      : null,
    created_at: b.createdAt.toISOString(),
    updated_at: b.updatedAt.toISOString(),
  }
}

export async function GET(request: Request) {
  try {
    const authUser = await requireAuth(request)
    const url = new URL(request.url)

    const where: any = {}

    // Regular employees can only see their own bonuses
    const isPrivileged = hasAnyRole(authUser, ['super_admin', 'hr_manager', 'accountant', 'ceo'])
    if (!isPrivileged) {
      const emp = await prisma.hrEmployee.findFirst({ where: { userId: authUser.id } })
      if (!emp) return NextResponse.json([])
      where.employeeId = emp.id
    }
    const employee = url.searchParams.get('employee')
    const status = url.searchParams.get('status')
    const company = url.searchParams.get('company')
    const department = url.searchParams.get('department')
    const bonusRule = url.searchParams.get('bonus_rule')
    const month = url.searchParams.get('month')
    const year = url.searchParams.get('year')
    const dateFrom = url.searchParams.get('date_from')
    const dateTo = url.searchParams.get('date_to')
    const search = url.searchParams.get('search')

    if (employee) where.employeeId = employee
    if (status) where.status = status
    if (bonusRule) where.bonusRuleId = bonusRule
    if (company) where.employee = { ...where.employee, companyId: company }
    if (department) where.employee = { ...where.employee, departmentId: department }

    if (month && year) {
      const m = parseInt(month, 10)
      const y = parseInt(year, 10)
      const start = new Date(y, m - 1, 1)
      const end = new Date(y, m, 1)
      where.bonusDate = { gte: start, lt: end }
    } else {
      if (dateFrom) where.bonusDate = { ...where.bonusDate, gte: new Date(dateFrom) }
      if (dateTo) where.bonusDate = { ...where.bonusDate, lte: new Date(dateTo) }
    }

    if (search) {
      where.OR = [
        { employee: { fullNameEn: { contains: search } } },
        { employee: { employeeId: { contains: search } } },
      ]
    }

    const bonuses = await prisma.hrBonus.findMany({
      where,
      include: bonusIncludes,
      orderBy: { bonusDate: 'desc' },
    })

    return NextResponse.json(bonuses.map(serializeBonus))
  } catch (error) {
    if (error instanceof Response) return error
    console.error('Bonuses list error:', error)
    return NextResponse.json({ detail: 'Server error.' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const authUser = await requireAuth(request)
    if (!isHROrAdmin(authUser)) {
      return NextResponse.json({ detail: 'Permission denied.' }, { status: 403 })
    }

    const body = await request.json()
    const parsed = createBonusSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ detail: parsed.error.issues[0].message }, { status: 400 })
    }
    const data = parsed.data
    const now = new Date()

    const employeeId = data.employee
    const bonusRuleId = data.bonus_rule
    const bonusDate = new Date(data.bonus_date)

    // Get the bonus rule
    const bonusRule = await prisma.hrBonusRule.findUnique({
      where: { id: bonusRuleId },
      include: { category: true },
    })
    if (!bonusRule) {
      return NextResponse.json({ detail: 'Bonus rule not found.' }, { status: 400 })
    }

    // Get the employee for base salary
    const employee = await prisma.hrEmployee.findUnique({ where: { id: employeeId } })
    if (!employee) {
      return NextResponse.json({ detail: 'Employee not found.' }, { status: 400 })
    }
    // audit v12 HIGH (HIGH-57) recheck: validate cross-company access before creating bonus.
    if (!canAccessCompany(authUser, employee.companyId)) {
      return NextResponse.json({ detail: 'Permission denied.' }, { status: 403 })
    }

    // Auto-compute amount from rule
    let bonusAmount: number
    if (bonusRule.valueType === 'fixed') {
      bonusAmount = parseFloat(String(bonusRule.value))
    } else {
      bonusAmount = (parseFloat(String(bonusRule.value)) / 100) * parseFloat(String(employee.baseSalary))
    }
    bonusAmount = Math.round(bonusAmount * 100) / 100

    const bonus = await prisma.hrBonus.create({
      data: {
        employeeId,
        bonusRuleId,
        bonusDate,
        bonusAmount,
        comments: data.comments || '',
        evidence: data.evidence || null,
        status: 'pending',
        submittedById: authUser.id,
        createdAt: now,
        updatedAt: now,
      },
      include: bonusIncludes,
    })

    // Notify the employee
    if (employee.userId) {
      await prisma.hrNotification.create({
        data: {
          userId: employee.userId,
          notificationType: 'bonus_applied',
          title: 'Bonus Submitted',
          message: `A bonus "${bonusRule.nameEn}" of ${bonusAmount} ${employee.currency} has been submitted for your account.`,
          isRead: false,
          relatedObjectType: 'Bonus',
          relatedObjectId: bonus.id,
          createdAt: now,
        },
      })
    }

    await createAuditLog({
      userId: authUser.id,
      action: 'create',
      entityType: 'bonus',
      entityId: bonus.id,
      details: `Created bonus for employee ${employee.employeeId}, amount ${bonusAmount}`,
      ipAddress: getClientIp(request),
    })

    return NextResponse.json(serializeBonus(bonus), { status: 201 })
  } catch (error) {
    if (error instanceof Response) return error
    console.error('Bonus create error:', error)
    return NextResponse.json({ detail: 'Server error.' }, { status: 500 })
  }
}
