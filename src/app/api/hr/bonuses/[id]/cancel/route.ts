import { NextResponse } from 'next/server'
import { db as prisma } from '@/lib/db'
import { requireAuth } from '@/lib/hr/auth-utils'
import { isHROrAdmin, canAccessCompany } from '@/lib/hr/permissions'
import { cancelBonusSchema } from '@/lib/hr/validations'

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

    const bonus = await prisma.hrBonus.findUnique({ where: { id: pk } })
    if (!bonus) return NextResponse.json({ detail: 'Not found.' }, { status: 404 })

    // audit v12 HIGH (HIGH-57) recheck: validate cross-company access before cancelling.
    const emp = await prisma.hrEmployee.findUnique({
      where: { id: bonus.employeeId },
      select: { companyId: true },
    })
    if (emp && !canAccessCompany(authUser, emp.companyId)) {
      return NextResponse.json({ detail: 'Permission denied.' }, { status: 403 })
    }

    if (bonus.status !== 'pending') {
      return NextResponse.json({ detail: 'Only pending bonuses can be dismissed.' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const parsed = cancelBonusSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ detail: parsed.error.issues[0].message }, { status: 400 })
    }
    const dismissedReason = parsed.data.dismissed_reason || ''

    // Atomic transition: gate on `status: 'pending'` so a concurrent
    // approve/cancel can't both succeed.
    const txResult = await prisma.hrBonus.updateMany({
      where: { id: pk, status: 'pending' },
      data: {
        status: 'dismissed',
        approvedById: authUser.id,
        comments: dismissedReason || bonus.comments,
        updatedAt: new Date(),
      },
    })
    if (txResult.count === 0) {
      return NextResponse.json(
        { detail: 'Bonus is no longer pending — it was just actioned by someone else.' },
        { status: 409 },
      )
    }

    const updated = await prisma.hrBonus.findUnique({
      where: { id: pk },
      include: bonusIncludes,
    })

    return NextResponse.json(serializeBonus(updated!))
  } catch (error) {
    if (error instanceof Response) return error
    console.error('Bonus cancel error:', error)
    return NextResponse.json({ detail: 'Server error.' }, { status: 500 })
  }
}
