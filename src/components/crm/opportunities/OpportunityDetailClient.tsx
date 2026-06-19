"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/i18n";
import { OpportunityComments } from "./OpportunityComments";
import { TaskList } from "@/components/tasks/TaskList";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StageBadge } from "@/components/crm/shared/StageBadge";
import { PriorityBadge } from "@/components/crm/shared/PriorityBadge";
import { EntityBadge } from "@/components/crm/shared/EntityBadge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CurrencyDisplay } from "@/components/crm/shared/CurrencyDisplay";
import { DateDisplay } from "@/components/crm/shared/DateDisplay";
import { StageProgressBar } from "./StageProgressBar";
import { StageChangeModal } from "./StageChangeModal";
import { addNote } from "@/app/(dashboard)/crm/opportunities/actions";
import { toast } from "sonner";
import {
  ArrowLeft,
  Phone,
  Mail,
  ExternalLink,
  MessageCircle,
  Calendar,
  User,
  FileText,
  Edit,
  Upload,
  Workflow,
  Loader2,
  Pencil,
  Trash2,
} from "lucide-react";
import type { Locale } from "@/lib/i18n";

type WorkflowSummary = {
  id: string;
  name: string;
  description: string | null;
  module: string;
  kind: string;
};

type Attachment = {
  id: string;
  filename: string;
  url: string;
  sizeBytes: number;
  mimeType: string;
  kind: string;
  uploadedById: string;
  createdAt: string;
};

