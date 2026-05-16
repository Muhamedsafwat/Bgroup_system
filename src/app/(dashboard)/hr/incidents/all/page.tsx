'use client'

import { describeError } from "@/lib/zod-errors";

import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/hr/api'
import { useAuth } from '@/contexts/hr/AuthContext'
import { formatDate, formatCurrency, cn } from '@/lib/hr/utils'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { PageHeader } from '@/components/hr/shared/PageHeader'
import { ExportButton } from '@/components/hr/shared/ExportButton'
import { Button } from '@/components/hr/ui/button'
import { Input } from '@/components/hr/ui/input'
import { Label } from '@/components/hr/ui/label'
import { Badge } from '@/components/hr/ui/badge'
import { Skeleton } from '@/components/hr/ui/skeleton'
import { Textarea } from '@/components/hr/ui/textarea'
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
import { Separator } from '@/components/hr/ui/separator'

interface Incident {
  id: number
  employee: number
  employee_name: string
  employee_id_str: string
  company_name: string
  department_name: string
  category_name: string
  violation_rule_name: string
  offense_number: number
  action_taken: string
  deduction_amount: number
  status: string
  incident_date: string
  comments: string
  reported_by_name: string
  approved_by_name?: string
  dismissed_reason?: string
  evidence?: string | null
  approval_history?: { date: string; action: string; by: string; note?: string }[]
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

function getStatusLabel(status: string) {
  const map: Record<string, string> = {
    pending: 'Pending',
    applied: 'Applied',
    dismissed: 'Dismissed',
  }
  return map[status] ?? status
}

export default function AllIncidentsPage() {
  const qc = useQueryClient()
  const { roles } = useAuth()
  const canApproveOrDismiss = roles.some(r => ['super_admin', 'hr_manager', 'ceo', 'accountant'].includes(r))
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [company, setCompany] = useState('')
  const [department, setDepartment] = useState('')
  const [employeeSearch, setEmployeeSearch] = useState('')
  const [category, setCategory] = useState('')
  const [status, setStatus] = useState('')
  const [detailOpen, setDetailOpen] = useState(false)
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null)
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

  const { data: categoriesData } = useQuery({
    queryKey: ['incidents', 'violation-categories'],
    queryFn: async () => {
      const res = await api.get('/incidents/violation-categories/')
      return Array.isArray(res.data) ? res.data : res.data.results ?? []
    },
  })

  const { data, isLoading } = useQuery({
    queryKey: ['incidents', 'all', dateFrom, dateTo, company, department, employeeSearch, category, status],
    queryFn: async () => {
      const res = await api.get('/incidents/incidents/', {
        params: {
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          company: company || undefined,
          department: department || undefined,
          search: employeeSearch || undefined,
          category: category || undefined,
          status: status || undefined,
        },
      })
      return res.data
    },
  })

  const approveMutation = useMutation({
    mutationFn: (id: number) => api.post(`/incidents/incidents/${id}/apply/`),
    onSuccess: () => {
      toast.success('Incident approved and applied')
      qc.invalidateQueries({ queryKey: ['incidents'] })
      setDetailOpen(false)
    },
    onError: (__err: unknown) => toast.error(describeError(__err) || 'Failed to approve incident'),
  })

