'use client'

import { describeError } from "@/lib/zod-errors";

import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Calculator } from 'lucide-react'
import { PageHeader } from '@/components/hr/shared/PageHeader'
import { useLocale } from '@/lib/i18n'
import { ConfirmDialog } from '@/components/hr/shared/ConfirmDialog'
import { Button } from '@/components/hr/ui/button'
import { Badge } from '@/components/hr/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/hr/ui/dialog'
import { Input } from '@/components/hr/ui/input'
import { Label } from '@/components/hr/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/hr/ui/select'
import { toast } from '@/components/hr/ui/toast'
import api from '@/lib/hr/api'

interface OvertimePolicy {
  id: number
  type_code: string
  name_en: string
  name_ar: string
  rate_multiplier: number
  min_hours: number
  max_hours_per_day: number
  max_hours_per_month: number
  requires_pre_approval: boolean
  approval_authority: string
}

interface PolicyFormData {
  type_code: string
  name_en: string
  name_ar: string
  rate_multiplier: string
  min_hours: string
  max_hours_day: string
  max_hours_month: string
  requires_pre_approval: boolean
  approval_authority: string
}

const EMPTY_FORM: PolicyFormData = {
  type_code: '', name_en: '', name_ar: '',
  rate_multiplier: '1.5', min_hours: '1',
  max_hours_day: '4', max_hours_month: '40',
  requires_pre_approval: true, approval_authority: 'team_lead',
}

const APPROVAL_OPTIONS = [
  { value: 'team_lead', label: 'Team Lead' },
  { value: 'hr', label: 'HR Manager' },
  { value: 'ceo', label: 'CEO' },
  { value: 'auto', label: 'Automatic' },
]

