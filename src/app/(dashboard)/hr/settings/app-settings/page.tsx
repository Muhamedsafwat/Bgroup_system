'use client'

import React, { useState, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Save, Loader2 } from 'lucide-react'
import { PageHeader } from '@/components/hr/shared/PageHeader'
import { useLocale } from '@/lib/i18n'
import { Button } from '@/components/hr/ui/button'
import { useToast } from '@/components/hr/ui/toast'
import api from '@/lib/hr/api'
import { cn } from '@/lib/hr/utils'
import { describeError } from "@/lib/zod-errors";

interface AppSetting {
  key: string
  value: string
  description: string
  value_type: 'string' | 'number' | 'boolean' | 'select'
  options?: string[]
}

interface SettingsSection {
  title: string
  keys: string[]
}

const SECTIONS: SettingsSection[] = [
  {
    title: 'General',
    keys: ['company_name', 'fiscal_year_start', 'default_currency', 'timezone'],
  },
  {
    title: 'Salary & Payroll',
    keys: ['max_deduction_pct', 'payroll_lock_day', 'payment_method', 'salary_calculation_basis'],
  },
  {
    title: 'Attendance',
    keys: ['late_threshold_minutes', 'absent_by_time', 'working_hours_per_day', 'working_days_per_month'],
  },
  {
    title: 'Overtime',
    keys: ['ot_requires_approval', 'ot_max_hours_monthly', 'ot_min_hours', 'ot_rate_weekday'],
  },
  {
    title: 'Approvals',
    keys: ['incident_requires_approval', 'bonus_requires_approval', 'leave_requires_approval'],
  },
  {
    title: 'Employee Portal',
    keys: ['allow_checkin_from_app', 'allow_ot_submission', 'allow_leave_request', 'allow_profile_update_request'],
  },
  {
    title: 'Exports',
    keys: ['excel_format_company_logo', 'pdf_watermark', 'pdf_language', 'include_bank_in_export'],
  },
]

