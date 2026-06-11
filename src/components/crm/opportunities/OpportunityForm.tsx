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
type Rep = { id: string; fullName: string; fullNameAr: string | null; role: string };

/// One row in the additional-contacts list. Mirrors the
/// opportunityContactSchema; the `id` field is present for existing rows
/// so the server can update in place, absent for newly-added ones.
type ContactRow = {
  id?: string;
  name: string;
  role?: string | null;
  phone?: string | null;
  email?: string | null;
  whatsapp?: string | null;
  notes?: string | null;
};

/**
 * Initial values when editing — supplied by the edit page. When omitted the
 * form runs in create mode (the original behavior).
 */
type OpportunityFormInitial = {
  id: string;
  /// Display-time customer name. We seed the form's free-text input with
  /// this. New opps store it directly on the row; legacy rows fall back
  /// to the linked CrmCompany.nameEn via the loader.
  customerCompanyName?: string | null;
  customerContactName?: string | null;
  customerContactPhone?: string | null;
  customerContactEmail?: string | null;
  /// Repeatable extra contacts beyond the primary trio above. Hydrated
  /// from CrmOpportunityContact rows by the edit page loader.
  contacts?: ContactRow[];
  companyId?: string | null;
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
  reps,
  currentUserId,
  currentOwnerId,
}: {
  entities: Entity[];
  leadSources: LeadSource[];
  companies: Company[];
  products: Product[];
  userEntityId: string | null;
  locale: Locale;
  initial?: OpportunityFormInitial;
  /// When supplied (caller is MANAGER/ADMIN), the form renders an "Assign
  /// to" picker so the manager can create / reassign on behalf of any rep.
  /// REPs never see this section.
  reps?: Rep[];
  /// The caller's own CRM profile id — the picker defaults to "myself" on
  /// create so a manager working on their own deal doesn't have to pick.
  currentUserId?: string;
  /// On edit, the existing opp's owner id so the picker reflects current
  /// state instead of the caller.
  currentOwnerId?: string;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const isEdit = !!initial;

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreateOpportunityInput>({
    resolver: zodResolver(createOpportunitySchema),
    defaultValues: initial
      ? {
          customerCompanyName: initial.customerCompanyName ?? "",
          customerContactName: initial.customerContactName ?? "",
          customerContactPhone: initial.customerContactPhone ?? "",
          customerContactEmail: initial.customerContactEmail ?? "",
          companyId: initial.companyId ?? undefined,
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
          ownerId: currentOwnerId ?? undefined,
        }
      : {
          customerCompanyName: "",
          customerContactName: "",
          customerContactPhone: "",
          customerContactEmail: "",
          entityId: userEntityId || "",
          currency: "EGP",
          priority: "COLD",
          dealType: "ONE_TIME",
          nextAction: "FOLLOW_UP",
          productIds: [],
          // Default to the caller — managers explicitly pick a different
          // rep when they want to "act as" them.
          ownerId: currentUserId ?? undefined,
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

  // Extra contacts beyond the headline trio — repeatable rows the rep can
  // add/remove freely. Persisted to CrmOpportunityContact via the
  // `contacts` field on the create/update opp action.
  const [extraContacts, setExtraContacts] = useState<ContactRow[]>(
    initial?.contacts ?? []
  );

  function addContact() {
    setExtraContacts((prev) => [
      ...prev,
      { name: "", role: "", phone: "", email: "" },
    ]);
  }
  function updateContact(idx: number, patch: Partial<ContactRow>) {
    setExtraContacts((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }
  function removeContact(idx: number) {
    setExtraContacts((prev) => prev.filter((_, i) => i !== idx));
  }

  function toggleProduct(id: string) {
    setSelectedProductIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      setValue("productIds", next, { shouldDirty: true });
      return next;
    });
  }

  const selectedEntityId = watch("entityId");
  const selectedCurrency = watch("currency");
  const estimatedValue = watch("estimatedValue");

  async function onSubmit(data: CreateOpportunityInput) {
    // Strip blank rows (rep clicked "Add" but never typed a name).
    const cleanedContacts = extraContacts
      .map((c) => ({
        id: c.id,
        name: c.name.trim(),
        role: c.role?.trim() || null,
        phone: c.phone?.trim() || null,
        email: c.email?.trim() || null,
      }))
      .filter((c) => c.name.length > 0);
    const payload = { ...data, productIds: selectedProductIds, contacts: cleanedContacts };
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
      // Server-action throws bubble up as Error objects with the message
      // we threw on the server (e.g. "Company not found..."). In production
      // builds Next.js sometimes shows a generic Server-Components-render
      // error overlay BEFORE our toast renders — surface it loudly so the
      // user knows what to fix.
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : "Save failed — try again or contact support";
      // Specifically bind the duplicate-title error to the
      // customerCompanyName input — that's the field the user
      // actually controls that drives the title fallback chain.
      // Without this binding the user sees only a transient toast
      // and no inline cue which field to change.
      if (/already exists/i.test(msg)) {
        setError("customerCompanyName", { type: "server", message: msg });
      }
      toast.error(msg, { duration: 8000 });
      // Don't propagate. Without this, Next.js will catch the re-thrown
      // error and render the global error overlay on top of our toast.
      // The user has the toast — that's enough actionable signal.
      console.warn("[OpportunityForm] save failed:", err);
    }
  }

  // When react-hook-form's resolver rejects (e.g. a freshly-tightened
  // max-length on a field whose UI doesn't render an error tile), the
  // submit handler is never called — silent failure. Surface it as a
  // toast so the user knows why "Update" didn't take, instead of
  // assuming the click did nothing.
  function onValidationError(formErrors: typeof errors) {
    const first = Object.entries(formErrors)[0];
    if (!first) return;
    const [field, err] = first;
    const message =
      (err as { message?: string } | undefined)?.message ??
      `${field} is invalid`;
    toast.error(`${field}: ${message}`, { duration: 8000 });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit, onValidationError)} className="space-y-6">
      {/* Company & Contact */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t.nav.companies}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Customer company name is free text. There's no curated directory
              of customer companies — the rep types whatever the prospect
              calls themselves. Managers + admin can group/filter by this
              column on the pipeline page, but no one navigates to a
              "company page" for a prospect. */}
          <div className="space-y-2">
            <Label htmlFor="customerCompanyName">
              {locale === "ar" ? "اسم شركة العميل" : "Customer company name"} *
            </Label>
            <Input
              id="customerCompanyName"
              {...register("customerCompanyName")}
              placeholder={
                locale === "ar"
                  ? "مثال: شركة الأمل للتجارة"
                  : "e.g. Acme Industries"
              }
              autoFocus={!isEdit}
            />
            <p className="text-xs text-muted-foreground">
              {locale === "ar"
                ? "اكتب اسم الشركة كما يسمونها أنفسهم. لا حاجة لإنشائها في النظام."
                : "Type the company name as the prospect calls themselves. No directory record needed."}
            </p>
            {errors.customerCompanyName && (
              <p className="text-sm text-destructive">
                {errors.customerCompanyName.message}
              </p>
            )}
          </div>

          {/* Contact person — free-text trio. The whole point of this section
              is so the rep records the human they're actually selling to,
              not just a faceless company. All three are optional in case the
              rep is logging an early lead they haven't talked to yet. */}
          <div className="space-y-2 pt-3 border-t border-border">
            <Label className="text-sm font-semibold">
              {locale === "ar" ? "شخص الاتصال" : "Contact person"}
            </Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <Label htmlFor="contactName" className="text-xs">
                  {locale === "ar" ? "الاسم" : "Name"}
                </Label>
                <Input
                  id="contactName"
                  {...register("customerContactName")}
                  placeholder={locale === "ar" ? "مثل: محمد علي" : "e.g. Sara Hassan"}
                />
              </div>
              <div>
                <Label htmlFor="contactPhone" className="text-xs">
                  {locale === "ar" ? "رقم الهاتف" : "Phone"}
                </Label>
                <Input
                  id="contactPhone"
                  type="tel"
                  inputMode="tel"
                  {...register("customerContactPhone")}
                  placeholder="+20 100 123 4567"
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="contactEmail" className="text-xs">
                  {locale === "ar" ? "البريد الإلكتروني" : "Email"}
                </Label>
                <Input
                  id="contactEmail"
                  type="email"
                  inputMode="email"
                  {...register("customerContactEmail")}
                  placeholder="contact@acme.example"
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {locale === "ar"
                ? "كل الحقول اختيارية — يمكنك إضافتها لاحقًا بعد المكالمة الأولى."
                : "All optional — fill in what you have, add the rest after the first call."}
            </p>
          </div>

          {/* Additional contacts — any number of extra people on the deal.
              The first contact above is the "primary"; everything here is
              the rest of the cast (decision maker, technical lead,
              procurement, finance, etc.). Empty rows are dropped on save. */}
          <div className="space-y-2 pt-3 border-t border-border">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold">
                {locale === "ar" ? "جهات اتصال إضافية" : "Additional contacts"}
                {extraContacts.length > 0 && (
                  <span className="ms-2 text-xs font-normal text-muted-foreground">
                    ({extraContacts.length})
                  </span>
                )}
              </Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addContact}
                className="h-7 px-2 text-xs"
              >
                <Plus className="h-3.5 w-3.5 me-1" />
                {locale === "ar" ? "إضافة" : "Add contact"}
              </Button>
            </div>
            {extraContacts.length === 0 && (
              <p className="text-[11px] text-muted-foreground">
                {locale === "ar"
                  ? "للصفقات التي يشترك فيها أكثر من شخص — مثل صانع القرار، المسؤول الفني، إدارة المشتريات."
                  : "For deals with multiple stakeholders — decision maker, technical lead, procurement, etc."}
              </p>
            )}
            <div className="space-y-3">
              {extraContacts.map((c, idx) => (
                <div
                  key={c.id ?? `new-${idx}`}
                  className="rounded-md border border-border bg-muted/20 p-3 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {locale === "ar" ? `جهة اتصال ${idx + 2}` : `Contact ${idx + 2}`}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeContact(idx)}
                      className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                      aria-label={locale === "ar" ? "حذف" : "Remove"}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">
                        {locale === "ar" ? "الاسم" : "Name"} *
                      </Label>
                      <Input
                        value={c.name}
                        onChange={(e) => updateContact(idx, { name: e.target.value })}
                        placeholder={
                          locale === "ar" ? "مثل: أحمد محمود" : "e.g. Ahmed Mahmoud"
                        }
                      />
                    </div>
                    <div>
                      <Label className="text-xs">
                        {locale === "ar" ? "الدور" : "Role"}
                      </Label>
                      <Input
                        value={c.role ?? ""}
                        onChange={(e) => updateContact(idx, { role: e.target.value })}
                        placeholder={
                          locale === "ar" ? "مثل: مدير المشتريات" : "e.g. Procurement"
                        }
                      />
                    </div>
                    <div>
                      <Label className="text-xs">
                        {locale === "ar" ? "الهاتف" : "Phone"}
                      </Label>
                      <Input
                        type="tel"
                        inputMode="tel"
                        value={c.phone ?? ""}
                        onChange={(e) => updateContact(idx, { phone: e.target.value })}
                        placeholder="+20 100 123 4567"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">
                        {locale === "ar" ? "البريد الإلكتروني" : "Email"}
                      </Label>
                      <Input
                        type="email"
                        inputMode="email"
                        value={c.email ?? ""}
                        onChange={(e) => updateContact(idx, { email: e.target.value })}
                        placeholder="contact@example.com"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
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
              <Label>
                {locale === "ar"
                  ? "الشركة التي نبيع منتجاتها *"
                  : "Company we're selling for *"}
              </Label>
              <Select
                value={selectedEntityId}
                onValueChange={(v: any) => setValue("entityId", v)}
              >
                <SelectTrigger>
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
              <p className="text-[11px] text-muted-foreground mt-1">
                {locale === "ar"
                  ? "البائع — أي شركة من شركاتنا تملك هذه الصفقة (BGroup / ByteForce…)."
                  : "The BGroup principal whose products this customer is buying."}
              </p>
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
                    {/* audit v12 MEDIUM (MED-71): a11y aria-label */}
                    <button
                      type="button"
                      onClick={() => toggleProduct(id)}
                      className="hover:text-destructive"
                      aria-label={locale === "ar" ? "حذف" : "Remove"}
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

      {/* Owner picker — MANAGER/ADMIN only. On create this is the "act as
          the rep" workflow; on edit it reassigns the opp without needing
          the bulk transfer endpoint. REPs never see this card. */}
      {reps && reps.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {locale === "ar" ? "تعيين إلى" : "Assign to"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Label>{locale === "ar" ? "المالك" : "Owner"}</Label>
            <Select
              value={watch("ownerId") ?? ""}
              onValueChange={(v) => setValue("ownerId", v ?? undefined, { shouldDirty: true })}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={locale === "ar" ? "اختر المندوب" : "Pick a rep"}
                />
              </SelectTrigger>
              <SelectContent>
                {reps.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {locale === "ar" && r.fullNameAr ? r.fullNameAr : r.fullName}
                    <span className="text-muted-foreground text-xs ms-2">· {r.role}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {locale === "ar"
                ? "أنت مدير — يمكنك إنشاء الفرصة باسم أي مندوب أو إعادة تعيينها له."
                : "You're a manager — create / reassign this opportunity on behalf of any rep."}
            </p>
          </CardContent>
        </Card>
      )}

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
