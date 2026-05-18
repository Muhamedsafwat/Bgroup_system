'use client'

import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Users, AlertCircle, Clock, TrendingUp } from 'lucide-react'
import api from '@/lib/hr/api'
import { formatDate, cn } from '@/lib/hr/utils'
import { useLocale } from '@/lib/i18n'
import { PageHeader } from '@/components/hr/shared/PageHeader'
import { StatCard } from '@/components/hr/shared/StatCard'
import { ExportButton } from '@/components/hr/shared/ExportButton'
import { Input } from '@/components/hr/ui/input'
import { Label } from '@/components/hr/ui/label'
import { Skeleton } from '@/components/hr/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/hr/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/hr/ui/table'

interface AttendanceReportRow {
  employee_id: number
  employee_name: string
  department_name: string
  work_days: number
  present: number
  absent: number
  late: number
  on_leave: number
  total_hours: number
  avg_hours_per_day: number
  ot_hours: number
  attendance_pct: number
}

interface AttendanceReportData {
  summary: {
    avg_attendance_rate: number
    total_absences: number
    total_late: number
    total_ot_hours: number
  }
  rows: AttendanceReportRow[]
}

interface DailyLog {
  date: string
  check_in: string | null
  check_out: string | null
  status: string
  hours_worked: number
  late_minutes: number
}

function getMonthRange() {
  const now = new Date()
  const first = new Date(now.getFullYear(), now.getMonth(), 1)
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  return {
    from: first.toISOString().split('T')[0],
    to: last.toISOString().split('T')[0],
  }
}

type SortKey = keyof AttendanceReportRow
type SortDir = 'asc' | 'desc'

