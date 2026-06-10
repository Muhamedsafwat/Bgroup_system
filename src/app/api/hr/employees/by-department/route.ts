import { NextResponse } from 'next/server'
import { db as prisma } from '@/lib/db'
import { requireAuth } from '@/lib/hr/auth-utils'
import { isSuperAdmin } from '@/lib/hr/permissions'
import { serializeEmployeeList } from '@/lib/hr/employee-serializer'

export async function GET(request: Request) {
  try {
    const authUser = await requireAuth(request)
    const url = new URL(request.url)
    const deptId = url.searchParams.get('department_id')

    if (!deptId) {
      return NextResponse.json({ detail: 'department_id is required.' }, { status: 400 })
    }

    // audit v12 HIGH (HIGH-54) recheck — enforce company scope for by-department queries
    // to prevent cross-tenant leakage; callers may only query departments in their companies.
    const dept = await prisma.hrDepartment.findUnique({ where: { id: deptId } })
    if (!dept) return NextResponse.json({ detail: 'Department not found.' }, { status: 404 })
    if (!isSuperAdmin(authUser) && !authUser.companies.includes(dept.companyId)) {
      return NextResponse.json({ detail: 'Permission denied.' }, { status: 403 })
    }

    const employees = await prisma.hrEmployee.findMany({
      where: { departmentId: deptId },
      include: { company: true, department: true, shift: true, directManager: true, user: true },
      orderBy: { employeeId: 'asc' },
    })

    return NextResponse.json(employees.map(serializeEmployeeList))
  } catch (error) {
    if (error instanceof Response) return error
    return NextResponse.json({ detail: 'Server error.' }, { status: 500 })
  }
}
