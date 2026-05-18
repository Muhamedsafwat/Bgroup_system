'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import {
  UserPlus,
  Upload,
  Eye,
  Pencil,
  AlertTriangle,
  Gift,
  CalendarDays,
  MoreHorizontal,
} from 'lucide-react'
import { PageHeader } from '@/components/hr/shared/PageHeader'
import { DataTable, type Column } from '@/components/hr/shared/DataTable'
import { FilterBar } from '@/components/hr/shared/FilterBar'
import { Badge } from '@/components/hr/ui/badge'
import { Button } from '@/components/hr/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/hr/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/hr/ui/dropdown-menu'
import { employeesApi, companiesApi, departmentsApi } from '@/lib/hr/api'
import { formatCurrency, formatDate, getInitials, capitalize } from '@/lib/hr/utils'
import { useLocale } from '@/lib/i18n'
import type { Employee, Company, Department, PaginatedResponse } from '@/lib/hr/types'

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'default'> = {
  active: 'success',
  on_leave: 'info',
  probation: 'warning',
  terminated: 'danger',
  suspended: 'danger',
}

export default function EmployeesPage() {
  const router = useRouter()
  const { t } = useLocale()

  // Defined inside the component so the labels swap when the user flips the
  // locale toggle. Keeping them at module scope would freeze the language to
  // whatever the dictionary was on first render.
  const STATUS_OPTIONS = [
    { value: 'active', label: t.pages.statusActive },
    { value: 'on_leave', label: t.pages.statusOnLeave },
    { value: 'probation', label: t.pages.statusProbation },
    { value: 'terminated', label: t.pages.statusTerminated },
    { value: 'suspended', label: t.pages.statusSuspended },
  ]
  const TYPE_OPTIONS = [
    { value: 'full_time', label: t.pages.typeFullTime },
    { value: 'part_time', label: t.pages.typePartTime },
    { value: 'contract', label: t.pages.typeContract },
    { value: 'intern', label: t.pages.typeIntern },
  ]

  const [search, setSearch] = useState('')
  const [selectedCompany, setSelectedCompany] = useState<number | null>(null)
  const [selectedDept, setSelectedDept] = useState<number | null>(null)
  const [status, setStatus] = useState('')
  const [employmentType, setEmploymentType] = useState('')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 20

  const { data: companiesData } = useQuery<{ data: { results: Company[] } }>({
    queryKey: ['companies'],
    queryFn: () => companiesApi.list(),
  })

  const { data: deptsData } = useQuery<{ data: { results: Department[] } }>({
    queryKey: ['departments', selectedCompany],
    queryFn: () => departmentsApi.list(selectedCompany ? { company: selectedCompany } : {}),
  })

  const { data, isLoading } = useQuery<{ data: PaginatedResponse<Employee> }>({
    queryKey: ['employees', search, selectedCompany, selectedDept, status, employmentType, page],
    queryFn: () =>
      employeesApi.list({
        search,
        company: selectedCompany || undefined,
        department: selectedDept || undefined,
        status: status || undefined,
        employment_type: employmentType || undefined,
        page,
        page_size: PAGE_SIZE,
      }),
    placeholderData: (prev) => prev,
  })

  const employees = data?.data?.results ?? []
  const totalCount = data?.data?.count ?? 0
  const companies = companiesData?.data?.results ?? []
  const departments = deptsData?.data?.results ?? []

  function resetFilters() {
    setSearch('')
    setSelectedCompany(null)
    setSelectedDept(null)
    setStatus('')
    setEmploymentType('')
    setPage(1)
  }

  const activeFilterCount = [search, selectedCompany, selectedDept, status, employmentType].filter(
    Boolean
  ).length

  const columns: Column<Employee>[] = [
    {
      key: 'employee_id',
      header: 'ID',
      sortable: true,
      className: 'font-mono text-xs text-muted-foreground whitespace-nowrap',
      cell: (row) => <span className="font-mono text-xs text-muted-foreground">{row.employee_id}</span>,
    },
    {
      key: 'full_name_en',
      header: 'Employee',
      cell: (row) => (
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8 shrink-0">
            <AvatarImage src={row.photo ?? undefined} alt={row.full_name_en} />
            <AvatarFallback className="text-xs bg-brand-navy/10 text-brand-navy font-semibold">
              {getInitials(row.full_name_en)}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="font-medium text-foreground text-sm">{row.full_name_en}</p>
            {row.full_name_ar && (
              <p className="text-xs text-muted-foreground dir-rtl">{row.full_name_ar}</p>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'department_name',
      header: 'Department',
      sortable: true,
      cell: (row) => (
        <span className="text-foreground text-sm">{row.department_name ?? '—'}</span>
      ),
    },
    {
      key: 'position_en',
      header: 'Position',
      cell: (row) => <span className="text-foreground text-sm">{row.position_en}</span>,
    },
    {
      key: 'employment_type',
      header: 'Type',
      cell: (row) => (
        <Badge variant="default" className="text-xs capitalize">
          {capitalize(row.employment_type)}
        </Badge>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      cell: (row) => (
        <Badge variant={STATUS_VARIANT[row.status] ?? 'default'} className="text-xs capitalize">
          {capitalize(row.status)}
        </Badge>
      ),
    },
    {
      key: 'base_salary',
      header: 'Base Salary',
      sortable: true,
      className: 'text-right',
      headerClassName: 'text-right',
      cell: (row) => (
        <span className="font-medium text-foreground whitespace-nowrap">
          {formatCurrency(row.base_salary, row.currency)}
        </span>
      ),
    },
    {
      key: 'contract_end',
      header: 'Contract End',
      cell: (row) =>
        row.contract_end ? (
          <span className="text-sm text-muted-foreground">{formatDate(row.contract_end)}</span>
        ) : (
          <span className="text-muted-foreground text-sm">Indefinite</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      className: 'w-10',
      cell: (row) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="icon-sm" className="h-7 w-7">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => router.push(`/hr/employees/${row.id}`)}>
              <Eye className="h-4 w-4 mr-2" /> View Profile
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push(`/hr/employees/${row.id}?edit=true`)}>
              <Pencil className="h-4 w-4 mr-2" /> Edit Employee
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => router.push(`/hr/employees/${row.id}?tab=incidents`)}
            >
              <AlertTriangle className="h-4 w-4 mr-2 text-red-500" /> Submit Incident
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => router.push(`/hr/employees/${row.id}?tab=incidents`)}
            >
              <Gift className="h-4 w-4 mr-2 text-emerald-500" /> Award Bonus
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => router.push(`/hr/employees/${row.id}?tab=attendance`)}
            >
              <CalendarDays className="h-4 w-4 mr-2 text-blue-500" /> View Attendance
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.pages.employeesTitle}
        description={`${totalCount} ${t.pages.employeesTotal}`}
        breadcrumbs={[{ label: t.pages.employeesTitle }]}
        demoId="employees-page-header"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push('/hr/employees/bulk-import')}
              className="gap-1.5"
            >
              <Upload className="h-4 w-4" />
              {t.pages.bulkImport}
            </Button>
            <Button
              size="sm"
              className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => router.push('/hr/employees/add')}
              data-demo-id="add-employee-btn"
            >
              <UserPlus className="h-4 w-4" />
              {t.pages.addEmployee}
            </Button>
          </div>
        }
      />

      <FilterBar
        search={search}
        onSearchChange={(v) => { setSearch(v); setPage(1) }}
        companies={companies}
        selectedCompany={selectedCompany}
        onCompanyChange={(v) => { setSelectedCompany(v); setSelectedDept(null); setPage(1) }}
        departments={departments}
        selectedDepartment={selectedDept}
        onDepartmentChange={(v) => { setSelectedDept(v); setPage(1) }}
        status={status}
        statusOptions={STATUS_OPTIONS}
        onStatusChange={(v) => { setStatus(v); setPage(1) }}
        extraFilters={
          <div className="min-w-[160px]">
            <select
              className="h-9 w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-navy"
              value={employmentType}
              onChange={(e) => { setEmploymentType(e.target.value); setPage(1) }}
            >
              <option value="">{t.pages.allTypes}</option>
              {TYPE_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        }
        onReset={resetFilters}
        activeFilterCount={activeFilterCount}
      />

      <div data-demo-id="employees-table">
        <DataTable
          data={employees}
          columns={columns}
          loading={isLoading}
          totalCount={totalCount}
          page={page}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
          emptyTitle={t.pages.noEmployeesFound}
          emptyDescription={t.pages.tryAdjustingFilters}
          onRowClick={(row) => router.push(`/hr/employees/${row.id}`)}
        />
      </div>
    </div>
  )
}
