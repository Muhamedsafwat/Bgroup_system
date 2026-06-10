import { NextResponse } from 'next/server'
import { db as prisma } from '@/lib/db'
import { requireAuth } from '@/lib/hr/auth-utils'
import { isHROrAdmin, canViewAllEmployees, isSuperAdmin } from '@/lib/hr/permissions'
import { serializeEmployeeList, serializeEmployeeDetail } from '@/lib/hr/employee-serializer'
import { createAuditLog, getClientIp } from '@/lib/hr/audit'
import { createEmployeeSchema } from '@/lib/hr/validations/employee'
import { validateBody } from '@/lib/hr/validations/common'

const employeeIncludes = {
  company: true,
  department: true,
  shift: true,
  directManager: true,
  user: true,
}

export async function GET(request: Request) {
  try {
    const authUser = await requireAuth(request)
    const url = new URL(request.url)

    const where: any = {}
    const company = url.searchParams.get('company')
    const department = url.searchParams.get('department')
    const status = url.searchParams.get('status')
    const employmentType = url.searchParams.get('employment_type')
    const workModel = url.searchParams.get('work_model')
    const level = url.searchParams.get('level')
    const gender = url.searchParams.get('gender')
    const search = url.searchParams.get('search')

    if (company) {
      where.companyId = company
    }
    if (department) {
      where.departmentId = department
    }
    if (status) where.status = status
    if (employmentType) where.employmentType = employmentType
    if (workModel) where.workModel = workModel
    if (level) where.level = level
    if (gender) where.gender = gender

    if (search) {
      where.OR = [
        { fullNameEn: { contains: search } },
        { fullNameAr: { contains: search } },
        { employeeId: { contains: search } },
        { nationalId: { contains: search } },
        { personalEmail: { contains: search } },
        { phone: { contains: search } },
      ]
    }

    // audit v12 HIGH: canViewAllEmployees roles (accountant, ceo, hr_manager) must still be
    // scoped to their own companies; only super_admin may query across all tenants.
    if (!canViewAllEmployees(authUser)) {
      where.companyId = { in: authUser.companies }
    } else if (!isSuperAdmin(authUser)) {
      // Non-super_admin with view-all permission: restrict to their assigned companies
      // to prevent cross-tenant employee/salary/nationalId/IBAN leakage.
      if (!where.companyId) {
        where.companyId = { in: authUser.companies }
      }
    }

    const orderBy = url.searchParams.get('ordering') || 'employee_id'
    const orderDir = orderBy.startsWith('-') ? 'desc' as const : 'asc' as const
    const orderField = orderBy.replace('-', '')
    const fieldMap: Record<string, string> = {
      employee_id: 'employeeId',
      full_name_en: 'fullNameEn',
      created_at: 'createdAt',
      base_salary: 'baseSalary',
    }

    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1)
    const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('page_size') || '20', 10) || 20))
    const skip = (page - 1) * pageSize

    const [employees, totalCount] = await Promise.all([
      prisma.hrEmployee.findMany({
        where,
        skip,
        take: pageSize,
        include: employeeIncludes,
        orderBy: { [fieldMap[orderField] || 'employeeId']: orderDir },
      }),
      prisma.hrEmployee.count({ where }),
    ])

    return NextResponse.json({
      count: totalCount,
      page,
      page_size: pageSize,
      total_pages: Math.ceil(totalCount / pageSize),
      results: employees.map(serializeEmployeeList),
    })
  } catch (error) {
    if (error instanceof Response) return error
    console.error('Employee list error:', error)
    return NextResponse.json({ detail: 'Server error.' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const authUser = await requireAuth(request)
    if (!isHROrAdmin(authUser)) {
      return NextResponse.json({ detail: 'Permission denied.' }, { status: 403 })
    }

    let body: any
    const contentType = request.headers.get('content-type') || ''
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      body = Object.fromEntries(formData.entries())
    } else {
      body = await request.json()
    }

    // For JSON content type, validate with Zod
    if (!contentType.includes('multipart/form-data')) {
      const validation = validateBody(createEmployeeSchema, body)
      if (!validation.success) return validation.response
    }

    const now = new Date()
    const companyId = body.company

    // Generate employee ID
    const company = await prisma.hrCompany.findUnique({ where: { id: companyId } })
    if (!company) {
      return NextResponse.json({ detail: 'Company not found.' }, { status: 400 })
    }
    const prefix = company.nameEn.includes('ByteForce') ? 'BF' :
                   company.nameEn.includes('B-Systems') ? 'BS' : 'BP'
    const lastEmp = await prisma.hrEmployee.findFirst({
      where: { employeeId: { startsWith: prefix } },
      orderBy: { employeeId: 'desc' },
    })
    const seq = lastEmp ? parseInt(lastEmp.employeeId.replace(prefix + '-', ''), 10) + 1 : 1
    const employeeIdStr = `${prefix}-${String(seq).padStart(3, '0')}`

    // Hoist password derivation outside the transaction (async crypto, no DB side-effects)
    let hashedPassword: string | undefined
    if (body.work_email) {
      const bcrypt = await import('bcryptjs')
      const crypto = await import('crypto')
      const tempPassword = crypto.randomBytes(6).toString('hex')
      hashedPassword = await bcrypt.hash(tempPassword, 12)
    }

    // audit v12 HIGH (HIGH-55) ultra: Wrap all writes in a single transaction so that
    // any failure (email conflict, missing profile row, role creation, etc.) rolls back
    // atomically — eliminating orphaned HrEmployee rows and partially-committed User records.
    // The email-conflict check is moved BEFORE the hrEmployee.create so no compensating
    // delete is ever needed.
    let conflictEmail = false
    const employee = await prisma.$transaction(async (tx) => {
      // 1. Check email conflict FIRST — before any writes
      if (body.work_email) {
        const existingUser = await tx.user.findUnique({ where: { email: body.work_email } })
        if (existingUser) {
          conflictEmail = true
          // Throwing inside a $transaction causes an automatic rollback (no writes committed yet)
          throw Object.assign(new Error('CONFLICT_EMAIL'), { isConflict: true })
        }
      }

      // 2. Create employee row
      const emp = await tx.hrEmployee.create({
        data: {
          employeeId: employeeIdStr,
          fullNameEn: body.full_name_en || '',
          fullNameAr: body.full_name_ar || '',
          nationalId: body.national_id || `NID-${Date.now()}`,
          dateOfBirth: body.date_of_birth ? new Date(body.date_of_birth) : null,
          gender: body.gender || '',
          personalEmail: body.personal_email || '',
          phone: body.phone || '',
          address: body.address || '',
          emergencyContactName: body.emergency_contact_name || '',
          emergencyContactPhone: body.emergency_contact_phone || '',
          positionEn: body.position_en || '',
          positionAr: body.position_ar || '',
          level: body.level || '',
          employmentType: body.employment_type || 'full_time',
          workModel: body.work_model || 'onsite',
          contractStart: body.contract_start ? new Date(body.contract_start) : null,
          contractEnd: body.contract_end ? new Date(body.contract_end) : null,
          probationEnd: body.probation_end ? new Date(body.probation_end) : null,
          status: body.status || 'active',
          baseSalary: parseFloat(body.base_salary) || 0,
          currency: body.currency || 'EGP',
          bankName: body.bank_name || '',
          bankAccount: body.bank_account || '',
          iban: body.iban || '',
          companyId,
          departmentId: body.department ? body.department : null,
          directManagerId: body.direct_manager ? body.direct_manager : null,
          shiftId: body.shift ? body.shift : null,
          createdAt: now,
          updatedAt: now,
        },
        include: employeeIncludes,
      })

      // 3. If work_email provided, create linked user + profile + role within the same transaction
      if (body.work_email) {
        const newUser = await tx.user.create({
          data: {
            email: body.work_email,
            password: hashedPassword!,
            hrAccess: true,
            createdAt: now,
            updatedAt: now,
          },
        })

        // Create the HR profile for the new user
        await tx.hrUserProfile.create({
          data: {
            userId: newUser.id,
            username: body.work_email,
            firstName: emp.fullNameEn.split(' ')[0] || '',
            lastName: emp.fullNameEn.split(' ').slice(1).join(' ') || '',
            phone: '',
            isActive: true,
            isSuperuser: false,
            isStaff: false,
            dateJoined: now,
          },
        })

        await tx.hrEmployee.update({
          where: { id: emp.id },
          data: { userId: newUser.id },
        })

        // Assign default 'employee' role
        let employeeRole = await tx.hrRole.findUnique({ where: { name: 'employee' } })
        if (!employeeRole) {
          employeeRole = await tx.hrRole.create({ data: { name: 'employee' } })
        }
        await tx.hrUserRole.create({
          data: { userId: newUser.id, roleId: employeeRole.id },
        })
      }

      return emp
    }).catch((err: any) => {
      if (err?.isConflict) return null
      throw err
    })

    // Return 409 if the email conflict was detected inside the transaction
    if (conflictEmail || employee === null) {
      return NextResponse.json(
        { detail: 'The work email address is already associated with an existing account. The account owner must opt in to link their account to the HR module.' },
        { status: 409 }
      )
    }

    const created = await prisma.hrEmployee.findUnique({
      where: { id: employee!.id },
      include: employeeIncludes,
    })

    await createAuditLog({
      userId: authUser.id,
      action: 'create',
      entityType: 'employee',
      entityId: employee!.id,
      details: `Created employee ${employeeIdStr} (${body.full_name_en || ''})`,
      ipAddress: getClientIp(request),
    })

    return NextResponse.json(serializeEmployeeDetail(created!), { status: 201 })
  } catch (error) {
    if (error instanceof Response) return error
    console.error('Employee create error:', error)
    return NextResponse.json({ detail: 'Server error.' }, { status: 500 })
  }
}
