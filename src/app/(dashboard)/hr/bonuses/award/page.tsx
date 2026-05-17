'use client'

import { describeError } from "@/lib/zod-errors";

import React, { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Check, ChevronRight, User, Gift, FileText, Send } from 'lucide-react'
import api from '@/lib/hr/api'
import { formatDate, formatCurrency, cn } from '@/lib/hr/utils'
import { PageHeader } from '@/components/hr/shared/PageHeader'
import { FileUpload } from '@/components/hr/shared/FileUpload'
import { Button } from '@/components/hr/ui/button'
import { Input } from '@/components/hr/ui/input'
import { Label } from '@/components/hr/ui/label'
import { Textarea } from '@/components/hr/ui/textarea'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/hr/ui/avatar'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/hr/ui/select'
import { toast } from '@/components/hr/ui/toast'

interface EmployeeOption {
  id: number
  employee_id: string
  full_name_en: string
  photo: string | null
  position_en: string
  department_name: string
  company_name: string
  base_salary: number
}

interface BonusCategory {
  id: number
  name: string
}

interface BonusRule {
  id: number
  name_en: string
  category: number
  calculation_type: 'fixed' | 'percentage'
  default_amount: number
  percentage_of_salary?: number
  description?: string
}

const STEPS = [
  { id: 1, label: 'Select Employee', icon: User },
  { id: 2, label: 'Select Bonus', icon: Gift },
  { id: 3, label: 'Details', icon: FileText },
  { id: 4, label: 'Review & Submit', icon: Send },
]

function StepIndicator({ currentStep }: { currentStep: number }) {
  return (
    <div className="flex items-center gap-0 mb-8">
      {STEPS.map((step, i) => (
        <React.Fragment key={step.id}>
          <div className="flex flex-col items-center">
            <div className={cn(
              'h-10 w-10 rounded-full flex items-center justify-center border-2 font-semibold text-sm transition-all',
              currentStep > step.id ? 'bg-emerald-600 border-emerald-600 text-white' :
              currentStep === step.id ? 'border-emerald-600 text-emerald-600 bg-emerald-50' :
              'border-border text-muted-foreground bg-card'
            )}>
              {currentStep > step.id ? <Check className="h-5 w-5" /> : step.id}
            </div>
            <span className={cn(
              'mt-1.5 text-xs font-medium whitespace-nowrap',
              currentStep === step.id ? 'text-emerald-700' :
              currentStep > step.id ? 'text-muted-foreground' : 'text-muted-foreground'
            )}>
              {step.label}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <div className={cn(
              'flex-1 h-0.5 mt-[-12px] mx-2 transition-all',
              currentStep > step.id ? 'bg-emerald-600' : 'bg-slate-200'
            )} />
          )}
        </React.Fragment>
      ))}
    </div>
  )
}

