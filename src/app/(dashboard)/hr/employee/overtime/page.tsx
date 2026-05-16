'use client'

import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Clock, CheckCircle, Loader2, Paperclip } from 'lucide-react'
import { PageHeader } from '@/components/hr/shared/PageHeader'
import { Button } from '@/components/hr/ui/button'
import { Input } from '@/components/hr/ui/input'
import { Label } from '@/components/hr/ui/label'
import { Textarea } from '@/components/hr/ui/textarea'
import { Badge } from '@/components/hr/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/hr/ui/select'
import { useToast } from '@/components/hr/ui/toast'
import api from '@/lib/hr/api'
import { formatDate, formatCurrency, capitalize } from '@/lib/hr/utils'
import type { OvertimeRequest } from '@/lib/hr/types'
import { describeError } from "@/lib/zod-errors";

interface OvertimePolicy {
  id: number
  type_code: string
  name_en: string
  rate_multiplier: number
  min_hours: number
  max_hours_day: number
}

interface MyOTSummary {
  approved_hours: number
  approved_amount: number
  pending_count: number
}

const schema = z.object({
  date: z.string().min(1, 'Date is required'),
  overtime_type: z.string().min(1, 'Type is required'),
  hours_requested: z.number({ error: 'Enter hours' }).min(0.5, 'Minimum 0.5h'),
  reason: z.string().min(20, 'Reason must be at least 20 characters'),
})

type FormValues = z.infer<typeof schema>

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'default'> = {
  approved: 'success',
  pending: 'warning',
  denied: 'danger',
  cancelled: 'default',
}

function getTodayStr() {
  return new Date().toISOString().split('T')[0]
}

function getMinDateStr() {
  const d = new Date()
  d.setDate(d.getDate() - 7)
  return d.toISOString().split('T')[0]
}

