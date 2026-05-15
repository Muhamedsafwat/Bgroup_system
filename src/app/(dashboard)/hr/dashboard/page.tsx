'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import {
  Users,
  Clock,
  TrendingUp,
  DollarSign,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Calendar,
  ShieldAlert,
} from 'lucide-react'
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from 'recharts'
import { dashboardApi, payrollApi } from '@/lib/hr/api'
import { useAuth } from '@/contexts/hr/AuthContext'
import { StatCard } from '@/components/hr/shared/StatCard'
import { PageHeader } from '@/components/hr/shared/PageHeader'
import { WelcomeBanner, firstNameOf } from '@/components/shared/WelcomeHero'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/hr/ui/card'
import { Badge } from '@/components/hr/ui/badge'
import { Button } from '@/components/hr/ui/button'
import { Skeleton } from '@/components/hr/ui/skeleton'
import { formatDate, formatCurrency } from '@/lib/hr/utils'
import type {
  DashboardMetrics,
  AttendanceWidget,
  Incident,
  AlertItem,
  DepartmentSalary,
  PayrollSummary,
} from '@/lib/hr/types'

// ─── Attendance Donut ─────────────────────────────────────────────────────────

const DONUT_COLORS = {
  present: '#10b981',
  late: '#f59e0b',
  absent: '#ef4444',
  on_leave: '#3b82f6',
}

