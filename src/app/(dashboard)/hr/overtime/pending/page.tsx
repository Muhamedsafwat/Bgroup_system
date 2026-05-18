'use client'

import { describeError } from "@/lib/zod-errors";

import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, X, Clock, DollarSign, ThumbsUp, ThumbsDown } from 'lucide-react'
import api from '@/lib/hr/api'
import { formatDate, formatCurrency, truncate } from '@/lib/hr/utils'
import { useLocale } from '@/lib/i18n'
import { PageHeader } from '@/components/hr/shared/PageHeader'
import { Button } from '@/components/hr/ui/button'
import { Badge } from '@/components/hr/ui/badge'
import { Skeleton } from '@/components/hr/ui/skeleton'
import { Textarea } from '@/components/hr/ui/textarea'
import { Label } from '@/components/hr/ui/label'
import { Checkbox } from '@/components/hr/ui/checkbox'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/hr/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/hr/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/hr/ui/table'
import { toast } from '@/components/hr/ui/toast'

interface OTRequest {
  id: number
  employee: number
  employee_name: string
  employee_id_str: string
  department_name: string
  date: string
  overtime_type: number
  overtime_type_name: string
  hours_requested: number
  reason: string
  evidence_url?: string
  calculated_amount: number
  status: 'pending' | 'approved' | 'denied'
  submitted_at: string
  created_at: string
}

interface OTSummary {
  total_pending: number
  approved_this_month_hours: number
  approved_this_month_amount: number
  denied_count: number
  budget_impact: number
}

function getStatusVariant(status: string): 'warning' | 'success' | 'danger' | 'default' {
  if (status === 'pending') return 'warning'
  if (status === 'approved') return 'success'
  if (status === 'denied') return 'danger'
  return 'default'
}

