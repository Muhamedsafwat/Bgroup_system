'use client'

import { describeError } from "@/lib/zod-errors";

import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Edit2, Trash2, Users } from 'lucide-react'
import { useLocale } from '@/lib/i18n'
import api from '@/lib/hr/api'
import { cn } from '@/lib/hr/utils'
import { PageHeader } from '@/components/hr/shared/PageHeader'
import { ConfirmDialog } from '@/components/hr/shared/ConfirmDialog'
import { Button } from '@/components/hr/ui/button'
import { Input } from '@/components/hr/ui/input'
import { Label } from '@/components/hr/ui/label'
import { Badge } from '@/components/hr/ui/badge'
import { Switch } from '@/components/hr/ui/switch'
import { Skeleton } from '@/components/hr/ui/skeleton'
import { Checkbox } from '@/components/hr/ui/checkbox'
import { Textarea } from '@/components/hr/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/hr/ui/tabs'
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
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Shift {
  id: number
  name: string
  start_time: string
  end_time: string
  grace_period_minutes: number
  daily_work_hours: number
  weekly_off_day: string
  is_default: boolean
}

interface AutoRule {
  id: number
  code: string
  name: string
  condition_description: string
  threshold_value: number
  time_window_months: number
  action: string
  is_active: boolean
}

interface EmployeeOption {
  id: number
  full_name_en: string
  employee_id: string
}

// ─── Schemas ─────────────────────────────────────────────────────────────────

const shiftSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  start_time: z.string().min(1, 'Start time is required'),
  end_time: z.string().min(1, 'End time is required'),
  grace_period_minutes: z.number().int().min(0).max(120),
  daily_work_hours: z.number().min(1).max(24),
  weekly_off_day: z.string().min(1, 'Off day is required'),
  is_default: z.boolean(),
})

const autoRuleSchema = z.object({
  code: z.string().min(1, 'Code is required'),
  name: z.string().min(1, 'Name is required'),
  condition_description: z.string().min(1, 'Condition is required'),
  threshold_value: z.number().int().min(1),
  time_window_months: z.number().int().min(1),
  action: z.string().min(1, 'Action is required'),
  is_active: z.boolean(),
})

type ShiftForm = z.infer<typeof shiftSchema>
type AutoRuleForm = z.infer<typeof autoRuleSchema>

// weekly_off_day mapping: backend stores integers, frontend uses labels
const OFF_DAY_TO_INT: Record<string, number> = { friday: 4, saturday: 5, sunday: 6 }
const INT_TO_OFF_DAY: Record<number, string> = { 4: 'friday', 5: 'saturday', 6: 'sunday' }

// ─── Shifts Tab ───────────────────────────────────────────────────────────────

