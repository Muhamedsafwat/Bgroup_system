'use client'

import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Upload, Loader2 } from 'lucide-react'
import { useLocale } from '@/lib/i18n'
import { PageHeader } from '@/components/hr/shared/PageHeader'
import { Button } from '@/components/hr/ui/button'
import { Badge } from '@/components/hr/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/hr/ui/avatar'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/hr/ui/select'
import { useToast } from '@/components/hr/ui/toast'
import api from '@/lib/hr/api'
import { formatDate, getInitials, cn } from '@/lib/hr/utils'
import type { AttendanceLog, PaginatedResponse } from '@/lib/hr/types'

const MONTHS = [
  { value: 1, label: 'January' }, { value: 2, label: 'February' },
  { value: 3, label: 'March' }, { value: 4, label: 'April' },
  { value: 5, label: 'May' }, { value: 6, label: 'June' },
  { value: 7, label: 'July' }, { value: 8, label: 'August' },
  { value: 9, label: 'September' }, { value: 10, label: 'October' },
  { value: 11, label: 'November' }, { value: 12, label: 'December' },
]
const CURRENT_YEAR = new Date().getFullYear()
const YEARS = Array.from({ length: 3 }, (_, i) => CURRENT_YEAR - i)

interface TodayRecord {
  employee_id: number
  employee_name: string
  employee_id_str: string
  photo: string | null
  position: string
  department: string
  check_in: string | null
  check_out: string | null
  status: string
  hours_worked: number
  overtime_hours: number
  late_minutes: number
}

const STATUS_CONFIG: Record<string, { variant: 'success' | 'warning' | 'danger' | 'info' | 'default'; bg: string }> = {
  on_time: { variant: 'success', bg: 'bg-emerald-50/50' },
  late: { variant: 'warning', bg: 'bg-amber-50/50' },
  absent: { variant: 'danger', bg: 'bg-red-50/50' },
  leave: { variant: 'info', bg: 'bg-blue-50/50' },
  not_yet: { variant: 'default', bg: 'bg-muted/50' },
  weekend: { variant: 'default', bg: 'bg-muted/50' },
  holiday: { variant: 'default', bg: 'bg-purple-50/50' },
}

