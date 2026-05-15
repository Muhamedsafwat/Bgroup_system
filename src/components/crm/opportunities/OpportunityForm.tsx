"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useLocale } from "@/lib/i18n";
import {
  createOpportunitySchema,
  type CreateOpportunityInput,
  type UpdateOpportunityInput,
} from "@/lib/crm/validations/opportunity";
import {
  createOpportunity,
  updateOpportunity,
} from "@/app/(dashboard)/crm/opportunities/actions";
import { createCompanyAction } from "@/app/(dashboard)/crm/companies/form-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Plus, X, Check } from "lucide-react";
import type { Locale } from "@/lib/i18n";

type Entity = { id: string; code: string; nameEn: string; nameAr: string };
type LeadSource = { id: string; code: string; labelEn: string; labelAr: string };
type Company = { id: string; nameEn: string; nameAr: string | null };
type Product = { id: string; code: string; nameEn: string; nameAr: string; entityId: string; basePrice: number; currency: string };

/**
 * Initial values when editing — supplied by the edit page. When omitted the
 * form runs in create mode (the original behavior).
 */
type OpportunityFormInitial = {
  id: string;
  companyId: string;
  primaryContactId?: string | null;
  entityId: string;
  title?: string | null;
  priority?: "HOT" | "WARM" | "COLD" | null;
  leadSource?: string | null;
  dealType?: "ONE_TIME" | "MONTHLY" | "ANNUAL" | "SAAS" | "MIXED" | "RETAINER" | null;
  estimatedValue: number;
  currency?: "EGP" | "USD" | "SAR" | "AED" | "QAR" | null;
  expectedCloseDate?: string | null;
  nextAction?: CreateOpportunityInput["nextAction"] | null;
  nextActionText?: string | null;
  nextActionDate?: string | null;
  description?: string | null;
  techRequirements?: string | null;
  productIds?: string[];
};

