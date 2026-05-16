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

const ACTION_CHOICES = [
  { value: 'verbal_warning', label: 'Verbal Warning' },
  { value: 'written_warning', label: 'Written Warning' },
  { value: 'deduction', label: 'Deduction' },
  { value: 'suspension', label: 'Suspension' },
  { value: 'termination', label: 'Termination' },
]

interface ViolationCategory {
  id: number
  code: string
  name_en: string
  reset_period_months: number
}

interface OffenseConfig {
  action: string
  deduction_pct: number
}

interface ViolationRule {
  id: number
  code: string
  name_en: string
  offense_1: OffenseConfig
  offense_2: OffenseConfig
  offense_3: OffenseConfig
  offense_4: OffenseConfig
  offense_5: OffenseConfig
}

interface CategoryFormData {
  code: string
  name_en: string
  reset_period_months: number
}

interface RuleFormData {
  code: string
  name_en: string
  offense_1_action: string
  offense_1_pct: string
  offense_2_action: string
  offense_2_pct: string
  offense_3_action: string
  offense_3_pct: string
  offense_4_action: string
  offense_4_pct: string
  offense_5_action: string
  offense_5_pct: string
}

const EMPTY_RULE: RuleFormData = {
  code: '', name_en: '',
  offense_1_action: 'verbal_warning', offense_1_pct: '0',
  offense_2_action: 'written_warning', offense_2_pct: '0',
  offense_3_action: 'deduction', offense_3_pct: '25',
  offense_4_action: 'deduction', offense_4_pct: '50',
  offense_5_action: 'termination', offense_5_pct: '0',
}

