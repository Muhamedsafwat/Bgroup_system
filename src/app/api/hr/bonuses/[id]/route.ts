import { NextResponse } from 'next/server'
import { db as prisma } from '@/lib/db'
import { requireAuth } from '@/lib/hr/auth-utils'
import { isHROrAdmin, canAccessCompany } from '@/lib/hr/permissions'
import { updateBonusSchema } from '@/lib/hr/validations'

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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authUser = await requireAuth(request)
    const { id } = await params
    const pk = id

    const bonus = await prisma.hrBonus.findUnique({
      where: { id: pk },
      include: bonusIncludes,
    })
    if (!bonus) return NextResponse.json({ detail: 'Not found.' }, { status: 404 })

    if (!isHROrAdmin(authUser)) {
      const ownEmp = await prisma.hrEmployee.findUnique({
        where: { userId: authUser.id },
        select: { id: true },
      })
      if (!ownEmp || bonus.employeeId !== ownEmp.id) {
        return NextResponse.json({ detail: 'Not found.' }, { status: 404 })
      }
    }

    return NextResponse.json(serializeBonus(bonus))
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
    const parsed = updateBonusSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ detail: parsed.error.issues[0].message }, { status: 400 })
    }
    const data = parsed.data
    const updateData: Record<string, unknown> = { updatedAt: new Date() }

    // audit v12 HIGH: validate cross-company access before writing any update.
    // Fetch the existing bonus to confirm the caller can access its current company.
    const existing = await prisma.hrBonus.findUnique({
      where: { id: pk },
      include: { employee: { select: { companyId: true } } },
    })
    if (!existing) {
      return NextResponse.json({ detail: 'Not found.' }, { status: 404 })
    }
    if (existing.employee && !canAccessCompany(authUser, existing.employee.companyId)) {
      return NextResponse.json({ detail: 'Permission denied.' }, { status: 403 })
    }

    // audit v12 HIGH: if reassigning to a different employee, verify the target
    // employee also belongs to a company the caller is authorised to access.
    if (data.employee !== undefined) {
      const targetEmployee = await prisma.hrEmployee.findUnique({
        where: { id: data.employee },
        select: { companyId: true },
      })
      if (!targetEmployee) {
        return NextResponse.json({ detail: 'Target employee not found.' }, { status: 400 })
      }
      if (!canAccessCompany(authUser, targetEmployee.companyId)) {
        return NextResponse.json({ detail: 'Permission denied.' }, { status: 403 })
      }
      updateData.employeeId = data.employee
    }

    if (data.bonus_date !== undefined) updateData.bonusDate = new Date(data.bonus_date)
    if (data.comments !== undefined) updateData.comments = data.comments
    if (data.evidence !== undefined) updateData.evidence = data.evidence
    if (data.bonus_rule !== undefined) updateData.bonusRuleId = data.bonus_rule

    const bonus = await prisma.hrBonus.update({
      where: { id: pk },
      data: updateData,
      include: bonusIncludes,
    })

    return NextResponse.json(serializeBonus(bonus))
  } catch (error) {
    if (error instanceof Response) return error
    console.error('Bonus update error:', error)
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

    // audit v12 HIGH (HIGH-57) recheck: validate cross-company access before deleting.
    const existing = await prisma.hrBonus.findUnique({
      where: { id: pk },
      include: { employee: { select: { companyId: true } } },
    })
    if (!existing) return NextResponse.json({ detail: 'Not found.' }, { status: 404 })
    if (existing.employee && !canAccessCompany(authUser, existing.employee.companyId)) {
      return NextResponse.json({ detail: 'Permission denied.' }, { status: 403 })
    }

    await prisma.hrBonus.delete({ where: { id: pk } })

    return NextResponse.json({ detail: 'Deleted.' })
  } catch (error) {
    if (error instanceof Response) return error
    console.error('Bonus delete error:', error)
    return NextResponse.json({ detail: 'Server error.' }, { status: 500 })
  }
}
