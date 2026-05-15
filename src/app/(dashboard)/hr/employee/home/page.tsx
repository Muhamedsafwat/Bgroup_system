'use client'

import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import {
  Clock,
  TrendingUp,
  DollarSign,
  AlertTriangle,
  Gift,
  CalendarDays,
  UserX,
  CheckCircle2,
  ChevronRight,
  Target,
  Briefcase,
} from 'lucide-react'
import { PageHeader } from '@/components/hr/shared/PageHeader'
import { WelcomeBanner, firstNameOf } from '@/components/shared/WelcomeHero'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/hr/ui/card'
import { Badge } from '@/components/hr/ui/badge'
import { Button } from '@/components/hr/ui/button'
import { Skeleton } from '@/components/hr/ui/skeleton'
import { useAuth } from '@/contexts/hr/AuthContext'
import api from '@/lib/hr/api'
import { formatCurrency, formatDate } from '@/lib/hr/utils'

type CommissionBucket = { count: number; wonValueEGP: number; commissionEGP: number }
interface CommissionSummary {
  commissionRate: number
  lifetime: CommissionBucket
  thisMonth: CommissionBucket
  thisYear: CommissionBucket
  recentWins: Array<{
    id: string
    code: string
    title: string
    valueEGP: number
    commissionEGP: number
    dateClosed: string | null
    company: string
  }>
}

interface AttendanceSummary {
  attendance_rate: number
  total_hours: number
  days_present: number
  late_count: number
  absent_days: number
}

interface TodayStatus {
  has_checked_in: boolean
  has_checked_out: boolean
  check_in_time: string | null
  check_out_time: string | null
  is_late: boolean
  status: string
  hours_worked: number
  shift_start: string
  shift_end: string
}

interface SalarySlip {
  id: number
  month: number
  year: number
  base_salary: number
  overtime_amount: number
  total_bonuses: number
  total_deductions: number
  net_salary: number
  status: string
}

interface MyIncident {
  id: number
  status: string
  deduction_amount: string
  incident_date: string
  rule_name: string
}

