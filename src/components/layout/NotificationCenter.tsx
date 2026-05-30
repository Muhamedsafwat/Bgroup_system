"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bell, CheckCheck, Inbox } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type UnifiedNotification = {
  id: string;
  module: "hr" | "partners" | "crm";
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  href?: string;
};

type Tab = "all" | "unread" | "hr" | "crm" | "partners";

async function fetchNotifications(): Promise<{
  notifications: UnifiedNotification[];
  unreadCount: number;
}> {
  const res = await fetch("/api/notifications");
  if (!res.ok) throw new Error("Failed to load notifications");
  return res.json();
}

async function markRead(id: string, module: "hr" | "partners" | "crm") {
  const res = await fetch("/api/notifications/read", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, module }),
  });
  if (!res.ok) throw new Error("Failed to mark read");
}

async function markAllRead() {
  const res = await fetch("/api/notifications/read", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scope: "all" }),
  });
  if (!res.ok) throw new Error("Failed to mark all read");
}

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("all");
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["notifications"],
    queryFn: fetchNotifications,
    // SSE drives live updates; we still poll every 60s as a safety net.
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const notifications = data?.notifications ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  // Listen to SSE events and refresh.
  useEffect(() => {
    if (typeof window === "undefined" || typeof EventSource === "undefined") return;
    const es = new EventSource("/api/events");

    function refresh() {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    }

    es.addEventListener("notification.created", (e) => {
      refresh();
      try {
        const data = JSON.parse((e as MessageEvent).data) as { title: string; message: string };
        toast.message(data.title, { description: data.message });
      } catch {
        // ignore
      }
    });
    es.addEventListener("notification.read", refresh);
    es.addEventListener("data.invalidate", (e) => {
      try {
        const { queryKeys } = JSON.parse((e as MessageEvent).data) as { queryKeys: string[][] };
        queryKeys.forEach((k) => queryClient.invalidateQueries({ queryKey: k }));
      } catch {
        refresh();
      }
    });
    es.onerror = () => {
      // EventSource auto-reconnects; nothing to do.
    };
    return () => es.close();
  }, [queryClient]);

  const filtered = useMemo(() => {
    switch (tab) {
      case "unread":
        return notifications.filter((n) => !n.isRead);
      case "hr":
        return notifications.filter((n) => n.module === "hr");
      case "crm":
        return notifications.filter((n) => n.module === "crm");
      case "partners":
        return notifications.filter((n) => n.module === "partners");
      default:
        return notifications;
    }
  }, [notifications, tab]);

  async function handleClick(n: UnifiedNotification) {
    if (!n.isRead) {
      // Optimistic
      queryClient.setQueryData(["notifications"], (prev: typeof data) =>
        prev
          ? {
              ...prev,
              notifications: prev.notifications.map((x) =>
                x.id === n.id ? { ...x, isRead: true } : x
              ),
              unreadCount: Math.max(0, prev.unreadCount - 1),
            }
          : prev
      );
      try {
        await markRead(n.id, n.module);
      } catch {
        queryClient.invalidateQueries({ queryKey: ["notifications"] });
      }
    }
    if (n.href) setOpen(false);
  }

  async function handleMarkAllRead() {
    queryClient.setQueryData(["notifications"], (prev: typeof data) =>
      prev
        ? {
            ...prev,
            notifications: prev.notifications.map((n) => ({ ...n, isRead: true })),
            unreadCount: 0,
          }
        : prev
    );
    try {
      await markAllRead();
    } catch {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-accent text-foreground relative"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center h-4 min-w-4 rounded-full bg-destructive text-destructive-foreground text-[10px] font-medium px-1">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </PopoverTrigger>

      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <span className="font-semibold text-sm">Notifications</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={handleMarkAllRead}
            disabled={unreadCount === 0}
          >
            <CheckCheck className="h-3.5 w-3.5 me-1" />
            Mark all read
          </Button>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList className="grid grid-cols-5 mx-2 my-2">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="unread">
              Unread{unreadCount > 0 ? ` (${unreadCount})` : ""}
            </TabsTrigger>
            <TabsTrigger value="hr">HR</TabsTrigger>
            <TabsTrigger value="crm">CRM</TabsTrigger>
            <TabsTrigger value="partners">Partners</TabsTrigger>
          </TabsList>
          <TabsContent value={tab} className="m-0">
            <ScrollArea className="h-[24rem]">
              {isLoading ? (
                <div className="p-6 text-center text-sm text-muted-foreground">Loading…</div>
              ) : filtered.length === 0 ? (
                <div className="p-6 flex flex-col items-center text-center text-sm text-muted-foreground">
                  <Inbox className="h-6 w-6 mb-2 opacity-50" />
                  No notifications.
                </div>
              ) : (
                <ul>
                  {filtered.map((n) => {
                    const Body = (
                      <div
                        className={cn(
                          "px-3 py-2.5 border-b last:border-0 hover:bg-muted/50 transition-colors cursor-pointer",
                          !n.isRead && "bg-primary/5"
                        )}
                      >
                        <div className="flex items-start gap-2">
                          {!n.isRead && (
                            <span className="mt-1.5 h-2 w-2 rounded-full bg-primary shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline justify-between gap-2">
                              <p className="text-sm font-medium truncate">{n.title}</p>
                              <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0">
                                {n.module}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                              {n.message}
                            </p>
                            <p className="text-[10px] text-muted-foreground mt-1">
                              {new Date(n.createdAt).toLocaleString()}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                    return (
                      <li key={`${n.module}-${n.id}`}>
                        {n.href ? (
                          <Link href={n.href} onClick={() => handleClick(n)}>
                            {Body}
                          </Link>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleClick(n)}
                            className="block w-full text-left"
                          >
                            {Body}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}
