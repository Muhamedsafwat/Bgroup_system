'use client'

import { describeError } from "@/lib/zod-errors";

import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, ChevronRight } from 'lucide-react'
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
import api from '@/lib/hr/api'
import { cn } from '@/lib/hr/utils'

const VALUE_TYPES = [
  { value: 'fixed', label: 'Fixed Amount' },
  { value: 'percentage', label: 'Percentage of Salary' },
]

const FREQUENCIES = [
  { value: 'once', label: 'One Time' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'annual', label: 'Annual' },
]

const APPROVAL_AUTHORITIES = [
  { value: 'hr', label: 'HR Manager' },
  { value: 'team_lead', label: 'Team Lead' },
  { value: 'ceo', label: 'CEO' },
  { value: 'auto', label: 'Automatic' },
]

interface BonusCategory {
  id: number
  code: string
  name_en: string
}

interface BonusRule {
  id: number
  code: string
  name_en: string
  value_type: string
  value: number
  frequency: string
  max_per_month: number | null
  approval_authority: string
}

interface CatFormData {
  code: string
  name_en: string
}

interface RuleFormData {
  code: string
  name_en: string
  value_type: string
  value: string
  frequency: string
  max_per_month: string
  approval_authority: string
}

const EMPTY_RULE: RuleFormData = {
  code: '', name_en: '', value_type: 'fixed', value: '0',
  frequency: 'once', max_per_month: '', approval_authority: 'hr',
}

