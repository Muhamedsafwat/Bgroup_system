'use client'

import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { Eye, AlertTriangle, Clock, Loader2, CheckSquare, CalendarOff, Users as UsersIcon, TrendingUp } from 'lucide-react'
import { useSession } from 'next-auth/react'
import { WelcomeBanner, firstNameOf } from '@/components/shared/WelcomeHero'
import { Button } from '@/components/hr/ui/button'
import { Avatar, AvatarFallback } from '@/components/hr/ui/avatar'
import { Badge } from '@/components/hr/ui/badge'
import api from '@/lib/hr/api'
import { getInitials, capitalize, cn } from '@/lib/hr/utils'

/**
 * /hr/team — anyone with reports sees them here. Membership is derived from
 * the org chart (HrEmployee.directManager → reports), not a `team_lead` role
 * flag. The page renders nothing-state when the user has no subordinates.
 */

type Subordinate = {
  id: string
  employeeId: string
  fullNameEn: string
  positionEn: string
  status: string
  userId: string | null
  directManagerId: string | null
  directManager: { id: string; fullNameEn: string } | null
  department: { id: string; nameEn: string } | null
  company: { id: string; nameEn: string } | null
}

interface AttendanceToday {
  employee_id: string
  status: 'on_time' | 'late' | 'absent' | 'leave' | 'not_yet' | 'weekend' | 'holiday'
  check_in?: string
}

const ATTENDANCE_CONFIG: Record<string, { label: string; class: string }> = {
  on_time: { label: 'On Time', class: 'bg-emerald-100 text-emerald-700 border border-emerald-200' },
  late: { label: 'Late', class: 'bg-amber-100 text-amber-700 border border-amber-200' },
  absent: { label: 'Absent', class: 'bg-red-100 text-red-700 border border-red-200' },
  leave: { label: 'On Leave', class: 'bg-blue-100 text-blue-700 border border-blue-200' },
  not_yet: { label: 'Not Checked In', class: 'bg-muted text-muted-foreground border border-border' },
  weekend: { label: 'Weekend', class: 'bg-purple-100 text-purple-700 border border-purple-200' },
  holiday: { label: 'Holiday', class: 'bg-purple-100 text-purple-700 border border-purple-200' },
}

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'default'> = {
  active: 'success',
  on_leave: 'info',
  probation: 'warning',
  terminated: 'danger',
  suspended: 'danger',
}

