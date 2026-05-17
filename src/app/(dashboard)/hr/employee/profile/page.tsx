'use client'

import { describeError } from "@/lib/zod-errors";

import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil, Check, X, Camera, Send, Loader2 } from 'lucide-react'
import { PageHeader } from '@/components/hr/shared/PageHeader'
import { Button } from '@/components/hr/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/hr/ui/avatar'
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
import { Textarea } from '@/components/hr/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/hr/ui/select'
import { useToast } from '@/components/hr/ui/toast'
import { useAuth } from '@/contexts/hr/AuthContext'
import api from '@/lib/hr/api'
import { formatDate, formatCurrency, getInitials, capitalize } from '@/lib/hr/utils'
import type { Employee } from '@/lib/hr/types'

const UPDATABLE_FIELDS = [
  { value: 'phone', label: 'Phone Number' },
  { value: 'address', label: 'Address' },
  { value: 'emergency_contact_name', label: 'Emergency Contact Name' },
  { value: 'emergency_contact_phone', label: 'Emergency Contact Phone' },
  { value: 'bank_name', label: 'Bank Name' },
  { value: 'bank_account', label: 'Bank Account / IBAN' },
]

interface EditField {
  key: keyof Employee
  value: string
}

export default function MyProfilePage() {
  const { user } = useAuth()
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [editingField, setEditingField] = useState<EditField | null>(null)
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false)
  const [updateRequestField, setUpdateRequestField] = useState('')
  const [updateRequestValue, setUpdateRequestValue] = useState('')
  const [updateRequestReason, setUpdateRequestReason] = useState('')

  const { data, isLoading } = useQuery<{ data: Employee }>({
    queryKey: ['my-employee-profile'],
    queryFn: () => api.get('/employees/my-profile/'),
  })
  const employee = data?.data

  const updateFieldMutation = useMutation({
    mutationFn: ({ field, value }: { field: string; value: string }) =>
      api.patch(`/employees/${employee?.id}/`, { [field]: value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-employee-profile'] })
      setEditingField(null)
      toast({ title: 'Updated', description: 'Your profile has been updated.' })
    },
    onError: (__err: unknown) => toast({ title: 'Error', variant: 'destructive', description: describeError(__err) || 'Failed to update field.' }),
  })

  const uploadPhotoMutation = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData()
      fd.append('photo', file)
      return api.post(`/employees/${employee?.id}/upload-photo/`, fd)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-employee-profile'] })
      toast({ title: 'Photo updated' })
    },
    onError: (__err: unknown) => toast({ title: 'Error', variant: 'destructive', description: describeError(__err) || 'Failed to upload photo.' }),
  })

  const updateRequestMutation = useMutation({
    mutationFn: (data: { field: string; new_value: string; reason: string }) =>
      api.post(`/employees/${employee?.id}/update-request/`, data),
    onSuccess: () => {
      setUpdateDialogOpen(false)
      setUpdateRequestField('')
      setUpdateRequestValue('')
      setUpdateRequestReason('')
      toast({ title: 'Request submitted', description: 'HR will review your update request.' })
    },
    onError: (__err: unknown) => toast({ title: 'Error', variant: 'destructive', description: describeError(__err) || 'Failed to submit request.' }),
  })

  function handlePhotoClick() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (file) uploadPhotoMutation.mutate(file)
    }
    input.click()
  }

  const EDITABLE_FIELDS: Array<keyof Employee> = ['phone', 'address', 'emergency_contact_name', 'emergency_contact_phone']

  if (isLoading || !employee) {
    return (
      <div className="flex items-center justify-center p-16 gap-3 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />Loading profile...
      </div>
    )
  }

  function InfoRow({ label, value, field }: { label: string; value?: string | null; field?: keyof Employee }) {
    const isEditing = editingField?.key === field
    const isEditable = field && EDITABLE_FIELDS.includes(field)

    if (isEditing && field) {
      return (
        <div className="flex items-center justify-between py-3 border-b border-border/60">
          <span className="text-sm text-muted-foreground w-44 shrink-0">{label}</span>
          <div className="flex items-center gap-2 flex-1">
            <Input
              className="h-8 text-sm flex-1 max-w-xs"
              value={editingField?.value ?? ''}
              onChange={(e) => setEditingField({ key: field, value: e.target.value })}
              autoFocus
            />
            <Button
              variant="ghost"
              size="icon-sm"
              className="h-7 w-7 text-emerald-600"
              onClick={() => updateFieldMutation.mutate({ field: String(field), value: editingField?.value ?? '' })}
              disabled={updateFieldMutation.isPending}
            >
              {updateFieldMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            </Button>
            <Button variant="ghost" size="icon-sm" className="h-7 w-7 text-muted-foreground" onClick={() => setEditingField(null)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )
    }

    return (
      <div className="flex items-center justify-between py-3 border-b border-border/60 group">
        <span className="text-sm text-muted-foreground w-44 shrink-0">{label}</span>
        <div className="flex items-center gap-2 flex-1">
          <span className="text-sm font-medium text-foreground">{value || '—'}</span>
          {isEditable && field && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
              onClick={() => setEditingField({ key: field, value: String(value ?? '') })}
            >
              <Pencil className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Profile"
        description="View and manage your personal information"
        breadcrumbs={[{ label: 'My Profile' }]}
        actions={
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setUpdateDialogOpen(true)}
          >
            <Send className="h-4 w-4" />
            Request Profile Update
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Photo + summary card */}
        <div className="bg-card rounded-lg border border-border p-6 flex flex-col items-center text-center gap-4">
          <div className="relative">
            <Avatar className="h-24 w-24">
              <AvatarImage src={employee.photo ?? undefined} alt={employee.full_name_en} />
              <AvatarFallback className="text-2xl bg-blue-100 text-blue-700 font-bold">
                {getInitials(employee.full_name_en)}
              </AvatarFallback>
            </Avatar>
            <button
              className="absolute bottom-0 right-0 h-7 w-7 rounded-full bg-blue-600 text-white flex items-center justify-center hover:bg-blue-700 transition-colors shadow"
              onClick={handlePhotoClick}
              disabled={uploadPhotoMutation.isPending}
              title="Change photo"
            >
              {uploadPhotoMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Camera className="h-3.5 w-3.5" />
              )}
            </button>
          </div>

          <div>
            <h2 className="text-lg font-bold text-foreground">{employee.full_name_en}</h2>
            {employee.full_name_ar && (
              <p className="text-sm text-muted-foreground dir-rtl">{employee.full_name_ar}</p>
            )}
            <p className="text-sm text-muted-foreground mt-1">{employee.position_en}</p>
            <p className="text-xs text-muted-foreground">{employee.department_name} · {employee.company_name}</p>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-center">
            <Badge variant="success" className="capitalize">{capitalize(employee.status)}</Badge>
            <Badge variant="default" className="capitalize">{capitalize(employee.employment_type)}</Badge>
            <Badge variant="info" className="capitalize">{capitalize(employee.work_model)}</Badge>
          </div>

          <div className="w-full text-left space-y-2 pt-2 border-t border-border/60">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Employee ID</span>
              <span className="font-mono font-medium text-foreground">{employee.employee_id}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Base Salary</span>
              <span className="font-medium text-foreground">{formatCurrency(employee.base_salary, employee.currency)}</span>
            </div>
          </div>
        </div>

        {/* Personal Info */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-card rounded-lg border border-border p-6">
            <h3 className="text-sm font-semibold text-foreground mb-3">Personal Information</h3>
            <InfoRow label="Full Name (EN)" value={employee.full_name_en} />
            <InfoRow label="Full Name (AR)" value={employee.full_name_ar} />
            <InfoRow label="National ID" value={employee.national_id} />
            <InfoRow label="Email" value={employee.email} />
            <InfoRow label="Phone" value={employee.phone} field="phone" />
            <InfoRow label="Address" value={employee.address} field="address" />
            <InfoRow label="Emergency Contact" value={employee.emergency_contact_name} field="emergency_contact_name" />
            <InfoRow label="Emergency Phone" value={employee.emergency_contact_phone} field="emergency_contact_phone" />
          </div>

          <div className="bg-card rounded-lg border border-border p-6">
            <h3 className="text-sm font-semibold text-foreground mb-3">Employment Details</h3>
            <InfoRow label="Position" value={employee.position_en} />
            <InfoRow label="Department" value={employee.department_name} />
            <InfoRow label="Company" value={employee.company_name} />
            <InfoRow label="Level" value={capitalize(employee.level)} />
            <InfoRow label="Work Model" value={capitalize(employee.work_model)} />
            <InfoRow label="Contract Start" value={formatDate(employee.contract_start)} />
            <InfoRow label="Contract End" value={employee.contract_end ? formatDate(employee.contract_end) : 'Indefinite'} />
            <InfoRow label="Hire Date" value={formatDate(employee.hire_date)} />
            {employee.probation_end && (
              <InfoRow label="Probation End" value={formatDate(employee.probation_end)} />
            )}
            {employee.team_lead_name && (
              <InfoRow label="Team Lead" value={employee.team_lead_name} />
            )}
          </div>

          <div className="bg-card rounded-lg border border-border p-6">
            <h3 className="text-sm font-semibold text-foreground mb-3">Bank Information</h3>
            <InfoRow label="Bank Name" value={employee.bank_name} />
            <InfoRow label="Account / IBAN" value={employee.bank_account} />
            <p className="text-xs text-muted-foreground mt-2">
              To update bank information, use "Request Profile Update" button above.
            </p>
          </div>
        </div>
      </div>

      {/* Profile Update Request Dialog */}
      <Dialog open={updateDialogOpen} onOpenChange={setUpdateDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Request Profile Update</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Field to Update *</Label>
              <Select value={updateRequestField} onValueChange={setUpdateRequestField}>
                <SelectTrigger>
                  <SelectValue placeholder="Select field..." />
                </SelectTrigger>
                <SelectContent>
                  {UPDATABLE_FIELDS.map((f) => (
                    <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>New Value *</Label>
              <Input
                value={updateRequestValue}
                onChange={(e) => setUpdateRequestValue(e.target.value)}
                placeholder="Enter the new value"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Reason *</Label>
              <Textarea
                value={updateRequestReason}
                onChange={(e) => setUpdateRequestReason(e.target.value)}
                placeholder="Explain why this update is needed..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUpdateDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() =>
                updateRequestMutation.mutate({
                  field: updateRequestField,
                  new_value: updateRequestValue,
                  reason: updateRequestReason,
                })
              }
              disabled={
                !updateRequestField || !updateRequestValue || !updateRequestReason ||
                updateRequestMutation.isPending
              }
              loading={updateRequestMutation.isPending}
            >
              Submit Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
