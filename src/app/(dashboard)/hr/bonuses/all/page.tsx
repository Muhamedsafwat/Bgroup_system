'use client'

import { describeError } from "@/lib/zod-errors";

import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/hr/api'
import { formatDate, formatCurrency } from '@/lib/hr/utils'
import { PageHeader } from '@/components/hr/shared/PageHeader'
import { ExportButton } from '@/components/hr/shared/ExportButton'
import { Button } from '@/components/hr/ui/button'
import { Input } from '@/components/hr/ui/input'
import { Label } from '@/components/hr/ui/label'
import { Badge } from '@/components/hr/ui/badge'
import { Skeleton } from '@/components/hr/ui/skeleton'
import { Textarea } from '@/components/hr/ui/textarea'
import { Separator } from '@/components/hr/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/hr/ui/dialog'
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
import { toast } from '@/components/hr/ui/toast'

interface Bonus {
  id: number
  employee: number
  employee_name: string
  employee_id_str: string
  company_name: string
  department_name: string
  category_name: string
  bonus_rule_name: string
  bonus_amount: number
  status: string
  bonus_date: string
  reason?: string
  submitted_by_name: string
  approved_by_name?: string
  dismissed_reason?: string
  evidence_files?: { id: number; url: string; name: string }[]
  created_at: string
}

function getStatusVariant(status: string): 'warning' | 'success' | 'danger' | 'default' | 'info' {
  const map: Record<string, 'warning' | 'success' | 'danger' | 'default' | 'info'> = {
    pending: 'warning',
    applied: 'success',
    dismissed: 'default',
  }
  return map[status] ?? 'default'
}

