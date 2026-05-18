'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowLeft, Save, Camera, User2, Plus } from 'lucide-react'
import { useLocale } from '@/lib/i18n'
import { PageHeader } from '@/components/hr/shared/PageHeader'
import { Card } from '@/components/hr/ui/card'
import { Button } from '@/components/hr/ui/button'
import { Input } from '@/components/hr/ui/input'
import { Label } from '@/components/hr/ui/label'
import { Textarea } from '@/components/hr/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/hr/ui/select'
import { Checkbox } from '@/components/hr/ui/checkbox'
import { useToast } from '@/components/hr/ui/toast'
import api, { employeesApi, companiesApi, departmentsApi } from '@/lib/hr/api'
import type { Company, Department } from '@/lib/hr/types'

// ─── Zod Schema ──────────────────────────────────────────────────────────────

const addEmployeeSchema = z.object({
  // Personal
  full_name_en: z.string().min(2, 'Full name (EN) is required'),
  full_name_ar: z.string().optional(),
  national_id: z.string().min(5, 'National ID is required'),
  date_of_birth: z.string().optional(),
  gender: z.enum(['male', 'female']).optional(),
  personal_email: z.string().email('Invalid email').optional().or(z.literal('')),
  phone: z.string().min(8, 'Phone is required'),
  address: z.string().optional(),
  emergency_contact_name: z.string().optional(),
  emergency_contact_phone: z.string().optional(),

  // Employment
  company: z.coerce.number().min(1, 'Company is required'),
  department: z.coerce.number().min(1, 'Department is required'),
  position_en: z.string().min(2, 'Position is required'),
  position_ar: z.string().optional(),
  level: z.enum(['junior', 'mid', 'senior', 'lead', 'manager']),
  employment_type: z.enum(['full_time', 'part_time', 'contract', 'intern']),
  work_model: z.enum(['on_site', 'remote', 'hybrid']),
  direct_manager: z.coerce.number().optional(),
  shift: z.coerce.number().optional(),
  contract_start: z.string().min(1, 'Contract start date is required'),
  contract_end: z.string().optional(),
  probation_end: z.string().optional(),

  // Salary
  base_salary: z.coerce.number().min(1, 'Base salary is required'),
  currency: z.enum(['EGP', 'QAR', 'AED']),
  bank_name: z.string().optional(),
  bank_account: z.string().optional(),
  iban: z.string().optional(),

  // Account
  work_email: z.string().email('Invalid work email').optional().or(z.literal('')),
  generate_temp_password: z.boolean().default(true),
})

type AddEmployeeFormData = z.infer<typeof addEmployeeSchema>

// ─── Section Wrapper ──────────────────────────────────────────────────────────

function FormSection({
  title,
  description,
  children,
  demoId,
}: {
  title: string
  description?: string
  children: React.ReactNode
  demoId?: string
}) {
  return (
    <Card className="p-6" data-demo-id={demoId}>
      <div className="mb-5 pb-4 border-b border-border">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">{children}</div>
    </Card>
  )
}

// ─── Field helpers ────────────────────────────────────────────────────────────

