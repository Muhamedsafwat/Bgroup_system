"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
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
  customerNeed: string | null;
  scheduledBy: { id: string; fullName: string };
};

// 30-minute slots from 09:00 to 21:00 — covers the spec's working hours.
const TIME_SLOTS = (() => {
  const out: { h: number; m: number; label: string }[] = [];
  for (let h = 9; h < 21; h++) {
    for (const m of [0, 30]) {
      const period = h >= 12 ? "م" : "ص";
      const display = `${((h - 1) % 12) + 1}:${m === 0 ? "00" : "30"} ${period}`;
      out.push({ h, m, label: display });
    }
  }
  return out;
})();

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function startOfWeek(d: Date): Date {
  const out = new Date(d);
  out.setDate(out.getDate() - out.getDay());
  out.setHours(0, 0, 0, 0);
  return out;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Approval-cycle palette — at-a-glance, every CRM member can see which slots
 * are taken and what state the booking is in.
 *
 *   Yellow  → PENDING_APPROVAL (or legacy WAITING): assistant hasn't decided
 *   Green   → APPROVED / CONFIRMED / DONE: the slot is locked
 *   Red     → DENIED: assistant blocked it (slot is FREE again for others)
 *   Grey    → CANCELLED: the rep called it off (slot is FREE again)
 */
const STATUS_BG: Record<string, string> = {
  PENDING_APPROVAL:
    "bg-amber-500/20 hover:bg-amber-500/30 text-amber-900 dark:text-amber-200 border-amber-500/50",
  WAITING:
    "bg-amber-500/20 hover:bg-amber-500/30 text-amber-900 dark:text-amber-200 border-amber-500/50",
  APPROVED:
    "bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-900 dark:text-emerald-200 border-emerald-500/50",
  CONFIRMED:
    "bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-900 dark:text-emerald-200 border-emerald-500/50",
  DONE:
    "bg-emerald-600/25 hover:bg-emerald-600/35 text-emerald-900 dark:text-emerald-200 border-emerald-600/50",
  DENIED:
    "bg-rose-500/20 hover:bg-rose-500/30 text-rose-900 dark:text-rose-200 border-rose-500/50 line-through",
  CANCELLED:
    "bg-muted hover:bg-muted/80 text-muted-foreground border-border line-through",
};

export function WeeklyCalendarClient() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);

  const weekDays: Date[] = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [weekStart]);

  const weekEnd = useMemo(() => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 7);
    return d;
  }, [weekStart]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // scope=all so every CRM member sees the org-wide booked grid — needed
    // for product-slot conflict awareness before booking a new meeting.
    const params = new URLSearchParams({
      from: weekStart.toISOString(),
      to: weekEnd.toISOString(),
      scope: "all",
    });
    fetch(`/api/crm/meetings?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : { meetings: [] }))
      .then((d) => {
        if (!cancelled) setMeetings(d.meetings ?? []);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [weekStart, weekEnd]);

  // Map "yyyy-mm-dd:H:M" to meeting(s) that occupy that 30-min slot.
  const slotMap = useMemo(() => {
    const map = new Map<string, Meeting[]>();
    for (const m of meetings) {
      const start = new Date(m.startAt);
      const end = new Date(m.endAt);
      const cursor = new Date(start);
      // Snap cursor down to the previous 30-min boundary.
      cursor.setMinutes(Math.floor(cursor.getMinutes() / 30) * 30, 0, 0);
      while (cursor < end) {
        const key = `${ymd(cursor)}:${cursor.getHours()}:${cursor.getMinutes()}`;
        const arr = map.get(key) ?? [];
        arr.push(m);
        map.set(key, arr);
        cursor.setMinutes(cursor.getMinutes() + 30);
      }
    }
    return map;
  }, [meetings]);

  const todayYmd = ymd(new Date());

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => {
              const d = new Date(weekStart);
              d.setDate(d.getDate() - 7);
              setWeekStart(d);
            }}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setWeekStart(startOfWeek(new Date()))}>
            This week
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => {
              const d = new Date(weekStart);
              d.setDate(d.getDate() + 7);
              setWeekStart(d);
            }}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="ms-2 text-sm font-medium">
            {weekStart.toLocaleDateString(undefined, { month: "short", day: "numeric" })} —{" "}
            {new Date(weekEnd.getTime() - 1).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
          </span>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-500/40 border border-amber-500/60" />
            Pending
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500/40 border border-emerald-500/60" />
            Approved
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-rose-500/40 border border-rose-500/60" />
            Denied
          </span>
          {loading && (
            <span className="flex items-center gap-1 ms-2">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading…
            </span>
          )}
        </div>
      </div>

      <div className="rounded-2xl border bg-card overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="bg-muted/40">
            <tr>
              <th className="w-20 px-2 py-2 text-start font-medium text-muted-foreground border-b">Time</th>
              {weekDays.map((d) => {
                const isToday = ymd(d) === todayYmd;
                return (
                  <th
                    key={d.toISOString()}
                    className={cn(
                      "px-2 py-2 text-center font-medium border-b border-l",
                      isToday ? "text-primary" : "text-muted-foreground"
                    )}
                  >
                    <div>{DAY_LABELS[d.getDay()]}</div>
                    <div className={cn("text-[10px]", isToday && "font-bold")}>
                      {d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {TIME_SLOTS.map((slot) => (
              <tr key={`${slot.h}:${slot.m}`} className="border-b">
                <td className="px-2 py-1 text-muted-foreground align-top whitespace-nowrap">
                  {slot.label}
                </td>
                {weekDays.map((d) => {
                  const key = `${ymd(d)}:${slot.h}:${slot.m}`;
                  const ms = slotMap.get(key) ?? [];
                  return (
                    <td key={key} className="border-l p-1 align-top min-h-[2rem]">
                      {ms.length === 0 ? (
                        <span className="text-emerald-500/40 text-[10px]">✓</span>
                      ) : (
                        <div className="space-y-1">
                          {ms.map((m) => (
                            <div
                              key={m.id}
                              className={cn(
                                "rounded-md border px-1.5 py-1 text-[10px] truncate",
                                STATUS_BG[m.status] ?? "bg-muted border-border"
                              )}
                              title={`${m.code} · ${m.contactName ?? ""} · ${m.customerNeed ?? ""} · ${m.scheduledBy.fullName} · ${m.status}`}
                            >
                              <div className="truncate font-medium">
                                {m.customerNeed ?? m.contactName ?? m.code}
                              </div>
                              <div className="truncate opacity-80">{m.scheduledBy.fullName}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        ✓ available · colored cells are booked meetings. Reps see only their own slots.
      </p>
    </div>
  );
}
