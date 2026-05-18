"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Upload,
  FileDown,
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Users,
  Send,
  Phone,
  Mail,
  MapPin,
  Briefcase,
  RotateCcw,
  Archive,
  CheckCircle2,
  XCircle,
  Clock,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { useLocale } from "@/lib/i18n";

type Rep = { id: string; fullName: string; fullNameAr: string | null };
type Lead = {
  id: string;
  name: string;
  companyName: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  contactPerson: string | null;
  contactPosition: string | null;
  socialMedia: string | null;
  industry: string | null;
  category: string | null;
  location: string | null;
  source: string | null;
  notes: string | null;
  status: string;
  assignedToId: string | null;
  assignedTo: { id: string; fullName: string } | null;
  lastDispositionAt: string | null;
  createdAt: string;
};

// Bucket keys (stable IDs) stay module-scope; labels are resolved at render
// time from the dictionary so the tabs swap language when the toggle flips.
const BUCKET_KEYS: ReadonlyArray<{ key: string; icon: typeof Users }> = [
  { key: "ALL", icon: Users },
  { key: "NEW", icon: Users },
  { key: "ASSIGNED", icon: Send },
  { key: "NO_ANSWER", icon: Phone },
  { key: "WAITING_LIST", icon: Clock },
  { key: "NOT_INTERESTED", icon: XCircle },
  { key: "CONVERTED", icon: CheckCircle2 },
  { key: "ARCHIVED", icon: Archive },
];

const STATUS_BADGE: Record<string, string> = {
  NEW: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  ASSIGNED: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
  NO_ANSWER: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  WAITING_LIST: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
  NOT_INTERESTED: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  CONVERTED: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  ARCHIVED: "bg-muted text-muted-foreground",
};

