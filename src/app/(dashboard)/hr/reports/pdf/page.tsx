'use client'

import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileText, Loader2, Download } from 'lucide-react'
import { useLocale } from '@/lib/i18n'
import { PageHeader } from '@/components/hr/shared/PageHeader'
import { Button } from '@/components/hr/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/hr/ui/select'
import { useToast } from '@/components/hr/ui/toast'
import api, { companiesApi } from '@/lib/hr/api'
import { formatMonthYear } from '@/lib/hr/utils'
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

const PDF_SECTIONS = [
  { key: 'executive_summary', label: 'Executive Summary' },
  { key: 'attendance_overview', label: 'Attendance Overview' },
  { key: 'overtime_summary', label: 'Overtime Summary' },
  { key: 'deductions_summary', label: 'Deductions Summary' },
  { key: 'bonuses_summary', label: 'Bonuses Summary' },
  { key: 'employee_detail_table', label: 'Employee Detail Table' },
  { key: 'incident_log', label: 'Incident Log' },
  { key: 'salary_comparison', label: 'Salary Comparison' },
  { key: 'warnings_flags', label: 'Warnings & Flags' },
]

export default function PdfReportPage() {
  const { locale } = useLocale()
  const isAr = locale === 'ar'
  const { toast } = useToast()
  const now = new Date()

  const [companyId, setCompanyId] = useState<string>('group_wide')
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [checkedSections, setCheckedSections] = useState<Record<string, boolean>>(
    Object.fromEntries(PDF_SECTIONS.map((s) => [s.key, true]))
  )
  const [generating, setGenerating] = useState(false)

  const { data: companiesData } = useQuery<{ data: { results: Company[] } }>({
    queryKey: ['companies'],
    queryFn: () => companiesApi.list(),
  })
  const companies = companiesData?.data?.results ?? []

  const checkedList = PDF_SECTIONS.filter((s) => checkedSections[s.key])

  function toggleSection(key: string) {
    setCheckedSections((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  function toggleAll(checked: boolean) {
    setCheckedSections(Object.fromEntries(PDF_SECTIONS.map((s) => [s.key, checked])))
  }

  async function handleGenerate() {
    if (checkedList.length === 0) {
      toast({ title: 'No sections selected', description: 'Please select at least one section.', variant: 'destructive' })
      return
    }

    setGenerating(true)
    try {
      const sections = checkedList.map((s) => s.key)
      const res = await api.post(
        '/reports/generate-pdf/',
        {
          company: companyId === 'group_wide' ? null : companyId,
          month,
          year,
          sections,
        },
        { responseType: 'blob' }
      )

      const selectedCompany = companies.find((c) => String(c.id) === companyId)
      const companyLabel = companyId === 'group_wide' ? 'GroupWide' : (selectedCompany?.name_en ?? companyId)
      const filename = `${companyLabel}_Report_${month}_${year}.pdf`

      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)

      toast({ title: 'PDF Generated', description: `${filename} downloaded successfully.` })
    } catch {
      toast({ title: 'Generation failed', description: 'Could not generate the PDF. Please try again.', variant: 'destructive' })
    } finally {
      setGenerating(false)
    }
  }

  const allChecked = PDF_SECTIONS.every((s) => checkedSections[s.key])
  const noneChecked = PDF_SECTIONS.every((s) => !checkedSections[s.key])

  return (
    <div className="space-y-6">
      <PageHeader
        title={isAr ? 'إنشاء تقرير PDF' : 'PDF Report Generation'}
        description="Generate a comprehensive payroll PDF report for any period"
        breadcrumbs={[{ label: isAr ? 'التقارير' : 'Reports', href: '/reports' }, { label: isAr ? 'تقرير PDF' : 'PDF Report' }]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Configuration panel */}
        <div className="lg:col-span-2 space-y-6">
          {/* Selectors */}
          <div className="bg-card rounded-lg border border-border p-6">
            <h2 className="text-base font-semibold text-foreground mb-4">Report Parameters</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-muted-foreground">{isAr ? 'الشركة' : 'Company'}</label>
                <Select value={companyId} onValueChange={setCompanyId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="group_wide">Group-Wide</SelectItem>
                    {companies.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.name_en}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-muted-foreground">{isAr ? 'الشهر' : 'Month'}</label>
                <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                  <SelectTrigger>
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
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {YEARS.map((y) => (
                      <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Section selection */}
          <div className="bg-card rounded-lg border border-border p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-foreground">Sections to Include</h2>
              <div className="flex items-center gap-3 text-sm">
                <button
                  className="text-blue-600 hover:text-blue-800 font-medium"
                  onClick={() => toggleAll(true)}
                  disabled={allChecked}
                >
                  Select All
                </button>
                <span className="text-muted-foreground/60">|</span>
                <button
                  className="text-muted-foreground hover:text-foreground font-medium"
                  onClick={() => toggleAll(false)}
                  disabled={noneChecked}
                >
                  Clear All
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {PDF_SECTIONS.map((section) => (
                <label
                  key={section.key}
                  className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors border border-transparent hover:border-border"
                >
                  <input
                    type="checkbox"
                    checked={checkedSections[section.key]}
                    onChange={() => toggleSection(section.key)}
                    className="h-4 w-4 rounded border-border text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm font-medium text-foreground">{section.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Generate button */}
          <Button
            className="w-full gap-2 bg-red-600 hover:bg-red-700 text-white h-11"
            onClick={handleGenerate}
            disabled={generating || checkedList.length === 0}
          >
            {generating ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Generating PDF... This may take a moment
              </>
            ) : (
              <>
                <Download className="h-5 w-5" />
                Generate PDF
              </>
            )}
          </Button>
        </div>

        {/* Preview panel */}
        <div className="space-y-4">
          <div className="bg-card rounded-lg border border-border p-6">
            <div className="flex items-center gap-2 mb-4">
              <FileText className="h-5 w-5 text-red-500" />
              <h2 className="text-base font-semibold text-foreground">Report Preview</h2>
            </div>

            <div className="space-y-2 text-sm text-muted-foreground">
              <div>
                <span className="font-medium text-foreground">Period:</span>{' '}
                {formatMonthYear(month, year)}
              </div>
              <div>
                <span className="font-medium text-foreground">Scope:</span>{' '}
                {companyId === 'group_wide'
                  ? 'Group-Wide (all companies)'
                  : companies.find((c) => String(c.id) === companyId)?.name_en ?? companyId}
              </div>
              <div>
                <span className="font-medium text-foreground">Sections:</span>{' '}
                {checkedList.length} / {PDF_SECTIONS.length} selected
              </div>
            </div>

            {checkedList.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                  The PDF will include:
                </p>
                <ul className="space-y-1">
                  {checkedList.map((s) => (
                    <li key={s.key} className="flex items-center gap-2 text-sm text-foreground">
                      <span className="h-1.5 w-1.5 rounded-full bg-red-500 shrink-0" />
                      {s.label}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {checkedList.length === 0 && (
              <div className="mt-4 p-3 bg-amber-50 rounded border border-amber-200 text-xs text-amber-700">
                No sections selected. Select at least one section to generate the report.
              </div>
            )}
          </div>

          <div className="bg-muted/50 rounded-lg border border-border p-4 text-xs text-muted-foreground space-y-2">
            <p className="font-semibold text-foreground">{isAr ? 'ملاحظات' : 'Notes'}</p>
            <p>PDF generation may take 10-30 seconds depending on the number of employees and selected sections.</p>
            <p>The PDF is generated server-side and downloaded directly to your browser.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
