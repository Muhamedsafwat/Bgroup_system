"use client";

import { useState, useEffect, useCallback } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Loader2, CheckCircle2, Trash2, Search, X } from "lucide-react";
import { toast } from "sonner";
import { TaskRow } from "./TaskRow";
import { TaskForm } from "./TaskForm";
import { TaskDrawer } from "./TaskDrawer";
import { useLocale } from "@/lib/i18n";
import { BulkActionBar } from "@/components/shared/BulkActionBar";
import { EmptyState } from "@/components/shared/EmptyState";
import { SavedViewsToolbar, type SavedView } from "@/components/shared/SavedViewsToolbar";
import type { TaskRow as TaskRowT, TaskBucket } from "./types";
import type { TaskEntityType, TaskPriority, TaskType } from "@/generated/prisma";

type Counts = Record<TaskBucket, number>;

type TaskFilters = {
  bucket: TaskBucket;
  q: string;
  priority: TaskPriority | "ALL";
  type: TaskType | "ALL";
};

const ALL_BUCKETS: TaskBucket[] = ["today", "overdue", "upcoming", "someday", "done"];
const BUCKET_LABEL: Record<TaskBucket, string> = {
  today: "Today",
  overdue: "Overdue",
  upcoming: "Upcoming",
  someday: "Someday",
  done: "Done",
};

const PRIORITIES: TaskPriority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const TYPES: TaskType[] = [
  "GENERAL",
  "CALL",
  "EMAIL",
  "MEETING",
  "FOLLOW_UP",
  "ADMIN",
  "ONBOARDING",
  "REVIEW",
  "APPROVAL",
];