export default function AwardBonusPage() {
  const [step, setStep] = useState(1)
  const [employeeSearch, setEmployeeSearch] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeOption | null>(null)
  const [selectedCategory, setSelectedCategory] = useState('')
  const [selectedRule, setSelectedRule] = useState<BonusRule | null>(null)
  const [bonusDate, setBonusDate] = useState(new Date().toISOString().split('T')[0])
  const [comments, setComments] = useState('')
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([])
  const [submittedId, setSubmittedId] = useState<number | null>(null)
  const searchRef = useRef<HTMLDivElement>(null)

  const { data: searchResults } = useQuery<{ results: EmployeeOption[] }>({
    queryKey: ['employees', 'search', employeeSearch],
    queryFn: async () => {
      const res = await api.get('/employees/', { params: { search: employeeSearch, page_size: 8 } })
      return res.data
    },
    enabled: employeeSearch.length >= 2,
  })

  const { data: categories } = useQuery<BonusCategory[]>({
    queryKey: ['bonuses', 'bonus-categories'],
    queryFn: async () => {
      const res = await api.get('/bonuses/bonus-categories/')
      return Array.isArray(res.data) ? res.data : res.data.results ?? []
    },
  })

  const { data: bonusRules } = useQuery<BonusRule[]>({
    queryKey: ['bonuses', 'bonus-rules', selectedCategory],
    queryFn: async () => {
      const res = await api.get('/bonuses/bonus-rules/', {
        params: selectedCategory ? { category: selectedCategory } : {},
      })
      return Array.isArray(res.data) ? res.data : res.data.results ?? []
    },
    enabled: !!selectedCategory,
  })

  const submitMutation = useMutation({
    mutationFn: async () => {
      const calculatedAmount = selectedRule
        ? selectedRule.calculation_type === 'fixed'
          ? selectedRule.default_amount
          : ((selectedRule.percentage_of_salary ?? 0) / 100) * (selectedEmployee?.base_salary ?? 0)
        : 0

      const formData = new FormData()
      formData.append('employee', String(selectedEmployee!.id))
      formData.append('bonus_rule', String(selectedRule!.id))
      formData.append('bonus_date', bonusDate)
      formData.append('bonus_amount', String(calculatedAmount))
      if (comments) formData.append('comments', comments)
      evidenceFiles.forEach(f => formData.append('evidence', f))

      const res = await api.post('/bonuses/bonuses/', formData, {
        
      })
      return res.data
    },
    onSuccess: (data) => {
      setSubmittedId(data.id)
      toast.success('Bonus awarded successfully')
    },
    onError: (__err: unknown) => toast.error(describeError(__err) || 'Failed to award bonus'),
  })

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const employees: EmployeeOption[] = Array.isArray(searchResults) ? searchResults : searchResults?.results ?? []

  function getInitials(name: string) {
    return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
  }

  const calculatedAmount = selectedRule && selectedEmployee
    ? selectedRule.calculation_type === 'fixed'
      ? selectedRule.default_amount
      : ((selectedRule.percentage_of_salary ?? 0) / 100) * selectedEmployee.base_salary
    : 0

  if (submittedId) {
    return (
      <div className="space-y-6">
        <PageHeader title="Award Bonus" breadcrumbs={[{ label: 'Bonuses' }, { label: 'Award' }]} />
        <div className="bg-card rounded-xl border border-border p-12 text-center max-w-lg mx-auto">
          <div className="h-16 w-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
            <Check className="h-8 w-8 text-emerald-600" />
          </div>
          <h2 className="text-xl font-bold text-foreground mb-2">Bonus Awarded</h2>
          <p className="text-muted-foreground mb-1">Bonus ID: <span className="font-mono font-semibold text-foreground">#{submittedId}</span></p>
          <p className="text-muted-foreground text-sm mb-6">The bonus has been recorded and will be processed.</p>
          <div className="flex justify-center gap-3">
            <Button variant="outline" onClick={() => {
              setStep(1); setSelectedEmployee(null); setSelectedRule(null)
              setSelectedCategory(''); setComments(''); setEvidenceFiles([])
              setSubmittedId(null); setEmployeeSearch('')
            }}>
              Award Another
            </Button>
            <Button onClick={() => window.location.href = '/hr/bonuses/all'}>
              View All Bonuses
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Award Bonus"
        description="Award a bonus to an employee using the 4-step guided process"
        breadcrumbs={[{ label: 'Bonuses' }, { label: 'Award Bonus' }]}
      />

      <div className="max-w-2xl mx-auto">
        <StepIndicator currentStep={step} />

        <div className="bg-card rounded-xl border border-border p-6">
          {/* Step 1: Select Employee */}
          {step === 1 && (
            <div className="space-y-5">
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                <User className="h-5 w-5 text-emerald-600" /> Select Employee
              </h2>

              <div ref={searchRef} className="relative">
                <Label>Search Employee</Label>
                <Input
                  className="mt-1"
                  placeholder="Type name or employee ID..."
                  value={employeeSearch}
                  onChange={e => { setEmployeeSearch(e.target.value); setShowDropdown(true) }}
                  onFocus={() => setShowDropdown(true)}
                />
                {showDropdown && employees.length > 0 && (
                  <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-card border border-border rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {employees.map(emp => (
                      <button
                        key={emp.id}
                        type="button"
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 text-left transition-colors"
                        onClick={() => {
                          setSelectedEmployee(emp)
                          setEmployeeSearch(emp.full_name_en)
                          setShowDropdown(false)
                        }}
                      >
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={emp.photo ?? undefined} />
                          <AvatarFallback className="text-xs">{getInitials(emp.full_name_en)}</AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-sm font-medium">{emp.full_name_en}</p>
                          <p className="text-xs text-muted-foreground">{emp.employee_id} • {emp.department_name}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {selectedEmployee && (
                <div className="flex items-center gap-4 p-4 rounded-lg bg-emerald-50 border border-emerald-200">
                  <Avatar className="h-14 w-14">
                    <AvatarImage src={selectedEmployee.photo ?? undefined} />
                    <AvatarFallback>{getInitials(selectedEmployee.full_name_en)}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-semibold text-foreground">{selectedEmployee.full_name_en}</p>
                    <p className="text-sm text-muted-foreground">{selectedEmployee.position_en}</p>
                    <p className="text-sm text-muted-foreground">{selectedEmployee.department_name} • {selectedEmployee.company_name}</p>
                    <p className="text-xs text-muted-foreground font-mono">{selectedEmployee.employee_id}</p>
                  </div>
                </div>
              )}

              <div className="flex justify-end">
                <Button
                  onClick={() => setStep(2)}
                  disabled={!selectedEmployee}
                  className="gap-2 bg-emerald-600 hover:bg-emerald-700"
                >
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* Step 2: Select Bonus */}
          {step === 2 && (
            <div className="space-y-5">
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                <Gift className="h-5 w-5 text-emerald-600" /> Select Bonus Type
              </h2>

              <div className="space-y-1">
                <Label>Category</Label>
                <Select value={selectedCategory} onValueChange={v => { setSelectedCategory(v); setSelectedRule(null) }}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select category..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(categories ?? []).map(cat => (
                      <SelectItem key={cat.id} value={String(cat.id)}>{cat.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedCategory && (
                <div className="space-y-1">
                  <Label>Bonus Rule</Label>
                  <Select
                    value={selectedRule ? String(selectedRule.id) : ''}
                    onValueChange={v => setSelectedRule(bonusRules?.find(r => String(r.id) === v) ?? null)}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select bonus rule..." />
                    </SelectTrigger>
                    <SelectContent>
                      {(bonusRules ?? []).map(rule => (
                        <SelectItem key={rule.id} value={String(rule.id)}>{rule.name_en}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {selectedRule && selectedEmployee && (
                <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 space-y-2">
                  <p className="font-semibold text-emerald-900">Bonus Preview</p>
                  <div className="text-sm text-emerald-800 space-y-1">
                    <p>
                      Calculation:{' '}
                      {selectedRule.calculation_type === 'fixed'
                        ? `Fixed amount`
                        : `${selectedRule.percentage_of_salary}% of base salary (${formatCurrency(selectedEmployee.base_salary)})`
                      }
                    </p>
                    <p className="text-lg font-bold text-emerald-700">
                      Bonus Amount: {formatCurrency(calculatedAmount)}
                    </p>
                    {selectedRule.description && (
                      <p className="text-xs text-emerald-700 italic">{selectedRule.description}</p>
                    )}
                  </div>
                </div>
              )}

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
                <Button
                  onClick={() => setStep(3)}
                  disabled={!selectedRule}
                  className="gap-2 bg-emerald-600 hover:bg-emerald-700"
                >
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* Step 3: Details */}
          {step === 3 && (
            <div className="space-y-5">
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                <FileText className="h-5 w-5 text-emerald-600" /> Bonus Details
              </h2>

              <div className="space-y-1">
                <Label htmlFor="bonus_date">Bonus Date *</Label>
                <Input
                  id="bonus_date"
                  type="date"
                  value={bonusDate}
                  onChange={e => setBonusDate(e.target.value)}
                  className="mt-1"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="comments">Comments (optional)</Label>
                <Textarea
                  id="comments"
                  value={comments}
                  onChange={e => setComments(e.target.value)}
                  placeholder="Describe the reason for this bonus..."
                  rows={4}
                  className="mt-1"
                />
              </div>

              <div className="space-y-1">
                <Label>Supporting Files (optional)</Label>
                <FileUpload
                  multiple
                  files={evidenceFiles}
                  onFilesChange={setEvidenceFiles}
                  accept={{
                    'image/*': ['.jpg', '.jpeg', '.png'],
                    'application/pdf': ['.pdf'],
                  }}
                  label="Drag or click to upload supporting documents"
                  maxSize={10 * 1024 * 1024}
                  className="mt-1"
                />
              </div>

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep(2)}>Back</Button>
                <Button
                  onClick={() => setStep(4)}
                  disabled={!bonusDate}
                  className="gap-2 bg-emerald-600 hover:bg-emerald-700"
                >
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* Step 4: Review & Submit */}
          {step === 4 && (
            <div className="space-y-5">
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                <Send className="h-5 w-5 text-emerald-600" /> Review & Submit
              </h2>

              <div className="rounded-lg border border-border divide-y divide-slate-100">
                <div className="p-4">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Employee</p>
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={selectedEmployee?.photo ?? undefined} />
                      <AvatarFallback className="text-sm">{getInitials(selectedEmployee?.full_name_en ?? '')}</AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium">{selectedEmployee?.full_name_en}</p>
                      <p className="text-sm text-muted-foreground">{selectedEmployee?.position_en} • {selectedEmployee?.department_name}</p>
                    </div>
                  </div>
                </div>

                <div className="p-4 grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Bonus Rule</p>
                    <p className="font-medium">{selectedRule?.name_en}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Calculation</p>
                    <p>{selectedRule?.calculation_type === 'fixed' ? 'Fixed' : `${selectedRule?.percentage_of_salary}% of salary`}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Bonus Amount</p>
                    <p className="text-lg font-bold text-emerald-700">{formatCurrency(calculatedAmount)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Bonus Date</p>
                    <p>{formatDate(bonusDate)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Supporting Files</p>
                    <p>{evidenceFiles.length > 0 ? `${evidenceFiles.length} file(s)` : 'None'}</p>
                  </div>
                </div>

                {comments && (
                  <div className="p-4">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Comments</p>
                    <p className="text-sm text-foreground">{comments}</p>
                  </div>
                )}
              </div>

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep(3)}>Back</Button>
                <Button
                  onClick={() => submitMutation.mutate()}
                  loading={submitMutation.isPending}
                  className="gap-2 bg-emerald-600 hover:bg-emerald-700"
                >
                  <Send className="h-4 w-4" /> Award Bonus
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
