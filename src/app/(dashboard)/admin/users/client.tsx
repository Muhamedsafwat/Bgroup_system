"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Search, Users, Briefcase, Handshake, ShieldCheck, Plus, KeyRound, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

type AdminUser = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  createdAt: string;
  modules: { hr: boolean; crm: boolean; partners: boolean };
  hr: {
    employee: {
      id: string;
      employeeId: string;
      fullNameEn: string;
      positionEn: string;
      status: string;
      baseSalary: string;
      currency: string;
      directManager: { id: string; fullNameEn: string } | null;
      company: { id: string; nameEn: string } | null;
    };
    roles: string[];
    isSuperuser: boolean;
  } | null;
  crm: { id: string; fullName: string; role: string } | null;
  partner: { id: string; companyName: string; commissionRate: number; isActive: boolean } | null;
};

type FilterKind = "all" | "employees" | "sales" | "partners" | "admins";

const KIND_LABEL: Record<FilterKind, string> = {
  all: "All",
  employees: "Employees",
  sales: "Sales reps",
  partners: "Partners",
  admins: "Admins",
};

function classifyKind(u: AdminUser): FilterKind[] {
  const out: FilterKind[] = ["all"];
  if (u.hr?.isSuperuser) out.push("admins");
  if (u.partner) out.push("partners");
  if (u.crm) out.push("sales");
  if (u.hr && !u.partner) out.push("employees");
  return out;
}

