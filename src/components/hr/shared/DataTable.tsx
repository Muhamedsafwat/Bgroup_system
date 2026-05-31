'use client'

import React, { useState, useMemo } from 'react'
import {
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/hr/ui/table'
import { Button } from '@/components/hr/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/hr/ui/select'
import { Skeleton } from '@/components/hr/ui/skeleton'
import { EmptyState } from './EmptyState'
import { cn } from '@/lib/hr/utils'

export interface Column<T> {
  key: keyof T | string
  header: string
  cell?: (row: T, index: number) => React.ReactNode
  sortable?: boolean
  className?: string
  headerClassName?: string
}

interface DataTableProps<T> {
  data: T[]
  columns: Column<T>[]
  loading?: boolean
  totalCount?: number
  page?: number
  pageSize?: number
  onPageChange?: (page: number) => void
  onPageSizeChange?: (size: number) => void
  onSort?: (key: string, direction: 'asc' | 'desc') => void
  sortKey?: string
  sortDirection?: 'asc' | 'desc'
  emptyTitle?: string
  emptyDescription?: string
  rowClassName?: (row: T) => string
  onRowClick?: (row: T) => void
  pageSizeOptions?: number[]
  className?: string
  stickyHeader?: boolean
  /** Opt in to a checkbox column for bulk-action workflows. */
  selectable?: boolean
  /** Selected row ids (controlled). */
  selectedIds?: Set<string>
  /** Called when the selection changes. */
  onSelectedIdsChange?: (next: Set<string>) => void
  /** Override how a row's id is read; defaults to `String(row.id)`. */
  getRowId?: (row: T) => string
}

const PAGE_SIZES = [10, 20, 50, 100]

export function DataTable<T extends { id?: number | string }>({
  data,
  columns,
  loading = false,
  totalCount,
  page = 1,
  pageSize = 20,
  onPageChange,
  onPageSizeChange,
  onSort,
  sortKey,
  sortDirection,
  // No defaults — EmptyState falls back to localized strings from t.states.
  emptyTitle,
  emptyDescription,
  rowClassName,
  onRowClick,
  pageSizeOptions = PAGE_SIZES,
  className,
  stickyHeader = true,
  selectable = false,
  selectedIds,
  onSelectedIdsChange,
  getRowId = (row) => String((row as { id?: unknown }).id ?? ""),
}: DataTableProps<T>) {
  const total = totalCount ?? data.length
  const totalPages = Math.ceil(total / pageSize)

  const startRecord = (page - 1) * pageSize + 1
  const endRecord = Math.min(page * pageSize, total)

  function handleSort(key: string) {
    if (!onSort) return
    if (sortKey === key) {
      onSort(key, sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      onSort(key, 'asc')
    }
  }

  function getCellValue(row: T, key: string): unknown {
    return (row as Record<string, unknown>)[key]
  }

  const selection = selectedIds ?? new Set<string>()
  const visibleIds = selectable ? data.map((r) => getRowId(r)).filter(Boolean) : []
  const allVisibleSelected =
    selectable && visibleIds.length > 0 && visibleIds.every((id) => selection.has(id))
  const someVisibleSelected =
    selectable && visibleIds.some((id) => selection.has(id)) && !allVisibleSelected

  function toggleAllVisible() {
    if (!onSelectedIdsChange) return
    const next = new Set(selection)
    if (allVisibleSelected) {
      visibleIds.forEach((id) => next.delete(id))
    } else {
      visibleIds.forEach((id) => next.add(id))
    }
    onSelectedIdsChange(next)
  }

  function toggleRow(id: string) {
    if (!onSelectedIdsChange) return
    const next = new Set(selection)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onSelectedIdsChange(next)
  }

  if (loading) {
    return (
      <div className={cn('rounded-lg border border-border bg-card overflow-hidden min-w-0', className)}>
        <div className="overflow-x-auto min-w-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                {selectable && <th className="px-4 py-3 w-10" />}
                {columns.map((col) => (
                  <th key={String(col.key)} className="px-4 py-3 text-left">
                    <Skeleton className="h-4 w-24" />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-border/60">
                  {selectable && <td className="px-4 py-3 w-10" />}
                  {columns.map((col) => (
                    <td key={String(col.key)} className="px-4 py-3">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  if (!loading && data.length === 0) {
    return (
      <div className={cn('rounded-lg border border-border bg-card', className)}>
        <EmptyState title={emptyTitle} description={emptyDescription} />
      </div>
    )
  }

  return (
    <div className={cn('rounded-lg border border-border bg-card overflow-hidden min-w-0', className)}>
      <div className="overflow-x-auto min-w-0">
        <table className="w-full caption-bottom text-sm">
          <thead className={cn('bg-muted/50 border-b border-border', stickyHeader && 'sticky top-0 z-10')}>
            <tr>
              {selectable && (
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    aria-label="Select all visible rows"
                    checked={allVisibleSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someVisibleSelected
                    }}
                    onChange={toggleAllVisible}
                    className="h-4 w-4 rounded border-border accent-primary"
                  />
                </th>
              )}
              {columns.map((col) => {
                const key = String(col.key)
                const isSorted = sortKey === key
                return (
                  <th
                    key={key}
                    className={cn(
                      'px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap',
                      col.sortable && 'cursor-pointer select-none hover:text-foreground',
                      col.headerClassName
                    )}
                    onClick={() => col.sortable && handleSort(key)}
                  >
                    <div className="flex items-center gap-1">
                      {col.header}
                      {col.sortable && (
                        <span className="text-muted-foreground">
                          {isSorted ? (
                            sortDirection === 'asc' ? (
                              <ChevronUp className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronDown className="h-3.5 w-3.5" />
                            )
                          ) : (
                            <ChevronsUpDown className="h-3.5 w-3.5" />
                          )}
                        </span>
                      )}
                    </div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {data.map((row, idx) => {
              const rowId = selectable ? getRowId(row) : ""
              const isSelected = selectable && rowId !== "" && selection.has(rowId)
              return (
              <tr
                key={row.id ?? idx}
                className={cn(
                  'hover:bg-muted/50 transition-colors',
                  onRowClick && 'cursor-pointer',
                  isSelected && 'bg-primary/5',
                  rowClassName?.(row)
                )}
                onClick={() => onRowClick?.(row)}
              >
                {selectable && (
                  <td
                    className="px-4 py-3 w-10"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (rowId) toggleRow(rowId)
                    }}
                  >
                    <input
                      type="checkbox"
                      aria-label="Select row"
                      checked={isSelected}
                      onChange={() => rowId && toggleRow(rowId)}
                      onClick={(e) => e.stopPropagation()}
                      className="h-4 w-4 rounded border-border accent-primary"
                    />
                  </td>
                )}
                {columns.map((col) => {
                  const key = String(col.key)
                  return (
                    <td
                      key={key}
                      className={cn('px-4 py-3 text-foreground align-middle', col.className)}
                    >
                      {col.cell
                        ? col.cell(row, idx)
                        : String(getCellValue(row, key) ?? '—')}
                    </td>
                  )
                })}
              </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {(onPageChange || onPageSizeChange) && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-border bg-card">
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span>
              {total > 0 ? `${startRecord}–${endRecord} of ${total.toLocaleString()} records` : 'No records'}
            </span>
            {onPageSizeChange && (
              <div className="flex items-center gap-2">
                <span>Rows:</span>
                <Select
                  value={String(pageSize)}
                  onValueChange={(v) => onPageSizeChange(Number(v))}
                >
                  <SelectTrigger className="h-7 w-16 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {pageSizeOptions.map((s) => (
                      <SelectItem key={s} value={String(s)}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {onPageChange && totalPages > 1 && (
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => onPageChange(1)}
                disabled={page === 1}
                title="First page"
              >
                <ChevronsLeft className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => onPageChange(page - 1)}
                disabled={page === 1}
                title="Previous page"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="px-3 py-1 text-sm text-foreground">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => onPageChange(page + 1)}
                disabled={page === totalPages}
                title="Next page"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => onPageChange(totalPages)}
                disabled={page === totalPages}
                title="Last page"
              >
                <ChevronsRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
