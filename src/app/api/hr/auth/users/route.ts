import { NextResponse } from 'next/server'
import { db as prisma } from '@/lib/db'
import { requireAuth, type AuthUser } from '@/lib/hr/auth-utils'
import { isHROrAdmin, isSuperAdmin } from '@/lib/hr/permissions'
import { serializeUser } from '@/lib/hr/serializers'
import { validatePassword } from '@/lib/hr/validations/auth'
import { z } from 'zod'

// POST create-user body (superset of createUserSchema for legacy role_names / phone / username)
const createHrUserSchema = z.object({
  email: z.email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
  username: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  phone: z.string().optional(),
  role_names: z.array(z.string()).optional(),
})
import bcrypt from 'bcryptjs'
import { createAuditLog, getClientIp } from '@/lib/hr/audit'

const VALID_ROLES = ['super_admin', 'hr_manager', 'team_lead', 'accountant', 'employee', 'ceo']

export async function GET(request: Request) {
  try {
    const authUser = await requireAuth(request)
    if (!isHROrAdmin(authUser)) {
      return NextResponse.json({ detail: 'Permission denied.' }, { status: 403 })
    }

    const profiles = await prisma.hrUserProfile.findMany({
      include: {
        user: true,
        roles: { include: { role: true } },
        companies: true,
        employee: true,
      },
      orderBy: { userId: 'asc' },
    })

    const serialized = profiles.map((profile) => ({
      id: profile.userId,
      email: profile.user.email ?? '',
      username: profile.username,
      first_name: profile.firstName,
      last_name: profile.lastName,
      full_name: `${profile.firstName} ${profile.lastName}`.trim() || profile.user.email,
      phone: profile.phone,
      avatar: profile.avatar,
      roles: profile.roles.map((ur) => ur.role.name),
      employee_id: profile.employee?.employeeId || null,
      linked_employee: profile.employee
        ? { id: profile.employee.id, employee_id: profile.employee.employeeId, name: profile.employee.fullNameEn }
        : null,
      companies: profile.companies.map((uc) => uc.companyId),
      is_active: profile.isActive,
      created_at: profile.createdAt.toISOString(),
    }))

    return NextResponse.json(serialized)
  } catch (error) {
    if (error instanceof Response) return error
    return NextResponse.json({ detail: 'Server error.' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const authUser = await requireAuth(request)
    if (!isSuperAdmin(authUser)) {
      return NextResponse.json({ detail: 'Permission denied.' }, { status: 403 })
    }

    const body = await request.json()
    const parsed = createHrUserSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ detail: parsed.error.issues[0].message }, { status: 400 })
    }
    const { email, username, first_name, last_name, phone, password, role_names } = parsed.data

    // Validate password strength
    const passwordCheck = validatePassword(password)
    if (!passwordCheck.valid) {
      return NextResponse.json(
        { detail: 'Password does not meet requirements.', errors: passwordCheck.errors },
        { status: 400 }
      )
    }

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return NextResponse.json({ email: ['A user with this email already exists.'] }, { status: 400 })
    }

    const hashedPassword = await bcrypt.hash(password, 12)
    const now = new Date()

    // Create the shared User record first
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        hrAccess: true,
        createdAt: now,
        updatedAt: now,
      },
    })

    // Create the HR profile
    await prisma.hrUserProfile.create({
      data: {
        userId: user.id,
        username: username || email.split('@')[0],
        firstName: first_name || '',
        lastName: last_name || '',
        phone: phone || '',
        isActive: true,
        isSuperuser: false,
        isStaff: false,
        dateJoined: now,
      },
    })

    // Assign roles
    if (role_names && Array.isArray(role_names)) {
      const invalidRoles = role_names.filter((r: string) => !VALID_ROLES.includes(r))
      if (invalidRoles.length > 0) {
        return NextResponse.json(
          { detail: `Invalid role(s): ${invalidRoles.join(', ')}. Valid roles: ${VALID_ROLES.join(', ')}` },
          { status: 400 }
        )
      }
      for (const roleName of role_names) {
        let role = await prisma.hrRole.findUnique({ where: { name: roleName } })
        if (!role) {
          role = await prisma.hrRole.create({ data: { name: roleName } })
        }
        await prisma.hrUserRole.create({
          data: { userId: user.id, roleId: role.id },
        })
      }
    }

    // audit v12 MEDIUM (MED-52): AuthUser carries no impersonation field today;
    // actingAdminId will remain undefined until the HR JWT is extended to carry
    // an actingAsUserId claim (see auth-utils.ts AuthUser interface).
    await createAuditLog({
      userId: authUser.id,
      action: 'create',
      entityType: 'user',
      entityId: user.id,
      details: `Created user ${email}`,
      ipAddress: getClientIp(request),
      actingAdminId: (authUser as AuthUser & { actingAsUserId?: string }).actingAsUserId,
    })

    const userData = await serializeUser(user.id)
    return NextResponse.json(userData, { status: 201 })
  } catch (error) {
    if (error instanceof Response) return error
    console.error('User create error:', error)
    return NextResponse.json({ detail: 'Server error.' }, { status: 500 })
  }
}