export default function BonusesSettingsPage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [selectedCategory, setSelectedCategory] = useState<BonusCategory | null>(null)
  const [catDialogOpen, setCatDialogOpen] = useState(false)
  const [editCat, setEditCat] = useState<BonusCategory | null>(null)
  const [deleteCatTarget, setDeleteCatTarget] = useState<BonusCategory | null>(null)
  const [catForm, setCatForm] = useState<CatFormData>({ code: '', name_en: '' })

  const [ruleDialogOpen, setRuleDialogOpen] = useState(false)
  const [editRule, setEditRule] = useState<BonusRule | null>(null)
  const [deleteRuleTarget, setDeleteRuleTarget] = useState<BonusRule | null>(null)
  const [ruleForm, setRuleForm] = useState<RuleFormData>(EMPTY_RULE)

  const { data: catsData } = useQuery<{ data: BonusCategory[] }>({
    queryKey: ['bonus-categories'],
    queryFn: () => api.get('/bonuses/categories/'),
  })
  const categories = catsData?.data ?? []

  const { data: rulesData, isLoading: rulesLoading } = useQuery<{ data: BonusRule[] }>({
    queryKey: ['bonus-rules', selectedCategory?.id],
    queryFn: () =>
      api.get('/bonuses/rules/', { params: { category: selectedCategory?.id } }),
    enabled: !!selectedCategory,
  })
  const rules = rulesData?.data ?? []

  const createCat = useMutation({
    mutationFn: (data: CatFormData) => api.post('/bonuses/categories/', data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['bonus-categories'] }); setCatDialogOpen(false); toast({ title: 'Category created' }) },
    onError: (__err: unknown) => toast({ title: 'Error', variant: 'destructive', description: describeError(__err) || 'Failed to create category.' }),
  })
  const updateCat = useMutation({
    mutationFn: ({ id, data }: { id: number; data: CatFormData }) => api.patch(`/bonuses/categories/${id}/`, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['bonus-categories'] }); setCatDialogOpen(false); toast({ title: 'Category updated' }) },
    onError: (__err: unknown) => toast({ title: 'Error', variant: 'destructive', description: describeError(__err) || 'Failed to update category.' }),
  })
  const deleteCat = useMutation({
    mutationFn: (id: number) => api.delete(`/bonuses/categories/${id}/`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['bonus-categories'] }); setDeleteCatTarget(null); setSelectedCategory(null); toast({ title: 'Category deleted' }) },
    onError: (__err: unknown) => toast({ title: 'Error', variant: 'destructive', description: describeError(__err) || 'Failed to delete category.' }),
  })

  const createRule = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post('/bonuses/rules/', data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['bonus-rules'] }); setRuleDialogOpen(false); toast({ title: 'Rule created' }) },
    onError: (__err: unknown) => toast({ title: 'Error', variant: 'destructive', description: describeError(__err) || 'Failed to create rule.' }),
  })
  const updateRule = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) => api.patch(`/bonuses/rules/${id}/`, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['bonus-rules'] }); setRuleDialogOpen(false); toast({ title: 'Rule updated' }) },
    onError: (__err: unknown) => toast({ title: 'Error', variant: 'destructive', description: describeError(__err) || 'Failed to update rule.' }),
  })
  const deleteRule = useMutation({
    mutationFn: (id: number) => api.delete(`/bonuses/rules/${id}/`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['bonus-rules'] }); setDeleteRuleTarget(null); toast({ title: 'Rule deleted' }) },
    onError: (__err: unknown) => toast({ title: 'Error', variant: 'destructive', description: describeError(__err) || 'Failed to delete rule.' }),
  })

  function buildRulePayload(f: RuleFormData) {
    return {
      code: f.code, name_en: f.name_en,
      value_type: f.value_type,
      value: Number(f.value),
      frequency: f.frequency,
      max_per_month: f.max_per_month ? Number(f.max_per_month) : null,
      approval_authority: f.approval_authority,
      category: selectedCategory?.id,
    }
  }

  function openAddCat() { setEditCat(null); setCatForm({ code: '', name_en: '' }); setCatDialogOpen(true) }
  function openEditCat(cat: BonusCategory) { setEditCat(cat); setCatForm({ code: cat.code, name_en: cat.name_en }); setCatDialogOpen(true) }
  function openAddRule() { setEditRule(null); setRuleForm(EMPTY_RULE); setRuleDialogOpen(true) }
  function openEditRule(rule: BonusRule) {
    setEditRule(rule)
    setRuleForm({
      code: rule.code, name_en: rule.name_en, value_type: rule.value_type,
      value: String(rule.value), frequency: rule.frequency,
      max_per_month: rule.max_per_month != null ? String(rule.max_per_month) : '',
      approval_authority: rule.approval_authority,
    })
    setRuleDialogOpen(true)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bonus Rules"
        description="Configure bonus categories and calculation rules"
        breadcrumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Bonuses' }]}
      />

      <div className="flex gap-6">
        {/* Left: Categories */}
        <div className="w-72 shrink-0 bg-card rounded-lg border border-border flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">Bonus Categories</h2>
            <Button variant="ghost" size="icon-sm" onClick={openAddCat} title="Add category">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {categories.length === 0 && (
              <div className="p-8 text-center text-sm text-muted-foreground">No categories yet.</div>
            )}
            {categories.map((cat) => (
              <div
                key={cat.id}
                onClick={() => setSelectedCategory(cat)}
                className={cn(
                  'group flex items-center gap-2 px-4 py-3 cursor-pointer border-b border-border/60 hover:bg-muted/50 transition-colors',
                  selectedCategory?.id === cat.id && 'bg-emerald-50 border-l-2 border-l-emerald-500'
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground bg-muted px-1 rounded">{cat.code}</span>
                    <span className="text-sm font-medium text-foreground truncate">{cat.name_en}</span>
                  </div>
                </div>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 shrink-0">
                  <Button variant="ghost" size="icon-sm" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); openEditCat(cat) }}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button variant="ghost" size="icon-sm" className="h-6 w-6 text-red-500" onClick={(e) => { e.stopPropagation(); setDeleteCatTarget(cat) }}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
                {selectedCategory?.id === cat.id && <ChevronRight className="h-4 w-4 text-emerald-500 shrink-0" />}
              </div>
            ))}
          </div>
        </div>

        {/* Right: Rules */}
        <div className="flex-1 bg-card rounded-lg border border-border flex flex-col">
          {!selectedCategory ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm p-8">
              Select a bonus category to view its rules.
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Rules for: {selectedCategory.name_en}</h2>
                  <p className="text-xs text-muted-foreground">{rules.length} rule{rules.length !== 1 ? 's' : ''}</p>
                </div>
                <Button size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={openAddRule}>
                  <Plus className="h-4 w-4" />Add Rule
                </Button>
              </div>

              {rulesLoading ? (
                <div className="p-8 text-center text-muted-foreground">Loading rules...</div>
              ) : rules.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">No rules for this category.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 border-b border-border">
                      <tr>
                        {['Code', 'Name', 'Value Type', 'Value', 'Frequency', 'Max/Month', 'Approval', ''].map((h) => (
                          <th key={h} className="px-3 py-2.5 text-left font-semibold text-muted-foreground uppercase whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {rules.map((rule) => (
                        <tr key={rule.id} className="hover:bg-muted/50">
                          <td className="px-3 py-2.5 font-mono text-muted-foreground">{rule.code}</td>
                          <td className="px-3 py-2.5 font-medium text-foreground whitespace-nowrap">{rule.name_en}</td>
                          <td className="px-3 py-2.5 capitalize">{rule.value_type.replace(/_/g, ' ')}</td>
                          <td className="px-3 py-2.5 text-emerald-700 font-medium">
                            {rule.value_type === 'percentage' ? `${rule.value}%` : `EGP ${rule.value.toLocaleString()}`}
                          </td>
                          <td className="px-3 py-2.5 capitalize">{rule.frequency.replace(/_/g, ' ')}</td>
                          <td className="px-3 py-2.5">{rule.max_per_month ?? '—'}</td>
                          <td className="px-3 py-2.5 capitalize">{rule.approval_authority}</td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-1">
                              <Button variant="ghost" size="icon-sm" className="h-6 w-6" onClick={() => openEditRule(rule)}><Pencil className="h-3 w-3" /></Button>
                              <Button variant="ghost" size="icon-sm" className="h-6 w-6 text-red-500" onClick={() => setDeleteRuleTarget(rule)}><Trash2 className="h-3 w-3" /></Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Category Dialog */}
      <Dialog open={catDialogOpen} onOpenChange={setCatDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{editCat ? 'Edit Category' : 'Add Category'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Code *</Label>
              <Input value={catForm.code} onChange={(e) => setCatForm((f) => ({ ...f, code: e.target.value }))} placeholder="e.g. PERF" />
            </div>
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input value={catForm.name_en} onChange={(e) => setCatForm((f) => ({ ...f, name_en: e.target.value }))} placeholder="Category name" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCatDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => editCat ? updateCat.mutate({ id: editCat.id, data: catForm }) : createCat.mutate(catForm)} disabled={!catForm.code || !catForm.name_en} loading={createCat.isPending || updateCat.isPending}>
              {editCat ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rule Dialog */}
      <Dialog open={ruleDialogOpen} onOpenChange={setRuleDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editRule ? 'Edit Rule' : 'Add Rule'} — {selectedCategory?.name_en}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Code *</Label>
                <Input value={ruleForm.code} onChange={(e) => setRuleForm((f) => ({ ...f, code: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Name *</Label>
                <Input value={ruleForm.name_en} onChange={(e) => setRuleForm((f) => ({ ...f, name_en: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Value Type</Label>
                <Select value={ruleForm.value_type} onValueChange={(v) => setRuleForm((f) => ({ ...f, value_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{VALUE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Value {ruleForm.value_type === 'percentage' ? '(%)' : '(EGP)'}</Label>
                <Input type="number" min={0} value={ruleForm.value} onChange={(e) => setRuleForm((f) => ({ ...f, value: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Frequency</Label>
                <Select value={ruleForm.frequency} onValueChange={(v) => setRuleForm((f) => ({ ...f, frequency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{FREQUENCIES.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Max per Month</Label>
                <Input type="number" min={0} value={ruleForm.max_per_month} placeholder="Unlimited" onChange={(e) => setRuleForm((f) => ({ ...f, max_per_month: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Approval Authority</Label>
              <Select value={ruleForm.approval_authority} onValueChange={(v) => setRuleForm((f) => ({ ...f, approval_authority: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{APPROVAL_AUTHORITIES.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRuleDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => { const p = buildRulePayload(ruleForm); editRule ? updateRule.mutate({ id: editRule.id, data: p }) : createRule.mutate(p) }} disabled={!ruleForm.code || !ruleForm.name_en} loading={createRule.isPending || updateRule.isPending}>
              {editRule ? 'Save' : 'Create Rule'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={!!deleteCatTarget} onOpenChange={(o) => !o && setDeleteCatTarget(null)} title="Delete Category" description={`Delete "${deleteCatTarget?.name_en}" and all its rules?`} confirmLabel="Delete" variant="destructive" onConfirm={() => deleteCatTarget && deleteCat.mutateAsync(deleteCatTarget.id)} loading={deleteCat.isPending} />
      <ConfirmDialog open={!!deleteRuleTarget} onOpenChange={(o) => !o && setDeleteRuleTarget(null)} title="Delete Rule" description={`Delete rule "${deleteRuleTarget?.name_en}"?`} confirmLabel="Delete" variant="destructive" onConfirm={() => deleteRuleTarget && deleteRule.mutateAsync(deleteRuleTarget.id)} loading={deleteRule.isPending} />
    </div>
  )
}
