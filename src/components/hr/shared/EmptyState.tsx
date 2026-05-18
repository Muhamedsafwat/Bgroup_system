"use client";

import React from 'react'
import { FileSearch } from 'lucide-react'
import { cn } from '@/lib/hr/utils'
import { useLocale } from '@/lib/i18n'

interface EmptyStateProps {
  title?: string
  description?: string
  icon?: React.ReactNode
  action?: React.ReactNode
  className?: string
}

/**
 * Default empty state for any list / table. Title + description fall back to
 * locale-aware strings so a forgotten override doesn't render "No data found"
 * in an otherwise-translated Arabic page.
 */
export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
}: EmptyStateProps) {
  const { t } = useLocale()
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center py-16 px-6 text-center',
        className
      )}
    >
      <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center mb-4">
        {icon || <FileSearch className="h-7 w-7 text-muted-foreground" />}
      </div>
      <p className="text-foreground font-medium text-base">{title ?? t.states.noData}</p>
      <p className="mt-1 text-muted-foreground text-sm max-w-xs">{description ?? t.states.noMatches}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
