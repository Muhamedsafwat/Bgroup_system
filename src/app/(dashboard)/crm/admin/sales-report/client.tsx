"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { useLocale } from "@/lib/i18n";

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

const WINDOW_PRESETS: { value: string; label: string; range: () => { from: string; to: string } }[] = [
  {
    value: "this-week",
    label: "This week",
    range: () => {
      const t = new Date();
      const start = new Date(t);
      start.setDate(t.getDate() - t.getDay());
      return { from: ymd(start), to: ymd(t) };
    },
  },
  {
    value: "last-week",
    label: "Last week",
    range: () => {
      const t = new Date();
      const end = new Date(t);
      end.setDate(t.getDate() - t.getDay() - 1);
      const start = new Date(end);
      start.setDate(end.getDate() - 6);
      return { from: ymd(start), to: ymd(end) };
    },
  },
  {
    value: "this-month",
    label: "This month",
    range: () => {
      const t = new Date();
      const start = new Date(t.getFullYear(), t.getMonth(), 1);
      return { from: ymd(start), to: ymd(t) };
    },
  },
  {
    value: "last-30",
    label: "Last 30 days",
    range: () => {
      const t = new Date();
      const start = new Date(t);
      start.setDate(t.getDate() - 30);
      return { from: ymd(start), to: ymd(t) };
    },
  },
];

type Preview = {
  activity: { calls: number; meetingsBooked: number; meetingsHeld: number; newLeads: number };
  opps: { opened: number; won: number; lost: number; ongoing: number; wonValue: number };
};

/**
 * Sales report — manager-facing weekly/monthly report builder.
 * Pick a window, see a live KPI preview, click Download to get the
 * multi-sheet Excel with the same numbers expanded into row-level
 * detail (opportunities / won deals / lost deals / calls).
 */
