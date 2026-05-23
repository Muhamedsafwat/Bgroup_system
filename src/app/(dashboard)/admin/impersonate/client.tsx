"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Loader2, UserCog, AlertTriangle, History } from "lucide-react";
import { toast } from "sonner";

type U = {
  id: string;
  email: string;
  name: string | null;
  hrAccess: boolean;
  crmAccess: boolean;
  partnersAccess: boolean;
};
type AuditRow = {
  id: string;
  adminUserId: string;
  targetUserId: string;
  event: string;
  reason: string | null;
  at: string;
};

export function ImpersonateClient({ users, recent }: { users: U[]; recent: AuditRow[] }) {
  const [filter, setFilter] = useState("");
  const [confirming, setConfirming] = useState<U | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const filtered = users.filter((u) => {
    const q = filter.trim().toLowerCase();
    if (!q) return true;
    return (
      u.email.toLowerCase().includes(q) ||
      (u.name && u.name.toLowerCase().includes(q))
    );
  });

  async function start() {
    if (!confirming) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: confirming.id,
          reason: reason.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Impersonation failed");
        return;
      }
      toast.success(`Now acting as ${confirming.email}`);
      setConfirming(null);
      setReason("");
      // Hard reload so the next request rebuilds the JWT and picks
      // up the impersonation row.
      setTimeout(() => window.location.assign("/"), 200);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <UserCog className="h-5 w-5" />
          Impersonate user
        </h1>
      </div>

      <Card className="border-amber-500/40 bg-amber-500/5">
        <CardContent className="py-3 flex items-start gap-2 text-sm">
          <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-600 shrink-0" />
          <span>
            Every action you take while impersonating is logged under{" "}
            <strong>your</strong> admin account, with the target user&apos;s
            id captured separately. Use only for debugging access issues
            or reproducing a rep&apos;s view — never to act on a user&apos;s
            behalf without their knowledge.
          </span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Pick a user</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="Search by name or email…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Modules</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.slice(0, 100).map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-mono text-xs">{u.email}</TableCell>
                  <TableCell>{u.name ?? "—"}</TableCell>
                  <TableCell className="flex gap-1">
                    {u.hrAccess && <Badge variant="outline" className="text-xs">HR</Badge>}
                    {u.crmAccess && <Badge variant="outline" className="text-xs">CRM</Badge>}
                    {u.partnersAccess && <Badge variant="outline" className="text-xs">Partners</Badge>}
                  </TableCell>
                  <TableCell>
                    <Button variant="outline" size="sm" onClick={() => setConfirming(u)}>
                      Act as
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                    No matches
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {filtered.length > 100 && (
            <p className="text-xs text-muted-foreground">
              Showing first 100 — narrow the search.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <History className="h-4 w-4" />
            Recent impersonations
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-2">
              No impersonations yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Admin id</TableHead>
                  <TableHead>Target id</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs ltr-nums">
                      {new Date(r.at).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.event === "start" ? "default" : "outline"}>
                        {r.event}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.adminUserId.slice(0, 12)}</TableCell>
                    <TableCell className="font-mono text-xs">{r.targetUserId.slice(0, 12)}</TableCell>
                    <TableCell className="text-xs">{r.reason ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!confirming} onOpenChange={(o) => !o && setConfirming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Act as {confirming?.email}?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              You&apos;ll see the app exactly as this user does until you
              click &quot;Return to admin&quot; on the banner. All your
              actions in their account are audit-logged under your admin
              user id.
            </p>
            <div>
              <Label className="text-xs">Reason (optional, audit trail)</Label>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reproducing permission bug #2410"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={start} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 me-1.5 animate-spin" />}
              Start impersonation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
