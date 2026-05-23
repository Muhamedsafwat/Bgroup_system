"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, TrendingDown } from "lucide-react";
import { useLocale } from "@/lib/i18n";

type Slice = {
  count: number;
  totalValue: number;
};
type Report = {
  from: string;
  to: string;
  totals: { lostCount: number; wonCount: number; lostValueEGP: number; lossRatePct: number };
  byReason: (Slice & { reasonId: string; labelEn: string; labelAr: string | null })[];
  byStage: (Slice & { stage: string })[];
  byRep: (Slice & { repId: string; fullName: string })[];
  bySource: (Slice & { source: string })[];
  byCompetitor: (Slice & { competitor: string })[];
};

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

/**
 * Tier-0 #4 — loss-reason analytics page. One date-window filter
 * (default last 90 days) drives five sliced tables. No charts in
 * this first cut — the count + total value per slice is enough for
 * managers to spot patterns; richer visualisation is a polish pass.
 */
export function LossAnalyticsClient() {
  const { locale } = useLocale();
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const today = new Date();
  const ninetyAgo = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);
  const [from, setFrom] = useState(ymd(ninetyAgo));
  const [to, setTo] = useState(ymd(today));

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/crm/reports/loss-analytics?from=${from}&to=${to}`
      );
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fmt = (n: number) =>
    new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-US").format(n);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          {locale === "ar" ? "تحليل الخسائر" : "Loss analytics"}
        </h1>
      </div>
      <div className="flex items-end gap-2">
        <div>
          <Label className="text-xs">{locale === "ar" ? "من" : "From"}</Label>
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-8 w-40 ltr-nums"
            dir="ltr"
          />
        </div>
        <div>
          <Label className="text-xs">{locale === "ar" ? "إلى" : "To"}</Label>
          <Input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-8 w-40 ltr-nums"
            dir="ltr"
          />
        </div>
        <Button size="sm" onClick={load} disabled={loading}>
          {loading && <Loader2 className="h-3.5 w-3.5 me-1.5 animate-spin" />}
          {locale === "ar" ? "تحديث" : "Refresh"}
        </Button>
      </div>

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Tile label={locale === "ar" ? "صفقات مفقودة" : "Lost deals"} value={fmt(data.totals.lostCount)} />
            <Tile label={locale === "ar" ? "صفقات مكتسبة" : "Won deals"} value={fmt(data.totals.wonCount)} />
            <Tile
              label={locale === "ar" ? "قيمة الخسائر (EGP)" : "Lost value (EGP)"}
              value={fmt(data.totals.lostValueEGP)}
            />
            <Tile
              label={locale === "ar" ? "معدل الخسارة" : "Loss rate"}
              value={`${data.totals.lossRatePct}%`}
              accent={data.totals.lossRatePct > 60 ? "red" : data.totals.lossRatePct > 40 ? "amber" : "green"}
            />
          </div>

          <SliceTable
            title={locale === "ar" ? "حسب السبب" : "By reason"}
            rows={data.byReason.map((r) => ({
              label: locale === "ar" && r.labelAr ? r.labelAr : r.labelEn,
              count: r.count,
              value: r.totalValue,
            }))}
            locale={locale}
          />
          <SliceTable
            title={locale === "ar" ? "حسب المرحلة" : "By stage at loss"}
            rows={data.byStage.map((r) => ({ label: r.stage, count: r.count, value: r.totalValue }))}
            locale={locale}
          />
          <SliceTable
            title={locale === "ar" ? "حسب المندوب" : "By rep"}
            rows={data.byRep.map((r) => ({ label: r.fullName, count: r.count, value: r.totalValue }))}
            locale={locale}
          />
          <SliceTable
            title={locale === "ar" ? "حسب المصدر" : "By lead source"}
            rows={data.bySource.map((r) => ({ label: r.source, count: r.count, value: r.totalValue }))}
            locale={locale}
          />
          <SliceTable
            title={locale === "ar" ? "حسب المنافس" : "By competitor"}
            rows={data.byCompetitor.map((r) => ({
              label: r.competitor,
              count: r.count,
              value: r.totalValue,
            }))}
            locale={locale}
          />
        </>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "red" | "amber" | "green";
}) {
  const color =
    accent === "red"
      ? "text-red-600"
      : accent === "amber"
        ? "text-amber-600"
        : accent === "green"
          ? "text-green-600"
          : "";
  return (
    <Card>
      <CardContent className="py-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-xl font-bold ltr-nums ${color}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

function SliceTable({
  title,
  rows,
  locale,
}: {
  title: string;
  rows: { label: string; count: number; value: number }[];
  locale: "en" | "ar";
}) {
  if (!rows.length) return null;
  const fmt = (n: number) =>
    new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-US").format(n);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingDown className="h-4 w-4 text-muted-foreground" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{locale === "ar" ? "التصنيف" : "Bucket"}</TableHead>
              <TableHead className="text-end">{locale === "ar" ? "عدد" : "Count"}</TableHead>
              <TableHead className="text-end">
                {locale === "ar" ? "القيمة (EGP)" : "Value (EGP)"}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.label}>
                <TableCell className="font-medium">{r.label}</TableCell>
                <TableCell className="text-end ltr-nums">{fmt(r.count)}</TableCell>
                <TableCell className="text-end ltr-nums">{fmt(r.value)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
