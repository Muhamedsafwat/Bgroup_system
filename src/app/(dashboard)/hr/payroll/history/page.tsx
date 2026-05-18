'use client'

import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { Eye, Download, FileSpreadsheet } from 'lucide-react'
import { useLocale } from '@/lib/i18n'
import { PageHeader } from '@/components/hr/shared/PageHeader'
import { DataTable, type Column } from '@/components/hr/shared/DataTable'
import { Button } from '@/components/hr/ui/button'
import { Badge } from '@/components/hr/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/hr/ui/select'
import api, { companiesApi } from '@/lib/hr/api'
import { formatCurrency, formatMonthYear } from '@/lib/hr/utils'
import type { Company, PayrollSummary } from '@/lib/hr/types'

const MONTHS = [
  { value: 0, label: 'All Months' },
  { value: 1, label: 'January' }, { value: 2, label: 'February' },
  { value: 3, label: 'March' }, { value: 4, label: 'April' },
  { value: 5, label: 'May' }, { value: 6, label: 'June' },
  { value: 7, label: 'July' }, { value: 8, label: 'August' },
  { value: 9, label: 'September' }, { value: 10, label: 'October' },
  { value: 11, label: 'November' }, { value: 12, label: 'December' },
]

const CURRENT_YEAR = new Date().getFullYear()
const YEARS = [{ value: 0, label: 'All Years' }, ...Array.from({ length: 5 }, (_, i) => ({
  value: CURRENT_YEAR - i,
  label: String(CURRENT_YEAR - i),
}))]

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'info' | 'default'> = {
  paid: 'success',
  locked: 'info',
  calculated: 'warning',
  draft: 'default',
}

function downloadFile(url: string, filename: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
}

export default function PayrollHistoryPage() {
  const { locale } = useLocale();
  const isAr = locale === 'ar';
  const router = useRouter()
  const [companyId, setCompanyId] = useState<string>('')
  const [filterMonth, setFilterMonth] = useState(0)
  const [filterYear, setFilterYear] = useState(0)

  const { data: companiesData } = useQuery<{ data: { results: Company[] } }>({
    queryKey: ['companies'],
    queryFn: () => companiesApi.list(),
  })
  const companies = companiesData?.data?.results ?? []

  const { data, isLoading } = useQuery<{ data: { results: PayrollSummary[] } }>({
    queryKey: ['payroll-periods', companyId, filterMonth, filterYear],
    queryFn: () =>
      api.get('/payroll/periods/', {
        params: {
          company: companyId || undefined,
          month: filterMonth || undefined,
          year: filterYear || undefined,
        },
      }),
  })

  const periods = data?.data?.results ?? []

  async function handleDownloadPdf(period: PayrollSummary) {
    try {
      const res = await api.get('/reports/generate-pdf/', {
        params: { month: period.month, year: period.year, company: period.company },
        responseType: 'blob',
      })
      const url = URL.createObjectURL(res.data)
      downloadFile(url, `Payroll_${period.company_name}_${formatMonthYear(period.month, period.year)}.pdf`)
      URL.revokeObjectURL(url)
    } catch {
      // error handled silently
    }
  }

  async function handleDownloadExcel(period: PayrollSummary) {
    try {
      const res = await api.get('/reports/export-excel/', {
        params: { month: period.month, year: period.year, company: period.company },
        responseType: 'blob',
      })
      const url = URL.createObjectURL(res.data)
      downloadFile(url, `${period.company_name}_Payroll_${period.month}_${period.year}.xlsx`)
      URL.revokeObjectURL(url)
    } catch {
      // error handled silently
    }
  }

  const columns: Column<PayrollSummary>[] = [
    {
      key: 'month',
      header: 'Period',
      sortable: true,
      cell: (row) => (
        <span className="font-medium text-foreground">{formatMonthYear(row.month, row.year)}</span>
      ),
    },
    {
      key: 'company_name',
      header: 'Company',
      cell: (row) => <span className="text-foreground">{row.company_name ?? '—'}</span>,
    },
    {
      key: 'total_employees',
      header: 'Employees',
      className: 'text-center',
      cell: (row) => <span className="text-foreground">{row.total_employees}</span>,
    },
    {
      key: 'total_base_salary',
      header: 'Total Base (EGP)',
      className: 'text-right',
      cell: (row) => <span className="text-foreground">{formatCurrency(row.total_base_salary)}</span>,
    },
    {
      key: 'total_overtime',
      header: 'Total OT',
      className: 'text-right',
      cell: (row) => <span className="text-foreground">{formatCurrency(row.total_overtime)}</span>,
    },
    {
      key: 'total_deductions',
      header: 'Deductions',
      className: 'text-right',
      cell: (row) => <span className="text-red-600 font-medium">{formatCurrency(row.total_deductions)}</span>,
    },
    {
      key: 'total_bonuses',
      header: 'Bonuses',
      className: 'text-right',
      cell: (row) => <span className="text-emerald-600 font-medium">{formatCurrency(row.total_bonuses)}</span>,
    },
    {
      key: 'total_net_salary',
      header: 'Total Net',
      className: 'text-right',
      cell: (row) => <span className="font-bold text-foreground">{formatCurrency(row.total_net_salary)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => (
        <Badge variant={STATUS_VARIANT[row.status] ?? 'default'} className="capitalize">
          {row.status}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      className: 'whitespace-nowrap',
      cell: (row) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() =>
              router.push(
                `/payroll/monthly?month=${row.month}&year=${row.year}&company=${row.company}&readonly=true`
              )
            }
          >
            <Eye className="h-3.5 w-3.5" />
            View
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs text-red-600 hover:text-red-700"
            onClick={() => handleDownloadPdf(row)}
          >
            <Download className="h-3.5 w-3.5" />
            PDF
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs text-emerald-700 hover:text-emerald-800"
            onClick={() => handleDownloadExcel(row)}
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            Excel
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payroll History"
        description="Browse and download past payroll periods"
        breadcrumbs={[{ label: isAr ? 'الرواتب' : 'Payroll', href: '/payroll' }, { label: isAr ? 'السجل' : 'History' }]}
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 bg-card rounded-lg border border-border p-4">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">Company:</label>
          <Select value={companyId || 'all'} onValueChange={(v) => setCompanyId(v === 'all' ? '' : v)}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="All Companies" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Companies</SelectItem>
              {companies.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.name_en}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-muted-foreground">Month:</label>
          <Select value={String(filterMonth)} onValueChange={(v) => setFilterMonth(Number(v))}>
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
          <Select value={String(filterYear)} onValueChange={(v) => setFilterYear(Number(v))}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {YEARS.map((y) => (
                <SelectItem key={y.value} value={String(y.value)}>{y.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <DataTable
        data={periods}
        columns={columns}
        loading={isLoading}
        emptyTitle="No payroll periods found"
        emptyDescription="No finalized payroll records match your current filters."
      />
    </div>
  )
}
