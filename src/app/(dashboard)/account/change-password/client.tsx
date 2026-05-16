"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { AlertTriangle, Eye, EyeOff, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Mandatory-password-change form. Forced=true when the proxy bounced the
 * user here because `mustChangePassword` is set — in that mode we show a
 * stronger warning banner and disable the "Cancel" path entirely.
 */
export function ChangePasswordClient({
  forced,
  email,
  nextHref,
}: {
  forced: boolean;
  email: string;
  nextHref: string;
}) {
  const router = useRouter();
  const { update } = useSession();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [saving, setSaving] = useState(false);

  const tooShort = next.length > 0 && next.length < 8;
  const mismatch = confirm.length > 0 && next !== confirm;
  const canSubmit =
    current.length > 0 && next.length >= 8 && next === confirm && next !== current && !saving;

  async function submit() {
    setSaving(true);
    try {
      const res = await fetch("/api/account/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Failed to update password");
        return;
      }
      toast.success("Password updated");
      // Pull the fresh JWT so the proxy gate falls away on the next nav.
      await update?.();
      router.push(nextHref);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-muted-foreground" />
          {forced ? "Set a new password" : "Change password"}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Signed in as <span className="font-medium text-foreground">{email}</span>
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {forced && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 text-amber-900 dark:text-amber-200 text-sm border border-amber-500/30">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              Your password was set by an administrator. Please replace it with a
              private password before continuing. You won&apos;t be able to use the
              rest of the app until you do.
            </span>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="cp-cur">{forced ? "Temporary password" : "Current password"}</Label>
          <div className="relative">
            <Input
              id="cp-cur"
              type={showCurrent ? "text" : "password"}
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
              autoFocus
              className="pe-10"
            />
            <button
              type="button"
              onClick={() => setShowCurrent((s) => !s)}
              className="absolute end-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showCurrent ? "Hide" : "Show"}
              tabIndex={-1}
            >
              {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cp-new">New password</Label>
          <div className="relative">
            <Input
              id="cp-new"
              type={showNext ? "text" : "password"}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
              className="pe-10"
              aria-invalid={tooShort}
            />
            <button
              type="button"
              onClick={() => setShowNext((s) => !s)}
              className="absolute end-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showNext ? "Hide" : "Show"}
              tabIndex={-1}
            >
              {showNext ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {tooShort && <p className="text-xs text-destructive">At least 8 characters.</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cp-confirm">Confirm new password</Label>
          <Input
            id="cp-confirm"
            type={showNext ? "text" : "password"}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            aria-invalid={mismatch}
          />
          {mismatch && (
            <p className="text-xs text-destructive">The two passwords don&apos;t match.</p>
          )}
        </div>

        <div className="flex items-center justify-between pt-2">
          <Button
            variant="ghost"
            onClick={() => signOut({ callbackUrl: "/login" })}
            disabled={saving}
          >
            Sign out instead
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {saving ? "Updating…" : forced ? "Set password and continue" : "Update password"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