export function SalesReportClient() {
  const { locale } = useLocale();
  const [from, setFrom] = useState(WINDOW_PRESETS[0].range().from);
  const [to, setTo] = useState(WINDOW_PRESETS[0].range().to);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);

  const fmt = useMemo(
    () => new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-US"),
    [locale]
  );

  function applyPreset(value: string) {
    const preset = WINDOW_PRESETS.find((p) => p.value === value);
    if (!preset) return;
    const { from: f, to: t } = preset.range();
    setFrom(f);
    setTo(t);
  }

  async function loadPreview() {
    setLoading(true);
    try {
      // Reuse the existing report endpoints to populate the preview
      // without downloading a full xlsx — daily-reports for activity
      // totals, loss-analytics for the won/lost split, and a single
      // count call for "ongoing".
      const [activityRes, lossRes, ongoingRes] = await Promise.all([
        fetch(`/api/crm/daily-reports?from=${from}&to=${to}&scope=all`),
        fetch(`/api/crm/reports/loss-analytics?from=${from}&to=${to}`),
        fetch("/api/crm/pipeline?scope=all"),
      ]);
      const activity = activityRes.ok ? await activityRes.json() : null;
      const loss = lossRes.ok ? await lossRes.json() : null;
      const ongoing = ongoingRes.ok ? await ongoingRes.json() : null;

      setPreview({
        activity: activity?.totals ?? {
          callsCount: 0,
          meetingsBooked: 0,
          meetingsHeld: 0,
          newLeads: 0,
        },
        opps: {
          // "opened" — best-effort approximation from the loss
          // endpoint's totals + win count. The export endpoint
          // does the precise count; the preview is just a heads-up.
          opened: (loss?.totals?.lostCount ?? 0) + (loss?.totals?.wonCount ?? 0),
          won: loss?.totals?.wonCount ?? 0,
          lost: loss?.totals?.lostCount ?? 0,
          ongoing: ongoing?.opportunities?.length ?? 0,
          wonValue: loss?.totals?.wonValueEGP ?? 0, // audit v12 HIGH (HIGH-39): read from API instead of hardcoding 0
        },
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Two download paths share the same date filter — PDF is the
  // headline "high-design" output the manager downloads for review;
  // Excel stays available for anyone who wants to slice the data
  // further in their own spreadsheet.
  const pdfHref = `/api/crm/reports/sales-report/pdf?from=${from}&to=${to}`;
  const xlsxHref = `/api/crm/reports/sales-report/export?from=${from}&to=${to}`;

  // Normalise the activity shape — different endpoints use slightly
  // different keys (callsCount vs calls) historically.
  const activity = preview?.activity ?? {
    calls: 0,
    meetingsBooked: 0,
    meetingsHeld: 0,
    newLeads: 0,
  };
  const calls =
    (activity as { calls?: number; callsCount?: number }).calls ??
    (activity as { callsCount?: number }).callsCount ??
    0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">
            {locale === "ar" ? "تقرير المبيعات" : "Sales report"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {locale === "ar"
              ? "اختر فترة وحمّل تقرير Excel شاملًا. الأرقام أسفل تتحدّث فورًا."
              : "Pick a window and download the full Excel. Numbers below update live."}
          </p>
        </div>
        <div className="flex gap-2">
          <a href={pdfHref} download>
            <Button>
              <Download className="h-4 w-4 me-2" />
              {locale === "ar" ? "تحميل PDF" : "Download PDF"}
            </Button>
          </a>
          <a href={xlsxHref} download>
            <Button variant="outline">
              <Download className="h-4 w-4 me-2" />
              Excel
            </Button>
          </a>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
            {locale === "ar" ? "النطاق الزمني" : "Time window"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {WINDOW_PRESETS.map((p) => (
              <Button
                key={p.value}
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => applyPreset(p.value)}
              >
                {p.label}
              </Button>
            ))}
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
            <Button size="sm" onClick={loadPreview} disabled={loading}>
              {loading && <Loader2 className="h-3.5 w-3.5 me-1.5 animate-spin" />}
              {locale === "ar" ? "تحديث المعاينة" : "Refresh preview"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {locale === "ar" ? "ملخص الفترة" : "Period summary"}
            <Badge variant="outline" className="ms-2 text-xs ltr-nums">
              {from} → {to}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Tile label={locale === "ar" ? "مكالمات" : "Calls made"} value={fmt.format(calls)} />
            <Tile label={locale === "ar" ? "اجتماعات محجوزة" : "Meetings booked"} value={fmt.format(activity.meetingsBooked)} />
            <Tile label={locale === "ar" ? "اجتماعات منعقدة" : "Meetings held"} value={fmt.format(activity.meetingsHeld)} />
            <Tile label={locale === "ar" ? "عملاء جدد" : "New leads"} value={fmt.format(activity.newLeads)} />
            <Tile
              label={locale === "ar" ? "فرص فُتحت" : "Opps opened"}
              value={fmt.format(preview?.opps.opened ?? 0)}
              accent="blue"
            />
            <Tile
              label={locale === "ar" ? "صفقات مكتسبة" : "Won"}
              value={fmt.format(preview?.opps.won ?? 0)}
              accent="green"
            />
            <Tile
              label={locale === "ar" ? "صفقات مفقودة" : "Lost"}
              value={fmt.format(preview?.opps.lost ?? 0)}
              accent="red"
            />
            <Tile
              label={locale === "ar" ? "مستمرة الآن" : "Ongoing"}
              value={fmt.format(preview?.opps.ongoing ?? 0)}
              accent="amber"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {locale === "ar" ? "محتويات التقرير" : "What's in the report"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="text-sm space-y-1.5 list-disc ps-5 text-muted-foreground">
            <li>
              <strong className="text-foreground">Hero header</strong> — title, company, sales manager, period
            </li>
            <li>
              <strong className="text-foreground">8 KPI tiles</strong> — calls, meetings booked, meetings held, new leads, opps opened, won (+ value), lost, ongoing
            </li>
            <li>
              <strong className="text-foreground">Opportunities table</strong> — one row per opp with customer, service, cost, income, stage pill, contact, source, quality pill, deal type, owner, closing %
            </li>
            <li>
              <strong className="text-foreground">Revenue by service</strong> — grid of cards with EGP totals + bar visuals
            </li>
            <li>
              <strong className="text-foreground">Three summary panels</strong> — source / quality / lead-stage with count + % share
            </li>
          </ul>
          <p className="text-xs text-muted-foreground mt-3">
            PDF is the headline output (high-design, ready to send). Excel stays available for further slicing.
          </p>
        </CardContent>
      </Card>
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
  accent?: "blue" | "green" | "red" | "amber";
}) {
  const color =
    accent === "blue"
      ? "text-blue-600"
      : accent === "green"
        ? "text-emerald-600"
        : accent === "red"
          ? "text-red-600"
          : accent === "amber"
            ? "text-amber-600"
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
