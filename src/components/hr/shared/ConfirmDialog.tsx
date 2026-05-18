'use client'

import React from 'react'
import { AlertTriangle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/hr/ui/dialog'
import { Button } from '@/components/hr/ui/button'
import { useLocale } from '@/lib/i18n'

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'destructive' | 'warning' | 'default'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onConfirm: () => any
  loading?: boolean
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  variant = 'destructive',
  onConfirm,
  loading = false,
}: ConfirmDialogProps) {
  const { t } = useLocale()
  const resolvedConfirmLabel = confirmLabel ?? t.common.confirm
  const resolvedCancelLabel = cancelLabel ?? t.common.cancel
  const [isLoading, setIsLoading] = React.useState(false)

  async function handleConfirm() {
    setIsLoading(true)
    try {
      await onConfirm()
      onOpenChange(false)
    } finally {
      setIsLoading(false)
    }
  }

  const iconColors = {
    destructive: 'text-red-500 bg-red-100',
    warning: 'text-amber-500 bg-amber-100',
    default: 'text-blue-500 bg-blue-100',
  }

  const btnVariant = {
    destructive: 'destructive' as const,
    warning: 'warning' as const,
    default: 'default' as const,
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" showClose={false}>
        <DialogHeader>
          <div className="flex items-start gap-4">
            <div className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${iconColors[variant]}`}>
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription className="mt-1">{description}</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading || loading}
          >
            {resolvedCancelLabel}
          </Button>
          <Button
            variant={btnVariant[variant]}
            onClick={handleConfirm}
            loading={isLoading || loading}
          >
            {resolvedConfirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
