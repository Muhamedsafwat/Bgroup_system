'use client'

import { describeError } from "@/lib/zod-errors";

import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/hr/shared/PageHeader'
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
import { toast } from '@/components/hr/ui/toast'
import api from '@/lib/hr/api'

interface LeaveType {
  id: number
  name_en: string
  annual_days: number
  is_paid: boolean
  carry_over_allowed: boolean
  max_carry_over_days: number | null
}

interface LeaveFormData {
  name: string
  annual_days: string
  is_paid: boolean
  carry_over_allowed: boolean
  max_carry_over_days: string
}

const EMPTY_FORM: LeaveFormData = {
  name: '', annual_days: '21', is_paid: true, carry_over_allowed: false, max_carry_over_days: '',
}

export default function LeavePolicyPage() {
  const queryClient = useQueryClient()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editLeave, setEditLeave] = useState<LeaveType | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<LeaveType | null>(null)
  const [form, setForm] = useState<LeaveFormData>(EMPTY_FORM)

  const { data, isLoading } = useQuery<LeaveType[]>({
    queryKey: ['leave-types'],
    queryFn: async () => {
      const res = await api.get('/attendance/leave-types/')
      return Array.isArray(res.data) ? res.data : res.data.results ?? []
    },
  })
  const leaveTypes = data ?? []

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post('/attendance/leave-types/', payload),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['leave-types'] }); setDialogOpen(false); toast.success('Leave type created') },
    onError: (__err: unknown) => toast.error(describeError(__err) || 'Failed to create leave type'),
  })
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Record<string, unknown> }) =>
      api.patch(`/attendance/leave-types/${id}/`, payload),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['leave-types'] }); setDialogOpen(false); toast.success('Leave type updated') },
    onError: (__err: unknown) => toast.error(describeError(__err) || 'Failed to update leave type'),
  })
  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/attendance/leave-types/${id}/`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['leave-types'] }); setDeleteTarget(null); toast.success('Leave type deleted') },
    onError: (__err: unknown) => toast.error(describeError(__err) || 'Failed to delete leave type'),
  })

  function openAdd() { setEditLeave(null); setForm(EMPTY_FORM); setDialogOpen(true) }
  function openEdit(lt: LeaveType) {
    setEditLeave(lt)
    setForm({
      name: lt.name_en, annual_days: String(lt.annual_days), is_paid: lt.is_paid,
      carry_over_allowed: lt.carry_over_allowed,
      max_carry_over_days: lt.max_carry_over_days != null ? String(lt.max_carry_over_days) : '',
    })
    setDialogOpen(true)
  }

  function buildPayload() {
    return {
      name_en: form.name,
      annual_days: Number(form.annual_days),
      is_paid: form.is_paid,
      carry_over_allowed: form.carry_over_allowed,
      max_carry_over_days: form.carry_over_allowed && form.max_carry_over_days ? Number(form.max_carry_over_days) : null,
    }
  }

  function handleSubmit() {
    const payload = buildPayload()
    if (editLeave) { updateMutation.mutate({ id: editLeave.id, payload }) }
    else { createMutation.mutate(payload) }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leave Policy"
        description="Configure leave types, entitlements and carry-over rules"
        breadcrumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Leave Policy' }]}
        actions={
          <Button size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={openAdd}>
            <Plus className="h-4 w-4" />Add Leave Type
          </Button>
        }
      />

      {isLoading && (
        <div className="bg-card rounded-lg border border-border p-12 text-center text-muted-foreground">Loading...</div>
      )}

      {!isLoading && (
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                {['Leave Type', 'Annual Days', 'Paid', 'Carry Over', 'Max Carry Over Days', ''].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {leaveTypes.map((lt) => (
                <tr key={lt.id} className="hover:bg-muted/50 transition-colors">
                  <td className="px-4 py-3 font-medium text-foreground">{lt.name_en}</td>
                  <td className="px-4 py-3 text-foreground">{lt.annual_days} days</td>
                  <td className="px-4 py-3">
                    <Badge variant={lt.is_paid ? 'success' : 'default'} className="text-xs">
                      {lt.is_paid ? 'Paid' : 'Unpaid'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={lt.carry_over_allowed ? 'info' : 'default'} className="text-xs">
                      {lt.carry_over_allowed ? 'Allowed' : 'Not Allowed'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-foreground">
                    {lt.carry_over_allowed
                      ? lt.max_carry_over_days != null
                        ? `${lt.max_carry_over_days} days`
                        : 'Unlimited'
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon-sm" onClick={() => openEdit(lt)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon-sm" className="text-red-500" onClick={() => setDeleteTarget(lt)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {leaveTypes.length === 0 && (
            <div className="p-12 text-center text-muted-foreground">No leave types configured.</div>
          )}
        </div>
      )}

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editLeave ? 'Edit Leave Type' : 'Add Leave Type'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Leave Type Name *</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Annual Leave, Sick Leave" />
            </div>
            <div className="space-y-1.5">
              <Label>Annual Days *</Label>
              <Input type="number" min={0} max={365} value={form.annual_days} onChange={(e) => setForm((f) => ({ ...f, annual_days: e.target.value }))} />
            </div>
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.is_paid} onChange={(e) => setForm((f) => ({ ...f, is_paid: e.target.checked }))} className="h-4 w-4 rounded border-border text-emerald-600" />
                <span className="text-sm font-medium text-foreground">Paid Leave</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.carry_over_allowed} onChange={(e) => setForm((f) => ({ ...f, carry_over_allowed: e.target.checked }))} className="h-4 w-4 rounded border-border text-blue-600" />
                <span className="text-sm font-medium text-foreground">Carry Over Allowed</span>
              </label>
            </div>
            {form.carry_over_allowed && (
              <div className="space-y-1.5">
                <Label>Max Carry Over Days (leave blank for unlimited)</Label>
                <Input type="number" min={0} value={form.max_carry_over_days} onChange={(e) => setForm((f) => ({ ...f, max_carry_over_days: e.target.value }))} placeholder="e.g. 5" />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={isSaving}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={isSaving || !form.name.trim()} loading={isSaving}>
              {editLeave ? 'Save Changes' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete Leave Type" description={`Delete "${deleteTarget?.name_en}"? This cannot be undone.`}
        confirmLabel="Delete" variant="destructive"
        onConfirm={() => deleteTarget && deleteMutation.mutateAsync(deleteTarget.id)}
        loading={deleteMutation.isPending}
      />
    </div>
  )
}
