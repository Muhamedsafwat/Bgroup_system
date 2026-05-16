'use client'

import { describeError } from "@/lib/zod-errors";

import React, { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Clock, LogIn, LogOut, CheckCircle2, AlertCircle } from 'lucide-react'
import api from '@/lib/hr/api'
import { cn, formatDate } from '@/lib/hr/utils'
import { Button } from '@/components/hr/ui/button'
import { Skeleton } from '@/components/hr/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/hr/ui/dialog'
import { Label } from '@/components/hr/ui/label'
import { Textarea } from '@/components/hr/ui/textarea'
import { toast } from '@/components/hr/ui/toast'

interface TodayStatus {
  has_checked_in: boolean
  has_checked_out: boolean
  check_in_time: string | null
  check_out_time: string | null
  is_late: boolean
  late_minutes: number
  hours_worked: number
  overtime_hours: number
  shift_name: string
  shift_start: string
  shift_end: string
  status: string
}

interface MonthLog {
  date: string
  status: string
  check_in: string | null
  check_out: string | null
}

const STATUS_DOT: Record<string, string> = {
  on_time: 'bg-emerald-500',
  present: 'bg-emerald-500',
  late: 'bg-amber-400',
  absent: 'bg-red-500',
  on_leave: 'bg-blue-500',
  leave: 'bg-blue-500',
  weekend: 'bg-slate-300',
  public_holiday: 'bg-purple-400',
  half_day: 'bg-blue-300',
}

function LiveClock() {
  const [time, setTime] = useState(new Date())

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="text-center">
      <p className="text-5xl font-bold font-mono text-foreground tracking-wider tabular-nums">
        {time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
      </p>
      <p className="text-sm text-muted-foreground mt-1">
        {time.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
      </p>
    </div>
  )
}

function MiniCalendar({ logs, currentMonth, currentYear }: {
  logs: MonthLog[]
  currentMonth: number
  currentYear: number
}) {
  const firstDay = new Date(currentYear, currentMonth - 1, 1).getDay()
  const daysInMonth = new Date(currentYear, currentMonth, 0).getDate()
  const today = new Date().getDate()

  const logMap = new Map(logs.map(l => {
    const d = new Date(l.date)
    return [d.getDate(), l.status]
  }))

  const cells: (number | null)[] = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]
  const weeks: (number | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7))
  }

  const monthName = new Date(currentYear, currentMonth - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })

  return (
    <div className="w-full">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide text-center mb-3">{monthName}</p>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
          <div key={d} className="text-[10px] font-semibold text-muted-foreground py-1">{d}</div>
        ))}
        {cells.map((day, i) => {
          if (!day) return <div key={`empty-${i}`} />
          const status = logMap.get(day)
          const isToday = day === today
          const dotColor = status ? (STATUS_DOT[status] ?? 'bg-slate-200') : 'bg-transparent'
          return (
            <div
              key={day}
              className={cn(
                'flex flex-col items-center py-1 rounded-md text-xs transition-colors',
                isToday ? 'bg-brand-navy text-white font-bold' : 'hover:bg-muted/50 text-foreground'
              )}
            >
              <span>{day}</span>
              {status && (
                <span className={cn('h-1.5 w-1.5 rounded-full mt-0.5', isToday ? 'bg-card/70' : dotColor)} />
              )}
            </div>
          )
        })}
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-3 justify-center">
        {[
          { label: 'On Time', cls: 'bg-emerald-500' },
          { label: 'Late', cls: 'bg-amber-400' },
          { label: 'Absent', cls: 'bg-red-500' },
          { label: 'Leave', cls: 'bg-blue-500' },
          { label: 'Weekend', cls: 'bg-slate-300' },
        ].map(item => (
          <div key={item.label} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span className={cn('h-2 w-2 rounded-full', item.cls)} />
            {item.label}
          </div>
        ))}
      </div>
    </div>
  )
}

interface CheckInOutProps {
  className?: string
}

