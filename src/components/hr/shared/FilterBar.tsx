'use client'

import React from 'react'
import { Search, X, Filter } from 'lucide-react'
import { Input } from '@/components/hr/ui/input'
import { Button } from '@/components/hr/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/hr/ui/select'
import { cn } from '@/lib/hr/utils'
import { useLocale } from '@/lib/i18n'
import type { Company, Department } from '@/lib/hr/types'

interface FilterBarProps {
  search?: string
  onSearchChange?: (value: string) => void
  companies?: Company[]
  selectedCompany?: number | null
  onCompanyChange?: (id: number | null) => void
  departments?: Department[]
  selectedDepartment?: number | null
  onDepartmentChange?: (id: number | null) => void
  status?: string
  statusOptions?: { value: string; label: string }[]
  onStatusChange?: (value: string) => void
  dateFrom?: string
  onDateFromChange?: (value: string) => void
  dateTo?: string
  onDateToChange?: (value: string) => void
  month?: string
  onMonthChange?: (value: string) => void
  year?: string
  yearOptions?: number[]
  onYearChange?: (value: string) => void
  extraFilters?: React.ReactNode
  onReset?: () => void
  activeFilterCount?: number
  className?: string
}

export function FilterBar({
  search,
  onSearchChange,
  companies,
  selectedCompany,
  onCompanyChange,
  departments,
  selectedDepartment,
  onDepartmentChange,
  status,
  statusOptions,
  onStatusChange,
  dateFrom,
  onDateFromChange,
  dateTo,
  onDateToChange,
  month,
  onMonthChange,
  year,
  yearOptions,
  onYearChange,
  extraFilters,
  onReset,
  activeFilterCount = 0,
  className,
}: FilterBarProps) {
  const { locale } = useLocale()
  const isAr = locale === "ar"
  const currentYear = new Date().getFullYear()
  const years = yearOptions || Array.from({ length: 5 }, (_, i) => currentYear - i)

  // Locale-aware month labels. Generated from a 1-based date so they match
  // the browser's own month names — picks up Arabic numerals + diacritics
  // automatically when the locale is Arabic.
  const fmt = new Intl.DateTimeFormat(isAr ? 'ar-EG' : 'en-US', { month: 'long' })
  const months = Array.from({ length: 12 }, (_, i) => ({
    value: String(i + 1),
    label: fmt.format(new Date(2000, i, 1)),
  }))

  return (
    <div className={cn('bg-card rounded-lg border border-border p-4', className)}>
      <div className="flex flex-wrap gap-3 items-end">
        {/* Search */}
        {onSearchChange !== undefined && (
          <div className="flex-1 min-w-[200px]" data-demo-id="filter-search">
            <Input
              placeholder={isAr ? "بحث..." : "Search..."}
              value={search || ''}
              onChange={(e) => onSearchChange(e.target.value)}
              leftIcon={<Search className="h-4 w-4" />}
              rightIcon={
                search ? (
                  <button onClick={() => onSearchChange('')} className="hover:text-muted-foreground">
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : undefined
              }
              className="h-9"
            />
          </div>
        )}

        {/* Company Filter */}
        {companies && onCompanyChange && (
          <div className="min-w-[160px]" data-demo-id="filter-company">
            <Select
              value={selectedCompany ? String(selectedCompany) : 'all'}
              onValueChange={(v) => onCompanyChange(v === 'all' ? null : Number(v))}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder={isAr ? "كل الشركات" : "All Companies"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{isAr ? "كل الشركات" : "All Companies"}</SelectItem>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name_en}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Department Filter */}
        {departments && onDepartmentChange && (
          <div className="min-w-[160px]">
            <Select
              value={selectedDepartment ? String(selectedDepartment) : 'all'}
              onValueChange={(v) => onDepartmentChange(v === 'all' ? null : Number(v))}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder={isAr ? "كل الأقسام" : "All Departments"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{isAr ? "كل الأقسام" : "All Departments"}</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={String(d.id)}>
                    {d.name_en}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Status Filter */}
        {statusOptions && onStatusChange && (
          <div className="min-w-[140px]" data-demo-id="filter-status">
            <Select
              value={status || 'all'}
              onValueChange={(v) => onStatusChange(v === 'all' ? '' : v)}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder={isAr ? "كل الحالات" : "All Statuses"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{isAr ? "كل الحالات" : "All Statuses"}</SelectItem>
                {statusOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Date From */}
        {onDateFromChange && (
          <div className="min-w-[130px]">
            <Input
              type="date"
              value={dateFrom || ''}
              onChange={(e) => onDateFromChange(e.target.value)}
              className="h-9 text-sm"
              placeholder="From"
            />
          </div>
        )}

        {/* Date To */}
        {onDateToChange && (
          <div className="min-w-[130px]">
            <Input
              type="date"
              value={dateTo || ''}
              onChange={(e) => onDateToChange(e.target.value)}
              className="h-9 text-sm"
              placeholder="To"
            />
          </div>
        )}

        {/* Month */}
        {onMonthChange && (
          <div className="min-w-[130px]">
            <Select
              value={month || ''}
              onValueChange={onMonthChange}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Month" />
              </SelectTrigger>
              <SelectContent>
                {months.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Year */}
        {onYearChange && (
          <div className="min-w-[100px]">
            <Select
              value={year || String(currentYear)}
              onValueChange={onYearChange}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Year" />
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
        )}

        {/* Extra Filters */}
        {extraFilters}

        {/* Reset */}
        {onReset && (
          <Button
            variant="outline"
            size="sm"
            onClick={onReset}
            className="h-9 gap-1.5"
          >
            <X className="h-3.5 w-3.5" />
            {isAr ? "إعادة تعيين" : "Reset"}
            {activeFilterCount > 0 && (
              <span className="ml-1 bg-brand-navy text-white text-xs rounded-full h-4 w-4 flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </Button>
        )}
      </div>
    </div>
  )
}
