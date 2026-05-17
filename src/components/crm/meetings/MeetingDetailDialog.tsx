"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Calendar,
  Phone,
  User,
  Briefcase,
  ExternalLink,
  Loader2,
  Link as LinkIcon,
  CheckCircle2,
  FileText,
  Activity,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

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
  scheduledBy: { id: string; fullName: string };
  approvedBy: { id: string; fullName: string } | null;
  opportunity: { id: string; code: string; title: string; stage: string } | null;
  company: { id: string; nameEn: string } | null;
};

type Note = {
  id: string;
  content: string;
  createdAt: string;
  author: { id: string; fullName: string };
};

type ActivityEntry = {
  id: string;
  action: string;
  metadata: unknown;
  createdAt: string;
  actor: { id: string; fullName: string };
};

const STATUS_BADGE: Record<string, string> = {
  PENDING_APPROVAL: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  WAITING: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  APPROVED: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  CONFIRMED: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  DONE: "bg-emerald-600/20 text-emerald-700 dark:text-emerald-300",
  DENIED: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  CANCELLED: "bg-muted text-muted-foreground",
};

/**
 * Calendar-card → detail dialog. Opens when the user clicks a meeting block
 * on the weekly calendar. Pulls the meeting + the linked opportunity's last
 * 5 notes + 5 activity entries in a single request so the user gets the full
 * "last update" view inline.
 *
 * The assistant's post-meeting flow lives in the form at the bottom:
 *   1. Optional meeting link (Zoom/Meet/Teams) saved on the meeting itself
 *   2. Optional attendees list
 *   3. Free-text outcome note — automatically duplicated to the linked
 *      opportunity as a CrmNote + activity log entry so the closer and
 *      sales manager see it in the opportunity timeline
 *   4. "Mark done" button — flips status to DONE
 *
 * Pre-meeting (status APPROVED / CONFIRMED), this dialog is read-only
 * except for the form; managers can still edit time/contact via the
 * regular Meetings page.
 */