export default function OvertimePendingPage() {
  const { locale } = useLocale()
  const isAr = locale === "ar"
  const qc = useQueryClient()
  const [activeTab, setActiveTab] = useState<'pending' | 'approved' | 'denied'>('pending')
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [denyDialogId, setDenyDialogId] = useState<number | null>(null)
  const [bulkDenyDialog, setBulkDenyDialog] = useState(false)
  const [denyReason, setDenyReason] = useState('')

  const { data, isLoading, refetch } = useQuery<{ results: OTRequest[]; summary?: OTSummary }>({
    queryKey: ['overtime', 'requests', activeTab],
    queryFn: async () => {
      const res = await api.get('/overtime/requests/', { params: { status: activeTab } })
      return res.data
    },
  })

  const { data: summaryData } = useQuery<OTSummary>({
    queryKey: ['overtime', 'summary'],
    queryFn: async () => {
      const res = await api.get('/overtime/summary/')
      return res.data
    },
  })

  const approveMutation = useMutation({
    mutationFn: (id: number) => api.post(`/overtime/requests/${id}/approve/`),
    onSuccess: () => {
      toast.success('Overtime request approved')
      qc.invalidateQueries({ queryKey: ['overtime'] })
      setSelectedIds([])
    },
    onError: (__err: unknown) => toast.error(describeError(__err) || 'Failed to approve request'),
  })

  const denyMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      api.post(`/overtime/requests/${id}/deny/`, { denial_reason: reason }),
    onSuccess: () => {
      toast.success('Overtime request denied')
      qc.invalidateQueries({ queryKey: ['overtime'] })
      setDenyDialogId(null)
      setDenyReason('')
      setSelectedIds([])
    },
    onError: (__err: unknown) => toast.error(describeError(__err) || 'Failed to deny request'),
  })

  const bulkApproveMutation = useMutation({
    mutationFn: () => Promise.all(selectedIds.map(id => api.post(`/overtime/requests/${id}/approve/`))),
    onSuccess: () => {
      toast.success(`${selectedIds.length} requests approved`)
      qc.invalidateQueries({ queryKey: ['overtime'] })
      setSelectedIds([])
    },
    onError: (__err: unknown) => toast.error(describeError(__err) || 'Failed to approve requests'),
  })

  const bulkDenyMutation = useMutation({
    mutationFn: () => Promise.all(selectedIds.map(id => api.post(`/overtime/requests/${id}/deny/`, { denial_reason: denyReason }))),
    onSuccess: () => {
      toast.success(`${selectedIds.length} requests denied`)
      qc.invalidateQueries({ queryKey: ['overtime'] })
      setBulkDenyDialog(false)
      setDenyReason('')
      setSelectedIds([])
    },
    onError: (__err: unknown) => toast.error(describeError(__err) || 'Failed to deny requests'),
  })

  const requests: OTRequest[] = Array.isArray(data) ? data : data?.results ?? []

  function toggleSelect(id: number) {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    )
  }

  function toggleSelectAll() {
    if (selectedIds.length === requests.length) setSelectedIds([])
    else setSelectedIds(requests.map(r => r.id))
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={isAr ? "قائمة اعتماد الساعات الإضافية" : "Overtime Approval Queue"}
        description="Review and approve or deny overtime requests"
        breadcrumbs={[
          { label: isAr ? "الساعات الإضافية" : "Overtime" },
          { label: isAr ? "قائمة الاعتماد" : "Approval Queue" },
        ]}
      />

      {/* Summary Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
            <Clock className="h-4 w-4" /> {isAr ? "إجمالي قيد الانتظار" : "Total Pending"}
          </div>
          <p className="text-2xl font-bold text-amber-600">{summaryData?.total_pending ?? 0}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
            <ThumbsUp className="h-4 w-4" /> {isAr ? "معتمد هذا الشهر" : "Approved This Month"}
          </div>
          <p className="text-2xl font-bold text-emerald-600">{summaryData?.approved_this_month_hours?.toFixed(1) ?? 0}h</p>
          <p className="text-xs text-muted-foreground">{formatCurrency(summaryData?.approved_this_month_amount ?? 0)}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
            <ThumbsDown className="h-4 w-4" /> {isAr ? "مرفوض" : "Denied"}
          </div>
          <p className="text-2xl font-bold text-red-600">{summaryData?.denied_count ?? 0}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
            <DollarSign className="h-4 w-4" /> {isAr ? "أثر الميزانية" : "Budget Impact"}
          </div>
          <p className="text-2xl font-bold text-blue-600">{formatCurrency(summaryData?.budget_impact ?? 0)}</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={v => { setActiveTab(v as typeof activeTab); setSelectedIds([]) }}>
        <TabsList className="border-b border-border bg-transparent p-0 h-auto mb-4">
          {(['pending', 'approved', 'denied'] as const).map(tab => {
            const tabLabel = isAr
              ? { pending: "قيد الانتظار", approved: "معتمد", denied: "مرفوض" }[tab]
              : { pending: "Pending", approved: "Approved", denied: "Denied" }[tab];
            return (
              <TabsTrigger
                key={tab}
                value={tab}
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-brand-navy data-[state=active]:text-brand-navy pb-3 px-4"
              >
                {tabLabel}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {(['pending', 'approved', 'denied'] as const).map(tab => (
          <TabsContent key={tab} value={tab}>
            {/* Bulk Actions (Pending only) */}
            {tab === 'pending' && selectedIds.length > 0 && (
              <div className="flex items-center gap-3 mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <span className="text-sm text-blue-700 font-medium">{selectedIds.length} selected</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2 text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                  onClick={() => bulkApproveMutation.mutate()}
                  loading={bulkApproveMutation.isPending}
                >
                  <Check className="h-3.5 w-3.5" /> Approve Selected
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2 text-red-700 border-red-300 hover:bg-red-50"
                  onClick={() => setBulkDenyDialog(true)}
                >
                  <X className="h-3.5 w-3.5" /> Deny Selected
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelectedIds([])}>
                  Clear
                </Button>
              </div>
            )}

            <div className="bg-card rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    {tab === 'pending' && (
                      <TableHead className="w-10">
                        <Checkbox
                          checked={selectedIds.length === requests.length && requests.length > 0}
                          onCheckedChange={toggleSelectAll}
                        />
                      </TableHead>
                    )}
                    <TableHead className="font-semibold">{isAr ? "التاريخ" : "Date"}</TableHead>
                    <TableHead className="font-semibold">{isAr ? "الموظف" : "Employee"}</TableHead>
                    <TableHead className="font-semibold">{isAr ? "القسم" : "Department"}</TableHead>
                    <TableHead className="font-semibold">{isAr ? "نوع الإضافي" : "OT Type"}</TableHead>
                    <TableHead className="font-semibold">{isAr ? "ساعات" : "Hours"}</TableHead>
                    <TableHead className="font-semibold">{isAr ? "السبب" : "Reason"}</TableHead>
                    <TableHead className="font-semibold">{isAr ? "إثبات" : "Evidence"}</TableHead>
                    <TableHead className="font-semibold">{isAr ? "المبلغ" : "Amount"}</TableHead>
                    <TableHead className="font-semibold">{isAr ? "تاريخ التقديم" : "Submitted"}</TableHead>
                    {tab === 'pending' && <TableHead className="font-semibold text-center">{isAr ? "إجراءات" : "Actions"}</TableHead>}
                    {tab !== 'pending' && <TableHead className="font-semibold">{isAr ? "الحالة" : "Status"}</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: tab === 'pending' ? 11 : 10 }).map((_, j) => (
                          <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : requests.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={tab === 'pending' ? 11 : 10} className="text-center py-12 text-muted-foreground">
                        No {tab} requests found
                      </TableCell>
                    </TableRow>
                  ) : (
                    requests.map(req => (
                      <TableRow key={req.id} className="hover:bg-muted/50">
                        {tab === 'pending' && (
                          <TableCell>
                            <Checkbox
                              checked={selectedIds.includes(req.id)}
                              onCheckedChange={() => toggleSelect(req.id)}
                            />
                          </TableCell>
                        )}
                        <TableCell>{formatDate(req.date)}</TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium">{req.employee_name}</p>
                            <p className="text-xs text-muted-foreground">{req.employee_id_str}</p>
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{req.department_name}</TableCell>
                        <TableCell>
                          <span className="text-xs px-2 py-0.5 rounded bg-muted text-foreground capitalize">
                            {req.overtime_type_name ?? String(req.overtime_type)}
                          </span>
                        </TableCell>
                        <TableCell className="font-medium">{req.hours_requested}h</TableCell>
                        <TableCell className="max-w-[180px]">
                          <span title={req.reason} className="cursor-help">
                            {truncate(req.reason, 60)}
                          </span>
                        </TableCell>
                        <TableCell>
                          {req.evidence_url ? (
                            <a href={req.evidence_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-sm">
                              View
                            </a>
                          ) : (
                            <span className="text-muted-foreground text-sm">—</span>
                          )}
                        </TableCell>
                        <TableCell className="font-medium text-emerald-700">
                          {formatCurrency(req.calculated_amount)}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {formatDate(req.created_at ?? req.submitted_at)}
                        </TableCell>
                        {tab === 'pending' && (
                          <TableCell>
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={() => approveMutation.mutate(req.id)}
                                disabled={approveMutation.isPending}
                                title="Approve"
                                className="h-8 w-8 rounded-full bg-emerald-50 hover:bg-emerald-100 text-emerald-700 flex items-center justify-center transition-colors"
                              >
                                <Check className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => { setDenyDialogId(req.id); setDenyReason('') }}
                                title="Deny"
                                className="h-8 w-8 rounded-full bg-red-50 hover:bg-red-100 text-red-700 flex items-center justify-center transition-colors"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          </TableCell>
                        )}
                        {tab !== 'pending' && (
                          <TableCell>
                            <Badge variant={getStatusVariant(req.status)}>
                              {req.status}
                            </Badge>
                          </TableCell>
                        )}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        ))}
      </Tabs>

      {/* Deny Single Dialog */}
      <Dialog open={!!denyDialogId} onOpenChange={open => { if (!open) setDenyDialogId(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Deny Overtime Request</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label>Reason for denial *</Label>
            <Textarea
              value={denyReason}
              onChange={e => setDenyReason(e.target.value)}
              placeholder="Provide a reason for denying this request..."
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDenyDialogId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => denyMutation.mutate({ id: denyDialogId!, reason: denyReason })}
              loading={denyMutation.isPending}
              disabled={!denyReason.trim()}
            >
              Deny Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Deny Dialog */}
      <Dialog open={bulkDenyDialog} onOpenChange={setBulkDenyDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Deny {selectedIds.length} Requests</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label>Reason for denial *</Label>
            <Textarea
              value={denyReason}
              onChange={e => setDenyReason(e.target.value)}
              placeholder="Provide a reason for denying these requests..."
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDenyDialog(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => bulkDenyMutation.mutate()}
              loading={bulkDenyMutation.isPending}
              disabled={!denyReason.trim()}
            >
              Deny {selectedIds.length} Requests
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
