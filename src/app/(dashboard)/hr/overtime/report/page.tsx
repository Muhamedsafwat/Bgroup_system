'use client'

import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Clock, DollarSign, TrendingUp, Award } from 'lucide-react'
import { useLocale } from '@/lib/i18n'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend,
} from 'recharts'
import api from '@/lib/hr/api'
import { formatCurrency, formatDate } from '@/lib/hr/utils'
import { PageHeader } from '@/components/hr/shared/PageHeader'
import { StatCard } from '@/components/hr/shared/StatCard'
import { ExportButton } from '@/components/hr/shared/ExportButton'
import { Label } from '@/components/hr/ui/label'
import { Input } from '@/components/hr/ui/input'
import { Skeleton } from '@/components/hr/ui/skeleton'
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
import { Card } from '@/components/hr/ui/card'

interface OTReportSummary {
  total_ot_hours: number
  total_ot_cost: number
  avg_ot_per_employee: number
  highest_ot_employee_name: string
  highest_ot_employee_hours: number
}

interface DeptOTData {
  department_name: string
  total_hours: number
  total_amount: number
}

interface MonthlyTrendData {
  month: string
  total_hours: number
  total_amount: number
}

interface OTEmployeeRow {
  rank: number
  employee_id: number
  employee_name: string
  department_name: string
  total_hours: number
  total_amount: number
}

interface OTReportData {
  summary: OTReportSummary
  top5: OTEmployeeRow[]
  by_department: DeptOTData[]
  monthly_trend: MonthlyTrendData[]
  per_employee: OTEmployeeRow[]
}

function getMonthRange() {
  const now = new Date()
  const first = new Date(now.getFullYear(), now.getMonth(), 1)
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  return {
    from: first.toISOString().split('T')[0],
    to: last.toISOString().split('T')[0],
  }
}

