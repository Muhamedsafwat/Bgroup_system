"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, AlertTriangle, CheckCircle2, Clock, X, Search } from "lucide-react";
import { toast } from "sonner";
import { useLocale } from "@/lib/i18n";
import { WeeklyCalendarClient } from "./calendar/client";

type Meeting = {
  id: string;
  code: string;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  meetingType: string;
  status: string;
  contactName: string | null;
  contactPhone: string | null;
  customerNeed: string | null;
  notes: string | null;
  approvedById?: string | null;
  approvedAt?: string | null;
  deniedReason?: string | null;
  scheduledBy: { id: string; fullName: string };
  company: { id: string; nameEn: string } | null;
  opportunity: { id: string; code: string; title: string } | null;
};

const TYPES = ["DEMO", "OFFICE_VISIT", "FOLLOWUP", "PROPOSAL", "ONBOARDING"];
const DURATIONS = [30, 60, 90, 120];

/**
 * Tile-status colours follow the same yellow/green/red language as the
 * calendar grid so people can scan either view and mean the same thing.
 *   yellow → pending (assistant hasn't decided)
 *   green  → locked  (approved / confirmed / done)
 *   red    → blocked (denied)
 *   muted  → cancelled
 */
const STATUS_BADGE: Record<string, string> = {
  PENDING_APPROVAL: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  WAITING: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  APPROVED: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  CONFIRMED: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  DONE: "bg-emerald-600/20 text-emerald-700 dark:text-emerald-300",
  DENIED: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  CANCELLED: "bg-muted text-muted-foreground",
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function MeetingsClient() {
  const { locale } = useLocale();
  const isAr = locale === "ar";
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [pending, setPending] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [bookOpen, setBookOpen] = useState(false);
  const [me, setMe] = useState<{ crmRole?: string; crmProfileId?: string; isSuperAdmin?: boolean } | null>(null);
  // Controlled Tabs state. Starts at "calendar" — the safe default
  // for any role on a fresh load. The one-shot effect below flips it
  // to "queue" once we know the user is an approver with pending
  // items, without re-firing on every render.
  const [tab, setTab] = useState<string>("calendar");
  const [tabInitialized, setTabInitialized] = useState(false);

  // Role of the signed-in user — drives whether we render the Approval queue
  // tab and the per-row approve / deny buttons. Assistants + managers approve;
  // reps don't.
  const isApprover =
    me?.crmRole === "ASSISTANT" ||
    me?.crmRole === "MANAGER" ||
    me?.crmRole === "ADMIN" ||
    me?.crmRole === "ADMIN" ||
    !!me?.isSuperAdmin;

  async function refresh() {
    setLoading(true);
    try {
      // Pull session once so we know the role + can scope queries.
      const sessRes = await fetch("/api/auth/session");
      if (sessRes.ok) {
        const s = await sessRes.json();
        setMe({
          crmRole: s?.user?.crmRole,
          crmProfileId: s?.user?.crmProfileId,
          isSuperAdmin: !!s?.user?.hrRoles?.includes("super_admin"),
        });
      }
      // scope=all so every CRM member sees the org-wide list. This is the same
      // visibility the calendar grid uses; the list view and the calendar must
      // agree on what's booked.
      const res = await fetch("/api/crm/meetings?scope=all");
      if (res.ok) {
        const data = await res.json();
        setMeetings(data.meetings ?? []);
      }
      // The approval queue spans the WHOLE org, not just "mine" — assistants
      // approve everyone else's bookings. Only fetched when the caller has the
      // role to act on them.
      const queueRes = await fetch("/api/crm/meetings?scope=all&status=PENDING_APPROVAL");
      if (queueRes.ok) {
        const data = await queueRes.json();
        setPending(data.meetings ?? []);
      }
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh();
  }, []);

  // One-shot initial-tab pick. Runs only after `me` + `pending` are
  // populated, then never again — so user clicks are honoured without
  // being snapped back to "queue" on every refresh.
  useEffect(() => {
    if (tabInitialized) return;
    if (me === null) return; // still loading session
    if (isApprover && pending.length > 0) setTab("queue");
    setTabInitialized(true);
  }, [me, pending.length, isApprover, tabInitialized]);

  async function approveMeeting(id: string) {
    const res = await fetch(`/api/crm/meetings/${id}/approve`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? "Approval failed");
      return;
    }
    toast.success("Meeting approved — sales rep can confirm with the client");
    refresh();
  }

  async function denyMeeting(id: string) {
    const reason = window.prompt(
      "Reason for denial (sent to the sales rep so they can fix and re-submit):"
    );
    if (!reason || reason.trim().length < 3) return;
    const res = await fetch(`/api/crm/meetings/${id}/deny`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reason.trim() }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? "Denial failed");
      return;
    }
    toast.success("Meeting denied — rep notified");
    refresh();
  }

  async function patchStatus(id: string, status: string) {
    const res = await fetch(`/api/crm/meetings/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      toast.error("Failed to update");
      return;
    }
    toast.success(`Marked ${status.toLowerCase()}`);
    refresh();
  }

  async function remove(id: string) {
    if (!confirm("Delete this meeting?")) return;
    const res = await fetch(`/api/crm/meetings/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Delete failed");
      return;
    }
    toast.success("Deleted");
    refresh();
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const upcoming = meetings.filter((m) => new Date(m.startAt) >= today && m.status !== "CANCELLED");
  const past = meetings.filter((m) => new Date(m.startAt) < today || m.status === "DONE");

  return (
    <div className="space-y-4">
      {/* Controlled Tabs — `defaultValue` is uncontrolled and Base UI
          rightly complains when it changes after first mount. Our
          original defaultValue depended on async session + pending
          data that didn't exist on first render, so the prop flipped
          from "calendar" to "queue" as data loaded. Controlled value
          + a one-shot useEffect below sets the initial tab once data
          is ready. */}
      <Tabs value={tab} onValueChange={(v) => v && setTab(v)} className="space-y-3">
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="calendar">{isAr ? "تقويم أسبوعي" : "Weekly calendar"}</TabsTrigger>
            <TabsTrigger value="list">{isAr ? `قائمة (${upcoming.length} قادمة)` : `List (${upcoming.length} upcoming)`}</TabsTrigger>
            {isApprover && (
              <TabsTrigger value="queue" className="relative">
                {isAr ? "قائمة المراجعة" : "Approval queue"}
                {pending.length > 0 && (
                  <span className="ms-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 text-white text-[10px] font-semibold px-1">
                    {pending.length}
                  </span>
                )}
              </TabsTrigger>
            )}
          </TabsList>
          <Button size="sm" onClick={() => setBookOpen(true)}>
            <Plus className="h-4 w-4 me-1.5" />
            {isAr ? "حجز اجتماع" : "Book meeting"}
          </Button>
        </div>

        <TabsContent value="calendar">
          <WeeklyCalendarClient />
        </TabsContent>

        <TabsContent value="list" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{isAr ? `قادمة (${upcoming.length})` : `Upcoming (${upcoming.length})`}</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <p className="text-sm text-muted-foreground text-center py-6">{isAr ? "جاري التحميل..." : "Loading..."}</p>
              ) : upcoming.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">{isAr ? "لا توجد اجتماعات قادمة." : "No upcoming meetings."}</p>
              ) : (
                <ul className="divide-y">
                  {upcoming.map((m) => (
                    <MeetingRow
                      key={m.id}
                      meeting={m}
                      onStatus={(s) => patchStatus(m.id, s)}
                      onDelete={() => remove(m.id)}
                    />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {past.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base text-muted-foreground">{isAr ? `سابقة / مكتملة (${past.length})` : `Past / done (${past.length})`}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y opacity-70">
                  {past.slice(0, 20).map((m) => (
                    <MeetingRow
                      key={m.id}
                      meeting={m}
                      onStatus={(s) => patchStatus(m.id, s)}
                      onDelete={() => remove(m.id)}
                    />
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {isApprover && (
          <TabsContent value="queue" className="space-y-4">
            <Card className="border-amber-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="h-4 w-4 text-amber-600" />
                  {isAr ? "قيد الانتظار" : "Pending approval"} ({pending.length})
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  Meeting requests from sales reps. Check with the tech team, then
                  approve so the rep can confirm the date/time with the client — or
                  deny with a reason so they can fix it.
                </p>
              </CardHeader>
              <CardContent>
                {pending.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    Nothing waiting for you.
                  </p>
                ) : (
                  <ul className="divide-y">
                    {pending.map((m) => (
                      <MeetingRow
                        key={m.id}
                        meeting={m}
                        onStatus={(s) => patchStatus(m.id, s)}
                        onDelete={() => remove(m.id)}
                        onApprove={() => approveMeeting(m.id)}
                        onDeny={() => denyMeeting(m.id)}
                        showApprovalActions
                        isOwnBooking={m.scheduledBy.id === me?.crmProfileId}
                      />
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      <BookDialog open={bookOpen} onOpenChange={setBookOpen} onCreated={refresh} />
    </div>
  );
}

function MeetingRow({
  meeting,
  onStatus,
  onDelete,
  onApprove,
  onDeny,
  showApprovalActions,
  isOwnBooking,
}: {
  meeting: Meeting;
  onStatus: (status: string) => void;
  onDelete: () => void;
  onApprove?: () => void;
  onDeny?: () => void;
  /// Render Approve/Deny buttons (assistant queue mode) instead of the
  /// normal Confirm/Done buttons.
  showApprovalActions?: boolean;
  /// True when the signed-in user is the rep who scheduled this meeting —
  /// they aren't allowed to approve/deny their own request.
  isOwnBooking?: boolean;
}) {
  const isPending = meeting.status === "PENDING_APPROVAL" || meeting.status === "WAITING";
  return (
    <li className="py-3 flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          <span className="text-xs font-mono text-muted-foreground">{meeting.code}</span>
          <span className={`text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 ${STATUS_BADGE[meeting.status]}`}>
            {meeting.status.replace("_", " ")}
          </span>
          <span className="text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 bg-muted text-muted-foreground">
            {meeting.meetingType.replace("_", " ")}
          </span>
        </div>
        <p className="text-sm font-medium text-foreground truncate">
          {meeting.contactName ?? meeting.company?.nameEn ?? "—"}
          {meeting.customerNeed && (
            <span className="ms-2 text-xs text-muted-foreground">· {meeting.customerNeed}</span>
          )}
        </p>
        <p className="text-xs text-muted-foreground flex items-center gap-2">
          <Clock className="h-3 w-3" />
          {formatDateTime(meeting.startAt)} · {meeting.durationMinutes}m · {meeting.scheduledBy.fullName}
        </p>
        {meeting.deniedReason && meeting.status === "DENIED" && (
          <p className="text-xs text-rose-700 dark:text-rose-300 mt-1">
            Denied: {meeting.deniedReason}
          </p>
        )}
      </div>

      {/* Approval queue mode (assistant view) */}
      {showApprovalActions && isPending && (
        <div className="flex items-center gap-2 shrink-0">
          {isOwnBooking ? (
            <span className="text-xs text-muted-foreground italic">
              You booked this — needs another approver
            </span>
          ) : (
            <>
              <Button size="sm" variant="outline" className="text-rose-700" onClick={onDeny}>
                Deny
              </Button>
              <Button size="sm" onClick={onApprove}>
                <CheckCircle2 className="h-3.5 w-3.5 me-1" />
                Approve
              </Button>
            </>
          )}
        </div>
      )}

      {/* Standard list mode — once approved, the rep can Confirm with client */}
      {!showApprovalActions && meeting.status === "APPROVED" && (
        <Button size="sm" variant="outline" onClick={() => onStatus("CONFIRMED")}>
          Confirm with client
        </Button>
      )}
      {!showApprovalActions && meeting.status === "CONFIRMED" && (
        <Button size="sm" variant="outline" onClick={() => onStatus("DONE")}>
          Mark done
        </Button>
      )}
      {/* Legacy WAITING status — kept for old rows that pre-date the approval flow */}
      {!showApprovalActions && meeting.status === "WAITING" && (
        <Button size="sm" variant="outline" onClick={() => onStatus("CONFIRMED")}>
          Confirm
        </Button>
      )}
      {!showApprovalActions && (
        <Button size="sm" variant="ghost" onClick={onDelete} className="text-destructive">
          Delete
        </Button>
      )}
    </li>
  );
}

function BookDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const { locale } = useLocale();
  const isAr = locale === "ar";
  const [date, setDate] = useState<string>(() => new Date().toISOString().split("T")[0]);
  const [time, setTime] = useState<string>("10:00");
  const [duration, setDuration] = useState(30);
  const [meetingType, setMeetingType] = useState("DEMO");
  // Booking is now tied to one of the rep's OWN opportunities — the previous
  // contact picker meant reps could book a meeting against any directory
  // contact, which broke the "every meeting belongs to an opportunity"
  // assumption the post-meeting outcome flow relies on.
  const [opportunityId, setOpportunityId] = useState<string | null>(null);
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactCompanyId, setContactCompanyId] = useState<string | null>(null);
  const [oppSearch, setOppSearch] = useState("");
  const [showOppPicker, setShowOppPicker] = useState(true);
  const [oppResults, setOppResults] = useState<Array<{
    id: string;
    code: string;
    title: string;
    stage: string;
    customerCompanyName: string | null;
    customerContactName: string | null;
    customerContactPhone: string | null;
    company: { id: string; nameEn: string } | null;
  }>>([]);
  const [searchingOpps, setSearchingOpps] = useState(false);
  const [customerNeed, setCustomerNeed] = useState("");
  const [needs, setNeeds] = useState<Array<{ labelEn: string }>>([]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [conflictMsg, setConflictMsg] = useState<string | null>(null);

  // Pull the live customer-needs list when the dialog opens — admins manage
  // this set at /crm/admin/customer-needs, so the dropdown stays in sync.
  useEffect(() => {
    if (!open) return;
    fetch("/api/crm/customer-needs")
      .then((r) => (r.ok ? r.json() : { needs: [] }))
      .then((d) => {
        const list = d.needs ?? [];
        setNeeds(list);
        if (list.length > 0 && !customerNeed) setCustomerNeed(list[0].labelEn);
      })
      .catch(() => setNeeds([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open) {
      setConflictMsg(null);
      setOpportunityId(null);
      setContactName("");
      setContactPhone("");
      setContactCompanyId(null);
      setOppSearch("");
      setShowOppPicker(true);
      setOppResults([]);
      setNotes("");
    }
  }, [open]);

  // Debounced opportunity search — fires whenever the picker is visible and
  // the search box changes. Empty query still hits the endpoint to show the
  // rep's most recently updated open opps so the picker isn't blank on open.
  useEffect(() => {
    if (!open || !showOppPicker) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setSearchingOpps(true);
      try {
        const r = await fetch(
          `/api/crm/opportunities/mine?q=${encodeURIComponent(oppSearch.trim())}`,
          { signal: ctrl.signal }
        );
        if (r.ok) {
          const d = await r.json();
          setOppResults(d.opportunities ?? []);
        }
      } catch {
        /* aborted */
      } finally {
        setSearchingOpps(false);
      }
    }, 200);
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [oppSearch, open, showOppPicker]);

  function selectOpp(o: {
    id: string;
    code: string;
    title: string;
    customerCompanyName: string | null;
    customerContactName: string | null;
    customerContactPhone: string | null;
    company: { id: string; nameEn: string } | null;
  }) {
    setOpportunityId(o.id);
    // Use the contact captured on the opp itself; fall back to the opp title
    // so the meeting label is never empty (admin can still edit before save).
    setContactName(o.customerContactName?.trim() || o.title);
    setContactPhone(o.customerContactPhone?.trim() || "");
    setContactCompanyId(o.company?.id ?? null);
    setShowOppPicker(false);
  }

  function clearOpp() {
    setOpportunityId(null);
    setContactName("");
    setContactPhone("");
    setContactCompanyId(null);
    setShowOppPicker(true);
    setOppSearch("");
  }

  async function submit() {
    if (!opportunityId) {
      toast.error(isAr ? "اختر فرصة من قائمتك" : "Pick one of your opportunities");
      return;
    }
    if (!contactName.trim()) {
      toast.error(isAr ? "اسم جهة الاتصال مطلوب" : "Contact name is required");
      return;
    }
    setSaving(true);
    setConflictMsg(null);
    try {
      const startAt = new Date(`${date}T${time}:00`).toISOString();
      const res = await fetch("/api/crm/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startAt,
          durationMinutes: duration,
          meetingType,
          opportunityId,
          companyId: contactCompanyId,
          contactName: contactName.trim(),
          contactPhone: contactPhone.trim() || null,
          customerNeed,
          notes: notes.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setConflictMsg(data.error ?? "Time slot conflict");
        return;
      }
      if (!res.ok) {
        toast.error(data.error ?? "Booking failed");
        return;
      }
      toast.success("Meeting booked");
      onOpenChange(false);
      onCreated();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isAr ? "حجز اجتماع فني" : "Book a technical meeting"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {conflictMsg && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-rose-500/10 text-rose-700 dark:text-rose-300 text-xs">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{conflictMsg}</span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label>{isAr ? 'الوقت' : 'Time'}</Label>
              <Input type="time" step={1800} value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
            <div>
              <Label>Duration</Label>
              <Select value={String(duration)} onValueChange={(v) => setDuration(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DURATIONS.map((d) => (
                    <SelectItem key={d} value={String(d)}>{d} min</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Type</Label>
              <Select value={meetingType} onValueChange={(v) => setMeetingType(v ?? "DEMO")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t.replace("_", " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>{isAr ? "الفرصة" : "Opportunity"}</Label>
            {showOppPicker ? (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={oppSearch}
                    onChange={(e) => setOppSearch(e.target.value)}
                    placeholder={isAr ? "ابحث في فرصك بالاسم أو الكود أو الشركة…" : "Search your opportunities by name, code, or company…"}
                    className="ps-9"
                    autoFocus
                  />
                </div>
                <div className="max-h-52 overflow-y-auto rounded-md border border-border divide-y">
                  {searchingOpps && (
                    <p className="p-3 text-xs text-muted-foreground">{isAr ? "جاري البحث…" : "Searching…"}</p>
                  )}
                  {!searchingOpps && oppResults.length === 0 && (
                    <p className="p-3 text-xs text-muted-foreground">
                      {isAr ? (
                        <>لا توجد فرص مفتوحة. أنشئ فرصة من{" "}
                          <a className="text-primary hover:underline" href="/crm/opportunities/new" target="_blank" rel="noreferrer">الفرص</a>{" "}
                          أولًا.
                        </>
                      ) : (
                        <>No open opportunities found. Create one under{" "}
                          <a className="text-primary hover:underline" href="/crm/opportunities/new" target="_blank" rel="noreferrer">Opportunities</a>{" "}
                          first.
                        </>
                      )}
                    </p>
                  )}
                  {!searchingOpps &&
                    oppResults.map((o) => {
                      const companyLabel = o.customerCompanyName ?? o.company?.nameEn ?? null;
                      return (
                        <button
                          type="button"
                          key={o.id}
                          onClick={() => selectOpp(o)}
                          className="block w-full text-start px-3 py-2 hover:bg-accent transition-colors"
                        >
                          <span className="block text-sm font-medium truncate">
                            {o.title}
                            <span className="text-muted-foreground font-normal ms-2 text-[10px] font-mono">{o.code}</span>
                          </span>
                          <span className="block text-xs text-muted-foreground truncate">
                            {companyLabel ?? (isAr ? "بدون شركة" : "no company")}
                            {o.customerContactName && <> · {o.customerContactName}</>}
                          </span>
                        </button>
                      );
                    })}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-accent/30 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{contactName}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {contactPhone || (isAr ? "لا يوجد رقم مسجل" : "no phone on file")}
                  </p>
                </div>
                <Button type="button" size="sm" variant="ghost" onClick={clearOpp}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>

          {/* Contact name/phone — auto-filled from the chosen opportunity but
              the rep can override before booking (e.g. the contact captured
              on the opp is stale or a different person is attending). */}
          {!showOppPicker && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{isAr ? "اسم جهة الاتصال" : "Contact name"}</Label>
                <Input
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder={isAr ? "اسم من سيحضر الاجتماع" : "Who's attending"}
                />
              </div>
              <div>
                <Label>{isAr ? "هاتف جهة الاتصال" : "Contact phone"}</Label>
                <Input
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder={isAr ? "اختياري" : "optional"}
                />
              </div>
            </div>
          )}
          <div>
            <Label>Customer need</Label>
            <Select value={customerNeed || undefined} onValueChange={(v) => setCustomerNeed(v ?? "")}>
              <SelectTrigger>
                <SelectValue placeholder={needs.length === 0 ? "Loading..." : "Pick a need"}>
                  {customerNeed || (needs.length === 0 ? "Loading..." : "Pick a need")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {needs.map((n) => (
                  <SelectItem key={n.labelEn} value={n.labelEn}>{n.labelEn}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            <CheckCircle2 className="h-4 w-4 me-1.5" />
            {saving ? "Booking..." : "Book"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