export function OpportunityForm({
  entities,
  leadSources,
  companies,
  products,
  userEntityId,
  locale,
  initial,
}: {
  entities: Entity[];
  leadSources: LeadSource[];
  companies: Company[];
  products: Product[];
  userEntityId: string | null;
  locale: Locale;
  initial?: OpportunityFormInitial;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const isEdit = !!initial;

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateOpportunityInput>({
    resolver: zodResolver(createOpportunitySchema),
    defaultValues: initial
      ? {
          companyId: initial.companyId,
          primaryContactId: initial.primaryContactId ?? undefined,
          entityId: initial.entityId,
          title: initial.title ?? undefined,
          priority: initial.priority ?? "COLD",
          leadSource: initial.leadSource ?? undefined,
          dealType: initial.dealType ?? "ONE_TIME",
          estimatedValue: initial.estimatedValue,
          currency: initial.currency ?? "EGP",
          expectedCloseDate: initial.expectedCloseDate ?? undefined,
          nextAction: initial.nextAction ?? "FOLLOW_UP",
          nextActionText: initial.nextActionText ?? undefined,
          nextActionDate:
            initial.nextActionDate ??
            new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
          description: initial.description ?? undefined,
          techRequirements: initial.techRequirements ?? undefined,
          productIds: initial.productIds ?? [],
        }
      : {
          entityId: userEntityId || "",
          currency: "EGP",
          priority: "COLD",
          dealType: "ONE_TIME",
          nextAction: "FOLLOW_UP",
          productIds: [],
          nextActionDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
            .toISOString()
            .split("T")[0],
          expectedCloseDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
            .toISOString()
            .split("T")[0],
        },
  });

  const [selectedProductIds, setSelectedProductIds] = useState<string[]>(
    initial?.productIds ?? []
  );
  const [productSearch, setProductSearch] = useState("");

  function toggleProduct(id: string) {
    setSelectedProductIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      setValue("productIds", next, { shouldDirty: true });
      return next;
    });
  }

  const selectedEntityId = watch("entityId");
  const selectedCompanyId = watch("companyId");
  const selectedCurrency = watch("currency");
  const estimatedValue = watch("estimatedValue");

  // Local extension of the company list so the inline-create flow can append
  // a new company without a full refetch.
  const [companyOptions, setCompanyOptions] = useState<Company[]>(companies);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickAddName, setQuickAddName] = useState("");
  const [quickAddNameAr, setQuickAddNameAr] = useState("");
  const [creatingCompany, setCreatingCompany] = useState(false);

  async function handleQuickCreateCompany() {
    if (!quickAddName.trim()) {
      toast.error(locale === "ar" ? "اسم الشركة مطلوب" : "Company name required");
      return;
    }
    setCreatingCompany(true);
    try {
      const created = await createCompanyAction({
        nameEn: quickAddName.trim(),
        nameAr: quickAddNameAr.trim() || null,
        // Minimal payload — the user can fill the rest later from the
        // company detail page. createCompany will default other fields.
        entityId: selectedEntityId || (companies[0]?.id ?? entities[0]?.id ?? ""),
      } as never);
      const newCo: Company = {
        id: (created as { id: string }).id,
        nameEn: quickAddName.trim(),
        nameAr: quickAddNameAr.trim() || null,
      };
      setCompanyOptions([newCo, ...companyOptions]);
      setValue("companyId", newCo.id);
      setShowQuickAdd(false);
      setQuickAddName("");
      setQuickAddNameAr("");
      toast.success(locale === "ar" ? "تم إنشاء الشركة" : "Company created");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create company");
    } finally {
      setCreatingCompany(false);
    }
  }

  async function onSubmit(data: CreateOpportunityInput) {
    const payload = { ...data, productIds: selectedProductIds };
    try {
      if (isEdit && initial) {
        // Strip fields the update schema doesn't accept (companyId, entityId
        // are immutable post-create; nextAction is required on create but
        // optional on update — pass through as-is).
        const { companyId: _c, entityId: _e, ...rest } = payload;
        await updateOpportunity(initial.id, rest as UpdateOpportunityInput);
        toast.success(locale === "ar" ? "تم تحديث الفرصة" : "Opportunity updated");
        router.push(`/crm/opportunities/${initial.id}`);
        router.refresh();
      } else {
        const opp = await createOpportunity(payload);
        toast.success(locale === "ar" ? "تم إنشاء الفرصة بنجاح" : "Opportunity created successfully");
        router.push(`/crm/opportunities/${opp.id}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Company & Contact */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t.nav.companies}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{t.forms.selectCompany} *</Label>
              {!showQuickAdd && (
                <button
                  type="button"
                  onClick={() => setShowQuickAdd(true)}
                  className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                >
                  <Plus className="h-3 w-3" />
                  {locale === "ar" ? "إضافة شركة جديدة" : "New company"}
                </button>
              )}
            </div>
            <Select
              value={selectedCompanyId}
              onValueChange={(v: any) => setValue("companyId", v)}
            >
              <SelectTrigger>
                <SelectValue placeholder={t.forms.selectCompany}>
                  {(() => {
                    const c = companyOptions.find((x) => x.id === selectedCompanyId);
                    return c
                      ? locale === "ar" && c.nameAr
                        ? c.nameAr
                        : c.nameEn
                      : t.forms.selectCompany;
                  })()}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {companyOptions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {locale === "ar" && c.nameAr ? c.nameAr : c.nameEn}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.companyId && (
              <p className="text-sm text-destructive mt-1">{errors.companyId.message}</p>
            )}

            {/* Inline "quick add" — saves a stub Company without leaving the
                opportunity form, then auto-selects it. The user can fill in
                the rest of the company profile from /crm/companies later. */}
            {showQuickAdd && (
              <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                    {locale === "ar" ? "إضافة شركة سريعة" : "Quick-add company"}
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowQuickAdd(false)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Input
                    placeholder={locale === "ar" ? "الاسم (إنجليزي)" : "Name (English)"}
                    value={quickAddName}
                    onChange={(e) => setQuickAddName(e.target.value)}
                    autoFocus
                  />
                  <Input
                    placeholder={locale === "ar" ? "الاسم (عربي)" : "Name (Arabic)"}
                    value={quickAddNameAr}
                    onChange={(e) => setQuickAddNameAr(e.target.value)}
                    dir="rtl"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setShowQuickAdd(false)}
                    disabled={creatingCompany}
                  >
                    {t.common.cancel}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleQuickCreateCompany}
                    disabled={creatingCompany || !quickAddName.trim()}
                  >
                    {creatingCompany
                      ? locale === "ar"
                        ? "جارٍ الإنشاء..."
                        : "Creating..."
                      : locale === "ar"
                        ? "إنشاء واختيار"
                        : "Create & select"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Deal Details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t.nav.opportunities}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>{t.forms.entity} *</Label>
              <Select
                value={selectedEntityId}
                onValueChange={(v: any) => setValue("entityId", v)}
              >
                <SelectTrigger>
                  {/* Radix SelectValue falls back to the raw value (a cuid)
                      when there's no matching rendered SelectItem on mount.
                      Resolve the display label explicitly so the trigger
                      always shows the entity name, not its id. */}
                  <SelectValue placeholder={t.forms.selectEntity}>
                    {(() => {
                      const e = entities.find((x) => x.id === selectedEntityId);
                      return e ? (locale === "ar" ? e.nameAr : e.nameEn) : t.forms.selectEntity;
                    })()}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {entities.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {locale === "ar" ? e.nameAr : e.nameEn}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.entityId && (
                <p className="text-sm text-destructive mt-1">{errors.entityId.message}</p>
              )}
            </div>

            <div>
              <Label>{t.forms.priority}</Label>
              <Select
                defaultValue="COLD"
                onValueChange={(v: any) => setValue("priority", v as "HOT" | "WARM" | "COLD")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="HOT">{t.priorities.HOT}</SelectItem>
                  <SelectItem value="WARM">{t.priorities.WARM}</SelectItem>
                  <SelectItem value="COLD">{t.priorities.COLD}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>{t.forms.estimatedValue} *</Label>
              <Input
                type="number"
                {...register("estimatedValue", { valueAsNumber: true })}
                className="ltr-nums"
                dir="ltr"
              />
              {errors.estimatedValue && (
                <p className="text-sm text-destructive mt-1">{errors.estimatedValue.message}</p>
              )}
            </div>

            <div>
              <Label>{t.forms.currency}</Label>
              <Select
                defaultValue="EGP"
                onValueChange={(v: any) => setValue("currency", v as "EGP" | "USD" | "SAR" | "AED" | "QAR")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["EGP", "USD", "SAR", "AED", "QAR"] as const).map((c) => (
                    <SelectItem key={c} value={c}>
                      {t.currencyNames[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>{t.forms.dealType}</Label>
              <Select
                defaultValue="ONE_TIME"
                onValueChange={(v: any) => setValue("dealType", v as CreateOpportunityInput["dealType"])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["ONE_TIME", "MONTHLY", "ANNUAL", "SAAS", "MIXED", "RETAINER"] as const).map((dt) => (
                    <SelectItem key={dt} value={dt}>
                      {t.dealTypes[dt]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>{t.forms.leadSource}</Label>
              <Select onValueChange={(v: any) => setValue("leadSource", v)}>
                <SelectTrigger>
                  <SelectValue placeholder={t.forms.leadSource} />
                </SelectTrigger>
                <SelectContent>
                  {leadSources.map((ls) => (
                    <SelectItem key={ls.code} value={ls.code}>
                      {locale === "ar" ? ls.labelAr : ls.labelEn}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>{t.forms.expectedCloseDate}</Label>
              <Input
                type="date"
                {...register("expectedCloseDate")}
                className="ltr-nums"
                dir="ltr"
              />
            </div>
          </div>

          <div>
            <Label>{t.common.description}</Label>
            <Textarea {...register("description")} rows={3} />
          </div>

          <div>
            <Label>{t.forms.techRequirements}</Label>
            <Textarea {...register("techRequirements")} rows={2} />
          </div>
        </CardContent>
      </Card>

      {/* Products & services the customer is interested in. Filtered by the
          selected entity when one is picked so reps don't see cross-entity
          offerings (a rep at Entity A doesn't sell Entity B's services). */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {locale === "ar" ? "المنتجات والخدمات" : "Products & services"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {locale === "ar"
              ? "اختر المنتجات أو الخدمات التي يهتم بها العميل."
              : "Pick the products or services this customer is interested in."}
          </p>
          <Input
            placeholder={locale === "ar" ? "ابحث..." : "Search products / services..."}
            value={productSearch}
            onChange={(e) => setProductSearch(e.target.value)}
          />
          <div className="max-h-72 overflow-y-auto rounded-lg border border-border divide-y">
            {(() => {
              const q = productSearch.trim().toLowerCase();
              const filtered = products.filter((p) => {
                if (selectedEntityId && p.entityId !== selectedEntityId) return false;
                if (!q) return true;
                return (
                  p.code.toLowerCase().includes(q) ||
                  p.nameEn.toLowerCase().includes(q) ||
                  (p.nameAr && p.nameAr.toLowerCase().includes(q))
                );
              });
              if (filtered.length === 0) {
                return (
                  <p className="p-4 text-sm text-muted-foreground text-center">
                    {locale === "ar"
                      ? "لا توجد منتجات تطابق الفلتر"
                      : "No products match this filter"}
                  </p>
                );
              }
              return filtered.map((p) => {
                const selected = selectedProductIds.includes(p.id);
                return (
                  <button
                    type="button"
                    key={p.id}
                    onClick={() => toggleProduct(p.id)}
                    className={`flex w-full items-center gap-3 px-3 py-2 text-start hover:bg-accent transition-colors ${
                      selected ? "bg-primary/5" : ""
                    }`}
                  >
                    <span
                      className={`inline-flex h-5 w-5 items-center justify-center rounded border ${
                        selected
                          ? "bg-primary border-primary text-primary-foreground"
                          : "border-border"
                      }`}
                    >
                      {selected && <Check className="h-3.5 w-3.5" />}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium truncate">
                        {locale === "ar" ? p.nameAr : p.nameEn}
                      </span>
                      <span className="block text-xs text-muted-foreground font-mono">
                        {p.code}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {p.basePrice.toLocaleString()} {p.currency}
                    </span>
                  </button>
                );
              });
            })()}
          </div>
          {selectedProductIds.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selectedProductIds.map((id) => {
                const p = products.find((x) => x.id === id);
                if (!p) return null;
                return (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs"
                  >
                    {locale === "ar" ? p.nameAr : p.nameEn}
                    <button
                      type="button"
                      onClick={() => toggleProduct(id)}
                      className="hover:text-destructive"
                      aria-label="Remove"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Next Action (Required) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t.forms.nextAction} *</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{t.forms.nextActionRequired}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>{t.forms.nextAction} *</Label>
              <Select
                defaultValue="FOLLOW_UP"
                onValueChange={(v: any) => setValue("nextAction", v as CreateOpportunityInput["nextAction"])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(t.nextActions) as Array<keyof typeof t.nextActions>).map((na) => (
                    <SelectItem key={na} value={na}>
                      {t.nextActions[na]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>{t.forms.nextActionDate} *</Label>
              <Input
                type="date"
                {...register("nextActionDate")}
                className="ltr-nums"
                dir="ltr"
              />
              {errors.nextActionDate && (
                <p className="text-sm text-destructive mt-1">{errors.nextActionDate.message}</p>
              )}
            </div>
          </div>

          <div>
            <Label>{t.forms.nextActionText}</Label>
            <Input {...register("nextActionText")} />
          </div>
        </CardContent>
      </Card>

      {/* Submit */}
      <div className="flex gap-3">
        <Button type="submit" disabled={isSubmitting} className="min-w-32">
          {isSubmitting
            ? t.common.loading
            : isEdit
              ? t.common.save
              : t.common.create}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          {t.common.cancel}
        </Button>
      </div>
    </form>
  );
}
