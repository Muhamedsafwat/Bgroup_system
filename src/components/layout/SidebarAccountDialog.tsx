"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Camera, Eye, EyeOff, Loader2, ShieldCheck, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Unified profile dialog — the panel that opens when the user clicks the
 * bottom-left identity tile in the sidebar. Three tabs:
 *
 *   1. Profile — change photo (any user), display name + email (read-only
 *      since those are owned upstream: HR profile / signup).
 *   2. Password — current → new → confirm. Hits the same self-service endpoint
 *      as /account/security.
 *   3. Security — link to /account/security for 2FA enrolment + recovery
 *      codes (those flows are richer and live in their own page).
 */
export function SidebarAccountDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: session, update } = useSession();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [photo, setPhoto] = useState<string | null>(session?.user?.image ?? null);
  const [uploading, setUploading] = useState(false);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [savingPw, setSavingPw] = useState(false);

  async function handlePhotoPick(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("photo", file);
      const res = await fetch("/api/account/upload-photo", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Upload failed");
        return;
      }
      setPhoto(data.image);
      await update?.();
      toast.success("Photo updated");
    } finally {
      setUploading(false);
    }
  }

  function openFilePicker() {
    fileRef.current?.click();
  }

  async function changePassword() {
    if (next !== confirm) {
      toast.error("The two new passwords don't match");
      return;
    }
    if (next.length < 8) {
      toast.error("New password must be at least 8 characters");
      return;
    }
    setSavingPw(true);
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
      setCurrent("");
      setNext("");
      setConfirm("");
    } finally {
      setSavingPw(false);
    }
  }

  const user = session?.user;
  const initials = (user?.name ?? user?.email ?? "U").trim().charAt(0).toUpperCase();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>My account</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="profile" className="w-full">
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="profile">Profile</TabsTrigger>
            <TabsTrigger value="password">Password</TabsTrigger>
            <TabsTrigger value="security">Security</TabsTrigger>
          </TabsList>

          <TabsContent value="profile" className="space-y-4 pt-3">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="h-20 w-20 rounded-full bg-muted flex items-center justify-center overflow-hidden text-xl font-semibold">
                  {photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photo} alt="" className="h-full w-full object-cover" />
                  ) : (
                    initials
                  )}
                </div>
                <button
                  type="button"
                  onClick={openFilePicker}
                  disabled={uploading}
                  className="absolute bottom-0 end-0 h-7 w-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow hover:opacity-90"
                  title="Change photo"
                >
                  {uploading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Camera className="h-3.5 w-3.5" />
                  )}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handlePhotoPick(f);
                    e.target.value = "";
                  }}
                />
              </div>
              <div className="min-w-0">
                <p className="text-base font-semibold truncate">{user?.name ?? "—"}</p>
                <p className="text-sm text-muted-foreground truncate">{user?.email}</p>
              </div>
            </div>
            <div className="space-y-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Display name</Label>
                <Input value={user?.name ?? ""} readOnly className="bg-muted/30" />
                <p className="text-xs text-muted-foreground">
                  Name comes from your HR profile. To change it, ask HR or update it under{" "}
                  <Link href="/hr/employee/profile" className="text-primary hover:underline">
                    My Profile
                  </Link>
                  .
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Email</Label>
                <Input value={user?.email ?? ""} readOnly className="bg-muted/30" />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="password" className="space-y-3 pt-3">
            <div className="space-y-1.5">
              <Label htmlFor="acct-cur-pw">Current password</Label>
              <div className="relative">
                <Input
                  id="acct-cur-pw"
                  type={showCurrent ? "text" : "password"}
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  autoComplete="current-password"
                  className="pe-10"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrent((s) => !s)}
                  className="absolute end-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Toggle"
                  tabIndex={-1}
                >
                  {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="acct-new-pw">New password</Label>
              <div className="relative">
                <Input
                  id="acct-new-pw"
                  type={showNext ? "text" : "password"}
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  autoComplete="new-password"
                  className="pe-10"
                />
                <button
                  type="button"
                  onClick={() => setShowNext((s) => !s)}
                  className="absolute end-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Toggle"
                  tabIndex={-1}
                >
                  {showNext ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="acct-confirm-pw">Confirm new password</Label>
              <Input
                id="acct-confirm-pw"
                type={showNext ? "text" : "password"}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="flex justify-end pt-1">
              <Button
                onClick={changePassword}
                disabled={
                  savingPw ||
                  !current ||
                  next.length < 8 ||
                  next !== confirm ||
                  next === current
                }
              >
                {savingPw ? "Updating…" : "Update password"}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="security" className="space-y-3 pt-3">
            <div className="rounded-lg border border-border bg-muted/30 p-4 flex items-start gap-3">
              <ShieldCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400 mt-0.5" />
              <div className="space-y-1 flex-1">
                <p className="font-semibold">Two-factor authentication</p>
                <p className="text-sm text-muted-foreground">
                  Manage authenticator apps, recovery codes, and the org-wide MFA policy.
                </p>
              </div>
            </div>
            <Link href="/account/security" className="inline-block">
              <Button variant="outline">
                Open security settings
                <ExternalLink className="h-4 w-4 ms-1.5" />
              </Button>
            </Link>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
