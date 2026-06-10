import { NextResponse } from 'next/server'
import { db as prisma } from '@/lib/db'
import { requireAuth } from '@/lib/hr/auth-utils'
import { isHROrAdmin, canAccessCompany } from '@/lib/hr/permissions'

export async function POST(request: Request) {
  try {
    const authUser = await requireAuth(request)
    if (!isHROrAdmin(authUser)) {
      return NextResponse.json({ detail: 'Permission denied.' }, { status: 403 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) {
      return NextResponse.json({ detail: 'No file uploaded.' }, { status: 400 })
    }

    // audit v12 MEDIUM (MED-43): reject non-spreadsheet MIME types before parsing
    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ]
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ detail: 'Only .xlsx / .xls files are accepted.' }, { status: 400 })
    }

    const ExcelJS = await import('exceljs')
    const workbook = new ExcelJS.Workbook()
    const arrayBuf = await file.arrayBuffer()
    await workbook.xlsx.load(arrayBuf)

    const worksheet = workbook.worksheets[0]
    if (!worksheet) {
      return NextResponse.json({ detail: 'Empty workbook.' }, { status: 400 })
    }

    const headers: string[] = []
    worksheet.getRow(1).eachCell((cell, colNum) => {
      headers[colNum - 1] = String(cell.value || '').trim()
    })

    const created: string[] = []
    const errors: any[] = []

    for (let rowNum = 2; rowNum <= worksheet.rowCount; rowNum++) {
      const row = worksheet.getRow(rowNum)
      const rowData: Record<string, any> = {}
      headers.forEach((h, idx) => {
        const cell = row.getCell(idx + 1)
        rowData[h] = cell.value
      })

      if (!rowData.full_name_en) continue

      // Resolve company
      const company = await prisma.hrCompany.findFirst({
        where: { nameEn: { equals: rowData.company_name } },
      })
      if (!company) {
        errors.push({ row: rowNum, errors: { company_name: 'Company not found.' } })
        continue
      }

      // audit v12 MEDIUM (MED-43): verify the authenticated user's companies scope includes this company
      if (!canAccessCompany(authUser, company.id)) {
        errors.push({ row: rowNum, errors: { company_name: 'Access to this company is not permitted.' } })
        continue
      }

      // Resolve department
      let departmentId: string | null = null
      if (rowData.department_name) {
        const dept = await prisma.hrDepartment.findFirst({
          where: { companyId: company.id, nameEn: { equals: rowData.department_name } },
        })
        if (!dept) {
          errors.push({ row: rowNum, errors: { department_name: 'Department not found.' } })
          continue
        }
        departmentId = dept.id
      }

      // Check duplicate national_id
      const nationalId = rowData.national_id ? String(rowData.national_id) : ''
      if (nationalId) {
        const dup = await prisma.hrEmployee.findUnique({ where: { nationalId } })
        if (dup) {
          errors.push({ row: rowNum, errors: { national_id: 'Duplicate national ID.' } })
          continue
        }
      }

      // Generate employee ID
      const prefix = company.nameEn.includes('ByteForce') ? 'BF' :
                     company.nameEn.includes('B-Systems') ? 'BS' : 'BP'
      const lastEmp = await prisma.hrEmployee.findFirst({
        where: { employeeId: { startsWith: prefix } },
        orderBy: { employeeId: 'desc' },
      })
      const seq = lastEmp ? parseInt(lastEmp.employeeId.replace(prefix + '-', ''), 10) + 1 : 1
      const employeeIdStr = `${prefix}-${String(seq).padStart(3, '0')}`

      const now = new Date()
      await prisma.hrEmployee.create({
        data: {
          employeeId: employeeIdStr,
          fullNameEn: String(rowData.full_name_en || ''),
          fullNameAr: String(rowData.full_name_ar || ''),
          nationalId: nationalId || `NID-${Date.now()}-${rowNum}`,
          dateOfBirth: rowData.date_of_birth ? new Date(rowData.date_of_birth) : null,
          gender: String(rowData.gender || ''),
          personalEmail: String(rowData.personal_email || ''),
          phone: String(rowData.phone || ''),
          address: '',
          emergencyContactName: '',
          emergencyContactPhone: '',
          positionEn: String(rowData.position_en || ''),
          positionAr: '',
          level: String(rowData.level || ''),
          employmentType: String(rowData.employment_type || 'full_time'),
          workModel: String(rowData.work_model || 'onsite'),
          contractStart: rowData.contract_start ? new Date(rowData.contract_start) : null,
          contractEnd: rowData.contract_end ? new Date(rowData.contract_end) : null,
          probationEnd: null,
          status: String(rowData.status || 'active'),
          baseSalary: parseFloat(rowData.base_salary) || 0,
          currency: String(rowData.currency || 'EGP'),
          bankName: '',
          bankAccount: '',
          iban: '',
          companyId: company.id,
          departmentId,
          createdAt: now,
          updatedAt: now,
        },
      })

      created.push(employeeIdStr)
    }

    return NextResponse.json({
      created: created.length,
      errors: errors.length,
      created_ids: created,
      error_details: errors,
    })
  } catch (error) {
    if (error instanceof Response) return error
    console.error('Bulk import error:', error)
    return NextResponse.json({ detail: 'Server error.' }, { status: 500 })
  }
}