export default function CheckInOut({ className }: CheckInOutProps) {
  const qc = useQueryClient()
  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()

  const [otDialogOpen, setOtDialogOpen] = useState(false)
  const [otNotes, setOtNotes] = useState('')

  const { data: todayStatus, isLoading: loadingToday } = useQuery<TodayStatus>({
    queryKey: ['attendance', 'today-my'],
    queryFn: async () => {
      const res = await api.get('/attendance/today-my/')
      return res.data
    },
    refetchInterval: 30_000,
  })

  const { data: monthLogs, isLoading: loadingMonth } = useQuery<MonthLog[]>({
    queryKey: ['attendance', 'my-logs', currentMonth, currentYear],
    queryFn: async () => {
      const res = await api.get('/attendance/my-logs/', {
        params: { month: currentMonth, year: currentYear },
      })
      return Array.isArray(res.data) ? res.data : res.data.results ?? []
    },
  })

  const checkInMutation = useMutation({
    mutationFn: () => api.post('/attendance/checkin/'),
    onSuccess: (data) => {
      const timeStr = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
      // Optimistic update — flip UI instantly before background refetch
      qc.setQueryData<TodayStatus>(['attendance', 'today-my'], (old) =>
        old ? { ...old, has_checked_in: true, check_in_time: timeStr, status: data?.data?.status ?? 'on_time' } : old
      )
      toast.success('Checked in successfully')
      qc.invalidateQueries({ queryKey: ['attendance', 'today-my'] })
      qc.invalidateQueries({ queryKey: ['attendance', 'my-logs'] })
    },
    onError: () => toast.error('Check-in failed', 'Please try again'),
  })

  const checkOutMutation = useMutation({
    mutationFn: () => api.post('/attendance/checkout/'),
    onSuccess: (data) => {
      const timeStr = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
      // Optimistic update — flip UI instantly before background refetch
      qc.setQueryData<TodayStatus>(['attendance', 'today-my'], (old) =>
        old ? { ...old, has_checked_out: true, check_out_time: timeStr, overtime_hours: data?.data?.overtime_hours ?? 0 } : old
      )
      toast.success('Checked out successfully')
      qc.invalidateQueries({ queryKey: ['attendance', 'today-my'] })
      qc.invalidateQueries({ queryKey: ['attendance', 'my-logs'] })
      if (data?.data?.overtime_hours > 0) {
        setOtDialogOpen(true)
      }
    },
    onError: () => toast.error('Check-out failed', 'Please try again'),
  })

  const otRequestMutation = useMutation({
    mutationFn: () => api.post('/overtime/', {
      date: new Date().toISOString().split('T')[0],
      overtime_type: 'weekday',
      hours_requested: todayStatus?.overtime_hours ?? 0,
      reason: otNotes || 'Overtime worked today',
    }),
    onSuccess: () => {
      toast.success('Overtime request submitted')
      setOtDialogOpen(false)
      setOtNotes('')
    },
    onError: (__err: unknown) => toast.error(describeError(__err) || 'Failed to submit OT request'),
  })

  const hasCheckedIn = todayStatus?.has_checked_in ?? false
  const hasCheckedOut = todayStatus?.has_checked_out ?? false

  function handleMainAction() {
    if (!hasCheckedIn) {
      checkInMutation.mutate()
    } else if (!hasCheckedOut) {
      checkOutMutation.mutate()
    }
  }

  const isBusy = checkInMutation.isPending || checkOutMutation.isPending

  return (
    <div className={cn('bg-card border border-border rounded-xl p-6 space-y-6', className)}>
      {/* Live Clock */}
      <LiveClock />

      {/* Shift Info */}
      {loadingToday ? (
        <Skeleton className="h-12 w-full rounded-lg" />
      ) : todayStatus ? (
        <div className="bg-muted/50 border border-border rounded-lg px-4 py-3 text-center">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">Your Shift</p>
          <p className="font-semibold text-foreground">
            {todayStatus.shift_start} – {todayStatus.shift_end}
            {todayStatus.shift_name && (
              <span className="ml-2 text-sm text-muted-foreground">({todayStatus.shift_name})</span>
            )}
          </p>
        </div>
      ) : null}

      {/* Status Message */}
      {!loadingToday && hasCheckedIn && !hasCheckedOut && (
        <div className={cn(
          'flex items-center gap-3 px-4 py-3 rounded-lg border text-sm',
          todayStatus?.is_late
            ? 'bg-amber-50 border-amber-200 text-amber-800'
            : 'bg-emerald-50 border-emerald-200 text-emerald-800'
        )}>
          {todayStatus?.is_late ? (
            <AlertCircle className="h-5 w-5 text-amber-600 shrink-0" />
          ) : (
            <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
          )}
          <div>
            <p className="font-semibold">
              Checked in at {todayStatus?.check_in_time}
              {todayStatus?.is_late && ` — Late by ${todayStatus.late_minutes} min`}
              {!todayStatus?.is_late && ' — On Time'}
            </p>
            <p className="text-xs opacity-75">
              {todayStatus?.hours_worked?.toFixed(1)}h worked so far
            </p>
          </div>
        </div>
      )}

      {!loadingToday && hasCheckedOut && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg border bg-blue-50 border-blue-200 text-blue-800 text-sm">
          <Clock className="h-5 w-5 text-blue-600 shrink-0" />
          <div>
            <p className="font-semibold">
              Checked out at {todayStatus?.check_out_time}
            </p>
            <p className="text-xs opacity-75">
              Total hours worked: {todayStatus?.hours_worked?.toFixed(1)}h
              {(todayStatus?.overtime_hours ?? 0) > 0 && (
                <span className="ml-1 text-amber-600 font-medium">
                  (+{todayStatus?.overtime_hours?.toFixed(1)}h OT)
                </span>
              )}
            </p>
          </div>
        </div>
      )}

      {/* Main Check In / Check Out Button */}
      {!hasCheckedOut && (
        <button
          onClick={handleMainAction}
          disabled={isBusy}
          className={cn(
            'w-full py-6 rounded-xl border-2 text-lg font-bold flex flex-col items-center justify-center gap-2 transition-all shadow-sm',
            !hasCheckedIn
              ? 'bg-brand-navy hover:bg-brand-navy/90 border-brand-navy text-white active:scale-95'
              : 'bg-red-600 hover:bg-red-700 border-red-600 text-white active:scale-95',
            isBusy && 'opacity-60 cursor-not-allowed'
          )}
        >
          {!hasCheckedIn ? (
            <>
              <LogIn className="h-8 w-8" />
              <span>{isBusy ? 'Checking In...' : 'CHECK IN'}</span>
            </>
          ) : (
            <>
              <LogOut className="h-8 w-8" />
              <span>{isBusy ? 'Checking Out...' : 'CHECK OUT'}</span>
            </>
          )}
        </button>
      )}

      {hasCheckedOut && (
        <div className="w-full py-5 rounded-xl border-2 border-border bg-muted/50 text-muted-foreground flex flex-col items-center justify-center gap-1.5">
          <CheckCircle2 className="h-7 w-7" />
          <span className="font-semibold text-sm">Attendance Completed</span>
          <span className="text-xs">{formatDate(new Date().toISOString())}</span>
        </div>
      )}

      {/* Mini Calendar */}
      <div className="border-t border-border pt-4">
        {loadingMonth ? (
          <Skeleton className="h-48 w-full rounded-lg" />
        ) : (
          <MiniCalendar
            logs={monthLogs ?? []}
            currentMonth={currentMonth}
            currentYear={currentYear}
          />
        )}
      </div>

      {/* OT Prompt Dialog */}
      <Dialog open={otDialogOpen} onOpenChange={setOtDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-amber-500" />
              Overtime Detected
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              You worked{' '}
              <span className="font-bold text-amber-700">
                {todayStatus?.overtime_hours?.toFixed(1)}h
              </span>{' '}
              of overtime today. Would you like to submit an overtime request?
            </p>
            <div className="space-y-1">
              <Label htmlFor="ot_notes">Notes (optional)</Label>
              <Textarea
                id="ot_notes"
                value={otNotes}
                onChange={e => setOtNotes(e.target.value)}
                placeholder="Reason for overtime..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOtDialogOpen(false)}>Skip</Button>
            <Button
              onClick={() => otRequestMutation.mutate()}
              loading={otRequestMutation.isPending}
              className="bg-amber-600 hover:bg-amber-700"
            >
              Submit OT Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