interface MyBonus {
  id: number
  status: string
  bonus_amount: string
  bonus_date: string
  rule_name: string
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function StatBox({
  label,
  value,
  sub,
  color = 'slate',
  loading,
}: {
  label: string
  value: string | number
  sub?: string
  color?: 'emerald' | 'amber' | 'red' | 'blue' | 'slate' | 'navy'
  loading?: boolean
}) {
  const colorMap = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    red: 'bg-red-50 text-red-700 border-red-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    navy: 'bg-[#1e3a5f]/5 text-[#1e3a5f] border-[#1e3a5f]/20',
    slate: 'bg-muted/50 text-foreground border-border',
  }
  return (
    <div className={`rounded-xl border p-4 ${colorMap[color]}`}>
      {loading ? (
        <Skeleton className="h-8 w-24 mb-1" />
      ) : (
        <p className="text-2xl font-bold">{value}</p>
      )}
      <p className="text-xs font-semibold uppercase tracking-wide mt-1 opacity-70">{label}</p>
      {sub && <p className="text-xs mt-0.5 opacity-60">{sub}</p>}
    </div>
  )
}

export default function EmployeeHomePage() {
  const { user } = useAuth()
  const { data: session } = useSession()
  const router = useRouter()
  const now = new Date()
  const month = now.getMonth() + 1
  const year = now.getFullYear()

  // A "sales rep" is just an employee with a CRM profile attached. We branch
  // the dashboard on this single signal: sales reps see commission performance
  // before their attendance/payroll widgets; everyone else sees the standard
  // employee view.
  const isSalesRep = !!session?.user?.crmProfileId
  const crmRole = session?.user?.crmRole

  const commissionQuery = useQuery<{ summary: CommissionSummary | null }>({
    queryKey: ['my-commissions'],
    queryFn: async () => {
      const r = await fetch('/api/crm/commission-summary', { credentials: 'include' })
      if (!r.ok) return { summary: null }
      return r.json()
    },
    enabled: isSalesRep,
  })
  const commission = commissionQuery.data?.summary ?? null

  const todayQuery = useQuery<TodayStatus>({
    queryKey: ['attendance', 'today-my'],
    queryFn: async () => {
      const res = await api.get('/attendance/today-my/')
      return res.data
    },
    refetchInterval: 60_000,
  })

  const summaryQuery = useQuery<{ data: AttendanceSummary }>({
    queryKey: ['my-attendance-summary', month, year],
    queryFn: () => api.get('/attendance/my-summary/', { params: { month, year } }),
  })

  const salaryQuery = useQuery<{ data: { results: SalarySlip[] } }>({
    queryKey: ['my-salary-slips'],
    queryFn: () => api.get('/payroll/my-salary-slips/'),
    retry: 1,
  })

  const incidentsQuery = useQuery<{ data: { results: MyIncident[] } }>({
    queryKey: ['my-incidents'],
    queryFn: () => api.get('/incidents/my-incidents/'),
    retry: 1,
  })

  const bonusesQuery = useQuery<{ data: { results: MyBonus[] } }>({
    queryKey: ['my-bonuses'],
    queryFn: () => api.get('/bonuses/my-bonuses/'),
    retry: 1,
  })

  const today = todayQuery.data
  const summary = summaryQuery.data?.data
  const slips = salaryQuery.data?.data?.results ?? []
  const latestSlip = slips[0]
  const incidents = incidentsQuery.data?.data?.results ?? []
  const bonuses = bonusesQuery.data?.data?.results ?? []

  const pendingIncidents = incidents.filter((i) => i.status === 'pending').length
  const totalDeductions = incidents
    .filter((i) => i.status === 'applied')
    .reduce((sum, i) => sum + parseFloat(i.deduction_amount), 0)
  const pendingBonuses = bonuses.filter((b) => b.status === 'pending').length
  const totalBonuses = bonuses
    .filter((b) => b.status === 'applied')
    .reduce((sum, b) => sum + parseFloat(b.bonus_amount), 0)

  // Today attendance status
  const statusConfig: Record<string, { label: string; color: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'default' }> = {
    on_time: { label: 'On Time', color: 'text-emerald-600', variant: 'success' },
    late: { label: 'Late', color: 'text-amber-600', variant: 'warning' },
    absent: { label: 'Absent', color: 'text-red-600', variant: 'danger' },
    leave: { label: 'On Leave', color: 'text-blue-600', variant: 'info' },
    weekend: { label: 'Weekend', color: 'text-muted-foreground', variant: 'default' },
    holiday: { label: 'Holiday', color: 'text-purple-600', variant: 'default' },
  }
  const todayStatus = today?.status ? (statusConfig[today.status] ?? { label: today.status, color: 'text-muted-foreground', variant: 'default' as const }) : null

  return (
    <div className="space-y-6">
      {/* Unified welcome banner — matches the look on /, /hr/dashboard,
          /crm/my, /partners/dashboard, /admin so the user always lands on
          the same calm greeting no matter which module they enter. */}
      <WelcomeBanner
        firstName={firstNameOf(user?.full_name, user?.email)}
        rolePill={isSalesRep ? `Sales rep${crmRole ? ` · ${crmRole}` : ''}` : 'Employee'}
        pillTone={isSalesRep ? 'sky' : 'rose'}
        email={user?.email ?? undefined}
        subtitle={formatDate(now.toISOString())}
      />

      {/* ── Today's Status Banner ── */}
      <Card className="border-0 bg-gradient-to-r from-[#1e3a5f] to-[#2d5a8e] text-white">
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <p className="text-white/70 text-xs font-semibold uppercase tracking-widest mb-1">Today's Attendance</p>
              {todayQuery.isLoading ? (
                <Skeleton className="h-8 w-40 bg-card/20" />
              ) : today ? (
                <div className="flex items-center gap-3">
                  <p className="text-2xl font-bold">
                    {today.has_checked_in
                      ? today.has_checked_out
                        ? `Done · ${today.hours_worked?.toFixed(1)}h worked`
                        : `Checked in at ${today.check_in_time}`
                      : 'Not checked in yet'}
                  </p>
                  {todayStatus && (
                    <Badge variant={todayStatus.variant} className="text-xs border border-white/30 bg-card/15 text-white">
                      {todayStatus.label}
                    </Badge>
                  )}
                </div>
              ) : (
                <p className="text-xl font-bold text-white/80">No data for today</p>
              )}
              {today && (
                <p className="text-white/60 text-sm mt-1">
                  Shift: {today.shift_start} – {today.shift_end}
                </p>
              )}
            </div>
            <Button
              variant="outline"
              className="border-white/30 text-white bg-card/10 hover:bg-card/20 shrink-0"
              onClick={() => router.push('/employee/attendance')}
            >
              <Clock className="h-4 w-4 mr-1.5" />
              Check In / Out
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Sales Performance (sales reps only) ──
          Branches the employee experience on whether the user has a CRM
          profile. A sales rep is, by definition, an employee with a
          CrmUserProfile — they see commission performance up here next to
          their attendance, ahead of payroll/bonuses below. */}
      {isSalesRep && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-emerald-600" />
              Sales Performance
              {crmRole && (
                <Badge variant="info" className="text-[10px] uppercase tracking-widest ml-1">
                  {crmRole}
                </Badge>
              )}
            </h2>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => router.push('/crm/my')}>
                <Target className="h-3.5 w-3.5 me-1" /> Pipeline
              </Button>
              <Button size="sm" onClick={() => router.push('/crm/opportunities/new')}>
                + New deal
              </Button>
            </div>
          </div>

          {commissionQuery.isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
            </div>
          ) : commission ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
                <StatBox
                  label="Commissions · This Month"
                  value={formatCurrency(commission.thisMonth.commissionEGP, 'EGP')}
                  sub={`${commission.thisMonth.count} won · ${formatCurrency(commission.thisMonth.wonValueEGP, 'EGP')} in deals`}
                  color="emerald"
                />
                <StatBox
                  label="Commissions · This Year"
                  value={formatCurrency(commission.thisYear.commissionEGP, 'EGP')}
                  sub={`${commission.thisYear.count} closed-won`}
                  color="blue"
                />
                <StatBox
                  label="Commissions · Lifetime"
                  value={formatCurrency(commission.lifetime.commissionEGP, 'EGP')}
                  sub={`Rate: ${(commission.commissionRate * 100).toFixed(0)}% of deal value`}
                  color="navy"
                />
              </div>

              {commission.recentWins.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold flex items-center justify-between">
                      <span>Recent wins</span>
                      <Button size="sm" variant="link" onClick={() => router.push('/crm/opportunities?stage=WON')}>
                        See all <ChevronRight className="h-3 w-3 ml-0.5" />
                      </Button>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="divide-y divide-border">
                      {commission.recentWins.slice(0, 5).map((w) => (
                        <div key={w.id} className="py-2 flex items-center justify-between gap-2 text-sm">
                          <div className="min-w-0 flex-1">
                            <p className="font-medium truncate">{w.title}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              {w.company} · <span className="font-mono">{w.code}</span>
                              {w.dateClosed ? ` · ${formatDate(w.dateClosed)}` : ''}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="font-semibold text-emerald-600">
                              {formatCurrency(w.commissionEGP, 'EGP')}
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              of {formatCurrency(w.valueEGP, 'EGP')}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <Card>
              <CardContent className="py-6 text-center text-muted-foreground text-sm">
                No closed-won deals yet. Win your first deal to start earning commissions.
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ── This Month's Stats ── */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">This Month — {MONTH_NAMES[month - 1]} {year}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <StatBox
            label="Attendance Rate"
            value={summary ? `${summary.attendance_rate.toFixed(0)}%` : '—'}
            color={summary && summary.attendance_rate >= 90 ? 'emerald' : 'amber'}
            loading={summaryQuery.isLoading}
          />
          <StatBox
            label="Days Present"
            value={summary?.days_present ?? '—'}
            color="emerald"
            loading={summaryQuery.isLoading}
          />
          <StatBox
            label="Late Count"
            value={summary?.late_count ?? '—'}
            color={summary && summary.late_count > 3 ? 'red' : 'amber'}
            loading={summaryQuery.isLoading}
          />
          <StatBox
            label="Absent Days"
            value={summary?.absent_days ?? '—'}
            color={summary && summary.absent_days > 0 ? 'red' : 'slate'}
            loading={summaryQuery.isLoading}
          />
          <StatBox
            label="Hours Worked"
            value={summary ? `${summary.total_hours.toFixed(0)}h` : '—'}
            color="blue"
            loading={summaryQuery.isLoading}
          />
        </div>
      </div>

      {/* ── Salary + Incidents/Bonuses ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Latest Salary Slip */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-brand-navy" />
                Latest Salary Slip
              </span>
              <Button variant="ghost" size="sm" className="text-xs" onClick={() => router.push('/employee/salary')}>
                All Slips <ChevronRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {salaryQuery.isLoading ? (
              <Skeleton className="h-32 w-full rounded-lg" />
            ) : latestSlip ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {MONTH_NAMES[latestSlip.month - 1]} {latestSlip.year}
                    </p>
                    <p className="text-3xl font-bold text-brand-navy">{formatCurrency(latestSlip.net_salary)}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Net salary</p>
                  </div>
                  <Badge
                    variant={latestSlip.status === 'paid' || latestSlip.status === 'finalized' ? 'success' : latestSlip.status === 'locked' ? 'info' : 'default'}
                    className="text-xs capitalize"
                  >
                    {latestSlip.status}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-border/60">
                  {[
                    { label: 'Base', value: latestSlip.base_salary, color: 'text-foreground' },
                    { label: 'Overtime', value: latestSlip.overtime_amount, color: 'text-blue-600' },
                    { label: 'Bonuses', value: latestSlip.total_bonuses, color: 'text-emerald-600' },
                    { label: 'Deductions', value: latestSlip.total_deductions, color: 'text-red-600' },
                  ].map((item) => (
                    <div key={item.label}>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{item.label}</p>
                      <p className={`text-sm font-semibold ${item.color}`}>{formatCurrency(item.value)}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                <DollarSign className="h-8 w-8 mb-2 opacity-40" />
                <p className="text-sm">No salary slips yet</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Incidents & Bonuses Summary */}
        <div className="space-y-4">
          {/* Bonuses card */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Gift className="h-4 w-4 text-emerald-500" />
                  Bonuses
                </span>
                <Button variant="ghost" size="sm" className="text-xs h-6 px-2" onClick={() => router.push('/employee/incidents')}>
                  View
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {bonusesQuery.isLoading ? <Skeleton className="h-16 w-full rounded" /> : (
                <>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-muted-foreground">Total applied</span>
                    <span className="text-sm font-bold text-emerald-600">+{formatCurrency(totalBonuses)}</span>
                  </div>
                  {pendingBonuses > 0 && (
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-muted-foreground">Pending review</span>
                      <Badge variant="warning" className="text-[10px]">{pendingBonuses}</Badge>
                    </div>
                  )}
                  {bonuses.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-2">No bonuses recorded</p>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Incidents card */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-500" />
                  Incidents
                </span>
                <Button variant="ghost" size="sm" className="text-xs h-6 px-2" onClick={() => router.push('/employee/incidents')}>
                  View
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {incidentsQuery.isLoading ? <Skeleton className="h-16 w-full rounded" /> : (
                <>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-muted-foreground">Total deductions</span>
                    <span className="text-sm font-bold text-red-600">-{formatCurrency(totalDeductions)}</span>
                  </div>
                  {pendingIncidents > 0 && (
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-muted-foreground">Pending review</span>
                      <Badge variant="warning" className="text-[10px]">{pendingIncidents}</Badge>
                    </div>
                  )}
                  {incidents.length === 0 && (
                    <div className="flex items-center gap-2 text-xs text-emerald-600 py-2 justify-center">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Clean record
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Quick Links ── */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Quick Access</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: 'Attendance', icon: Clock, href: '/employee/attendance', color: 'text-blue-600 bg-blue-50' },
            { label: 'Overtime', icon: TrendingUp, href: '/employee/overtime', color: 'text-amber-600 bg-amber-50' },
            { label: 'Salary Slips', icon: DollarSign, href: '/employee/salary', color: 'text-emerald-600 bg-emerald-50' },
            { label: 'Incidents', icon: AlertTriangle, href: '/employee/incidents', color: 'text-red-600 bg-red-50' },
            { label: 'Calendar', icon: CalendarDays, href: '/employee/attendance', color: 'text-purple-600 bg-purple-50' },
            { label: 'Documents', icon: UserX, href: '/employee/documents', color: 'text-muted-foreground bg-muted/50' },
          ].map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.href + item.label}
                onClick={() => router.push(item.href)}
                className="flex flex-col items-center gap-2 p-4 bg-card border border-border rounded-xl hover:border-blue-300 hover:shadow-sm transition-all"
              >
                <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${item.color}`}>
                  <Icon className="h-4.5 w-4.5" />
                </div>
                <span className="text-xs font-medium text-foreground">{item.label}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
