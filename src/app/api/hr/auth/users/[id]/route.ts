import { NextResponse } from 'next/server'
import { db as prisma } from '@/lib/db'
import { requireAuth, type AuthUser } from '@/lib/hr/auth-utils'
import { isSuperAdmin } from '@/lib/hr/permissions'
import { serializeUser } from '@/lib/hr/serializers'
import { createAuditLog, getClientIp } from '@/lib/hr/audit'
import { validatePassword } from '@/lib/hr/validations/auth'
import { updateUserSchema } from '@/lib/hr/validations'
import bcrypt from 'bcryptjs'

const VALID_ROLES = ['super_admin', 'hr_manager', 'team_lead', 'accountant', 'employee', 'ceo']

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authUser = await requireAuth(request)
    if (!isSuperAdmin(authUser)) {
      return NextResponse.json({ detail: 'Permission denied.' }, { status: 403 })
    }

    const { id } = await params
    const pk = id
    const user = await prisma.user.findUnique({ where: { id: pk } })
    if (!user) {
      return NextResponse.json({ detail: 'User not found.' }, { status: 404 })
    }

    const body = await request.json()
    const parsed = updateUserSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ detail: parsed.error.issues[0].message }, { status: 400 })
    }
    const data = parsed.data

    // Update HR profile fields
    const profileUpdateData: Record<string, unknown> = { updatedAt: new Date() }
    if (data.first_name !== undefined) profileUpdateData.firstName = data.first_name
    if (data.last_name !== undefined) profileUpdateData.lastName = data.last_name
    if (data.phone !== undefined) profileUpdateData.phone = data.phone
    if (data.is_active !== undefined) profileUpdateData.isActive = data.is_active

    // Update password on the User model (password lives on User, not HrUserProfile)
    if (data.password) {
      const passwordCheck = validatePassword(data.password)
      if (!passwordCheck.valid) {
        return NextResponse.json(
          { detail: 'Password does not meet requirements.', errors: passwordCheck.errors },
          { status: 400 }
        )
      }
      await prisma.user.update({
        where: { id: pk },
        data: { password: await bcrypt.hash(data.password, 12) },
      })
    }

    // Update profile (upsert in case profile doesn't exist yet)
    await prisma.hrUserProfile.upsert({
      where: { userId: pk },
      update: profileUpdateData,
      create: {
        userId: pk,
        username: user.email ?? pk,
        firstName: data.first_name || '',
        lastName: data.last_name || '',
        phone: data.phone || '',
        isActive: data.is_active ?? true,
      },
    })

    // Update roles
    if (data.role_names) {
      const invalidRoles = data.role_names.filter((r: string) => !VALID_ROLES.includes(r))
      if (invalidRoles.length > 0) {
        return NextResponse.json(
          { detail: `Invalid role(s): ${invalidRoles.join(', ')}. Valid roles: ${VALID_ROLES.join(', ')}` },
          { status: 400 }
        )
      }
      await prisma.hrUserRole.deleteMany({ where: { userId: pk } })
      for (const roleName of data.role_names) {
        let role = await prisma.hrRole.findUnique({ where: { name: roleName } })
        if (!role) {
          role = await prisma.hrRole.create({ data: { name: roleName } })
        }
        await prisma.hrUserRole.create({
          data: { userId: pk, roleId: role.id },
        })
      }
    }

    // Update companies
    if (data.company_ids) {
      await prisma.hrUserCompany.deleteMany({ where: { userId: pk } })
      for (const companyId of data.company_ids) {
        await prisma.hrUserCompany.create({
          data: { userId: pk, companyId: String(companyId) },
        })
      }
    }

    // Link/unlink employee
    if (data.link_employee_id !== undefined) {
      // Unlink current employee
      const currentEmployee = await prisma.hrEmployee.findUnique({ where: { userId: pk } })
      if (currentEmployee) {
        await prisma.hrEmployee.update({
          where: { id: currentEmployee.id },
          data: { userId: null },
        })
      }
      // Link new employee
      if (data.link_employee_id) {
        await prisma.hrEmployee.update({
          where: { id: data.link_employee_id },
          data: { userId: pk },
        })
      }
    }

    const userData = await serializeUser(pk)

    // audit v12 MEDIUM (MED-52): AuthUser carries no impersonation field today;
    // actingAdminId will remain undefined until the HR JWT is extended to carry
    // an actingAsUserId claim (see auth-utils.ts AuthUser interface).
    await createAuditLog({
      userId: authUser.id,
      action: 'update',
      entityType: 'user',
      entityId: pk,
      details: `Updated user #${pk}`,
      ipAddress: getClientIp(request),
      actingAdminId: (authUser as AuthUser & { actingAsUserId?: string }).actingAsUserId,
    })

    return NextResponse.json(userData)
  } catch (error) {
    if (error instanceof Response) return error
    console.error('User update error:', error)
    return NextResponse.json({ detail: 'Server error.' }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authUser = await requireAuth(request)
    if (!isSuperAdmin(authUser)) {
      return NextResponse.json({ detail: 'Permission denied.' }, { status: 403 })
    }

    const { id } = await params
    const pk = id

    if (pk === authUser.id) {
      return NextResponse.json({ detail: 'You cannot delete your own account.' }, { status: 400 })
    }

    const user = await prisma.user.findUnique({ where: { id: pk } })
    if (!user) {
      return NextResponse.json({ detail: 'User not found.' }, { status: 404 })
    }

    // Clean up related HR records first (profile cascade will handle roles/companies)
    await prisma.hrUserRole.deleteMany({ where: { userId: pk } })
    await prisma.hrUserCompany.deleteMany({ where: { userId: pk } })
    await prisma.hrUserProfile.deleteMany({ where: { userId: pk } })
    await prisma.user.delete({ where: { id: pk } })

    // audit v12 MEDIUM (MED-52): pass actingAdminId when impersonation context exists.
    await createAuditLog({
      userId: authUser.id,
      action: 'delete',
      entityType: 'user',
      entityId: pk,
      details: `Deleted user #${pk}`,
      ipAddress: getClientIp(request),
      actingAdminId: (authUser as AuthUser & { actingAsUserId?: string }).actingAsUserId,
    })

    return NextResponse.json({ detail: 'User deleted successfully.' }, { status: 200 })
  } catch (error) {
    if (error instanceof Response) return error
    console.error('User delete error:', error)
    return NextResponse.json({ detail: 'Server error.' }, { status: 500 })
  }
}
