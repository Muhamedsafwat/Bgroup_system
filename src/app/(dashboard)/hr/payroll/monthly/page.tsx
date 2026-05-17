'use client'

import { describeError } from "@/lib/zod-errors";

import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Lock,
  Send,
  Loader2,
  CheckCircle,
} from 'lucide-react'
import { PageHeader } from '@/components/hr/shared/PageHeader'
import { ConfirmDialog } from '@/components/hr/shared/ConfirmDialog'
import { Button } from '@/components/hr/ui/button'
import { Badge } from '@/components/hr/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/hr/ui/select'
import { toast } from '@/components/hr/ui/toast'
import api, { companiesApi } from '@/lib/hr/api'
import { formatCurrency, formatMonthYear } from '@/lib/hr/utils'
import type { Company } from '@/lib/hr/types'

const MONTHS = [
  { value: 1, label: 'January' }, { value: 2, label: 'February' },
  { value: 3, label: 'March' }, { value: 4, label: 'April' },
  { value: 5, label: 'May' }, { value: 6, label: 'June' },
  { value: 7, label: 'July' }, { value: 8, label: 'August' },
  { value: 9, label: 'September' }, { value: 10, label: 'October' },
  { value: 11, label: 'November' }, { value: 12, label: 'December' },
]

const CURRENT_YEAR = new Date().getFullYear()
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i)

interface DeductionEntry {
  date: string
  incident_name: string
  amount: number
  status: string
}

interface BonusEntry {
  date: string
  bonus_name: string
  amount: number
  status: string
}

interface PayrollRecord {
  id: number
  employee_id: string
  employee_name: string
  department_name: string
  base_salary: number
  work_days: number
  absent_days: number
  late_count: number
  ot_hours: number
  ot_amount: number
  total_deductions: number
  total_bonuses: number
  net_salary: number
  notes: string
  deductions: DeductionEntry[]
  bonuses: BonusEntry[]
}

interface PayrollResponse {
  records: PayrollRecord[]
  status: 'OPEN' | 'LOCKED' | 'FINALIZED' | 'PAID'
  month: number
  year: number
  company: number
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  OPEN: { label: 'OPEN', className: 'bg-emerald-100 text-emerald-700 border border-emerald-200' },
  LOCKED: { label: 'LOCKED', className: 'bg-amber-100 text-amber-700 border border-amber-200' },
  FINALIZED: { label: 'FINALIZED', className: 'bg-blue-100 text-blue-700 border border-blue-200' },
  PAID: { label: 'PAID', className: 'bg-green-100 text-green-700 border border-green-200' },
}

