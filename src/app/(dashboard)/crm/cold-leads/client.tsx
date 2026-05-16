"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import {
  Upload,
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

const BUCKETS = [
  { key: "ALL", label: "All", icon: Users },
  { key: "NEW", label: "Unassigned", icon: Users },
  { key: "ASSIGNED", label: "Assigned", icon: Send },
  { key: "NO_ANSWER", label: "No answer", icon: Phone },
  { key: "WAITING_LIST", label: "Waiting list", icon: Clock },
  { key: "NOT_INTERESTED", label: "Not interested", icon: XCircle },
  { key: "CONVERTED", label: "Converted", icon: CheckCircle2 },
  { key: "ARCHIVED", label: "Archived", icon: Archive },
] as const;

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

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingAction, setPendingAction] = useState(false);

  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [distributeOpen, setDistributeOpen] = useState(false);
  const [distributeRepIds, setDistributeRepIds] = useState<Set<string>>(new Set());

  const [dispositionFor, setDispositionFor] = useState<Lead | null>(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setSelected(new Set());
    try {
      const params = new URLSearchParams();
      if (bucket !== "ALL") params.set("status", bucket);
      if (q) params.set("q", q);
      if (industry) params.set("industry", industry);
      if (category) params.set("category", category);
      if (location) params.set("location", location);
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
  }, [bucket, q, industry, category, location, page]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  function clearFilters() {
    setQ("");
    setIndustry("");
    setCategory("");
    setLocation("");
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

  async function handleImport(file: File) {
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/crm/cold-leads/import", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Import failed");
        return;
      }
      toast.success(
        `Imported ${data.inserted} leads${data.duplicates ? ` (${data.duplicates} duplicates skipped)` : ""}`
      );
      setImportOpen(false);
      setPage(1);
      fetchRows();
    } finally {
      setImporting(false);
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
          <h1 className="text-2xl font-bold">Cold leads</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isManagerOrAdmin
              ? "Upload bulk lead lists, filter by category / industry / location, and distribute to reps."
              : "Your call queue. Open a lead to record what happened."}
          </p>
        </div>
        {isManagerOrAdmin && (
          <Button onClick={() => setImportOpen(true)} disabled={importing}>
            <Upload className="h-4 w-4 me-1.5" />
            Import Excel
          </Button>
        )}
      </div>

      {/* Bucket tabs */}
      <Tabs value={bucket} onValueChange={(v) => { setBucket(v); setPage(1); }}>
        <TabsList className="flex-wrap h-auto">
          {BUCKETS.map((b) => (
            <TabsTrigger key={b.key} value={b.key} className="gap-1.5">
              <b.icon className="h-3.5 w-3.5" />
              <span>{b.label}</span>
              <span className="text-xs text-muted-foreground">
                {b.key === "ALL"
                  ? Object.values(counts).reduce((s, n) => s + n, 0)
                  : counts[b.key] ?? 0}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Filter bar */}
      <Card className="p-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
          <div className="relative">
            <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(1); }}
              placeholder="Search name, phone, email…"
              className="ps-9"
            />
          </div>
          <Input
            value={industry}
            onChange={(e) => { setIndustry(e.target.value); setPage(1); }}
            placeholder="Industry"
          />
          <Input
            value={category}
            onChange={(e) => { setCategory(e.target.value); setPage(1); }}
            placeholder="Category"
          />
          <Input
            value={location}
            onChange={(e) => { setLocation(e.target.value); setPage(1); }}
            placeholder="Location"
          />
          {(q || industry || category || location) && (
            <Button variant="ghost" onClick={clearFilters}>
              <X className="h-4 w-4 me-1" /> Clear
            </Button>
          )}
        </div>
      </Card>

      {/* Bulk action bar */}
      {isManagerOrAdmin && selected.size > 0 && (
        <Card className="p-3 flex items-center gap-3 bg-primary/5 border-primary/20">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <div className="flex-1" />
          <Button size="sm" onClick={() => setDistributeOpen(true)} disabled={pendingAction}>
            <Send className="h-3.5 w-3.5 me-1" /> Distribute to reps
          </Button>
          <Button size="sm" variant="outline" onClick={handleResetToPool} disabled={pendingAction}>
            <RotateCcw className="h-3.5 w-3.5 me-1" /> Send back to pool
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleArchive}
            disabled={pendingAction}
            className="text-destructive hover:text-destructive"
          >
            <Archive className="h-3.5 w-3.5 me-1" /> Archive
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
                <th className="text-start py-2 px-3 text-xs font-medium uppercase">Name</th>
                <th className="text-start py-2 px-3 text-xs font-medium uppercase">Company</th>
                <th className="text-start py-2 px-3 text-xs font-medium uppercase">Phone</th>
                <th className="text-start py-2 px-3 text-xs font-medium uppercase">Industry</th>
                <th className="text-start py-2 px-3 text-xs font-medium uppercase">Location</th>
                <th className="text-start py-2 px-3 text-xs font-medium uppercase">Status</th>
                <th className="text-start py-2 px-3 text-xs font-medium uppercase">Owner</th>
                <th className="text-end py-2 px-3 text-xs font-medium uppercase">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-muted-foreground">
                    <Loader2 className="h-4 w-4 inline-block me-2 animate-spin" />
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-sm text-muted-foreground">
                    No leads in this bucket{q || industry || category || location ? " (or matching the filters)" : ""}.
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
                      {isManagerOrAdmin && lead.assignedTo && (
                        <span className="text-xs text-muted-foreground">Assigned</span>
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
    </div>
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
  { key: "industry", label: "Industry" },
  { key: "category", label: "Category" },
  { key: "location", label: "Location" },
  { key: "source", label: "Source" },
  { key: "notes", label: "Notes" },
];

function ImportDialog({
  open,
  onOpenChange,
  importing,
  fileRef,
  onFile,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  importing: boolean;
  fileRef: React.RefObject<HTMLInputElement | null>;
  onFile: (file: File) => void;
}) {
  // Default: keep the heavy-hitters checked so a one-click download is
  // useful out of the box; the rare extras (website, contact position) are
  // opt-in. The admin can adjust each time before clicking download.
  const [selected, setSelected] = useState<Set<string>>(
    new Set(["companyName", "email", "industry", "location", "source", "notes"])
  );
  const [downloading, setDownloading] = useState(false);

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
          <DialogTitle>Import cold leads</DialogTitle>
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
                Duplicates (by phone or email) are skipped automatically.
              </p>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
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
  const [disposition, setDisposition] = useState<"NO_ANSWER" | "WAITING_LIST" | "NOT_INTERESTED">("NO_ANSWER");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (lead) {
      setDisposition("NO_ANSWER");
      setNotes("");
    }
  }, [lead]);

  async function save() {
    if (!lead) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/crm/cold-leads/${lead.id}/disposition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disposition, notes: notes.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Failed");
        return;
      }
      toast.success("Disposition recorded");
      onClose();
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!lead} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record call · {lead?.name}</DialogTitle>
        </DialogHeader>
        {lead && (
          <div className="space-y-3">
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
            </div>
            <div className="space-y-1.5">
              <Label>Outcome</Label>
              <div className="grid grid-cols-3 gap-1.5">
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
                    {d.replace("_", " ").toLowerCase()}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                To convert into an opportunity instead, use{" "}
                <Link href={`/crm/cold-leads/${lead.id}/convert`} className="text-primary hover:underline">
                  Convert
                </Link>.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="What did they say?"
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