export default function OvertimeReportPage() {
  const { locale } = useLocale()
  const isAr = locale === 'ar'
  const defaultRange = getMonthRange()
  const [dateFrom, setDateFrom] = useState(defaultRange.from)
  const [dateTo, setDateTo] = useState(defaultRange.to)
  const [company, setCompany] = useState('')
  const [department, setDepartment] = useState('')

  const { data: companiesData } = useQuery({
    queryKey: ['companies'],
    queryFn: async () => (await api.get('/companies/')).data,
  })

  const { data: departmentsData } = useQuery({
    queryKey: ['departments', company],
    queryFn: async () => (await api.get('/departments/', { params: company ? { company } : {} })).data,
  })

  const { data, isLoading } = useQuery<OTReportData>({
    queryKey: ['overtime', 'report', dateFrom, dateTo, company, department],
    queryFn: async () => {
      const res = await api.get('/overtime/report/', {
        params: {
          date_from: dateFrom,
          date_to: dateTo,
          company: company || undefined,
          department: department || undefined,
        },
      })
      return res.data
    },
    enabled: !!dateFrom && !!dateTo,
  })

  const companies = Array.isArray(companiesData) ? companiesData : companiesData?.results ?? []
  const departments = Array.isArray(departmentsData) ? departmentsData : departmentsData?.results ?? []

  async function handleExportExcel() {
    const res = await api.get('/reports/overtime-excel/', {
      params: { date_from: dateFrom, date_to: dateTo, company: company || undefined, department: department || undefined },
      responseType: 'blob',
    })
    return res.data
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={isAr ? 'تقرير الساعات الإضافية' : 'Overtime Report'}
        description="Overtime analysis by employee and department"
        breadcrumbs={[{ label: isAr ? 'الساعات الإضافية' : 'Overtime' }, { label: isAr ? 'تقرير' : 'Report' }]}
        actions={
          <ExportButton
            onExportExcel={handleExportExcel}
            filename="overtime-report"
            label="Export Excel"
          />
        }
      />

      {/* Filters */}
      <div className="bg-card p-4 rounded-lg border border-border flex flex-wrap gap-4 items-end">
        <div className="space-y-1">
          <Label>{isAr ? 'من تاريخ' : 'Date From'}</Label>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
        </div>
        <div className="space-y-1">
          <Label>{isAr ? 'إلى تاريخ' : 'Date To'}</Label>
          <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-40" />
        </div>
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
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total OT Hours"
          value={isLoading ? '—' : `${data?.summary.total_ot_hours?.toFixed(1) ?? 0}h`}
          icon={<Clock className="h-5 w-5" />}
          color="blue"
          loading={isLoading}
        />
        <StatCard
          label="Total OT Cost"
          value={isLoading ? '—' : formatCurrency(data?.summary.total_ot_cost ?? 0)}
          icon={<DollarSign className="h-5 w-5" />}
          color="emerald"
          loading={isLoading}
        />
        <StatCard
          label="Avg OT / Employee"
          value={isLoading ? '—' : `${data?.summary.avg_ot_per_employee?.toFixed(1) ?? 0}h`}
          icon={<TrendingUp className="h-5 w-5" />}
          color="amber"
          loading={isLoading}
        />
        <StatCard
          label="Highest OT Employee"
          value={isLoading ? '—' : `${data?.summary.highest_ot_employee_hours?.toFixed(1) ?? 0}h`}
          subtext={data?.summary.highest_ot_employee_name}
          icon={<Award className="h-5 w-5" />}
          color="navy"
          loading={isLoading}
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bar Chart: OT by Department */}
        <Card className="p-6">
          <h3 className="text-base font-semibold text-foreground mb-4">OT Hours by Department</h3>
          {isLoading ? (
            <Skeleton className="h-56 w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data?.by_department ?? []} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="department_name" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip
                  formatter={(v) => [`${Number(v).toFixed(1)}h`, 'OT Hours']}
                  contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }}
                />
                <Bar dataKey="total_hours" fill="#3b82f6" radius={[4, 4, 0, 0]} name="OT Hours" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Line Chart: Monthly Trend */}
        <Card className="p-6">
          <h3 className="text-base font-semibold text-foreground mb-4">OT Trend (Past 6 Months)</h3>
          {isLoading ? (
            <Skeleton className="h-56 w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={data?.monthly_trend ?? []} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="total_hours" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} name="Hours" />
                <Line type="monotone" dataKey="total_amount" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} name="Amount (EGP)" yAxisId={0} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* Top 5 OT Employees */}
      <Card className="p-6">
        <h3 className="text-base font-semibold text-foreground mb-4">Top 5 Overtime Employees</h3>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="font-semibold w-16">{isAr ? 'الترتيب' : 'Rank'}</TableHead>
              <TableHead className="font-semibold">{isAr ? 'الاسم' : 'Name'}</TableHead>
              <TableHead className="font-semibold">{isAr ? 'القسم' : 'Department'}</TableHead>
              <TableHead className="font-semibold text-right">Total Hours</TableHead>
              <TableHead className="font-semibold text-right">Total Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 5 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : !data?.top5?.length ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No data available</TableCell>
              </TableRow>
            ) : (
              data.top5.map((row, i) => (
                <TableRow key={row.employee_id}>
                  <TableCell>
                    <div className={`h-7 w-7 rounded-full flex items-center justify-center text-sm font-bold ${
                      i === 0 ? 'bg-amber-100 text-amber-700' :
                      i === 1 ? 'bg-slate-200 text-foreground' :
                      i === 2 ? 'bg-orange-100 text-orange-700' :
                      'bg-muted/50 text-muted-foreground'
                    }`}>
                      {i + 1}
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">{row.employee_name}</TableCell>
                  <TableCell className="text-muted-foreground">{row.department_name}</TableCell>
                  <TableCell className="text-right font-semibold text-blue-700">{row.total_hours?.toFixed(1)}h</TableCell>
                  <TableCell className="text-right font-semibold text-emerald-700">{formatCurrency(row.total_amount)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Per-Employee Breakdown */}
      <div>
        <h3 className="text-base font-semibold text-foreground mb-3">All Employees Breakdown</h3>
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="font-semibold">{isAr ? 'الموظف' : 'Employee'}</TableHead>
                <TableHead className="font-semibold">{isAr ? 'القسم' : 'Department'}</TableHead>
                <TableHead className="font-semibold text-right">Total Hours</TableHead>
                <TableHead className="font-semibold text-right">Total Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 4 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : !data?.per_employee?.length ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-10 text-muted-foreground">No data found</TableCell>
                </TableRow>
              ) : (
                data.per_employee.map(row => (
                  <TableRow key={row.employee_id} className="hover:bg-muted/50">
                    <TableCell className="font-medium">{row.employee_name}</TableCell>
                    <TableCell className="text-muted-foreground">{row.department_name}</TableCell>
                    <TableCell className="text-right font-semibold">{row.total_hours?.toFixed(1)}h</TableCell>
                    <TableCell className="text-right font-semibold text-emerald-700">{formatCurrency(row.total_amount)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  )
}
