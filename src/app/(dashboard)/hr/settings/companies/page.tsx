'use client'

import { describeError } from "@/lib/zod-errors";

import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Building2 } from 'lucide-react'
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
import { useToast } from '@/components/hr/ui/toast'
import api, { companiesApi } from '@/lib/hr/api'
import type { Company } from '@/lib/hr/types'

interface CompanyFormData {
  name_en: string
  name_ar: string
  industry: string
  address: string
  phone: string
  email: string
  tax_id: string
  is_active: boolean
}

const EMPTY_FORM: CompanyFormData = {
  name_en: '',
  name_ar: '',
  industry: '',
  address: '',
  phone: '',
  email: '',
  tax_id: '',
  is_active: true,
}

export default function CompaniesSettingsPage() {
  const { locale } = useLocale()
  const isAr = locale === 'ar'
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editCompany, setEditCompany] = useState<Company | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Company | null>(null)
  const [form, setForm] = useState<CompanyFormData>(EMPTY_FORM)
  const [logoFile, setLogoFile] = useState<File | null>(null)

  const { data, isLoading } = useQuery<{ data: { results: Company[] } }>({
    queryKey: ['companies'],
    queryFn: () => companiesApi.list(),
  })
  const companies = data?.data?.results ?? []

  const createMutation = useMutation({
    mutationFn: (formData: FormData) =>
      api.post('/companies/', formData, {
        
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] })
      setDialogOpen(false)
      toast({ title: 'Company created', description: `${form.name_en} has been added.` })
    },
    onError: (__err: unknown) => toast({ title: 'Error', description: describeError(__err) || 'Failed to create company.', variant: 'destructive' }),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: FormData }) =>
      api.patch(`/companies/${id}/`, data, {
        
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] })
      setDialogOpen(false)
      toast({ title: 'Company updated', description: `${form.name_en} has been updated.` })
    },
    onError: (__err: unknown) => toast({ title: 'Error', description: describeError(__err) || 'Failed to update company.', variant: 'destructive' }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/companies/${id}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] })
      setDeleteTarget(null)
      toast({ title: 'Company deleted' })
    },
    onError: (__err: unknown) => toast({ title: 'Error', description: describeError(__err) || 'Failed to delete company.', variant: 'destructive' }),
  })

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      api.patch(`/companies/${id}/`, { is_active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['companies'] }),
  })

  function openAdd() {
    setEditCompany(null)
    setForm(EMPTY_FORM)
    setLogoFile(null)
    setDialogOpen(true)
  }

  function openEdit(company: Company) {
    setEditCompany(company)
    setForm({
      name_en: company.name_en,
      name_ar: company.name_ar,
      industry: '',
      address: '',
      phone: '',
      email: '',
      tax_id: '',
      is_active: company.is_active,
    })
    setLogoFile(null)
    setDialogOpen(true)
  }

  function buildFormData(): FormData {
    const fd = new FormData()
    Object.entries(form).forEach(([k, v]) => fd.append(k, String(v)))
    if (logoFile) fd.append('logo', logoFile)
    return fd
  }

  function handleSubmit() {
    const fd = buildFormData()
    if (editCompany) {
      updateMutation.mutate({ id: editCompany.id, data: fd })
    } else {
      createMutation.mutate(fd)
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending

  return (
    <div className="space-y-6">
      <PageHeader
        title={isAr ? 'الشركات' : 'Companies'}
        description="Manage subsidiary companies and group entities"
        breadcrumbs={[{ label: isAr ? 'الإعدادات' : 'Settings', href: '/settings' }, { label: isAr ? 'الشركات' : 'Companies' }]}
        actions={
          <Button size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={openAdd}>
            <Plus className="h-4 w-4" />
            Add Company
          </Button>
        }
      />

      {isLoading && (
        <div className="bg-card rounded-lg border border-border p-12 text-center text-muted-foreground">
          Loading companies...
        </div>
      )}

      {!isLoading && (
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">ID</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Logo</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Name (EN)</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Name (AR)</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Employees</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {companies.map((company) => (
                <tr key={company.id} className="hover:bg-muted/50 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{company.id}</td>
                  <td className="px-4 py-3">
                    {company.logo ? (
                      <img
                        src={company.logo}
                        alt={company.name_en}
                        className="h-8 w-8 rounded object-contain border border-border"
                      />
                    ) : (
                      <div className="h-8 w-8 rounded bg-muted flex items-center justify-center">
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 font-medium text-foreground">{company.name_en}</td>
                  <td className="px-4 py-3 text-foreground dir-rtl">{company.name_ar}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() =>
                        toggleActiveMutation.mutate({ id: company.id, is_active: !company.is_active })
                      }
                      className="flex items-center gap-2"
                    >
                      <div
                        className={`relative h-5 w-9 rounded-full transition-colors ${
                          company.is_active ? 'bg-emerald-500' : 'bg-slate-300'
                        }`}
                      >
                        <div
                          className={`absolute top-0.5 h-4 w-4 rounded-full bg-card shadow transition-all ${
                            company.is_active ? 'left-4' : 'left-0.5'
                          }`}
                        />
                      </div>
                      <Badge variant={company.is_active ? 'success' : 'default'} className="text-xs">
                        {company.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </button>
                  </td>
                  <td className="px-4 py-3 text-foreground">{company.employee_count ?? '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon-sm" onClick={() => openEdit(company)} title="Edit">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-red-500 hover:text-red-700 hover:bg-red-50"
                        onClick={() => setDeleteTarget(company)}
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {companies.length === 0 && (
            <div className="p-12 text-center text-muted-foreground">No companies found. Add one to get started.</div>
          )}
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editCompany ? 'Edit Company' : 'Add Company'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Name (English) *</Label>
                <Input
                  value={form.name_en}
                  onChange={(e) => setForm((f) => ({ ...f, name_en: e.target.value }))}
                  placeholder="Company Name"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Name (Arabic)</Label>
                <Input
                  value={form.name_ar}
                  onChange={(e) => setForm((f) => ({ ...f, name_ar: e.target.value }))}
                  placeholder="اسم الشركة"
                  dir="rtl"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Industry</Label>
              <Input
                value={form.industry}
                onChange={(e) => setForm((f) => ({ ...f, industry: e.target.value }))}
                placeholder="e.g. Technology, Construction"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Address</Label>
              <Input
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                placeholder="Full address"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="+20..."
                />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="info@company.com"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Tax ID</Label>
              <Input
                value={form.tax_id}
                onChange={(e) => setForm((f) => ({ ...f, tax_id: e.target.value }))}
                placeholder="Tax registration number"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Logo</Label>
              <input
                type="file"
                accept="image/*"
                className="block w-full text-sm text-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:bg-muted file:text-foreground hover:file:bg-slate-200"
                onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
              />
            </div>

            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                  className="h-4 w-4 rounded border-border text-emerald-600"
                />
                <span className="text-sm font-medium text-foreground">Active</span>
              </label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isSaving || !form.name_en.trim()}
              loading={isSaving}
            >
              {editCompany ? 'Save Changes' : 'Create Company'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete Company"
        description={`Are you sure you want to delete "${deleteTarget?.name_en}"? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => deleteTarget && deleteMutation.mutateAsync(deleteTarget.id)}
        loading={deleteMutation.isPending}
      />
    </div>
  )
}
