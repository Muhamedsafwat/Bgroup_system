"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Phone, Calendar, Users, Sparkles, Save, FileText } from "lucide-react";
import { toast } from "sonner";
import { useLocale } from "@/lib/i18n";

type Report = {
  id: string;
  reportDate: string;
  callsCount: number;
  meetingsBooked: number;
  meetingsHeld: number;
  newLeads: number;
  notes: string;
  rep: { id: string; fullName: string };
};

type Totals = {
  callsCount: number;
  meetingsBooked: number;
  meetingsHeld: number;
  newLeads: number;
};

type WindowMode = "this-week" | "this-month" | "last-30" | "ytd";

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function windowDates(mode: WindowMode): { from: string; to: string; label: string } {
  const today = new Date();
  const to = ymd(today);
  const from = new Date(today);
  if (mode === "this-week") {
    from.setDate(from.getDate() - from.getDay());
    return { from: ymd(from), to, label: "This week" };
  }
  if (mode === "this-month") {
    from.setDate(1);
    return { from: ymd(from), to, label: "This month" };
  }
  if (mode === "last-30") {
    from.setDate(from.getDate() - 30);
    return { from: ymd(from), to, label: "Last 30 days" };
  }
  // ytd
  from.setMonth(0, 1);
  return { from: ymd(from), to, label: "Year to date" };
}