export default function OvertimePolicyPage() {
  const { locale } = useLocale()
  const isAr = locale === 'ar'
  const queryClient = useQueryClient()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editPolicy, setEditPolicy] = useState<OvertimePolicy | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<OvertimePolicy | null>(null)
  const [form, setForm] = useState<PolicyFormData>(EMPTY_FORM)
  const [calcSalary, setCalcSalary] = useState('10000')

  const { data, isLoading } = useQuery<OvertimePolicy[]>({
    queryKey: ['overtime-policies'],
    queryFn: async () => {
      const res = await api.get('/overtime/policies/')
      return Array.isArray(res.data) ? res.data : res.data.results ?? []
    },
  })
  const policies = data ?? []

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post('/overtime/policies/', payload),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['overtime-policies'] }); setDialogOpen(false); toast.success('Policy created') },
    onError: (__err: unknown) => toast.error(describeError(__err) || 'Failed to create policy'),
  })
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Record<string, unknown> }) => api.patch(`/overtime/policies/${id}/`, payload),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['overtime-policies'] }); setDialogOpen(false); toast.success('Policy updated') },
    onError: (__err: unknown) => toast.error(describeError(__err) || 'Failed to update policy'),
  })
  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/overtime/policies/${id}/`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['overtime-policies'] }); setDeleteTarget(null); toast.success('Policy deleted') },
    onError: (__err: unknown) => toast.error(describeError(__err) || 'Failed to delete policy'),
  })

  function openAdd() { setEditPolicy(null); setForm(EMPTY_FORM); setDialogOpen(true) }
  function openEdit(p: OvertimePolicy) {
    setEditPolicy(p)
    setForm({
      type_code: p.type_code, name_en: p.name_en, name_ar: p.name_ar,
      rate_multiplier: String(p.rate_multiplier), min_hours: String(p.min_hours),
      max_hours_day: String(p.max_hours_per_day), max_hours_month: String(p.max_hours_per_month),
      requires_pre_approval: p.requires_pre_approval, approval_authority: p.approval_authority,
    })
    setDialogOpen(true)
  }

  function buildPayload() {
    return {
      type_code: form.type_code, name_en: form.name_en, name_ar: form.name_ar,
      rate_multiplier: Number(form.rate_multiplier), min_hours: Number(form.min_hours),
      max_hours_per_day: Number(form.max_hours_day), max_hours_per_month: Number(form.max_hours_month),
      requires_pre_approval: form.requires_pre_approval, approval_authority: form.approval_authority,
    }
  }

  function handleSubmit() {
    const payload = buildPayload()
    if (editPolicy) { updateMutation.mutate({ id: editPolicy.id, payload }) }
    else { createMutation.mutate(payload) }
  }

  // Calculator: hourly rate = salary / 30 / 8
  const salaryNum = parseFloat(calcSalary) || 0
  const hourlyRate = salaryNum / 30 / 8

  const isSaving = createMutation.isPending || updateMutation.isPending

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overtime Policies"
        description="Configure overtime types, multipliers and approval requirements"
        breadcrumbs={[{ label: isAr ? 'الإعدادات' : 'Settings', href: '/settings' }, { label: isAr ? 'سياسة الإضافي' : 'Overtime Policy' }]}
        actions={
          <Button size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={openAdd}>
            <Plus className="h-4 w-4" />Add Policy
          </Button>
        }
      />

      {/* Hourly rate calculator */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <Calculator className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-800 mb-2">Sample Hourly Rate Calculator</p>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <label className="text-sm text-amber-700">Monthly Salary (EGP):</label>
                <Input
                  type="number" min={0}
                  className="w-32 h-8 text-sm bg-card"
                  value={calcSalary}
                  onChange={(e) => setCalcSalary(e.target.value)}
                />
              </div>
              <p className="text-sm text-amber-800">
                Hourly Rate = <strong>{salaryNum.toLocaleString()} / 30 / 8 = {hourlyRate.toFixed(2)} EGP/hr</strong>
              </p>
            </div>
            {policies.length > 0 && (
              <div className="flex flex-wrap gap-3 mt-2">
                {policies.map((p) => (
                  <span key={p.id} className="text-xs text-amber-700 bg-amber-100 px-2 py-1 rounded">
                    {p.name_en}: {(hourlyRate * p.rate_multiplier).toFixed(2)} EGP/hr ({p.rate_multiplier}x)
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {isLoading && (
        <div className="bg-card rounded-lg border border-border p-12 text-center text-muted-foreground">Loading...</div>
      )}

      {!isLoading && (
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                {['Type Code', 'Name EN', 'Name AR', 'Rate', 'Min Hrs', 'Max Hrs/Day', 'Max Hrs/Month', 'Pre-Approval', 'Approval By', ''].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {policies.map((p) => (
                <tr key={p.id} className="hover:bg-muted/50">
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{p.type_code}</td>
                  <td className="px-4 py-3 font-medium text-foreground">{p.name_en}</td>
                  <td className="px-4 py-3 text-foreground dir-rtl">{p.name_ar}</td>
                  <td className="px-4 py-3">
                    <span className="font-bold text-blue-700">{p.rate_multiplier}x</span>
                  </td>
                  <td className="px-4 py-3 text-foreground">{p.min_hours}h</td>
                  <td className="px-4 py-3 text-foreground">{p.max_hours_per_day}h</td>
                  <td className="px-4 py-3 text-foreground">{p.max_hours_per_month}h</td>
                  <td className="px-4 py-3">
                    <Badge variant={p.requires_pre_approval ? 'warning' : 'default'} className="text-xs">
                      {p.requires_pre_approval ? 'Required' : 'Not Required'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-foreground capitalize">{p.approval_authority}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon-sm" onClick={() => openEdit(p)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon-sm" className="text-red-500" onClick={() => setDeleteTarget(p)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {policies.length === 0 && (
            <div className="p-12 text-center text-muted-foreground">No overtime policies configured.</div>
          )}
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editPolicy ? 'Edit Overtime Policy' : 'Add Overtime Policy'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label>Type Code *</Label>
                <Input value={form.type_code} onChange={(e) => setForm((f) => ({ ...f, type_code: e.target.value }))} placeholder="e.g. WD" />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>Name (English) *</Label>
                <Input value={form.name_en} onChange={(e) => setForm((f) => ({ ...f, name_en: e.target.value }))} placeholder="Weekday Overtime" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Name (Arabic)</Label>
              <Input value={form.name_ar} onChange={(e) => setForm((f) => ({ ...f, name_ar: e.target.value }))} placeholder="اسم النوع" dir="rtl" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Rate Multiplier</Label>
                <Input type="number" step="0.25" min="1" max="5" value={form.rate_multiplier} onChange={(e) => setForm((f) => ({ ...f, rate_multiplier: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Min Hours</Label>
                <Input type="number" min={0.5} step={0.5} value={form.min_hours} onChange={(e) => setForm((f) => ({ ...f, min_hours: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Max Hours/Day</Label>
                <Input type="number" min={1} max={16} value={form.max_hours_day} onChange={(e) => setForm((f) => ({ ...f, max_hours_day: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Max Hours/Month</Label>
                <Input type="number" min={1} max={200} value={form.max_hours_month} onChange={(e) => setForm((f) => ({ ...f, max_hours_month: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Approval Authority</Label>
                <Select value={form.approval_authority} onValueChange={(v) => setForm((f) => ({ ...f, approval_authority: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{APPROVAL_OPTIONS.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.requires_pre_approval} onChange={(e) => setForm((f) => ({ ...f, requires_pre_approval: e.target.checked }))} className="h-4 w-4 rounded border-border" />
                  <span className="text-sm font-medium text-foreground">Requires Pre-Approval</span>
                </label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={isSaving}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={isSaving || !form.type_code || !form.name_en} loading={isSaving}>
              {editPolicy ? 'Save Changes' : 'Create Policy'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete Policy" description={`Delete "${deleteTarget?.name_en}" policy?`}
        confirmLabel="Delete" variant="destructive"
        onConfirm={() => deleteTarget && deleteMutation.mutateAsync(deleteTarget.id)}
        loading={deleteMutation.isPending}
      />
    </div>
  )
}
