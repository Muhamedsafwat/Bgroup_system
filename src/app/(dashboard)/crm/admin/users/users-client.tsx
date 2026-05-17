"use client";

import { useState } from "react";
import { useLocale } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createUser, updateUser } from "../actions";
import type { CrmRole } from "@/types";

type UserItem = {
  id: string;
  fullName: string;
  fullNameAr: string | null;
  email: string;
  role: CrmRole;
  entityId: string | null;
  monthlyTargetEGP: unknown;
  managerId?: string | null;
  manager?: { id: string; fullName: string } | null;
  active: boolean;
  entity: {
    id: string;
    code: string;
    nameEn: string;
    nameAr: string;
    color: string;
  } | null;
};

type EntityItem = {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  color: string;
  active: boolean;
};

const ROLES: CrmRole[] = ["ADMIN", "MANAGER", "ASSISTANT", "REP", "ACCOUNT_MGR"];

export function UsersClient({
  users,
  entities,
}: {
  users: UserItem[];
  entities: EntityItem[];
}) {
  const { t, locale } = useLocale();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<UserItem | null>(null);
  const [saving, setSaving] = useState(false);

  const [fullName, setFullName] = useState("");
  const [fullNameAr, setFullNameAr] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<CrmRole>("REP");
  const [entityId, setEntityId] = useState("");
  const [monthlyTarget, setMonthlyTarget] = useState("");
  const [managerId, setManagerId] = useState("");
  // When editing a MANAGER user we let the admin pick which reps report to
  // them right here — that's the inverse of the per-rep "Reports to" field
  // and is how teams actually get composed in practice (one manager session
  // → tick the 6 reps that work for them).
  const [teamMemberIds, setTeamMemberIds] = useState<Set<string>>(new Set());

  const roleLabels = t.roles as Record<string, string>;

  function openCreate() {
    setEditing(null);
    setFullName("");
    setFullNameAr("");
    setEmail("");
    setPassword("");
    setRole("REP");
    setEntityId("");
    setMonthlyTarget("");
    setManagerId("");
    setTeamMemberIds(new Set());
    setOpen(true);
  }

  function openEdit(user: UserItem) {
    setEditing(user);
    setFullName(user.fullName);
    setFullNameAr(user.fullNameAr ?? "");
    setEmail(user.email);
    setPassword(""); // never prefill — leaving it blank means "don't change"
    setRole(user.role);
    setEntityId(user.entityId ?? "");
    setMonthlyTarget(user.monthlyTargetEGP ? String(Number(user.monthlyTargetEGP)) : "");
    setManagerId(user.managerId ?? "");
    // Seed the team-members picker with the reps already pointing at this
    // manager. The seed only matters when editing — creating a manager
    // wouldn't have any reports yet (and the user record doesn't exist
    // until save, so there's nothing for reps to point at).
    setTeamMemberIds(
      new Set(
        users
          .filter((u) => u.managerId === user.id)
          .map((u) => u.id)
      )
    );
    setOpen(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      if (editing) {
        await updateUser(editing.id, {
          fullName,
          fullNameAr: fullNameAr || undefined,
          email,
          // Only send password if the admin entered one — empty means
          // "don't change it" so we don't accidentally wipe their login.
          ...(password ? { password } : {}),
          role,
          entityId: entityId || null,
          monthlyTargetEGP: monthlyTarget ? Number(monthlyTarget) : null,
          managerId: managerId || null,
        });
        // When we're editing a manager, sync team membership by patching
        // each rep's `managerId`. Compare against the seed set:
        //   - ticked + wasn't on team before → set managerId = this user
        //   - was on team but unticked       → clear their managerId
        if (role === "MANAGER" || role === "ADMIN") {
          const previousTeam = new Set(
            users.filter((u) => u.managerId === editing.id).map((u) => u.id)
          );
          const additions = Array.from(teamMemberIds).filter((id) => !previousTeam.has(id));
          const removals = Array.from(previousTeam).filter((id) => !teamMemberIds.has(id));
          await Promise.all([
            ...additions.map((repId) => updateUser(repId, { managerId: editing.id })),
            ...removals.map((repId) => updateUser(repId, { managerId: null })),
          ]);
        }
      } else {
        await createUser({
          fullName,
          fullNameAr: fullNameAr || undefined,
          email,
          // For new users, password is required so they can actually sign in.
          password: password || "password123",
          role,
          entityId: entityId || undefined,
          monthlyTargetEGP: monthlyTarget ? Number(monthlyTarget) : undefined,
          managerId: managerId || undefined,
        });
      }
      setOpen(false);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(user: UserItem) {
    await updateUser(user.id, { active: !user.active });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t.nav.users}</h1>
        <Button onClick={openCreate}>{t.common.create}</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.common.name}</TableHead>
                  <TableHead>{t.common.email}</TableHead>
                  <TableHead>{locale === "ar" ? "الدور" : "CrmRole"}</TableHead>
                  <TableHead>{t.forms.entity}</TableHead>
                  <TableHead>{locale === "ar" ? "الهدف الشهري" : "Monthly Target"}</TableHead>
                  <TableHead>{t.common.status}</TableHead>
                  <TableHead>{t.common.actions}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">
                      {locale === "ar" && user.fullNameAr
                        ? user.fullNameAr
                        : user.fullName}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {user.email}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {roleLabels[user.role] ?? user.role}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {user.entity ? (
                        <Badge
                          style={{ backgroundColor: user.entity.color, color: "#fff" }}
                        >
                          {locale === "ar"
                            ? user.entity.nameAr
                            : user.entity.nameEn}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="ltr-nums">
                      {user.monthlyTargetEGP
                        ? Number(user.monthlyTargetEGP).toLocaleString(undefined, {
                            minimumFractionDigits: 0,
                            maximumFractionDigits: 0,
                          })
                        : "-"}
                    </TableCell>
                    <TableCell>
                      {user.active ? (
                        <Badge variant="default" className="bg-emerald-600">
                          {t.common.active}
                        </Badge>
                      ) : (
                        <Badge variant="secondary">{t.common.inactive}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEdit(user)}
                        >
                          {t.common.edit}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleActive(user)}
                        >
                          {user.active ? t.common.inactive : t.common.active}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editing ? t.common.edit : t.common.create} {t.nav.users}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">
                {t.common.name} (EN)
              </label>
              <Input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Full Name"
              />
            </div>
            <div>
              <label className="text-sm font-medium">
                {t.common.name} (AR)
              </label>
              <Input
                value={fullNameAr}
                onChange={(e) => setFullNameAr(e.target.value)}
                placeholder="الاسم الكامل"
                dir="rtl"
              />
            </div>
            <div>
              <label className="text-sm font-medium">{t.common.email}</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@example.com"
              />
            </div>
            <div>
              <label className="text-sm font-medium">
                {locale === "ar" ? "كلمة المرور" : "Password"}{" "}
                <span className="text-xs text-muted-foreground font-normal">
                  {editing
                    ? locale === "ar"
                      ? "(اتركه فارغًا للإبقاء عليه)"
                      : "(leave blank to keep current)"
                    : locale === "ar"
                      ? "(افتراضي: password123)"
                      : "(default: password123)"}
                </span>
              </label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={editing ? "•••••••• (unchanged)" : "password123"}
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className="text-sm font-medium">
                {locale === "ar" ? "الدور" : "CrmRole"}
              </label>
              <Select value={role} onValueChange={(v) => setRole(v as CrmRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {roleLabels[r] ?? r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">{t.forms.entity}</label>
              {/* Radix Select can't use empty-string as a value, and its
                  SelectValue falls back to the raw `value` (a cuid here) when
                  no matching item has been rendered. We use "NONE" as the
                  empty sentinel and render the resolved entity label
                  explicitly in SelectValue so the trigger always shows the
                  display name instead of the id. */}
              <Select
                value={entityId || "NONE"}
                onValueChange={(v) => setEntityId(v === "NONE" ? "" : (v ?? ""))}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t.forms.selectEntity}>
                    {(() => {
                      if (!entityId) return locale === "ar" ? "— لا يوجد —" : "— None —";
                      const e = entities.find((x) => x.id === entityId);
                      if (!e) return locale === "ar" ? "— لا يوجد —" : "— None —";
                      return `${locale === "ar" ? e.nameAr : e.nameEn} (${e.code})`;
                    })()}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">{locale === "ar" ? "— لا يوجد —" : "— None —"}</SelectItem>
                  {entities
                    .filter((e) => e.active)
                    .map((entity) => (
                      <SelectItem key={entity.id} value={entity.id}>
                        {locale === "ar" ? entity.nameAr : entity.nameEn} ({entity.code})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">
                {locale === "ar" ? "الهدف الشهري (ج.م)" : "Monthly Target (EGP)"}
              </label>
              <Input
                type="number"
                value={monthlyTarget}
                onChange={(e) => setMonthlyTarget(e.target.value)}
                placeholder="0"
              />
            </div>

            {/* Manager picker — only meaningful for REP and ACCOUNT_MGR. The
                "Manager" CRM role itself reports up, and ADMIN / ASSISTANT
                don't have a sales-manager in this hierarchy. */}
            {(role === "REP" || role === "ACCOUNT_MGR") && (
              <div>
                <label className="text-sm font-medium">
                  {locale === "ar" ? "المدير المسؤول" : "Reports to (Sales Manager)"}
                  <span className="text-xs text-muted-foreground font-normal ms-1">
                    {locale === "ar" ? "اختياري" : "(optional)"}
                  </span>
                </label>
                <Select
                  value={managerId || "NONE"}
                  onValueChange={(v) => setManagerId(v === "NONE" ? "" : (v ?? ""))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={locale === "ar" ? "اختر المدير" : "Pick a manager"}>
                      {(() => {
                        if (!managerId) return locale === "ar" ? "— لا يوجد —" : "— None —";
                        const m = users.find((u) => u.id === managerId);
                        return m ? m.fullName : locale === "ar" ? "— لا يوجد —" : "— None —";
                      })()}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">
                      {locale === "ar" ? "— لا يوجد —" : "— None —"}
                    </SelectItem>
                    {users
                      .filter(
                        (u) =>
                          u.active &&
                          u.id !== editing?.id && // can't be their own manager
                          (u.role === "MANAGER" || u.role === "ADMIN")
                      )
                      .map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.fullName} <span className="text-xs text-muted-foreground">· {u.role}</span>
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Team members picker — only when editing a MANAGER. This is
                the inverse of the "Reports to" field on a rep's record:
                tick everyone who works for this manager and we sync their
                managerId on save (additions + removals). New managers
                don't have a user id yet so the picker is hidden on create. */}
            {editing && (role === "MANAGER" || role === "ADMIN") && (
              <div className="space-y-2 pt-3 border-t">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">
                    {locale === "ar" ? "أعضاء الفريق" : "Team members"}
                  </label>
                  <span className="text-xs text-muted-foreground">
                    {teamMemberIds.size}{" "}
                    {locale === "ar" ? "مختار" : "selected"}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {locale === "ar"
                    ? "حدد المندوبين الذين يتبعون هذا المدير. سيرى هذا المدير فرص هؤلاء فقط في لوحة المبيعات."
                    : "Tick the reps that report to this manager. They become this manager's pipeline scope."}
                </p>
                <div className="max-h-48 overflow-y-auto rounded-md border divide-y">
                  {users.filter((u) => u.active && u.id !== editing.id && (u.role === "REP" || u.role === "ACCOUNT_MGR")).length === 0 ? (
                    <p className="px-3 py-2 text-xs text-muted-foreground">
                      {locale === "ar" ? "لا يوجد مندوبون" : "No reps to assign"}
                    </p>
                  ) : (
                    users
                      .filter(
                        (u) =>
                          u.active &&
                          u.id !== editing.id &&
                          (u.role === "REP" || u.role === "ACCOUNT_MGR")
                      )
                      .map((u) => {
                        const checked = teamMemberIds.has(u.id);
                        const otherManager = !checked && u.managerId && u.managerId !== editing.id;
                        return (
                          <label
                            key={u.id}
                            className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-accent"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                setTeamMemberIds((prev) => {
                                  const next = new Set(prev);
                                  if (e.target.checked) next.add(u.id);
                                  else next.delete(u.id);
                                  return next;
                                });
                              }}
                              className="h-4 w-4"
                            />
                            <span className="flex-1 min-w-0">
                              <span className="font-medium">{u.fullName}</span>
                              <span className="text-xs text-muted-foreground ms-2">· {u.role}</span>
                            </span>
                            {otherManager && (
                              <span className="text-[10px] text-amber-600 dark:text-amber-400">
                                {locale === "ar"
                                  ? "حالياً مع مدير آخر"
                                  : "currently on another team"}
                              </span>
                            )}
                          </label>
                        );
                      })
                  )}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                {t.common.cancel}
              </Button>
              <Button onClick={handleSave} disabled={saving || !fullName || !email}>
                {t.common.save}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
