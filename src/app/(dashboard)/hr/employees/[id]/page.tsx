'use client'

import React, { useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Pencil,
  Download,
  Upload,
  Trash2,
  CheckCircle,
  XCircle,
  Clock,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Gift,
  FileText,
  TrendingUp,
} from 'lucide-react'
import * as Tabs from '@radix-ui/react-tabs'
import { PageHeader } from '@/components/hr/shared/PageHeader'
import { Badge } from '@/components/hr/ui/badge'
import { Button } from '@/components/hr/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/hr/ui/avatar'
import { Card } from '@/components/hr/ui/card'
import { Skeleton } from '@/components/hr/ui/skeleton'
import { Separator } from '@/components/hr/ui/separator'
import { useToast } from '@/components/hr/ui/toast'
import api, { employeesApi } from '@/lib/hr/api'
import { formatCurrency, formatDate, getInitials, capitalize } from '@/lib/hr/utils'
import type {
  Employee,
  AttendanceLog,
  OvertimeRequest,
  Incident,
  MonthlySalary,
} from '@/lib/hr/types'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, addMonths, subMonths, parseISO } from 'date-fns'
import { cn } from '@/lib/hr/utils'
import { TaskList } from '@/components/tasks/TaskList'
import { OnboardingChecklistButton } from '@/components/tasks/OnboardingChecklistButton'

// ─── Status helpers ──────────────────────────────────────────────────────────

const EMP_STATUS_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'default'> = {
  active: 'success',
  on_leave: 'info',
  probation: 'warning',
  terminated: 'danger',
  suspended: 'danger',
}

const ATTENDANCE_STATUS_COLOR: Record<string, string> = {
  on_time: 'bg-emerald-500',
  late: 'bg-amber-400',
  absent: 'bg-red-400',
  leave: 'bg-blue-400',
  weekend: 'bg-slate-300',
  holiday: 'bg-purple-400',
}

const ATTENDANCE_STATUS_BG: Record<string, string> = {
  on_time: 'bg-emerald-100 text-emerald-700',
  late: 'bg-amber-100 text-amber-700',
  absent: 'bg-red-100 text-red-700',
  leave: 'bg-blue-100 text-blue-700',
  weekend: 'bg-muted text-muted-foreground',
  holiday: 'bg-purple-100 text-purple-700',
}

// ─── Info Grid helper ────────────────────────────────────────────────────────

