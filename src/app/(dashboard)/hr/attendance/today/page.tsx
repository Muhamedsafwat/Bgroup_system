'use client'

import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Edit2, Clock } from 'lucide-react'
import api from '@/lib/hr/api'
import { formatDate, cn } from '@/lib/hr/utils'
import { useLocale } from '@/lib/i18n'
import { PageHeader } from '@/components/hr/shared/PageHeader'
import { Button } from '@/components/hr/ui/button'
import { Input } from '@/components/hr/ui/input'
import { Label } from '@/components/hr/ui/label'
import { Badge } from '@/components/hr/ui/badge'
import { Skeleton } from '@/components/hr/ui/skeleton'
import { Textarea } from '@/components/hr/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/hr/ui/dialog'
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
import { toast } from '@/components/hr/ui/toast'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

interface TodayLog {
  id: number
  employee: number
  employee_id_str: string
  employee_name: string
  department_name: string
  shift_name: string
  expected_in: string | null
  check_in: string | null
  expected_out: string | null
  check_out: string | null
  status: string
  hours_worked: number
  auto_actions: string[]
}

interface TodayStats {
  total: number
  checked_in: number
  on_time: number
  late: number
  not_yet: number
  absent: number
  on_leave: number
}

interface TodayResponse {
  stats: TodayStats
  logs: TodayLog[]
}

const manualEntrySchema = z.object({
  employee_id: z.number(),
  date: z.string().min(1, 'Date is required'),
  check_in: z.string().optional(),
  check_out: z.string().optional(),
  reason: z.string().min(1, 'Reason is required'),
})

type ManualEntryForm = z.infer<typeof manualEntrySchema>

function getStatusBadgeVariant(status: string): 'success' | 'warning' | 'danger' | 'info' | 'default' {
  const map: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'default'> = {
    on_time: 'success',
    present: 'success',
    late: 'warning',
    absent: 'danger',
    on_leave: 'info',
    leave: 'info',
    weekend: 'default',
    not_checked_in: 'default',
    half_day: 'info',
  }
  return map[status] ?? 'default'
}

function StatusChip({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className={cn('flex items-center gap-2 px-3 py-2 rounded-lg border', color)}>
      <span className="text-lg font-bold">{count}</span>
      <span className="text-xs font-medium">{label}</span>
    </div>
  )
}

