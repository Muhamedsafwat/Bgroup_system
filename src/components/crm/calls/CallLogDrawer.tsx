"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useLocale } from "@/lib/i18n";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import type { CrmCallType, CrmCallOutcome } from "@/generated/prisma";

type CompanyOption = {
  id: string;
  nameEn: string;
  nameAr: string | null;
};

const CALL_TYPES: CrmCallType[] = [
  "INITIAL_OUTREACH",
  "FOLLOW_UP",
  "DISCOVERY",
  "TECHNICAL",
  "PROPOSAL_WALKTHRU",
  "NEGOTIATION",
  "CLOSING",
  "CHECK_IN",
  "SUPPORT",
];

const CALL_OUTCOMES: CrmCallOutcome[] = [
  "POSITIVE",
  "NEUTRAL",
  "NEGATIVE",
  "NO_ANSWER",
  "VOICEMAIL",
  "WRONG_NUMBER",
  "MEETING_BOOKED",
  "PROPOSAL_REQUEST",
  "WON",
  "LOST",
  "RESCHEDULE",
  "NOT_INTERESTED",
];

export function CallLogDrawer({
  open,
  onOpenChange,
  preselectedCompanyId,
  preselectedOpportunityId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preselectedCompanyId?: string;
  preselectedOpportunityId?: string;
}) {
  const { t, locale } = useLocale();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form state
  const [companySearch, setCompanySearch] = useState("");
  const [companyId, setCompanyId] = useState(preselectedCompanyId || "");
  const [companyResults, setCompanyResults] = useState<CompanyOption[]>([]);
  const [showCompanyDropdown, setShowCompanyDropdown] = useState(false);
  const [selectedCompanyName, setSelectedCompanyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [callType, setCallType] = useState<CrmCallType>("FOLLOW_UP");
  const [outcome, setOutcome] = useState<CrmCallOutcome>("POSITIVE");
  const [opportunityCode, setOpportunityCode] = useState(
    preselectedOpportunityId || ""
  );
  const [durationMins, setDurationMins] = useState(0);
  const [notes, setNotes] = useState("");
  const [nextActionText, setNextActionText] = useState("");
  const [nextActionDate, setNextActionDate] = useState("");

  const companySearchRef = useRef<HTMLDivElement>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const callAt = new Date();

  // Reset form when opening
  useEffect(() => {
    if (open) {
      if (!preselectedCompanyId) {
        setCompanySearch("");
        setCompanyId("");
        setSelectedCompanyName("");
      }
      if (!preselectedOpportunityId) {
        setOpportunityCode("");
      }
      setContactName("");
      setCallType("FOLLOW_UP");
      setOutcome("POSITIVE");
      setDurationMins(0);
      setNotes("");
      setNextActionText("");
      setNextActionDate("");
      setCompanyResults([]);
      setShowCompanyDropdown(false);
    }
  }, [open, preselectedCompanyId, preselectedOpportunityId]);

  // Company search
  const handleCompanySearch = useCallback(
    (value: string) => {
      setCompanySearch(value);
      setShowCompanyDropdown(true);

      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }

      if (value.length < 2) {
        setCompanyResults([]);
        return;
      }

      searchTimeoutRef.current = setTimeout(async () => {
        try {
          const res = await fetch(
            `/api/crm/calls?action=searchCompanies&search=${encodeURIComponent(value)}`
          );
          if (res.ok) {
            const data = await res.json();
            setCompanyResults(data.companies || []);
          }
        } catch {
          // Silently ignore search errors
        }
      }, 300);
    },
    []
  );

  // Click outside to close company dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        companySearchRef.current &&
        !companySearchRef.current.contains(event.target as Node)
      ) {
        setShowCompanyDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectCompany = (company: CompanyOption) => {
    setCompanyId(company.id);
    setSelectedCompanyName(
      locale === "ar" && company.nameAr ? company.nameAr : company.nameEn
    );
    setCompanySearch(
      locale === "ar" && company.nameAr ? company.nameAr : company.nameEn
    );
    setShowCompanyDropdown(false);
    setCompanyResults([]);
  };

  const handleSubmit = async () => {
    if (!callType || !outcome) {
      toast.error(
        locale === "ar"
          ? "يرجى ملء الحقول المطلوبة"
          : "Please fill required fields"
      );
      return;
    }

    setIsSubmitting(true);

    try {
      const body = {
        companyId: companyId || undefined,
        contactName: contactName || undefined,
        callType,
        outcome,
        durationMins,
        callAt: callAt.toISOString(),
        notes: notes || undefined,
        nextActionText: nextActionText || undefined,
        nextActionDate: nextActionDate || undefined,
        opportunityId: opportunityCode || undefined,
      };

      const res = await fetch("/api/crm/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        // Server returns `{ error, fieldErrors: { field: string[] } }`
        // (the project-standard shape via describeZodError). Concatenate
        // the per-field messages onto the headline so the rep sees the
        // specific problem ("Duration must be at least 1") instead of
        // a generic "Failed to create call" toast.
        const err = (await res.json().catch(() => ({}))) as {
          error?: string;
          fieldErrors?: Record<string, string[]>;
        };
        const fieldLines = err.fieldErrors
          ? Object.entries(err.fieldErrors)
              .flatMap(([field, msgs]) => msgs.map((m) => `${field}: ${m}`))
              .join("\n")
          : "";
        const headline = err.error || "Failed to create call";
        throw new Error(fieldLines ? `${headline}\n${fieldLines}` : headline);
      }

      toast.success(
        locale === "ar"
          ? "تم تسجيل المكالمة بنجاح"
          : "Call logged successfully"
      );

      // Show suggestion toast for certain outcomes
      if (
        (outcome === "MEETING_BOOKED" || outcome === "PROPOSAL_REQUEST") &&
        opportunityCode
      ) {
        toast.info(
          locale === "ar"
            ? outcome === "MEETING_BOOKED"
              ? "تلميح: لا تنس تحديث مرحلة الفرصة إلى اجتماع استكشافي أو فني"
              : "تلميح: لا تنس تحديث مرحلة الفرصة إلى إرسال العرض"
            : outcome === "MEETING_BOOKED"
              ? "Tip: Don't forget to update the opportunity stage to Discovery or Tech Meeting"
              : "Tip: Don't forget to update the opportunity stage to Proposal Sent",
          { duration: 6000 }
        );
      }

      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : locale === "ar"
            ? "حدث خطأ أثناء تسجيل المكالمة"
            : "Error logging call"
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatDateTime = (date: Date) => {
    return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-US", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        className="w-full overflow-y-auto sm:max-w-lg"
      >
        <SheetHeader>
          <SheetTitle>{t.common.logCall}</SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-5 p-4">
          {/* Call time display */}
          <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
            <span className="ltr-nums">{formatDateTime(callAt)}</span>
          </div>

          {/* Company search */}
          <div className="space-y-1.5" ref={companySearchRef}>
            <Label className="text-sm">{t.forms.companyName}</Label>
            <div className="relative">
              <Input
                value={companySearch}
                onChange={(e) => handleCompanySearch(e.target.value)}
                placeholder={t.forms.selectCompany}
                className="h-11"
              />
              {showCompanyDropdown && companyResults.length > 0 && (
                <div className="absolute top-full z-50 mt-1 w-full rounded-lg border bg-popover shadow-md">
                  {companyResults.map((company) => (
                    <button
                      key={company.id}
                      type="button"
                      className="flex w-full items-center px-3 py-2.5 text-sm hover:bg-accent"
                      onClick={() => selectCompany(company)}
                    >
                      {locale === "ar" && company.nameAr
                        ? company.nameAr
                        : company.nameEn}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {selectedCompanyName && (
              <p className="text-xs text-muted-foreground">
                {locale === "ar" ? "تم اختيار:" : "Selected:"}{" "}
                {selectedCompanyName}
              </p>
            )}
          </div>

          {/* Contact name */}
          <div className="space-y-1.5">
            <Label className="text-sm">{t.forms.contactName}</Label>
            <Input
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder={t.forms.contactName}
              className="h-11"
            />
          </div>

          {/* Call type */}
          <div className="space-y-1.5">
            <Label className="text-sm">{t.forms.callType}</Label>
            <Select
              value={callType}
              onValueChange={(val) => setCallType(val as CrmCallType)}
            >
              <SelectTrigger className="h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CALL_TYPES.map((ct) => (
                  <SelectItem key={ct} value={ct}>
                    {t.callTypes[ct]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Outcome */}
          <div className="space-y-1.5">
            <Label className="text-sm">{t.forms.callOutcome}</Label>
            <Select
              value={outcome}
              onValueChange={(val) => setOutcome(val as CrmCallOutcome)}
            >
              <SelectTrigger className="h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CALL_OUTCOMES.map((o) => (
                  <SelectItem key={o} value={o}>
                    {t.callOutcomes[o]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Link to opportunity */}
          <div className="space-y-1.5">
            <Label className="text-sm">
              {locale === "ar" ? "ربط بفرصة (كود)" : "Link to Opportunity (Code)"}
              <span className="ms-1 text-xs text-muted-foreground">
                ({t.common.optional})
              </span>
            </Label>
            <Input
              value={opportunityCode}
              onChange={(e) => setOpportunityCode(e.target.value)}
              placeholder={locale === "ar" ? "مثال: OPP-0001" : "e.g. OPP-0001"}
              className="h-11 font-mono"
              dir="ltr"
            />
          </div>

          {/* Duration */}
          <div className="space-y-1.5">
            <Label className="text-sm">{t.forms.duration}</Label>
            <Input
              type="number"
              min={0}
              value={durationMins}
              onChange={(e) => setDurationMins(Number(e.target.value) || 0)}
              className="h-11"
              dir="ltr"
            />
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label className="text-sm">{t.forms.callNotes}</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t.forms.callNotes}
              rows={3}
              className="min-h-[80px]"
            />
          </div>

          {/* Next action text */}
          <div className="space-y-1.5">
            <Label className="text-sm">{t.forms.nextActionText}</Label>
            <Input
              value={nextActionText}
              onChange={(e) => setNextActionText(e.target.value)}
              placeholder={t.forms.nextActionText}
              className="h-11"
            />
          </div>

          {/* Next action date */}
          <div className="space-y-1.5">
            <Label className="text-sm">{t.forms.nextActionDate}</Label>
            <Input
              type="date"
              value={nextActionDate}
              onChange={(e) => setNextActionDate(e.target.value)}
              className="h-11"
              dir="ltr"
            />
          </div>

          {/* Submit */}
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="mt-2 h-12 w-full text-base font-medium"
          >
            {isSubmitting
              ? t.common.loading
              : t.common.logCall}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