export default function MyOvertimePage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [evidenceFile, setEvidenceFile] = useState<File | null>(null)
  const [submittedPreview, setSubmittedPreview] = useState<{
    hours: number
    multiplier: number
    hourlyRate: number
    amount: number
  } | null>(null)

  const { data: policiesData } = useQuery<{ data: { results: OvertimePolicy[] } }>({
    queryKey: ['overtime-policies'],
    queryFn: () => api.get('/overtime/policies/'),
  })
  const policies = policiesData?.data?.results ?? []

  const { data: summaryData } = useQuery<{ data: MyOTSummary }>({
    queryKey: ['my-ot-summary'],
    queryFn: () => api.get('/overtime/my-summary/'),
  })
  const summary = summaryData?.data

  const { data: requestsData, isLoading } = useQuery<{ data: { results: OvertimeRequest[] } }>({
    queryKey: ['my-ot-requests'],
    queryFn: () => api.get('/overtime/requests/'),
  })
  const requests = requestsData?.data?.results ?? []

  const { register, handleSubmit, watch, setValue, reset, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      date: getTodayStr(),
      overtime_type: '',
      hours_requested: 1,
      reason: '',
    },
  })

  const selectedType = watch('overtime_type')
  const selectedHours = watch('hours_requested')
  const selectedPolicy = policies.find((p) => String(p.id) === selectedType)

  const submitMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const fd = new FormData()
      Object.entries(values).forEach(([k, v]) => fd.append(k, String(v)))
      if (evidenceFile) fd.append('evidence', evidenceFile)
      return api.post('/overtime/requests/', fd, {
        
      })
    },
    onSuccess: (res) => {
      const data = res.data
      if (selectedPolicy && data.calculated_amount) {
        const hourlyRate = data.calculated_amount / (selectedHours * selectedPolicy.rate_multiplier)
        setSubmittedPreview({
          hours: selectedHours,
          multiplier: selectedPolicy.rate_multiplier,
          hourlyRate,
          amount: data.calculated_amount,
        })
      }
      queryClient.invalidateQueries({ queryKey: ['my-ot-requests'] })
      queryClient.invalidateQueries({ queryKey: ['my-ot-summary'] })
      reset({ date: getTodayStr(), overtime_type: '', hours_requested: 1, reason: '' })
      setEvidenceFile(null)
      toast({ title: 'OT Request submitted', description: 'Your overtime request is pending approval.' })
    },
    onError: (__err: unknown) => toast({ title: 'Error', variant: 'destructive', description: describeError(__err) || 'Failed to submit OT request.' }),
  })

  function onSubmit(values: FormValues) {
    setSubmittedPreview(null)
    submitMutation.mutate(values)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Overtime"
        description="Submit overtime requests and track approvals"
        breadcrumbs={[{ label: 'My Overtime' }]}
      />

      {/* Summary chips */}
      <div className="flex flex-wrap gap-3">
        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5">
          <CheckCircle className="h-4 w-4 text-emerald-600" />
          <div>
            <p className="text-xs text-emerald-700 font-medium">Approved this month</p>
            <p className="text-sm font-bold text-emerald-800">
              {summary?.approved_hours.toFixed(1) ?? '—'} hrs · {formatCurrency(summary?.approved_amount ?? 0)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5">
          <Clock className="h-4 w-4 text-amber-600" />
          <div>
            <p className="text-xs text-amber-700 font-medium">Pending requests</p>
            <p className="text-sm font-bold text-amber-800">{summary?.pending_count ?? '—'}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Submit form */}
        <div className="bg-card rounded-lg border border-border p-6">
          <h2 className="text-base font-semibold text-foreground mb-4">Submit OT Request</h2>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Date *</Label>
              <Input
                type="date"
                max={getTodayStr()}
                min={getMinDateStr()}
                {...register('date')}
              />
              {errors.date && <p className="text-xs text-red-600">{errors.date.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Overtime Type *</Label>
              <Select value={selectedType} onValueChange={(v) => setValue('overtime_type', v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select type..." />
                </SelectTrigger>
                <SelectContent>
                  {policies.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name_en} ({p.rate_multiplier}x)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.overtime_type && <p className="text-xs text-red-600">{errors.overtime_type.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Hours *</Label>
              <Input
                type="number"
                step={0.5}
                min={selectedPolicy?.min_hours ?? 0.5}
                max={selectedPolicy?.max_hours_day ?? 8}
                {...register('hours_requested', { valueAsNumber: true })}
              />
              {selectedPolicy && (
                <p className="text-xs text-muted-foreground">
                  Min: {selectedPolicy.min_hours}h · Max per day: {selectedPolicy.max_hours_day}h
                </p>
              )}
              {errors.hours_requested && <p className="text-xs text-red-600">{errors.hours_requested.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Reason * (min 20 chars)</Label>
              <Textarea
                rows={3}
                placeholder="Describe the work done during overtime..."
                {...register('reason')}
              />
              {errors.reason && <p className="text-xs text-red-600">{errors.reason.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Evidence (optional)</Label>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 cursor-pointer bg-muted/50 border border-dashed border-border rounded px-3 py-2 hover:bg-muted transition-colors text-sm text-muted-foreground">
                  <Paperclip className="h-4 w-4" />
                  {evidenceFile ? evidenceFile.name : 'Attach file...'}
                  <input
                    type="file"
                    className="hidden"
                    onChange={(e) => setEvidenceFile(e.target.files?.[0] ?? null)}
                  />
                </label>
                {evidenceFile && (
                  <Button variant="ghost" size="sm" type="button" onClick={() => setEvidenceFile(null)} className="text-muted-foreground h-7">
                    Remove
                  </Button>
                )}
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={submitMutation.isPending} loading={submitMutation.isPending}>
              Submit Request
            </Button>
          </form>

          {submittedPreview && (
            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded text-sm text-blue-800">
              <p className="font-semibold mb-1">Calculation (pending approval)</p>
              <p>
                {submittedPreview.hours}h × {submittedPreview.multiplier}x × {submittedPreview.hourlyRate.toFixed(2)} EGP/hr
                = <span className="font-bold">{formatCurrency(submittedPreview.amount)}</span>
              </p>
            </div>
          )}
        </div>

        {/* Requests table */}
        <div className="lg:col-span-2 bg-card rounded-lg border border-border overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-border">
            <h2 className="text-base font-semibold text-foreground">My OT Requests</h2>
          </div>

          {isLoading ? (
            <div className="p-12 text-center text-muted-foreground flex items-center justify-center gap-3">
              <Loader2 className="h-4 w-4 animate-spin" />Loading...
            </div>
          ) : requests.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">No overtime requests yet.</div>
          ) : (
            <div className="overflow-x-auto flex-1">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b border-border">
                  <tr>
                    {['Date', 'Type', 'Hours', 'Reason', 'Status', 'Approved By', 'Amount'].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {requests.map((req) => (
                    <tr key={req.id} className="hover:bg-muted/50 transition-colors">
                      <td className="px-4 py-3 text-foreground whitespace-nowrap">{formatDate(req.date)}</td>
                      <td className="px-4 py-3 text-foreground capitalize whitespace-nowrap">
                        {(req as any).overtime_type_name ?? String(req.overtime_type)}
                      </td>
                      <td className="px-4 py-3 text-foreground">{req.hours_requested}h</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs max-w-[200px] truncate" title={req.reason}>
                        {req.reason}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={STATUS_VARIANT[req.status] ?? 'default'} className="text-xs capitalize">
                          {req.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-foreground text-xs">{req.approved_by_name ?? '—'}</td>
                      <td className="px-4 py-3 text-foreground font-medium">
                        {req.calculated_amount > 0 ? formatCurrency(req.calculated_amount) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