export function ColdLeadsClient({
  isManagerOrAdmin,
  reps,
}: {
  isManagerOrAdmin: boolean;
  reps: Rep[];
}) {
  const { t, locale } = useLocale();
  const [bucket, setBucket] = useState<string>("ALL");
  const [rows, setRows] = useState<Lead[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const [q, setQ] = useState("");
  const [industry, setIndustry] = useState("");
  const [category, setCategory] = useState("");
  const [location, setLocation] = useState("");
  // Manager/admin can filter by which rep owns the row. Special value
  // "ALL" → no filter, "unassigned" → only NEW-pool rows, otherwise the
  // CrmUserProfile id. Reps don't see this control (their bucket is
  // implicitly already their own).
  const [assignedTo, setAssignedTo] = useState<string>("ALL");
  // Explicit status filter alongside the bucket tabs. Tabs are still the
  // primary way to navigate; this is a secondary refinement (e.g. combine
  // bucket=ALL with status=ASSIGNED to inspect every assigned row).
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingAction, setPendingAction] = useState(false);

  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [distributeOpen, setDistributeOpen] = useState(false);
  const [distributeRepIds, setDistributeRepIds] = useState<Set<string>>(new Set());

  const [dispositionFor, setDispositionFor] = useState<Lead | null>(null);
  const [editTarget, setEditTarget] = useState<Lead | null>(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setSelected(new Set());
    try {
      const params = new URLSearchParams();
      // Status precedence: the explicit dropdown wins over the bucket tab so
      // the user can do "bucket=ALL + status=ASSIGNED" if they want. If the
      // explicit dropdown is "ALL", fall back to the bucket value.
      const effectiveStatus = statusFilter !== "ALL" ? statusFilter : bucket;
      if (effectiveStatus !== "ALL") params.set("status", effectiveStatus);
      if (q) params.set("q", q);
      if (industry) params.set("industry", industry);
      if (category) params.set("category", category);
      if (location) params.set("location", location);
      if (assignedTo !== "ALL") params.set("assignedToId", assignedTo);
      params.set("page", String(page));
      const res = await fetch(`/api/crm/cold-leads?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setRows(data.rows ?? []);
        setTotal(data.total ?? 0);
        setCounts(data.counts ?? {});
      }
    } finally {
      setLoading(false);
    }
  }, [bucket, q, industry, category, location, assignedTo, statusFilter, page]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  function clearFilters() {
    setQ("");
    setIndustry("");
    setCategory("");
    setLocation("");
    setAssignedTo("ALL");
    setStatusFilter("ALL");
    setPage(1);
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === rows.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(rows.map((r) => r.id)));
    }
  }

  async function handleImport(file: File, skipDuplicates: boolean) {
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      // The default is APPEND — every row in the uploaded file is inserted
      // even if its phone/email already exists. Pass skipDuplicates=true to
      // get the old "merge into directory" behaviour back when re-uploading
      // a near-identical batch.
      if (skipDuplicates) fd.append("skipDuplicates", "true");
      const res = await fetch("/api/crm/cold-leads/import", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Import failed");
        return;
      }
      // Build a precise summary so the user knows nothing was silently
      // dropped. Append-mode says "added all N"; skip-mode says "added X,
      // skipped Y duplicates" and breaks that down.
      const summary = skipDuplicates
        ? `Added ${data.inserted} leads. Skipped ${data.duplicates ?? 0} duplicate${data.duplicates === 1 ? "" : "s"}${
            data.duplicatesAgainstExisting && data.duplicatesInFile
              ? ` (${data.duplicatesAgainstExisting} already in directory, ${data.duplicatesInFile} repeated in file)`
              : ""
          }`
        : `Added ${data.inserted} leads. Append mode — every row from the file was kept.`;
      toast.success(summary);
      setImportOpen(false);
      setPage(1);
      fetchRows();
    } finally {
      setImporting(false);
    }
  }

  async function handleExport() {
    setPendingAction(true);
    try {
      // Pass the current filters so the export reflects what the user is
      // looking at. Empty filters → whole directory (within their scope).
      const params = new URLSearchParams();
      const effectiveStatus = statusFilter !== "ALL" ? statusFilter : bucket;
      if (effectiveStatus !== "ALL") params.set("status", effectiveStatus);
      if (q) params.set("q", q);
      if (industry) params.set("industry", industry);
      if (category) params.set("category", category);
      if (location) params.set("location", location);
      if (assignedTo !== "ALL") params.set("assignedToId", assignedTo);
      const res = await fetch(`/api/crm/cold-leads/export?${params.toString()}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Export failed");
        return;
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      const objUrl = URL.createObjectURL(blob);
      a.href = objUrl;
      a.download = `cold-leads-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
    } finally {
      setPendingAction(false);
    }
  }

  async function handleDistribute() {
    if (selected.size === 0 || distributeRepIds.size === 0) return;
    setPendingAction(true);
    try {
      const res = await fetch("/api/crm/cold-leads/distribute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadIds: Array.from(selected),
          repIds: Array.from(distributeRepIds),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Distribution failed");
        return;
      }
      toast.success(`Assigned ${data.assigned} leads across ${distributeRepIds.size} rep(s)`);
      setDistributeOpen(false);
      setDistributeRepIds(new Set());
      fetchRows();
    } finally {
      setPendingAction(false);
    }
  }

  async function handleArchive() {
    if (selected.size === 0) return;
    const ok = window.confirm(
      `Archive ${selected.size} lead(s)? They'll be hidden from every bucket but can be restored.`
    );
    if (!ok) return;
    setPendingAction(true);
    try {
      const res = await fetch("/api/crm/cold-leads/redistribute", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadIds: Array.from(selected) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Archive failed");
        return;
      }
      toast.success(`${data.count} archived`);
      fetchRows();
    } finally {
      setPendingAction(false);
    }
  }

  async function handleDeleteLead(lead: Lead) {
    if (lead.status === "CONVERTED") {
      toast.error("Converted leads can't be deleted — they're linked to an opportunity. Archive instead.");
      return;
    }
    const ok = window.confirm(
      `Permanently delete "${lead.name}"? This removes the lead and all its call-disposition history. Use "Archive" if you want to keep the record.`
    );
    if (!ok) return;
    setPendingAction(true);
    try {
      const res = await fetch(`/api/crm/cold-leads/${lead.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Delete failed");
        return;
      }
      toast.success(`Deleted "${lead.name}"`);
      fetchRows();
    } finally {
      setPendingAction(false);
    }
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return;
    const ok = window.confirm(
      `Permanently delete ${selected.size} lead(s)? This removes every selected row plus its call-disposition history. Use "Archive" if you only want to hide them.`
    );
    if (!ok) return;
    setPendingAction(true);
    try {
      const res = await fetch("/api/crm/cold-leads/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadIds: Array.from(selected) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Delete failed");
        return;
      }
      toast.success(`${data.deleted} lead(s) deleted`);
      setSelected(new Set());
      fetchRows();
    } finally {
      setPendingAction(false);
    }
  }

  async function handleResetToPool() {
    if (selected.size === 0) return;
    setPendingAction(true);
    try {
      const res = await fetch("/api/crm/cold-leads/redistribute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadIds: Array.from(selected), resetStatus: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Reset failed");
        return;
      }
      toast.success(`${data.count} sent back to the unassigned pool`);
      fetchRows();
    } finally {
      setPendingAction(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t.pages.coldLeads}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isManagerOrAdmin
              ? (locale === "ar" ? "ارفع قوائم العملاء، صفِّ حسب الفئة/القطاع/الموقع، ووزّع على المندوبين." : "Upload bulk lead lists, filter by category / industry / location, and distribute to reps.")
              : (locale === "ar" ? "قائمة مكالماتك. افتح أي عميل لتسجيل ما حدث." : "Your call queue. Open a lead to record what happened.")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleExport}
            disabled={pendingAction || loading}
          >
            <FileDown className="h-4 w-4 me-1.5" />
            {t.common.export} Excel
          </Button>
          {isManagerOrAdmin && (
            <Button onClick={() => setImportOpen(true)} disabled={importing}>
              <Upload className="h-4 w-4 me-1.5" />
              {t.common.import} Excel
            </Button>
          )}
        </div>
      </div>

      {/* Bucket tabs */}
      <Tabs value={bucket} onValueChange={(v) => { setBucket(v); setPage(1); }}>
        <TabsList className="flex-wrap h-auto">
          {BUCKET_KEYS.map((b) => {
            const bucketLabel: Record<string, string> = {
              ALL: t.pages.bucketAll,
              NEW: t.pages.bucketUnassigned,
              ASSIGNED: t.pages.bucketAssigned,
              NO_ANSWER: t.pages.bucketNoAnswer,
              WAITING_LIST: t.pages.bucketWaitingList,
              NOT_INTERESTED: t.pages.bucketNotInterested,
              CONVERTED: t.pages.bucketConverted,
              ARCHIVED: t.pages.bucketArchived,
            };
            return (
            <TabsTrigger key={b.key} value={b.key} className="gap-1.5">
              <b.icon className="h-3.5 w-3.5" />
              <span>{bucketLabel[b.key]}</span>
              <span className="text-xs text-muted-foreground">
                {b.key === "ALL"
                  ? Object.values(counts).reduce((s, n) => s + n, 0)
                  : counts[b.key] ?? 0}
              </span>
            </TabsTrigger>
          );
          })}
        </TabsList>
      </Tabs>

      {/* Filter bar */}
      <Card className="p-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <div className="relative">
            <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(1); }}
              placeholder={t.pages.searchNamePhoneEmail}
              className="ps-9"
            />
          </div>
          <Input
            value={industry}
            onChange={(e) => { setIndustry(e.target.value); setPage(1); }}
            placeholder={t.pages.industry}
          />
          <Input
            value={category}
            onChange={(e) => { setCategory(e.target.value); setPage(1); }}
            placeholder={t.pages.category}
          />
          <Input
            value={location}
            onChange={(e) => { setLocation(e.target.value); setPage(1); }}
            placeholder={locale === "ar" ? "الموقع / العنوان" : "Location / Address"}
          />
          {/* Status dropdown — second axis alongside the bucket tabs. Lets
              the user combine bucket=ALL with a specific status, useful for
              quickly cross-cutting buckets. */}
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="ALL">{locale === "ar" ? "كل الحالات" : "All statuses"}</option>
            <option value="NEW">{t.pages.bucketUnassigned}</option>
            <option value="ASSIGNED">{t.pages.bucketAssigned}</option>
            <option value="NO_ANSWER">{t.pages.bucketNoAnswer}</option>
            <option value="WAITING_LIST">{t.pages.bucketWaitingList}</option>
            <option value="NOT_INTERESTED">{t.pages.bucketNotInterested}</option>
            <option value="CONVERTED">{t.pages.bucketConverted}</option>
            <option value="ARCHIVED">{t.pages.bucketArchived}</option>
          </select>
          {/* Rep-assigned dropdown — managers/admin only. Reps already see
              only their own rows so the filter would be meaningless. */}
          {isManagerOrAdmin && (
            <select
              value={assignedTo}
              onChange={(e) => { setAssignedTo(e.target.value); setPage(1); }}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="ALL">{locale === "ar" ? "كل المندوبين" : "All reps"}</option>
              <option value="unassigned">{locale === "ar" ? "غير معيّن" : "Unassigned"}</option>
              {reps.map((r) => (
                <option key={r.id} value={r.id}>{r.fullName}</option>
              ))}
            </select>
          )}
          {(q || industry || category || location || assignedTo !== "ALL" || statusFilter !== "ALL") && (
            <Button variant="ghost" onClick={clearFilters}>
              <X className="h-4 w-4 me-1" /> {t.pages.clear}
            </Button>
          )}
        </div>
      </Card>

      {/* Bulk action bar */}
      {isManagerOrAdmin && selected.size > 0 && (
        <Card className="p-3 flex items-center gap-3 bg-primary/5 border-primary/20">
          <span className="text-sm font-medium">{selected.size} {t.pages.selectedSuffix}</span>
          <div className="flex-1" />
          <Button size="sm" onClick={() => setDistributeOpen(true)} disabled={pendingAction}>
            <Send className="h-3.5 w-3.5 me-1" /> {t.pages.distributeToReps}
          </Button>
          <Button size="sm" variant="outline" onClick={handleResetToPool} disabled={pendingAction}>
            <RotateCcw className="h-3.5 w-3.5 me-1" /> {t.pages.sendBackToPool}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleArchive}
            disabled={pendingAction}
            className="text-destructive hover:text-destructive"
          >
            <Archive className="h-3.5 w-3.5 me-1" /> {t.pages.archive}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleBulkDelete}
            disabled={pendingAction}
            className="text-destructive hover:text-destructive border-destructive/40"
          >
            <Trash2 className="h-3.5 w-3.5 me-1" /> {t.pages.deleteSelected}
          </Button>
        </Card>
      )}

      {/* Table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 border-b">
              <tr>
                {isManagerOrAdmin && (
                  <th className="w-10 py-2 px-3">
                    <Checkbox
                      checked={rows.length > 0 && selected.size === rows.length}
                      onCheckedChange={toggleAll}
                    />
                  </th>
                )}
                <th className="text-start py-2 px-3 text-xs font-medium uppercase">{t.common.name}</th>
                <th className="text-start py-2 px-3 text-xs font-medium uppercase">{t.cols.company}</th>
                <th className="text-start py-2 px-3 text-xs font-medium uppercase">{t.common.phone}</th>
                <th className="text-start py-2 px-3 text-xs font-medium uppercase">{t.cols.industry}</th>
                <th className="text-start py-2 px-3 text-xs font-medium uppercase">{t.cols.location}</th>
                <th className="text-start py-2 px-3 text-xs font-medium uppercase">{t.cols.status}</th>
                <th className="text-start py-2 px-3 text-xs font-medium uppercase">{t.cols.owner}</th>
                <th className="text-end py-2 px-3 text-xs font-medium uppercase">{t.cols.action}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-muted-foreground">
                    <Loader2 className="h-4 w-4 inline-block me-2 animate-spin" />
                    {t.common.loading}
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-sm text-muted-foreground">
                    {locale === "ar" ? "لا يوجد عملاء في هذا التصنيف" : "No leads in this bucket"}{q || industry || category || location ? (locale === "ar" ? " (أو مطابقة للفلاتر)" : " (or matching the filters)") : ""}.
                  </td>
                </tr>
              ) : (
                rows.map((lead) => (
                  <tr key={lead.id} className="hover:bg-muted/30">
                    {isManagerOrAdmin && (
                      <td className="py-2 px-3">
                        <Checkbox
                          checked={selected.has(lead.id)}
                          onCheckedChange={() => toggleRow(lead.id)}
                        />
                      </td>
                    )}
                    <td className="py-2 px-3 font-medium">{lead.name}</td>
                    <td className="py-2 px-3 text-muted-foreground">{lead.companyName || "—"}</td>
                    <td className="py-2 px-3 font-mono text-xs">{lead.phone || "—"}</td>
                    <td className="py-2 px-3 text-xs text-muted-foreground">{lead.industry || "—"}</td>
                    <td className="py-2 px-3 text-xs text-muted-foreground">{lead.location || "—"}</td>
                    <td className="py-2 px-3">
                      <span className={cn("text-[10px] uppercase rounded px-1.5 py-0.5", STATUS_BADGE[lead.status])}>
                        {lead.status.replace("_", " ")}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-xs text-muted-foreground">
                      {lead.assignedTo?.fullName ?? "—"}
                    </td>
                    <td className="py-2 px-3 text-end">
                      {!isManagerOrAdmin && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDispositionFor(lead)}
                          disabled={lead.status === "CONVERTED"}
                        >
                          Record call
                        </Button>
                      )}
                      {isManagerOrAdmin && (
                        <div className="inline-flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={() => setEditTarget(lead)}
                            title="Edit lead details"
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                            onClick={() => handleDeleteLead(lead)}
                            disabled={pendingAction || lead.status === "CONVERTED"}
                            title={
                              lead.status === "CONVERTED"
                                ? "Converted leads can't be deleted — archive instead"
                                : "Permanently delete this lead"
                            }
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {/* Pagination */}
        <div className="flex items-center justify-between p-3 text-xs text-muted-foreground">
          <span>
            {total === 0 ? "0" : `${(page - 1) * 100 + 1}–${Math.min(page * 100, total)}`} of {total}
          </span>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1 || loading}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPage((p) => p + 1)} disabled={page * 100 >= total || loading}>
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </Card>

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        importing={importing}
        fileRef={fileRef}
        onFile={handleImport}
      />

      <DistributeDialog
        open={distributeOpen}
        onOpenChange={(open) => {
          setDistributeOpen(open);
          if (!open) setDistributeRepIds(new Set());
        }}
        reps={reps}
        selectedCount={selected.size}
        repIds={distributeRepIds}
        onToggleRep={(id) => {
          setDistributeRepIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          });
        }}
        onSubmit={handleDistribute}
        pending={pendingAction}
      />

      <DispositionDialog
        lead={dispositionFor}
        onClose={() => setDispositionFor(null)}
        onChanged={fetchRows}
      />
      <EditLeadDialog
        lead={editTarget}
        onClose={() => setEditTarget(null)}
        onChanged={fetchRows}
        isManagerOrAdmin={isManagerOrAdmin}
        reps={reps}
      />
    </div>
  );
}

/**
 * Lead edit dialog. Reps can fix typos and backfill data fields on their
 * own leads. Admin / manager additionally get a "Status" and "Assign to"
 * picker so they can resurrect an archived lead, mark one CONVERTED
 * manually, or move it off a rep who left the team. The admin path bypasses
 * the disposition history because it's a correction, not a sales touch.
 */
function EditLeadDialog({
  lead,
  onClose,
  onChanged,
  isManagerOrAdmin,
  reps,
}: {
  lead: Lead | null;
  onClose: () => void;
  onChanged: () => void;
  isManagerOrAdmin: boolean;
  reps: Rep[];
}) {
  const { locale } = useLocale();
  const [form, setForm] = useState({
    name: "",
    companyName: "",
    phone: "",
    email: "",
    website: "",
    socialMedia: "",
    contactPerson: "",
    contactPosition: "",
    industry: "",
    category: "",
    location: "",
    source: "",
    notes: "",
  });
  const [status, setStatus] = useState<string>("");
  const [assignedToId, setAssignedToId] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!lead) return;
    setForm({
      name: lead.name ?? "",
      companyName: lead.companyName ?? "",
      phone: lead.phone ?? "",
      email: lead.email ?? "",
      website: lead.website ?? "",
      socialMedia: lead.socialMedia ?? "",
      contactPerson: lead.contactPerson ?? "",
      contactPosition: lead.contactPosition ?? "",
      industry: lead.industry ?? "",
      category: lead.category ?? "",
      location: lead.location ?? "",
      source: lead.source ?? "",
      notes: lead.notes ?? "",
    });
    setStatus(lead.status ?? "");
    setAssignedToId(lead.assignedToId ?? "");
  }, [lead]);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit() {
    if (!lead) return;
    if (!form.name.trim()) {
      toast.error("Name can't be empty");
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(form)) {
        body[k] = (v as string).trim() || null;
      }
      // Name is required by the schema (min 1); send the trimmed value
      // unconditionally so we don't accidentally null it out.
      body.name = form.name.trim();
      // Admin-only overrides. Only send when changed so the server can fall
      // through its auto-status-on-assign logic, and so a rep who somehow
      // saw these fields can't slip them past the 403 check.
      if (isManagerOrAdmin) {
        if (status && status !== lead.status) {
          body.status = status;
        }
        const currentAssigned = lead.assignedToId ?? "";
        if (assignedToId !== currentAssigned) {
          body.assignedToId = assignedToId || null;
        }
      }
      const res = await fetch(`/api/crm/cold-leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Update failed");
        return;
      }
      toast.success(`"${form.name}" updated`);
      onClose();
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!lead} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{locale === "ar" ? "تعديل العميل" : "Edit cold lead"}</DialogTitle>
        </DialogHeader>
        {lead && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Code: <span className="font-mono">{lead.id}</span> · Status:{" "}
              <span className="font-medium">{lead.status.replace("_", " ")}</span>
              {lead.assignedTo && (
                <> · Assigned to <span className="font-medium">{lead.assignedTo.fullName}</span></>
              )}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2">
                <Label className="text-[11px]">Name *</Label>
                <Input value={form.name} onChange={(e) => set("name", e.target.value)} className="h-8 text-xs" />
              </div>
              <div>
                <Label className="text-[11px]">Company</Label>
                <Input value={form.companyName} onChange={(e) => set("companyName", e.target.value)} className="h-8 text-xs" />
              </div>
              <div>
                <Label className="text-[11px]">Phone</Label>
                <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} className="h-8 text-xs" />
              </div>
              <div>
                <Label className="text-[11px]">Email</Label>
                <Input value={form.email} onChange={(e) => set("email", e.target.value)} className="h-8 text-xs" />
              </div>
              <div>
                <Label className="text-[11px]">Website</Label>
                <Input value={form.website} onChange={(e) => set("website", e.target.value)} placeholder="https://" className="h-8 text-xs" />
              </div>
              <div>
                <Label className="text-[11px]">Social media</Label>
                <Input value={form.socialMedia} onChange={(e) => set("socialMedia", e.target.value)} placeholder="LinkedIn / FB / IG" className="h-8 text-xs" />
              </div>
              <div>
                <Label className="text-[11px]">Contact person</Label>
                <Input value={form.contactPerson} onChange={(e) => set("contactPerson", e.target.value)} className="h-8 text-xs" />
              </div>
              <div>
                <Label className="text-[11px]">Contact position</Label>
                <Input value={form.contactPosition} onChange={(e) => set("contactPosition", e.target.value)} className="h-8 text-xs" />
              </div>
              <div>
                <Label className="text-[11px]">Industry</Label>
                <Input value={form.industry} onChange={(e) => set("industry", e.target.value)} className="h-8 text-xs" />
              </div>
              <div>
                <Label className="text-[11px]">Category</Label>
                <Input value={form.category} onChange={(e) => set("category", e.target.value)} className="h-8 text-xs" />
              </div>
              <div>
                <Label className="text-[11px]">Location</Label>
                <Input value={form.location} onChange={(e) => set("location", e.target.value)} className="h-8 text-xs" />
              </div>
              <div>
                <Label className="text-[11px]">Source</Label>
                <Input value={form.source} onChange={(e) => set("source", e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="col-span-2">
                <Label className="text-[11px]">Notes</Label>
                <Input value={form.notes} onChange={(e) => set("notes", e.target.value)} className="h-8 text-xs" />
              </div>
            </div>

            {isManagerOrAdmin && (
              <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                <p className="text-[11px] font-semibold uppercase text-muted-foreground tracking-wide">
                  Admin overrides
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Changing status or owner here is recorded as an admin correction (no disposition entry).
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[11px]">Status</Label>
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value)}
                      className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                    >
                      <option value="NEW">New (unassigned)</option>
                      <option value="ASSIGNED">Assigned</option>
                      <option value="NO_ANSWER">No answer</option>
                      <option value="WAITING_LIST">Waiting list</option>
                      <option value="NOT_INTERESTED">Not interested</option>
                      <option value="CONVERTED">Converted</option>
                      <option value="ARCHIVED">Archived</option>
                    </select>
                  </div>
                  <div>
                    <Label className="text-[11px]">Assigned sales</Label>
                    <select
                      value={assignedToId}
                      onChange={(e) => setAssignedToId(e.target.value)}
                      className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                    >
                      <option value="">— Unassigned —</option>
                      {reps.map((r) => (
                        <option key={r.id} value={r.id}>{r.fullName}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || !form.name.trim()}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Optional columns the admin can include in the downloaded template. `name`
 * and `phone` are always present and aren't shown in the picker. Keep this
 * list in sync with the COLUMN_LABELS map on the server (template/route.ts)
 * and the FIELD_SYNONYMS table on the import endpoint.
 */
const TEMPLATE_OPTIONAL_COLUMNS: Array<{ key: string; label: string }> = [
  { key: "companyName", label: "Company" },
  { key: "email", label: "Email" },
  { key: "website", label: "Website" },
  { key: "contactPerson", label: "Contact person" },
  { key: "contactPosition", label: "Contact position" },
  { key: "socialMedia", label: "Social media" },
  { key: "industry", label: "Industry" },
  { key: "category", label: "Category" },
  { key: "location", label: "Location" },
  { key: "source", label: "Source" },
  { key: "notes", label: "Notes" },
];

function ImportDialog({
  open,
  onOpenChange,
  // useLocale() must be called inside this function component for the title;
  // declared here so it's stable for the render.
  importing,
  fileRef,
  onFile,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  importing: boolean;
  fileRef: React.RefObject<HTMLInputElement | null>;
  onFile: (file: File, skipDuplicates: boolean) => void;
}) {
  // Default: keep the heavy-hitters checked so a one-click download is
  // useful out of the box; the rare extras (website, contact position) are
  // opt-in. The admin can adjust each time before clicking download.
  const [selected, setSelected] = useState<Set<string>>(
    new Set(["companyName", "email", "industry", "location", "source", "notes"])
  );
  const [downloading, setDownloading] = useState(false);
  // Default OFF — every uploaded row is appended to the directory, even if
  // the phone/email already exists. This was the cause of the "the new
  // upload overwrote my old data" complaint: dupes were being silently
  // dropped, so a second upload of a near-identical sheet looked like a
  // no-op. Admin can opt back in if they're re-uploading the same batch.
  const [skipDuplicates, setSkipDuplicates] = useState(false);

  function toggleColumn(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function downloadTemplate(format: "xlsx" | "csv") {
    setDownloading(true);
    try {
      const params = new URLSearchParams();
      params.set("format", format);
      params.set("columns", Array.from(selected).join(","));
      const res = await fetch(`/api/crm/cold-leads/template?${params.toString()}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Couldn't download template");
        return;
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      const objUrl = URL.createObjectURL(blob);
      a.href = objUrl;
      a.download = `cold-leads-template.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{useLocale().locale === "ar" ? "استيراد عملاء" : "Import cold leads"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          {/* Step 1 — download template */}
          <div className="rounded-md border border-border bg-muted/20 p-3 space-y-3">
            <div>
              <p className="font-medium">1. Download a template</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Pick which optional columns to include. <b>Name</b> and <b>Phone</b>{" "}
                are always present.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              {TEMPLATE_OPTIONAL_COLUMNS.map((c) => (
                <label
                  key={c.key}
                  className="flex items-center gap-2 cursor-pointer text-xs"
                >
                  <Checkbox
                    checked={selected.has(c.key)}
                    onCheckedChange={() => toggleColumn(c.key)}
                  />
                  <span>{c.label}</span>
                </label>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => downloadTemplate("xlsx")}
                disabled={downloading}
              >
                {downloading ? (
                  <Loader2 className="h-3.5 w-3.5 me-1.5 animate-spin" />
                ) : null}
                Download .xlsx
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => downloadTemplate("csv")}
                disabled={downloading}
              >
                Download .csv
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              The .xlsx and .csv files both round-trip cleanly through Google
              Sheets — just upload the file, edit it there, then export back
              and reupload below. No API setup needed.
            </p>
          </div>

          {/* Step 2 — upload */}
          <div className="rounded-md border border-border bg-muted/20 p-3 space-y-2">
            <div>
              <p className="font-medium">2. Upload your filled-in file</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Accepts <span className="font-mono">.xlsx</span> or{" "}
                <span className="font-mono">.csv</span>. Up to 50,000 rows per upload.
                Every row is appended to the directory — uploading a second
                file <b>adds</b> to your existing data, it never replaces it.
              </p>
            </div>
            <label className="flex items-start gap-2 cursor-pointer text-xs">
              <Checkbox
                checked={skipDuplicates}
                onCheckedChange={() => setSkipDuplicates((s) => !s)}
              />
              <span>
                Skip rows whose phone or email already exists in the directory
                <span className="block text-muted-foreground mt-0.5">
                  Off (the default) keeps everything in your file — useful when
                  you&apos;re building the directory and want each upload to add new
                  rows. Turn this on when you&apos;re re-uploading a near-identical
                  list and don&apos;t want copies.
                </span>
              </span>
            </label>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f, skipDuplicates);
                e.target.value = "";
              }}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importing}>
            Cancel
          </Button>
          <Button onClick={() => fileRef.current?.click()} disabled={importing}>
            {importing ? (
              <>
                <Loader2 className="h-4 w-4 me-1.5 animate-spin" /> Uploading…
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 me-1.5" /> Pick file to upload
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DistributeDialog({
  open,
  onOpenChange,
  reps,
  selectedCount,
  repIds,
  onToggleRep,
  onSubmit,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reps: Rep[];
  selectedCount: number;
  repIds: Set<string>;
  onToggleRep: (id: string) => void;
  onSubmit: () => void;
  pending: boolean;
}) {
  const perRep =
    repIds.size > 0 ? Math.floor(selectedCount / repIds.size) : 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Distribute {selectedCount} lead(s)</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Pick the reps to spread these across. Distribution is round-robin
            so each rep gets an equal share.
          </p>
          <div className="max-h-64 overflow-y-auto rounded-md border divide-y">
            {reps.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">
                No active reps to distribute to.
              </p>
            ) : (
              reps.map((r) => (
                <label
                  key={r.id}
                  className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-accent"
                >
                  <Checkbox
                    checked={repIds.has(r.id)}
                    onCheckedChange={() => onToggleRep(r.id)}
                  />
                  <span className="text-sm">{r.fullName}</span>
                </label>
              ))
            )}
          </div>
          {repIds.size > 0 && (
            <p className="text-xs text-muted-foreground">
              Each rep will get ~{perRep} lead(s).
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={pending || repIds.size === 0}>
            {pending ? "Distributing…" : "Distribute"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DispositionDialog({
  lead,
  onClose,
  onChanged,
}: {
  lead: Lead | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const router = useRouter();
  const [disposition, setDisposition] = useState<"NO_ANSWER" | "WAITING_LIST" | "NOT_INTERESTED">("NO_ANSWER");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  // Editable fields — the lead frequently arrives incomplete and the rep
  // needs to fill it in while they're on the phone. Every field below is
  // bound to the lead state and PATCHed via /api/crm/cold-leads/[id] when
  // the rep clicks "Save & disposition" or "Save details only".
  const [editOpen, setEditOpen] = useState(false);
  const [editWebsite, setEditWebsite] = useState("");
  const [editSocial, setEditSocial] = useState("");
  const [editContactPerson, setEditContactPerson] = useState("");
  const [editContactPosition, setEditContactPosition] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editIndustry, setEditIndustry] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editLeadNotes, setEditLeadNotes] = useState("");

  useEffect(() => {
    if (lead) {
      setDisposition("NO_ANSWER");
      setNotes("");
      setEditOpen(false);
      setEditWebsite(lead.website ?? "");
      setEditSocial(lead.socialMedia ?? "");
      setEditContactPerson(lead.contactPerson ?? "");
      setEditContactPosition(lead.contactPosition ?? "");
      setEditPhone(lead.phone ?? "");
      setEditEmail(lead.email ?? "");
      setEditIndustry(lead.industry ?? "");
      setEditLocation(lead.location ?? "");
      setEditLeadNotes(lead.notes ?? "");
    }
  }, [lead]);

  // Helper that PATCHes the lead with whatever fields the rep filled in.
  // Returns true on success, false on failure. We deliberately push every
  // editable field — null for blanks — so blanking out a previously-set
  // field works (e.g. "I called and that website is wrong, let me clear it").
  async function patchLeadDetails(): Promise<boolean> {
    if (!lead) return false;
    const body = {
      website: editWebsite.trim() || null,
      socialMedia: editSocial.trim() || null,
      contactPerson: editContactPerson.trim() || null,
      contactPosition: editContactPosition.trim() || null,
      phone: editPhone.trim() || null,
      email: editEmail.trim() || null,
      industry: editIndustry.trim() || null,
      location: editLocation.trim() || null,
      notes: editLeadNotes.trim() || null,
    };
    const res = await fetch(`/api/crm/cold-leads/${lead.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error ?? "Couldn't save lead details");
      return false;
    }
    return true;
  }

  async function saveDetailsOnly() {
    if (!lead) return;
    setSaving(true);
    try {
      const ok = await patchLeadDetails();
      if (ok) {
        toast.success("Lead details updated");
        onClose();
        onChanged();
      }
    } finally {
      setSaving(false);
    }
  }

  async function saveAndDisposition() {
    if (!lead) return;
    setSaving(true);
    try {
      // Save the editable fields first (best-effort — if the PATCH fails
      // we surface the error and don't write the disposition either; that
      // way the rep sees exactly what went wrong and can fix it).
      const detailsOk = await patchLeadDetails();
      if (!detailsOk) return;
      const res = await fetch(`/api/crm/cold-leads/${lead.id}/disposition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disposition, notes: notes.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Failed to record disposition");
        return;
      }
      toast.success(`Marked as ${disposition.replace("_", " ").toLowerCase()}`);
      onClose();
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  function goConvert() {
    if (!lead) return;
    router.push(`/crm/cold-leads/${lead.id}/convert`);
  }

  return (
    <Dialog open={!!lead} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Record call · {lead?.name}</DialogTitle>
        </DialogHeader>
        {lead && (
          <div className="space-y-4">
            {/* Quick-call info card — at-a-glance everything the rep needs to
                start the conversation. Tap-to-call phone is on top. */}
            <div className="rounded-md bg-muted/40 p-3 text-sm space-y-1">
              {lead.companyName && (
                <p className="flex items-center gap-2">
                  <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
                  {lead.companyName}
                </p>
              )}
              {lead.phone && (
                <p className="flex items-center gap-2">
                  <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                  <a href={`tel:${lead.phone}`} className="text-primary hover:underline">
                    {lead.phone}
                  </a>
                </p>
              )}
              {lead.email && (
                <p className="flex items-center gap-2">
                  <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                  {lead.email}
                </p>
              )}
              {lead.location && (
                <p className="flex items-center gap-2">
                  <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                  {lead.location}
                </p>
              )}
              {lead.contactPerson && (
                <p className="text-xs text-muted-foreground">
                  Contact: <span className="font-medium text-foreground">{lead.contactPerson}</span>
                  {lead.contactPosition ? ` · ${lead.contactPosition}` : ""}
                </p>
              )}
              {lead.website && (
                <p className="text-xs">
                  🌐{" "}
                  <a
                    href={lead.website.startsWith("http") ? lead.website : `https://${lead.website}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline"
                  >
                    {lead.website}
                  </a>
                </p>
              )}
              {lead.socialMedia && (
                <p className="text-xs">
                  📱 <span className="text-muted-foreground">{lead.socialMedia}</span>
                </p>
              )}
              {lead.notes && (
                <p className="text-xs text-muted-foreground italic mt-1">
                  &quot;{lead.notes}&quot;
                </p>
              )}
            </div>

            {/* The four call outcomes. Convert sits visually beside the
                other three — it's a real outcome, not a separate flow. */}
            <div className="space-y-1.5">
              <Label>Call outcome</Label>
              <div className="grid grid-cols-2 gap-1.5">
                {(["NO_ANSWER", "WAITING_LIST", "NOT_INTERESTED"] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDisposition(d)}
                    className={cn(
                      "rounded-md border px-2 py-2 text-xs transition-all",
                      disposition === d
                        ? "border-primary bg-primary/10 text-primary font-medium"
                        : "border-border hover:bg-accent"
                    )}
                  >
                    {d === "NO_ANSWER" && "📞 No answer"}
                    {d === "WAITING_LIST" && "⏳ Waiting list"}
                    {d === "NOT_INTERESTED" && "❌ Not interested"}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={goConvert}
                  className="rounded-md border-2 border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-2 py-2 text-xs font-medium hover:bg-emerald-500/20 transition-all"
                  title="Promote this lead into an opportunity"
                >
                  ✓ Convert to opportunity
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                <b>No answer</b> — they didn&apos;t pick up. The lead is recyclable
                back to the pool. <b>Waiting list</b> — interested but not now,
                resurfaces after ~30 days. <b>Not interested</b> — closed for
                now (admin can keep or delete). <b>Convert</b> — they&apos;re
                interested; this opens the opportunity form with the lead&apos;s
                data prefilled.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Call notes</Label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="What did they say? Objection / next step / who else to talk to..."
              />
            </div>

            {/* Editable fields — collapsed by default so the call interface
                stays focused. Reps open this when they need to backfill
                missing data they learned on the call (website, social,
                better contact person, fixed phone, etc.). */}
            <div className="rounded-md border border-dashed">
              <button
                type="button"
                onClick={() => setEditOpen((o) => !o)}
                className="w-full px-3 py-2 text-xs font-medium flex items-center justify-between hover:bg-accent"
              >
                <span>{editOpen ? "▾" : "▸"} Update lead details</span>
                <span className="text-muted-foreground">
                  {editOpen ? "Click to collapse" : "Fix missing info / add website / social"}
                </span>
              </button>
              {editOpen && (
                <div className="p-3 space-y-2 border-t">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[11px]">Phone</Label>
                      <Input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">Email</Label>
                      <Input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">Website</Label>
                      <Input value={editWebsite} onChange={(e) => setEditWebsite(e.target.value)} placeholder="https://" className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">Social media</Label>
                      <Input value={editSocial} onChange={(e) => setEditSocial(e.target.value)} placeholder="LinkedIn / Instagram / FB" className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">Contact person</Label>
                      <Input value={editContactPerson} onChange={(e) => setEditContactPerson(e.target.value)} className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">Their position</Label>
                      <Input value={editContactPosition} onChange={(e) => setEditContactPosition(e.target.value)} placeholder="CEO / Procurement / …" className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">Industry</Label>
                      <Input value={editIndustry} onChange={(e) => setEditIndustry(e.target.value)} className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">Location</Label>
                      <Input value={editLocation} onChange={(e) => setEditLocation(e.target.value)} className="h-8 text-xs" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Lead notes (saved on the record)</Label>
                    <Input value={editLeadNotes} onChange={(e) => setEditLeadNotes(e.target.value)} placeholder="Background info you want future reps to see" className="h-8 text-xs" />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          {editOpen && (
            <Button variant="outline" onClick={saveDetailsOnly} disabled={saving}>
              {saving ? "Saving…" : "Save details only"}
            </Button>
          )}
          <Button onClick={saveAndDisposition} disabled={saving}>
            {saving ? "Saving…" : "Record call"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
