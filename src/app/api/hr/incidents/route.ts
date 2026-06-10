import { NextResponse } from 'next/server'
import { db as prisma } from '@/lib/db'
import { requireAuth } from '@/lib/hr/auth-utils'
import { isHROrAdmin, hasAnyRole, canAccessCompany } from '@/lib/hr/permissions'
import { createIncidentSchema } from '@/lib/hr/validations'

const ACTION_DISPLAY: Record<string, string> = {
  verbal_warning: 'Verbal Warning',
  written_warning: 'Written Warning',
  deduction: 'Deduction',
  suspension: 'Suspension',
  termination: 'Termination',
}

const STATUS_DISPLAY: Record<string, string> = {
  pending: 'Pending',
  applied: 'Applied',
  dismissed: 'Dismissed',
}

const incidentIncludes = {
  employee: {
    include: {
      company: true,
      department: true,
    },
  },
  violationRule: {
    include: {
      category: true,
    },
  },
  submittedBy: true,
  approvedBy: true,
}

function serializeIncident(inc: any) {
  return {
    id: inc.id,
    employee: inc.employeeId,
    employee_name: inc.employee?.fullNameEn || '',
    employee_id_str: inc.employee?.employeeId || '',
    company_name: inc.employee?.company?.nameEn || '',
    department_name: inc.employee?.department?.nameEn || '',
    violation_rule: inc.violationRuleId,
    violation_rule_name: inc.violationRule?.nameEn || '',
    category_name: inc.violationRule?.category?.nameEn || '',
    violation_code: inc.violationRule?.code || '',
    incident_date: inc.incidentDate.toISOString().split('T')[0],
    offense_number: inc.offenseNumber,
    action_taken: inc.actionTaken,
    action_taken_display: ACTION_DISPLAY[inc.actionTaken] || inc.actionTaken,
    deduction_pct: parseFloat(inc.deductionPct),
    deduction_amount: parseFloat(inc.deductionAmount),
    status: inc.status,
    status_display: STATUS_DISPLAY[inc.status] || inc.status,
    comments: inc.comments,
    evidence: inc.evidence || null,
    submitted_by: inc.submittedById,
    submitted_by_email: inc.submittedBy?.email || '',
    reported_by_name: inc.submittedBy
      ? `${inc.submittedBy.firstName} ${inc.submittedBy.lastName}`.trim() || inc.submittedBy.email
      : '',
    approved_by: inc.approvedById,
    approved_by_email: inc.approvedBy?.email || null,
    approved_by_name: inc.approvedBy
      ? `${inc.approvedBy.firstName} ${inc.approvedBy.lastName}`.trim() || inc.approvedBy.email
      : null,
    dismissed_reason: inc.dismissedReason,
    created_at: inc.createdAt.toISOString(),
    updated_at: inc.updatedAt.toISOString(),
  }
}