export function AdminUsersClient() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKind>("all");
  const [q, setQ] = useState("");
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch("/api/admin/users")
      .then((r) => (r.ok ? r.json() : { users: [] }))
      .then((d) => setUsers(d.users ?? []))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    return users.filter((u) => {
      if (filter !== "all" && !classifyKind(u).includes(filter)) return false;
      if (q.trim()) {
        const needle = q.trim().toLowerCase();
        const hay = [u.email, u.name, u.hr?.employee.fullNameEn, u.partner?.companyName, u.crm?.fullName]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [users, filter, q]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-xs flex-1 min-w-[220px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name / email / company..." className="ps-8 h-9" />
        </div>
        <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterKind)}>
          <TabsList>
            {(["all", "employees", "sales", "partners", "admins"] as FilterKind[]).map((k) => (
              <TabsTrigger key={k} value={k}>{KIND_LABEL[k]}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <span className="ms-2 text-xs text-muted-foreground">
          {filtered.length} of {users.length}
        </span>
        <Link
          href="/admin/users/new"
          className="ms-auto inline-flex items-center gap-1 rounded-md bg-primary text-primary-foreground px-3 h-9 text-sm font-medium hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          New user
        </Link>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-4 w-4 me-2 animate-spin" />
          Loading users...
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground border-b">
                  <tr>
                    <th className="text-start py-2 px-3 text-xs font-medium uppercase">User</th>
                    <th className="text-start py-2 px-3 text-xs font-medium uppercase">Modules</th>
                    <th className="text-start py-2 px-3 text-xs font-medium uppercase">HR profile</th>
                    <th className="text-start py-2 px-3 text-xs font-medium uppercase">CRM</th>
                    <th className="text-start py-2 px-3 text-xs font-medium uppercase">Partner</th>
                    <th className="text-end py-2 px-3 text-xs font-medium uppercase">Created</th>
                    <th className="text-end py-2 px-3 text-xs font-medium uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map((u) => (
                    <tr key={u.id} className="hover:bg-muted/30">
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2.5">
                          {u.hr?.isSuperuser ? (
                            <ShieldCheck className="h-4 w-4 text-rose-500 shrink-0" aria-label="Admin" />
                          ) : (
                            <Users className="h-4 w-4 text-muted-foreground shrink-0" />
                          )}
                          <div className="min-w-0">
                            <p className="font-medium text-foreground truncate">
                              {u.name ?? u.hr?.employee.fullNameEn ?? u.partner?.companyName ?? u.email}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex flex-wrap gap-1">
                          {u.modules.hr && <ModuleChip kind="hr" />}
                          {u.modules.crm && <ModuleChip kind="crm" />}
                          {u.modules.partners && <ModuleChip kind="partners" />}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        {u.hr ? (
                          <div className="text-xs">
                            <Link href={`/hr/employees/${u.hr.employee.id}`} className="text-foreground font-medium hover:underline">
                              {u.hr.employee.employeeId}
                            </Link>
                            <p className="text-muted-foreground truncate max-w-[14rem]">
                              {u.hr.employee.positionEn || "—"} · {u.hr.employee.company?.nameEn ?? "—"}
                            </p>
                            {u.hr.roles.length > 0 && (
                              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">
                                {u.hr.roles.join(" · ")}
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        {u.crm ? (
                          <span className="inline-flex items-center gap-1.5">
                            <Briefcase className="h-3.5 w-3.5 text-emerald-600" />
                            <span className="text-xs">{u.crm.role}</span>
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        {u.partner ? (
                          <div className="text-xs">
                            <span className="inline-flex items-center gap-1.5">
                              <Handshake className="h-3.5 w-3.5 text-amber-600" />
                              <span className="font-medium truncate max-w-[12rem]">{u.partner.companyName}</span>
                            </span>
                            <p className="text-muted-foreground mt-0.5">
                              {u.partner.commissionRate}% · {u.partner.isActive ? "Active" : "Inactive"}
                            </p>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-end text-xs text-muted-foreground ltr-nums">
                        {new Date(u.createdAt).toLocaleDateString()}
                      </td>
                      <td className="py-2.5 px-3 text-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => setResetTarget(u)}
                          title="Reset this user's password"
                        >
                          <KeyRound className="h-3.5 w-3.5 me-1" />
                          Reset password
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-sm text-muted-foreground">
                        No users match.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        Tip: a sales rep is just an employee with a CRM profile. Their commissions, bonuses, incidents, attendance, and
        payroll all live in their HR record — the CRM profile only adds the sales-specific role &amp; quota.
      </p>

      <ResetPasswordDialog
        user={resetTarget}
        onClose={() => setResetTarget(null)}
      />
    </div>
  );
}

/**
 * Admin-only password reset modal. Shows two ways to set a new password:
 *  - Type it explicitly (admin tells the user out-of-band)
 *  - Generate a random one (modal then shows it once so the admin can copy
 *    + share securely; we never persist plaintext anywhere ourselves).
 *
 * The "current password" field is intentionally absent — admins overriding
 * a forgotten password don't have it. Audit logging happens server-side.
 */
function ResetPasswordDialog({
  user,
  onClose,
}: {
  user: AdminUser | null;
  onClose: () => void;
}) {
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  function genRandom() {
    // 16-char URL-safe-ish password; avoids ambiguous chars (0/O/I/1).
    const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%";
    const arr = new Uint32Array(16);
    crypto.getRandomValues(arr);
    setPassword(Array.from(arr, (n) => alphabet[n % alphabet.length]).join(""));
  }

  async function submit() {
    if (!user) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Failed to reset password");
        return;
      }
      toast.success(`Password reset for ${user.email}`);
      setPassword("");
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={!!user}
      onOpenChange={(open) => {
        if (!open) {
          setPassword("");
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reset password</DialogTitle>
        </DialogHeader>
        {user && (
          <div className="space-y-4">
            <div className="rounded-md bg-muted/40 p-3 text-sm">
              <p className="font-medium">{user.name ?? user.email}</p>
              <p className="text-xs text-muted-foreground">{user.email}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reset-pw">New password</Label>
              <div className="flex gap-2">
                <Input
                  id="reset-pw"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                  className="font-mono"
                />
                <Button variant="outline" type="button" onClick={genRandom}>
                  Generate
                </Button>
                {password && (
                  <Button
                    variant="outline"
                    type="button"
                    title="Copy"
                    onClick={() => {
                      navigator.clipboard.writeText(password);
                      toast.success("Password copied");
                    }}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Share this with the user via a secure channel. Their old password
                stops working immediately and existing sessions stay valid until
                they sign out.
              </p>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={password.length < 8 || saving}>
            {saving ? "Resetting…" : "Reset password"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ModuleChip({ kind }: { kind: "hr" | "crm" | "partners" }) {
  const cls = {
    hr: "tile-indigo",
    crm: "tile-emerald",
    partners: "tile-amber",
  }[kind];
  return (
    <span className={cn("text-[10px] uppercase rounded px-1.5 py-0.5 font-medium", cls)}>
      {kind}
    </span>
  );
}