function InfoField({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-0.5">
        {label}
      </dt>
      <dd className="text-sm font-medium text-foreground">{value ?? '—'}</dd>
    </div>
  )
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function EmployeeDetailPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const employeeId = String(params.id)
  const defaultTab = searchParams.get('tab') ?? 'personal'

  const [activeTab, setActiveTab] = useState(defaultTab)
  const [attendanceMonth, setAttendanceMonth] = useState(new Date())
  const [salaryPage, setSalaryPage] = useState(1)

  // ─── Employee Data ──────────────────────────────────────────────────────────

  const { data: empData, isLoading: empLoading } = useQuery<{ data: Employee }>({
    queryKey: ['employee', employeeId],
    queryFn: () => employeesApi.get(employeeId),
    enabled: !!employeeId,
  })

  const employee = empData?.data

  // ─── Attendance Data ────────────────────────────────────────────────────────

  const { data: attendanceData, isLoading: attendanceLoading } = useQuery<{
    data: { results: AttendanceLog[]; count: number }
  }>({
    queryKey: ['employee-attendance', employeeId, format(attendanceMonth, 'yyyy-MM')],
    queryFn: () =>
      api.get('/attendance/logs/', {
        params: {
          employee: employeeId,
          start_date: format(startOfMonth(attendanceMonth), 'yyyy-MM-dd'),
          end_date: format(endOfMonth(attendanceMonth), 'yyyy-MM-dd'),
          page_size: 100,
        },
      }),
    enabled: activeTab === 'attendance' && !!employeeId,
  })

  const attendanceLogs = attendanceData?.data?.results ?? []

  // ─── Salary History ─────────────────────────────────────────────────────────

  const { data: salaryData, isLoading: salaryLoading } = useQuery<{
    data: { results: MonthlySalary[]; count: number }
  }>({
    queryKey: ['employee-salary', employeeId, salaryPage],
    queryFn: () =>
      api.get('/payroll/salaries/', { params: { employee: employeeId, page: salaryPage } }),
    enabled: activeTab === 'salary' && !!employeeId,
  })

  const salaryRecords = salaryData?.data?.results ?? []

  // ─── Incidents ──────────────────────────────────────────────────────────────

  const { data: incidentsData, isLoading: incidentsLoading } = useQuery<{
    data: { results: Incident[]; count: number }
  }>({
    queryKey: ['employee-incidents', employeeId],
    queryFn: () => api.get('/incidents/incidents/', { params: { employee: employeeId, page_size: 100 } }),
    enabled: activeTab === 'incidents' && !!employeeId,
  })

  const incidents = incidentsData?.data?.results ?? []

  // ─── Overtime ───────────────────────────────────────────────────────────────

  const { data: overtimeData, isLoading: overtimeLoading } = useQuery<{
    data: { results: OvertimeRequest[]; count: number }
  }>({
    queryKey: ['employee-overtime', employeeId],
    queryFn: () => api.get('/overtime/requests/', { params: { employee: employeeId, page_size: 100 } }),
    enabled: activeTab === 'overtime' && !!employeeId,
  })

  const overtimeRecords = overtimeData?.data?.results ?? []

  // ─── Documents (placeholder structure) ─────────────────────────────────────
  const { data: documentsData } = useQuery<{ data: { results: Record<string, unknown>[] } }>({
    queryKey: ['employee-documents', employeeId],
    queryFn: () => api.get(`/employees/${employeeId}/documents/`),
    enabled: activeTab === 'documents' && !!employeeId,
  })

  const documents = (documentsData?.data?.results ?? []) as Array<{
    id: number
    doc_type: string
    name: string
    file: string
    uploaded_at: string
  }>

  // ─── Leave Balance ──────────────────────────────────────────────────────────
  const { data: leaveData } = useQuery<{ data: { results: Record<string, unknown>[] } }>({
    queryKey: ['employee-leave', employeeId],
    queryFn: () => api.get(`/employees/${employeeId}/leave-balance/`),
    enabled: activeTab === 'leave' && !!employeeId,
  })

  const leaveBalances = (leaveData?.data?.results ?? []) as Array<{
    id: number
    leave_type_name: string
    annual_entitlement: number
    used_days: number
    remaining_days: number
    carry_over: number
  }>

  // ─── Commission summary (sales reps only) ───────────────────────────────────
  // Sales reps are real employees with an attached CrmUserProfile. Their
  // commissions accrue from CRM opportunities they own that hit WON. The API
  // returns `{ summary: null }` for any non-sales employee, so the tab degrades
  // gracefully for everyone else.
  const employeeUserId = (employee as Employee | undefined)?.user as unknown as string | null | undefined
  const { data: commissionData, isLoading: commissionLoading } = useQuery<{
    summary: {
      commissionRate: number
      lifetime: { count: number; wonValueEGP: number; commissionEGP: number }
      thisMonth: { count: number; wonValueEGP: number; commissionEGP: number }
      thisYear: { count: number; wonValueEGP: number; commissionEGP: number }
      recentWins: Array<{
        id: string
        code: string
        title: string
        valueEGP: number
        commissionEGP: number
        dateClosed: string | null
        company: string
      }>
    } | null
    message?: string
  }>({
    queryKey: ['employee-commissions', employeeUserId],
    queryFn: async () => {
      const r = await fetch(`/api/crm/commission-summary?userId=${employeeUserId}`, { credentials: 'include' })
      if (!r.ok) return { summary: null }
      return r.json()
    },
    enabled: activeTab === 'commissions' && !!employeeUserId,
  })

  const commissionSummary = commissionData?.summary ?? null

  // ─── Loading state ──────────────────────────────────────────────────────────

  if (empLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-96 rounded-xl" />
      </div>
    )
  }

  if (!employee) {
    return (
      <div className="flex flex-col items-center justify-center h-80 text-muted-foreground">
        <AlertTriangle className="h-12 w-12 mb-3" />
        <p className="text-lg font-medium">Employee not found</p>
        <Button variant="outline" className="mt-4" onClick={() => router.push('/hr/employees')}>
          Back to Employees
        </Button>
      </div>
    )
  }

  // ─── Calendar helpers ───────────────────────────────────────────────────────

  const calendarDays = eachDayOfInterval({
    start: startOfMonth(attendanceMonth),
    end: endOfMonth(attendanceMonth),
  })

  const attendanceByDate = attendanceLogs.reduce<Record<string, AttendanceLog>>((acc, log) => {
    acc[log.date] = log
    return acc
  }, {})

  const attendanceSummary = {
    present: attendanceLogs.filter((l) => l.status === 'on_time').length,
    late: attendanceLogs.filter((l) => l.status === 'late').length,
    absent: attendanceLogs.filter((l) => l.status === 'absent').length,
    on_leave: attendanceLogs.filter((l) => l.status === 'leave').length,
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title={employee.full_name_en}
        description={`${employee.employee_id} · ${employee.position_en} · ${employee.company_name ?? ''}`}
        breadcrumbs={[
          { label: 'Employees', href: '/hr/employees' },
          { label: employee.full_name_en },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => router.push('/hr/employees')}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
            <Button size="sm" onClick={() => router.push(`/hr/employees/${employeeId}/edit`)}>
              <Pencil className="h-4 w-4 mr-1" /> Edit
            </Button>
          </div>
        }
      />

      {/* Profile Card */}
      <Card className="p-6">
        <div className="flex flex-col sm:flex-row items-start gap-5">
          <Avatar className="h-20 w-20 shrink-0 ring-4 ring-brand-navy/10">
            <AvatarImage src={employee.photo ?? undefined} alt={employee.full_name_en} />
            <AvatarFallback className="text-2xl font-bold bg-brand-navy/10 text-brand-navy">
              {getInitials(employee.full_name_en)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h2 className="text-xl font-bold text-foreground">{employee.full_name_en}</h2>
              <Badge variant={EMP_STATUS_VARIANT[employee.status] ?? 'default'}>
                {capitalize(employee.status)}
              </Badge>
            </div>
            {employee.full_name_ar && (
              <p className="text-sm text-muted-foreground mb-1">{employee.full_name_ar}</p>
            )}
            <p className="text-sm text-muted-foreground">
              {employee.position_en} · {employee.department_name} · {employee.company_name}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-2xl font-bold text-foreground">
              {formatCurrency(employee.base_salary, employee.currency)}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">Base Salary / month</p>
          </div>
        </div>
      </Card>

      {/* Tabs */}
      <Tabs.Root value={activeTab} onValueChange={setActiveTab}>
        <Tabs.List className="flex gap-0.5 border-b border-border overflow-x-auto pb-0 mb-6">
          {[
            { value: 'personal', label: 'Personal Info' },
            { value: 'employment', label: 'Employment' },
            { value: 'salary', label: 'Salary & Banking' },
            { value: 'attendance', label: 'Attendance' },
            { value: 'overtime', label: 'Overtime' },
            { value: 'incidents', label: 'Incidents' },
            { value: 'documents', label: 'Documents' },
            { value: 'leave', label: 'Leave Balance' },
            { value: 'commissions', label: 'Commissions' },
            { value: 'tasks', label: 'Tasks' },
          ].map((tab) => (
            <Tabs.Trigger
              key={tab.value}
              value={tab.value}
              className={cn(
                'px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors outline-none',
                'text-muted-foreground border-transparent hover:text-foreground hover:border-border',
                'data-[state=active]:text-brand-navy data-[state=active]:border-brand-navy'
              )}
            >
              {tab.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        {/* Tab 1: Personal Info */}
        <Tabs.Content value="personal">
          <Card className="p-6">
            <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              <InfoField label="Full Name (EN)" value={employee.full_name_en} />
              <InfoField label="Full Name (AR)" value={employee.full_name_ar} />
              <InfoField label="Employee ID" value={employee.employee_id} />
              <InfoField label="National ID" value={employee.national_id} />
              <InfoField label="Date of Birth" value={employee.date_of_birth ? formatDate(employee.date_of_birth) : undefined} />
              <InfoField label="Gender" value={capitalize(employee.gender ?? '')} />
              <InfoField label="Phone" value={employee.phone} />
              <InfoField label="Personal Email" value={employee.personal_email} />
              <InfoField label="Work Email" value={employee.user_email} />
              <InfoField label="Address" value={employee.address} />
              <InfoField
                label="Emergency Contact"
                value={
                  employee.emergency_contact_name
                    ? `${employee.emergency_contact_name} — ${employee.emergency_contact_phone ?? ''}`
                    : undefined
                }
              />
            </dl>
          </Card>
        </Tabs.Content>

        {/* Tab 2: Employment & Contract */}
        <Tabs.Content value="employment">
          <Card className="p-6">
            <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              <InfoField label="Company" value={employee.company_name} />
              <InfoField label="Department" value={employee.department_name} />
              <InfoField label="Position (EN)" value={employee.position_en} />
              <InfoField label="Position (AR)" value={employee.position_ar} />
              <InfoField label="Level" value={capitalize(employee.level)} />
              <InfoField label="Employment Type" value={capitalize(employee.employment_type)} />
              <InfoField label="Work Model" value={capitalize(employee.work_model)} />
              <InfoField label="Status" value={capitalize(employee.status)} />
              <InfoField
                label="Direct Manager"
                value={employee.direct_manager_name ?? undefined}
              />
              <InfoField label="Shift" value={employee.shift_name ?? undefined} />
              <InfoField label="Contract Start" value={formatDate(employee.contract_start)} />
              <InfoField
                label="Contract End"
                value={employee.contract_end ? formatDate(employee.contract_end) : 'Indefinite'}
              />
              <InfoField
                label="Probation End"
                value={employee.probation_end ? formatDate(employee.probation_end) : 'N/A'}
              />
            </dl>
          </Card>
        </Tabs.Content>

        {/* Tab 3: Salary & Banking */}
        <Tabs.Content value="salary">
          <div className="space-y-6">
            <Card className="p-6">
              <h3 className="text-base font-semibold text-foreground mb-4">Salary Details</h3>
              <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                <InfoField
                  label="Base Salary"
                  value={formatCurrency(employee.base_salary, employee.currency)}
                />
                <InfoField label="Currency" value={employee.currency} />
                <InfoField label="Bank Name" value={employee.bank_name} />
                <InfoField label="Account Number" value={employee.bank_account} />
                <InfoField label="IBAN" value={employee.iban} />
              </dl>
            </Card>

            <Card className="p-6">
              <h3 className="text-base font-semibold text-foreground mb-4">Salary History</h3>
              {salaryLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        {['Month', 'Base', 'OT', 'Bonuses', 'Deductions', 'Net', 'Status', 'Slip'].map(
                          (h) => (
                            <th
                              key={h}
                              className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap"
                            >
                              {h}
                            </th>
                          )
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {salaryRecords.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="text-center py-8 text-muted-foreground">
                            No salary records found
                          </td>
                        </tr>
                      ) : (
                        salaryRecords.map((record) => (
                          <tr key={record.id} className="hover:bg-muted/50">
                            <td className="px-3 py-2 font-medium">
                              {format(new Date(record.year, record.month - 1), 'MMM yyyy')}
                            </td>
                            <td className="px-3 py-2">
                              {formatCurrency(record.base_salary, employee.currency)}
                            </td>
                            <td className="px-3 py-2">
                              {formatCurrency(record.overtime_amount, employee.currency)}
                            </td>
                            <td className="px-3 py-2 text-emerald-600">
                              +{formatCurrency(record.total_bonuses, employee.currency)}
                            </td>
                            <td className="px-3 py-2 text-red-600">
                              -{formatCurrency(record.total_deductions, employee.currency)}
                            </td>
                            <td className="px-3 py-2 font-bold text-foreground">
                              {formatCurrency(record.net_salary, employee.currency)}
                            </td>
                            <td className="px-3 py-2">
                              <Badge
                                variant={
                                  record.status === 'paid'
                                    ? 'success'
                                    : record.status === 'locked'
                                    ? 'info'
                                    : 'default'
                                }
                                className="text-xs"
                              >
                                {capitalize(record.status)}
                              </Badge>
                            </td>
                            <td className="px-3 py-2">
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                title="Download Slip"
                                onClick={() =>
                                  window.open(
                                    `/api/payroll/${record.id}/slip/`,
                                    '_blank'
                                  )
                                }
                              >
                                <Download className="h-3.5 w-3.5" />
                              </Button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        </Tabs.Content>

        {/* Tab 4: Attendance */}
        <Tabs.Content value="attendance">
          <div className="space-y-6">
            {/* Summary Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: 'Present', count: attendanceSummary.present, color: 'text-emerald-600 bg-emerald-50' },
                { label: 'Late', count: attendanceSummary.late, color: 'text-amber-600 bg-amber-50' },
                { label: 'Absent', count: attendanceSummary.absent, color: 'text-red-600 bg-red-50' },
                { label: 'On Leave', count: attendanceSummary.on_leave, color: 'text-blue-600 bg-blue-50' },
              ].map((s) => (
                <Card key={s.label} className={cn('p-4 text-center', s.color)}>
                  <p className="text-3xl font-bold">{s.count}</p>
                  <p className="text-sm font-medium mt-1">{s.label}</p>
                </Card>
              ))}
            </div>

            <Card className="p-6">
              {/* Month Navigator */}
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-base font-semibold text-foreground">
                  {format(attendanceMonth, 'MMMM yyyy')}
                </h3>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={() => setAttendanceMonth((m) => subMonths(m, 1))}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={() => setAttendanceMonth((m) => addMonths(m, 1))}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Legend */}
              <div className="flex flex-wrap gap-4 mb-4 text-xs">
                {[
                  { color: 'bg-emerald-500', label: 'On Time' },
                  { color: 'bg-amber-400', label: 'Late' },
                  { color: 'bg-red-400', label: 'Absent' },
                  { color: 'bg-blue-400', label: 'Leave' },
                ].map((l) => (
                  <span key={l.label} className="flex items-center gap-1.5 text-muted-foreground">
                    <span className={cn('h-3 w-3 rounded-full', l.color)} />
                    {l.label}
                  </span>
                ))}
              </div>

              {/* Calendar Grid */}
              {attendanceLoading ? (
                <div className="grid grid-cols-7 gap-1">
                  {Array.from({ length: 35 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 rounded-md" />
                  ))}
                </div>
              ) : (
                <div>
                  {/* Day headers */}
                  <div className="grid grid-cols-7 mb-1">
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                      <div
                        key={d}
                        className="text-center text-xs font-semibold text-muted-foreground py-2"
                      >
                        {d}
                      </div>
                    ))}
                  </div>
                  {/* Offset first day */}
                  <div className="grid grid-cols-7 gap-1">
                    {Array.from({ length: getDay(startOfMonth(attendanceMonth)) }).map((_, i) => (
                      <div key={`empty-${i}`} />
                    ))}
                    {calendarDays.map((day) => {
                      const dateStr = format(day, 'yyyy-MM-dd')
                      const log = attendanceByDate[dateStr]
                      return (
                        <div
                          key={dateStr}
                          className={cn(
                            'rounded-md p-1.5 min-h-[52px] border border-transparent text-xs',
                            log
                              ? ATTENDANCE_STATUS_BG[log.status]
                              : 'bg-muted/50 text-muted-foreground',
                            'relative'
                          )}
                        >
                          <span className="font-semibold">{format(day, 'd')}</span>
                          {log && (
                            <div className="mt-0.5 text-[10px] leading-tight">
                              {log.check_in ? format(parseISO(`${dateStr}T${log.check_in}`), 'HH:mm') : ''}
                              {log.status === 'late' && log.late_minutes > 0 && (
                                <span className="block text-amber-700">+{log.late_minutes}m</span>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </Card>

            {/* Table View */}
            <Card className="p-6">
              <h3 className="text-base font-semibold text-foreground mb-4">Detailed Log</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      {['Date', 'Check In', 'Check Out', 'Status', 'Hours', 'Late (min)', 'Note'].map(
                        (h) => (
                          <th
                            key={h}
                            className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap"
                          >
                            {h}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {attendanceLogs.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="text-center py-8 text-muted-foreground">
                          No attendance records for this month
                        </td>
                      </tr>
                    ) : (
                      attendanceLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-muted/50">
                          <td className="px-3 py-2 font-medium">{formatDate(log.date)}</td>
                          <td className="px-3 py-2">{log.check_in ?? '—'}</td>
                          <td className="px-3 py-2">{log.check_out ?? '—'}</td>
                          <td className="px-3 py-2">
                            <Badge
                              variant={
                                log.status === 'on_time'
                                  ? 'success'
                                  : log.status === 'late'
                                  ? 'warning'
                                  : log.status === 'absent'
                                  ? 'danger'
                                  : 'info'
                              }
                              className="text-xs"
                            >
                              {log.status === 'on_time' ? 'On Time' : log.status === 'leave' ? 'Leave' : capitalize(log.status)}
                            </Badge>
                          </td>
                          <td className="px-3 py-2">
                            {Number(log.hours_worked) > 0 ? `${Number(log.hours_worked).toFixed(1)}h` : '—'}
                          </td>
                          <td className="px-3 py-2">
                            {log.late_minutes > 0 ? (
                              <span className="text-amber-600">{log.late_minutes}m</span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{log.notes ?? '—'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </Tabs.Content>

        {/* Tab 5: Overtime */}
        <Tabs.Content value="overtime">
          <Card className="p-6">
            <h3 className="text-base font-semibold text-foreground mb-4">Overtime Requests</h3>
            {overtimeLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      {['Date', 'Type', 'Hours', 'Reason', 'Amount', 'Status', 'Submitted'].map((h) => (
                        <th
                          key={h}
                          className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {overtimeRecords.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="text-center py-8 text-muted-foreground">
                          No overtime records
                        </td>
                      </tr>
                    ) : (
                      overtimeRecords.map((ot) => (
                        <tr key={ot.id} className="hover:bg-muted/50">
                          <td className="px-3 py-2">{formatDate(ot.date)}</td>
                          <td className="px-3 py-2 capitalize">{capitalize(ot.overtime_type)}</td>
                          <td className="px-3 py-2">{ot.hours_requested}h</td>
                          <td className="px-3 py-2 max-w-xs truncate">{ot.reason}</td>
                          <td className="px-3 py-2 font-medium">
                            {formatCurrency(ot.calculated_amount, employee.currency)}
                          </td>
                          <td className="px-3 py-2">
                            <Badge
                              variant={
                                ot.status === 'approved'
                                  ? 'success'
                                  : ot.status === 'pending'
                                  ? 'warning'
                                  : 'danger'
                              }
                              className="text-xs"
                            >
                              {capitalize(ot.status)}
                            </Badge>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {ot.created_at ? formatDate(ot.created_at) : '—'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </Tabs.Content>

        {/* Tab 6: Incidents & Discipline */}
        <Tabs.Content value="incidents">
          <div className="space-y-6">
            {/* Progressive Discipline Bar */}
            {incidents.length > 0 && (
              <Card className="p-5">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-foreground">Progressive Discipline</h3>
                  <span className="text-sm text-muted-foreground">
                    {incidents.length} incident{incidents.length !== 1 ? 's' : ''} on record
                  </span>
                </div>
                <div className="flex gap-1.5">
                  {[1, 2, 3, 4, 5].map((step) => (
                    <div
                      key={step}
                      className={cn(
                        'h-2.5 flex-1 rounded-full',
                        incidents.length >= step
                          ? step <= 2
                            ? 'bg-amber-400'
                            : step <= 4
                            ? 'bg-orange-500'
                            : 'bg-red-600'
                          : 'bg-slate-200'
                      )}
                    />
                  ))}
                </div>
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>Verbal</span>
                  <span>Written</span>
                  <span>Final Warning</span>
                  <span>Suspension</span>
                  <span>Termination</span>
                </div>
              </Card>
            )}

            {/* Timeline */}
            <Card className="p-6">
              <h3 className="text-base font-semibold text-foreground mb-5">Incident Timeline</h3>
              {incidentsLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
                </div>
              ) : incidents.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <CheckCircle className="h-10 w-10 mx-auto mb-2 text-emerald-400" />
                  <p className="font-medium">No incidents on record</p>
                </div>
              ) : (
                <ol className="relative border-l border-border space-y-6 ml-3">
                  {incidents.map((inc) => {
                    const isBonus = inc.is_bonus ?? false
                    return (
                      <li key={inc.id} className="ml-6">
                        <span
                          className={cn(
                            'absolute -left-3 flex h-6 w-6 items-center justify-center rounded-full ring-4 ring-white',
                            isBonus ? 'bg-emerald-500' : 'bg-red-500'
                          )}
                        >
                          {isBonus ? (
                            <Gift className="h-3 w-3 text-white" />
                          ) : (
                            <AlertTriangle className="h-3 w-3 text-white" />
                          )}
                        </span>
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <Badge
                                variant={isBonus ? 'success' : 'danger'}
                                className="text-xs"
                              >
                                {isBonus ? 'Bonus' : capitalize(inc.action_taken)}
                              </Badge>
                              <time className="text-xs text-muted-foreground">
                                {formatDate(inc.incident_date)}
                              </time>
                            </div>
                            <p className="text-sm text-foreground">{inc.comments}</p>
                            {inc.deduction_amount > 0 && (
                              <p className="text-xs text-red-600 mt-0.5 font-medium">
                                Deduction: {formatCurrency(inc.deduction_amount, employee.currency)}
                              </p>
                            )}
                          </div>
                          <Badge
                            variant={
                              inc.status === 'applied'
                                ? 'success'
                                : inc.status === 'pending'
                                ? 'warning'
                                : 'default'
                            }
                            className="text-xs shrink-0"
                          >
                            {capitalize(inc.status)}
                          </Badge>
                        </div>
                      </li>
                    )
                  })}
                </ol>
              )}
            </Card>
          </div>
        </Tabs.Content>

        {/* Tab 7: Documents */}
        <Tabs.Content value="documents">
          <Card className="p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-semibold text-foreground">Employee Documents</h3>
              <Button size="sm" variant="outline" className="gap-1.5">
                <Upload className="h-4 w-4" /> Upload Document
              </Button>
            </div>
            {['contract', 'nda', 'job_description', 'id_copy', 'other'].map((docType) => {
              const docs = documents.filter((d) => d.doc_type === docType)
              return (
                <div key={docType} className="mb-6 last:mb-0">
                  <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                    {capitalize(docType.replace(/_/g, ' '))}
                  </h4>
                  {docs.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">No documents uploaded</p>
                  ) : (
                    <div className="space-y-2">
                      {docs.map((doc) => (
                        <div
                          key={doc.id}
                          className="flex items-center justify-between p-3 bg-muted/50 rounded-lg border border-border"
                        >
                          <div className="flex items-center gap-3">
                            <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
                            <div>
                              <p className="text-sm font-medium text-foreground">{doc.name}</p>
                              <p className="text-xs text-muted-foreground">
                                Uploaded {formatDate(doc.uploaded_at)}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => window.open(doc.file, '_blank')}
                            >
                              <Download className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon-sm" className="text-red-500">
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <Separator className="mt-4" />
                </div>
              )
            })}
          </Card>
        </Tabs.Content>

        {/* Tab 8: Leave Balance */}
        <Tabs.Content value="leave">
          <Card className="p-6">
            <h3 className="text-base font-semibold text-foreground mb-5">Leave Balances</h3>
            {leaveBalances.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No leave data available</p>
            ) : (
              <div className="overflow-x-auto mb-8">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      {['Leave Type', 'Entitlement', 'Used', 'Remaining', 'Carry Over'].map(
                        (h) => (
                          <th
                            key={h}
                            className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap"
                          >
                            {h}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {leaveBalances.map((lb) => (
                      <tr key={lb.id} className="hover:bg-muted/50">
                        <td className="px-3 py-3 font-medium">{lb.leave_type_name}</td>
                        <td className="px-3 py-3">{lb.annual_entitlement} days</td>
                        <td className="px-3 py-3 text-red-600">{lb.used_days} days</td>
                        <td className="px-3 py-3 text-emerald-600 font-semibold">
                          {lb.remaining_days} days
                        </td>
                        <td className="px-3 py-3 text-blue-600">{lb.carry_over} days</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </Tabs.Content>

        {/* Tab 9: Commissions (sales reps) */}
        <Tabs.Content value="commissions">
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-5">
              <TrendingUp className="h-5 w-5 text-emerald-500" />
              <h3 className="text-base font-semibold text-foreground">Sales Commissions</h3>
            </div>
            {!employeeUserId ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                This employee has no login account attached, so commissions cannot be tracked.
              </p>
            ) : commissionLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
            ) : !commissionSummary ? (
              <div className="text-center py-12 text-muted-foreground">
                <p className="font-medium text-foreground">Not a sales rep</p>
                <p className="text-sm mt-1">
                  This employee has no CRM profile. Attach one from the user record to start
                  tracking commissions.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Totals grid */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {[
                    { label: 'This Month', bucket: commissionSummary.thisMonth, accent: 'text-emerald-600 bg-emerald-50' },
                    { label: 'This Year', bucket: commissionSummary.thisYear, accent: 'text-blue-600 bg-blue-50' },
                    { label: 'Lifetime', bucket: commissionSummary.lifetime, accent: 'text-purple-600 bg-purple-50' },
                  ].map((b) => (
                    <Card key={b.label} className={cn('p-4', b.accent)}>
                      <p className="text-xs font-semibold uppercase tracking-wider">{b.label}</p>
                      <p className="text-2xl font-bold mt-1">
                        {formatCurrency(b.bucket.commissionEGP, 'EGP')}
                      </p>
                      <p className="text-xs mt-1 opacity-80">
                        {b.bucket.count} deal{b.bucket.count !== 1 ? 's' : ''} ·{' '}
                        {formatCurrency(b.bucket.wonValueEGP, 'EGP')} won
                      </p>
                    </Card>
                  ))}
                </div>

                <p className="text-xs text-muted-foreground">
                  Commission rate: {(commissionSummary.commissionRate * 100).toFixed(1)}% of won
                  opportunity value. Configurable per rep in a later iteration.
                </p>

                {/* Recent wins */}
                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-3">Recent wins</h4>
                  {commissionSummary.recentWins.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">No closed-won deals yet.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border">
                            {['Code', 'Title', 'Company', 'Closed', 'Value', 'Commission'].map((h) => (
                              <th
                                key={h}
                                className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap"
                              >
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {commissionSummary.recentWins.map((w) => (
                            <tr key={w.id} className="hover:bg-muted/50">
                              <td className="px-3 py-2 font-mono text-xs">{w.code}</td>
                              <td className="px-3 py-2 max-w-xs truncate">{w.title}</td>
                              <td className="px-3 py-2 text-muted-foreground">{w.company}</td>
                              <td className="px-3 py-2 text-muted-foreground">
                                {w.dateClosed ? formatDate(w.dateClosed) : '—'}
                              </td>
                              <td className="px-3 py-2">{formatCurrency(w.valueEGP, 'EGP')}</td>
                              <td className="px-3 py-2 font-semibold text-emerald-600">
                                {formatCurrency(w.commissionEGP, 'EGP')}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </Card>
        </Tabs.Content>

        {/* Tab 10: Tasks */}
        <Tabs.Content value="tasks">
          <Card className="p-6 space-y-4">
            <OnboardingChecklistButton employeeId={employeeId} />
            <TaskList
              entityType="HR_EMPLOYEE"
              entityId={employeeId}
              showBuckets={false}
              createDefaults={{
                entityType: 'HR_EMPLOYEE',
                entityId: employeeId,
                module: 'hr',
              }}
            />
          </Card>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  )
}
