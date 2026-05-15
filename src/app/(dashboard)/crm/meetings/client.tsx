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
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [pending, setPending] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [bookOpen, setBookOpen] = useState(false);
  const [me, setMe] = useState<{ crmRole?: string; crmProfileId?: string; isSuperAdmin?: boolean } | null>(null);

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
      <Tabs defaultValue={isApprover && pending.length > 0 ? "queue" : "calendar"} className="space-y-3">
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="calendar">Weekly calendar</TabsTrigger>
            <TabsTrigger value="list">List ({upcoming.length} upcoming)</TabsTrigger>
            {isApprover && (
              <TabsTrigger value="queue" className="relative">
                Approval queue
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
            Book meeting
          </Button>
        </div>

        <TabsContent value="calendar">
          <WeeklyCalendarClient />
        </TabsContent>

        <TabsContent value="list" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Upcoming ({upcoming.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <p className="text-sm text-muted-foreground text-center py-6">Loading...</p>
              ) : upcoming.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No upcoming meetings.</p>
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
                <CardTitle className="text-base text-muted-foreground">Past / done ({past.length})</CardTitle>
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
                  Pending approval ({pending.length})
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
  const [date, setDate] = useState<string>(() => new Date().toISOString().split("T")[0]);
  const [time, setTime] = useState<string>("10:00");
  const [duration, setDuration] = useState(30);
  const [meetingType, setMeetingType] = useState("DEMO");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactCompanyId, setContactCompanyId] = useState<string | null>(null);
  const [contactSearch, setContactSearch] = useState("");
  const [showContactPicker, setShowContactPicker] = useState(true);
  const [contactResults, setContactResults] = useState<Array<{
    id: string;
    fullName: string;
    phone: string | null;
    whatsapp: string | null;
    company: { id: string; nameEn: string; nameAr: string | null } | null;
  }>>([]);
  const [searchingContacts, setSearchingContacts] = useState(false);
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
      setContactName("");
      setContactPhone("");
      setContactCompanyId(null);
      setContactSearch("");
      setShowContactPicker(true);
      setContactResults([]);
      setNotes("");
    }
  }, [open]);

  // Debounced contact search — fires whenever the picker is visible and the
  // search box changes. Empty query still hits the endpoint to show recent
  // primary contacts so the picker isn't blank on open.
  useEffect(() => {
    if (!open || !showContactPicker) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setSearchingContacts(true);
      try {
        const r = await fetch(
          `/api/crm/contacts/search?q=${encodeURIComponent(contactSearch.trim())}`,
          { signal: ctrl.signal }
        );
        if (r.ok) {
          const d = await r.json();
          setContactResults(d.contacts ?? []);
        }
      } catch {
        /* aborted */
      } finally {
        setSearchingContacts(false);
      }
    }, 200);
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [contactSearch, open, showContactPicker]);

  function selectContact(c: {
    id: string;
    fullName: string;
    phone: string | null;
    whatsapp: string | null;
    company: { id: string; nameEn: string } | null;
  }) {
    setContactName(c.fullName);
    setContactPhone(c.phone ?? c.whatsapp ?? "");
    setContactCompanyId(c.company?.id ?? null);
    setShowContactPicker(false);
  }

  function clearContact() {
    setContactName("");
    setContactPhone("");
    setContactCompanyId(null);
    setShowContactPicker(true);
    setContactSearch("");
  }

  async function submit() {
    if (!contactName.trim()) {
      toast.error("Contact name is required");
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
          <DialogTitle>Book a technical meeting</DialogTitle>
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
              <Label>Time</Label>
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
            <Label>Contact</Label>
            {showContactPicker ? (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={contactSearch}
                    onChange={(e) => setContactSearch(e.target.value)}
                    placeholder="Search contacts by name, phone, or email…"
                    className="ps-9"
                    autoFocus
                  />
                </div>
                <div className="max-h-52 overflow-y-auto rounded-md border border-border divide-y">
                  {searchingContacts && (
                    <p className="p-3 text-xs text-muted-foreground">Searching…</p>
                  )}
                  {!searchingContacts && contactResults.length === 0 && (
                    <p className="p-3 text-xs text-muted-foreground">
                      No contacts found. Add the contact under{" "}
                      <a className="text-primary hover:underline" href="/crm/contacts/new" target="_blank" rel="noreferrer">
                        Contacts
                      </a>{" "}
                      first.
                    </p>
                  )}
                  {!searchingContacts &&
                    contactResults.map((c) => (
                      <button
                        type="button"
                        key={c.id}
                        onClick={() => selectContact(c)}
                        className="block w-full text-start px-3 py-2 hover:bg-accent transition-colors"
                      >
                        <span className="block text-sm font-medium truncate">{c.fullName}</span>
                        <span className="block text-xs text-muted-foreground">
                          {c.phone || c.whatsapp || "no phone"}
                          {c.company && <> · {c.company.nameEn}</>}
                        </span>
                      </button>
                    ))}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-accent/30 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{contactName}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {contactPhone || "no phone on file"}
                  </p>
                </div>
                <Button type="button" size="sm" variant="ghost" onClick={clearContact}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
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