export default function AppSettingsPage() {
  const { locale } = useLocale()
  const isAr = locale === 'ar'
  const { toast } = useToast()

  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(SECTIONS.map((s) => s.title))
  )
  const [localValues, setLocalValues] = useState<Record<string, string>>({})
  const [isDirty, setIsDirty] = useState(false)

  const { data, isLoading } = useQuery<{ data: AppSetting[] }>({
    queryKey: ['app-settings'],
    queryFn: () => api.get('/settings/'),
  })
  const settings = data?.data ?? []

  useEffect(() => {
    if (settings.length > 0) {
      const initial: Record<string, string> = {}
      settings.forEach((s) => { initial[s.key] = s.value })
      setLocalValues(initial)
      setIsDirty(false)
    }
  }, [settings])

  const saveMutation = useMutation({
    mutationFn: (payload: { key: string; value: string }[]) =>
      api.post('/settings/bulk-update/', payload),
    onSuccess: () => {
      setIsDirty(false)
      toast({ title: 'Settings saved', description: 'All settings have been updated successfully.' })
    },
    onError: (__err: unknown) => toast({ title: 'Error', variant: 'destructive', description: describeError(__err) || 'Failed to save settings.' }),
  })

  function handleChange(key: string, value: string) {
    setLocalValues((prev) => ({ ...prev, [key]: value }))
    setIsDirty(true)
  }

  function handleSaveAll() {
    const payload = Object.entries(localValues).map(([key, value]) => ({ key, value }))
    saveMutation.mutate(payload)
  }

  function toggleSection(title: string) {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      next.has(title) ? next.delete(title) : next.add(title)
      return next
    })
  }

  function getSettingByKey(key: string): AppSetting | undefined {
    return settings.find((s) => s.key === key)
  }

  function renderInput(setting: AppSetting) {
    const value = localValues[setting.key] ?? setting.value

    if (setting.value_type === 'boolean') {
      return (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => handleChange(setting.key, value === 'true' ? 'false' : 'true')}
            className={cn(
              'relative h-5 w-9 rounded-full transition-colors',
              value === 'true' ? 'bg-emerald-500' : 'bg-slate-300'
            )}
          >
            <div className={cn(
              'absolute top-0.5 h-4 w-4 rounded-full bg-card shadow transition-all',
              value === 'true' ? 'left-4' : 'left-0.5'
            )} />
          </button>
          <span className="text-sm text-foreground">{value === 'true' ? 'Enabled' : 'Disabled'}</span>
        </div>
      )
    }

    if (setting.value_type === 'select' && setting.options) {
      return (
        <select
          className="h-9 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-blue-400 w-full max-w-xs"
          value={value}
          onChange={(e) => handleChange(setting.key, e.target.value)}
        >
          {setting.options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      )
    }

    if (setting.value_type === 'number') {
      return (
        <input
          type="number"
          className="h-9 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-blue-400 w-full max-w-xs"
          value={value}
          onChange={(e) => handleChange(setting.key, e.target.value)}
        />
      )
    }

    return (
      <input
        type="text"
        className="h-9 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-blue-400 w-full max-w-xs"
        value={value}
        onChange={(e) => handleChange(setting.key, e.target.value)}
      />
    )
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-16 gap-3 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading settings...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="App Settings"
        description="System-wide configuration for HR operations"
        breadcrumbs={[{ label: isAr ? 'الإعدادات' : 'Settings', href: '/settings' }, { label: isAr ? 'إعدادات التطبيق' : 'App Settings' }]}
        actions={
          <Button
            className={cn(
              'gap-1.5',
              isDirty
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                : 'bg-slate-200 text-muted-foreground cursor-default'
            )}
            onClick={handleSaveAll}
            disabled={!isDirty || saveMutation.isPending}
          >
            {saveMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save All
          </Button>
        }
      />

      {isDirty && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
          You have unsaved changes. Click "Save All" to apply them.
        </div>
      )}

      <div className="space-y-3">
        {SECTIONS.map((section) => {
          const isExpanded = expandedSections.has(section.title)
          const sectionSettings = section.keys
            .map((key) => getSettingByKey(key))
            .filter(Boolean) as AppSetting[]

          return (
            <div key={section.title} className="bg-card rounded-lg border border-border overflow-hidden">
              <button
                type="button"
                className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-muted/50 transition-colors"
                onClick={() => toggleSection(section.title)}
              >
                <div className="flex items-center gap-3">
                  <h2 className="text-sm font-semibold text-foreground">{section.title}</h2>
                  <span className="text-xs text-muted-foreground">
                    {sectionSettings.length} setting{sectionSettings.length !== 1 ? 's' : ''}
                  </span>
                </div>
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
              </button>

              {isExpanded && (
                <div className="border-t border-border/60 divide-y divide-slate-100">
                  {sectionSettings.length === 0 ? (
                    <div className="px-5 py-4 text-sm text-muted-foreground italic">
                      No settings configured for this section.
                    </div>
                  ) : (
                    sectionSettings.map((setting) => (
                      <div
                        key={setting.key}
                        className="flex items-start justify-between gap-6 px-5 py-4"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground mb-0.5">
                            {setting.description || setting.key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                          </p>
                        </div>
                        <div className="shrink-0 min-w-[200px]">
                          {renderInput(setting)}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )
        })}

        {/* Show any settings not categorized */}
        {(() => {
          const allCategorizedKeys = SECTIONS.flatMap((s) => s.keys)
          const uncategorized = settings.filter((s) => !allCategorizedKeys.includes(s.key))
          if (uncategorized.length === 0) return null
          return (
            <div className="bg-card rounded-lg border border-border overflow-hidden">
              <div className="px-5 py-4 border-b border-border/60">
                <h2 className="text-sm font-semibold text-foreground">Other Settings</h2>
              </div>
              <div className="divide-y divide-slate-100">
                {uncategorized.map((setting) => (
                  <div key={setting.key} className="flex items-start justify-between gap-6 px-5 py-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground mb-0.5">
                        {setting.description || setting.key}
                      </p>
                      <p className="text-xs text-muted-foreground font-mono">{setting.key}</p>
                    </div>
                    <div className="shrink-0 min-w-[200px]">
                      {renderInput(setting)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })()}
      </div>
    </div>
  )
}
