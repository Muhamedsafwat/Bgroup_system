import { NextResponse } from 'next/server'
import { db as prisma } from '@/lib/db'
import { requireAuth } from '@/lib/hr/auth-utils'
import { isHROrAdmin, canAccessCompany } from '@/lib/hr/permissions'
import { createAuditLog, getClientIp } from '@/lib/hr/audit'
import { updateIncidentSchema } from '@/lib/hr/validations'

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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authUser = await requireAuth(request)
    const { id } = await params
    const pk = id

    const incident = await prisma.hrIncident.findUnique({
      where: { id: pk },
      include: incidentIncludes,
    })
    if (!incident) {
      return NextResponse.json({ detail: 'Not found.' }, { status: 404 })
    }

    if (!isHROrAdmin(authUser)) {
      const ownEmp = await prisma.hrEmployee.findUnique({
        where: { userId: authUser.id },
        select: { id: true },
      })
      if (!ownEmp || incident.employeeId !== ownEmp.id) {
        return NextResponse.json({ detail: 'Not found.' }, { status: 404 })
      }
    }

    // audit v12 HIGH (HIGH-53) recheck — gate privileged users to their own company scope
    if (isHROrAdmin(authUser) && !canAccessCompany(authUser, incident.employee.companyId)) {
      return NextResponse.json({ detail: 'Not found.' }, { status: 404 })
    }

    await createAuditLog({
      userId: authUser.id,
      action: 'read',
      entityType: 'incident',
      entityId: incident.id,
      ipAddress: getClientIp(request),
      details: `Viewed incident for employee ${incident.employeeId}`,
    })

    return NextResponse.json(serializeIncident(incident))
  } catch (error) {
    if (error instanceof Response) return error
    console.error('Incident detail error:', error)
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
    const parsed = updateIncidentSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ detail: parsed.error.issues[0].message }, { status: 400 })
    }
    const data = parsed.data

    // audit v12 HIGH (HIGH-53) recheck — fetch before update to enforce company-scope gate
    const existing = await prisma.hrIncident.findUnique({ where: { id: pk }, include: { employee: true } })
    if (!existing) return NextResponse.json({ detail: 'Not found.' }, { status: 404 })
    if (!canAccessCompany(authUser, existing.employee.companyId)) {
      return NextResponse.json({ detail: 'Permission denied.' }, { status: 403 })
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() }

    if (data.employee !== undefined) updateData.employeeId = data.employee
    if (data.violation_rule !== undefined) updateData.violationRuleId = data.violation_rule
    if (data.incident_date !== undefined) updateData.incidentDate = new Date(data.incident_date)
    if (data.action_taken !== undefined) updateData.actionTaken = data.action_taken
    if (data.deduction_pct !== undefined) updateData.deductionPct = parseFloat(String(data.deduction_pct))
    if (data.deduction_amount !== undefined) updateData.deductionAmount = parseFloat(String(data.deduction_amount))
    if (data.status !== undefined) updateData.status = data.status
    if (data.comments !== undefined) updateData.comments = data.comments
    if (data.evidence !== undefined) updateData.evidence = data.evidence
    if (data.dismissed_reason !== undefined) updateData.dismissedReason = data.dismissed_reason

    const incident = await prisma.hrIncident.update({
      where: { id: pk },
      data: updateData,
      include: incidentIncludes,
    })

    return NextResponse.json(serializeIncident(incident))
  } catch (error) {
    if (error instanceof Response) return error
    console.error('Incident update error:', error)
    return NextResponse.json({ detail: 'Server error.' }, { status: 500 })
  }
}

export async function DELETE(
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

    // audit v12 HIGH (HIGH-53) recheck — fetch before delete to enforce company-scope gate
    const existing = await prisma.hrIncident.findUnique({ where: { id: pk }, include: { employee: true } })
    if (!existing) return NextResponse.json({ detail: 'Not found.' }, { status: 404 })
    if (!canAccessCompany(authUser, existing.employee.companyId)) {
      return NextResponse.json({ detail: 'Permission denied.' }, { status: 403 })
    }

    await prisma.hrIncident.delete({ where: { id: pk } })

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    if (error instanceof Response) return error
    console.error('Incident delete error:', error)
    return NextResponse.json({ detail: 'Server error.' }, { status: 500 })
  }
}
