"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLocale } from "@/lib/i18n";

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ page, totalPages, onPageChange }: PaginationProps) {
  // BUG FIX (audit v11 HIGH): i18n + RTL. Previously hardcoded
  // English + used physical chevrons that don't flip in RTL.
  const { locale } = useLocale();
  const isAr = locale === "ar";
  // In RTL the meaning of "previous" / "next" flips physically —
  // pick the right chevron based on locale.
  const PrevIcon = isAr ? ChevronRight : ChevronLeft;
  const NextIcon = isAr ? ChevronLeft : ChevronRight;

  // audit v12 LOW (LOW-17): reset stale page before hiding UI when totalPages drops
  useEffect(() => {
    if (page > Math.max(1, totalPages)) {
      onPageChange(1);
    }
  }, [page, totalPages, onPageChange]);

  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between px-2 py-4">
      <p className="text-sm text-muted-foreground">
        {isAr ? `صفحة ${page} من ${totalPages}` : `Page ${page} of ${totalPages}`}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
        >
          <PrevIcon className="h-4 w-4" />
          {isAr ? "السابق" : "Previous"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
        >
          {isAr ? "التالي" : "Next"}
          <NextIcon className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
