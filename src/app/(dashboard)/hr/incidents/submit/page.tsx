'use client'

import { describeError } from "@/lib/zod-errors";

import React, { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Check, ChevronRight, User, AlertTriangle, FileText, Send } from 'lucide-react'
import { useLocale } from '@/lib/i18n'
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
}

interface ViolationCategory {
  id: number
  name: string
}

interface ViolationRule {
  id: number
  name_en: string
  category: number
  default_action: string
  deduction_percentage: number
  is_progressive: boolean
  reset_period_months?: number
}

interface OffenseHistory {
  offense_count: number
  action: string
  deduction_percentage: number
  deduction_amount: number
  previous_offenses: { date: string; action: string }[]
  reset_period_months: number
}

const STEPS = [
  { id: 1, label: 'Select Employee', icon: User },
  { id: 2, label: 'Select Violation', icon: AlertTriangle },
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
              currentStep > step.id ? 'bg-brand-navy border-brand-navy text-white' :
              currentStep === step.id ? 'border-brand-navy text-brand-navy bg-blue-50' :
              'border-border text-muted-foreground bg-card'
            )}>
              {currentStep > step.id ? <Check className="h-5 w-5" /> : step.id}
            </div>
            <span className={cn(
              'mt-1.5 text-xs font-medium whitespace-nowrap',
              currentStep === step.id ? 'text-brand-navy' :
              currentStep > step.id ? 'text-muted-foreground' : 'text-muted-foreground'
            )}>
              {step.label}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <div className={cn(
              'flex-1 h-0.5 mt-[-12px] mx-2 transition-all',
              currentStep > step.id ? 'bg-brand-navy' : 'bg-slate-200'
            )} />
          )}
        </React.Fragment>
      ))}
    </div>
  )
}

