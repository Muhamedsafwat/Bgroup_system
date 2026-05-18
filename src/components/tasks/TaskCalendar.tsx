"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { TaskDrawer } from "./TaskDrawer";
import { cn } from "@/lib/utils";
import { useLocale } from "@/lib/i18n";
import type { TaskPriority, TaskStatus } from "@/generated/prisma";

type CalendarTask = {
  id: string;
  title: string;
  dueAt: string;
  priority: TaskPriority;
  status: TaskStatus;
  type: string;
  module: string;
};

const PRIORITY_DOT: Record<TaskPriority, string> = {
  LOW: "bg-muted-foreground",
  MEDIUM: "bg-blue-500",
  HIGH: "bg-amber-500",
  URGENT: "bg-red-500",
};

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
function ymd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function TaskCalendar() {
  const { locale } = useLocale();
  const isAr = locale === "ar";
  const [cursor, setCursor] = useState(startOfMonth(new Date()));
  const [tasks, setTasks] = useState<CalendarTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerId, setDrawerId] = useState<string | null>(null);

  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);

  // Pre-pad calendar to start on Sunday for a clean grid.
  const gridStart = new Date(monthStart);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());
  const gridDays: Date[] = [];
  const gridEnd = new Date(monthEnd);
  gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()));
  for (let d = new Date(gridStart); d <= gridEnd; d.setDate(d.getDate() + 1)) {
    gridDays.push(new Date(d));
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({
      from: ymd(gridStart),
      to: ymd(gridEnd),
      scope: "mine",
    });
    fetch(`/api/tasks/calendar?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : { tasks: [] }))
      .then((d) => {
        if (!cancelled) setTasks(d.tasks ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor.getFullYear(), cursor.getMonth()]);

  const tasksByDay = useMemo(() => {
    const map = new Map<string, CalendarTask[]>();
    for (const t of tasks) {
      if (!t.dueAt) continue;
      const key = ymd(new Date(t.dueAt));
      const arr = map.get(key) ?? [];
      arr.push(t);
      map.set(key, arr);
    }
    return map;
  }, [tasks]);

  const monthLabel = cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const today = ymd(new Date());

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCursor(startOfMonth(new Date()))}
          >
            {isAr ? "اليوم" : "Today"}
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <h2 className="text-base font-semibold ms-2">{monthLabel}</h2>
        </div>
        {loading && (
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading...
          </div>
        )}
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="grid grid-cols-7 border-b bg-muted/30">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="px-2 py-2 text-xs font-semibold text-muted-foreground text-center">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {gridDays.map((d) => {
            const key = ymd(d);
            const inMonth = d.getMonth() === cursor.getMonth();
            const dayTasks = tasksByDay.get(key) ?? [];
            const isToday = key === today;
            return (
              <div
                key={key}
                className={cn(
                  "border-b border-r min-h-24 p-1.5 text-xs",
                  inMonth ? "bg-card" : "bg-muted/20 text-muted-foreground"
                )}
              >
                <div className={cn("flex items-center justify-between mb-1")}>
                  <span
                    className={cn(
                      "inline-flex h-5 w-5 items-center justify-center rounded text-[11px] font-medium",
                      isToday && "bg-primary text-primary-foreground"
                    )}
                  >
                    {d.getDate()}
                  </span>
                  {dayTasks.length > 3 && (
                    <span className="text-[10px] text-muted-foreground">+{dayTasks.length - 3}</span>
                  )}
                </div>
                <div className="space-y-1">
                  {dayTasks.slice(0, 3).map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setDrawerId(t.id)}
                      className={cn(
                        "w-full text-left flex items-center gap-1.5 rounded px-1.5 py-0.5 truncate hover:bg-accent transition-colors",
                        t.status === "DONE" && "line-through text-muted-foreground"
                      )}
                      title={t.title}
                    >
                      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", PRIORITY_DOT[t.priority])} />
                      <span className="truncate">{t.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <TaskDrawer
        taskId={drawerId}
        open={drawerId !== null}
        onOpenChange={(o) => {
          if (!o) setDrawerId(null);
        }}
        onChanged={() => {
          // Re-fetch the visible window.
          const params = new URLSearchParams({
            from: ymd(gridStart),
            to: ymd(gridEnd),
            scope: "mine",
          });
          fetch(`/api/tasks/calendar?${params.toString()}`)
            .then((r) => (r.ok ? r.json() : { tasks: [] }))
            .then((d) => setTasks(d.tasks ?? []));
        }}
      />
    </div>
  );
}
