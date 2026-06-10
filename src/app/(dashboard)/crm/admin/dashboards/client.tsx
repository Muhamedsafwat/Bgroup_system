"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Plus, Trash2, GripVertical } from "lucide-react";
import { toast } from "sonner";
import { useLocale } from "@/lib/i18n";

type WidgetKind =
  | "kpi.pipeline"
  | "kpi.coverage"
  | "kpi.won-mtd"
  | "kpi.stalled"
  | "leaderboard"
  | "stage-funnel"
  | "loss-reasons"
  | "win-rate"
  | "activity-trend";

type Widget = { kind: WidgetKind; x: number; y: number; w: number; h: number };

type Dashboard = {
  id: string;
  name: string;
  layoutJson: unknown;
  isShared: boolean;
  ownerId: string;
  owner: { id: string; fullName: string } | null;
  mine: boolean;
};

// Widget catalogue — what shows in the "Add widget" picker. Each
// has a sensible default size (12-col grid, 2-row tall) so the
// admin doesn't have to think about x/y/w/h numbers.
const WIDGET_CATALOG: { kind: WidgetKind; label: string; description: string; w: number; h: number }[] = [
  { kind: "kpi.pipeline", label: "Weighted pipeline (KPI)", description: "Single number — total weighted value of open opps.", w: 3, h: 2 },
  { kind: "kpi.coverage", label: "Coverage ratio (KPI)", description: "Weighted pipeline ÷ remaining quota. < 2× is risky.", w: 3, h: 2 },
  { kind: "kpi.won-mtd", label: "Won this month (KPI)", description: "Count + value of opps closed-won in the current month.", w: 3, h: 2 },
  { kind: "kpi.stalled", label: "Stalled deals (KPI)", description: "Opps that have been in their stage longer than maxDays.", w: 3, h: 2 },
  { kind: "leaderboard", label: "Rep leaderboard", description: "Reps ranked by attainment, with anti-gaming flags.", w: 6, h: 4 },
  { kind: "stage-funnel", label: "Pipeline by stage", description: "Bar chart of open opps in each stage.", w: 6, h: 3 },
  { kind: "loss-reasons", label: "Why we lose", description: "Top loss reasons with counts and lost value.", w: 6, h: 3 },
  { kind: "win-rate", label: "Win rate", description: "Sliced by owner / source / deal-size band.", w: 6, h: 3 },
  { kind: "activity-trend", label: "Activity trend", description: "Calls + meetings logged per day.", w: 6, h: 3 },
];

function parseLayout(stored: unknown): Widget[] {
  if (!Array.isArray(stored)) return [];
  return stored
    .map((w) => {
      if (typeof w !== "object" || w === null) return null;
      const obj = w as Record<string, unknown>;
      if (typeof obj.kind !== "string") return null;
      return {
        kind: obj.kind as WidgetKind,
        x: typeof obj.x === "number" ? obj.x : 0,
        y: typeof obj.y === "number" ? obj.y : 0,
        w: typeof obj.w === "number" ? obj.w : 6,
        h: typeof obj.h === "number" ? obj.h : 2,
      };
    })
    .filter((w): w is Widget => w !== null);
}

/**
 * Tier-2 #38 — saved dashboard layouts. Admin picks widgets from a
 * catalogue and reorders them; the system computes x/y/w/h
 * automatically (left-to-right, two columns wide). No JSON editing
 * required.
 */
