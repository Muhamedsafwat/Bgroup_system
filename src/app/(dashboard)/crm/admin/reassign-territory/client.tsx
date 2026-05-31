"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, ArrowRight, ArrowLeft, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useLocale } from "@/lib/i18n";

type Rep = { id: string; fullName: string; role: string };

type Preview = {
  fromRep: { id: string; fullName: string };
  opportunities: number;
  companies: number;
  coldLeads: number;
  total: number;
};

/**
 * Tier-0 #7 — territory reassignment wizard. Three steps in a single
 * component:
 *
 *   1. Source: pick the rep whose book we're moving.
 *   2. Destination: pick 1-N target reps (round-robin if N>1) + the
 *      scopes (opps / companies / leads). Calls preview endpoint.
 *   3. Confirm: show preview counts + reason field; commit on submit.
 *
 * Step transitions are driven by a `step` state, not a router push,
 * so the user keeps their selections if they bounce back.
 */
export function ReassignTerritoryClient({ reps }: { reps: Rep[] }) {
  const { locale } = useLocale();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [fromRepId, setFromRepId] = useState("");
  const [toRepIds, setToRepIds] = useState<Set<string>>(new Set());
  const [scopes, setScopes] = useState<Set<"opps" | "companies" | "leads">>(
    new Set(["opps", "companies", "leads"])
  );
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [doneSummary, setDoneSummary] = useState<{
    opportunities: number;
    companies: number;
    coldLeads: number;
  } | null>(null);

  function reset() {
    setStep(1);
    setFromRepId("");
    setToRepIds(new Set());
    setScopes(new Set(["opps", "companies", "leads"]));
    setReason("");
    setPreview(null);
    setDoneSummary(null);
  }

  async function loadPreview() {
    if (!fromRepId || scopes.size === 0) return;
    setBusy(true);
    try {
      const res = await fetch("/api/crm/admin/reassign-territory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "preview",
          fromRepId,
          scopes: Array.from(scopes),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Preview failed");
        return;
      }
      setPreview(data.preview);
      setStep(3);
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!fromRepId || toRepIds.size === 0) return;
    setBusy(true);
    try {
      const res = await fetch("/api/crm/admin/reassign-territory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "commit",
          fromRepId,
          toRepIds: Array.from(toRepIds),
          scopes: Array.from(scopes),
          reason: reason.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Commit failed");
        return;
      }
      setDoneSummary({
        opportunities: data.opportunities ?? 0,
        companies: data.companies ?? 0,
        coldLeads: data.coldLeads ?? 0,
      });
      toast.success(
        locale === "ar"
          ? `تم نقل ${data.opportunities + data.companies + data.coldLeads} عنصر`
          : `Reassigned ${data.opportunities + data.companies + data.coldLeads} records`
      );
    } finally {
      setBusy(false);
    }
  }

  const fromRep = reps.find((r) => r.id === fromRepId);

  // Completion screen — user can run another reassign or close.
  if (doneSummary) {
    return (
      <div className="max-w-2xl space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              {locale === "ar" ? "تم النقل" : "Reassignment complete"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>
              {locale === "ar" ? "الفرص: " : "Opportunities: "}
              <strong className="ltr-nums">{doneSummary.opportunities}</strong>
            </p>
            <p>
              {locale === "ar" ? "الشركات: " : "Companies: "}
              <strong className="ltr-nums">{doneSummary.companies}</strong>
            </p>
            <p>
              {locale === "ar" ? "العملاء المحتملون: " : "Cold leads: "}
              <strong className="ltr-nums">{doneSummary.coldLeads}</strong>
            </p>
          </CardContent>
        </Card>
        <Button onClick={reset}>
          {locale === "ar" ? "إعادة تعيين أخرى" : "Reassign another rep"}
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">
          {locale === "ar" ? "إعادة توزيع الإقليم" : "Reassign territory"}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {locale === "ar"
            ? "نقل كامل ملف مندوب (فرص + شركات + عملاء محتملون) إلى مندوب آخر أو عدة مندوبين بالتناوب."
            : "Move a rep's full book — opportunities, companies, cold leads — to one or more destination reps. Round-robin when you pick multiple."}
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm">
        <StepDot active={step === 1} done={step > 1} label={locale === "ar" ? "المصدر" : "Source"} />
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
        <StepDot active={step === 2} done={step > 2} label={locale === "ar" ? "الوجهة" : "Destination"} />
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
        <StepDot active={step === 3} done={false} label={locale === "ar" ? "التأكيد" : "Confirm"} />
      </div>

      {/* Step 1 — source rep */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {locale === "ar" ? "اختر المندوب الذي تريد نقل ملفه" : "Pick the rep whose book you're moving"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Select value={fromRepId} onValueChange={(v) => setFromRepId(v ?? "")}>
              <SelectTrigger>
                <SelectValue placeholder={locale === "ar" ? "اختر المندوب" : "Choose rep"} />
              </SelectTrigger>
              <SelectContent>
                {reps.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.fullName}
                    <span className="text-xs text-muted-foreground ms-1.5">· {r.role}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={() => setStep(2)} disabled={!fromRepId}>
              {locale === "ar" ? "التالي" : "Next"}
              <ArrowRight className="h-4 w-4 ms-1.5" />
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step 2 — destination + scopes */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {locale === "ar"
                ? `الوجهة لـ ${fromRep?.fullName ?? ""}`
                : `Destination for ${fromRep?.fullName ?? ""}`}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="text-xs">
                {locale === "ar"
                  ? "اختر مندوبًا واحدًا أو أكثر (التناوب عند الاختيار المتعدد)"
                  : "Pick one or more destination reps (round-robin if multiple)"}
              </Label>
              <div className="max-h-56 overflow-y-auto rounded-md border divide-y mt-1">
                {reps
                  .filter((r) => r.id !== fromRepId)
                  .map((r) => {
                    const checked = toRepIds.has(r.id);
                    return (
                      <label
                        key={r.id}
                        className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-accent"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => {
                            setToRepIds((prev) => {
                              const next = new Set(prev);
                              if (v) next.add(r.id);
                              else next.delete(r.id);
                              return next;
                            });
                          }}
                        />
                        <span>{r.fullName}</span>
                        <span className="text-xs text-muted-foreground ms-auto">{r.role}</span>
                      </label>
                    );
                  })}
              </div>
            </div>
            <div>
              <Label className="text-xs">
                {locale === "ar" ? "ما يتم نقله" : "What to move"}
              </Label>
              <div className="space-y-1.5 mt-1">
                {(["opps", "companies", "leads"] as const).map((s) => (
                  <label key={s} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={scopes.has(s)}
                      onCheckedChange={(v) => {
                        setScopes((prev) => {
                          const next = new Set(prev);
                          if (v) next.add(s);
                          else next.delete(s);
                          return next;
                        });
                      }}
                    />
                    <span>
                      {s === "opps"
                        ? locale === "ar" ? "الفرص المفتوحة" : "Open opportunities"
                        : s === "companies"
                          ? locale === "ar" ? "الشركات" : "Companies"
                          : locale === "ar" ? "العملاء المحتملون النشطون" : "Active cold leads"}
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(1)}>
                <ArrowLeft className="h-4 w-4 me-1.5" />
                {locale === "ar" ? "السابق" : "Back"}
              </Button>
              <Button
                onClick={loadPreview}
                disabled={busy || toRepIds.size === 0 || scopes.size === 0}
              >
                {busy && <Loader2 className="h-4 w-4 me-1.5 animate-spin" />}
                {locale === "ar" ? "معاينة" : "Preview"}
                <ArrowRight className="h-4 w-4 ms-1.5" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3 — confirm + reason + commit */}
      {step === 3 && preview && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              {locale === "ar" ? "تأكيد النقل" : "Confirm reassignment"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
              <p>
                <strong>{preview.fromRep.fullName}</strong>{" "}
                {locale === "ar" ? "إلى" : "→"}{" "}
                <strong>
                  {Array.from(toRepIds)
                    .map((id) => reps.find((r) => r.id === id)?.fullName ?? id)
                    .join(", ")}
                </strong>
              </p>
              <p className="text-muted-foreground">
                {locale === "ar"
                  ? `${preview.opportunities} فرصة · ${preview.companies} شركة · ${preview.coldLeads} عميل محتمل`
                  : `${preview.opportunities} opps · ${preview.companies} companies · ${preview.coldLeads} cold leads`}
              </p>
              <p className="text-muted-foreground">
                {locale === "ar" ? "الإجمالي: " : "Total: "}
                <strong className="ltr-nums">{preview.total}</strong>
              </p>
            </div>
            <div>
              <Label className="text-xs">
                {locale === "ar" ? "سبب النقل (اختياري)" : "Reason (optional)"}
              </Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={
                  locale === "ar" ? "مثال: المندوب غادر" : "e.g. Rep left the team"
                }
                rows={2}
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                {locale === "ar"
                  ? "تظهر في سجل النشاط لكل فرصة منقولة."
                  : "Logged on every opportunity moved (audit trail)."}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(2)} disabled={busy}>
                <ArrowLeft className="h-4 w-4 me-1.5" />
                {locale === "ar" ? "السابق" : "Back"}
              </Button>
              <Button onClick={commit} disabled={busy} variant="default">
                {busy && <Loader2 className="h-4 w-4 me-1.5 animate-spin" />}
                {locale === "ar" ? "تأكيد النقل" : "Commit reassignment"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StepDot({
  active,
  done,
  label,
}: {
  active: boolean;
  done: boolean;
  label: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 ${
        active ? "text-primary font-medium" : done ? "text-muted-foreground" : "text-muted-foreground/60"
      }`}
    >
      <span
        className={`h-5 w-5 rounded-full border flex items-center justify-center text-[10px] ${
          active
            ? "border-primary bg-primary text-primary-foreground"
            : done
              ? "border-emerald-500 bg-emerald-500 text-white"
              : "border-muted-foreground/30"
        }`}
      >
        {done ? <CheckCircle2 className="h-3 w-3" /> : ""}
      </span>
      <span>{label}</span>
    </span>
  );
}
