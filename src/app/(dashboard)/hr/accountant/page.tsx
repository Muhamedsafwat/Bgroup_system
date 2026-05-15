'use client'

import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  DollarSign,
  Building2,
  TrendingUp,
  Users,
  FileText,
  CheckCircle2,
  Lock,
  Banknote,
  Calculator,
} from 'lucide-react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import api, { payrollApi } from '@/lib/hr/api'
import { toast } from '@/components/hr/ui/toast'
import { useAuth } from '@/contexts/hr/AuthContext'
import { WelcomeBanner, firstNameOf } from '@/components/shared/WelcomeHero'
import { ExportButton } from '@/components/hr/shared/ExportButton'
import { StatCard } from '@/components/hr/shared/StatCard'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/hr/ui/card'
import { Badge } from '@/components/hr/ui/badge'
import { Button } from '@/components/hr/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/hr/ui/select'
import { Skeleton } from '@/components/hr/ui/skeleton'
import { formatCurrency, formatMonthYear } from '@/lib/hr/utils'
import type { PayrollSummary } from '@/lib/hr/types'

const MONTHS = [
  { value: '1', label: 'January' },
  { value: '2', label: 'February' },
  { value: '3', label: 'March' },
  { value: '4', label: 'April' },
  { value: '5', label: 'May' },
  { value: '6', label: 'June' },
  { value: '7', label: 'July' },
  { value: '8', label: 'August' },
  { value: '9', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
]

const statusConfig: Record<string, { label: string; variant: 'default' | 'info' | 'warning' | 'success'; icon: React.ReactNode }> = {
  draft: { label: 'Draft', variant: 'default', icon: <FileText className="h-3.5 w-3.5" /> },
  calculated: { label: 'Calculated', variant: 'info', icon: <TrendingUp className="h-3.5 w-3.5" /> },
  locked: { label: 'Locked', variant: 'warning', icon: <Lock className="h-3.5 w-3.5" /> },
  finalized: { label: 'Finalized', variant: 'warning', icon: <Lock className="h-3.5 w-3.5" /> },
  paid: { label: 'Paid', variant: 'success', icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
}

export default function AccountantPage() {
  const { companies, user } = useAuth()
  const queryClient = useQueryClient()
  const now = new Date()
  const [month, setMonth] = useState(String(now.getMonth() + 1))
  const [year, setYear] = useState(String(now.getFullYear()))

  const currentYear = now.getFullYear()
  const years = Array.from({ length: 5 }, (_, i) => currentYear - i)

  const summaryQuery = useQuery({
    queryKey: ['payroll-summary', month, year],
    queryFn: async () => {
      const res = await payrollApi.summary({ month: Number(month), year: Number(year) })
      return res.data as PayrollSummary[]
    },
  })

  const summaries = summaryQuery.data || []

  // Commission liability for the selected period: total commissions accrued
  // by every sales rep, so the accountant can size the payable line before
  // locking payroll. Sales reps are employees with a CrmUserProfile — their
  // commission is computed off CrmOpportunity.WON in this window.
  type CommissionsPayable = {
    period: { month: number; year: number }
    commissionRate: number
    totals: { reps: number; dealCount: number; wonValueEGP: number; commissionEGP: number }
    perRep: Array<{
      repId: string
      repName: string
      repEmail: string | null
      userId: string | null
      dealCount: number
      wonValueEGP: number
      commissionEGP: number
    }>
  }
  const commissionsQuery = useQuery<CommissionsPayable>({
    queryKey: ['commissions-payable', month, year],
    queryFn: async () => {
      const r = await fetch(`/api/crm/commissions-payable?month=${month}&year=${year}`, {
        credentials: 'include',
      })
      if (!r.ok) {
        return { period: { month: Number(month), year: Number(year) }, commissionRate: 0.05, totals: { reps: 0, dealCount: 0, wonValueEGP: 0, commissionEGP: 0 }, perRep: [] }
      }
      return r.json()
    },
  })
  const commissions = commissionsQuery.data

  const markPaidMutation = useMutation({
    mutationFn: (companyId: number) =>
      api.post('/payroll/monthly/mark-paid/', { company: companyId, month: Number(month), year: Number(year) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll-summary', month, year] })
      toast.success('Payroll marked as paid')
    },
    onError: () => toast.error('Failed to mark as paid'),
  })

  const calculateMutation = useMutation({
    mutationFn: (companyId: number) =>
      api.post('/payroll/calculate/', { company_id: companyId, month: Number(month), year: Number(year) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll-summary', month, year] })
      toast.success('Payroll calculated')
    },
    onError: () => toast.error('Failed to calculate payroll'),
  })

  // Group totals
  const groupTotals = summaries.reduce(
    (acc, s) => ({
      total_employees: acc.total_employees + s.total_employees,
      total_base_salary: acc.total_base_salary + s.total_base_salary,
      total_overtime: acc.total_overtime + s.total_overtime,
      total_bonuses: acc.total_bonuses + s.total_bonuses,
      total_deductions: acc.total_deductions + s.total_deductions,
      total_net_salary: acc.total_net_salary + s.total_net_salary,
    }),
    {
      total_employees: 0,
      total_base_salary: 0,
      total_overtime: 0,
      total_bonuses: 0,
      total_deductions: 0,
      total_net_salary: 0,
    }
  )

  const chartData = summaries.map((s) => ({
    name: s.company_name || `Company ${s.company}`,
    'Net Salary': s.total_net_salary,
    'Base': s.total_base_salary,
    'Overtime': s.total_overtime,
    'Bonuses': s.total_bonuses,
    'Deductions': s.total_deductions,
  }))

  async function handleExportExcel(companyId?: number) {
    const params: Record<string, unknown> = { month: Number(month), year: Number(year) }
    if (companyId) params.company = companyId
    const res = await payrollApi.exportExcel(params)
    return res.data as Blob
  }

  async function handleExportPdf(companyId?: number) {
    const params: Record<string, unknown> = { month: Number(month), year: Number(year) }
    if (companyId) params.company = companyId
    const res = await payrollApi.exportPdf(params)
    return res.data as Blob
  }

  const periodLabel = formatMonthYear(Number(month), Number(year))

  return (
    <div className="space-y-6">
      <WelcomeBanner
        firstName={firstNameOf(user?.full_name, user?.email)}
        rolePill="Accountant"
        pillTone="emerald"
        email={user?.email}
        subtitle={`Payroll overview for ${periodLabel}`}
      />
      <div className="flex justify-end">
        <ExportButton
          onExportExcel={() => handleExportExcel()}
          onExportPdf={() => handleExportPdf()}
          filename={`payroll-${year}-${month.padStart(2, '0')}`}
          label="Export All"
        />
      </div>

      {/* Period Selector */}
      <div className="flex items-center gap-3 bg-card p-4 rounded-lg border border-border">
        <span className="text-sm font-medium text-muted-foreground">Period:</span>
        <Select value={month} onValueChange={setMonth}>
          <SelectTrigger className="h-9 w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MONTHS.map((m) => (
              <SelectItem key={m.value} value={m.value}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={year} onValueChange={setYear}>
          <SelectTrigger className="h-9 w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {years.map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Group Totals */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard
          label="Total Employees"
          value={groupTotals.total_employees}
          icon={<Users className="h-5 w-5" />}
          color="navy"
          loading={summaryQuery.isLoading}
          className="col-span-1"
          href="/hr/employees"
        />
        <StatCard
          label="Base Salary"
          value={formatCurrency(groupTotals.total_base_salary)}
          icon={<DollarSign className="h-5 w-5" />}
          color="blue"
          loading={summaryQuery.isLoading}
          compact
          href="/hr/payroll/monthly"
        />
        <StatCard
          label="Overtime"
          value={formatCurrency(groupTotals.total_overtime)}
          icon={<TrendingUp className="h-5 w-5" />}
          color="amber"
          loading={summaryQuery.isLoading}
          compact
          href="/hr/overtime/report"
        />
        <StatCard
          label="Bonuses"
          value={formatCurrency(groupTotals.total_bonuses)}
          icon={<DollarSign className="h-5 w-5" />}
          color="emerald"
          loading={summaryQuery.isLoading}
          compact
          href="/hr/bonuses/all"
        />
        <StatCard
          label="Deductions"
          value={formatCurrency(groupTotals.total_deductions)}
          icon={<DollarSign className="h-5 w-5" />}
          color="red"
          loading={summaryQuery.isLoading}
          compact
          href="/hr/incidents/all"
        />
        <StatCard
          label="Net Payroll"
          value={formatCurrency(groupTotals.total_net_salary)}
          icon={<DollarSign className="h-5 w-5" />}
          color="navy"
          loading={summaryQuery.isLoading}
          compact
          href="/hr/payroll/monthly"
        />
      </div>

      {/* Commissions Payable — sales reps' commission liability for this
          window. Not yet rolled into the payroll calculation; here so the
          accountant can size it before finalising. */}
      {commissions && commissions.totals.reps > 0 && (
        <Card className="border-emerald-200 bg-emerald-50/40">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2">
                <Calculator className="h-4 w-4 text-emerald-600" />
                Sales commissions payable — {periodLabel}
              </span>
              <Badge variant="info" className="text-[10px] tracking-widest uppercase">
                {(commissions.commissionRate * 100).toFixed(0)}% of deal value
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Reps</p>
                <p className="text-xl font-bold text-foreground">{commissions.totals.reps}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Deals won</p>
                <p className="text-xl font-bold text-foreground">{commissions.totals.dealCount}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Deal value</p>
                <p className="text-xl font-bold text-foreground">{formatCurrency(commissions.totals.wonValueEGP)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-emerald-700">Commission liability</p>
                <p className="text-xl font-bold text-emerald-700">{formatCurrency(commissions.totals.commissionEGP)}</p>
              </div>
            </div>
            {commissions.perRep.length > 0 && (
              <div className="overflow-x-auto -mx-6 px-6">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-emerald-200">
                      {['Sales rep', 'Deals', 'Deal value', 'Commission'].map((h) => (
                        <th key={h} className="px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-emerald-100">
                    {commissions.perRep.map((r) => (
                      <tr key={r.repId}>
                        <td className="px-2 py-2 font-medium">{r.repName} <span className="text-xs text-muted-foreground">· {r.repEmail ?? '—'}</span></td>
                        <td className="px-2 py-2">{r.dealCount}</td>
                        <td className="px-2 py-2">{formatCurrency(r.wonValueEGP)}</td>
                        <td className="px-2 py-2 font-semibold text-emerald-700">{formatCurrency(r.commissionEGP)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Chart */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Payroll by Company — {periodLabel}</CardTitle>
        </CardHeader>
        <CardContent>
          {summaryQuery.isLoading ? (
            <Skeleton className="h-64 w-full rounded" />
          ) : chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} />
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
                <Bar dataKey="Base" fill="#1e3a5f" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Overtime" fill="#f59e0b" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Bonuses" fill="#10b981" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Deductions" fill="#ef4444" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">
              No payroll data for {periodLabel}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Company Cards */}
      <div className="space-y-3">
        <h2 className="text-base font-semibold text-foreground">Company Breakdown</h2>

        {summaryQuery.isLoading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-40 rounded-lg" />
            ))}
          </div>
        ) : summaries.length > 0 ? (
          summaries.map((summary) => {
            const status = statusConfig[summary.status] || statusConfig.draft
            return (
              <Card key={summary.company || summary.id} className="overflow-hidden">
                {/* Card header stripe */}
                <div className="bg-brand-navy px-5 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Building2 className="h-5 w-5 text-white/70" />
                    <div>
                      <p className="text-white font-semibold text-sm">
                        {summary.company_name || `Company ${summary.company}`}
                      </p>
                      <p className="text-muted-foreground text-xs">{periodLabel}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge
                      variant={status.variant}
                      className="flex items-center gap-1 text-[10px]"
                    >
                      {status.icon}
                      {status.label}
                    </Badge>
                    {summary.needs_calculation && (
                      <Button
                        size="sm"
                        className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white h-7 text-xs"
                        onClick={() => calculateMutation.mutate(summary.company!)}
                        loading={calculateMutation.isPending}
                      >
                        <Calculator className="h-3.5 w-3.5" />
                        Calculate
                      </Button>
                    )}
                    {summary.period_status === 'finalized' && (
                      <Button
                        size="sm"
                        className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white h-7 text-xs"
                        onClick={() => markPaidMutation.mutate(summary.company!)}
                        loading={markPaidMutation.isPending}
                      >
                        <Banknote className="h-3.5 w-3.5" />
                        Mark as Paid
                      </Button>
                    )}
                    <ExportButton
                      onExportExcel={() => handleExportExcel(summary.company)}
                      onExportPdf={() => handleExportPdf(summary.company)}
                      filename={`payroll-${summary.company_name?.toLowerCase().replace(/\s+/g, '-')}-${year}-${month.padStart(2, '0')}`}
                      label="Export"
                      size="sm"
                      variant="ghost"
                    />
                  </div>
                </div>

                {/* Metrics grid */}
                <div className="p-5">
                  {summary.needs_calculation && (
                    <div className="mb-4 flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                      <Calculator className="h-4 w-4 shrink-0" />
                      Payroll not yet calculated for this period. Click <strong>Calculate</strong> to generate salary records.
                    </div>
                  )}
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Employees</p>
                      <p className="font-bold text-foreground">{summary.total_employees}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Base Salary</p>
                      <p className="font-bold text-foreground text-sm">
                        {formatCurrency(summary.total_base_salary)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Overtime</p>
                      <p className="font-bold text-amber-600 text-sm">
                        {formatCurrency(summary.total_overtime)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Bonuses</p>
                      <p className="font-bold text-emerald-600 text-sm">
                        {formatCurrency(summary.total_bonuses)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Deductions</p>
                      <p className="font-bold text-red-600 text-sm">
                        -{formatCurrency(summary.total_deductions)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Net Salary</p>
                      <p className="font-bold text-brand-navy text-base">
                        {formatCurrency(summary.total_net_salary)}
                      </p>
                    </div>
                  </div>
                </div>
              </Card>
            )
          })
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <DollarSign className="h-10 w-10 text-muted-foreground/60 mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">No payroll data for {periodLabel}</p>
              <p className="text-muted-foreground text-xs mt-1">
                Run payroll calculation first
              </p>
            </CardContent>
          </Card>
        )}

        {/* Group Total Row */}
        {summaries.length > 1 && (
          <div className="mt-4 p-4 bg-brand-navy rounded-lg">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              <div>
                <p className="text-muted-foreground text-xs mb-0.5">Group Total</p>
                <p className="text-white font-bold">{groupTotals.total_employees} emp.</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs mb-0.5">Base</p>
                <p className="text-white font-bold text-sm">
                  {formatCurrency(groupTotals.total_base_salary)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs mb-0.5">Overtime</p>
                <p className="text-brand-amber font-bold text-sm">
                  {formatCurrency(groupTotals.total_overtime)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs mb-0.5">Bonuses</p>
                <p className="text-emerald-400 font-bold text-sm">
                  {formatCurrency(groupTotals.total_bonuses)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs mb-0.5">Deductions</p>
                <p className="text-red-400 font-bold text-sm">
                  -{formatCurrency(groupTotals.total_deductions)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs mb-0.5">Net Total</p>
                <p className="text-brand-amber font-bold text-lg">
                  {formatCurrency(groupTotals.total_net_salary)}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
