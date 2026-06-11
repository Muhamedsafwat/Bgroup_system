import { NextResponse } from 'next/server'
import { db as prisma } from '@/lib/db'
import { requireAuth } from '@/lib/hr/auth-utils'

export async function GET(request: Request) {
  try {
    await requireAuth(request)
    const { searchParams } = new URL(request.url)
    const companyId = searchParams.get('company')
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const month = today.getMonth() + 1
    const year = today.getFullYear()
    const startOfMonth = new Date(year, month - 1, 1)
    const endOfMonth = new Date(year, month, 0, 23, 59, 59)

    const empWhere: Record<string, unknown> = { status: { in: ['active', 'probation'] } }
    const allEmpWhere: Record<string, unknown> = {}
    if (companyId) {
      const cid = companyId
      empWhere.companyId = cid
      allEmpWhere.companyId = cid
    }

    const [totalEmployees, activeEmployees] = await Promise.all([
      prisma.hrEmployee.count({ where: allEmpWhere }),
      prisma.hrEmployee.count({ where: { ...empWhere, status: 'active' } }),
    ])

    // Attendance rate today
    const logWhere: Record<string, unknown> = { date: { gte: today, lt: tomorrow } }
    if (companyId) logWhere.employee = { companyId: companyId }
    const [totalToday, presentToday] = await Promise.all([
      prisma.hrAttendanceLog.count({ where: logWhere }),
      prisma.hrAttendanceLog.count({ where: { ...logWhere, status: { in: ['on_time', 'late'] } } }),
    ])
    const attendanceRate = totalToday > 0 ? Math.round((presentToday / totalToday) * 100) : 0

    // Pending overtime
    const otWhere: Record<string, unknown> = { status: 'pending' }
    if (companyId) otWhere.employee = { companyId: companyId }
    const pendingOvertime = await prisma.hrOvertimeRequest.count({ where: otWhere })

    // audit v12 LOW (LOW-9) ultra — use a real DB count for pending incidents so
    // the Action Queue tile is never capped by the recentIncidents take:10 limit.
    const incPendingWhere: Record<string, unknown> = { status: 'pending' }
    if (companyId) incPendingWhere.employee = { companyId: companyId }
    const pendingIncidents = await prisma.hrIncident.count({ where: incPendingWhere })

    // Monthly salary budget
    const salaryWhere: Record<string, unknown> = { month, year }
    if (companyId) salaryWhere.employee = { companyId: companyId }
    const salaryAgg = await prisma.hrMonthlySalary.aggregate({
      where: salaryWhere,
      _sum: { netSalary: true },
    })
    let monthlySalaryBudget = Number(salaryAgg._sum.netSalary || 0)
    if (monthlySalaryBudget === 0) {
      const baseAgg = await prisma.hrEmployee.aggregate({
        where: empWhere,
        _sum: { baseSalary: true },
      })
      monthlySalaryBudget = Number(baseAgg._sum.baseSalary || 0)
    }

    // Incidents this month
    const incWhere: Record<string, unknown> = {
      incidentDate: { gte: startOfMonth, lte: endOfMonth },
    }
    if (companyId) incWhere.employee = { companyId: companyId }
    const incidentsThisMonth = await prisma.hrIncident.count({ where: incWhere })

    // Bonuses this month
    const bonWhere: Record<string, unknown> = {
      bonusDate: { gte: startOfMonth, lte: endOfMonth },
    }
    if (companyId) bonWhere.employee = { companyId: companyId }
    const bonusesThisMonth = await prisma.hrBonus.count({ where: bonWhere })

    // Employees on leave today
    const leaveWhere: Record<string, unknown> = {
      date: { gte: today, lt: tomorrow },
      status: 'leave',
    }
    if (companyId) leaveWhere.employee = { companyId: companyId }
    const employeesOnLeave = await prisma.hrAttendanceLog.count({ where: leaveWhere })

    // Probation
    const probWhere: Record<string, unknown> = { status: 'probation' }
    if (companyId) probWhere.companyId = companyId
    const employeesOnProbation = await prisma.hrEmployee.count({ where: probWhere })

    // Contracts expiring in 30 days
    const in30 = new Date(today)
    in30.setDate(in30.getDate() + 30)
    const contractWhere: Record<string, unknown> = {
      contractEnd: { gte: today, lte: in30 },
      status: { in: ['active', 'probation'] },
    }
    if (companyId) contractWhere.companyId = companyId
    const contractsExpiringSoon = await prisma.hrEmployee.count({ where: contractWhere })

    return NextResponse.json({
      total_employees: totalEmployees,
      active_employees: activeEmployees,
      attendance_rate: attendanceRate,
      pending_overtime: pendingOvertime,
      pending_incidents: pendingIncidents,
      monthly_salary_budget: monthlySalaryBudget,
      incidents_this_month: incidentsThisMonth,
      bonuses_this_month: bonusesThisMonth,
      employees_on_leave: employeesOnLeave,
      employees_on_probation: employeesOnProbation,
      contracts_expiring_soon: contractsExpiringSoon,
    })
  } catch (error) {
    if (error instanceof Response) return error
    console.error('Dashboard metrics error:', error)
    return NextResponse.json({ detail: 'Server error.' }, { status: 500 })
  }
}