function AttendanceDonut({ data }: { data: AttendanceWidget }) {
  const chartData = [
    { name: 'Present', value: data.present, color: DONUT_COLORS.present },
    { name: 'Late', value: data.late, color: DONUT_COLORS.late },
    { name: 'Absent', value: data.absent, color: DONUT_COLORS.absent },
    { name: 'On Leave', value: data.on_leave, color: DONUT_COLORS.on_leave },
  ].filter((d) => d.value > 0)

  return (
    <ResponsiveContainer width="100%" height={200}>
      <PieChart>
        <Pie
          data={chartData}
          cx="50%"
          cy="50%"
          innerRadius={55}
          outerRadius={85}
          paddingAngle={3}
          dataKey="value"
        >
          {chartData.map((entry, i) => (
            <Cell key={i} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip
          formatter={(value, name) => [Number(value), String(name)]}
          contentStyle={{
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            fontSize: '12px',
          }}
        />
      </PieChart>
    </ResponsiveContainer>
  )
}

// ─── Alerts Panel ─────────────────────────────────────────────────────────────

const alertIcons: Record<string, React.ReactNode> = {
  contract_expiry: <Calendar className="h-4 w-4" />,
  probation_end: <CheckCircle2 className="h-4 w-4" />,
  ot_cap: <TrendingUp className="h-4 w-4" />,
  late_warning: <Clock className="h-4 w-4" />,
  '3_lates': <ShieldAlert className="h-4 w-4" />,
}

const alertBadge: Record<string, 'warning' | 'danger' | 'info'> = {
  warning: 'warning',
  danger: 'danger',
  info: 'info',
}

function AlertsPanel({ alerts }: { alerts: AlertItem[] }) {
  if (!alerts.length) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <CheckCircle2 className="h-8 w-8 text-emerald-400 mb-2" />
        <p className="text-sm text-muted-foreground">No active alerts</p>
      </div>
    )
  }

  return (
    <div className="space-y-2 max-h-72 overflow-y-auto">
      {alerts.map((alert, i) => (
        <div
          key={i}
          className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 border border-border"
        >
          <span
            className={`mt-0.5 shrink-0 ${
              alert.severity === 'danger'
                ? 'text-red-500'
                : alert.severity === 'warning'
                  ? 'text-amber-500'
                  : 'text-blue-500'
            }`}
          >
            {alertIcons[alert.type] || <AlertTriangle className="h-4 w-4" />}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-foreground">{alert.employee_name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{alert.message}</p>
            {alert.due_date && (
              <p className="text-xs text-muted-foreground mt-0.5">{formatDate(alert.due_date)}</p>
            )}
          </div>
          <Badge variant={alertBadge[alert.severity]} className="shrink-0 text-[10px]">
            {alert.severity}
          </Badge>
        </div>
      ))}
    </div>
  )
}

// ─── Salary Chart ─────────────────────────────────────────────────────────────

function DepartmentSalaryChart({ data }: { data: DepartmentSalary[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 5, right: 20, left: 20, bottom: 60 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis
          dataKey="department_name"
          tick={{ fontSize: 11, fill: '#64748b' }}
          angle={-35}
          textAnchor="end"
          height={70}
        />
        <YAxis
          tick={{ fontSize: 11, fill: '#64748b' }}
          tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
        />
        <Tooltip
          formatter={(value) => formatCurrency(Number(value))}
          contentStyle={{
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            fontSize: '12px',
          }}
        />
        <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
        <Bar dataKey="base_salary" name="Base Salary" fill="#1e3a5f" radius={[3, 3, 0, 0]} />
        <Bar dataKey="overtime" name="Overtime" fill="#f59e0b" radius={[3, 3, 0, 0]} />
        <Bar dataKey="bonuses" name="Bonuses" fill="#10b981" radius={[3, 3, 0, 0]} />
        <Bar dataKey="deductions" name="Deductions" fill="#ef4444" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

// ─── Recent Incidents Table ───────────────────────────────────────────────────

function RecentIncidentsWidget({ incidents }: { incidents: Incident[] }) {
  const statusMap: Record<string, { label: string; variant: 'warning' | 'success' | 'danger' | 'default' | 'info' }> = {
    pending: { label: 'Pending', variant: 'warning' },
    applied: { label: 'Applied', variant: 'success' },
    dismissed: { label: 'Dismissed', variant: 'default' },
  }

  if (!incidents.length) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <CheckCircle2 className="h-8 w-8 text-emerald-400 mb-2" />
        <p className="text-sm text-muted-foreground">No incidents this month</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="py-2 px-3 text-left text-xs font-semibold text-muted-foreground uppercase">Employee</th>
            <th className="py-2 px-3 text-left text-xs font-semibold text-muted-foreground uppercase">Violation</th>
            <th className="py-2 px-3 text-left text-xs font-semibold text-muted-foreground uppercase">Date</th>
            <th className="py-2 px-3 text-left text-xs font-semibold text-muted-foreground uppercase">Action</th>
            <th className="py-2 px-3 text-left text-xs font-semibold text-muted-foreground uppercase">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {incidents.slice(0, 4).map((inc) => {
            const status = statusMap[inc.status] || { label: inc.status, variant: 'default' as const }
            return (
              <tr key={inc.id} className="hover:bg-muted/50">
                <td className="py-2.5 px-3">
                  <p className="font-medium text-foreground text-xs">{inc.employee_name}</p>
                  <p className="text-muted-foreground text-[10px]">{inc.employee_id_str}</p>
                </td>
                <td className="py-2.5 px-3 text-xs text-muted-foreground max-w-[140px] truncate">
                  {inc.violation_rule_name}
                </td>
                <td className="py-2.5 px-3 text-xs text-muted-foreground whitespace-nowrap">
                  {formatDate(inc.incident_date)}
                </td>
                <td className="py-2.5 px-3 text-xs text-muted-foreground capitalize">
                  {inc.action_taken.replace(/_/g, ' ')}
                </td>
                <td className="py-2.5 px-3">
                  <Badge variant={status.variant} className="text-[10px]">
                    {status.label}
                  </Badge>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Main Dashboard Page ──────────────────────────────────────────────────────

export default function DashboardPage() {
  const { currentCompany, roles, user } = useAuth()
  const router = useRouter()

  // Employees have no business on the admin dashboard
  if (roles.includes('employee') && !roles.some(r => ['super_admin', 'hr_manager', 'accountant', 'ceo', 'team_lead'].includes(r))) {
    if (typeof window !== 'undefined') window.location.replace('/employee/home')
    return null
  }
  // Super-admins see the full org by default — never scope to a single company
  // unless they explicitly switch via the company picker. Other roles keep
  // their existing per-company scope.
  const companyId = roles.includes('super_admin') ? undefined : currentCompany?.id
  const isSuperAdmin = roles.includes('super_admin')
  const today = new Date()

  const metricsQuery = useQuery({
    queryKey: ['dashboard-metrics', companyId],
    queryFn: async () => {
      const res = await dashboardApi.metrics(companyId ? { company: companyId } : {})
      return res.data as DashboardMetrics
    },
  })

  const attendanceQuery = useQuery({
    queryKey: ['dashboard-attendance', companyId],
    queryFn: async () => {
      const res = await dashboardApi.attendanceWidget(companyId ? { company: companyId } : {})
      return res.data as AttendanceWidget
    },
    refetchInterval: 5 * 60 * 1000,
  })

  const incidentsQuery = useQuery({
    queryKey: ['dashboard-incidents', companyId],
    queryFn: async () => {
      const res = await dashboardApi.recentIncidents(companyId ? { company: companyId } : {})
      return res.data as Incident[]
    },
  })

  const alertsQuery = useQuery({
    queryKey: ['dashboard-alerts', companyId],
    queryFn: async () => {
      const res = await dashboardApi.alerts(companyId ? { company: companyId } : {})
      return res.data as AlertItem[]
    },
  })

  const salaryQuery = useQuery({
    queryKey: ['dashboard-salary-breakdown', companyId],
    queryFn: async () => {
      const res = await payrollApi.departmentBreakdown(
        companyId ? { company: companyId } : {}
      )
      return res.data as DepartmentSalary[]
    },
  })

  const payrollSummaryQuery = useQuery({
    queryKey: ['dashboard-payroll-summary', companyId, today.getMonth(), today.getFullYear()],
    queryFn: async () => {
      const res = await payrollApi.summary({
        month: today.getMonth() + 1,
        year: today.getFullYear(),
        ...(companyId ? { company: companyId } : {}),
      })
      const summaries = res.data as PayrollSummary[]
      if (!summaries.length) return null
      return summaries.reduce(
        (acc, s) => ({
          ...acc,
          total_net_salary: acc.total_net_salary + s.total_net_salary,
          total_employees: acc.total_employees + s.total_employees,
          status: s.status,
        }),
        { ...summaries[0], total_net_salary: 0, total_employees: 0 }
      ) as PayrollSummary
    },
    enabled: isSuperAdmin,
  })

  const metrics = metricsQuery.data
  const attendance = attendanceQuery.data
  const incidents = incidentsQuery.data || []
  const alerts = alertsQuery.data || []
  const salaryData = salaryQuery.data || []

  const totalAttendance = attendance
    ? attendance.present + attendance.late + attendance.absent + attendance.on_leave
    : 0

  const attendanceRate = totalAttendance > 0 && attendance
    ? Math.round(((attendance.present + attendance.late) / totalAttendance) * 100)
    : 0

  return (
    <div className="space-y-6">
      <WelcomeBanner
        firstName={firstNameOf(user?.full_name, user?.email)}
        rolePill={isSuperAdmin ? 'Platform admin' : 'HR manager'}
        pillTone="indigo"
        email={user?.email ?? undefined}
        subtitle={`Overview for ${currentCompany?.name_en || 'all companies'} · ${formatDate(new Date())}`}
      />

      {/* ── HR Manager Action Queue ──
          One-glance "what's waiting on me" — pending overtime, incidents
          pending approval, contract / probation events. Deep-links to each
          approval surface so the manager can clear the queue without
          hunting through menus. */}
      <Card className="border-amber-200 bg-amber-50/40">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-amber-600" />
            Action queue
            <span className="text-xs font-normal text-muted-foreground ml-1">items waiting on you</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <button
              onClick={() => router.push('/hr/overtime/pending')}
              className="text-left rounded-lg bg-card border border-amber-200 hover:border-amber-400 transition-colors p-3 group"
            >
              <p className="text-[11px] uppercase tracking-wider text-amber-700 font-semibold mb-1">Overtime</p>
              <p className="text-2xl font-bold text-foreground group-hover:text-amber-700 transition-colors">
                {metricsQuery.isLoading ? '…' : (metrics?.pending_overtime ?? 0)}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">Pending approval</p>
            </button>
            <button
              onClick={() => router.push('/hr/incidents/all?status=pending')}
              className="text-left rounded-lg bg-card border border-amber-200 hover:border-amber-400 transition-colors p-3 group"
            >
              <p className="text-[11px] uppercase tracking-wider text-amber-700 font-semibold mb-1">Incidents</p>
              <p className="text-2xl font-bold text-foreground group-hover:text-amber-700 transition-colors">
                {incidentsQuery.isLoading ? '…' : incidents.filter((i) => (i as { status?: string }).status === 'pending').length}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">Awaiting decision</p>
            </button>
            <button
              onClick={() => router.push('/hr/employees?filter=probation_ending_30d')}
              className="text-left rounded-lg bg-card border border-amber-200 hover:border-amber-400 transition-colors p-3 group"
            >
              <p className="text-[11px] uppercase tracking-wider text-amber-700 font-semibold mb-1">Probation</p>
              <p className="text-2xl font-bold text-foreground group-hover:text-amber-700 transition-colors">
                {alertsQuery.isLoading ? '…' : alerts.filter((a) => a.type === 'probation_end').length}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">Ending soon</p>
            </button>
            <button
              onClick={() => router.push('/hr/employees?filter=contract_expiring_30d')}
              className="text-left rounded-lg bg-card border border-amber-200 hover:border-amber-400 transition-colors p-3 group"
            >
              <p className="text-[11px] uppercase tracking-wider text-amber-700 font-semibold mb-1">Contracts</p>
              <p className="text-2xl font-bold text-foreground group-hover:text-amber-700 transition-colors">
                {alertsQuery.isLoading ? '…' : alerts.filter((a) => a.type === 'contract_expiry').length}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">Expiring &lt;30d</p>
            </button>
          </div>
        </CardContent>
      </Card>

      {/* ── Stat Cards ── */}
      <div data-demo-id="dashboard-stats" className={`grid grid-cols-1 sm:grid-cols-2 ${isSuperAdmin ? 'xl:grid-cols-5' : 'xl:grid-cols-4'} gap-4`}>
        <StatCard
          label="Total Employees"
          value={metrics?.total_employees ?? 0}
          subtext={`${metrics?.active_employees ?? 0} active`}
          icon={<Users className="h-6 w-6" />}
          color="navy"
          loading={metricsQuery.isLoading}
          href="/hr/employees"
        />
        <StatCard
          label="Attendance Rate"
          value={`${attendanceRate}%`}
          subtext={`Today — ${attendance?.present ?? 0} present, ${attendance?.late ?? 0} late`}
          icon={<Clock className="h-6 w-6" />}
          color="emerald"
          loading={attendanceQuery.isLoading}
          href="/hr/attendance/today"
        />
        <StatCard
          label="Pending Overtime"
          value={metrics?.pending_overtime ?? 0}
          subtext="Awaiting approval"
          icon={<TrendingUp className="h-6 w-6" />}
          color="amber"
          loading={metricsQuery.isLoading}
          href="/hr/overtime/pending"
        />
        <StatCard
          label="Monthly Salary Budget"
          value={formatCurrency(metrics?.monthly_salary_budget ?? 0)}
          subtext="Base salary commitment"
          icon={<DollarSign className="h-6 w-6" />}
          color="blue"
          loading={metricsQuery.isLoading}
          href="/hr/payroll/monthly"
        />
        {isSuperAdmin && (
          <StatCard
            label="Net Payroll This Month"
            value={formatCurrency(payrollSummaryQuery.data?.total_net_salary ?? 0)}
            subtext={
              payrollSummaryQuery.data
                ? `${payrollSummaryQuery.data.total_employees} employees · ${payrollSummaryQuery.data.status}`
                : 'Not yet calculated'
            }
            icon={<DollarSign className="h-6 w-6" />}
            color="emerald"
            loading={payrollSummaryQuery.isLoading}
            href="/hr/accountant"
          />
        )}
      </div>

      {/* ── Middle Row: Attendance + Alerts ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Attendance Widget */}
        <div className="lg:col-span-2" data-demo-id="dashboard-attendance-chart">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between">
                <span>Today&apos;s Attendance</span>
                {attendance && (
                  <span className="text-sm font-normal text-muted-foreground">
                    {formatDate(attendance.date)}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {attendanceQuery.isLoading ? (
                <div className="grid grid-cols-2 gap-4">
                  <Skeleton className="h-48 rounded-lg" />
                  <div className="space-y-2">
                    {[...Array(4)].map((_, i) => (
                      <Skeleton key={i} className="h-10 rounded" />
                    ))}
                  </div>
                </div>
              ) : attendance ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Donut */}
                  <div>
                    <AttendanceDonut data={attendance} />
                    {/* Legend */}
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      {[
                        { label: 'Present', value: attendance.present, color: 'bg-emerald-500' },
                        { label: 'Late', value: attendance.late, color: 'bg-amber-500' },
                        { label: 'Absent', value: attendance.absent, color: 'bg-red-500' },
                        { label: 'On Leave', value: attendance.on_leave, color: 'bg-blue-500' },
                      ].map((item) => (
                        <div key={item.label} className="flex items-center gap-2">
                          <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${item.color}`} />
                          <span className="text-xs text-muted-foreground">
                            {item.label}: <strong>{item.value}</strong>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Late / Absent List */}
                  <div>
                    {attendance.late_employees.length > 0 && (
                      <div className="mb-4">
                        <h4 className="text-xs font-semibold text-amber-700 uppercase mb-2 flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Late ({attendance.late_employees.length})
                        </h4>
                        <div className="space-y-1.5 max-h-24 overflow-y-auto">
                          {attendance.late_employees.map((emp) => (
                            <div
                              key={emp.id}
                              className="flex items-center justify-between text-xs"
                            >
                              <span className="text-foreground truncate">{emp.full_name_en}</span>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="text-orange-500 hover:text-orange-700 hover:bg-orange-50 h-6 w-auto px-2 text-[10px]"
                              >
                                Incident
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {attendance.absent_employees.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold text-red-700 uppercase mb-2 flex items-center gap-1">
                          <XCircle className="h-3 w-3" />
                          Absent ({attendance.absent_employees.length})
                        </h4>
                        <div className="space-y-1.5 max-h-24 overflow-y-auto">
                          {attendance.absent_employees.map((emp) => (
                            <div
                              key={emp.id}
                              className="flex items-center justify-between text-xs"
                            >
                              <span className="text-foreground truncate">{emp.full_name_en}</span>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="text-red-500 hover:text-red-700 hover:bg-red-50 h-6 w-auto px-2 text-[10px]"
                              >
                                Incident
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {attendance.late_employees.length === 0 &&
                      attendance.absent_employees.length === 0 && (
                        <div className="flex flex-col items-center justify-center h-full py-8 text-center">
                          <CheckCircle2 className="h-8 w-8 text-emerald-400 mb-2" />
                          <p className="text-xs text-muted-foreground">Everyone is on time!</p>
                        </div>
                      )}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No attendance data available</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Alerts Panel */}
        <div data-demo-id="dashboard-alerts">
          <Card className="h-full">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-amber-500" />
                <span>Alerts</span>
                {alerts.length > 0 && (
                  <Badge variant="warning" className="ml-auto text-[10px]">
                    {alerts.length}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {alertsQuery.isLoading ? (
                <div className="space-y-2">
                  {[...Array(4)].map((_, i) => (
                    <Skeleton key={i} className="h-16 rounded-lg" />
                  ))}
                </div>
              ) : (
                <AlertsPanel alerts={alerts} />
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Bottom Row: Salary Chart + Incidents ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Monthly Salary by Department */}
        <Card data-demo-id="dashboard-salary-chart">
          <CardHeader className="pb-3">
            <CardTitle>Salary Breakdown by Department</CardTitle>
          </CardHeader>
          <CardContent>
            {salaryQuery.isLoading ? (
              <Skeleton className="h-72 w-full rounded" />
            ) : salaryData.length > 0 ? (
              <DepartmentSalaryChart data={salaryData} />
            ) : (
              <div className="flex flex-col items-center justify-center h-48 text-center">
                <DollarSign className="h-8 w-8 text-muted-foreground/60 mb-2" />
                <p className="text-sm text-muted-foreground">No payroll data for this period</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Incidents */}
        <Card data-demo-id="dashboard-incidents">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between">
              <span>Recent Incidents</span>
              <Button variant="ghost" size="sm" className="text-xs" onClick={() => router.push('/hr/incidents/all')}>
                View All
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {incidentsQuery.isLoading ? (
              <div className="space-y-3">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-10 rounded" />
                ))}
              </div>
            ) : (
              <RecentIncidentsWidget incidents={incidents} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
