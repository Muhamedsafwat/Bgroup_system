import { NextResponse } from 'next/server'
import { db as prisma } from '@/lib/db'
import { requireAuth } from '@/lib/hr/auth-utils'
import { isHROrAdmin } from '@/lib/hr/permissions'

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

    if (bonus.status !== 'pending') {
      return NextResponse.json({ detail: 'Only pending bonuses can be applied.' }, { status: 400 })
    }

    // Atomic state-machine transition: only the race winner sees
    // count=1. The previous read-then-update pattern let two
    // concurrent approvals both pass the `status === 'pending'` gate
    // and double-apply (second approver overwriting the first).
    const txResult = await prisma.hrBonus.updateMany({
      where: { id: pk, status: 'pending' },
      data: {
        status: 'applied',
        approvedById: authUser.id,
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
    console.error('Bonus approve error:', error)
    return NextResponse.json({ detail: 'Server error.' }, { status: 500 })
  }
}