export function TaskList({
  /** Filter by entity (used when embedded on a detail page). */
  entityType,
  entityId,
  /** "mine" (default) | "all" — admin-only on the My Tasks page. */
  scope = "mine",
  /** Show the bucket tabs. Disable when embedding for a single entity. */
  showBuckets = true,
  /** Default values forwarded to the create dialog. */
  createDefaults,
  /** Compact embed mode — used on entity detail tabs. */
  compact = false,
  /** Heading rendered above the list. */
  heading,
}: {
  entityType?: TaskEntityType;
  entityId?: string;
  scope?: "mine" | "all";
  showBuckets?: boolean;
  createDefaults?: {
    entityType?: TaskEntityType;
    entityId?: string;
    module?: string;
  };
  compact?: boolean;
  heading?: string;
}) {
  const { locale } = useLocale();
  const isAr = locale === "ar";
  // Per-render bucket label map so the tabs swap on locale toggle.
  const bucketLabel: Record<TaskBucket, string> = isAr
    ? { today: "اليوم", overdue: "متأخر", upcoming: "قادم", someday: "لاحقًا", done: "منتهية" }
    : BUCKET_LABEL;

  const [filters, setFilters] = useState<TaskFilters>({
    bucket: "today",
    q: "",
    priority: "ALL",
    type: "ALL",
  });
  const [tasks, setTasks] = useState<TaskRowT[]>([]);
  const [counts, setCounts] = useState<Counts>({
    today: 0,
    overdue: 0,
    upcoming: 0,
    someday: 0,
    done: 0,
  });
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [formOpen, setFormOpen] = useState(false);
  const [drawerTaskId, setDrawerTaskId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const savedViewScope = entityType
    ? `tasks:entity:${entityType}:${entityId}`
    : `tasks:my:${scope}`;

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("scope", scope);
      if (showBuckets) params.set("bucket", filters.bucket);
      if (entityType) params.set("entityType", entityType);
      if (entityId) params.set("entityId", entityId);
      if (filters.q) params.set("q", filters.q);
      if (filters.priority !== "ALL") params.set("priority", filters.priority);
      if (filters.type !== "ALL") params.set("type", filters.type);
      params.set("limit", "100");

      const res = await fetch(`/api/tasks?${params.toString()}`);
      if (!res.ok) {
        toast.error("Failed to load tasks");
        return;
      }
      const data = await res.json();
      setTasks(data.tasks ?? []);
    } finally {
      setLoading(false);
    }
  }, [scope, showBuckets, filters, entityType, entityId]);

  const fetchCounts = useCallback(async () => {
    if (!showBuckets) return;
    const results = await Promise.all(
      ALL_BUCKETS.map(async (b) => {
        const params = new URLSearchParams();
        params.set("scope", scope);
        params.set("bucket", b);
        params.set("limit", "1");
        if (entityType) params.set("entityType", entityType);
        if (entityId) params.set("entityId", entityId);
        if (filters.q) params.set("q", filters.q);
        if (filters.priority !== "ALL") params.set("priority", filters.priority);
        if (filters.type !== "ALL") params.set("type", filters.type);
        const res = await fetch(`/api/tasks?${params.toString()}`);
        if (!res.ok) return [b, 0] as const;
        const data = await res.json();
        return [b, data.total ?? 0] as const;
      })
    );
    const next = { today: 0, overdue: 0, upcoming: 0, someday: 0, done: 0 } as Counts;
    for (const [b, n] of results) next[b] = n;
    setCounts(next);
  }, [scope, showBuckets, entityType, entityId, filters.q, filters.priority, filters.type]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  useEffect(() => {
    fetchCounts();
  }, [fetchCounts]);

  function toggleSelected(id: string, next: boolean) {
    setSelected((prev) => {
      const s = new Set(prev);
      if (next) s.add(id);
      else s.delete(id);
      return s;
    });
  }

  async function toggleDone(task: TaskRowT) {
    const optimistic = task.status === "DONE" ? "TODO" : "DONE";
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, status: optimistic } : t))
    );
    const res = await fetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: optimistic }),
    });
    if (!res.ok) {
      toast.error("Failed to update task");
      fetchList();
      return;
    }
    fetchList();
    fetchCounts();
  }

  async function bulk(action: "complete" | "delete") {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const res = await fetch("/api/tasks/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, action }),
    });
    if (!res.ok) {
      toast.error("Bulk action failed");
      return;
    }
    const data = await res.json();
    toast.success(`${action === "complete" ? "Completed" : "Deleted"} ${data.count} task(s)`);
    setSelected(new Set());
    fetchList();
    fetchCounts();
  }

  function openCreate() {
    setFormOpen(true);
  }

  function openEdit(task: TaskRowT) {
    setDrawerTaskId(task.id);
    setDrawerOpen(true);
  }

  function applyView(view: SavedView<TaskFilters>) {
    if (view.filters) setFilters({ ...filters, ...view.filters });
  }

  const hasActiveFilters =
    filters.q !== "" || filters.priority !== "ALL" || filters.type !== "ALL";

  return (
    <div className="space-y-3">
      {(heading || true) && (
        <div className="flex items-center justify-between">
          {heading && <h2 className="text-lg font-semibold text-foreground">{heading}</h2>}
          <div className="flex-1" />
          <Button size={compact ? "sm" : "default"} onClick={openCreate}>
            <Plus className="h-4 w-4 me-1.5" />
            New task
          </Button>
        </div>
      )}

      {/* Filter bar — search + priority + type + saved views */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            value={filters.q}
            onChange={(e) => setFilters({ ...filters, q: e.target.value })}
            placeholder="Search tasks..."
            className="ps-8 h-9"
          />
        </div>
        <Select
          value={filters.priority}
          onValueChange={(v) => setFilters({ ...filters, priority: v as TaskFilters["priority"] })}
        >
          <SelectTrigger className="h-9 w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Any priority</SelectItem>
            {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select
          value={filters.type}
          onValueChange={(v) => setFilters({ ...filters, type: v as TaskFilters["type"] })}
        >
          <SelectTrigger className="h-9 w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Any type</SelectItem>
            {TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace("_", " ")}</SelectItem>)}
          </SelectContent>
        </Select>
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9"
            onClick={() => setFilters({ ...filters, q: "", priority: "ALL", type: "ALL" })}
          >
            <X className="h-4 w-4 me-1" />
            Clear
          </Button>
        )}
        <div className="flex-1" />
        <SavedViewsToolbar<TaskFilters>
          scope={savedViewScope}
          currentFilters={filters}
          onApply={applyView}
        />
      </div>

      {showBuckets && (
        <Tabs value={filters.bucket} onValueChange={(v) => setFilters({ ...filters, bucket: v as TaskBucket })}>
          <TabsList>
            {ALL_BUCKETS.map((b) => (
              <TabsTrigger key={b} value={b}>
                {bucketLabel[b]}
                {counts[b] > 0 && (
                  <span className="ms-1.5 text-[10px] bg-muted rounded px-1.5 py-0.5">
                    {counts[b]}
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      <BulkActionBar
        selectedCount={selected.size}
        onClear={() => setSelected(new Set())}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => bulk("complete")}>
              <CheckCircle2 className="h-4 w-4 me-1.5" />
              Complete
            </Button>
            <Button size="sm" variant="outline" onClick={() => bulk("delete")}>
              <Trash2 className="h-4 w-4 me-1.5" />
              Delete
            </Button>
          </>
        }
      />

      <div className="border rounded-lg bg-card">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin me-2" />
            Loading tasks...
          </div>
        ) : tasks.length === 0 ? (
          <div className="py-8">
            <EmptyState
              size="sm"
              icon={CheckCircle2}
              title={
                filters.bucket === "done"
                  ? "Nothing completed yet"
                  : filters.bucket === "overdue"
                  ? "Nothing overdue"
                  : hasActiveFilters
                  ? "No matches"
                  : "No tasks here"
              }
              description={
                hasActiveFilters
                  ? "Adjust filters or clear them to see more."
                  : showBuckets ? "Create a task or switch tabs." : "No tasks attached to this record yet."
              }
            />
          </div>
        ) : (
          <ul>
            {tasks.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                selected={selected.has(t.id)}
                onSelectChange={(v) => toggleSelected(t.id, v)}
                onToggleDone={() => toggleDone(t)}
                onOpen={() => openEdit(t)}
              />
            ))}
          </ul>
        )}
      </div>

      <TaskForm
        open={formOpen}
        onOpenChange={setFormOpen}
        defaults={createDefaults}
        onSaved={() => {
          fetchList();
          fetchCounts();
        }}
      />

      <TaskDrawer
        taskId={drawerTaskId}
        open={drawerOpen}
        onOpenChange={(o) => {
          setDrawerOpen(o);
          if (!o) {
            fetchList();
            fetchCounts();
          }
        }}
        onChanged={() => {
          fetchList();
          fetchCounts();
        }}
      />
    </div>
  );
}
