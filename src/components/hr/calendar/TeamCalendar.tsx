"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useLocale } from "@/lib/i18n";
import type { LeaveOnCalendar } from "@/app/api/hr/calendar/leaves/route";

const CONFLICT_THRESHOLD = 3; // 3+ people from same department off on the same day

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function startOfWeek(d: Date, weekStartsOn = 1 /* Monday */): Date {
  const out = new Date(d);
  const day = (out.getDay() - weekStartsOn + 7) % 7;
  out.setDate(out.getDate() - day);
  out.setHours(0, 0, 0, 0);
  return out;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

async function fetchLeaves(from: string, to: string): Promise<LeaveOnCalendar[]> {
  const res = await fetch(`/api/hr/calendar/leaves?from=${from}&to=${to}`);
  if (!res.ok) throw new Error("Failed to load");
  const data = (await res.json()) as { leaves: LeaveOnCalendar[] };
  return data.leaves;
}

export function TeamCalendar() {
  const { locale } = useLocale();
  const isAr = locale === "ar";
  const [cursor, setCursor] = useState<Date>(() => startOfMonth(new Date()));

  // Render 6 weeks starting from the Monday before/at the 1st of the cursor month.
  const gridStart = startOfWeek(startOfMonth(cursor));
  const gridEnd = addDays(gridStart, 41);

  const { data: leaves = [], isLoading } = useQuery({
    queryKey: ["hr-calendar", ymd(gridStart), ymd(gridEnd)],
    queryFn: () => fetchLeaves(ymd(gridStart), ymd(gridEnd)),
    staleTime: 30_000,
  });

  // Index leaves per day
  const byDay = useMemo(() => {
    const map = new Map<string, LeaveOnCalendar[]>();
    for (let i = 0; i <= 41; i++) {
      map.set(ymd(addDays(gridStart, i)), []);
    }
    for (const l of leaves) {
      const start = new Date(l.startDate);
      const end = new Date(l.endDate);
      for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
        const key = ymd(d);
        if (map.has(key)) map.get(key)!.push(l);
      }
    }
    return map;
  }, [leaves, gridStart]);

  // Conflict days: department had >= threshold people off
  const conflicts = useMemo(() => {
    const out = new Map<string, { departmentName: string; count: number }[]>();
    for (const [day, list] of byDay.entries()) {
      const byDept = new Map<string, { name: string; count: number }>();
      for (const l of list) {
        const key = l.departmentId ?? "_none_";
        const prev = byDept.get(key);
        const name = l.departmentName ?? "Unassigned";
        byDept.set(key, { name, count: (prev?.count ?? 0) + 1 });
      }
      const flagged = Array.from(byDept.values()).filter(
        (d) => d.count >= CONFLICT_THRESHOLD
      );
      if (flagged.length > 0) {
        out.set(
          day,
          flagged.map((d) => ({ departmentName: d.name, count: d.count }))
        );
      }
    }
    return out;
  }, [byDay]);

  const monthLabel = cursor.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-lg font-semibold text-foreground min-w-40">
            {monthLabel}
          </h2>
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-9"
            onClick={() => setCursor(startOfMonth(new Date()))}
          >
            {isAr ? "اليوم" : "Today"}
          </Button>
        </div>
        <span className="text-xs text-muted-foreground">
          {isAr ? `${leaves.length} إجازة في النطاق` : `${leaves.length} leave${leaves.length === 1 ? "" : "s"} in view`}
        </span>
      </div>

      <Card className="p-0 overflow-hidden">
        {/* Weekday header */}
        <div className="grid grid-cols-7 bg-muted/40 border-b border-border text-xs font-medium text-muted-foreground">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div key={d} className="px-2 py-2 text-center">
              {d}
            </div>
          ))}
        </div>

        {/* 6-week grid */}
        <div className="grid grid-cols-7">
          {Array.from({ length: 42 }).map((_, i) => {
            const day = addDays(gridStart, i);
            const key = ymd(day);
            const isCurrentMonth = day.getMonth() === cursor.getMonth();
            const isToday = ymd(day) === ymd(new Date());
            const dayLeaves = byDay.get(key) ?? [];
            const dayConflict = conflicts.get(key);
            return (
              <div
                key={key}
                className={cn(
                  "min-h-24 border-b border-r border-border p-1.5 flex flex-col gap-1",
                  !isCurrentMonth && "bg-muted/30",
                  isWeekend(day) && "bg-muted/20"
                )}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={cn(
                      "text-xs",
                      isToday
                        ? "bg-primary text-primary-foreground rounded-full w-6 h-6 inline-flex items-center justify-center font-semibold"
                        : isCurrentMonth
                          ? "text-foreground"
                          : "text-muted-foreground"
                    )}
                  >
                    {day.getDate()}
                  </span>
                  {dayConflict && (
                    <span
                      title={dayConflict
                        .map((c) => `${c.count} from ${c.departmentName}`)
                        .join(" · ")}
                      className="inline-flex items-center gap-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-300"
                    >
                      <AlertTriangle className="h-3 w-3" />
                      {dayConflict.reduce((s, c) => s + c.count, 0)}
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-0.5">
                  {isLoading ? (
                    <Skeleton className="h-3 w-full" />
                  ) : (
                    dayLeaves.slice(0, 3).map((l) => (
                      <div
                        key={l.id}
                        title={`${l.employeeName}${l.leaveType ? " · " + l.leaveType : ""} (${l.status})`}
                        className={cn(
                          "text-[10px] leading-tight truncate rounded px-1 py-0.5",
                          l.status === "approved"
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200"
                            : "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
                        )}
                      >
                        {l.employeeName}
                      </div>
                    ))
                  )}
                  {dayLeaves.length > 3 && (
                    <span className="text-[10px] text-muted-foreground">
                      +{dayLeaves.length - 3} more
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