export function OpportunityDetailClient({
  opportunity: opp,
  locale,
  canStartWorkflow = false,
  workflows = [],
  currentUserId = "",
}: {
  opportunity: Record<string, unknown>;
  locale: Locale;
  canStartWorkflow?: boolean;
  workflows?: WorkflowSummary[];
  /// CrmProfile id (or auth user id) of the viewer — used to gate the
  /// uploader-only document delete control.
  currentUserId?: string;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const [stageModalOpen, setStageModalOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  // user-feature 2026-06-18: inline call logging — the standalone Calls
  // page was removed; reps now log a call right on the opportunity as a
  // freeform note + an outcome. It lands in the unified Activity feed.
  const [callNotes, setCallNotes] = useState("");
  const [callOutcome, setCallOutcome] = useState("");
  const [loggingCall, setLoggingCall] = useState(false);

  // Real attachments (CrmAttachment rows) — fetched on mount, refreshed after
  // an upload. Note: opp.proposalUrl / opp.contractUrl are legacy single-URL
  // fields kept for backwards compatibility, but the attachments table is
  // the new home for documents uploaded against the opportunity.
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);

  // Workflow trigger dialog state — only the sales manager (or CEO) sees
  // this UI; the API enforces the same role.
  const [workflowDialogOpen, setWorkflowDialogOpen] = useState(false);
  const [workflowChoice, setWorkflowChoice] = useState("");
  const [workflowComment, setWorkflowComment] = useState("");
  const [triggeringWorkflow, setTriggeringWorkflow] = useState(false);

  const refreshAttachments = useCallback(async () => {
    const res = await fetch(`/api/crm/opportunities/${opp.id}/attachments`);
    if (res.ok) {
      const data = await res.json();
      setAttachments(data.attachments ?? []);
    }
  }, [opp.id]);
  useEffect(() => {
    refreshAttachments();
  }, [refreshAttachments]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      toast.error("File exceeds 25 MB cap");
      return;
    }
    setUploading(true);
    try {
      const contentBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const r = reader.result as string;
          resolve(r.includes(",") ? r.split(",", 2)[1] : r);
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const res = await fetch(`/api/crm/opportunities/${opp.id}/attachments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          contentBase64,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Upload failed");
        return;
      }
      toast.success(`Attached ${file.name}`);
      await refreshAttachments();
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteAttachment(attachmentId: string) {
    // user-feature 2026-06-19: uploader-only delete. The button is only
    // shown on the viewer's own uploads, and the API re-checks server-side.
    const res = await fetch(
      `/api/crm/opportunities/${opp.id}/attachments?attachmentId=${attachmentId}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast.error(d.error ?? (locale === "ar" ? "تعذّر حذف المستند" : "Couldn't delete document"));
      return;
    }
    toast.success(locale === "ar" ? "تم حذف المستند" : "Document deleted");
    await refreshAttachments();
  }

  async function handleTriggerWorkflow() {
    if (!workflowChoice) return;
    setTriggeringWorkflow(true);
    try {
      const res = await fetch(`/api/crm/opportunities/${opp.id}/trigger-workflow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflowId: workflowChoice,
          comment: workflowComment.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Workflow trigger failed");
        return;
      }
      const data = await res.json();
      toast.success(
        `Workflow started — ${data.cascaded?.notes ?? 0} notes & ${data.cascaded?.attachments ?? 0} files carried over`
      );
      setWorkflowDialogOpen(false);
      setWorkflowChoice("");
      setWorkflowComment("");
      router.refresh();
    } finally {
      setTriggeringWorkflow(false);
    }
  }

  const entity = opp.entity as { code: string; nameEn: string; nameAr: string; color: string };
  // The customer-company on an opportunity is now stored as free text on
  // the row itself; the legacy `company` FK is nullable and only populated
  // for admin-curated rows or cold-lead-converted opps. Always prefer the
  // free-text name and fall back to the linked record so legacy opps still
  // render without a guard at every call site below.
  const linkedCompany = opp.company as { nameEn: string; nameAr: string | null; phone: string | null } | null;
  const company = {
    nameEn:
      (opp.customerCompanyName as string | null | undefined) ??
      linkedCompany?.nameEn ??
      "—",
    nameAr: linkedCompany?.nameAr ?? null,
    phone: linkedCompany?.phone ?? null,
  };
  const owner = opp.owner as { fullName: string; fullNameAr: string | null };
  const contact = opp.primaryContact as { fullName: string; phone: string | null; email: string | null; whatsapp: string | null } | null;
  // Prefer the linked CrmContact when set (admin-curated path). Otherwise
  // surface the free-text contact-person fields the rep typed into the
  // opportunity form so the detail page never looks empty just because no
  // formal contact record exists.
  const inlineContact =
    !contact &&
    (opp.customerContactName || opp.customerContactPhone || opp.customerContactEmail)
      ? {
          fullName: (opp.customerContactName as string | null) ?? "—",
          phone: (opp.customerContactPhone as string | null) ?? null,
          email: (opp.customerContactEmail as string | null) ?? null,
          whatsapp: null,
        }
      : null;
  const displayContact = contact ?? inlineContact;
  const stageChanges = (opp.stageChanges || []) as Array<{ id: string; fromStage: string | null; toStage: string; changedAt: string; durationDays: number | null }>;
  const activityLogs = (opp.activityLogs || []) as Array<{ id: string; action: string; metadata: Record<string, unknown> | null; createdAt: string; actor: { fullName: string } }>;
  const calls = (opp.calls || []) as Array<{ id: string; code: string; callType: string; outcome: string; callAt: string; notes: string | null; caller: { fullName: string } }>;
  const notes = (opp.notes || []) as Array<{ id: string; content: string; createdAt: string; author: { fullName: string } }>;

  async function handleAddNote() {
    if (!noteText.trim()) return;
    setAddingNote(true);
    try {
      await addNote(opp.id as string, noteText);
      setNoteText("");
      toast.success(locale === "ar" ? "تم إضافة الملاحظة" : "Note added");
      router.refresh();
    } catch {
      toast.error("Failed to add note");
    }
    setAddingNote(false);
  }

  async function handleLogCall() {
    if (!callOutcome) {
      toast.error(locale === "ar" ? "اختر نتيجة المكالمة" : "Pick a call outcome");
      return;
    }
    setLoggingCall(true);
    try {
      const res = await fetch("/api/crm/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opportunityId: opp.id,
          // callType isn't surfaced in this lightweight logger — the rep
          // just types what happened + picks an outcome. Default to a
          // neutral follow-up type so the row is valid.
          callType: "FOLLOW_UP",
          outcome: callOutcome,
          notes: callNotes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error ?? "Failed to log call");
        return;
      }
      toast.success(locale === "ar" ? "تم تسجيل المكالمة" : "Call logged");
      setCallNotes("");
      setCallOutcome("");
      router.refresh();
    } finally {
      setLoggingCall(false);
    }
  }

  // user-feature 2026-06-19: clickable stage progress bar. Stages that
  // need extra fields on entry (WON → deposit, LOST → loss reason,
  // PROPOSAL_SENT → proposal URL) open the full stage-change modal so
  // those requirements are gathered; every other move is applied
  // directly via the same endpoint the kanban drag-drop uses.
  const STAGES_NEEDING_MODAL = new Set(["WON", "LOST", "PROPOSAL_SENT"]);
  async function handleStageClick(toStage: string) {
    if (toStage === opp.stage) return;
    if (STAGES_NEEDING_MODAL.has(toStage)) {
      setStageModalOpen(true);
      return;
    }
    try {
      const res = await fetch(`/api/crm/opportunities/${opp.id}/stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toStage }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error ?? (locale === "ar" ? "تعذّر تغيير المرحلة" : "Couldn't change stage"));
        return;
      }
      toast.success(locale === "ar" ? "تم تغيير المرحلة" : "Stage changed");
      router.refresh();
    } catch {
      toast.error(locale === "ar" ? "تعذّر تغيير المرحلة" : "Couldn't change stage");
    }
  }

  // user-feature 2026-06-19: ONE unified History — stage transitions,
  // activity-log events, and logged calls in a single chronological feed.
  //
  // De-duplication: a stage change writes BOTH a CrmStageHistory row AND a
  // CrmActivityLog "stage_changed" row, so the old layout listed every
  // transition twice (the standalone "Stage History" card + the activity
  // feed). We now render the richer CrmStageHistory rows (they carry the
  // days-in-stage duration) as "stage" items and DROP the redundant
  // "stage_changed" activity rows. The separate Stage History card is gone.
  type FeedItem =
    | { kind: "activity"; id: string; at: string; actor: string; action: string; metadata: Record<string, unknown> | null }
    | { kind: "call"; id: string; at: string; actor: string; callType: string; outcome: string; notes: string | null }
    | { kind: "stage"; id: string; at: string; fromStage: string | null; toStage: string; durationDays: number | null };
  const feed: FeedItem[] = [
    ...stageChanges.map((sc) => ({
      kind: "stage" as const,
      id: sc.id,
      at: sc.changedAt,
      fromStage: sc.fromStage,
      toStage: sc.toStage,
      durationDays: sc.durationDays,
    })),
    ...activityLogs
      // De-dup against other sections so nothing is shown twice:
      //  • "stage_changed" → the richer stage items above already cover it.
      //  • "note_added"    → the Notes card already lists every note.
      .filter((l) => l.action !== "stage_changed" && l.action !== "note_added")
      .map((l) => ({
        kind: "activity" as const,
        id: l.id,
        at: l.createdAt,
        actor: l.actor.fullName,
        action: l.action,
        metadata: l.metadata,
      })),
    ...calls.map((c) => ({
      kind: "call" as const,
      id: c.id,
      at: c.callAt,
      actor: c.caller.fullName,
      callType: c.callType,
      outcome: c.outcome,
      notes: c.notes,
    })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => router.back()}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h1 className="text-2xl font-bold">
              {(opp.title as string) || company.nameEn}
            </h1>
            <EntityBadge code={entity.code} color={entity.color} />
          </div>
          <div className="flex items-center gap-3 text-sm text-muted-foreground ps-12 flex-wrap">
            <span className="ltr-nums">{opp.code as string}</span>
            {/* Company name as a subtitle only when set (legacy / curated). */}
            {company.nameEn !== "—" && <span>· {company.nameEn}</span>}
            <PriorityBadge priority={opp.priority as import("@/types").CrmPriority} />
            <span>{t.dealTypes[opp.dealType as keyof typeof t.dealTypes]}</span>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link href={`/crm/opportunities/${opp.id}/edit`}>
            <Button variant="outline">
              <Edit className="h-4 w-4 me-2" />
              {t.common.edit}
            </Button>
          </Link>
          <Button onClick={() => setStageModalOpen(true)}>
            {t.forms.selectStage}
          </Button>
          {/* Start-workflow is a sales-manager-only action — it kicks off
              the team workflow once the opp is ready for delivery. Notes +
              attachments from the opp are carried over to the first task. */}
          {canStartWorkflow && (
            <Button
              variant="default"
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={() => setWorkflowDialogOpen(true)}
              disabled={workflows.length === 0}
              title={
                workflows.length === 0
                  ? "No active workflows configured"
                  : "Start a workflow for the team"
              }
            >
              <Workflow className="h-4 w-4 me-2" />
              Start workflow
            </Button>
          )}
        </div>
      </div>

      {/* Stage Progress — clickable: tap a stage to move the opp there
          (user-feature 2026-06-19). */}
      <StageProgressBar currentStage={opp.stage as string} onStageClick={handleStageClick} />

      {/* user-feature 2026-06-19: the WHOLE opportunity lives on ONE page
          now — no tabs. Everything stacks top-to-bottom so the deal can be
          read at a glance: summary, intro background, description, notes +
          tasks, activity & discussion (with call logging), documents, and
          stage history. The redundant KPI cards from the screenshot were
          removed — estimated/weighted value + close date moved into the
          Deal info card, and the stage is the clickable bar above. */}
      <div className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            {/* Contact Info — inline-editable. Click the pencil to switch
                to edit mode; the three customer-contact fields on the opp
                are PATCHed via /api/crm/opportunities/[id]/contact and the
                page refreshes so changes appear immediately. */}
            <ContactCard
              oppId={opp.id as string}
              initialName={(opp.customerContactName as string | null) ?? displayContact?.fullName ?? ""}
              initialPhone={(opp.customerContactPhone as string | null) ?? displayContact?.phone ?? ""}
              initialEmail={(opp.customerContactEmail as string | null) ?? displayContact?.email ?? ""}
              displayContact={displayContact}
              contactsLabel={t.nav.contacts}
              router={router}
            />

            {/* Deal Info */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t.nav.opportunities}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {/* user-feature 2026-06-19: value + close date moved here
                    from the removed KPI cards. */}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t.forms.estimatedValue}</span>
                  <span className="font-semibold">
                    <CurrencyDisplay
                      amount={Number(opp.estimatedValue)}
                      currency={opp.currency as import("@/types").CrmCurrency}
                      egpAmount={Number(opp.estimatedValueEGP)}
                    />
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t.kpis.weighted}</span>
                  <span className="ltr-nums">
                    <CurrencyDisplay amount={Number(opp.weightedValueEGP)} currency="EGP" />
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t.forms.expectedCloseDate}</span>
                  <span>
                    {opp.expectedCloseDate ? (
                      <DateDisplay date={opp.expectedCloseDate as string} />
                    ) : "-"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t.forms.owner}</span>
                  <span>{locale === "ar" ? owner.fullNameAr || owner.fullName : owner.fullName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t.forms.leadSource}</span>
                  <span>{opp.leadSource ? String(opp.leadSource) : "-"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t.forms.nextAction}</span>
                  <span>
                    {opp.nextAction
                      ? String(t.nextActions[opp.nextAction as keyof typeof t.nextActions] || opp.nextAction)
                      : "-"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t.forms.nextActionDate}</span>
                  <span>
                    {opp.nextActionDate ? (
                      <DateDisplay date={opp.nextActionDate as string} />
                    ) : "-"}
                  </span>
                </div>
                {Boolean(opp.proposalUrl) && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t.forms.proposalUrl}</span>
                    <a href={opp.proposalUrl as string} target="_blank" rel="noopener noreferrer" className="text-primary flex items-center gap-1">
                      <ExternalLink className="h-3 w-3" />
                      {locale === "ar" ? "عرض" : "View"}
                    </a>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* user-feature 2026-06-18: introduction background / referral
              chain. Read-only here — edited via the Edit button (the
              opportunity form), per the user's "edit using the edit button
              inside the opportunity" request. Only shown when present. */}
          {Boolean(opp.introBackground) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  {locale === "ar" ? "خلفية التعريف / من حوّلني لمن" : "Introduction background"}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{opp.introBackground as string}</p>
              </CardContent>
            </Card>
          )}

          {/* Description */}
          {Boolean(opp.description) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t.common.description}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{opp.description as string}</p>
              </CardContent>
            </Card>
          )}

          {/* user-feature 2026-06-18: Notes + Tasks moved to the front
              page, side by side and center stage — the rep wanted these
              prominent, not buried in their own tabs. */}
          <div className="grid lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  {t.tabs.notes}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Textarea
                  placeholder={locale === "ar" ? "أضف ملاحظة..." : "Add a note..."}
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  rows={3}
                />
                <Button
                  onClick={handleAddNote}
                  disabled={addingNote || !noteText.trim()}
                  size="sm"
                >
                  {addingNote ? t.common.loading : t.common.save}
                </Button>
                <div className="space-y-3 pt-1">
                  {notes.map((note) => (
                    <div key={note.id} className="border-t pt-3 first:border-0 first:pt-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-sm">{note.author.fullName}</span>
                        <DateDisplay date={note.createdAt} showTime className="text-xs text-muted-foreground" />
                      </div>
                      <p className="text-sm whitespace-pre-wrap">{note.content}</p>
                    </div>
                  ))}
                  {notes.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      {locale === "ar" ? "لا توجد ملاحظات بعد." : "No notes yet."}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">{locale === "ar" ? "المهام" : "Tasks"}</CardTitle>
              </CardHeader>
              <CardContent>
                <TaskList
                  entityType="CRM_OPPORTUNITY"
                  entityId={opp.id as string}
                  showBuckets={false}
                  createDefaults={{
                    entityType: "CRM_OPPORTUNITY",
                    entityId: opp.id as string,
                    module: "crm",
                  }}
                />
              </CardContent>
            </Card>
          </div>

          {/* Activity & discussion — log a call (freeform + outcome), the
              discussion thread, and a unified chronological history of
              activity events + logged calls. All inline on the one page. */}
          {/* Log a call — freeform note + outcome. Lands in the feed below. */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Phone className="h-4 w-4 text-muted-foreground" />
                {locale === "ar" ? "تسجيل مكالمة" : "Log a call"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                placeholder={
                  locale === "ar"
                    ? "ماذا حدث في المكالمة؟ مثال: اتصلت به، طلب معاودة الاتصال الأسبوع القادم…"
                    : "What happened on the call? e.g. Called him — asked to call back next week…"
                }
                value={callNotes}
                onChange={(e) => setCallNotes(e.target.value)}
                rows={2}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Select value={callOutcome || undefined} onValueChange={(v) => setCallOutcome(v ?? "")}>
                  <SelectTrigger className="w-56">
                    <SelectValue
                      placeholder={locale === "ar" ? "نتيجة المكالمة" : "Call outcome"}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(t.callOutcomes).map(([code, label]) => (
                      <SelectItem key={code} value={code}>
                        {label as string}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button onClick={handleLogCall} disabled={loggingCall || !callOutcome} size="sm">
                  {loggingCall ? (
                    <Loader2 className="h-4 w-4 me-1.5 animate-spin" />
                  ) : (
                    <Phone className="h-4 w-4 me-1.5" />
                  )}
                  {locale === "ar" ? "تسجيل" : "Log call"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Discussion thread with @-mention notifications. */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-muted-foreground" />
                {locale === "ar" ? "النقاش" : "Discussion"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <OpportunityComments oppId={opp.id as string} />
            </CardContent>
          </Card>

          {/* Unified history — activity log + logged calls, newest first. */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                {locale === "ar" ? "السجل" : "History"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* user-feature 2026-06-19: cap the History to ~2 rows then
                  scroll so a long deal timeline doesn't stretch the page. */}
              <div className="space-y-4 max-h-44 overflow-y-auto pe-1">
                {feed.map((item) =>
                  item.kind === "stage" ? (
                    <div key={`stage-${item.id}`} className="flex items-center gap-3 text-sm border-b pb-3 last:border-0">
                      <DateDisplay date={item.at} showTime className="text-muted-foreground w-36 shrink-0" />
                      <div className="flex items-center gap-2 flex-wrap">
                        {item.fromStage && (
                          <>
                            <StageBadge stage={item.fromStage as import("@/types").CrmOpportunityStage} />
                            <span className="text-muted-foreground">&rarr;</span>
                          </>
                        )}
                        <StageBadge stage={item.toStage as import("@/types").CrmOpportunityStage} />
                        {item.durationDays !== null && item.durationDays > 0 && (
                          <span className="text-xs text-muted-foreground ltr-nums">
                            ({item.durationDays}d)
                          </span>
                        )}
                      </div>
                    </div>
                  ) : item.kind === "call" ? (
                    <div key={`call-${item.id}`} className="border-b pb-3 last:border-0 text-sm space-y-1">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="font-medium">{item.actor}</span>
                          <Badge variant="outline">
                            {t.callOutcomes[item.outcome as keyof typeof t.callOutcomes] ?? item.outcome}
                          </Badge>
                        </div>
                        <DateDisplay date={item.at} showTime className="text-muted-foreground" />
                      </div>
                      {item.notes && <p className="text-muted-foreground ps-6 whitespace-pre-wrap">{item.notes}</p>}
                    </div>
                  ) : (
                    <div key={`act-${item.id}`} className="flex gap-3 text-sm border-b pb-3 last:border-0">
                      <DateDisplay date={item.at} showTime className="text-muted-foreground w-36 shrink-0" />
                      <div>
                        <span className="font-medium">{item.actor}</span>
                        <span className="text-muted-foreground mx-1">—</span>
                        <span>{t.activityLog[item.action as keyof typeof t.activityLog] || item.action}</span>
                        {Boolean(item.metadata && (item.metadata as Record<string, unknown>).from) && (
                          <span className="ms-1">
                            {t.activityLog.from} {t.stages[(item.metadata as Record<string, string>).from as keyof typeof t.stages]} {t.activityLog.to} {t.stages[(item.metadata as Record<string, string>).to as keyof typeof t.stages]}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                )}
                {feed.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-8">{t.common.noResults}</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Documents — real CrmAttachment list + uploader. Legacy
              proposalUrl / contractUrl single-link fields show below if set. */}
          <Card>
            <CardContent className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-foreground">
                  {locale === "ar" ? "المستندات" : "Documents"}
                  <span className="text-xs text-muted-foreground ms-2">
                    ({attachments.length})
                  </span>
                </p>
                <label className="cursor-pointer">
                  <input
                    type="file"
                    className="hidden"
                    onChange={handleUpload}
                    disabled={uploading}
                  />
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 h-9 text-sm hover:bg-muted/50">
                    {uploading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Upload className="h-3.5 w-3.5" />
                    )}
                    {uploading
                      ? locale === "ar"
                        ? "جارٍ الرفع..."
                        : "Uploading..."
                      : locale === "ar"
                        ? "رفع ملف"
                        : "Upload file"}
                  </span>
                </label>
              </div>

              {attachments.length === 0 && !opp.proposalUrl && !opp.contractUrl ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  {locale === "ar"
                    ? "لا توجد مستندات بعد. ارفع أول ملف لتبدأ."
                    : "No documents yet. Upload the first one to get started."}
                </p>
              ) : (
                <div className="space-y-2">
                  {attachments.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 hover:bg-muted/30 text-sm"
                    >
                      <a
                        href={a.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 min-w-0 flex-1"
                      >
                        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="min-w-0">
                          <p className="font-medium truncate">{a.filename}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {(a.sizeBytes / 1024).toFixed(1)} KB ·{" "}
                            {new Date(a.createdAt).toLocaleString()}
                          </p>
                        </div>
                      </a>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          {a.kind}
                        </span>
                        {/* user-feature 2026-06-19: only the uploader can
                            delete their own document. */}
                        {a.uploadedById === currentUserId && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            title={locale === "ar" ? "حذف المستند" : "Delete document"}
                            onClick={() => handleDeleteAttachment(a.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Legacy single-URL fields, shown at the bottom for continuity */}
                  {Boolean(opp.proposalUrl) && (
                    <a
                      href={opp.proposalUrl as string}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 rounded-md border border-dashed border-border px-3 py-2 hover:bg-muted/30 text-sm"
                    >
                      <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span>{t.attachmentKinds.PROPOSAL} (legacy URL)</span>
                    </a>
                  )}
                  {Boolean(opp.contractUrl) && (
                    <a
                      href={opp.contractUrl as string}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 rounded-md border border-dashed border-border px-3 py-2 hover:bg-muted/30 text-sm"
                    >
                      <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span>{t.attachmentKinds.CONTRACT} (legacy URL)</span>
                    </a>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
      </div>

      {/* Stage Change Modal */}
      <StageChangeModal
        open={stageModalOpen}
        onOpenChange={setStageModalOpen}
        opportunityId={opp.id as string}
        currentStage={opp.stage as string}
        locale={locale}
      />

      {/* Start-workflow dialog — manager picks a workflow + leaves an optional
          kickoff comment; the API copies opp notes/attachments into the
          first task so the team picks up where the rep left off. */}
      {canStartWorkflow && (
        <Dialog open={workflowDialogOpen} onOpenChange={setWorkflowDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Start workflow from this opportunity</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                All notes and attachments on this opportunity will be carried over
                to the first task of the workflow so the team starts with the
                full context.
              </p>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Workflow</label>
                <Select
                  value={workflowChoice || undefined}
                  onValueChange={(v) => setWorkflowChoice(v ?? "")}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Pick a workflow">
                      {(() => {
                        const w = workflows.find((x) => x.id === workflowChoice);
                        return w
                          ? `${w.name}${w.kind === "CUSTOM" ? " · one-shot" : ""}`
                          : "Pick a workflow";
                      })()}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {workflows.map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.name} {w.kind === "CUSTOM" ? "· one-shot" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">
                  Kickoff comment (optional)
                </label>
                <Textarea
                  rows={3}
                  value={workflowComment}
                  onChange={(e) => setWorkflowComment(e.target.value)}
                  placeholder="Context for the team picking this up..."
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setWorkflowDialogOpen(false)}
                disabled={triggeringWorkflow}
              >
                Cancel
              </Button>
              <Button
                onClick={handleTriggerWorkflow}
                disabled={!workflowChoice || triggeringWorkflow}
              >
                {triggeringWorkflow ? (
                  <>
                    <Loader2 className="h-4 w-4 me-2 animate-spin" /> Starting...
                  </>
                ) : (
                  <>
                    <Workflow className="h-4 w-4 me-2" /> Start workflow
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/**
 * Inline-editable Contacts card. Default shows the contact info; the pencil
 * flips it into a 3-field form (name / phone / email) backed by the
 * `/api/crm/opportunities/[id]/contact` endpoint. We use the inline free-text
 * fields stored directly on the opportunity row — no curated CrmContact
 * record needed.
 */
function ContactCard({
  oppId,
  initialName,
  initialPhone,
  initialEmail,
  displayContact,
  contactsLabel,
  router,
}: {
  oppId: string;
  initialName: string;
  initialPhone: string;
  initialEmail: string;
  displayContact: { fullName: string; phone: string | null; email: string | null; whatsapp: string | null } | null;
  contactsLabel: string;
  router: ReturnType<typeof useRouter>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [email, setEmail] = useState(initialEmail);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(initialName);
    setPhone(initialPhone);
    setEmail(initialEmail);
  }, [initialName, initialPhone, initialEmail]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/crm/opportunities/${oppId}/contact`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerContactName: name.trim() || null,
          customerContactPhone: phone.trim() || null,
          customerContactEmail: email.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't save contact");
        return;
      }
      toast.success("Contact updated");
      setEditing(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setName(initialName);
    setPhone(initialPhone);
    setEmail(initialEmail);
    setEditing(false);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">{contactsLabel}</CardTitle>
        {!editing ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEditing(true)}
            className="h-7 px-2 text-xs"
          >
            <Pencil className="h-3 w-3 me-1" />
            Edit
          </Button>
        ) : (
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={cancel} disabled={saving} className="h-7 px-2 text-xs">
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={saving} className="h-7 px-2 text-xs">
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {editing ? (
          <div className="space-y-2">
            <div className="space-y-1">
              <Label className="text-xs">Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sara Hassan" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Phone</Label>
              <Input
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+20 100 123 4567"
                dir="ltr"
                className="ltr-nums"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Email</Label>
              <Input
                type="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="contact@acme.example"
                dir="ltr"
              />
            </div>
          </div>
        ) : displayContact ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{displayContact.fullName}</span>
            </div>
            {displayContact.phone && (
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <a
                  href={`tel:${displayContact.phone}`}
                  className="ltr-nums text-primary hover:underline"
                  dir="ltr"
                >
                  {displayContact.phone}
                </a>
              </div>
            )}
            {displayContact.email && (
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <a
                  href={`mailto:${displayContact.email}`}
                  className="text-primary hover:underline"
                  dir="ltr"
                >
                  {displayContact.email}
                </a>
              </div>
            )}
            {displayContact.whatsapp && (
              <div className="flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-muted-foreground" />
                <span className="ltr-nums" dir="ltr">{displayContact.whatsapp}</span>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No contact recorded yet — click <span className="font-medium">Edit</span> to add one.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