export async function GET(request: Request) {
  try {
    const authUser = await requireAuth(request)
    const url = new URL(request.url)

    const where: any = {}

    // Regular employees can only see their own incidents
    const isPrivileged = hasAnyRole(authUser, ['super_admin', 'hr_manager', 'accountant', 'ceo'])
    if (!isPrivileged) {
      const emp = await prisma.hrEmployee.findFirst({ where: { userId: authUser.id } })
      if (!emp) return NextResponse.json([])
      where.employeeId = emp.id
    }

    // audit v12 HIGH (HIGH-52): scope non-super_admin privileged users to their allowed companies
    if (isPrivileged && !hasAnyRole(authUser, ['super_admin'])) {
      const allowedCompanies = authUser.companies ?? []
      const requestedCompany = url.searchParams.get('company')
      if (requestedCompany) {
        if (!allowedCompanies.includes(requestedCompany)) {
          return NextResponse.json([])
        }
        where.employee = { ...where.employee, companyId: requestedCompany }
      } else {
        where.employee = { ...where.employee, companyId: { in: allowedCompanies } }
      }
    }

    // Filter by employee
    const employeeId = url.searchParams.get('employee')
    if (employeeId) {
      where.employeeId = employeeId
    }

    // Filter by status
    const status = url.searchParams.get('status')
    if (status) where.status = status

    // Filter by action_taken
    const actionTaken = url.searchParams.get('action_taken')
    if (actionTaken) where.actionTaken = actionTaken

    // Filter by violation_rule
    const violationRuleId = url.searchParams.get('violation_rule')
    if (violationRuleId) {
      where.violationRuleId = violationRuleId
    }

    // Filter by company (through employee) — only for super_admin; non-super_admin privileged
    // users are already scoped above by the audit v12 HIGH (HIGH-52) block
    const companyId = url.searchParams.get('company')
    if (companyId && hasAnyRole(authUser, ['super_admin'])) {
      where.employee = { ...where.employee, companyId }
    }

    // Filter by department (through employee)
    const departmentId = url.searchParams.get('department')
    if (departmentId) {
      where.employee = { ...where.employee, departmentId }
    }

    // Filter by category (through violation rule)
    const categoryId = url.searchParams.get('category')
    if (categoryId) {
      where.violationRule = { ...where.violationRule, categoryId }
    }

    // Date range filters
    const startDate = url.searchParams.get('start_date') || url.searchParams.get('date_from')
    const endDate = url.searchParams.get('end_date') || url.searchParams.get('date_to')
    if (startDate || endDate) {
      where.incidentDate = {}
      if (startDate) where.incidentDate.gte = new Date(startDate)
      if (endDate) where.incidentDate.lte = new Date(endDate)
    }

    // Search filter
    const search = url.searchParams.get('search')
    if (search) {
      where.OR = [
        { employee: { fullNameEn: { contains: search } } },
        { employee: { employeeId: { contains: search } } },
        { violationRule: { code: { contains: search } } },
      ]
    }

    const incidents = await prisma.hrIncident.findMany({
      where,
      include: incidentIncludes,
      orderBy: { incidentDate: 'desc' },
    })

    return NextResponse.json(incidents.map(serializeIncident))
  } catch (error) {
    if (error instanceof Response) return error
    console.error('Incidents list error:', error)
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
    const parsed = createIncidentSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ detail: parsed.error.issues[0].message }, { status: 400 })
    }
    const data = parsed.data
    const now = new Date()

    const employeeId = data.employee
    const violationRuleId = data.violation_rule
    const incidentDate = new Date(data.incident_date)

    // Check if payroll period is locked
    const month = incidentDate.getMonth() + 1
    const year = incidentDate.getFullYear()

    const employee = await prisma.hrEmployee.findUnique({
      where: { id: employeeId },
      include: { directManager: true },
    })
    if (!employee) {
      return NextResponse.json({ detail: 'Employee not found.' }, { status: 400 })
    }

    // audit v12 HIGH: cross-company gate — prevent HR managers from filing incidents
    // against employees belonging to a company they do not have access to.
    if (!canAccessCompany(authUser, employee.companyId)) {
      return NextResponse.json({ detail: 'Permission denied.' }, { status: 403 })
    }

    const payrollPeriod = await prisma.hrPayrollPeriod.findFirst({
      where: {
        month,
        year,
        companyId: employee.companyId,
        status: { in: ['locked', 'finalized'] },
      },
    })
    if (payrollPeriod) {
      return NextResponse.json(
        { detail: `Cannot create incidents for ${payrollPeriod.status} payroll period (${month}/${year}).` },
        { status: 400 }
      )
    }

    // Get the violation rule with its category for offense calculation
    const violationRule = await prisma.hrViolationRule.findUnique({
      where: { id: violationRuleId },
      include: { category: true },
    })
    if (!violationRule) {
      return NextResponse.json({ detail: 'Violation rule not found.' }, { status: 400 })
    }

    // Employee already fetched above for payroll lock check

    // Calculate offense number within the reset period
    // audit v12 MEDIUM (MED-42) recheck: use true calendar-month subtraction
    // instead of the fixed 30-days-per-month approximation to avoid a shorter
    // window that drops legitimate prior offenses near the boundary.
    const resetMonths = violationRule.category.resetPeriodMonths
    const windowStart = new Date(incidentDate)
    windowStart.setMonth(windowStart.getMonth() - resetMonths)
    // Clamp end-of-month overshoot: if setMonth rolled into the next month
    // (e.g. Jan 31 - 1 month = Mar 3 due to Feb having 28 days), walk back
    // to the last day of the intended month.
    const expectedMonth = ((incidentDate.getMonth() - resetMonths) % 12 + 12) % 12
    if (windowStart.getMonth() !== expectedMonth) {
      windowStart.setDate(0) // setDate(0) = last day of previous month
    }

    const existingCount = await prisma.hrIncident.count({
      where: {
        employeeId,
        violationRuleId,
        incidentDate: { gte: windowStart },
        status: { in: ['pending', 'applied'] },
      },
    })

    const offenseNum = existingCount + 1

    // Get the action and deduction percentage for this offense number
    const offenseAction = getOffenseAction(violationRule, offenseNum)
    const deductionPct = data.deduction_pct !== undefined
      ? parseFloat(String(data.deduction_pct))
      : offenseAction.deductionPct
    const actionTaken = data.action_taken || offenseAction.action
    const deductionAmount = (deductionPct / 100) * parseFloat(employee.baseSalary.toString())

    const incident = await prisma.hrIncident.create({
      data: {
        employeeId,
        violationRuleId,
        incidentDate,
        offenseNumber: offenseNum,
        actionTaken,
        deductionPct,
        deductionAmount,
        status: data.status || 'pending',
        comments: data.comments || '',
        evidence: data.evidence || null,
        dismissedReason: '',
        submittedById: authUser.id,
        createdAt: now,
        updatedAt: now,
      },
      include: incidentIncludes,
    })

    // Notify the employee
    if (employee.userId) {
      await prisma.hrNotification.create({
        data: {
          userId: employee.userId,
          notificationType: 'incident',
          title: 'Incident Filed Against You',
          message: `An incident has been filed: ${violationRule.nameEn} (Offense #${offenseNum}). Action: ${ACTION_DISPLAY[actionTaken] || actionTaken}.`,
          isRead: false,
          relatedObjectType: 'Incident',
          relatedObjectId: incident.id,
          createdAt: now,
        },
      })
    }

    // Notify direct manager if exists
    if (employee.directManager?.userId) {
      await prisma.hrNotification.create({
        data: {
          userId: employee.directManager.userId,
          notificationType: 'incident_created',
          title: 'Incident Reported for Team Member',
          message: `An incident was reported for ${employee.fullNameEn}: ${violationRule.nameEn || 'incident'}`,
          isRead: false,
          relatedObjectType: 'Incident',
          relatedObjectId: incident.id,
          createdAt: now,
        },
      })
    }

    return NextResponse.json(serializeIncident(incident), { status: 201 })
  } catch (error) {
    if (error instanceof Response) return error
    console.error('Incident create error:', error)
    return NextResponse.json({ detail: 'Server error.' }, { status: 500 })
  }
}

function getOffenseAction(rule: any, offenseNum: number): { action: string; deductionPct: number } {
  const clamped = Math.min(offenseNum, 5)
  const actionField = `offense${clamped}Action`
  const pctField = `offense${clamped}DeductionPct`
  return {
    action: rule[actionField] || 'termination',
    deductionPct: parseFloat(rule[pctField] || '0'),
  }
}
