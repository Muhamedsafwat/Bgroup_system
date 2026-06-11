import { NextResponse } from 'next/server'
import { db as prisma } from '@/lib/db'
import { requireAuth } from '@/lib/hr/auth-utils'
import { isHROrAdmin, canAccessCompany } from '@/lib/hr/permissions'
import { resolveIncidentSchema } from '@/lib/hr/validations'

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
    const body = await request.json().catch(() => ({}))
    const parsed = resolveIncidentSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ detail: parsed.error.issues[0].message }, { status: 400 })
    }
    const data = parsed.data

    const existing = await prisma.hrIncident.findUnique({ where: { id: pk }, include: { employee: true } })
    if (!existing) {
      return NextResponse.json({ detail: 'Not found.' }, { status: 404 })
    }

    // audit v12 HIGH (HIGH-53) recheck — enforce company-scope gate before resolving
    if (!canAccessCompany(authUser, existing.employee.companyId)) {
      return NextResponse.json({ detail: 'Permission denied.' }, { status: 403 })
    }

    if (existing.status !== 'pending') {
      return NextResponse.json({ detail: 'Only pending incidents can be resolved.' }, { status: 400 })
    }

    const action = data.action || 'apply' // 'apply' or 'dismiss'
    const now = new Date()

    // Atomic gate on status='pending' so two concurrent resolves
    // can't both flip the row.
    let txResult: { count: number }
    if (action === 'dismiss') {
      txResult = await prisma.hrIncident.updateMany({
        where: { id: pk, status: 'pending' },
        data: {
          status: 'dismissed',
          dismissedReason: data.dismissed_reason || '',
          approvedById: authUser.id,
          deductionAmount: 0,
          deductionPct: 0,
          updatedAt: now,
        },
      })
    } else {
      // Apply the incident
      txResult = await prisma.hrIncident.updateMany({
        where: { id: pk, status: 'pending' },
        data: {
          status: 'applied',
          approvedById: authUser.id,
          updatedAt: now,
        },
      })
    }
    if (txResult.count === 0) {
      return NextResponse.json(
        { detail: 'Incident is no longer pending — it was just actioned by someone else.' },
        { status: 409 },
      )
    }

    const incident = await prisma.hrIncident.findUnique({
      where: { id: pk },
      include: incidentIncludes,
    })

    return NextResponse.json(serializeIncident(incident!))
  } catch (error) {
    if (error instanceof Response) return error
    console.error('Incident resolve error:', error)
    return NextResponse.json({ detail: 'Server error.' }, { status: 500 })
  }
}
