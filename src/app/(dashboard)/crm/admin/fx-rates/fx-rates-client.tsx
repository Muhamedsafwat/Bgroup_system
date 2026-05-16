"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useLocale } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createFxRate, deleteFxRate, updateFxRate } from "../actions";

type FxRateItem = {
  id: string;
  currency: string;
  toEGP: unknown;
  updatedAt: string;
};

const ALL_CURRENCIES = ["EGP", "USD", "SAR", "AED", "QAR"] as const;

export function FxRatesClient({ rates }: { rates: FxRateItem[] }) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRate, setEditRate] = useState("");

  const [addOpen, setAddOpen] = useState(false);
  const [addCurrency, setAddCurrency] = useState<string>("");
  const [addRate, setAddRate] = useState("");

  const currencyNames = t.currencyNames as Record<string, string>;
  const currencySymbols = t.currencies as Record<string, string>;

  // Determine which currencies are NOT yet configured — only those are
  // selectable in the "Add" dialog.
  const existing = new Set(rates.map((r) => r.currency));
  const availableToAdd = ALL_CURRENCIES.filter((c) => !existing.has(c));

  function startEdit(rate: FxRateItem) {
    setEditingId(rate.id);
    setEditRate(String(Number(rate.toEGP)));
  }

  function cancelEdit() {
    setEditingId(null);
    setEditRate("");
  }

  async function handleSave(rate: FxRateItem) {
    startTransition(async () => {
      try {
        await updateFxRate(rate.currency, Number(editRate));
        toast.success(`${rate.currency} rate updated`);
        setEditingId(null);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Update failed");
      }
    });
  }

  function openAdd() {
    setAddCurrency(availableToAdd[0] ?? "");
    setAddRate("");
    setAddOpen(true);
  }

  async function handleAdd() {
    if (!addCurrency || !addRate) return;
    startTransition(async () => {
      try {
        await createFxRate({ currency: addCurrency, rate: Number(addRate) });
        toast.success(`${addCurrency} rate added`);
        setAddOpen(false);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Add failed");
      }
    });
  }

  async function handleDelete(rate: FxRateItem) {
    const ok = window.confirm(
      `Delete the ${rate.currency} rate? Opportunities priced in ${rate.currency} will be blocked.`
    );
    if (!ok) return;
    startTransition(async () => {
      try {
        await deleteFxRate(rate.currency);
        toast.success(`${rate.currency} rate deleted`);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Delete failed");
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t.nav.fxRates}</h1>
        <Button onClick={openAdd} disabled={pending || availableToAdd.length === 0}>
          <Plus className="me-1 h-4 w-4" />
          {locale === "ar" ? "إضافة عملة" : "Add currency"}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {locale === "ar"
              ? "تحذير: تغييرات الأسعار لا تطبق بأثر رجعي على الفرص الحالية"
              : "Warning: Rate changes are non-retroactive and will not update existing opportunities"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{locale === "ar" ? "العملة" : "Currency"}</TableHead>
                  <TableHead>{locale === "ar" ? "الرمز" : "Symbol"}</TableHead>
                  <TableHead>
                    {locale === "ar" ? "السعر مقابل ج.م" : "Rate to EGP"}
                  </TableHead>
                  <TableHead>
                    {locale === "ar" ? "آخر تحديث" : "Last Updated"}
                  </TableHead>
                  <TableHead className="text-end">{t.common.actions}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rates.map((rate) => (
                  <TableRow key={rate.id}>
                    <TableCell className="font-medium">
                      {currencyNames[rate.currency] ?? rate.currency}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {currencySymbols[rate.currency] ?? rate.currency}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {editingId === rate.id ? (
                        <Input
                          type="number"
                          step="0.0001"
                          value={editRate}
                          onChange={(e) => setEditRate(e.target.value)}
                          className="w-32"
                          autoFocus
                        />
                      ) : (
                        <span className="ltr-nums font-mono">
                          {Number(rate.toEGP).toLocaleString(undefined, {
                            minimumFractionDigits: 4,
                            maximumFractionDigits: 4,
                          })}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(rate.updatedAt).toLocaleDateString(
                        locale === "ar" ? "ar-EG" : "en-US",
                        { dateStyle: "medium" }
                      )}
                    </TableCell>
                    <TableCell className="text-end">
                      {editingId === rate.id ? (
                        <div className="inline-flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => handleSave(rate)}
                            disabled={pending || !editRate}
                          >
                            {t.common.save}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={cancelEdit}
                            disabled={pending}
                          >
                            {t.common.cancel}
                          </Button>
                        </div>
                      ) : (
                        <div className="inline-flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => startEdit(rate)}
                            disabled={pending}
                          >
                            {t.common.edit}
                          </Button>
                          {rate.currency !== "EGP" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDelete(rate)}
                              disabled={pending}
                              className="text-destructive hover:text-destructive"
                              title={locale === "ar" ? "حذف" : "Delete"}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {rates.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                      {locale === "ar" ? "لا توجد أسعار صرف" : "No FX rates configured"}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {locale === "ar" ? "إضافة عملة" : "Add currency"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{locale === "ar" ? "العملة" : "Currency"}</Label>
              <Select value={addCurrency} onValueChange={(v) => setAddCurrency(v ?? "")}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick a currency">
                    {(v) => (v ? (currencyNames[v] ?? v) : "Pick a currency")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {availableToAdd.map((c) => (
                    <SelectItem key={c} value={c}>
                      {currencyNames[c] ?? c} ({c})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{locale === "ar" ? "السعر مقابل ج.م" : "Rate to EGP"}</Label>
              <Input
                type="number"
                step="0.0001"
                value={addRate}
                onChange={(e) => setAddRate(e.target.value)}
                placeholder="e.g. 48.5"
              />
              <p className="text-xs text-muted-foreground">
                {locale === "ar"
                  ? "كم جنيه مصري يساوي وحدة واحدة من هذه العملة؟"
                  : "How many EGP equal 1 unit of this currency?"}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={pending}>
              {t.common.cancel}
            </Button>
            <Button
              onClick={handleAdd}
              disabled={pending || !addCurrency || !addRate || Number(addRate) <= 0}
            >
              {locale === "ar" ? "إضافة" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