export default function MonthlyPayrollPage() {
  const queryClient = useQueryClient()

  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [companyId, setCompanyId] = useState<string>('')
  const [expandedDeductions, setExpandedDeductions] = useState<Set<number>>(new Set())
  const [expandedBonuses, setExpandedBonuses] = useState<Set<number>>(new Set())
  const [lockDialogOpen, setLockDialogOpen] = useState(false)
  const [markPaidDialogOpen, setMarkPaidDialogOpen] = useState(false)
  const [notesMap, setNotesMap] = useState<Record<number, string>>({})
  const [finalizeProgress, setFinalizeProgress] = useState(false)

  const { data: companiesData } = useQuery<{ data: { results: Company[] } }>({
    queryKey: ['companies'],
    queryFn: () => companiesApi.list(),
  })
  const companies = companiesData?.data?.results ?? []

  const { data: payrollData, isLoading } = useQuery<{ data: PayrollResponse }>({
    queryKey: ['payroll-monthly', month, year, companyId],
    queryFn: () =>
      api.get('/payroll/monthly/', {
        params: {
          month,
          year,
          company: companyId || undefined,
        },
      }),
    enabled: !!companyId,
  })

  const records = payrollData?.data?.records ?? []
  const periodStatus = payrollData?.data?.status ?? 'OPEN'

  const recalculateMutation = useMutation({
    mutationFn: () =>
      api.post('/payroll/monthly/recalculate/', { month, year, company: companyId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll-monthly'] })
      toast.success('Payroll recalculated successfully')
    },
    onError: () => {
      toast.error('Failed to recalculate payroll')
    },
  })

  const lockMutation = useMutation({
    mutationFn: () =>
      api.post('/payroll/monthly/lock/', { month, year, company: companyId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll-monthly'] })
      setLockDialogOpen(false)
      toast.success(`${formatMonthYear(month, year)} payroll locked`)
    },
    onError: () => {
      toast.error('Failed to lock payroll')
    },
  })

  const markPaidMutation = useMutation({
    mutationFn: () =>
      api.post('/payroll/monthly/mark-paid/', { month, year, company: companyId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll-monthly'] })
      setMarkPaidDialogOpen(false)
      toast.success('Payroll marked as paid')
    },
    onError: () => {
      toast.error('Failed to mark payroll as paid')
    },
  })

  const saveNotesMutation = useMutation({
    mutationFn: ({ id, notes }: { id: number; notes: string }) =>
      api.patch(`/payroll/salaries/${id}/`, { notes }),
    onSuccess: () => toast.success('Note saved'),
    onError: (__err: unknown) => toast.error(describeError(__err) || 'Failed to save note'),
  })

  const finalizeMutation = useMutation({
    mutationFn: () =>
      api.post('/payroll/monthly/finalize/', { month, year, company: companyId }),
    onMutate: () => setFinalizeProgress(true),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll-monthly'] })
      setFinalizeProgress(false)
      toast.success('Payroll finalized — salary slips sent')
    },
    onError: () => {
      setFinalizeProgress(false)
      toast.error('Failed to finalize payroll')
    },
  })

  function toggleDeductions(id: number) {
    setExpandedDeductions((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleBonuses(id: number) {
    setExpandedBonuses((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const totals = records.reduce(
    (acc, r) => ({
      base: acc.base + r.base_salary,
      ot: acc.ot + r.ot_amount,
      deductions: acc.deductions + r.total_deductions,
      bonuses: acc.bonuses + r.total_bonuses,
      net: acc.net + r.net_salary,
    }),
    { base: 0, ot: 0, deductions: 0, bonuses: 0, net: 0 }
  )

  const statusCfg = STATUS_CONFIG[periodStatus]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Monthly Payroll"
        description="Calculate, review and finalize monthly salaries"
        breadcrumbs={[{ label: 'Payroll', href: '/payroll' }, { label: 'Monthly' }]}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 border-blue-300 text-blue-700 hover:bg-blue-50"
              onClick={() => recalculateMutation.mutate()}
              disabled={recalculateMutation.isPending || !companyId}
            >
              {recalculateMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Recalculate
            </Button>

            {periodStatus === 'OPEN' && (
              <Button
                size="sm"
                className="gap-1.5 bg-amber-500 hover:bg-amber-600 text-white"
                onClick={() => setLockDialogOpen(true)}
                disabled={!companyId}
              >
                <Lock className="h-4 w-4" />
                Lock Month
              </Button>
            )}

            {periodStatus === 'LOCKED' && (
              <Button
                size="sm"
                className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={() => finalizeMutation.mutate()}
                disabled={finalizeMutation.isPending || finalizeProgress || !companyId}
              >
                {finalizeProgress ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {finalizeProgress ? 'Sending...' : 'Finalize & Send Slips'}
              </Button>
            )}

            {periodStatus === 'FINALIZED' && (
              <Button
                size="sm"
                className="gap-1.5 bg-green-700 hover:bg-green-800 text-white"
                onClick={() => setMarkPaidDialogOpen(true)}
                disabled={!companyId}
              >
                <CheckCircle className="h-4 w-4" />
                Mark as Paid
              </Button>
            )}
          </div>
        }
      />

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 bg-card rounded-lg border border-border p-4">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">Month:</label>
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
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-muted-foreground">Year:</label>
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
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-muted-foreground">Company:</label>
          <Select value={companyId} onValueChange={setCompanyId}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Select company..." />
            </SelectTrigger>
            <SelectContent>
              {companies.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.name_en}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {companyId && (
          <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${statusCfg.className}`}>
            {statusCfg.label}
          </span>
        )}
      </div>

      {!companyId && (
        <div className="rounded-lg border border-border bg-card p-12 text-center text-muted-foreground">
          Select a company to view payroll records.
        </div>
      )}

      {companyId && !isLoading && (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap">ID</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap">Name</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap">Dept</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap">Base</th>
                  <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap">Work Days</th>
                  <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap">Absent</th>
                  <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap">Late</th>
                  <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap">OT Hrs</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap">OT Amt</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap">Deductions</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap">Bonuses</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap">Net Salary</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {records.map((record) => {
                  const deductionsExpanded = expandedDeductions.has(record.id)
                  const bonusesExpanded = expandedBonuses.has(record.id)
                  const isNetGood = record.net_salary >= record.base_salary
                  const currentNote = notesMap[record.id] ?? record.notes

                  return (
                    <React.Fragment key={record.id}>
                      <tr className="hover:bg-muted/50 transition-colors">
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{record.employee_id}</td>
                        <td className="px-3 py-2 font-medium text-foreground whitespace-nowrap">{record.employee_name}</td>
                        <td className="px-3 py-2 text-muted-foreground">{record.department_name}</td>
                        <td className="px-3 py-2 text-right text-foreground">{formatCurrency(record.base_salary)}</td>
                        <td className="px-3 py-2 text-center text-foreground">{record.work_days}</td>
                        <td className="px-3 py-2 text-center text-foreground">{record.absent_days}</td>
                        <td className="px-3 py-2 text-center text-foreground">{record.late_count}</td>
                        <td className="px-3 py-2 text-center text-foreground">{record.ot_hours.toFixed(1)}</td>
                        <td className="px-3 py-2 text-right text-foreground">{formatCurrency(record.ot_amount)}</td>
                        <td className="px-3 py-2 text-right">
                          <button
                            className="flex items-center gap-1 ml-auto text-red-600 hover:text-red-800"
                            onClick={() => toggleDeductions(record.id)}
                          >
                            {formatCurrency(record.total_deductions)}
                            {record.deductions.length > 0 && (
                              deductionsExpanded
                                ? <ChevronDown className="h-3 w-3" />
                                : <ChevronRight className="h-3 w-3" />
                            )}
                          </button>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            className="flex items-center gap-1 ml-auto text-emerald-600 hover:text-emerald-800"
                            onClick={() => toggleBonuses(record.id)}
                          >
                            {formatCurrency(record.total_bonuses)}
                            {record.bonuses.length > 0 && (
                              bonusesExpanded
                                ? <ChevronDown className="h-3 w-3" />
                                : <ChevronRight className="h-3 w-3" />
                            )}
                          </button>
                        </td>
                        <td className={`px-3 py-2 text-right font-bold ${isNetGood ? 'text-emerald-700' : 'text-red-600'}`}>
                          {formatCurrency(record.net_salary)}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              className="w-28 text-xs border border-border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                              value={currentNote}
                              onChange={(e) => setNotesMap((m) => ({ ...m, [record.id]: e.target.value }))}
                              placeholder="Notes..."
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveNotesMutation.mutate({ id: record.id, notes: currentNote })
                              }}
                            />
                            {notesMap[record.id] !== undefined && notesMap[record.id] !== record.notes && (
                              <button
                                className="text-xs text-blue-600 hover:text-blue-800 font-medium shrink-0"
                                onClick={() => saveNotesMutation.mutate({ id: record.id, notes: currentNote })}
                              >
                                Save
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* Deductions sub-rows */}
                      {deductionsExpanded && record.deductions.length > 0 && (
                        <tr>
                          <td colSpan={13} className="bg-red-50 px-8 py-2">
                            <div className="text-xs font-semibold text-red-700 mb-1">Deductions</div>
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-red-600 font-medium">
                                  <th className="text-left pb-1 pr-4">Date</th>
                                  <th className="text-left pb-1 pr-4">Incident</th>
                                  <th className="text-right pb-1 pr-4">Amount</th>
                                  <th className="text-left pb-1">Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                {record.deductions.map((d, i) => (
                                  <tr key={i} className="border-t border-red-100">
                                    <td className="py-1 pr-4 text-muted-foreground">{d.date}</td>
                                    <td className="py-1 pr-4 text-foreground">{d.incident_name}</td>
                                    <td className="py-1 pr-4 text-right text-red-700 font-medium">{formatCurrency(d.amount)}</td>
                                    <td className="py-1">
                                      <span className="bg-muted text-muted-foreground px-1.5 py-0.5 rounded text-xs capitalize">{d.status}</span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}

                      {/* Bonuses sub-rows */}
                      {bonusesExpanded && record.bonuses.length > 0 && (
                        <tr>
                          <td colSpan={13} className="bg-emerald-50 px-8 py-2">
                            <div className="text-xs font-semibold text-emerald-700 mb-1">Bonuses</div>
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-emerald-600 font-medium">
                                  <th className="text-left pb-1 pr-4">Date</th>
                                  <th className="text-left pb-1 pr-4">Bonus</th>
                                  <th className="text-right pb-1 pr-4">Amount</th>
                                  <th className="text-left pb-1">Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                {record.bonuses.map((b, i) => (
                                  <tr key={i} className="border-t border-emerald-100">
                                    <td className="py-1 pr-4 text-muted-foreground">{b.date}</td>
                                    <td className="py-1 pr-4 text-foreground">{b.bonus_name}</td>
                                    <td className="py-1 pr-4 text-right text-emerald-700 font-medium">{formatCurrency(b.amount)}</td>
                                    <td className="py-1">
                                      <span className="bg-muted text-muted-foreground px-1.5 py-0.5 rounded text-xs capitalize">{b.status}</span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>

              {/* Summary footer */}
              {records.length > 0 && (
                <tfoot className="bg-muted border-t-2 border-border">
                  <tr>
                    <td colSpan={3} className="px-3 py-3 text-sm font-bold text-foreground">
                      TOTALS ({records.length} employees)
                    </td>
                    <td className="px-3 py-3 text-right font-bold text-foreground">{formatCurrency(totals.base)}</td>
                    <td colSpan={4} />
                    <td className="px-3 py-3 text-right font-bold text-foreground">{formatCurrency(totals.ot)}</td>
                    <td className="px-3 py-3 text-right font-bold text-red-700">{formatCurrency(totals.deductions)}</td>
                    <td className="px-3 py-3 text-right font-bold text-emerald-700">{formatCurrency(totals.bonuses)}</td>
                    <td className="px-3 py-3 text-right font-bold text-foreground">{formatCurrency(totals.net)}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {records.length === 0 && !isLoading && (
            <div className="p-12 text-center text-muted-foreground">
              <p className="font-medium text-foreground mb-1">No payroll records yet for this period.</p>
              <p className="text-sm">Click <span className="font-semibold text-blue-600">Recalculate</span> above to generate payroll records from employee data.</p>
            </div>
          )}
        </div>
      )}

      {isLoading && (
        <div className="rounded-lg border border-border bg-card p-12 flex items-center justify-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading payroll data...
        </div>
      )}

      <ConfirmDialog
        open={lockDialogOpen}
        onOpenChange={setLockDialogOpen}
        title="Lock Month"
        description={`Locking ${formatMonthYear(month, year)} payroll. No further changes will be possible. Continue?`}
        confirmLabel="Lock Month"
        variant="warning"
        onConfirm={() => lockMutation.mutateAsync()}
        loading={lockMutation.isPending}
      />

      <ConfirmDialog
        open={markPaidDialogOpen}
        onOpenChange={setMarkPaidDialogOpen}
        title="Mark Payroll as Paid"
        description={`Confirm that ${formatMonthYear(month, year)} salaries have been physically paid to all employees. This action cannot be undone.`}
        confirmLabel="Mark as Paid"
        variant="default"
        onConfirm={() => markPaidMutation.mutateAsync()}
        loading={markPaidMutation.isPending}
      />
    </div>
  )
}
