'use client'

import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileSpreadsheet, Download, Loader2 } from 'lucide-react'
import { useLocale } from '@/lib/i18n'
import { PageHeader } from '@/components/hr/shared/PageHeader'
import { Button } from '@/components/hr/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/hr/ui/select'
import { useToast } from '@/components/hr/ui/toast'
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

interface PreviewRow {
  employee_id: string
  name: string
  department: string
  position: string
  base_salary: number
  work_days: number
  absent_days: number
  late_count: number
  ot_hours: number
  ot_amount: number
  total_deductions: number
  deduction_details: string
  total_bonuses: number
  bonus_details: string
  net_salary: number
  bank_name: string
  account_iban: string
  notes: string
}

export default function ExcelExportPage() {
  const { locale } = useLocale()
  const isAr = locale === 'ar'
  const { toast } = useToast()
  const now = new Date()

  const [companyId, setCompanyId] = useState<string>('all')
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [downloading, setDownloading] = useState(false)
  const [downloadingLabel, setDownloadingLabel] = useState('')

  const { data: companiesData } = useQuery<{ data: { results: Company[] } }>({
    queryKey: ['companies'],
    queryFn: () => companiesApi.list(),
  })
  const companies = companiesData?.data?.results ?? []

  const { data: previewData, isLoading: previewLoading } = useQuery<{ data: { results: PreviewRow[] } }>({
    queryKey: ['payroll-preview', companyId, month, year],
    queryFn: () =>
      api.get('/reports/payroll-preview/', {
        params: {
          company: companyId === 'all' ? undefined : companyId,
          month,
          year,
        },
      }),
  })
  const previewRows = previewData?.data?.results ?? []

  async function handleDownload() {
    const selectedCompany = companies.find((c) => String(c.id) === companyId)
    const companyLabel = companyId === 'all' ? 'AllCompanies' : (selectedCompany?.name_en ?? companyId)
    const filename = `${companyLabel}_Payroll_${month}_${year}.xlsx`

    setDownloadingLabel(filename)
    setDownloading(true)

    try {
      const res = await api.get('/reports/export-excel/', {
        params: {
          company: companyId === 'all' ? undefined : companyId,
          month,
          year,
        },
        responseType: 'blob',
      })

      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)

      toast({ title: 'Downloaded', description: `${filename} saved successfully.` })
    } catch {
      toast({ title: 'Download failed', description: 'Could not export Excel file.', variant: 'destructive' })
    } finally {
      setDownloading(false)
      setDownloadingLabel('')
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={isAr ? 'تصدير Excel' : 'Excel Export'}
        description="Export payroll data to Excel spreadsheet"
        breadcrumbs={[{ label: isAr ? 'التقارير' : 'Reports', href: '/reports' }, { label: isAr ? 'تصدير Excel' : 'Excel Export' }]}
      />

      {/* Controls */}
      <div className="bg-card rounded-lg border border-border p-6">
        <h2 className="text-base font-semibold text-foreground mb-4">Export Parameters</h2>
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5 min-w-[200px]">
            <label className="text-sm font-medium text-muted-foreground">{isAr ? 'الشركة' : 'Company'}</label>
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Companies — one sheet each</SelectItem>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.name_en}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-muted-foreground">{isAr ? 'الشهر' : 'Month'}</label>
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

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-muted-foreground">{isAr ? 'السنة' : 'Year'}</label>
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

          <Button
            className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white h-10"
            onClick={handleDownload}
            disabled={downloading}
          >
            {downloading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Downloading...
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                Download Excel
              </>
            )}
          </Button>
        </div>

        {downloading && downloadingLabel && (
          <div className="mt-3 flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 rounded p-3">
            <FileSpreadsheet className="h-4 w-4" />
            Downloading: <span className="font-mono font-medium">{downloadingLabel}</span>
          </div>
        )}
      </div>

      {/* Preview table */}
      <div className="bg-card rounded-lg border border-border overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">
            Preview — {formatMonthYear(month, year)}
            {previewRows.length > 0 && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({previewRows.length} employees)
              </span>
            )}
          </h2>
        </div>

        {previewLoading && (
          <div className="p-12 flex items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading preview...
          </div>
        )}

        {!previewLoading && previewRows.length === 0 && (
          <div className="p-12 text-center text-muted-foreground">
            No records found for the selected period and company.
          </div>
        )}

        {!previewLoading && previewRows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  {[
                    'Emp ID', 'Name', 'Dept', 'Position', 'Base Salary',
                    'Work Days', 'Absent', 'Late', 'OT Hrs', 'OT Amount',
                    'Total Deductions', 'Deduction Details', 'Total Bonuses', 'Bonus Details',
                    'Net Salary', 'Bank', 'Account/IBAN', 'Notes',
                  ].map((h) => (
                    <th key={h} className="px-3 py-2.5 text-left font-semibold text-muted-foreground whitespace-nowrap uppercase tracking-wide">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {previewRows.map((row, i) => (
                  <tr key={i} className="hover:bg-muted/50 transition-colors">
                    <td className="px-3 py-2 font-mono text-muted-foreground">{row.employee_id}</td>
                    <td className="px-3 py-2 font-medium text-foreground whitespace-nowrap">{row.name}</td>
                    <td className="px-3 py-2 text-foreground">{row.department}</td>
                    <td className="px-3 py-2 text-foreground whitespace-nowrap">{row.position}</td>
                    <td className="px-3 py-2 text-right text-foreground">{formatCurrency(row.base_salary)}</td>
                    <td className="px-3 py-2 text-center text-foreground">{row.work_days}</td>
                    <td className="px-3 py-2 text-center text-foreground">{row.absent_days}</td>
                    <td className="px-3 py-2 text-center text-foreground">{row.late_count}</td>
                    <td className="px-3 py-2 text-center text-foreground">{row.ot_hours.toFixed(1)}</td>
                    <td className="px-3 py-2 text-right text-foreground">{formatCurrency(row.ot_amount)}</td>
                    <td className="px-3 py-2 text-right text-red-600 font-medium">{formatCurrency(row.total_deductions)}</td>
                    <td className="px-3 py-2 text-muted-foreground max-w-[160px] truncate" title={row.deduction_details}>{row.deduction_details || '—'}</td>
                    <td className="px-3 py-2 text-right text-emerald-600 font-medium">{formatCurrency(row.total_bonuses)}</td>
                    <td className="px-3 py-2 text-muted-foreground max-w-[160px] truncate" title={row.bonus_details}>{row.bonus_details || '—'}</td>
                    <td className="px-3 py-2 text-right font-bold text-foreground">{formatCurrency(row.net_salary)}</td>
                    <td className="px-3 py-2 text-foreground">{row.bank_name || '—'}</td>
                    <td className="px-3 py-2 font-mono text-muted-foreground">{row.account_iban || '—'}</td>
                    <td className="px-3 py-2 text-muted-foreground">{row.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