export function DashboardsClient() {
  const { locale } = useLocale();
  const [items, setItems] = useState<Dashboard[]>([]);
  const [loading, setLoading] = useState(true);
  // audit v12 MEDIUM (MED-25) ultra — surface load failures so the user can retry
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Dashboard | null>(null);
  const [name, setName] = useState("");
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [isShared, setIsShared] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  async function load() {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch("/api/crm/dashboards");
      if (!res.ok) throw new Error("fetch failed");
      setItems((await res.json()).dashboards ?? []);
    } catch {
      setLoadError(true);
      toast.error("Failed to load dashboards");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  function openCreate() {
    setEditing(null);
    setName("");
    // Start with the two most-asked-for widgets so a brand-new
    // dashboard isn't empty.
    setWidgets([
      { kind: "kpi.pipeline", x: 0, y: 0, w: 3, h: 2 },
      { kind: "leaderboard", x: 6, y: 0, w: 6, h: 4 },
    ]);
    setIsShared(false);
    setOpen(true);
  }
  function openEdit(d: Dashboard) {
    setEditing(d);
    setName(d.name);
    setWidgets(parseLayout(d.layoutJson));
    setIsShared(d.isShared);
    setOpen(true);
  }

  function addWidget(kind: WidgetKind) {
    const cat = WIDGET_CATALOG.find((w) => w.kind === kind);
    if (!cat) return;
    // Stack new widgets at the bottom — the grid renderer flows them
    // anyway. We don't try to be clever about packing; admin can
    // reorder with the arrow buttons.
    const y = widgets.reduce((max, w) => Math.max(max, w.y + w.h), 0);
    setWidgets([...widgets, { kind, x: 0, y, w: cat.w, h: cat.h }]);
    setPickerOpen(false);
  }
  function removeWidget(idx: number) {
    setWidgets(widgets.filter((_, i) => i !== idx));
  }
  function moveUp(idx: number) {
    if (idx === 0) return;
    const next = [...widgets];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    setWidgets(next);
  }
  function moveDown(idx: number) {
    if (idx === widgets.length - 1) return;
    const next = [...widgets];
    [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
    setWidgets(next);
  }

  async function save() {
    if (!name.trim()) {
      toast.error("Pick a name");
      return;
    }
    if (widgets.length === 0) {
      toast.error("Add at least one widget");
      return;
    }
    setBusy(true);
    try {
      const body = { name, layoutJson: widgets, isShared };
      const res = await fetch("/api/crm/dashboards", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing ? { id: editing.id, ...body } : body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Save failed");
        return;
      }
      toast.success(editing ? "Dashboard updated" : "Dashboard created");
      setOpen(false);
      load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(d: Dashboard) {
    if (!confirm(`Delete dashboard "${d.name}"?`)) return;
    const res = await fetch(`/api/crm/dashboards?id=${d.id}`, { method: "DELETE" });
    if (res.ok) load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          {locale === "ar" ? "لوحات معلومات مخصصة" : "Custom dashboards"}
        </h1>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 me-2" />
          {locale === "ar" ? "لوحة جديدة" : "New dashboard"}
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {locale === "ar"
              ? "اختر الويدجت التي تهمك، ووفّر تخطيطك."
              : "Pick widgets, save layouts. Share with the team or keep them personal."}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>
          ) : loadError ? (
            // audit v12 MEDIUM (MED-25) ultra — error branch with retry
            <div className="py-4 text-center space-y-2">
              <p className="text-sm text-destructive">Failed to load dashboards.</p>
              <Button variant="outline" size="sm" onClick={load}>Retry</Button>
            </div>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No dashboards yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Shared</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell className="text-sm">
                      {d.mine ? <Badge>Mine</Badge> : d.owner?.fullName ?? "—"}
                    </TableCell>
                    <TableCell>{d.isShared && <Badge variant="outline">shared</Badge>}</TableCell>
                    <TableCell className="flex gap-1">
                      {d.mine ? (
                        <>
                          <Button variant="ghost" size="sm" onClick={() => openEdit(d)}>Edit</Button>
                          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => remove(d)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">read-only</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit dashboard" : "New dashboard"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs">Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Monday pipeline review"
                autoFocus
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs">Widgets ({widgets.length})</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setPickerOpen(true)}
                >
                  <Plus className="h-3.5 w-3.5 me-1" />
                  Add widget
                </Button>
              </div>
              {widgets.length === 0 ? (
                <p className="text-xs text-muted-foreground italic py-3 text-center border rounded-md">
                  No widgets yet. Click <strong>Add widget</strong>.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {widgets.map((w, idx) => {
                    const meta = WIDGET_CATALOG.find((c) => c.kind === w.kind);
                    return (
                      <div
                        key={idx}
                        className="flex items-center gap-2 rounded-md border bg-muted/30 px-2 py-1.5"
                      >
                        <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-sm flex-1">
                          {meta?.label ?? w.kind}
                          <span className="text-[11px] text-muted-foreground ms-2">
                            {meta?.description}
                          </span>
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-xs"
                          onClick={() => moveUp(idx)}
                          disabled={idx === 0}
                          title="Move up"
                        >
                          ↑
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-xs"
                          onClick={() => moveDown(idx)}
                          disabled={idx === widgets.length - 1}
                          title="Move down"
                        >
                          ↓
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-destructive"
                          onClick={() => removeWidget(idx)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={isShared} onCheckedChange={(v) => setIsShared(!!v)} />
              <span>Share with everyone (read-only for others)</span>
            </label>
            {/* audit v12 MEDIUM (MED-24) recheck-hardening: surface the
                blast-radius so an admin understands "everyone" really
                means every user in the CRM module. Previously this
                checkbox flipped silently; admins occasionally toggled
                it thinking it meant their own team. */}
            {isShared && (
              <p className="text-xs text-amber-600 dark:text-amber-400 ms-6">
                Every CRM user will see this dashboard. To restrict to a
                specific list, leave this unchecked and use the API
                (visibility=SPECIFIC + targetUserIds).
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={save} disabled={busy || !name.trim() || widgets.length === 0}>
              {busy && <Loader2 className="h-4 w-4 me-1.5 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Widget picker sheet */}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Pick a widget</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5 max-h-96 overflow-y-auto">
            {WIDGET_CATALOG.map((w) => (
              <button
                key={w.kind}
                type="button"
                onClick={() => addWidget(w.kind)}
                className="w-full text-start rounded-md border bg-background p-2.5 hover:bg-accent transition-colors"
              >
                <div className="font-medium text-sm">{w.label}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{w.description}</div>
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPickerOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