  const dismissMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      api.post(`/incidents/incidents/${id}/dismiss/`, { dismissed_reason: reason }),
    onSuccess: () => {
      toast.success('Incident dismissed')
      qc.invalidateQueries({ queryKey: ['incidents'] })
      setDetailOpen(false)
      setDismissMode(false)
      setDismissReason('')
    },
    onError: (__err: unknown) => toast.error(describeError(__err) || 'Failed to dismiss incident'),
  })

  const companies = Array.isArray(companiesData) ? companiesData : companiesData?.results ?? []
  const departments = Array.isArray(departmentsData) ? departmentsData : departmentsData?.results ?? []
  const categoryList = Array.isArray(categoriesData) ? categoriesData : []
  const incidents: Incident[] = Array.isArray(data) ? data : data?.results ?? []

  function openDetail(incident: Incident) {
    setSelectedIncident(incident)
    setDismissMode(false)
    setDismissReason('')
    setDetailOpen(true)
  }

  async function handleExportExcel() {
    const res = await api.get('/reports/incidents-excel/', {
      params: {
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        company: company || undefined,
        department: department || undefined,
        search: employeeSearch || undefined,
        category: category || undefined,
        status: status || undefined,
      },
      responseType: 'blob',
    })
    return res.data
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="All Incidents"
        description="View and manage all disciplinary incidents"
        breadcrumbs={[{ label: 'Incidents' }, { label: 'All Incidents' }]}
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/hr/incidents/submit"
              className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 h-9 text-sm font-medium hover:opacity-90"
            >
              <Plus className="h-4 w-4" />
              Add incident
            </Link>
            <ExportButton
              onExportExcel={handleExportExcel}
              filename="incidents-report"
              label="Export Excel"
            />
          </div>
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
          <Label>Category</Label>
          <Select value={category} onValueChange={v => setCategory(v === 'all' ? '' : v)}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categoryList.map((c: { id: number; name: string }) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
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
              <TableHead className="font-semibold">Violation</TableHead>
              <TableHead className="font-semibold text-center">Offense #</TableHead>
              <TableHead className="font-semibold">Action</TableHead>
              <TableHead className="font-semibold text-right">Amount</TableHead>
              <TableHead className="font-semibold">Status</TableHead>
              <TableHead className="font-semibold">Reported By</TableHead>
              <TableHead className="font-semibold">Approved By</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 11 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : incidents.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center py-12 text-muted-foreground">
                  No incidents found
                </TableCell>
              </TableRow>
            ) : (
              incidents.map(inc => (
                <TableRow
                  key={inc.id}
                  className="hover:bg-muted/50 cursor-pointer"
                  onClick={() => openDetail(inc)}
                >
                  <TableCell>{formatDate(inc.incident_date)}</TableCell>
                  <TableCell>
                    <div>
                      <p className="font-medium">{inc.employee_name}</p>
                      <p className="text-xs text-muted-foreground">{inc.employee_id_str}</p>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">{inc.company_name}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{inc.category_name}</TableCell>
                  <TableCell className="text-sm max-w-[160px] truncate">{inc.violation_rule_name}</TableCell>
                  <TableCell className="text-center font-semibold">{inc.offense_number}</TableCell>
                  <TableCell>
                    <span className="text-xs capitalize">{inc.action_taken?.replace(/_/g, ' ')}</span>
                  </TableCell>
                  <TableCell className="text-right font-semibold text-red-700">
                    {formatCurrency(inc.deduction_amount)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={getStatusVariant(inc.status)}>
                      {getStatusLabel(inc.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{inc.reported_by_name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{inc.approved_by_name ?? '—'}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Detail Modal */}
      <Dialog open={detailOpen} onOpenChange={open => { setDetailOpen(open); if (!open) setDismissMode(false) }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Incident Details — #{selectedIncident?.id}</DialogTitle>
          </DialogHeader>

          {selectedIncident && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Employee</p>
                  <p className="font-medium">{selectedIncident.employee_name}</p>
                  <p className="text-muted-foreground text-xs">{selectedIncident.employee_id_str}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Department / Company</p>
                  <p>{selectedIncident.department_name}</p>
                  <p className="text-muted-foreground text-xs">{selectedIncident.company_name}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Category</p>
                  <p>{selectedIncident.category_name}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Violation</p>
                  <p>{selectedIncident.violation_rule_name}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Offense Number</p>
                  <p className="font-semibold">{selectedIncident.offense_number}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Action Taken</p>
                  <p className="capitalize">{selectedIncident.action_taken?.replace(/_/g, ' ')}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Deduction Amount</p>
                  <p className="font-bold text-red-700">{formatCurrency(selectedIncident.deduction_amount)}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Status</p>
                  <Badge variant={getStatusVariant(selectedIncident.status)}>{getStatusLabel(selectedIncident.status)}</Badge>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Incident Date</p>
                  <p>{formatDate(selectedIncident.incident_date)}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Reported By</p>
                  <p>{selectedIncident.reported_by_name}</p>
                </div>
                {selectedIncident.approved_by_name && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Approved By</p>
                    <p>{selectedIncident.approved_by_name}</p>
                  </div>
                )}
              </div>

              <Separator />

              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Comments</p>
                <p className="text-sm text-foreground bg-muted/50 p-3 rounded">{selectedIncident.comments}</p>
              </div>

              {selectedIncident.evidence && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Evidence File</p>
                  <a
                    href={selectedIncident.evidence}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-blue-600 hover:underline"
                  >
                    <span className="text-blue-400">📎</span>
                    View Evidence
                  </a>
                </div>
              )}

              {selectedIncident.approval_history && selectedIncident.approval_history.length > 0 && (
                <div>
                  <Separator />
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 mt-4">Approval History</p>
                  <div className="space-y-2">
                    {selectedIncident.approval_history.map((h, i) => (
                      <div key={i} className="flex items-start gap-3 text-sm">
                        <span className="text-muted-foreground shrink-0 text-xs mt-0.5">{formatDate(h.date)}</span>
                        <span className="font-medium capitalize">{h.action}</span>
                        <span className="text-muted-foreground">by {h.by}</span>
                        {h.note && <span className="text-muted-foreground italic">— {h.note}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedIncident.dismissed_reason && (
                <div className="p-3 rounded bg-muted/50 border border-border text-sm">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Dismissal Reason</p>
                  <p className="text-foreground">{selectedIncident.dismissed_reason}</p>
                </div>
              )}

              {/* Actions Section — only for authorised roles on pending incidents */}
              {canApproveOrDismiss && selectedIncident.status === 'pending' && (
                <>
                  <Separator />
                  {dismissMode ? (
                    <div className="space-y-3">
                      <Label>Reason for dismissal *</Label>
                      <Textarea
                        value={dismissReason}
                        onChange={e => setDismissReason(e.target.value)}
                        placeholder="Provide a reason for dismissing this incident..."
                        rows={3}
                      />
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => setDismissMode(false)}>Cancel</Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => dismissMutation.mutate({ id: selectedIncident.id, reason: dismissReason })}
                          loading={dismissMutation.isPending}
                          disabled={!dismissReason.trim()}
                        >
                          Confirm Dismiss
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="bg-emerald-600 hover:bg-emerald-700 text-white"
                        onClick={() => approveMutation.mutate(selectedIncident.id)}
                        loading={approveMutation.isPending}
                      >
                        Approve & Apply
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-red-600 border-red-200 hover:bg-red-50"
                        onClick={() => setDismissMode(true)}
                      >
                        Dismiss Incident
                      </Button>
                    </div>
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