export default function TeamAttendancePage() {
  const { locale } = useLocale()
  const isAr = locale === 'ar'
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const now = new Date()
  const [viewMode, setViewMode] = useState<'today' | 'monthly'>('today')
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())

  const { data: todayData, isLoading: todayLoading, refetch: refetchToday } = useQuery<{ data: { stats: Record<string, number>; logs: TodayRecord[] } }>({
    queryKey: ['team-attendance-today-full'],
    queryFn: () => api.get('/attendance/today/', { params: { managed_by: 'me' } }),
    enabled: viewMode === 'today',
  })
  const todayRecords = todayData?.data?.logs ?? []

  const { data: monthlyData, isLoading: monthlyLoading } = useQuery<{ data: PaginatedResponse<AttendanceLog> }>({
    queryKey: ['team-attendance-monthly', month, year],
    queryFn: () => {
      const start = `${year}-${String(month).padStart(2, '0')}-01`
      const lastDay = new Date(year, month, 0).getDate()
      const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
      return api.get('/attendance/logs/', {
        params: { start_date: start, end_date: end, page_size: 200 },
      })
    },
    enabled: viewMode === 'monthly',
  })
  const monthlyLogs = monthlyData?.data?.results ?? []

  const isLoading = viewMode === 'today' ? todayLoading : monthlyLoading

  const todaySummary = {
    present: todayRecords.filter((r) => r.status === 'on_time').length,
    late: todayRecords.filter((r) => r.status === 'late').length,
    absent: todayRecords.filter((r) => r.status === 'absent').length,
    on_leave: todayRecords.filter((r) => r.status === 'leave').length,
    total: todayRecords.length,
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={isAr ? 'حضور الفريق' : 'Team Attendance'}
        description="Monitor your team's attendance and punctuality"
        breadcrumbs={[{ label: isAr ? 'الفريق' : 'Team', href: '/team' }, { label: isAr ? 'الحضور' : 'Attendance' }]}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => refetchToday()}
              disabled={viewMode !== 'today' || todayLoading}
            >
              <RefreshCw className="h-4 w-4" />
              {isAr ? 'تحديث' : 'Refresh'}
            </Button>
          </div>
        }
      />

      {/* View mode toggle */}
      <div className="flex items-center gap-3 flex-wrap bg-card rounded-lg border border-border p-4">
        <div className="flex rounded-lg overflow-hidden border border-border">
          <button
            className={cn(
              'px-4 py-2 text-sm font-medium transition-colors',
              viewMode === 'today'
                ? 'bg-blue-600 text-white'
                : 'bg-card text-muted-foreground hover:bg-muted/50'
            )}
            onClick={() => setViewMode('today')}
          >
            {isAr ? 'اليوم' : 'Today'}
          </button>
          <button
            className={cn(
              'px-4 py-2 text-sm font-medium transition-colors border-l border-border',
              viewMode === 'monthly'
                ? 'bg-blue-600 text-white'
                : 'bg-card text-muted-foreground hover:bg-muted/50'
            )}
            onClick={() => setViewMode('monthly')}
          >
            {isAr ? 'شهري' : 'Monthly'}
          </button>
        </div>

        {viewMode === 'monthly' && (
          <>
            <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTHS.map((m) => (
                  <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {YEARS.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
      </div>

      {/* Today summary chips */}
      {viewMode === 'today' && todayRecords.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {[
            { key: 'present', label: 'Present', count: todaySummary.present, color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
            { key: 'late', label: 'Late', count: todaySummary.late, color: 'bg-amber-100 text-amber-700 border-amber-200' },
            { key: 'absent', label: 'Absent', count: todaySummary.absent, color: 'bg-red-100 text-red-700 border-red-200' },
            { key: 'on_leave', label: 'On Leave', count: todaySummary.on_leave, color: 'bg-blue-100 text-blue-700 border-blue-200' },
          ].map((item) => (
            <div key={item.key} className={cn('flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium', item.color)}>
              <span className="text-lg font-bold">{item.count}</span>
              {item.label}
            </div>
          ))}
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-muted/50 text-sm font-medium text-muted-foreground">
            <span className="text-lg font-bold">{todaySummary.total}</span>
            Total
          </div>
        </div>
      )}

      {isLoading && (
        <div className="bg-card rounded-lg border border-border p-12 flex items-center justify-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />Loading attendance...
        </div>
      )}

      {/* Today view */}
      {!isLoading && viewMode === 'today' && (
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          {todayRecords.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">No team attendance records for today.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  {['Employee', 'Position', 'Check In', 'Check Out', 'Status', 'Hours', 'OT Hrs', 'Late (min)'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {todayRecords.map((record) => {
                  const cfg = STATUS_CONFIG[record.status] ?? { variant: 'default' as const, bg: '' }
                  return (
                    <tr key={record.employee_id} className={cn('hover:brightness-95 transition-all', cfg.bg)}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Avatar className="h-7 w-7 shrink-0">
                            <AvatarImage src={record.photo ?? undefined} />
                            <AvatarFallback className="text-xs bg-blue-100 text-blue-700">
                              {getInitials(record.employee_name)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium text-foreground text-sm">{record.employee_name}</p>
                            <p className="text-xs text-muted-foreground font-mono">{record.employee_id_str}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-foreground text-xs">
                        <div>{record.position}</div>
                        <div className="text-muted-foreground">{record.department}</div>
                      </td>
                      <td className="px-4 py-3 font-mono text-foreground">{record.check_in ? record.check_in.slice(0, 5) : '—'}</td>
                      <td className="px-4 py-3 font-mono text-foreground">{record.check_out ? record.check_out.slice(0, 5) : '—'}</td>
                      <td className="px-4 py-3">
                        <Badge variant={cfg.variant} className="text-xs capitalize">{record.status.replace(/_/g, ' ')}</Badge>
                      </td>
                      <td className="px-4 py-3 text-foreground">{record.hours_worked > 0 ? `${record.hours_worked.toFixed(1)}h` : '—'}</td>
                      <td className="px-4 py-3 text-foreground">{record.overtime_hours > 0 ? <span className="text-blue-600">{record.overtime_hours.toFixed(1)}h</span> : '—'}</td>
                      <td className="px-4 py-3">{record.late_minutes > 0 ? <span className="text-amber-600 font-medium">{record.late_minutes}m</span> : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Monthly view */}
      {!isLoading && viewMode === 'monthly' && (
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          {monthlyLogs.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">No attendance records for this period.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b border-border">
                  <tr>
                    {['Date', 'Employee', 'Check In', 'Check Out', 'Status', 'Hours', 'OT Hours', 'Late (min)'].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {monthlyLogs.map((log) => {
                    const cfg = STATUS_CONFIG[log.status] ?? { variant: 'default' as const, bg: '' }
                    return (
                      <tr key={log.id} className={cn('hover:brightness-95 transition-all', cfg.bg)}>
                        <td className="px-4 py-2.5 text-foreground whitespace-nowrap">{formatDate(log.date)}</td>
                        <td className="px-4 py-2.5 font-medium text-foreground whitespace-nowrap">{log.employee_name}</td>
                        <td className="px-4 py-2.5 font-mono text-foreground">{log.check_in ? log.check_in.slice(0, 5) : '—'}</td>
                        <td className="px-4 py-2.5 font-mono text-foreground">{log.check_out ? log.check_out.slice(0, 5) : '—'}</td>
                        <td className="px-4 py-2.5">
                          <Badge variant={cfg.variant} className="text-xs capitalize">{log.status.replace(/_/g, ' ')}</Badge>
                        </td>
                        <td className="px-4 py-2.5 text-foreground">{Number(log.hours_worked) > 0 ? `${Number(log.hours_worked).toFixed(1)}h` : '—'}</td>
                        <td className="px-4 py-2.5 text-foreground">{Number(log.overtime_hours) > 0 ? <span className="text-blue-600">{Number(log.overtime_hours).toFixed(1)}h</span> : '—'}</td>
                        <td className="px-4 py-2.5">{log.late_minutes > 0 ? <span className="text-amber-600 font-medium">{log.late_minutes}m</span> : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