export default function ViolationsSettingsPage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [selectedCategory, setSelectedCategory] = useState<ViolationCategory | null>(null)
  const [catDialogOpen, setCatDialogOpen] = useState(false)
  const [editCat, setEditCat] = useState<ViolationCategory | null>(null)
  const [deleteCatTarget, setDeleteCatTarget] = useState<ViolationCategory | null>(null)
  const [catForm, setCatForm] = useState<CategoryFormData>({ code: '', name_en: '', reset_period_months: 12 })

  const [ruleDialogOpen, setRuleDialogOpen] = useState(false)
  const [editRule, setEditRule] = useState<ViolationRule | null>(null)
  const [deleteRuleTarget, setDeleteRuleTarget] = useState<ViolationRule | null>(null)
  const [ruleForm, setRuleForm] = useState<RuleFormData>(EMPTY_RULE)
  const [editingCell, setEditingCell] = useState<{ ruleId: number; field: string } | null>(null)

  const { data: catsData } = useQuery<{ data: ViolationCategory[] }>({
    queryKey: ['violation-categories'],
    queryFn: () => api.get('/incidents/violation-categories/'),
  })
  const categories = catsData?.data ?? []

  const { data: rulesData, isLoading: rulesLoading } = useQuery<{ data: ViolationRule[] }>({
    queryKey: ['violation-rules', selectedCategory?.id],
    queryFn: () =>
      api.get('/incidents/violation-rules/', {
        params: { category: selectedCategory?.id },
      }),
    enabled: !!selectedCategory,
  })
  const rules = rulesData?.data ?? []

  // Category mutations
  const createCat = useMutation({
    mutationFn: (data: CategoryFormData) => api.post('/incidents/violation-categories/', data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['violation-categories'] }); setCatDialogOpen(false); toast({ title: 'Category created' }) },
    onError: (__err: unknown) => toast({ title: 'Error', variant: 'destructive', description: describeError(__err) || 'Failed to create category.' }),
  })
  const updateCat = useMutation({
    mutationFn: ({ id, data }: { id: number; data: CategoryFormData }) =>
      api.patch(`/incidents/violation-categories/${id}/`, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['violation-categories'] }); setCatDialogOpen(false); toast({ title: 'Category updated' }) },
    onError: (__err: unknown) => toast({ title: 'Error', variant: 'destructive', description: describeError(__err) || 'Failed to update category.' }),
  })
  const deleteCat = useMutation({
    mutationFn: (id: number) => api.delete(`/incidents/violation-categories/${id}/`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['violation-categories'] }); setDeleteCatTarget(null); setSelectedCategory(null); toast({ title: 'Category deleted' }) },
    onError: (__err: unknown) => toast({ title: 'Error', variant: 'destructive', description: describeError(__err) || 'Failed to delete category.' }),
  })

  // Rule mutations
  function rulePayload(f: RuleFormData) {
    return {
      code: f.code, name_en: f.name_en,
      category: selectedCategory?.id,
      offense_1: { action: f.offense_1_action, deduction_pct: Number(f.offense_1_pct) },
      offense_2: { action: f.offense_2_action, deduction_pct: Number(f.offense_2_pct) },
      offense_3: { action: f.offense_3_action, deduction_pct: Number(f.offense_3_pct) },
      offense_4: { action: f.offense_4_action, deduction_pct: Number(f.offense_4_pct) },
      offense_5: { action: f.offense_5_action, deduction_pct: Number(f.offense_5_pct) },
    }
  }
  const createRule = useMutation({
    mutationFn: (data: ReturnType<typeof rulePayload>) => api.post('/incidents/violation-rules/', data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['violation-rules'] }); setRuleDialogOpen(false); toast({ title: 'Rule created' }) },
    onError: (__err: unknown) => toast({ title: 'Error', variant: 'destructive', description: describeError(__err) || 'Failed to create rule.' }),
  })
  const updateRule = useMutation({
    mutationFn: ({ id, data }: { id: number; data: ReturnType<typeof rulePayload> }) =>
      api.patch(`/incidents/violation-rules/${id}/`, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['violation-rules'] }); setRuleDialogOpen(false); toast({ title: 'Rule updated' }) },
    onError: (__err: unknown) => toast({ title: 'Error', variant: 'destructive', description: describeError(__err) || 'Failed to update rule.' }),
  })
  const deleteRule = useMutation({
    mutationFn: (id: number) => api.delete(`/incidents/violation-rules/${id}/`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['violation-rules'] }); setDeleteRuleTarget(null); toast({ title: 'Rule deleted' }) },
    onError: (__err: unknown) => toast({ title: 'Error', variant: 'destructive', description: describeError(__err) || 'Failed to delete rule.' }),
  })

  function openAddCat() {
    setEditCat(null)
    setCatForm({ code: '', name_en: '', reset_period_months: 12 })
    setCatDialogOpen(true)
  }
  function openEditCat(cat: ViolationCategory) {
    setEditCat(cat)
    setCatForm({ code: cat.code, name_en: cat.name_en, reset_period_months: cat.reset_period_months })
    setCatDialogOpen(true)
  }

  function openAddRule() {
    setEditRule(null)
    setRuleForm(EMPTY_RULE)
    setRuleDialogOpen(true)
  }
  function openEditRule(rule: ViolationRule) {
    setEditRule(rule)
    setRuleForm({
      code: rule.code, name_en: rule.name_en,
      offense_1_action: rule.offense_1.action, offense_1_pct: String(rule.offense_1.deduction_pct),
      offense_2_action: rule.offense_2.action, offense_2_pct: String(rule.offense_2.deduction_pct),
      offense_3_action: rule.offense_3.action, offense_3_pct: String(rule.offense_3.deduction_pct),
      offense_4_action: rule.offense_4.action, offense_4_pct: String(rule.offense_4.deduction_pct),
      offense_5_action: rule.offense_5.action, offense_5_pct: String(rule.offense_5.deduction_pct),
    })
    setRuleDialogOpen(true)
  }

  const OFFENSES = [1, 2, 3, 4, 5] as const

  return (
    <div className="space-y-6">
      <PageHeader
        title="Violation Rules"
        description="Configure violation categories and escalation rules"
        breadcrumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Violations' }]}
      />

      <div className="flex gap-6">
        {/* Left: Categories */}
        <div className="w-80 shrink-0 bg-card rounded-lg border border-border flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">Violation Categories</h2>
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
                  'group flex items-start gap-2 px-4 py-3 cursor-pointer border-b border-border/60 hover:bg-muted/50 transition-colors',
                  selectedCategory?.id === cat.id && 'bg-blue-50 border-l-2 border-l-blue-500'
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground bg-muted px-1 rounded">{cat.code}</span>
                    <span className="text-sm font-medium text-foreground truncate">{cat.name_en}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Reset: every {cat.reset_period_months} month{cat.reset_period_months !== 1 ? 's' : ''}
                  </div>
                </div>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <Button variant="ghost" size="icon-sm" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); openEditCat(cat) }}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="h-6 w-6 text-red-500"
                    onClick={(e) => { e.stopPropagation(); setDeleteCatTarget(cat) }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
                {selectedCategory?.id === cat.id && (
                  <ChevronRight className="h-4 w-4 text-blue-500 shrink-0 self-center" />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Right: Rules */}
        <div className="flex-1 bg-card rounded-lg border border-border flex flex-col">
          {!selectedCategory ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm p-8">
              Select a violation category to view its rules.
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">
                    Rules for: {selectedCategory.name_en}
                  </h2>
                  <p className="text-xs text-muted-foreground">{rules.length} rule{rules.length !== 1 ? 's' : ''}</p>
                </div>
                <Button size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={openAddRule}>
                  <Plus className="h-4 w-4" />
                  Add Rule
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
                        <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground uppercase whitespace-nowrap">Code</th>
                        <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground uppercase whitespace-nowrap">Rule Name</th>
                        {OFFENSES.map((n) => (
                          <th key={n} className="px-3 py-2.5 text-center font-semibold text-muted-foreground uppercase whitespace-nowrap">
                            {n}{n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'} Offense
                          </th>
                        ))}
                        <th className="px-3 py-2.5 text-right font-semibold text-muted-foreground uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {rules.map((rule) => (
                        <tr key={rule.id} className="hover:bg-muted/50">
                          <td className="px-3 py-2.5 font-mono text-muted-foreground">{rule.code}</td>
                          <td className="px-3 py-2.5 font-medium text-foreground whitespace-nowrap">{rule.name_en}</td>
                          {OFFENSES.map((n) => {
                            const offense = rule[`offense_${n}` as keyof ViolationRule] as OffenseConfig
                            return (
                              <td key={n} className="px-3 py-2.5 text-center">
                                <div className="text-foreground capitalize">{offense.action.replace(/_/g, ' ')}</div>
                                {offense.deduction_pct > 0 && (
                                  <div className="text-red-600 font-medium">{offense.deduction_pct}%</div>
                                )}
                              </td>
                            )
                          })}
                          <td className="px-3 py-2.5">
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" size="icon-sm" className="h-6 w-6" onClick={() => openEditRule(rule)}>
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="h-6 w-6 text-red-500"
                                onClick={() => setDeleteRuleTarget(rule)}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
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
          <DialogHeader>
            <DialogTitle>{editCat ? 'Edit Category' : 'Add Category'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Code *</Label>
              <Input value={catForm.code} onChange={(e) => setCatForm((f) => ({ ...f, code: e.target.value }))} placeholder="e.g. DISC" />
            </div>
            <div className="space-y-1.5">
              <Label>Name (English) *</Label>
              <Input value={catForm.name_en} onChange={(e) => setCatForm((f) => ({ ...f, name_en: e.target.value }))} placeholder="Category name" />
            </div>
            <div className="space-y-1.5">
              <Label>Reset Period (months)</Label>
              <Input
                type="number" min={1} max={60}
                value={catForm.reset_period_months}
                onChange={(e) => setCatForm((f) => ({ ...f, reset_period_months: Number(e.target.value) }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCatDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => editCat ? updateCat.mutate({ id: editCat.id, data: catForm }) : createCat.mutate(catForm)}
              disabled={!catForm.code || !catForm.name_en || createCat.isPending || updateCat.isPending}
              loading={createCat.isPending || updateCat.isPending}
            >
              {editCat ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rule Dialog */}
      <Dialog open={ruleDialogOpen} onOpenChange={setRuleDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editRule ? 'Edit Rule' : 'Add Rule'} — {selectedCategory?.name_en}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Code *</Label>
                <Input value={ruleForm.code} onChange={(e) => setRuleForm((f) => ({ ...f, code: e.target.value }))} placeholder="e.g. DISC-001" />
              </div>
              <div className="space-y-1.5">
                <Label>Rule Name *</Label>
                <Input value={ruleForm.name_en} onChange={(e) => setRuleForm((f) => ({ ...f, name_en: e.target.value }))} placeholder="Rule name" />
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-sm font-semibold text-foreground">Offense Escalation</p>
              {OFFENSES.map((n) => (
                <div key={n} className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground w-20 shrink-0">
                    {n}{n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'} Offense
                  </span>
                  <Select
                    value={ruleForm[`offense_${n}_action` as keyof RuleFormData]}
                    onValueChange={(v) => setRuleForm((f) => ({ ...f, [`offense_${n}_action`]: v }))}
                  >
                    <SelectTrigger className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ACTION_CHOICES.map((a) => (
                        <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex items-center gap-1.5">
                    <Input
                      type="number" min={0} max={100} className="w-20"
                      value={ruleForm[`offense_${n}_pct` as keyof RuleFormData]}
                      onChange={(e) => setRuleForm((f) => ({ ...f, [`offense_${n}_pct`]: e.target.value }))}
                    />
                    <span className="text-sm text-muted-foreground">% deduction</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRuleDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                const payload = rulePayload(ruleForm)
                editRule ? updateRule.mutate({ id: editRule.id, data: payload }) : createRule.mutate(payload)
              }}
              disabled={!ruleForm.code || !ruleForm.name_en || createRule.isPending || updateRule.isPending}
              loading={createRule.isPending || updateRule.isPending}
            >
              {editRule ? 'Save' : 'Create Rule'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteCatTarget}
        onOpenChange={(o) => !o && setDeleteCatTarget(null)}
        title="Delete Category"
        description={`Delete "${deleteCatTarget?.name_en}" and all its rules? This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => deleteCatTarget && deleteCat.mutateAsync(deleteCatTarget.id)}
        loading={deleteCat.isPending}
      />
      <ConfirmDialog
        open={!!deleteRuleTarget}
        onOpenChange={(o) => !o && setDeleteRuleTarget(null)}
        title="Delete Rule"
        description={`Delete rule "${deleteRuleTarget?.name_en}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => deleteRuleTarget && deleteRule.mutateAsync(deleteRuleTarget.id)}
        loading={deleteRule.isPending}
      />
    </div>
  )
}