export function DailyReportsClient({ isManager }: { isManager: boolean }) {
  const { t, locale } = useLocale();
  const [windowMode, setWindowMode] = useState<WindowMode>("this-week");
  const [scope, setScope] = useState<"mine" | "all">(isManager ? "all" : "mine");
  const [reports, setReports] = useState<Report[]>([]);
  const [totals, setTotals] = useState<Totals>({ callsCount: 0, meetingsBooked: 0, meetingsHeld: 0, newLeads: 0 });
  const [loading, setLoading] = useState(true);
  const [openReport, setOpenReport] = useState<Report | null>(null);

  // Today's submission form
  const today = ymd(new Date());
  const [callsCount, setCallsCount] = useState(0);
  const [meetingsBooked, setMeetingsBooked] = useState(0);
  const [meetingsHeld, setMeetingsHeld] = useState(0);
  const [newLeads, setNewLeads] = useState(0);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function refresh() {
    setLoading(true);
    const w = windowDates(windowMode);
    const params = new URLSearchParams({ from: w.from, to: w.to, scope });
    try {
      const res = await fetch(`/api/crm/daily-reports?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setReports(data.reports ?? []);
        setTotals(data.totals ?? { callsCount: 0, meetingsBooked: 0, meetingsHeld: 0, newLeads: 0 });
        // Pre-fill today's form from the current report if any.
        const todays = (data.reports as Report[]).find((r) => r.reportDate.startsWith(today));
        if (todays) {
          setCallsCount(todays.callsCount);
          setMeetingsBooked(todays.meetingsBooked);
          setMeetingsHeld(todays.meetingsHeld);
          setNewLeads(todays.newLeads);
          setNotes(todays.notes);
        }
      }
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowMode, scope]);

  async function submit() {
    setSaving(true);
    try {
      const res = await fetch("/api/crm/daily-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportDate: today,
          callsCount,
          meetingsBooked,
          meetingsHeld,
          newLeads,
          notes,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Save failed");
        return;
      }
      toast.success("Report saved");
      refresh();
    } finally {
      setSaving(false);
    }
  }

  const win = windowDates(windowMode);

  return (
    <div className="space-y-4">
      {/* Today's submit panel */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Today&apos;s activity — {today}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <Label>Calls made</Label>
              <Input type="number" min={0} value={callsCount} onChange={(e) => setCallsCount(Number(e.target.value) || 0)} />
            </div>
            <div>
              <Label>Meetings booked</Label>
              <Input type="number" min={0} value={meetingsBooked} onChange={(e) => setMeetingsBooked(Number(e.target.value) || 0)} />
            </div>
            <div>
              <Label>Meetings held</Label>
              <Input type="number" min={0} value={meetingsHeld} onChange={(e) => setMeetingsHeld(Number(e.target.value) || 0)} />
            </div>
            <div>
              <Label>New leads</Label>
              <Input type="number" min={0} value={newLeads} onChange={(e) => setNewLeads(Number(e.target.value) || 0)} />
            </div>
          </div>
          <div>
            <Label>Notes (optional)</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="flex justify-end">
            <Button onClick={submit} disabled={saving}>
              <Save className="h-4 w-4 me-1.5" />
              {saving ? "Saving..." : "Save report"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs value={windowMode} onValueChange={(v) => setWindowMode(v as WindowMode)}>
          <TabsList>
            <TabsTrigger value="this-week">{t.pages.thisWeek}</TabsTrigger>
            <TabsTrigger value="this-month">{t.pages.thisMonth}</TabsTrigger>
            <TabsTrigger value="last-30">{locale === "ar" ? "آخر 30 يومًا" : "Last 30 days"}</TabsTrigger>
            <TabsTrigger value="ytd">{locale === "ar" ? "منذ بداية السنة" : "Year to date"}</TabsTrigger>
          </TabsList>
        </Tabs>
        {isManager && (
          <Tabs value={scope} onValueChange={(v) => setScope(v as "mine" | "all")}>
            <TabsList>
              <TabsTrigger value="mine">Mine</TabsTrigger>
              <TabsTrigger value="all">All reps</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      </div>

      {/* Totals tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Total label="Calls made" value={totals.callsCount} icon={Phone} tile="tile-indigo" />
        <Total label="Meetings booked" value={totals.meetingsBooked} icon={Calendar} tile="tile-violet" />
        <Total label="Meetings held" value={totals.meetingsHeld} icon={Calendar} tile="tile-emerald" />
        <Total label="New leads" value={totals.newLeads} icon={Users} tile="tile-amber" />
      </div>

      <p className="text-xs text-muted-foreground">
        Tip: click any row to see the rep&apos;s full notes for that day,
        plus the calls and meetings they logged.
      </p>

      {/* Rows */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {/* Resolve the window label per locale at render time so flipping
                the toggle updates it without remounting the page. */}
            {(() => {
              const arLabel: Record<typeof windowMode, string> = {
                "this-week": "هذا الأسبوع",
                "this-month": "هذا الشهر",
                "last-30": "آخر 30 يومًا",
                "ytd": "منذ بداية السنة",
              };
              return locale === "ar" ? arLabel[windowMode] : win.label;
            })()} — {reports.length} {locale === "ar" ? (reports.length === 1 ? "تقرير" : "تقرير") : (reports.length === 1 ? "report" : "reports")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Loading...</p>
          ) : reports.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No reports in this window.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground border-b">
                  <tr>
                    <th className="text-start py-2 px-2 text-xs font-medium uppercase">Date</th>
                    {isManager && <th className="text-start py-2 px-2 text-xs font-medium uppercase">Rep</th>}
                    <th className="text-end py-2 px-2 text-xs font-medium uppercase">Calls</th>
                    <th className="text-end py-2 px-2 text-xs font-medium uppercase">Booked</th>
                    <th className="text-end py-2 px-2 text-xs font-medium uppercase">Held</th>
                    <th className="text-end py-2 px-2 text-xs font-medium uppercase">Leads</th>
                    <th className="text-start py-2 px-2 text-xs font-medium uppercase">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {reports.map((r) => (
                    <tr
                      key={r.id}
                      onClick={() => setOpenReport(r)}
                      className="cursor-pointer hover:bg-accent/40 transition-colors"
                      title="Click for full details"
                    >
                      <td className="py-2 px-2 ltr-nums">{r.reportDate.split("T")[0]}</td>
                      {isManager && <td className="py-2 px-2">{r.rep.fullName}</td>}
                      <td className="py-2 px-2 text-end ltr-nums">{r.callsCount}</td>
                      <td className="py-2 px-2 text-end ltr-nums">{r.meetingsBooked}</td>
                      <td className="py-2 px-2 text-end ltr-nums">{r.meetingsHeld}</td>
                      <td className="py-2 px-2 text-end ltr-nums">{r.newLeads}</td>
                      <td className="py-2 px-2 text-muted-foreground truncate max-w-xs">{r.notes || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <ReportDetailDialog
        report={openReport}
        isManager={isManager}
        onClose={() => setOpenReport(null)}
      />
    </div>
  );
}

/**
 * Detail dialog. Shows the full report row (counters + untruncated notes),
 * plus the rep's actual calls + meetings for that calendar day. The drill-
 * down queries trust the existing /api/crm/calls and /api/crm/meetings
 * scope filters so a regular rep only sees their own rows; a manager sees
 * any rep's rows for the day they clicked.
 */
function ReportDetailDialog({
  report,
  isManager,
  onClose,
}: {
  report: Report | null;
  isManager: boolean;
  onClose: () => void;
}) {
  type CallRow = {
    id: string;
    code: string;
    callType: string;
    outcome: string;
    callAt: string;
    durationMins: number;
    contactName: string | null;
    notes: string | null;
    opportunity: { id: string; code: string; title: string } | null;
  };
  type MeetingRow = {
    id: string;
    code: string;
    startAt: string;
    endAt: string;
    status: string;
    contactName: string | null;
    customerNeed: string | null;
    opportunity: { id: string; code: string; title: string } | null;
  };
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  const [loadingDrill, setLoadingDrill] = useState(false);

  useEffect(() => {
    if (!report) {
      setCalls([]);
      setMeetings([]);
      return;
    }
    let cancelled = false;
    setLoadingDrill(true);
    // The report.reportDate is UTC midnight. Drill the calls/meetings that
    // happened within that calendar day. Calls + meetings APIs accept
    // from/to ISO bounds.
    const day = new Date(report.reportDate);
    const dayStart = new Date(day);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    Promise.all([
      fetch(
        `/api/crm/calls?repId=${report.rep.id}&from=${dayStart.toISOString()}&to=${dayEnd.toISOString()}`
      )
        .then((r) => (r.ok ? r.json() : { calls: [] }))
        .catch(() => ({ calls: [] })),
      fetch(
        `/api/crm/meetings?scope=all&from=${dayStart.toISOString()}&to=${dayEnd.toISOString()}`
      )
        .then((r) => (r.ok ? r.json() : { meetings: [] }))
        .catch(() => ({ meetings: [] })),
    ])
      .then(([callData, meetingData]) => {
        if (cancelled) return;
        setCalls(callData.calls ?? []);
        setMeetings(
          (meetingData.meetings ?? []).filter(
            (m: { scheduledBy?: { id?: string } }) =>
              m.scheduledBy?.id === report.rep.id
          )
        );
      })
      .finally(() => !cancelled && setLoadingDrill(false));
    return () => {
      cancelled = true;
    };
  }, [report]);

  return (
    <Dialog open={!!report} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            Daily report
            {report &&
              ` · ${report.reportDate.split("T")[0]}${isManager ? ` · ${report.rep.fullName}` : ""}`}
          </DialogTitle>
        </DialogHeader>
        {report && (
          <div className="space-y-4">
            {/* Counter grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <DetailCard label="Calls" value={report.callsCount} />
              <DetailCard label="Booked" value={report.meetingsBooked} />
              <DetailCard label="Held" value={report.meetingsHeld} />
              <DetailCard label="New leads" value={report.newLeads} />
            </div>

            {/* Notes — full text, not truncated */}
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                Notes
              </p>
              <div className="rounded-md border bg-muted/30 p-3 text-sm whitespace-pre-wrap min-h-[3rem]">
                {report.notes || (
                  <span className="text-muted-foreground italic">
                    No notes for this day.
                  </span>
                )}
              </div>
            </div>

            {/* Calls drill-down */}
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1.5">
                <Phone className="h-3 w-3" />
                Calls logged on this day
                {!loadingDrill && (
                  <span className="text-foreground font-medium">({calls.length})</span>
                )}
              </p>
              {loadingDrill ? (
                <p className="text-xs text-muted-foreground py-2">Loading…</p>
              ) : calls.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2 italic">
                  No calls logged for this rep on this day.
                </p>
              ) : (
                <div className="rounded-md border divide-y text-xs">
                  {calls.map((c) => (
                    <div key={c.id} className="px-3 py-2 flex items-start gap-2">
                      <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                        {new Date(c.callAt).toLocaleTimeString(undefined, {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">
                          {c.contactName ?? c.opportunity?.title ?? c.code}
                          <span className="ms-2 text-[10px] uppercase rounded bg-muted px-1 py-0.5">
                            {c.callType} · {c.outcome}
                          </span>
                        </p>
                        {c.notes && (
                          <p className="text-muted-foreground mt-0.5">{c.notes}</p>
                        )}
                        {c.opportunity && (
                          <p className="text-[10px] text-primary mt-0.5">
                            {c.opportunity.code} — {c.opportunity.title}
                          </p>
                        )}
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {c.durationMins}m
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Meetings drill-down */}
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1.5">
                <Calendar className="h-3 w-3" />
                Meetings on this day
                {!loadingDrill && (
                  <span className="text-foreground font-medium">({meetings.length})</span>
                )}
              </p>
              {loadingDrill ? (
                <p className="text-xs text-muted-foreground py-2">Loading…</p>
              ) : meetings.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2 italic">
                  No meetings scheduled by this rep on this day.
                </p>
              ) : (
                <div className="rounded-md border divide-y text-xs">
                  {meetings.map((m) => (
                    <div key={m.id} className="px-3 py-2 flex items-start gap-2">
                      <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                        {new Date(m.startAt).toLocaleTimeString(undefined, {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">
                          {m.contactName ?? m.customerNeed ?? m.code}
                          <span className="ms-2 text-[10px] uppercase rounded bg-muted px-1 py-0.5">
                            {m.status.replace("_", " ")}
                          </span>
                        </p>
                        {m.customerNeed && m.contactName && (
                          <p className="text-muted-foreground mt-0.5">
                            About: {m.customerNeed}
                          </p>
                        )}
                        {m.opportunity && (
                          <p className="text-[10px] text-primary mt-0.5">
                            {m.opportunity.code} — {m.opportunity.title}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DetailCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-muted/30 border p-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="text-xl font-bold ltr-nums">{value}</p>
    </div>
  );
}

function Total({
  label,
  value,
  icon: Icon,
  tile,
}: {
  label: string;
  value: number;
  icon: typeof Phone;
  tile: string;
}) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold text-foreground mt-1 ltr-nums">{value}</p>
        </div>
        <div className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${tile}`}>
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}
