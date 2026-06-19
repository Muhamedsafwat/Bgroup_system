"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StageBadge } from "@/components/crm/shared/StageBadge";
import { PriorityBadge } from "@/components/crm/shared/PriorityBadge";
import { EntityBadge } from "@/components/crm/shared/EntityBadge";
import { CurrencyDisplay } from "@/components/crm/shared/CurrencyDisplay";
import { DateDisplay } from "@/components/crm/shared/DateDisplay";
import { EmptyState } from "@/components/crm/shared/EmptyState";
import { Plus, Search, Kanban as KanbanIcon, List, ArrowRightLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { OpportunityKanban } from "@/components/crm/opportunities/OpportunityKanban";
import { Pagination } from "@/components/shared/Pagination";
import type { Locale } from "@/lib/i18n";

// Must match getOpportunities' default pageSize so totalPages is correct.
const PAGE_SIZE = 50;

type Rep = { id: string; fullName: string; role: string };

type Opportunity = {
  id: string;
  code: string;
  title: string;
  stage: string;
  priority: string;
  estimatedValue: number;
  currency: string;
  estimatedValueEGP: number;
  weightedValueEGP: number;
  probabilityPct: number;
  nextAction: string | null;
  nextActionDate: string | null;
  expectedCloseDate: string | null;
  updatedAt: string;
  customerCompanyName: string | null;
  company: { id: string; nameEn: string; nameAr: string | null } | null;
  owner: { id: string; fullName: string; fullNameAr: string | null };
  entity: { id: string; code: string; nameEn: string; nameAr: string; color: string };
};

type Entity = { id: string; code: string; nameEn: string; nameAr: string; color: string };

export function OpportunityListClient({
  opportunities,
  total,
  entities,
  locale,
  canTransfer = false,
  reps = [],
}: {
  opportunities: Opportunity[];
  total: number;
  entities: Entity[];
  locale: Locale;
  canTransfer?: boolean;
  reps?: Rep[];
}) {
  const { t } = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [view, setView] = useState<"table" | "kanban">("table");

  // Bulk selection state — admins + managers get checkboxes to multi-select
  // rows and reassign them to another rep in one shot.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferTo, setTransferTo] = useState("");
  const [transferReason, setTransferReason] = useState("");
  const [transferring, setTransferring] = useState(false);

  // Tier-0 #5 — extra bulk actions beyond reassign. The action select
  // routes to /api/crm/opportunities/bulk with a tagged-union body.
  // Set-stage / set-priority dialogs are inline below for tightness.
  const [bulkBusy, setBulkBusy] = useState(false);
  const [stageDialog, setStageDialog] = useState(false);
  const [stageDialogValue, setStageDialogValue] = useState("");
  const [priorityDialog, setPriorityDialog] = useState(false);
  const [priorityDialogValue, setPriorityDialogValue] = useState<"HOT" | "WARM" | "COLD">("WARM");
  const [deleteDialog, setDeleteDialog] = useState(false);

  async function runBulk(body: Record<string, unknown>) {
    setBulkBusy(true);
    try {
      const res = await fetch("/api/crm/opportunities/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected), ...body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Bulk action failed");
        return;
      }
      const skipped = data.skipped > 0 ? ` · ${data.skipped} skipped` : "";
      toast.success(`Updated ${data.affected} opportunit${data.affected === 1 ? "y" : "ies"}${skipped}`);
      setSelected(new Set());
      setStageDialog(false);
      setPriorityDialog(false);
      setDeleteDialog(false);
      router.refresh();
    } finally {
      setBulkBusy(false);
    }
  }

  // Tier-0 #6 — saved-view picker. Lists this user's views + every
  // shared view scoped to crm:opportunities. Selecting one applies its
  // saved filters to the URL search params, triggering the existing
  // server-side filter pipeline.
  type SavedView = {
    id: string;
    name: string;
    filtersJson: Record<string, unknown>;
    isShared: boolean;
    mine: boolean;
    owner: { id: string; fullName: string } | null;
  };
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [savedViewName, setSavedViewName] = useState("");
  const [savedViewShared, setSavedViewShared] = useState(false);
  const [savedViewDialog, setSavedViewDialog] = useState(false);
  const [savedViewBusy, setSavedViewBusy] = useState(false);

  async function loadSavedViews() {
    try {
      const res = await fetch("/api/crm/saved-views?scope=crm:opportunities");
      if (res.ok) {
        const data = await res.json();
        setSavedViews(data.views ?? []);
      }
    } catch {
      // Non-fatal — the picker just stays empty.
    }
  }
  // Lazy-load on first interaction with the picker; avoid a noisy
  // fetch for every visitor who never opens the dropdown.
  function ensureSavedViews() {
    if (savedViews.length === 0) loadSavedViews();
  }

  function applySavedView(v: SavedView) {
    const params = new URLSearchParams();
    for (const [k, val] of Object.entries(v.filtersJson)) {
      if (val != null && String(val).length > 0) params.set(k, String(val));
    }
    router.push(`/crm/opportunities?${params.toString()}`);
  }

  async function saveCurrentView() {
    if (!savedViewName.trim()) return;
    setSavedViewBusy(true);
    try {
      const params = Object.fromEntries(searchParams.entries());
      const res = await fetch("/api/crm/saved-views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: "crm:opportunities",
          name: savedViewName.trim(),
          filtersJson: params,
          isShared: savedViewShared,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't save view");
        return;
      }
      toast.success(`View "${savedViewName}" saved`);
      setSavedViewDialog(false);
      setSavedViewName("");
      setSavedViewShared(false);
      loadSavedViews();
    } finally {
      setSavedViewBusy(false);
    }
  }

  async function deleteSavedView(id: string) {
    if (!confirm("Delete this saved view?")) return;
    const res = await fetch(`/api/crm/saved-views/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("View deleted");
      loadSavedViews();
    } else {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? "Delete failed");
    }
  }

  function toggleOne(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  function toggleAll(on: boolean) {
    setSelected(on ? new Set(opportunities.map((o) => o.id)) : new Set());
  }

  async function handleTransfer() {
    if (!transferTo || selected.size === 0) return;
    setTransferring(true);
    try {
      const res = await fetch("/api/crm/opportunities/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opportunityIds: Array.from(selected),
          toRepId: transferTo,
          reason: transferReason.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Transfer failed");
        return;
      }
      const data = await res.json();
      toast.success(
        `Transferred ${data.transferred} opportunity(ies) to ${data.targetRep?.name}${
          data.skipped > 0 ? ` · ${data.skipped} skipped` : ""
        }`
      );
      setSelected(new Set());
      setTransferOpen(false);
      setTransferTo("");
      setTransferReason("");
      router.refresh();
    } finally {
      setTransferring(false);
    }
  }

  function applySearch() {
    const params = new URLSearchParams(searchParams.toString());
    if (search) params.set("search", search);
    else params.delete("search");
    router.push(`/crm/opportunities?${params.toString()}`);
  }

  function setFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== "all") params.set(key, value);
    else params.delete(key);
    router.push(`/crm/opportunities?${params.toString()}`);
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex gap-2 flex-1 w-full sm:w-auto">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t.common.search}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applySearch()}
              className="ps-9"
            />
          </div>
          <Select
            value={searchParams.get("entityId") || "all"}
            onValueChange={(v: any) => setFilter("entityId", v)}
          >
            <SelectTrigger className="w-36">
              <SelectValue placeholder={t.forms.entity} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t.common.all}</SelectItem>
              {entities.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {locale === "ar" ? e.nameAr : e.nameEn}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={searchParams.get("priority") || "all"}
            onValueChange={(v: any) => setFilter("priority", v)}
          >
            <SelectTrigger className="w-32">
              <SelectValue placeholder={t.forms.priority} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t.common.all}</SelectItem>
              <SelectItem value="HOT">{t.priorities.HOT}</SelectItem>
              <SelectItem value="WARM">{t.priorities.WARM}</SelectItem>
              <SelectItem value="COLD">{t.priorities.COLD}</SelectItem>
            </SelectContent>
          </Select>
          {/* User-feature (2026-06-10): owner filter is only useful for
              users who can see other people's opps. Reps are scoped to
              their own list at the DB layer, so a "by rep" picker on
              their toolbar would just confuse them — hide it. The
              roster is already loaded for the bulk-transfer action, so
              this is a free addition (no extra fetch). */}
          {canTransfer && reps.length > 0 && (
            <Select
              value={searchParams.get("ownerId") || "all"}
              onValueChange={(v: any) => setFilter("ownerId", v)}
            >
              <SelectTrigger className="w-40">
                <SelectValue placeholder={locale === "ar" ? "المالك" : "Owner"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t.common.all}</SelectItem>
                {reps.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {/* User-feature: Sort. Recently edited is the default; the
              other options cover the workflows the user called out —
              closest next action (chase queue), hottest first (focus on
              the warmest deals), closing soonest (forecasting), highest
              value, newest. */}
          <Select
            value={searchParams.get("sort") || "recent_edit"}
            onValueChange={(v: any) => setFilter("sort", v === "recent_edit" ? "all" : v)}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder={locale === "ar" ? "ترتيب" : "Sort"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent_edit">
                {locale === "ar" ? "آخر تعديل" : "Recently edited"}
              </SelectItem>
              <SelectItem value="next_action">
                {locale === "ar" ? "أقرب إجراء قادم" : "Closest next action"}
              </SelectItem>
              <SelectItem value="priority_hot_first">
                {locale === "ar" ? "الأهم أولاً (HOT → COLD)" : "Hottest first"}
              </SelectItem>
              <SelectItem value="closing_soonest">
                {locale === "ar" ? "الأقرب للإغلاق" : "Closing soonest"}
              </SelectItem>
              <SelectItem value="value_desc">
                {locale === "ar" ? "الأعلى قيمة" : "Highest value"}
              </SelectItem>
              <SelectItem value="newest">
                {locale === "ar" ? "الأحدث" : "Newest"}
              </SelectItem>
            </SelectContent>
          </Select>
          {/* User-feature: "Mine only" toggle. For reps the toggle is a
              no-op (their list is already scoped) so we hide it. For
              managers/admins it's the fastest way to focus on their
              own queue. */}
          {canTransfer && (
            <Button
              variant={searchParams.get("mine") === "1" ? "secondary" : "outline"}
              size="sm"
              onClick={() => setFilter("mine", searchParams.get("mine") === "1" ? "all" : "1")}
              className="h-9"
            >
              {locale === "ar" ? "خاصتي فقط" : "Mine only"}
            </Button>
          )}
        </div>

        <div className="flex gap-2">
          <div className="flex border rounded-lg">
            <Button
              variant={view === "table" ? "secondary" : "ghost"}
              size="icon"
              className="h-9 w-9 rounded-e-none"
              onClick={() => setView("table")}
            >
              <List className="h-4 w-4" />
            </Button>
            <Button
              variant={view === "kanban" ? "secondary" : "ghost"}
              size="icon"
              className="h-9 w-9 rounded-s-none"
              onClick={() => setView("kanban")}
            >
              <KanbanIcon className="h-4 w-4" />
            </Button>
          </div>
          <Link href="/crm/opportunities/new">
            <Button>
              <Plus className="h-4 w-4 me-2" />
              {t.common.newOpportunity}
            </Button>
          </Link>
        </div>
      </div>

      {/* Tier-0 #6 — saved-view picker. Always visible (mine ∪ shared)
          but disabled when the dropdown has no entries yet. Save-current
          button bottles up the active URL params as a named view. */}
      <div className="flex items-center gap-2 flex-wrap">
        <Select
          value=""
          onValueChange={(id) => {
            const v = savedViews.find((x) => x.id === id);
            if (v) applySavedView(v);
          }}
        >
          <SelectTrigger className="w-56 h-8" onClick={ensureSavedViews}>
            <SelectValue
              placeholder={locale === "ar" ? "تطبيق عرض محفوظ…" : "Apply saved view…"}
            />
          </SelectTrigger>
          <SelectContent>
            {savedViews.length === 0 ? (
              <SelectItem value="__empty__" disabled>
                {locale === "ar" ? "(لا توجد عروض محفوظة)" : "(no saved views yet)"}
              </SelectItem>
            ) : (
              savedViews.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.name}{" "}
                  <span className="text-xs text-muted-foreground">
                    {v.mine ? "" : `· ${v.owner?.fullName ?? ""}`}
                    {v.isShared ? " · shared" : ""}
                  </span>
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          onClick={() => {
            ensureSavedViews();
            setSavedViewDialog(true);
          }}
        >
          {locale === "ar" ? "حفظ كعرض" : "Save current as view"}
        </Button>
        {savedViews.filter((v) => v.mine).length > 0 && (
          <Select
            value=""
            onValueChange={(id) => id && deleteSavedView(id)}
          >
            <SelectTrigger className="w-32 h-8">
              <SelectValue placeholder={locale === "ar" ? "حذف…" : "Delete…"} />
            </SelectTrigger>
            <SelectContent>
              {savedViews
                .filter((v) => v.mine)
                .map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Bulk-action bar (admin / manager) — appears once anything is selected */}
      {canTransfer && selected.size > 0 && (
        <div className="flex items-center gap-2 flex-wrap rounded-lg border border-primary/40 bg-primary/5 px-3 py-2">
          <span className="text-sm font-medium">
            {selected.size} {locale === "ar" ? "محدد" : "selected"}
          </span>
          <Button size="sm" onClick={() => setTransferOpen(true)} disabled={bulkBusy}>
            <ArrowRightLeft className="h-3.5 w-3.5 me-1.5" />
            {locale === "ar" ? "نقل" : "Transfer"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setPriorityDialog(true)} disabled={bulkBusy}>
            {locale === "ar" ? "تغيير الأولوية" : "Set priority"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setStageDialog(true)} disabled={bulkBusy}>
            {locale === "ar" ? "تغيير المرحلة" : "Set stage"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-destructive hover:text-destructive"
            onClick={() => setDeleteDialog(true)}
            disabled={bulkBusy}
          >
            {locale === "ar" ? "حذف" : "Delete"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            {locale === "ar" ? "مسح" : "Clear"}
          </Button>
        </div>
      )}

      {/* Empty state */}
      {opportunities.length === 0 ? (
        <EmptyState
          title={t.common.noResults}
          action={
            <Link href="/crm/opportunities/new">
              <Button>
                <Plus className="h-4 w-4 me-2" />
                {t.common.newOpportunity}
              </Button>
            </Link>
          }
        />
      ) : view === "kanban" ? (
        <OpportunityKanban opportunities={opportunities} locale={locale} />
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {canTransfer && (
                  <TableHead className="w-10">
                    <Checkbox
                      checked={selected.size === opportunities.length && opportunities.length > 0}
                      onCheckedChange={(v) => toggleAll(!!v)}
                      aria-label="Select all"
                    />
                  </TableHead>
                )}
                <TableHead>{t.common.name}</TableHead>
                <TableHead>{t.forms.entity}</TableHead>
                <TableHead>{t.kpis.stage}</TableHead>
                <TableHead>{t.forms.priority}</TableHead>
                <TableHead className="text-end">{t.kpis.weighted}</TableHead>
                <TableHead>{t.forms.nextAction}</TableHead>
                <TableHead>{t.forms.owner}</TableHead>
                <TableHead>{t.forms.expectedCloseDate}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {opportunities.map((opp) => (
                <TableRow
                  key={opp.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => router.push(`/crm/opportunities/${opp.id}`)}
                >
                  {canTransfer && (
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selected.has(opp.id)}
                        onCheckedChange={(v) => toggleOne(opp.id, !!v)}
                        aria-label={`Select ${opp.code}`}
                      />
                    </TableCell>
                  )}
                  <TableCell>
                    <div>
                      <p className="font-medium">{opp.customerCompanyName ?? opp.company?.nameEn ?? "—"}</p>
                      <p className="text-xs text-muted-foreground ltr-nums">{opp.code}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <EntityBadge code={opp.entity.code} color={opp.entity.color} />
                  </TableCell>
                  <TableCell>
                    <StageBadge
                      stage={opp.stage as import("@/types").CrmOpportunityStage}
                      probabilityPct={opp.probabilityPct}
                      showProbability
                    />
                  </TableCell>
                  <TableCell>
                    <PriorityBadge priority={opp.priority as import("@/types").CrmPriority} />
                  </TableCell>
                  <TableCell className="text-end">
                    <CurrencyDisplay
                      amount={Number(opp.weightedValueEGP)}
                      currency="EGP"
                      className="font-medium"
                    />
                  </TableCell>
                  <TableCell>
                    {opp.nextAction && (
                      <div>
                        <p className="text-sm">{t.nextActions[opp.nextAction as keyof typeof t.nextActions]}</p>
                        {opp.nextActionDate && (
                          <DateDisplay
                            date={opp.nextActionDate}
                            className="text-xs text-muted-foreground"
                          />
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {locale === "ar" ? opp.owner.fullNameAr || opp.owner.fullName : opp.owner.fullName}
                  </TableCell>
                  <TableCell>
                    {opp.expectedCloseDate && (
                      <DateDisplay date={opp.expectedCloseDate} className="text-sm" />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* user-feature 2026-06-18: real pagination so the whole book of
          opportunities is browsable, not just the first page. The data
          layer already pages at PAGE_SIZE and returns the grand total. */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm text-muted-foreground">
          {t.common.total}: {total}
        </div>
        <Pagination
          page={Number(searchParams.get("page")) || 1}
          totalPages={Math.max(1, Math.ceil(total / PAGE_SIZE))}
          onPageChange={(p) => setFilter("page", p <= 1 ? "all" : String(p))}
        />
      </div>

      {/* Transfer dialog — reassign N selected opps to another rep. Writes
          one CrmActivityLog OWNER_REASSIGNED row per opp so the audit trail
          tells the full story (who moved what, when, why). */}
      {canTransfer && (
        <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                Transfer {selected.size} opportunit{selected.size === 1 ? "y" : "ies"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Move the selected opportunities from their current owners to another
                sales rep. The new owner will see them in their pipeline immediately.
                A row is added to each opportunity&apos;s activity log so the
                handover is auditable.
              </p>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Transfer to</label>
                <Select
                  value={transferTo || undefined}
                  onValueChange={(v) => setTransferTo(v ?? "")}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Pick a rep">
                      {(() => {
                        const r = reps.find((x) => x.id === transferTo);
                        return r ? `${r.fullName} · ${r.role}` : "Pick a rep";
                      })()}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {reps.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.fullName} <span className="text-xs text-muted-foreground">· {r.role}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">
                  Reason (optional)
                </label>
                <Textarea
                  rows={2}
                  value={transferReason}
                  onChange={(e) => setTransferReason(e.target.value)}
                  placeholder="e.g. Rep on leave / left team / workload rebalancing"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setTransferOpen(false)}
                disabled={transferring}
              >
                Cancel
              </Button>
              <Button
                onClick={handleTransfer}
                disabled={!transferTo || transferring}
              >
                {transferring ? (
                  <>
                    <Loader2 className="h-4 w-4 me-2 animate-spin" /> Transferring...
                  </>
                ) : (
                  <>
                    <ArrowRightLeft className="h-4 w-4 me-2" /> Transfer
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Tier-0 #5 — bulk-set-priority dialog */}
      <Dialog open={priorityDialog} onOpenChange={setPriorityDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {locale === "ar"
                ? `تغيير الأولوية لـ ${selected.size} فرصة`
                : `Set priority for ${selected.size} opportunit${selected.size === 1 ? "y" : "ies"}`}
            </DialogTitle>
          </DialogHeader>
          <div>
            <Select value={priorityDialogValue} onValueChange={(v) => setPriorityDialogValue(v as "HOT" | "WARM" | "COLD")}>
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setPriorityDialog(false)} disabled={bulkBusy}>
              {locale === "ar" ? "إلغاء" : "Cancel"}
            </Button>
            <Button
              onClick={() => runBulk({ action: "set-priority", priority: priorityDialogValue })}
              disabled={bulkBusy}
            >
              {bulkBusy && <Loader2 className="h-4 w-4 me-1.5 animate-spin" />}
              {locale === "ar" ? "تطبيق" : "Apply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tier-0 #5 — bulk-set-stage dialog. Free-text stage code so it
          matches whatever the admin curated in CrmStageConfig. */}
      <Dialog open={stageDialog} onOpenChange={setStageDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {locale === "ar"
                ? `تغيير المرحلة لـ ${selected.size} فرصة`
                : `Set stage for ${selected.size} opportunit${selected.size === 1 ? "y" : "ies"}`}
            </DialogTitle>
          </DialogHeader>
          <div>
            <Input
              value={stageDialogValue}
              onChange={(e) => setStageDialogValue(e.target.value)}
              placeholder="e.g. NEGOTIATION"
              autoFocus
            />
            <p className="text-xs text-muted-foreground mt-1.5">
              {locale === "ar"
                ? "ادخل رمز المرحلة كما هو معرّف في إعدادات المراحل."
                : "Type the stage code exactly as configured in Stage Config (e.g. NEGOTIATION, VERBAL_YES)."}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStageDialog(false)} disabled={bulkBusy}>
              {locale === "ar" ? "إلغاء" : "Cancel"}
            </Button>
            <Button
              onClick={() => runBulk({ action: "set-stage", newStage: stageDialogValue.trim() })}
              disabled={bulkBusy || !stageDialogValue.trim()}
            >
              {bulkBusy && <Loader2 className="h-4 w-4 me-1.5 animate-spin" />}
              {locale === "ar" ? "تطبيق" : "Apply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tier-0 #5 — bulk soft-delete confirmation */}
      <Dialog open={deleteDialog} onOpenChange={setDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">
              {locale === "ar"
                ? `حذف ${selected.size} فرصة؟`
                : `Delete ${selected.size} opportunit${selected.size === 1 ? "y" : "ies"}?`}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {locale === "ar"
              ? "حذف ناعم — الصفقات تختفي من القوائم لكن سجل الأنشطة يبقى. يمكن لمشرف إعادتها."
              : "Soft-delete — opps disappear from lists but the activity history is preserved. An admin can restore them later."}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog(false)} disabled={bulkBusy}>
              {locale === "ar" ? "إلغاء" : "Cancel"}
            </Button>
            <Button
              variant="destructive"
              onClick={() => runBulk({ action: "soft-delete" })}
              disabled={bulkBusy}
            >
              {bulkBusy && <Loader2 className="h-4 w-4 me-1.5 animate-spin" />}
              {locale === "ar" ? "حذف" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tier-0 #6 — save-current-view dialog */}
      <Dialog open={savedViewDialog} onOpenChange={setSavedViewDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{locale === "ar" ? "حفظ كعرض" : "Save current view"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={savedViewName}
              onChange={(e) => setSavedViewName(e.target.value)}
              placeholder={locale === "ar" ? "اسم العرض" : "View name"}
              autoFocus
            />
            {canTransfer && (
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={savedViewShared}
                  onCheckedChange={(v) => setSavedViewShared(!!v)}
                />
                <span>
                  {locale === "ar"
                    ? "مشاركة مع كل المستخدمين (مدير/مشرف فقط)"
                    : "Share with everyone (manager/admin only)"}
                </span>
              </label>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSavedViewDialog(false)} disabled={savedViewBusy}>
              {locale === "ar" ? "إلغاء" : "Cancel"}
            </Button>
            <Button onClick={saveCurrentView} disabled={savedViewBusy || !savedViewName.trim()}>
              {savedViewBusy && <Loader2 className="h-4 w-4 me-1.5 animate-spin" />}
              {locale === "ar" ? "حفظ" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