export default function AttendanceReportPage() {
  const { locale } = useLocale()
  const isAr = locale === "ar"
  const defaultRange = getMonthRange()
  const [dateFrom, setDateFrom] = useState(defaultRange.from)
  const [dateTo, setDateTo] = useState(defaultRange.to)
  const [company, setCompany] = useState('')
  const [department, setDepartment] = useState('')
  const [employeeSearch, setEmployeeSearch] = useState('')
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set())
  const [sortKey, setSortKey] = useState<SortKey>('employee_name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const { data: companiesData } = useQuery({
    queryKey: ['companies'],
    queryFn: async () => {
      const res = await api.get('/companies/')
      return res.data
    },
  })

  const { data: departmentsData } = useQuery({
    queryKey: ['departments', company],
    queryFn: async () => {
      const res = await api.get('/departments/', { params: company ? { company } : {} })
      return res.data
    },
  })

  const { data, isLoading } = useQuery<AttendanceReportData>({
    queryKey: ['attendance', 'report', dateFrom, dateTo, company, department],
    queryFn: async () => {
      const res = await api.get('/attendance/report/', {
        params: { date_from: dateFrom, date_to: dateTo, company: company || undefined, department: department || undefined },
      })
      return res.data
    },
    enabled: !!dateFrom && !!dateTo,
  })

  const dailyLogsQuery = useQuery({
    queryKey: ['attendance', 'daily-logs', Array.from(expandedRows), dateFrom, dateTo],
    queryFn: async () => {
      const results: Record<number, DailyLog[]> = {}
      await Promise.all(
        Array.from(expandedRows).map(async (empId) => {
          const res = await api.get('/attendance/logs/', {
            params: { employee: empId, start_date: dateFrom, end_date: dateTo },
          })
          results[empId] = res.data.results ?? res.data
        })
      )
      return results
    },
    enabled: expandedRows.size > 0,
  })

  function toggleRow(empId: number) {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(empId)) next.delete(empId)
      else next.add(empId)
      return next
    })
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const companies = Array.isArray(companiesData) ? companiesData : companiesData?.results ?? []
  const departments = Array.isArray(departmentsData) ? departmentsData : departmentsData?.results ?? []

  const rows = (data?.rows ?? [])
    .filter(r => !employeeSearch || r.employee_name.toLowerCase().includes(employeeSearch.toLowerCase()))
    .sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      const mul = sortDir === 'asc' ? 1 : -1
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mul
      return String(av).localeCompare(String(bv)) * mul
    })

  async function handleExportExcel() {
    const res = await api.get('/reports/attendance-excel/', {
      params: { date_from: dateFrom, date_to: dateTo, company: company || undefined, department: department || undefined },
      responseType: 'blob',
    })
    return res.data
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <span className="text-muted-foreground/60 ml-1">↕</span>
    return <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={isAr ? 'تقرير الحضور' : 'Attendance Report'}
        description={isAr ? 'تحليل الحضور الشهري وللفترات المخصصة' : 'Monthly and custom date range attendance analysis'}
        breadcrumbs={[{ label: isAr ? 'الحضور' : 'Attendance' }, { label: isAr ? 'تقرير' : 'Report' }]}
        actions={
          <ExportButton
            onExportExcel={handleExportExcel}
            filename="attendance-report"
            label="Export Excel"
          />
        }
      />

      {/* Filters */}
      <div className="bg-card p-4 rounded-lg border border-border flex flex-wrap gap-4 items-end">
        <div className="space-y-1">
          <Label>{isAr ? 'من تاريخ' : 'Date From'}</Label>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
        </div>
        <div className="space-y-1">
          <Label>{isAr ? 'إلى تاريخ' : 'Date To'}</Label>
          <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-40" />
        </div>
        <div className="space-y-1">
          <Label>{isAr ? 'الشركة' : 'Company'}</Label>
          <Select value={company} onValueChange={(v: string) => { setCompany(v === 'all' ? '' : v); setDepartment('') }}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder={isAr ? 'كل الشركات' : 'All Companies'} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{isAr ? 'كل الشركات' : 'All Companies'}</SelectItem>
              {companies.map((c: { id: number; name_en: string }) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.name_en}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>{isAr ? 'القسم' : 'Department'}</Label>
          <Select value={department} onValueChange={(v: string) => setDepartment(v === 'all' ? '' : v)}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder={isAr ? 'كل الأقسام' : 'All Departments'} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{isAr ? 'كل الأقسام' : 'All Departments'}</SelectItem>
              {departments.map((d: { id: number; name_en: string }) => (
                <SelectItem key={d.id} value={String(d.id)}>{d.name_en}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Employee Search</Label>
          <Input
            placeholder="Search employee..."
            value={employeeSearch}
            onChange={e => setEmployeeSearch(e.target.value)}
            className="w-52"
          />
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Avg Attendance Rate"
          value={isLoading ? '—' : `${data?.summary.avg_attendance_rate?.toFixed(1) ?? 0}%`}
          icon={<TrendingUp className="h-5 w-5" />}
          color="emerald"
          loading={isLoading}
        />
        <StatCard
          label={isAr ? "إجمالي الغياب" : "Total Absences"}
          value={isLoading ? '—' : data?.summary.total_absences ?? 0}
          icon={<AlertCircle className="h-5 w-5" />}
          color="red"
          loading={isLoading}
        />
        <StatCard
          label={isAr ? "إجمالي التأخير" : "Total Late Arrivals"}
          value={isLoading ? '—' : data?.summary.total_late ?? 0}
          icon={<Clock className="h-5 w-5" />}
          color="amber"
          loading={isLoading}
        />
        <StatCard
          label={isAr ? "إجمالي الساعات الإضافية" : "Total OT Hours"}
          value={isLoading ? '—' : `${data?.summary.total_ot_hours?.toFixed(1) ?? 0}h`}
          icon={<Users className="h-5 w-5" />}
          color="blue"
          loading={isLoading}
        />
      </div>

      {/* Main Table */}
      <div className="bg-card rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-8" />
              {[
                { key: 'employee_name' as SortKey, label: isAr ? 'الاسم' : 'Name' },
                { key: 'department_name' as SortKey, label: isAr ? 'القسم' : 'Department' },
                { key: 'work_days' as SortKey, label: isAr ? 'أيام العمل' : 'Work Days' },
                { key: 'present' as SortKey, label: isAr ? 'حاضر' : 'Present' },
                { key: 'absent' as SortKey, label: isAr ? 'غائب' : 'Absent' },
                { key: 'late' as SortKey, label: isAr ? 'متأخر' : 'Late' },
                { key: 'on_leave' as SortKey, label: isAr ? 'في إجازة' : 'On Leave' },
                { key: 'total_hours' as SortKey, label: isAr ? 'إجمالي الساعات' : 'Total Hours' },
                { key: 'avg_hours_per_day' as SortKey, label: isAr ? 'متوسط الساعات/يوم' : 'Avg Hrs/Day' },
                { key: 'ot_hours' as SortKey, label: isAr ? 'ساعات إضافية' : 'OT Hours' },
                { key: 'attendance_pct' as SortKey, label: 'Attendance %' },
              ].map(col => (
                <TableHead
                  key={col.key}
                  className="font-semibold cursor-pointer hover:bg-muted select-none"
                  onClick={() => handleSort(col.key)}
                >
                  {col.label}<SortIcon col={col.key} />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 12 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12} className="text-center py-12 text-muted-foreground">
                  No data found for selected filters
                </TableCell>
              </TableRow>
            ) : (
              rows.map(row => (
                <React.Fragment key={row.employee_id}>
                  <TableRow
                    className="hover:bg-muted/50 cursor-pointer"
                    onClick={() => toggleRow(row.employee_id)}
                  >
                    <TableCell>
                      {expandedRows.has(row.employee_id)
                        ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      }
                    </TableCell>
                    <TableCell className="font-medium">{row.employee_name}</TableCell>
                    <TableCell className="text-muted-foreground">{row.department_name}</TableCell>
                    <TableCell className="text-center">{row.work_days}</TableCell>
                    <TableCell className="text-center text-emerald-700 font-medium">{row.present}</TableCell>
                    <TableCell className="text-center text-red-700 font-medium">{row.absent}</TableCell>
                    <TableCell className="text-center text-amber-700 font-medium">{row.late}</TableCell>
                    <TableCell className="text-center text-blue-700 font-medium">{row.on_leave}</TableCell>
                    <TableCell className="text-center">{row.total_hours?.toFixed(1)}h</TableCell>
                    <TableCell className="text-center">{row.avg_hours_per_day?.toFixed(1)}h</TableCell>
                    <TableCell className="text-center">{row.ot_hours?.toFixed(1)}h</TableCell>
                    <TableCell className="text-center">
                      <span className={cn(
                        'font-semibold',
                        row.attendance_pct >= 90 ? 'text-emerald-600' :
                        row.attendance_pct >= 75 ? 'text-amber-600' : 'text-red-600'
                      )}>
                        {row.attendance_pct?.toFixed(1)}%
                      </span>
                    </TableCell>
                  </TableRow>

                  {expandedRows.has(row.employee_id) && (
                    <TableRow className="bg-muted/50/70">
                      <TableCell colSpan={12} className="py-3 px-6">
                        <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                          Day-by-day breakdown
                        </div>
                        {dailyLogsQuery.isLoading ? (
                          <Skeleton className="h-16 w-full" />
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-xs text-muted-foreground border-b border-border">
                                  <th className="text-left py-1 pr-4 font-medium">Date</th>
                                  <th className="text-left py-1 pr-4 font-medium">Check In</th>
                                  <th className="text-left py-1 pr-4 font-medium">Check Out</th>
                                  <th className="text-left py-1 pr-4 font-medium">Status</th>
                                  <th className="text-left py-1 pr-4 font-medium">Hours</th>
                                  <th className="text-left py-1 font-medium">Late (min)</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(dailyLogsQuery.data?.[row.employee_id] ?? []).map((log, i) => (
                                  <tr key={i} className="border-b border-border/60 last:border-0">
                                    <td className="py-1 pr-4">{formatDate(log.date)}</td>
                                    <td className="py-1 pr-4">{log.check_in ?? '—'}</td>
                                    <td className="py-1 pr-4">{log.check_out ?? '—'}</td>
                                    <td className="py-1 pr-4">
                                      <span className={cn(
                                        'text-xs px-1.5 py-0.5 rounded-full font-medium',
                                        log.status === 'present' || log.status === 'on_time' ? 'bg-emerald-50 text-emerald-700' :
                                        log.status === 'late' ? 'bg-amber-50 text-amber-700' :
                                        log.status === 'absent' ? 'bg-red-50 text-red-700' :
                                        'bg-blue-50 text-blue-700'
                                      )}>
                                        {log.status.replace(/_/g, ' ')}
                                      </span>
                                    </td>
                                    <td className="py-1 pr-4">{Number(log.hours_worked ?? 0).toFixed(1)}h</td>
                                    <td className="py-1">{Number(log.late_minutes ?? 0) > 0 ? `${log.late_minutes}min` : '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