function FieldWrapper({ label, error, children, className }: {
  label: string
  error?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <Label className="text-sm font-medium text-foreground mb-1.5 block">{label}</Label>
      {children}
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  )
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function AddEmployeePage() {
  const { locale } = useLocale()
  const isAr = locale === 'ar'
  const router = useRouter()
  const { toast } = useToast()
  const [addAnother, setAddAnother] = useState(false)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const photoInputRef = React.useRef<HTMLInputElement>(null)

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoFile(file)
    setPhotoPreview(URL.createObjectURL(file))
  }

  const {
    register,
    handleSubmit,
    control,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AddEmployeeFormData>({
    resolver: zodResolver(addEmployeeSchema) as any,
    defaultValues: {
      currency: 'EGP',
      employment_type: 'full_time',
      work_model: 'on_site',
      level: 'mid',
      generate_temp_password: true,
    },
  })

  const selectedCompany = watch('company')

  const { data: companiesData } = useQuery<{ data: { results: Company[] } }>({
    queryKey: ['companies'],
    queryFn: () => companiesApi.list(),
  })

  const { data: deptsData } = useQuery<{ data: { results: Department[] } }>({
    queryKey: ['departments', selectedCompany],
    queryFn: () =>
      departmentsApi.list(selectedCompany ? { company: selectedCompany } : {}),
    enabled: !!selectedCompany,
  })

  const companies = companiesData?.data?.results ?? []
  const departments = deptsData?.data?.results ?? []

  const createMutation = useMutation({
    mutationFn: (data: AddEmployeeFormData) => employeesApi.create(data),
    onSuccess: async (res) => {
      const newId = res.data?.id
      if (photoFile && newId) {
        const fd = new FormData()
        fd.append('photo', photoFile)
        await api.post(`/employees/${newId}/upload-photo/`, fd).catch(() => {})
      }
      toast({
        title: 'Employee added',
        description: 'The employee has been successfully created.',
      })
      if (addAnother) {
        reset()
        setPhotoFile(null)
        setPhotoPreview(null)
      } else {
        router.push('/hr/employees')
      }
    },
    onError: (err: unknown) => {
      const data = (err as { response?: { data?: Record<string, unknown> } })?.response?.data
      let message = 'Failed to add employee. Please check the form and try again.'
      if (data) {
        if (typeof data.detail === 'string') {
          message = data.detail
        } else {
          const fieldErrors = Object.entries(data)
            .map(([field, msgs]) => `${field}: ${Array.isArray(msgs) ? msgs[0] : msgs}`)
            .join(' | ')
          if (fieldErrors) message = fieldErrors
        }
      }
      toast({ title: 'Error', description: message, variant: 'destructive' })
    },
  })

  function onSubmit(data: AddEmployeeFormData) {
    // Strip account-setup fields — handled by backend separately
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { work_email, generate_temp_password, ...employeePayload } = data
    createMutation.mutate({ ...employeePayload, work_email, generate_temp_password } as AddEmployeeFormData)
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <PageHeader
        title={isAr ? 'إضافة موظف' : 'Add Employee'}
        description={isAr ? 'إنشاء ملف موظف جديد وحسابه' : 'Create a new employee profile and account'}
        breadcrumbs={[
          { label: isAr ? 'الموظفون' : 'Employees', href: '/hr/employees' },
          { label: isAr ? 'إضافة موظف' : 'Add Employee' },
        ]}
        actions={
          <Button variant="outline" size="sm" onClick={() => router.push('/hr/employees')}>
            <ArrowLeft className="h-4 w-4 mr-1" /> {isAr ? 'رجوع' : 'Back'}
          </Button>
        }
      />

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Photo Upload */}
        <Card className="p-6">
          <div className="mb-5 pb-4 border-b border-border">
            <h2 className="text-base font-semibold text-foreground">Profile Photo</h2>
            <p className="text-sm text-muted-foreground mt-0.5">Optional — upload a photo for this employee</p>
          </div>
          <div className="flex items-center gap-5">
            <div
              className="h-20 w-20 rounded-full border-2 border-dashed border-border flex items-center justify-center overflow-hidden bg-muted/50 shrink-0 cursor-pointer hover:border-blue-400 transition-colors"
              onClick={() => photoInputRef.current?.click()}
            >
              {photoPreview ? (
                <img src={photoPreview} alt="Preview" className="h-full w-full object-cover" />
              ) : (
                <User2 className="h-8 w-8 text-muted-foreground/60" />
              )}
            </div>
            <div>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handlePhotoChange}
              />
              <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => photoInputRef.current?.click()}>
                <Camera className="h-4 w-4" />
                {photoPreview ? 'Change Photo' : 'Upload Photo'}
              </Button>
              {photoFile && (
                <p className="text-xs text-muted-foreground mt-1.5">{photoFile.name}</p>
              )}
            </div>
          </div>
        </Card>

        {/* Section 1: Personal Information */}
        <FormSection
          title="Section 1 — Personal Information"
          description="Basic identity and contact details"
          demoId="form-section-personal"
        >
          <FieldWrapper label="Full Name (English) *" error={errors.full_name_en?.message}>
            <Input {...register('full_name_en')} placeholder="e.g. Ahmed Mohamed Ali" />
          </FieldWrapper>

          <FieldWrapper label="Full Name (Arabic)" error={errors.full_name_ar?.message}>
            <Input
              {...register('full_name_ar')}
              placeholder="الاسم بالعربية"
              dir="rtl"
            />
          </FieldWrapper>

          <FieldWrapper label="National ID *" error={errors.national_id?.message}>
            <Input {...register('national_id')} placeholder="14-digit national ID" />
          </FieldWrapper>

          <FieldWrapper label="Date of Birth" error={errors.date_of_birth?.message}>
            <Input type="date" {...register('date_of_birth')} />
          </FieldWrapper>

          <FieldWrapper label="Gender" error={errors.gender?.message}>
            <Controller
              control={control}
              name="gender"
              render={({ field }) => (
                <Select value={field.value ?? ''} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select gender" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </FieldWrapper>

          <FieldWrapper label="Phone *" error={errors.phone?.message}>
            <Input {...register('phone')} placeholder="+20 1xx xxx xxxx" />
          </FieldWrapper>

          <FieldWrapper label="Personal Email" error={errors.personal_email?.message}>
            <Input type="email" {...register('personal_email')} placeholder="personal@email.com" />
          </FieldWrapper>

          <FieldWrapper label={isAr ? 'العنوان' : 'Address'} error={errors.address?.message} className="sm:col-span-2">
            <Textarea {...register('address')} placeholder="Full address..." rows={2} />
          </FieldWrapper>

          <FieldWrapper label="Emergency Contact Name" error={errors.emergency_contact_name?.message}>
            <Input
              {...register('emergency_contact_name')}
              placeholder="Contact person name"
            />
          </FieldWrapper>

          <FieldWrapper label="Emergency Contact Phone" error={errors.emergency_contact_phone?.message}>
            <Input
              {...register('emergency_contact_phone')}
              placeholder="Contact phone number"
            />
          </FieldWrapper>
        </FormSection>

        {/* Section 2: Employment Details */}
        <FormSection
          title="Section 2 — Employment Details"
          demoId="form-section-employment"
          description="Company assignment, role, and contract information"
        >
          <FieldWrapper label="Company *" error={errors.company?.message}>
            <Controller
              control={control}
              name="company"
              render={({ field }) => (
                <Select
                  value={field.value ? String(field.value) : ''}
                  onValueChange={(v) => field.onChange(Number(v))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select company" />
                  </SelectTrigger>
                  <SelectContent>
                    {companies.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name_en}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </FieldWrapper>

          <FieldWrapper label="Department *" error={errors.department?.message}>
            <Controller
              control={control}
              name="department"
              render={({ field }) => (
                <Select
                  value={field.value ? String(field.value) : ''}
                  onValueChange={(v) => field.onChange(Number(v))}
                  disabled={!selectedCompany}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={selectedCompany ? 'Select department' : 'Select company first'} />
                  </SelectTrigger>
                  <SelectContent>
                    {departments.map((d) => (
                      <SelectItem key={d.id} value={String(d.id)}>
                        {d.name_en}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </FieldWrapper>

          <FieldWrapper label="Position (EN) *" error={errors.position_en?.message}>
            <Input {...register('position_en')} placeholder="e.g. Senior Developer" />
          </FieldWrapper>

          <FieldWrapper label="Position (AR)" error={errors.position_ar?.message}>
            <Input {...register('position_ar')} placeholder="المسمى الوظيفي" dir="rtl" />
          </FieldWrapper>

          <FieldWrapper label="Level *" error={errors.level?.message}>
            <Controller
              control={control}
              name="level"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['junior', 'mid', 'senior', 'lead', 'manager'].map(
                      (l) => (
                        <SelectItem key={l} value={l} className="capitalize">
                          {l.charAt(0).toUpperCase() + l.slice(1)}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              )}
            />
          </FieldWrapper>

          <FieldWrapper label="Employment Type *" error={errors.employment_type?.message}>
            <Controller
              control={control}
              name="employment_type"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full_time">Full Time</SelectItem>
                    <SelectItem value="part_time">Part Time</SelectItem>
                    <SelectItem value="contract">Contract</SelectItem>
                    <SelectItem value="intern">Intern</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </FieldWrapper>

          <FieldWrapper label="Work Model *" error={errors.work_model?.message}>
            <Controller
              control={control}
              name="work_model"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="on_site">On Site</SelectItem>
                    <SelectItem value="remote">Remote</SelectItem>
                    <SelectItem value="hybrid">Hybrid</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </FieldWrapper>

          <FieldWrapper label="Contract Start *" error={errors.contract_start?.message}>
            <Input type="date" {...register('contract_start')} />
          </FieldWrapper>

          <FieldWrapper label="Contract End" error={errors.contract_end?.message}>
            <Input type="date" {...register('contract_end')} />
          </FieldWrapper>

          <FieldWrapper label="Probation End" error={errors.probation_end?.message}>
            <Input type="date" {...register('probation_end')} />
          </FieldWrapper>
        </FormSection>

        {/* Section 3: Salary & Banking */}
        <FormSection
          title="Section 3 — Salary & Banking"
          description="Compensation and bank account details"
          demoId="form-section-salary"
        >
          <FieldWrapper label="Base Salary *" error={errors.base_salary?.message}>
            <Input
              type="number"
              min={0}
              step={100}
              {...register('base_salary')}
              placeholder="0"
            />
          </FieldWrapper>

          <FieldWrapper label="Currency *" error={errors.currency?.message}>
            <Controller
              control={control}
              name="currency"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="EGP">EGP — Egyptian Pound</SelectItem>
                    <SelectItem value="QAR">QAR — Qatari Riyal</SelectItem>
                    <SelectItem value="AED">AED — UAE Dirham</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </FieldWrapper>

          <FieldWrapper label="Bank Name" error={errors.bank_name?.message}>
            <Input {...register('bank_name')} placeholder="e.g. CIB, NBE, QNB..." />
          </FieldWrapper>

          <FieldWrapper label="Account Number" error={errors.bank_account?.message}>
            <Input {...register('bank_account')} placeholder="Bank account number" />
          </FieldWrapper>

          <FieldWrapper label="IBAN" error={errors.iban?.message}>
            <Input {...register('iban')} placeholder="EGxxxx..." className="font-mono" />
          </FieldWrapper>
        </FormSection>

        {/* Section 4: Account Setup */}
        <FormSection
          title="Section 4 — Account Setup"
          description="System login credentials and permissions"
        >
          <FieldWrapper label="Work Email" error={errors.work_email?.message}>
            <Input
              type="email"
              {...register('work_email')}
              placeholder="name@company.com"
            />
          </FieldWrapper>

          <div className="flex items-center gap-3 pt-7">
            <Controller
              control={control}
              name="generate_temp_password"
              render={({ field }) => (
                <Checkbox
                  id="gen-pass"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              )}
            />
            <label htmlFor="gen-pass" className="text-sm font-medium text-foreground cursor-pointer">
              Generate temporary password and send via email
            </label>
          </div>
        </FormSection>

        {/* Form Actions */}
        <div className="flex flex-wrap items-center gap-3 py-2">
          <Button
            type="submit"
            loading={isSubmitting || createMutation.isPending}
            className="gap-1.5"
            onClick={() => setAddAnother(false)}
            data-demo-id="save-employee-btn"
          >
            <Save className="h-4 w-4" />
            Save Employee
          </Button>

          <Button
            type="submit"
            variant="outline"
            loading={isSubmitting || createMutation.isPending}
            className="gap-1.5"
            onClick={() => setAddAnother(true)}
          >
            <Plus className="h-4 w-4" />
            Save &amp; Add Another
          </Button>

          <Button
            type="button"
            variant="ghost"
            onClick={() => router.push('/hr/employees')}
          >
            {isAr ? 'إلغاء' : 'Cancel'}
          </Button>
        </div>
      </form>
    </div>
  )
}