export default function AllBonusesPage() {
  const qc = useQueryClient()
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [company, setCompany] = useState('')
  const [department, setDepartment] = useState('')
  const [employeeSearch, setEmployeeSearch] = useState('')
  const [status, setStatus] = useState('')
  const [detailOpen, setDetailOpen] = useState(false)
  const [selectedBonus, setSelectedBonus] = useState<Bonus | null>(null)
  const [dismissReason, setDismissReason] = useState('')
  const [dismissMode, setDismissMode] = useState(false)

  const { data: companiesData } = useQuery({
    queryKey: ['companies'],
    queryFn: async () => (await api.get('/companies/')).data,
  })

  const { data: departmentsData } = useQuery({
    queryKey: ['departments', company],
    queryFn: async () => (await api.get('/departments/', { params: company ? { company } : {} })).data,
  })

  const { data, isLoading } = useQuery({
    queryKey: ['bonuses', 'all', dateFrom, dateTo, company, department, employeeSearch, status],
    queryFn: async () => {
      const res = await api.get('/bonuses/bonuses/', {
        params: {
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          company: company || undefined,
          department: department || undefined,
          search: employeeSearch || undefined,
          status: status || undefined,
        },
      })
      return res.data
    },
  })

  const dismissMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      api.post(`/bonuses/bonuses/${id}/dismiss/`, { dismissed_reason: reason }),
    onSuccess: () => {
      toast.success('Bonus dismissed')
      qc.invalidateQueries({ queryKey: ['bonuses'] })
      setDetailOpen(false)
      setDismissMode(false)
      setDismissReason('')
    },
    onError: (__err: unknown) => toast.error(describeError(__err) || 'Failed to dismiss bonus'),
  })

  const companies = Array.isArray(companiesData) ? companiesData : companiesData?.results ?? []
  const departments = Array.isArray(departmentsData) ? departmentsData : departmentsData?.results ?? []
  const bonuses: Bonus[] = Array.isArray(data) ? data : data?.results ?? []

  function openDetail(bonus: Bonus) {
    setSelectedBonus(bonus)
    setDismissMode(false)
    setDismissReason('')
    setDetailOpen(true)
  }

  async function handleExportExcel() {
    const res = await api.get('/reports/bonuses-excel/', {
      params: {
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        company: company || undefined,
        department: department || undefined,
        search: employeeSearch || undefined,
        status: status || undefined,
      },
      responseType: 'blob',
    })
    return res.data
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="All Bonuses"
        description="View and manage all awarded bonuses"
        breadcrumbs={[{ label: 'Bonuses' }, { label: 'All Bonuses' }]}
        actions={
          <ExportButton
            onExportExcel={handleExportExcel}
            filename="bonuses-report"
            label="Export Excel"
          />
        }
      />

      {/* Filters */}
      <div className="bg-card p-4 rounded-lg border border-border flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <Label>Date From</Label>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-36" />
        </div>
        <div className="space-y-1">
          <Label>Date To</Label>
          <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-36" />
        </div>
        <div className="space-y-1">
          <Label>Company</Label>
          <Select value={company} onValueChange={v => { setCompany(v === 'all' ? '' : v); setDepartment('') }}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All" />
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
          <Label>Department</Label>
          <Select value={department} onValueChange={v => setDepartment(v === 'all' ? '' : v)}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All" />
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
          <Label>Employee</Label>
          <Input
            placeholder="Search..."
            value={employeeSearch}
            onChange={e => setEmployeeSearch(e.target.value)}
            className="w-40"
          />
        </div>
        <div className="space-y-1">
          <Label>Status</Label>
          <Select value={status} onValueChange={v => setStatus(v === 'all' ? '' : v)}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="applied">Applied</SelectItem>
              <SelectItem value="dismissed">Dismissed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-card rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="font-semibold">Date</TableHead>
              <TableHead className="font-semibold">Employee</TableHead>
              <TableHead className="font-semibold">Company</TableHead>
              <TableHead className="font-semibold">Category</TableHead>
              <TableHead className="font-semibold">Bonus Name</TableHead>
              <TableHead className="font-semibold text-right">Amount</TableHead>
              <TableHead className="font-semibold">Status</TableHead>
              <TableHead className="font-semibold">Submitted By</TableHead>
              <TableHead className="font-semibold">Approved By</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 9 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : bonuses.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">
                  No bonuses found
                </TableCell>
              </TableRow>
            ) : (
              bonuses.map(bonus => (
                <TableRow
                  key={bonus.id}
                  className="hover:bg-muted/50 cursor-pointer"
                  onClick={() => openDetail(bonus)}
                >
                  <TableCell>{formatDate(bonus.bonus_date)}</TableCell>
                  <TableCell>
                    <div>
                      <p className="font-medium">{bonus.employee_name}</p>
                      <p className="text-xs text-muted-foreground">{bonus.employee_id_str}</p>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">{bonus.company_name}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{bonus.category_name}</TableCell>
                  <TableCell className="text-sm">{bonus.bonus_rule_name}</TableCell>
                  <TableCell className="text-right font-semibold text-emerald-700">
                    {formatCurrency(bonus.bonus_amount)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={getStatusVariant(bonus.status)}>
                      {bonus.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{bonus.submitted_by_name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{bonus.approved_by_name ?? '—'}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Detail Modal */}
      <Dialog open={detailOpen} onOpenChange={open => { setDetailOpen(open); if (!open) setDismissMode(false) }}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Bonus Details — #{selectedBonus?.id}</DialogTitle>
          </DialogHeader>

          {selectedBonus && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Employee</p>
                  <p className="font-medium">{selectedBonus.employee_name}</p>
                  <p className="text-muted-foreground text-xs">{selectedBonus.employee_id_str}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Department / Company</p>
                  <p>{selectedBonus.department_name}</p>
                  <p className="text-muted-foreground text-xs">{selectedBonus.company_name}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Category</p>
                  <p>{selectedBonus.category_name}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Bonus Type</p>
                  <p>{selectedBonus.bonus_rule_name}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Amount</p>
                  <p className="font-bold text-emerald-700 text-lg">{formatCurrency(selectedBonus.bonus_amount)}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Status</p>
                  <Badge variant={getStatusVariant(selectedBonus.status)}>{selectedBonus.status}</Badge>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Bonus Date</p>
                  <p>{formatDate(selectedBonus.bonus_date)}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Submitted By</p>
                  <p>{selectedBonus.submitted_by_name}</p>
                </div>
                {selectedBonus.approved_by_name && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Approved By</p>
                    <p>{selectedBonus.approved_by_name}</p>
                  </div>
                )}
              </div>

              {selectedBonus.reason && (
                <>
                  <Separator />
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Reason</p>
                    <p className="text-sm text-foreground bg-muted/50 p-3 rounded">{selectedBonus.reason}</p>
                  </div>
                </>
              )}

              {selectedBonus.evidence_files && selectedBonus.evidence_files.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Supporting Files</p>
                    <div className="space-y-1.5">
                      {selectedBonus.evidence_files.map(file => (
                        <a
                          key={file.id}
                          href={file.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 text-sm text-blue-600 hover:underline"
                        >
                          <span className="text-blue-400">📎</span>
                          {file.name}
                        </a>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {selectedBonus.dismissed_reason && (
                <div className="p-3 rounded bg-muted/50 border border-border text-sm">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Cancellation Reason</p>
                  <p className="text-foreground">{selectedBonus.dismissed_reason}</p>
                </div>
              )}

              {/* Dismiss Section */}
              {selectedBonus.status === 'pending' && (
                <>
                  <Separator />
                  {dismissMode ? (
                    <div className="space-y-3">
                      <Label>Reason for cancellation *</Label>
                      <Textarea
                        value={dismissReason}
                        onChange={e => setDismissReason(e.target.value)}
                        placeholder="Provide a reason for cancelling this bonus..."
                        rows={3}
                      />
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => setDismissMode(false)}>Back</Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => dismissMutation.mutate({ id: selectedBonus.id, reason: dismissReason })}
                          loading={dismissMutation.isPending}
                          disabled={!dismissReason.trim()}
                        >
                          Confirm Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red-600 border-red-200 hover:bg-red-50"
                      onClick={() => setDismissMode(true)}
                    >
                      Cancel Bonus
                    </Button>
                  )}
                </>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