export default function TeamPage() {
  const router = useRouter()
  const { data: session } = useSession()

  const { data: teamData, isLoading } = useQuery<{ subordinates: Subordinate[]; total: number }>({
    queryKey: ['my-team'],
    queryFn: async () => {
      const r = await fetch('/api/hr/subordinates', { credentials: 'include' })
      if (!r.ok) return { subordinates: [], total: 0 }
      return r.json()
    },
  })
  const teamMembers = teamData?.subordinates ?? []

  const { data: attendanceData } = useQuery<{ data: { stats: Record<string, number>; logs: AttendanceToday[] } }>({
    queryKey: ['team-attendance-today'],
    queryFn: () => api.get('/attendance/today/', { params: { managed_by: 'me' } }),
  })
  const attendanceLogs: AttendanceToday[] = attendanceData?.data?.logs ?? []
  const attendanceMap = new Map(attendanceLogs.map((a) => [a.employee_id, a]))

  function getAttendanceStatus(employeeId: string): string {
    return attendanceMap.get(employeeId)?.status ?? 'not_yet'
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-16 gap-3 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />Loading team...
      </div>
    )
  }

  // Compute roll-up stats for the team-lead landing experience: a one-glance
  // read of how the reporting tree is doing today.
  const totalReports = teamMembers.length
  const presentToday = teamMembers.filter((m) => {
    const s = getAttendanceStatus(m.id)
    return s === 'on_time' || s === 'late'
  }).length
  const onLeaveToday = teamMembers.filter((m) => getAttendanceStatus(m.id) === 'leave').length
  const absentToday = teamMembers.filter((m) => getAttendanceStatus(m.id) === 'absent').length
  const onProbation = teamMembers.filter((m) => m.status === 'probation').length

  return (
    <div className="space-y-6">
      <WelcomeBanner
        firstName={firstNameOf(session?.user?.name, session?.user?.email)}
        rolePill="Team lead"
        pillTone="violet"
        email={session?.user?.email}
        subtitle={`${teamMembers.length} ${teamMembers.length === 1 ? 'person reports' : 'people report'} to you`}
      />
      {totalReports > 0 && (
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => router.push('/hr/team/attendance')}>
            <Clock className="h-3.5 w-3.5 me-1" /> Today&apos;s attendance
          </Button>
          <Button size="sm" onClick={() => router.push('/hr/overtime/pending')}>
            <CheckSquare className="h-3.5 w-3.5 me-1" /> Pending approvals
          </Button>
        </div>
      )}

      {/* Team-lead roll-up: instant read of how the reports are doing today. */}
      {totalReports > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-card rounded-lg border border-border p-4">
            <div className="flex items-center gap-2 mb-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              <UsersIcon className="h-3.5 w-3.5" /> Reports
            </div>
            <p className="text-2xl font-bold text-foreground">{totalReports}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {onProbation > 0 ? `${onProbation} on probation` : 'All confirmed'}
            </p>
          </div>
          <div className="bg-emerald-50 rounded-lg border border-emerald-200 p-4">
            <div className="flex items-center gap-2 mb-1.5 text-xs font-semibold text-emerald-700 uppercase tracking-wide">
              <CheckSquare className="h-3.5 w-3.5" /> Present
            </div>
            <p className="text-2xl font-bold text-emerald-700">{presentToday}</p>
            <p className="text-xs text-emerald-600/70 mt-0.5">
              {totalReports > 0 ? `${Math.round((presentToday / totalReports) * 100)}%` : '—'} of team
            </p>
          </div>
          <div className="bg-blue-50 rounded-lg border border-blue-200 p-4">
            <div className="flex items-center gap-2 mb-1.5 text-xs font-semibold text-blue-700 uppercase tracking-wide">
              <CalendarOff className="h-3.5 w-3.5" /> On leave
            </div>
            <p className="text-2xl font-bold text-blue-700">{onLeaveToday}</p>
            <p className="text-xs text-blue-600/70 mt-0.5">today</p>
          </div>
          <div className={cn(
            "rounded-lg border p-4",
            absentToday > 0 ? "bg-red-50 border-red-200" : "bg-card border-border"
          )}>
            <div className={cn(
              "flex items-center gap-2 mb-1.5 text-xs font-semibold uppercase tracking-wide",
              absentToday > 0 ? "text-red-700" : "text-muted-foreground"
            )}>
              <AlertTriangle className="h-3.5 w-3.5" /> Absent
            </div>
            <p className={cn("text-2xl font-bold", absentToday > 0 ? "text-red-700" : "text-foreground")}>
              {absentToday}
            </p>
            <p className={cn("text-xs mt-0.5", absentToday > 0 ? "text-red-600/70" : "text-muted-foreground")}>
              unexcused today
            </p>
          </div>
        </div>
      )}

      {teamMembers.length === 0 && (
        <div className="bg-card rounded-lg border border-border p-12 text-center text-muted-foreground">
          No-one reports to you yet. When an HR admin sets you as someone&apos;s direct
          manager, they (and anyone reporting up through them) will appear here.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {teamMembers.map((member) => {
          const attendanceStatus = getAttendanceStatus(member.id)
          const attConfig = ATTENDANCE_CONFIG[attendanceStatus] ?? ATTENDANCE_CONFIG['not_yet']

          return (
            <div
              key={member.id}
              className="bg-card rounded-lg border border-border p-5 hover:shadow-md transition-shadow flex flex-col gap-4"
            >
              {/* Header */}
              <div className="flex items-start gap-3">
                <Avatar className="h-12 w-12 shrink-0">
                  <AvatarFallback className="text-sm font-bold bg-blue-100 text-blue-700">
                    {getInitials(member.fullNameEn)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground leading-tight truncate">{member.fullNameEn}</p>
                  <p className="text-xs text-muted-foreground truncate">{member.positionEn || '—'}</p>
                  <p className="text-xs text-muted-foreground truncate">{member.department?.nameEn ?? '—'}</p>
                </div>
              </div>

              {/* Status row */}
              <div className="flex items-center justify-between gap-2">
                <Badge variant={STATUS_VARIANT[member.status] ?? 'default'} className="text-xs capitalize">
                  {capitalize(member.status)}
                </Badge>
                <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', attConfig.class)}>
                  {attConfig.label}
                </span>
              </div>

              {/* Quick actions */}
              <div className="flex items-center gap-1.5 pt-2 border-t border-border/60">
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex-1 h-7 text-xs gap-1 text-foreground"
                  onClick={() => router.push(`/hr/employees/${member.id}`)}
                >
                  <Eye className="h-3.5 w-3.5" />
                  Profile
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex-1 h-7 text-xs gap-1 text-red-600 hover:text-red-700 hover:bg-red-50"
                  onClick={() => router.push(`/hr/employees/${member.id}?tab=incidents`)}
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Incident
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex-1 h-7 text-xs gap-1 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                  onClick={() => router.push(`/hr/overtime?employee=${member.id}`)}
                >
                  <Clock className="h-3.5 w-3.5" />
                  OT
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
