import { NextResponse } from 'next/server'
import { db as prisma } from '@/lib/db'
import { requireAuth } from '@/lib/hr/auth-utils'
import { isHROrAdmin, isSuperAdmin } from '@/lib/hr/permissions'
import { serializeEmployeeDetail } from '@/lib/hr/employee-serializer'
import { createAuditLog, getClientIp } from '@/lib/hr/audit'

const employeeIncludes = {
  company: true,
  department: true,
  shift: true,
  directManager: true,
  user: true,
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authUser = await requireAuth(request)
    const { id } = await params
    const employee = await prisma.hrEmployee.findUnique({
      where: { id: id },
      include: employeeIncludes,
    })
    if (!employee) return NextResponse.json({ detail: 'Not found.' }, { status: 404 })

    // audit v12 HIGH (HIGH-54) recheck — enforce company scope for ALL non-super_admin roles
    // (hr_manager, ceo, accountant, etc.) to prevent cross-tenant leakage of salary/nationalId/IBAN.
    if (!isSuperAdmin(authUser)) {
      if (!authUser.companies.includes(employee.companyId)) {
        return NextResponse.json({ detail: 'Not found.' }, { status: 404 })
      }
    }

    return NextResponse.json(serializeEmployeeDetail(employee))
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

    let body: any
    const contentType = request.headers.get('content-type') || ''
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      body = Object.fromEntries(formData.entries())
    } else {
      body = await request.json()
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() }

    const fieldMap: Record<string, string> = {
      full_name_en: 'fullNameEn',
      full_name_ar: 'fullNameAr',
      national_id: 'nationalId',
      gender: 'gender',
      personal_email: 'personalEmail',
      phone: 'phone',
      address: 'address',
      emergency_contact_name: 'emergencyContactName',
      emergency_contact_phone: 'emergencyContactPhone',
      position_en: 'positionEn',
      position_ar: 'positionAr',
      level: 'level',
      employment_type: 'employmentType',
      work_model: 'workModel',
      status: 'status',
      currency: 'currency',
      bank_name: 'bankName',
      bank_account: 'bankAccount',
      iban: 'iban',
    }

    for (const [apiField, prismaField] of Object.entries(fieldMap)) {
      if (body[apiField] !== undefined) updateData[prismaField] = body[apiField]
    }

    if (body.date_of_birth !== undefined) updateData.dateOfBirth = body.date_of_birth ? new Date(body.date_of_birth) : null
    if (body.contract_start !== undefined) updateData.contractStart = body.contract_start ? new Date(body.contract_start) : null
    if (body.contract_end !== undefined) updateData.contractEnd = body.contract_end ? new Date(body.contract_end) : null
    if (body.probation_end !== undefined) updateData.probationEnd = body.probation_end ? new Date(body.probation_end) : null
    if (body.base_salary !== undefined) updateData.baseSalary = parseFloat(body.base_salary)
    if (body.company !== undefined) updateData.companyId = body.company
    if (body.department !== undefined) updateData.departmentId = body.department ? body.department : null
    if (body.direct_manager !== undefined) updateData.directManagerId = body.direct_manager ? body.direct_manager : null
    if (body.shift !== undefined) updateData.shiftId = body.shift ? body.shift : null

    const oldEmployee = await prisma.hrEmployee.findUnique({ where: { id: pk } })

    await prisma.hrEmployee.update({ where: { id: pk }, data: updateData })

    const employee = await prisma.hrEmployee.findUnique({
      where: { id: pk },
      include: employeeIncludes,
    })

    await createAuditLog({
      userId: authUser.id,
      action: 'update',
      entityType: 'employee',
      entityId: pk,
      details: `Updated employee ${oldEmployee?.employeeId || pk}`,
      ipAddress: getClientIp(request),
    })

    return NextResponse.json(serializeEmployeeDetail(employee!))
  } catch (error) {
    if (error instanceof Response) return error
    console.error('Employee update error:', error)
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

    await prisma.hrEmployee.delete({ where: { id: pk } })

    await createAuditLog({
      userId: authUser.id,
      action: 'delete',
      entityType: 'employee',
      entityId: pk,
      details: `Deleted employee ${pk}`,
      ipAddress: getClientIp(request),
    })

    return NextResponse.json({ detail: 'Employee deleted.' }, { status: 200 })
  } catch (error) {
    if (error instanceof Response) return error
    return NextResponse.json({ detail: 'Server error.' }, { status: 500 })
  }
}
