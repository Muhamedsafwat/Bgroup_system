'use client'

import { useLocale } from '@/lib/i18n'

import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '@/lib/hr/api'
import { formatDate, cn } from '@/lib/hr/utils'
import { PageHeader } from '@/components/hr/shared/PageHeader'
import { Skeleton } from '@/components/hr/ui/skeleton'
import { Label } from '@/components/hr/ui/label'
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

interface ProgressiveDisciplineRow {
  employee_id: number
  employee_name: string
  employee_id_str: string
  department_name: string
  company_name: string
  category_name: string
  total_offenses: number
  current_level: string
  last_offense_date: string
  next_offense_action: string
  severity: 'green' | 'yellow' | 'orange' | 'red'
}

function getRowBg(offenses: number): string {
  if (offenses >= 4) return 'bg-red-50 hover:bg-red-100'
  if (offenses === 3) return 'bg-orange-50 hover:bg-orange-100'
  if (offenses === 2) return 'bg-amber-50 hover:bg-amber-100'
  return 'hover:bg-muted/50'
}

function getSeverityBadge(severity: string) {
  const map: Record<string, { label: string; cls: string }> = {
    green: { label: 'Low', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
    yellow: { label: 'Moderate', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
    orange: { label: 'High', cls: 'bg-orange-100 text-orange-700 border-orange-200' },
    red: { label: 'Critical', cls: 'bg-red-100 text-red-700 border-red-200' },
  }
  const cfg = map[severity] ?? map.green
  return (
    <span className={cn('text-xs px-2 py-0.5 rounded-full border font-medium', cfg.cls)}>
      {cfg.label}
    </span>
  )
}

function getLevelBadge(level: string) {
  const map: Record<string, string> = {
    verbal_warning: 'bg-blue-50 text-blue-700 border-blue-200',
    written_warning: 'bg-amber-50 text-amber-700 border-amber-200',
    final_warning: 'bg-orange-50 text-orange-700 border-orange-200',
    salary_deduction: 'bg-red-50 text-red-700 border-red-200',
    suspension: 'bg-red-100 text-red-800 border-red-300',
    termination: 'bg-red-200 text-red-900 border-red-400',
  }
  const cls = map[level] ?? 'bg-muted/50 text-foreground border-border'
  return (
    <span className={cn('text-xs px-2 py-0.5 rounded border font-medium capitalize', cls)}>
      {level?.replace(/_/g, ' ')}
    </span>
  )
}

export default function ProgressiveDisciplinePage() {
  const { locale } = useLocale()
  const isAr = locale === 'ar'
  const [company, setCompany] = useState('')
  const [department, setDepartment] = useState('')
  const [severity, setSeverity] = useState('')

  const { data: companiesData } = useQuery({
    queryKey: ['companies'],
    queryFn: async () => (await api.get('/companies/')).data,
  })

  const { data: departmentsData } = useQuery({
    queryKey: ['departments', company],
    queryFn: async () => (await api.get('/departments/', { params: company ? { company } : {} })).data,
  })

  const { data, isLoading } = useQuery<ProgressiveDisciplineRow[]>({
    queryKey: ['incidents', 'progressive', company, department, severity],
    queryFn: async () => {
      const res = await api.get('/incidents/progressive-discipline/', {
        params: {
          company: company || undefined,
          department: department || undefined,
          severity: severity || undefined,
        },
      })
      return Array.isArray(res.data) ? res.data : res.data.results ?? []
    },
  })

  const companies = Array.isArray(companiesData) ? companiesData : companiesData?.results ?? []
  const departments = Array.isArray(departmentsData) ? departmentsData : departmentsData?.results ?? []
  const rows = data ?? []

  const summary = {
    critical: rows.filter(r => r.total_offenses >= 4).length,
    high: rows.filter(r => r.total_offenses === 3).length,
    moderate: rows.filter(r => r.total_offenses === 2).length,
    low: rows.filter(r => r.total_offenses <= 1).length,
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={isAr ? 'حالة التأديب المتدرج' : 'Progressive Discipline Status'}
        description="Track employee offense history and discipline escalation levels"
        breadcrumbs={[{ label: isAr ? 'المخالفات' : 'Incidents' }, { label: isAr ? 'التأديب المتدرج' : 'Progressive Discipline' }]}
      />

      {/* Summary Chips */}
      <div className="flex flex-wrap gap-3">
        <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-50 border border-red-200">
          <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
          <span className="text-sm font-semibold text-red-700">{summary.critical}</span>
          <span className="text-xs text-red-600">Critical (4+)</span>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-50 border border-orange-200">
          <span className="h-2.5 w-2.5 rounded-full bg-orange-500" />
          <span className="text-sm font-semibold text-orange-700">{summary.high}</span>
          <span className="text-xs text-orange-600">High (3)</span>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-50 border border-amber-200">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
          <span className="text-sm font-semibold text-amber-700">{summary.moderate}</span>
          <span className="text-xs text-amber-600">Moderate (2)</span>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-50 border border-emerald-200">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
          <span className="text-sm font-semibold text-emerald-700">{summary.low}</span>
          <span className="text-xs text-emerald-600">Low (0-1)</span>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-card p-4 rounded-lg border border-border flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <Label>{isAr ? 'الشركة' : 'Company'}</Label>
          <Select value={company} onValueChange={v => { setCompany(v === 'all' ? '' : v); setDepartment('') }}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="All Companies" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Companies</SelectItem>
              {companies.map((c: { id: number; name_en: string }) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.name_en}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>{isAr ? 'القسم' : 'Department'}</Label>
          <Select value={department} onValueChange={v => setDepartment(v === 'all' ? '' : v)}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="All Departments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Departments</SelectItem>
              {departments.map((d: { id: number; name_en: string }) => (
                <SelectItem key={d.id} value={String(d.id)}>{d.name_en}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>{isAr ? 'الشدة' : 'Severity'}</Label>
          <Select value={severity} onValueChange={v => setSeverity(v === 'all' ? '' : v)}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All Severities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Severities</SelectItem>
              <SelectItem value="green">Low (Green)</SelectItem>
              <SelectItem value="yellow">Moderate (Yellow)</SelectItem>
              <SelectItem value="orange">High (Orange)</SelectItem>
              <SelectItem value="red">Critical (Red)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Legend */}
      <div className="flex gap-4 text-xs text-muted-foreground">
        <span>Row colors:</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-6 rounded bg-card border border-border" /> 0-1 offenses</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-6 rounded bg-amber-100 border border-amber-200" /> 2 offenses</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-6 rounded bg-orange-100 border border-orange-200" /> 3 offenses</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-6 rounded bg-red-100 border border-red-200" /> 4+ offenses</span>
      </div>

      {/* Table */}
      <div className="bg-card rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="font-semibold">{isAr ? 'الموظف' : 'Employee'}</TableHead>
              <TableHead className="font-semibold">{isAr ? 'القسم' : 'Department'}</TableHead>
              <TableHead className="font-semibold">{isAr ? 'الفئة' : 'Category'}</TableHead>
              <TableHead className="font-semibold text-center">Total Offenses</TableHead>
              <TableHead className="font-semibold">Current Level</TableHead>
              <TableHead className="font-semibold">Last Offense</TableHead>
              <TableHead className="font-semibold">Next Offense Would Be</TableHead>
              <TableHead className="font-semibold">{isAr ? 'الشدة' : 'Severity'}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 8 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                  No progressive discipline records found
                </TableCell>
              </TableRow>
            ) : (
              rows.map(row => (
                <TableRow key={`${row.employee_id}-${row.category_name}`} className={cn('transition-colors', getRowBg(row.total_offenses))}>
                  <TableCell>
                    <div>
                      <p className="font-medium">{row.employee_name}</p>
                      <p className="text-xs text-muted-foreground font-mono">{row.employee_id_str}</p>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">{row.department_name}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{row.category_name}</TableCell>
                  <TableCell className="text-center">
                    <span className={cn(
                      'text-lg font-bold',
                      row.total_offenses >= 4 ? 'text-red-700' :
                      row.total_offenses === 3 ? 'text-orange-700' :
                      row.total_offenses === 2 ? 'text-amber-700' :
                      'text-foreground'
                    )}>
                      {row.total_offenses}
                    </span>
                  </TableCell>
                  <TableCell>{getLevelBadge(row.current_level)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {row.last_offense_date ? formatDate(row.last_offense_date) : '—'}
                  </TableCell>
                  <TableCell>
                    <span className={cn(
                      'text-xs px-2 py-0.5 rounded border font-medium capitalize',
                      row.next_offense_action === 'termination'
                        ? 'bg-red-100 text-red-900 border-red-400'
                        : 'bg-muted/50 text-foreground border-border'
                    )}>
                      {row.next_offense_action?.replace(/_/g, ' ') ?? '—'}
                    </span>
                  </TableCell>
                  <TableCell>{getSeverityBadge(row.severity)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