export function MeetingDetailDialog({
  meetingId,
  open,
  onOpenChange,
  onChanged,
}: {
  meetingId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [recentNotes, setRecentNotes] = useState<Note[]>([]);
  const [recentActivity, setRecentActivity] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const [meetingLink, setMeetingLink] = useState("");
  const [attendees, setAttendees] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !meetingId) {
      setMeeting(null);
      setRecentNotes([]);
      setRecentActivity([]);
      setMeetingLink("");
      setAttendees("");
      setNote("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/crm/meetings/${meetingId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.meeting) return;
        setMeeting(data.meeting);
        setRecentNotes(data.recentNotes ?? []);
        setRecentActivity(data.recentActivity ?? []);
        // Pre-fill meetingLink from the existing notes if present
        const existingNotes: string = data.meeting.notes ?? "";
        const linkMatch = existingNotes.match(/Meeting link:\s*(\S+)/);
        if (linkMatch) setMeetingLink(linkMatch[1]);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, meetingId]);

  async function markDone() {
    if (!meeting) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/crm/meetings/${meeting.id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          note: note.trim() || undefined,
          meetingLink: meetingLink.trim() || undefined,
          attendees: attendees.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't save outcome");
        return;
      }
      toast.success("Meeting marked done — note added to the opportunity");
      onOpenChange(false);
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  const start = meeting ? new Date(meeting.startAt) : null;
  const end = meeting ? new Date(meeting.endAt) : null;
  const canComplete =
    !!meeting &&
    (meeting.status === "APPROVED" ||
      meeting.status === "CONFIRMED" ||
      meeting.status === "DONE");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Calendar className="h-4 w-4 text-muted-foreground" />
            )}
            {meeting ? `Meeting · ${meeting.code}` : "Meeting"}
          </DialogTitle>
        </DialogHeader>

        {loading && !meeting && (
          <div className="py-8 flex items-center justify-center text-muted-foreground">
            <Loader2 className="h-4 w-4 me-2 animate-spin" />
            Loading meeting…
          </div>
        )}

        {meeting && (
          <div className="space-y-4">
            {/* Header — status + time + linked opp */}
            <div className="rounded-md border bg-muted/30 p-3 space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "text-[10px] uppercase rounded px-1.5 py-0.5 font-medium",
                      STATUS_BADGE[meeting.status] ?? "bg-muted"
                    )}
                  >
                    {meeting.status.replace("_", " ")}
                  </span>
                  <Badge variant="outline" className="text-[10px]">
                    {meeting.meetingType}
                  </Badge>
                </div>
                <span className="text-xs text-muted-foreground">
                  {start &&
                    `${start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · ${start.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} – ${end?.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`}
                </span>
              </div>
              {meeting.opportunity && (
                <Link
                  href={`/crm/opportunities/${meeting.opportunity.id}`}
                  className="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                >
                  <Briefcase className="h-3.5 w-3.5" />
                  {meeting.opportunity.code} · {meeting.opportunity.title}
                  <ExternalLink className="h-3 w-3 opacity-70" />
                </Link>
              )}
              {meeting.contactName && (
                <p className="text-sm flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5 text-muted-foreground" />
                  {meeting.contactName}
                  {meeting.contactPhone && (
                    <a
                      href={`tel:${meeting.contactPhone}`}
                      className="text-primary hover:underline flex items-center gap-1"
                    >
                      <Phone className="h-3 w-3 ms-1" />
                      {meeting.contactPhone}
                    </a>
                  )}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Scheduled by <span className="text-foreground font-medium">{meeting.scheduledBy.fullName}</span>
                {meeting.approvedBy &&
                  ` · approved by ${meeting.approvedBy.fullName}`}
              </p>
              {meeting.customerNeed && (
                <p className="text-xs">
                  <span className="text-muted-foreground">About:</span>{" "}
                  <span className="font-medium">{meeting.customerNeed}</span>
                </p>
              )}
              {meeting.notes && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                    Meeting notes
                  </summary>
                  <pre className="whitespace-pre-wrap mt-1 text-foreground font-sans">
                    {meeting.notes}
                  </pre>
                </details>
              )}
            </div>

            {/* Last update — most recent note + activity on the linked opp */}
            {meeting.opportunity && (recentNotes.length > 0 || recentActivity.length > 0) && (
              <div className="rounded-md border p-3 space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <FileText className="h-3 w-3" />
                  Last updates on this opportunity
                </p>
                {recentNotes.slice(0, 3).map((n) => (
                  <div key={n.id} className="text-sm space-y-0.5">
                    <p className="whitespace-pre-wrap">{n.content}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {n.author.fullName} · {new Date(n.createdAt).toLocaleString()}
                    </p>
                  </div>
                ))}
                {recentActivity.slice(0, 3).map((a) => (
                  <div key={a.id} className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Activity className="h-3 w-3" />
                    <span>
                      <span className="font-medium text-foreground">{a.actor.fullName}</span>{" "}
                      {a.action.replace(/_/g, " ")} ·{" "}
                      {new Date(a.createdAt).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Post-meeting form — only enabled when the meeting is past
                approval (APPROVED / CONFIRMED / DONE). Adding more notes to
                an already-DONE meeting is allowed: assistants often add a
                second note after a follow-up call from the rep. */}
            <div className="rounded-md border bg-primary/5 border-primary/20 p-3 space-y-3">
              <p className="text-xs font-semibold text-primary uppercase tracking-wide flex items-center gap-1.5">
                <CheckCircle2 className="h-3 w-3" />
                {meeting.status === "DONE" ? "Add another outcome note" : "Complete the meeting"}
              </p>

              <div className="space-y-1.5">
                <Label className="text-xs flex items-center gap-1.5">
                  <LinkIcon className="h-3 w-3" />
                  Meeting link
                </Label>
                <Input
                  value={meetingLink}
                  onChange={(e) => setMeetingLink(e.target.value)}
                  placeholder="https://meet.google.com/abc-defg-hij"
                  className="h-8 text-xs"
                  disabled={!canComplete}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Attendees</Label>
                <Input
                  value={attendees}
                  onChange={(e) => setAttendees(e.target.value)}
                  placeholder="Rep, customer name, tech lead, etc."
                  className="h-8 text-xs"
                  disabled={!canComplete}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Outcome / last update</Label>
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="What did the customer say? Next step? Risks? — this text becomes a note on the opportunity so the closer and sales manager see it in the opp timeline."
                  rows={4}
                  className="text-xs"
                  disabled={!canComplete}
                />
              </div>

              {!canComplete && (
                <p className="text-xs text-muted-foreground italic">
                  Meeting must be approved before you can record the outcome.
                  Approve it from the meetings page first.
                </p>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Close
          </Button>
          {meeting && canComplete && (
            <Button onClick={markDone} disabled={saving}>
              {saving ? "Saving…" : meeting.status === "DONE" ? "Add note" : "Mark done"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
