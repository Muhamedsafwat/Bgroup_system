"use client";

import { useSession } from "next-auth/react";
import { useState } from "react";
import { AlertTriangle, LogOut } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/**
 * Tier-1 #30 — impersonation banner. Renders sticky at the top of
 * every authenticated page when `session.user.actingAs` is set
 * (admin is currently impersonating someone). Clicking "Return"
 * hits the stop endpoint and reloads — the next request rebuilds
 * the JWT without the impersonation swap.
 */
export function ImpersonationBanner() {
  const { data: session, update: sessionUpdate } = useSession();
  const [busy, setBusy] = useState(false);
  const actingAs = session?.user?.actingAs;
  if (!actingAs) return null;

  async function stop() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/impersonate/stop", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Couldn't stop impersonation");
        return;
      }
      // Force NextAuth to re-issue the JWT NOW (trigger='update' in
      // the jwt callback), so the snap-back is immediate rather than
      // waiting up to 60s for the staleness window to expire.
      await sessionUpdate();
      // Hard reload so the entire app re-evaluates auth state from
      // scratch, avoiding stale client caches.
      setTimeout(() => window.location.reload(), 200);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sticky top-0 z-50 bg-amber-500/15 border-b border-amber-500/40 text-amber-900 dark:text-amber-200 text-sm">
      <div className="px-4 py-2 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span className="flex-1">
          You&apos;re acting as{" "}
          <strong>{session?.user?.name ?? session?.user?.email}</strong>.
          Every action is audit-logged under your admin account.
        </span>
        <Button size="sm" variant="outline" className="h-7" onClick={stop} disabled={busy}>
          <LogOut className="h-3.5 w-3.5 me-1.5" />
          Return to admin
        </Button>
      </div>
    </div>
  );
}
