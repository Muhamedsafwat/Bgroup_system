'use client'

import { describeError } from "@/lib/zod-errors";

import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/hr/shared/PageHeader'
import { ConfirmDialog } from '@/components/hr/shared/ConfirmDialog'
import { Button } from '@/components/hr/ui/button'
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
import { useToast } from '@/components/hr/ui/toast'
import api, { companiesApi, departmentsApi, employeesApi } from '@/lib/hr/api'
import type { Company, Department, Employee, PaginatedResponse } from '@/lib/hr/types'

interface DeptFormData {
  company: string
  name_en: string
  name_ar: string
  head_of_dept: string
}

const EMPTY_FORM: DeptFormData = {
  company: '',
  name_en: '',
  name_ar: '',
  head_of_dept: '',
}

export default function DepartmentsSettingsPage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [filterCompany, setFilterCompany] = useState<string>('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editDept, setEditDept] = useState<Department | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Department | null>(null)
  const [form, setForm] = useState<DeptFormData>(EMPTY_FORM)
  const [empSearch, setEmpSearch] = useState('')

  const { data: companiesData } = useQuery<{ data: { results: Company[] } }>({
    queryKey: ['companies'],
    queryFn: () => companiesApi.list(),
  })
  const companies = companiesData?.data?.results ?? []

  const { data: deptsData, isLoading } = useQuery<{ data: { results: Department[] } }>({
    queryKey: ['departments', filterCompany],
    queryFn: () =>
      departmentsApi.list(filterCompany ? { company: filterCompany } : {}),
  })
  const departments = deptsData?.data?.results ?? []

  const { data: employeesData } = useQuery<{ data: PaginatedResponse<Employee> }>({
    queryKey: ['employees-autocomplete', form.company, empSearch],
    queryFn: () =>
      employeesApi.list({ company: form.company || undefined, search: empSearch || undefined, page_size: 50 }),
    enabled: dialogOpen,
  })
  const employees = employeesData?.data?.results ?? []

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post('/departments/', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments'] })
      setDialogOpen(false)
      toast({ title: 'Department created' })
    },
    onError: (__err: unknown) => toast({ title: 'Error', description: describeError(__err) || 'Failed to create department.', variant: 'destructive' }),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.patch(`/departments/${id}/`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments'] })
      setDialogOpen(false)
      toast({ title: 'Department updated' })
    },
    onError: (__err: unknown) => toast({ title: 'Error', description: describeError(__err) || 'Failed to update department.', variant: 'destructive' }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/departments/${id}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments'] })
      setDeleteTarget(null)
      toast({ title: 'Department deleted' })
    },
    onError: (__err: unknown) => toast({ title: 'Error', description: describeError(__err) || 'Failed to delete department.', variant: 'destructive' }),
  })

  function openAdd() {
    setEditDept(null)
    setForm({ ...EMPTY_FORM, company: filterCompany })
    setDialogOpen(true)
  }

  function openEdit(dept: Department) {
    setEditDept(dept)
    setForm({
      company: String(dept.company),
      name_en: dept.name_en,
      name_ar: dept.name_ar,
      head_of_dept: String(dept.manager ?? ''),
    })
    setDialogOpen(true)
  }

  function handleSubmit() {
    const payload: Record<string, unknown> = {
      company: Number(form.company),
      name_en: form.name_en,
      name_ar: form.name_ar,
    }
    if (form.head_of_dept) payload.manager = form.head_of_dept

    if (editDept) {
      updateMutation.mutate({ id: editDept.id, data: payload })
    } else {
      createMutation.mutate(payload)
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending

  return (
    <div className="space-y-6">
      <PageHeader
        title="Departments"
        description="Manage organizational departments"
        breadcrumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Departments' }]}
        actions={
          <Button size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={openAdd}>
            <Plus className="h-4 w-4" />
            Add Department
          </Button>
        }
      />

      {/* Filter */}
      <div className="flex items-center gap-3 bg-card rounded-lg border border-border p-4">
        <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">Filter by Company:</label>
        <Select value={filterCompany || 'all'} onValueChange={(v) => setFilterCompany(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="All Companies" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Companies</SelectItem>
            {companies.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>{c.name_en}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading && (
        <div className="bg-card rounded-lg border border-border p-12 text-center text-muted-foreground">
          Loading departments...
        </div>
      )}

      {!isLoading && (
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">ID</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Name (EN)</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Name (AR)</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Company</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Dept Head</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Employees</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {departments.map((dept) => (
                <tr key={dept.id} className="hover:bg-muted/50 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{dept.id}</td>
                  <td className="px-4 py-3 font-medium text-foreground">{dept.name_en}</td>
                  <td className="px-4 py-3 text-foreground dir-rtl">{dept.name_ar}</td>
                  <td className="px-4 py-3 text-foreground">{dept.company_name ?? '—'}</td>
                  <td className="px-4 py-3 text-foreground">{dept.manager_name ?? '—'}</td>
                  <td className="px-4 py-3 text-foreground">{dept.employee_count ?? '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon-sm" onClick={() => openEdit(dept)} title="Edit">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-red-500 hover:text-red-700 hover:bg-red-50"
                        onClick={() => setDeleteTarget(dept)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {departments.length === 0 && (
            <div className="p-12 text-center text-muted-foreground">
              {filterCompany ? 'No departments for this company.' : 'No departments found.'}
            </div>
          )}
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editDept ? 'Edit Department' : 'Add Department'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Company *</Label>
              <Select value={form.company} onValueChange={(v) => setForm((f) => ({ ...f, company: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select company..." />
                </SelectTrigger>
                <SelectContent>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name_en}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Name (English) *</Label>
              <Input
                value={form.name_en}
                onChange={(e) => setForm((f) => ({ ...f, name_en: e.target.value }))}
                placeholder="Department name"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Name (Arabic)</Label>
              <Input
                value={form.name_ar}
                onChange={(e) => setForm((f) => ({ ...f, name_ar: e.target.value }))}
                placeholder="اسم القسم"
                dir="rtl"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Department Head</Label>
              <div className="space-y-2">
                <Input
                  placeholder="Search employees..."
                  value={empSearch}
                  onChange={(e) => setEmpSearch(e.target.value)}
                />
                <Select value={form.head_of_dept || '__none__'} onValueChange={(v) => setForm((f) => ({ ...f, head_of_dept: v === '__none__' ? '' : v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select employee..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— None —</SelectItem>
                    {employees.map((e) => (
                      <SelectItem key={e.id} value={String(e.id)}>
                        {e.full_name_en} ({e.employee_id})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isSaving || !form.name_en.trim() || !form.company}
              loading={isSaving}
            >
              {editDept ? 'Save Changes' : 'Create Department'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete Department"
        description={`Are you sure you want to delete "${deleteTarget?.name_en}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => deleteTarget && deleteMutation.mutateAsync(deleteTarget.id)}
        loading={deleteMutation.isPending}
      />
    </div>
  )
}