export default function TodayAttendancePage() {
  const { locale } = useLocale()
  const isAr = locale === "ar"
  const qc = useQueryClient()
  const [departmentFilter, setDepartmentFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [manualEntryOpen, setManualEntryOpen] = useState(false)
  const [selectedLog, setSelectedLog] = useState<TodayLog | null>(null)
  // Day filter — defaults to today. The page is named "Today's Attendance"
  // but it lets the manager pick any past day for review without leaving.
  const todayIso = new Date().toISOString().split('T')[0]
  const [selectedDate, setSelectedDate] = useState(todayIso)
  const isToday = selectedDate === todayIso

  const { data, isLoading, refetch, isFetching } = useQuery<TodayResponse>({
    queryKey: ['attendance', 'today', selectedDate],
    queryFn: async () => {
      const res = await api.get('/attendance/today/', { params: { date: selectedDate } })
      return res.data
    },
    // Only auto-refresh when viewing today — older days don't change.
    refetchInterval: isToday ? 60_000 : false,
  })

  const { register, handleSubmit, reset, setValue, formState: { errors, isSubmitting } } = useForm<ManualEntryForm>({
    resolver: zodResolver(manualEntrySchema),
  })

  const manualEntryMutation = useMutation({
    mutationFn: (data: ManualEntryForm) => api.post('/attendance/manual-entry/', {
      employee_id: data.employee_id,
      date: data.date,
      check_in: data.check_in || undefined,
      check_out: data.check_out || undefined,
      reason: data.reason,
    }),
    onSuccess: () => {
      toast.success('Manual entry recorded')
      qc.invalidateQueries({ queryKey: ['attendance', 'today'] })
      setManualEntryOpen(false)
      reset()
    },
    onError: () => {
      toast.error('Failed to record entry', 'Please try again')
    },
  })

  function openManualEntry(log: TodayLog) {
    setSelectedLog(log)
    setValue('employee_id', log.employee)
    setValue('date', new Date().toISOString().split('T')[0])
    setManualEntryOpen(true)
  }

  const stats = data?.stats
  const logs = data?.logs ?? []

  const departments = Array.from(new Set(logs.map(l => l.department_name).filter(Boolean)))
  const statuses = ['on_time', 'late', 'absent', 'leave', 'not_yet', 'weekend']

  const filtered = logs.filter(log => {
    if (departmentFilter && departmentFilter !== 'all' && log.department_name !== departmentFilter) return false
    if (statusFilter && statusFilter !== 'all' && log.status !== statusFilter) return false
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      if (!log.employee_name.toLowerCase().includes(q) && !log.employee_id_str?.toLowerCase().includes(q)) return false
    }
    return true
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title={isToday ? (isAr ? "حضور اليوم" : "Today's Attendance") : (isAr ? "الحضور" : "Attendance")}
        description={
          isToday
            ? (isAr ? `الحضور الحي لـ ${formatDate(new Date().toISOString(), 'EEEE, dd MMMM yyyy')}` : `Live attendance for ${formatDate(new Date().toISOString(), 'EEEE, dd MMMM yyyy')}`)
            : (isAr ? `الحضور بتاريخ ${formatDate(`${selectedDate}T00:00:00`, 'EEEE, dd MMMM yyyy')} (سجل تاريخي)` : `Attendance on ${formatDate(`${selectedDate}T00:00:00`, 'EEEE, dd MMMM yyyy')} (historical)`)
        }
        breadcrumbs={[
          { label: isAr ? "الحضور" : "Attendance" },
          { label: isToday ? (isAr ? "الحي اليوم" : "Today's Live") : (isAr ? "عرض اليوم" : "Day view") },
        ]}
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-2">
            <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
            {isAr ? "تحديث" : "Refresh"}
          </Button>
        }
      />

      {/* Stats Bar */}
      <div className="flex flex-wrap gap-3">
        {isLoading ? (
          Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-14 w-28 rounded-lg" />)
        ) : (
          <>
            <StatusChip label={isAr ? "الإجمالي" : "Total"} count={stats?.total ?? 0} color="bg-muted/50 border-border text-foreground" />
            <StatusChip label={isAr ? "حضر" : "Checked In"} count={stats?.checked_in ?? 0} color="bg-blue-50 border-blue-200 text-blue-700" />
            <StatusChip label={isAr ? "في الموعد" : "On Time"} count={stats?.on_time ?? 0} color="bg-emerald-50 border-emerald-200 text-emerald-700" />
            <StatusChip label={isAr ? "متأخر" : "Late"} count={stats?.late ?? 0} color="bg-amber-50 border-amber-200 text-amber-700" />
            <StatusChip label={isAr ? "لم يحضر بعد" : "Not Yet"} count={stats?.not_yet ?? 0} color="bg-muted/50 border-border text-muted-foreground" />
            <StatusChip label={isAr ? "غائب" : "Absent"} count={stats?.absent ?? 0} color="bg-red-50 border-red-200 text-red-700" />
            <StatusChip label={isAr ? "في إجازة" : "On Leave"} count={stats?.on_leave ?? 0} color="bg-blue-50 border-blue-100 text-blue-600" />
          </>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center bg-card p-4 rounded-lg border border-border">
        <div className="flex items-center gap-2">
          <Label htmlFor="att-date" className="text-xs text-muted-foreground uppercase tracking-wide">{isAr ? "التاريخ" : "Date"}</Label>
          <Input
            id="att-date"
            type="date"
            value={selectedDate}
            max={todayIso}
            onChange={(e) => setSelectedDate(e.target.value || todayIso)}
            className="w-40"
          />
          {!isToday && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSelectedDate(todayIso)}
              className="text-xs"
            >
              {isAr ? "اذهب إلى اليوم" : "Jump to today"}
            </Button>
          )}
        </div>

        <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder={isAr ? "كل الأقسام" : "All Departments"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{isAr ? "كل الأقسام" : "All Departments"}</SelectItem>
            {departments.map(d => (
              <SelectItem key={d} value={d}>{d}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder={isAr ? "كل الحالات" : "All Statuses"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{isAr ? "كل الحالات" : "All Statuses"}</SelectItem>
            {statuses.map(s => (
              <SelectItem key={s} value={s}>{s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          placeholder={isAr ? "ابحث بالاسم أو الرقم..." : "Search by name or ID..."}
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="w-60"
        />
      </div>

      {/* Table */}
      <div className="bg-card rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="font-semibold">{isAr ? "رقم الموظف" : "Employee ID"}</TableHead>
              <TableHead className="font-semibold">{isAr ? "الاسم" : "Name"}</TableHead>
              <TableHead className="font-semibold">{isAr ? "القسم" : "Department"}</TableHead>
              <TableHead className="font-semibold">{isAr ? "الوردية" : "Shift"}</TableHead>
              <TableHead className="font-semibold">{isAr ? "حضور متوقع" : "Expected In"}</TableHead>
              <TableHead className="font-semibold">{isAr ? "تسجيل دخول" : "Check-In"}</TableHead>
              <TableHead className="font-semibold">{isAr ? "انصراف متوقع" : "Expected Out"}</TableHead>
              <TableHead className="font-semibold">{isAr ? "تسجيل خروج" : "Check-Out"}</TableHead>
              <TableHead className="font-semibold">{isAr ? "الحالة" : "Status"}</TableHead>
              <TableHead className="font-semibold">{isAr ? "ساعات" : "Hours"}</TableHead>
              <TableHead className="font-semibold">{isAr ? "إجراءات تلقائية" : "Auto-Actions"}</TableHead>
              <TableHead className="font-semibold text-center">{isAr ? "إجراءات" : "Actions"}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 12 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12} className="text-center py-12 text-muted-foreground">
                  No attendance records found
                </TableCell>
              </TableRow>
            ) : (
              filtered.map(log => (
                <TableRow key={log.id} className="hover:bg-muted/50">
                  <TableCell className="font-mono text-sm">{log.employee_id_str}</TableCell>
                  <TableCell className="font-medium">{log.employee_name}</TableCell>
                  <TableCell className="text-muted-foreground">{log.department_name}</TableCell>
                  <TableCell className="text-muted-foreground">{log.shift_name || '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{log.expected_in ?? '—'}</TableCell>
                  <TableCell className={cn(
                    'font-medium',
                    log.check_in ? 'text-foreground' : 'text-muted-foreground'
                  )}>
                    {log.check_in ?? '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{log.expected_out ?? '—'}</TableCell>
                  <TableCell className={cn(
                    'font-medium',
                    log.check_out ? 'text-foreground' : 'text-muted-foreground'
                  )}>
                    {log.check_out ?? '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={getStatusBadgeVariant(log.status)}>
                      {log.status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {Number(log.hours_worked ?? 0) > 0 ? `${Number(log.hours_worked).toFixed(1)}h` : '—'}
                  </TableCell>
                  <TableCell>
                    {log.auto_actions && log.auto_actions.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {log.auto_actions.map((action, i) => (
                          <span key={i} className="text-xs px-1.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded">
                            {action}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-sm">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openManualEntry(log)}
                      title="Manual Entry"
                      className="h-8 w-8 p-0"
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Manual Entry Dialog */}
      <Dialog open={manualEntryOpen} onOpenChange={setManualEntryOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-brand-navy" />
              Manual Attendance Entry
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(data => manualEntryMutation.mutate(data))} className="space-y-4">
            <div className="space-y-1">
              <Label>Employee</Label>
              <Input value={selectedLog?.employee_name ?? ''} disabled className="bg-muted/50" />
              <input type="hidden" {...register('employee_id', { valueAsNumber: true })} />
            </div>

            <div className="space-y-1">
              <Label htmlFor="date">Date *</Label>
              <Input
                id="date"
                type="date"
                {...register('date')}
                className={errors.date ? 'border-red-500' : ''}
              />
              {errors.date && <p className="text-xs text-red-500">{errors.date.message}</p>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="check_in">Check-in Time</Label>
                <Input id="check_in" type="time" {...register('check_in')} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="check_out">Check-out Time</Label>
                <Input id="check_out" type="time" {...register('check_out')} />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="reason">Reason *</Label>
              <Textarea
                id="reason"
                {...register('reason')}
                placeholder="Provide reason for manual entry..."
                rows={3}
                className={errors.reason ? 'border-red-500' : ''}
              />
              {errors.reason && <p className="text-xs text-red-500">{errors.reason.message}</p>}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setManualEntryOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={isSubmitting || manualEntryMutation.isPending}>
                Submit Entry
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