export default function SubmitIncidentPage() {
  const { locale } = useLocale()
  const isAr = locale === 'ar'
  const [step, setStep] = useState(1)
  const [employeeSearch, setEmployeeSearch] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeOption | null>(null)
  const [selectedCategory, setSelectedCategory] = useState('')
  const [selectedRule, setSelectedRule] = useState<ViolationRule | null>(null)
  const [incidentDate, setIncidentDate] = useState(new Date().toISOString().split('T')[0])
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

  const { data: categories } = useQuery<ViolationCategory[]>({
    queryKey: ['incidents', 'violation-categories'],
    queryFn: async () => {
      const res = await api.get('/incidents/violation-categories/')
      return Array.isArray(res.data) ? res.data : res.data.results ?? []
    },
  })

  const { data: violationRules } = useQuery<ViolationRule[]>({
    queryKey: ['incidents', 'violation-rules', selectedCategory],
    queryFn: async () => {
      const res = await api.get('/incidents/violation-rules/', {
        params: selectedCategory ? { category: selectedCategory } : {},
      })
      return Array.isArray(res.data) ? res.data : res.data.results ?? []
    },
    enabled: !!selectedCategory,
  })

  const { data: offenseHistory } = useQuery<OffenseHistory>({
    queryKey: ['incidents', 'offense-count', selectedEmployee?.id, selectedRule?.id],
    queryFn: async () => {
      const res = await api.get('/incidents/offense-count/', {
        params: { employee: selectedEmployee!.id, rule: selectedRule!.id },
      })
      return res.data
    },
    enabled: !!selectedEmployee && !!selectedRule,
  })

  const submitMutation = useMutation({
    mutationFn: async () => {
      const formData = new FormData()
      formData.append('employee', String(selectedEmployee!.id))
      formData.append('violation_rule', String(selectedRule!.id))
      formData.append('incident_date', incidentDate)
      formData.append('comments', comments)
      if (offenseHistory) {
        formData.append('action_taken', offenseHistory.action)
        formData.append('deduction_amount', String(offenseHistory.deduction_amount))
      }
      evidenceFiles.forEach(f => formData.append('evidence', f))
      const res = await api.post('/incidents/incidents/', formData, {
        
      })
      return res.data
    },
    onSuccess: (data) => {
      setSubmittedId(data.id)
      toast.success('Incident submitted successfully')
    },
    onError: (__err: unknown) => toast.error(describeError(__err) || 'Failed to submit incident'),
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

  const ordinalSuffix = (n: number) => {
    const s = ['th', 'st', 'nd', 'rd']
    const v = n % 100
    return n + (s[(v - 20) % 10] || s[v] || s[0])
  }

  if (submittedId) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={isAr ? 'تقديم مخالفة' : 'Submit Incident'}
          breadcrumbs={[{ label: isAr ? 'المخالفات' : 'Incidents' }, { label: isAr ? 'تقديم' : 'Submit' }]}
        />
        <div className="bg-card rounded-xl border border-border p-12 text-center max-w-lg mx-auto">
          <div className="h-16 w-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
            <Check className="h-8 w-8 text-emerald-600" />
          </div>
          <h2 className="text-xl font-bold text-foreground mb-2">Incident Submitted</h2>
          <p className="text-muted-foreground mb-1">Incident ID: <span className="font-mono font-semibold text-foreground">#{submittedId}</span></p>
          <p className="text-muted-foreground text-sm mb-6">The incident has been recorded and will be reviewed.</p>
          <div className="flex justify-center gap-3">
            <Button variant="outline" onClick={() => {
              setStep(1); setSelectedEmployee(null); setSelectedRule(null)
              setSelectedCategory(''); setComments(''); setEvidenceFiles([])
              setSubmittedId(null); setEmployeeSearch('')
            }}>
              Submit Another
            </Button>
            <Button onClick={() => window.location.href = '/hr/incidents/all'}>
              View All Incidents
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Submit Incident"
        description="Record a new disciplinary incident with 4-step guided process"
        breadcrumbs={[{ label: isAr ? 'المخالفات' : 'Incidents' }, { label: isAr ? 'تقديم جديد' : 'Submit New' }]}
      />

      <div className="max-w-2xl mx-auto">
        <StepIndicator currentStep={step} />

        <div className="bg-card rounded-xl border border-border p-6">
          {/* Step 1: Select Employee */}
          {step === 1 && (
            <div className="space-y-5">
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                <User className="h-5 w-5 text-brand-navy" /> Select Employee
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
                <div className="flex items-center gap-4 p-4 rounded-lg bg-blue-50 border border-blue-200">
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
                <Button onClick={() => setStep(2)} disabled={!selectedEmployee} className="gap-2">
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* Step 2: Select Violation */}
          {step === 2 && (
            <div className="space-y-5">
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-brand-navy" /> Select Violation
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
                  <Label>Violation</Label>
                  <Select
                    value={selectedRule ? String(selectedRule.id) : ''}
                    onValueChange={v => setSelectedRule(violationRules?.find(r => String(r.id) === v) ?? null)}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select violation..." />
                    </SelectTrigger>
                    <SelectContent>
                      {(violationRules ?? []).map(rule => (
                        <SelectItem key={rule.id} value={String(rule.id)}>{rule.name_en}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {offenseHistory && selectedRule && selectedEmployee && (
                <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 space-y-3">
                  <p className="font-semibold text-amber-900">
                    This is {selectedEmployee.full_name_en}'s{' '}
                    <span className="text-amber-700">{ordinalSuffix(offenseHistory.offense_count + 1)}</span>{' '}
                    offense of <em>{selectedRule.name_en}</em>
                  </p>
                  <div className="text-sm text-amber-800 space-y-1">
                    <p>Per policy: <span className="font-semibold">{offenseHistory.action?.replace(/_/g, ' ')}</span>{' '}
                      with{' '}
                      <span className="font-semibold">{offenseHistory.deduction_percentage}% deduction</span>{' '}
                      = <span className="font-semibold">{formatCurrency(offenseHistory.deduction_amount)}</span>
                    </p>
                    <p className="text-xs text-amber-700">Reset period: {offenseHistory.reset_period_months} month{offenseHistory.reset_period_months !== 1 ? 's' : ''}</p>
                  </div>
                  {offenseHistory.previous_offenses?.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1">Previous Offenses</p>
                      <div className="space-y-1">
                        {offenseHistory.previous_offenses.map((o, i) => (
                          <div key={i} className="flex justify-between text-xs text-amber-800">
                            <span>{formatDate(o.date)}</span>
                            <span className="capitalize">{o.action?.replace(/_/g, ' ')}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
                <Button onClick={() => setStep(3)} disabled={!selectedRule} className="gap-2">
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* Step 3: Details */}
          {step === 3 && (
            <div className="space-y-5">
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                <FileText className="h-5 w-5 text-brand-navy" /> Incident Details
              </h2>

              <div className="space-y-1">
                <Label htmlFor="incident_date">Incident Date *</Label>
                <Input
                  id="incident_date"
                  type="date"
                  value={incidentDate}
                  onChange={e => setIncidentDate(e.target.value)}
                  className="mt-1"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="comments">
                  Comments *{' '}
                  <span className={cn('text-xs', comments.length < 20 ? 'text-red-500' : 'text-muted-foreground')}>
                    (min 20 chars, {comments.length} entered)
                  </span>
                </Label>
                <Textarea
                  id="comments"
                  value={comments}
                  onChange={e => setComments(e.target.value)}
                  placeholder="Describe the incident in detail..."
                  rows={5}
                  className="mt-1"
                />
              </div>

              <div className="space-y-1">
                <Label>Evidence Files (optional)</Label>
                <FileUpload
                  multiple
                  files={evidenceFiles}
                  onFilesChange={setEvidenceFiles}
                  accept={{
                    'image/*': ['.jpg', '.jpeg', '.png', '.gif'],
                    'application/pdf': ['.pdf'],
                    'video/*': ['.mp4', '.mov'],
                  }}
                  label="Drag or click to upload evidence"
                  hint="Images, PDF, or video files up to 20MB each"
                  maxSize={20 * 1024 * 1024}
                  className="mt-1"
                />
              </div>

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep(2)}>Back</Button>
                <Button
                  onClick={() => setStep(4)}
                  disabled={!incidentDate || comments.length < 20}
                  className="gap-2"
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
                <Send className="h-5 w-5 text-brand-navy" /> Review & Submit
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

                <div className="p-4 grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Violation</p>
                    <p className="text-sm font-medium">{selectedRule?.name_en}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Offense Number</p>
                    <p className="text-sm font-medium">{ordinalSuffix((offenseHistory?.offense_count ?? 0) + 1)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Action</p>
                    <p className="text-sm font-medium capitalize">{offenseHistory?.action?.replace(/_/g, ' ')}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Deduction Amount</p>
                    <p className="text-sm font-semibold text-red-700">{formatCurrency(offenseHistory?.deduction_amount ?? 0)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Incident Date</p>
                    <p className="text-sm font-medium">{formatDate(incidentDate)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Evidence Files</p>
                    <p className="text-sm">{evidenceFiles.length > 0 ? `${evidenceFiles.length} file(s)` : 'None'}</p>
                  </div>
                </div>

                <div className="p-4">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Comments</p>
                  <p className="text-sm text-foreground">{comments}</p>
                </div>
              </div>

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep(3)}>Back</Button>
                <Button
                  onClick={() => submitMutation.mutate()}
                  loading={submitMutation.isPending}
                  className="gap-2 bg-red-600 hover:bg-red-700"
                >
                  <Send className="h-4 w-4" /> Submit Incident
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