function ShiftsTab() {
  const { locale } = useLocale()
  const isAr = locale === 'ar'
  const qc = useQueryClient()
  const [shiftDialog, setShiftDialog] = useState(false)
  const [editingShift, setEditingShift] = useState<Shift | null>(null)
  const [deleteShift, setDeleteShift] = useState<Shift | null>(null)
  const [assignDialog, setAssignDialog] = useState<Shift | null>(null)
  const [selectedEmployees, setSelectedEmployees] = useState<number[]>([])

  const { data: shifts, isLoading } = useQuery<Shift[]>({
    queryKey: ['attendance', 'shifts'],
    queryFn: async () => {
      const res = await api.get('/attendance/shifts/')
      return Array.isArray(res.data) ? res.data : res.data.results ?? []
    },
  })

  const { data: employees } = useQuery<EmployeeOption[]>({
    queryKey: ['employees', 'options'],
    queryFn: async () => {
      const res = await api.get('/employees/', { params: { page_size: 200 } })
      return res.data.results ?? res.data
    },
    enabled: !!assignDialog,
  })

  const {
    register, handleSubmit, reset, control,
    formState: { errors, isSubmitting },
  } = useForm<ShiftForm>({
    resolver: zodResolver(shiftSchema),
    defaultValues: { is_default: false, grace_period_minutes: 0, daily_work_hours: 8, weekly_off_day: 'friday' },
  })

  const saveMutation = useMutation({
    mutationFn: (data: ShiftForm) => {
      const payload = { ...data, weekly_off_day: OFF_DAY_TO_INT[data.weekly_off_day] ?? 4 }
      return editingShift
        ? api.put(`/attendance/shifts/${editingShift.id}/`, payload)
        : api.post('/attendance/shifts/', payload)
    },
    onSuccess: () => {
      toast.success(editingShift ? 'Shift updated' : 'Shift created')
      qc.invalidateQueries({ queryKey: ['attendance', 'shifts'] })
      setShiftDialog(false)
      setEditingShift(null)
      reset()
    },
    onError: (__err: unknown) => toast.error(describeError(__err) || 'Failed to save shift'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/attendance/shifts/${id}/`),
    onSuccess: () => {
      toast.success('Shift deleted')
      qc.invalidateQueries({ queryKey: ['attendance', 'shifts'] })
    },
    onError: (__err: unknown) => toast.error(describeError(__err) || 'Failed to delete shift'),
  })

  const assignMutation = useMutation({
    mutationFn: ({ shiftId, employeeIds }: { shiftId: number; employeeIds: number[] }) =>
      api.post(`/attendance/shifts/${shiftId}/assign/`, { employee_ids: employeeIds }),
    onSuccess: () => {
      toast.success('Employees assigned to shift')
      setAssignDialog(null)
      setSelectedEmployees([])
    },
    onError: (__err: unknown) => toast.error(describeError(__err) || 'Failed to assign employees'),
  })

  function openEdit(shift: Shift) {
    setEditingShift(shift)
    reset({
      name: shift.name,
      start_time: shift.start_time,
      end_time: shift.end_time,
      grace_period_minutes: shift.grace_period_minutes,
      daily_work_hours: shift.daily_work_hours,
      weekly_off_day: INT_TO_OFF_DAY[Number(shift.weekly_off_day)] ?? 'friday',
      is_default: shift.is_default,
    })
    setShiftDialog(true)
  }

  function openAdd() {
    setEditingShift(null)
    reset({ is_default: false, grace_period_minutes: 0, daily_work_hours: 8, weekly_off_day: 'friday' })
    setShiftDialog(true)
  }

  function toggleEmployee(id: number) {
    setSelectedEmployees(prev =>
      prev.includes(id) ? prev.filter(e => e !== id) : [...prev, id]
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">Manage work shifts and schedules</p>
        <Button onClick={openAdd} className="gap-2">
          <Plus className="h-4 w-4" /> Add Shift
        </Button>
      </div>

      <div className="bg-card rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="font-semibold">{isAr ? 'الاسم' : 'Name'}</TableHead>
              <TableHead className="font-semibold">{isAr ? 'وقت البدء' : 'Start Time'}</TableHead>
              <TableHead className="font-semibold">{isAr ? 'وقت الانتهاء' : 'End Time'}</TableHead>
              <TableHead className="font-semibold">{isAr ? 'فترة السماح' : 'Grace Period'}</TableHead>
              <TableHead className="font-semibold">{isAr ? 'ساعات يومية' : 'Daily Hours'}</TableHead>
              <TableHead className="font-semibold">{isAr ? 'إجازة' : 'Off Day'}</TableHead>
              <TableHead className="font-semibold">{isAr ? 'افتراضي' : 'Default'}</TableHead>
              <TableHead className="font-semibold text-center">{isAr ? 'إجراءات' : 'Actions'}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 8 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : !shifts?.length ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                  No shifts configured
                </TableCell>
              </TableRow>
            ) : (
              shifts.map(shift => (
                <TableRow key={shift.id} className="hover:bg-muted/50">
                  <TableCell className="font-medium">{shift.name}</TableCell>
                  <TableCell>{shift.start_time}</TableCell>
                  <TableCell>{shift.end_time}</TableCell>
                  <TableCell>{shift.grace_period_minutes} min</TableCell>
                  <TableCell>{shift.daily_work_hours}h</TableCell>
                  <TableCell className="capitalize">{INT_TO_OFF_DAY[Number(shift.weekly_off_day)] ?? shift.weekly_off_day}</TableCell>
                  <TableCell>
                    {shift.is_default && <Badge variant="info">Default</Badge>}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={() => { setAssignDialog(shift); setSelectedEmployees([]) }}
                        title="Assign Employees"
                      >
                        <Users className="h-4 w-4 text-blue-500" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={() => openEdit(shift)}
                      >
                        <Edit2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={() => setDeleteShift(shift)}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Add/Edit Shift Dialog */}
      <Dialog open={shiftDialog} onOpenChange={open => { setShiftDialog(open); if (!open) { setEditingShift(null); reset() } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingShift ? 'Edit Shift' : 'Add New Shift'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(d => saveMutation.mutate(d))} className="space-y-4">
            <div className="space-y-1">
              <Label>Name *</Label>
              <Input {...register('name')} placeholder="e.g. Standard Office" />
              {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Start Time *</Label>
                <Input type="time" {...register('start_time')} />
                {errors.start_time && <p className="text-xs text-red-500">{errors.start_time.message}</p>}
              </div>
              <div className="space-y-1">
                <Label>End Time *</Label>
                <Input type="time" {...register('end_time')} />
                {errors.end_time && <p className="text-xs text-red-500">{errors.end_time.message}</p>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Grace Period (min)</Label>
                <Input type="number" min={0} max={120} {...register('grace_period_minutes', { valueAsNumber: true })} />
              </div>
              <div className="space-y-1">
                <Label>Daily Hours</Label>
                <Input type="number" step={0.5} min={1} max={24} {...register('daily_work_hours', { valueAsNumber: true })} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Weekly Off Day *</Label>
              <Controller
                name="weekly_off_day"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select off day" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="friday">Friday</SelectItem>
                      <SelectItem value="saturday">Saturday</SelectItem>
                      <SelectItem value="sunday">Sunday</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="flex items-center gap-2">
              <Controller
                name="is_default"
                control={control}
                render={({ field }) => (
                  <Checkbox
                    id="is_default"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                )}
              />
              <Label htmlFor="is_default" className="cursor-pointer">Set as default shift</Label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShiftDialog(false)}>Cancel</Button>
              <Button type="submit" loading={isSubmitting || saveMutation.isPending}>
                {editingShift ? 'Update' : 'Create'} Shift
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Assign Employees Dialog */}
      <Dialog open={!!assignDialog} onOpenChange={open => { if (!open) setAssignDialog(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Employees — {assignDialog?.name}</DialogTitle>
          </DialogHeader>
          <div className="max-h-72 overflow-y-auto space-y-2 py-2">
            {(employees ?? []).map(emp => (
              <label key={emp.id} className="flex items-center gap-3 py-1.5 px-2 rounded hover:bg-muted/50 cursor-pointer">
                <Checkbox
                  checked={selectedEmployees.includes(emp.id)}
                  onCheckedChange={() => toggleEmployee(emp.id)}
                />
                <div>
                  <p className="text-sm font-medium">{emp.full_name_en}</p>
                  <p className="text-xs text-muted-foreground">{emp.employee_id}</p>
                </div>
              </label>
            ))}
            {!employees?.length && (
              <p className="text-center text-muted-foreground py-4">Loading employees...</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignDialog(null)}>Cancel</Button>
            <Button
              onClick={() => assignMutation.mutate({ shiftId: assignDialog!.id, employeeIds: selectedEmployees })}
              loading={assignMutation.isPending}
              disabled={selectedEmployees.length === 0}
            >
              Assign {selectedEmployees.length > 0 ? `(${selectedEmployees.length})` : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!deleteShift}
        onOpenChange={open => { if (!open) setDeleteShift(null) }}
        title="Delete Shift"
        description={`Are you sure you want to delete "${deleteShift?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => { deleteMutation.mutateAsync(deleteShift!.id) }}
      />
    </div>
  )
}

// ─── Auto Rules Tab ───────────────────────────────────────────────────────────

function AutoRulesTab() {
  const qc = useQueryClient()
  const [ruleDialog, setRuleDialog] = useState(false)
  const [editingRule, setEditingRule] = useState<AutoRule | null>(null)
  const [deleteRule, setDeleteRule] = useState<AutoRule | null>(null)

  const { data: rules, isLoading } = useQuery<AutoRule[]>({
    queryKey: ['attendance', 'auto-rules'],
    queryFn: async () => {
      const res = await api.get('/attendance/auto-rules/')
      return Array.isArray(res.data) ? res.data : res.data.results ?? []
    },
  })

  const {
    register, handleSubmit, reset, control,
    formState: { errors, isSubmitting },
  } = useForm<AutoRuleForm>({
    resolver: zodResolver(autoRuleSchema),
    defaultValues: { is_active: true, threshold_value: 3, time_window_months: 1 },
  })

  const saveMutation = useMutation({
    mutationFn: (data: AutoRuleForm) =>
      editingRule
        ? api.put(`/attendance/auto-rules/${editingRule.id}/`, data)
        : api.post('/attendance/auto-rules/', data),
    onSuccess: () => {
      toast.success(editingRule ? 'Rule updated' : 'Rule created')
      qc.invalidateQueries({ queryKey: ['attendance', 'auto-rules'] })
      setRuleDialog(false)
      setEditingRule(null)
      reset()
    },
    onError: (__err: unknown) => toast.error(describeError(__err) || 'Failed to save rule'),
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) =>
      api.patch(`/attendance/auto-rules/${id}/`, { is_active }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['attendance', 'auto-rules'] })
    },
    onError: (__err: unknown) => toast.error(describeError(__err) || 'Failed to update rule'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/attendance/auto-rules/${id}/`),
    onSuccess: () => {
      toast.success('Rule deleted')
      qc.invalidateQueries({ queryKey: ['attendance', 'auto-rules'] })
    },
    onError: (__err: unknown) => toast.error(describeError(__err) || 'Failed to delete rule'),
  })

  function openEdit(rule: AutoRule) {
    setEditingRule(rule)
    reset({
      code: rule.code,
      name: rule.name,
      condition_description: rule.condition_description,
      threshold_value: rule.threshold_value,
      time_window_months: rule.time_window_months,
      action: rule.action,
      is_active: rule.is_active,
    })
    setRuleDialog(true)
  }

  function openAdd() {
    setEditingRule(null)
    reset({ is_active: true, threshold_value: 3, time_window_months: 1 })
    setRuleDialog(true)
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">Configure automatic detection and action rules</p>
        <Button onClick={openAdd} className="gap-2">
          <Plus className="h-4 w-4" /> Add Rule
        </Button>
      </div>

      <div className="bg-card rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="font-semibold">Code</TableHead>
              <TableHead className="font-semibold">Name</TableHead>
              <TableHead className="font-semibold">Condition</TableHead>
              <TableHead className="font-semibold">Threshold</TableHead>
              <TableHead className="font-semibold">Time Window</TableHead>
              <TableHead className="font-semibold">Action</TableHead>
              <TableHead className="font-semibold">Active</TableHead>
              <TableHead className="font-semibold text-center">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 8 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : !rules?.length ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                  No auto-detection rules configured
                </TableCell>
              </TableRow>
            ) : (
              rules.map(rule => (
                <TableRow key={rule.id} className="hover:bg-muted/50">
                  <TableCell className="font-mono text-sm">{rule.code}</TableCell>
                  <TableCell className="font-medium">{rule.name}</TableCell>
                  <TableCell className="text-muted-foreground">{rule.condition_description}</TableCell>
                  <TableCell className="text-center">{rule.threshold_value}</TableCell>
                  <TableCell className="text-center">{rule.time_window_months} month{rule.time_window_months !== 1 ? 's' : ''}</TableCell>
                  <TableCell>
                    <span className="text-xs px-2 py-0.5 rounded bg-muted text-foreground">{rule.action}</span>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={rule.is_active}
                      onCheckedChange={checked => toggleMutation.mutate({ id: rule.id, is_active: checked })}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-center gap-2">
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => openEdit(rule)}>
                        <Edit2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setDeleteRule(rule)}>
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={ruleDialog} onOpenChange={open => { setRuleDialog(open); if (!open) { setEditingRule(null); reset() } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingRule ? 'Edit Rule' : 'Add Auto-Detection Rule'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(d => saveMutation.mutate(d))} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Code *</Label>
                <Input {...register('code')} placeholder="e.g. LATE_3X" />
                {errors.code && <p className="text-xs text-red-500">{errors.code.message}</p>}
              </div>
              <div className="space-y-1">
                <Label>Name *</Label>
                <Input {...register('name')} placeholder="Rule name" />
                {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
              </div>
            </div>
            <div className="space-y-1">
              <Label>Condition *</Label>
              <Input {...register('condition_description')} placeholder="e.g. late_count >= threshold" />
              {errors.condition_description && <p className="text-xs text-red-500">{errors.condition_description.message}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Threshold *</Label>
                <Input type="number" min={1} {...register('threshold_value', { valueAsNumber: true })} />
              </div>
              <div className="space-y-1">
                <Label>Time Window (months)</Label>
                <Input type="number" min={1} {...register('time_window_months', { valueAsNumber: true })} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Action *</Label>
              <Input {...register('action')} placeholder="e.g. incident_warning" />
              {errors.action && <p className="text-xs text-red-500">{errors.action.message}</p>}
            </div>
            <div className="flex items-center gap-2">
              <Controller
                name="is_active"
                control={control}
                render={({ field }) => (
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                )}
              />
              <Label>Active</Label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRuleDialog(false)}>Cancel</Button>
              <Button type="submit" loading={isSubmitting || saveMutation.isPending}>
                {editingRule ? 'Update' : 'Create'} Rule
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteRule}
        onOpenChange={open => { if (!open) setDeleteRule(null) }}
        title="Delete Rule"
        description={`Are you sure you want to delete "${deleteRule?.name}"?`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => { deleteMutation.mutateAsync(deleteRule!.id) }}
      />
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AttendanceSettingsPage() {
  const { locale } = useLocale()
  const isAr = locale === 'ar'
  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance Settings"
        description="Configure shifts and auto-detection rules"
        breadcrumbs={[{ label: isAr ? 'الحضور' : 'Attendance' }, { label: isAr ? 'الإعدادات' : 'Settings' }]}
      />

      <Tabs defaultValue="shifts">
        <TabsList className="border-b border-border bg-transparent p-0 h-auto mb-6">
          <TabsTrigger value="shifts" className="rounded-none border-b-2 border-transparent data-[state=active]:border-brand-navy data-[state=active]:text-brand-navy pb-3 px-4">
            Shifts
          </TabsTrigger>
          <TabsTrigger value="auto-rules" className="rounded-none border-b-2 border-transparent data-[state=active]:border-brand-navy data-[state=active]:text-brand-navy pb-3 px-4">
            Auto-Detection Rules
          </TabsTrigger>
        </TabsList>

        <TabsContent value="shifts">
          <ShiftsTab />
        </TabsContent>

        <TabsContent value="auto-rules">
          <AutoRulesTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
