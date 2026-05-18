"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Search, Users, Briefcase, Handshake, ShieldCheck, Plus, KeyRound, Copy, Layers, Pencil } from "lucide-react";
import { useLocale } from "@/lib/i18n";
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
      level: string | null;
      employmentType: string | null;
      workModel: string | null;
      status: string;
      baseSalary: string;
      currency: string;
      directManager: { id: string; fullNameEn: string } | null;
      company: { id: string; nameEn: string } | null;
      department: { id: string; nameEn: string } | null;
    };
    roles: string[];
    isSuperuser: boolean;
  } | null;
  crm: {
    id: string;
    fullName: string;
    role: string;
    entityId: string | null;
    monthlyTargetEGP: string | null;
    managerId: string | null;
    active: boolean;
  } | null;
  partner: {
    id: string;
    companyName: string;
    contactPhone: string | null;
    commissionRate: number;
    isActive: boolean;
  } | null;
};

type FilterKind = "all" | "employees" | "sales" | "partners" | "admins";

// Defined at module scope as a fallback if a stale render hits before
// `useLocale()` resolves. The real labels come from the per-render map
// inside AdminUsersClient so they swap on locale toggle.
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
  const [grantTarget, setGrantTarget] = useState<AdminUser | null>(null);
  const [editTarget, setEditTarget] = useState<AdminUser | null>(null);
  const { t, locale } = useLocale();

  // Per-render label map so the tab labels swap when the toggle flips.
  const kindLabel: Record<FilterKind, string> = {
    all: locale === "ar" ? "الكل" : "All",
    employees: locale === "ar" ? "الموظفون" : "Employees",
    sales: locale === "ar" ? "مندوبو المبيعات" : "Sales reps",
    partners: locale === "ar" ? "الشركاء" : "Partners",
    admins: locale === "ar" ? "المسؤولون" : "Admins",
  };
  void KIND_LABEL; // module-scope fallback retained for type-stability

  // After an edit lands we want fresh state without forcing the admin to
  // hard-refresh. Same pattern as the grant-module flow above.
  function reloadUsers() {
    setLoading(true);
    fetch("/api/admin/users")
      .then((r) => r.json())
      .then((data: { users: AdminUser[] }) => setUsers(data.users))
      .finally(() => setLoading(false));
  }

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
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={locale === "ar" ? "ابحث بالاسم / البريد / الشركة..." : "Search name / email / company..."} className="ps-8 h-9" />
        </div>
        <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterKind)}>
          <TabsList>
            {(["all", "employees", "sales", "partners", "admins"] as FilterKind[]).map((k) => (
              <TabsTrigger key={k} value={k}>{kindLabel[k]}</TabsTrigger>
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
          {locale === "ar" ? "مستخدم جديد" : "New user"}
        </Link>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-4 w-4 me-2 animate-spin" />
          {t.common.loading}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground border-b">
                  <tr>
                    <th className="text-start py-2 px-3 text-xs font-medium uppercase">{locale === "ar" ? "المستخدم" : "User"}</th>
                    <th className="text-start py-2 px-3 text-xs font-medium uppercase">{locale === "ar" ? "الوحدات" : "Modules"}</th>
                    <th className="text-start py-2 px-3 text-xs font-medium uppercase">{locale === "ar" ? "ملف الموارد البشرية" : "HR profile"}</th>
                    <th className="text-start py-2 px-3 text-xs font-medium uppercase">{locale === "ar" ? "CRM" : "CRM"}</th>
                    <th className="text-start py-2 px-3 text-xs font-medium uppercase">{locale === "ar" ? "شريك" : "Partner"}</th>
                    <th className="text-end py-2 px-3 text-xs font-medium uppercase">{locale === "ar" ? "تاريخ الإنشاء" : "Created"}</th>
                    <th className="text-end py-2 px-3 text-xs font-medium uppercase">{t.common.actions}</th>
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
                        <div className="inline-flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => setEditTarget(u)}
                            title={locale === "ar" ? "تعديل الاسم والدور والهدف والفريق" : "Edit name, role, target, and team"}
                          >
                            <Pencil className="h-3.5 w-3.5 me-1" />
                            {t.common.edit}
                          </Button>
                          {/* Only show "Add module" when the user is missing
                              at least one — once they have all three there's
                              nothing to grant. */}
                          {(!u.modules.hr || !u.modules.crm || !u.modules.partners) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => setGrantTarget(u)}
                              title={locale === "ar" ? "إضافة وحدة أخرى لهذا المستخدم" : "Grant another module to this user"}
                            >
                              <Layers className="h-3.5 w-3.5 me-1" />
                              {locale === "ar" ? "إضافة وحدة" : "Add module"}
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => setResetTarget(u)}
                            title={locale === "ar" ? "إعادة تعيين كلمة مرور المستخدم" : "Reset this user's password"}
                          >
                            <KeyRound className="h-3.5 w-3.5 me-1" />
                            {locale === "ar" ? "إعادة تعيين كلمة المرور" : "Reset password"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-sm text-muted-foreground">
                        {locale === "ar" ? "لا يوجد مستخدمون مطابقون." : "No users match."}
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
      <GrantModuleDialog
        user={grantTarget}
        onClose={() => setGrantTarget(null)}
        onGranted={() => {
          setGrantTarget(null);
          reloadUsers();
        }}
      />
      <EditUserDialog
        user={editTarget}
        onClose={() => setEditTarget(null)}
        onSaved={() => {
          setEditTarget(null);
          reloadUsers();
        }}
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

/**
 * Grant-module dialog. Lets the admin add HR, CRM, or Partners access to a
 * user who already exists. Shows one tab per module the user is missing —
 * existing modules are filtered out so the admin can't double-grant.
 *
 * Each tab carries the minimum fields required to spin up that module's
 * profile (mirrors the create-user endpoint's schema). The submit POSTs to
 * `/api/admin/users/[id]/modules` which handles the transaction.
 */
function GrantModuleDialog({
  user,
  onClose,
  onGranted,
}: {
  user: AdminUser | null;
  onClose: () => void;
  onGranted: () => void;
}) {
  // Which modules are still grantable for this user. Filtering this list
  // means an HR-only user opens straight to a tab they can actually use
  // (CRM or Partners), no clicks wasted on disabled tabs.
  const grantable: ("hr" | "crm" | "partners")[] = [];
  if (user && !user.modules.hr) grantable.push("hr");
  if (user && !user.modules.crm) grantable.push("crm");
  if (user && !user.modules.partners) grantable.push("partners");

  const [activeTab, setActiveTab] = useState<"hr" | "crm" | "partners">(
    grantable[0] ?? "crm"
  );
  const [saving, setSaving] = useState(false);

  // HR fields (mostly identical to /admin/users/new HR section)
  const [hrEmployeeId, setHrEmployeeId] = useState("");
  const [hrNameEn, setHrNameEn] = useState("");
  const [hrNameAr, setHrNameAr] = useState("");
  const [hrNationalId, setHrNationalId] = useState("");
  const [hrGender, setHrGender] = useState<"male" | "female">("male");
  const [hrPosition, setHrPosition] = useState("");
  const [hrCompanyId, setHrCompanyId] = useState("");
  const [hrCompanies, setHrCompanies] = useState<{ id: string; nameEn: string }[]>([]);

  // CRM fields
  const [crmFullName, setCrmFullName] = useState("");
  const [crmRole, setCrmRole] = useState<"REP" | "MANAGER" | "ASSISTANT" | "ACCOUNT_MGR" | "ADMIN">("REP");
  const [crmEntityId, setCrmEntityId] = useState("");
  const [crmTarget, setCrmTarget] = useState("");
  const [crmManagerId, setCrmManagerId] = useState("");
  const [crmEntities, setCrmEntities] = useState<{ id: string; nameEn: string }[]>([]);
  const [crmManagers, setCrmManagers] = useState<{ id: string; fullName: string }[]>([]);

  // Partners fields
  const [partnerCompany, setPartnerCompany] = useState("");
  const [partnerPhone, setPartnerPhone] = useState("");
  const [partnerRate, setPartnerRate] = useState("10");

  // Seed defaults from the user when the dialog opens — the admin shouldn't
  // re-type the name three times across tabs.
  useEffect(() => {
    if (!user) return;
    setActiveTab(grantable[0] ?? "crm");
    const displayName = user.name ?? user.email.split("@")[0];
    setHrNameEn(displayName);
    setHrNameAr(displayName);
    setCrmFullName(displayName);
    setPartnerCompany(displayName);
    // Load picker options lazily when the modal opens.
    fetch("/api/hr/companies")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        const list = Array.isArray(data) ? data : data.companies ?? data.data ?? [];
        setHrCompanies(list.map((c: { id: string; nameEn: string }) => ({ id: c.id, nameEn: c.nameEn })));
      })
      .catch(() => setHrCompanies([]));
    fetch("/api/crm/admin/entities")
      .then((r) => (r.ok ? r.json() : { entities: [] }))
      .then((data) => {
        const list = Array.isArray(data) ? data : data.entities ?? data.data ?? [];
        setCrmEntities(list.map((e: { id: string; nameEn: string }) => ({ id: e.id, nameEn: e.nameEn })));
      })
      .catch(() => setCrmEntities([]));
    fetch("/api/crm/admin/users")
      .then((r) => (r.ok ? r.json() : { users: [] }))
      .then((data) => {
        const list: Array<{ id: string; fullName: string; role: string }> =
          Array.isArray(data) ? data : data.users ?? data.data ?? [];
        setCrmManagers(
          list
            .filter((m) => m.role === "MANAGER" || m.role === "ADMIN")
            .map((m) => ({ id: m.id, fullName: m.fullName }))
        );
      })
      .catch(() => setCrmManagers([]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function submit() {
    if (!user) return;
    const body: Record<string, unknown> = {};
    if (activeTab === "hr") {
      if (!hrEmployeeId || !hrNameEn || !hrNameAr || !hrNationalId || !hrCompanyId) {
        toast.error("Employee ID, name (EN+AR), national ID and company are required");
        return;
      }
      body.hr = {
        employeeId: hrEmployeeId.trim(),
        fullNameEn: hrNameEn.trim(),
        fullNameAr: hrNameAr.trim(),
        nationalId: hrNationalId.trim(),
        gender: hrGender,
        positionEn: hrPosition.trim() || undefined,
        companyId: hrCompanyId,
      };
    } else if (activeTab === "crm") {
      if (!crmFullName) {
        toast.error("Full name is required");
        return;
      }
      body.crm = {
        fullName: crmFullName.trim(),
        role: crmRole,
        entityId: crmEntityId || undefined,
        monthlyTargetEGP: crmTarget ? Number(crmTarget) : undefined,
        managerId: crmManagerId || undefined,
      };
    } else if (activeTab === "partners") {
      if (!partnerCompany) {
        toast.error("Partner company name is required");
        return;
      }
      body.partner = {
        companyName: partnerCompany.trim(),
        contactPhone: partnerPhone.trim() || undefined,
        commissionRate: partnerRate ? Number(partnerRate) : undefined,
      };
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/modules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Failed to add module");
        return;
      }
      toast.success(`Granted ${activeTab.toUpperCase()} to ${user.email}`);
      onGranted();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={!!user}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add module access</DialogTitle>
        </DialogHeader>
        {user && (
          <div className="space-y-4">
            <div className="rounded-md bg-muted/40 p-3 text-sm">
              <p className="font-medium">{user.name ?? user.email}</p>
              <p className="text-xs text-muted-foreground">{user.email}</p>
              <div className="flex flex-wrap gap-1 mt-1.5">
                {user.modules.hr && <ModuleChip kind="hr" />}
                {user.modules.crm && <ModuleChip kind="crm" />}
                {user.modules.partners && <ModuleChip kind="partners" />}
              </div>
            </div>

            {grantable.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                This user already has every module. Nothing to grant.
              </p>
            ) : (
              <>
                <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
                  <TabsList className="grid grid-cols-3 w-full">
                    {grantable.includes("hr") && <TabsTrigger value="hr">HR</TabsTrigger>}
                    {grantable.includes("crm") && <TabsTrigger value="crm">CRM</TabsTrigger>}
                    {grantable.includes("partners") && <TabsTrigger value="partners">Partners</TabsTrigger>}
                  </TabsList>
                </Tabs>

                {activeTab === "hr" && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Employee ID *</Label>
                        <Input value={hrEmployeeId} onChange={(e) => setHrEmployeeId(e.target.value)} placeholder="EMP-001" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">National ID *</Label>
                        <Input value={hrNationalId} onChange={(e) => setHrNationalId(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Name (EN) *</Label>
                        <Input value={hrNameEn} onChange={(e) => setHrNameEn(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Name (AR) *</Label>
                        <Input value={hrNameAr} onChange={(e) => setHrNameAr(e.target.value)} dir="rtl" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Position</Label>
                        <Input value={hrPosition} onChange={(e) => setHrPosition(e.target.value)} placeholder="e.g. Sales Engineer" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Gender *</Label>
                        <select
                          value={hrGender}
                          onChange={(e) => setHrGender(e.target.value as "male" | "female")}
                          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                        >
                          <option value="male">Male</option>
                          <option value="female">Female</option>
                        </select>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Company *</Label>
                      <select
                        value={hrCompanyId}
                        onChange={(e) => setHrCompanyId(e.target.value)}
                        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                      >
                        <option value="">— Select —</option>
                        {hrCompanies.map((c) => (
                          <option key={c.id} value={c.id}>{c.nameEn}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {activeTab === "crm" && (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Full name *</Label>
                      <Input value={crmFullName} onChange={(e) => setCrmFullName(e.target.value)} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">CRM role *</Label>
                        <select
                          value={crmRole}
                          onChange={(e) => setCrmRole(e.target.value as typeof crmRole)}
                          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                        >
                          <option value="REP">Sales rep</option>
                          <option value="ACCOUNT_MGR">Account manager</option>
                          <option value="ASSISTANT">Assistant</option>
                          <option value="MANAGER">Sales manager</option>
                          <option value="ADMIN">CRM admin</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Entity</Label>
                        <select
                          value={crmEntityId}
                          onChange={(e) => setCrmEntityId(e.target.value)}
                          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                        >
                          <option value="">— Select —</option>
                          {crmEntities.map((e) => (
                            <option key={e.id} value={e.id}>{e.nameEn}</option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Monthly target (EGP)</Label>
                        <Input type="number" value={crmTarget} onChange={(e) => setCrmTarget(e.target.value)} placeholder="50000" />
                      </div>
                      {(crmRole === "REP" || crmRole === "ACCOUNT_MGR") && (
                        <div className="space-y-1">
                          <Label className="text-xs">Reports to</Label>
                          <select
                            value={crmManagerId}
                            onChange={(e) => setCrmManagerId(e.target.value)}
                            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                          >
                            <option value="">— None —</option>
                            {crmManagers.map((m) => (
                              <option key={m.id} value={m.id}>{m.fullName}</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {activeTab === "partners" && (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Partner company *</Label>
                      <Input value={partnerCompany} onChange={(e) => setPartnerCompany(e.target.value)} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Contact phone</Label>
                        <Input value={partnerPhone} onChange={(e) => setPartnerPhone(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Commission rate (%)</Label>
                        <Input type="number" value={partnerRate} onChange={(e) => setPartnerRate(e.target.value)} min={0} max={100} />
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          {grantable.length > 0 && (
            <Button onClick={submit} disabled={saving}>
              {saving ? "Granting…" : `Grant ${activeTab.toUpperCase()}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Edit-user dialog. Renders one tab per module the user already has plus a
 * "Basic" tab for user.name. Each tab posts the same PATCH endpoint with the
 * fields the admin actually changed — empty tabs send nothing for that block.
 *
 * For MANAGER/ADMIN CRM users a "Team members" multi-select appears, seeded
 * from this manager's `CrmTeamMembership` rows. A rep can be on multiple
 * managers' teams, so toggling a rep on/off only affects THIS manager's
 * membership row — other managers' relationships with the same rep are
 * untouched. The PATCH endpoint syncs the join table from `crm.teamMemberIds`.
 */
function EditUserDialog({
  user,
  onClose,
  onSaved,
}: {
  user: AdminUser | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const tabs: ("basic" | "hr" | "crm" | "partners")[] = ["basic"];
  if (user?.hr) tabs.push("hr");
  if (user?.crm) tabs.push("crm");
  if (user?.partner) tabs.push("partners");

  const [activeTab, setActiveTab] = useState<"basic" | "hr" | "crm" | "partners">("basic");
  const [saving, setSaving] = useState(false);

  // Basic
  const [name, setName] = useState("");

  // HR
  const [hrPosition, setHrPosition] = useState("");
  const [hrLevel, setHrLevel] = useState("");
  const [hrBaseSalary, setHrBaseSalary] = useState("");
  const [hrCurrency, setHrCurrency] = useState("EGP");
  const [hrManagerId, setHrManagerId] = useState("");
  const [hrManagers, setHrManagers] = useState<{ id: string; fullNameEn: string }[]>([]);

  // CRM
  const [crmFullName, setCrmFullName] = useState("");
  const [crmRole, setCrmRole] = useState<string>("REP");
  const [crmTarget, setCrmTarget] = useState("");
  const [crmManagerId, setCrmManagerId] = useState("");
  const [crmActive, setCrmActive] = useState(true);
  const [crmManagers, setCrmManagers] = useState<{ id: string; fullName: string; role: string; managerId: string | null; managedByIds: string[] }[]>([]);
  const [crmReps, setCrmReps] = useState<{ id: string; fullName: string; role: string; managerId: string | null; managedByIds: string[] }[]>([]);
  const [teamMemberIds, setTeamMemberIds] = useState<Set<string>>(new Set());

  // Partner
  const [partnerCompany, setPartnerCompany] = useState("");
  const [partnerPhone, setPartnerPhone] = useState("");
  const [partnerRate, setPartnerRate] = useState("");
  const [partnerActive, setPartnerActive] = useState(true);

  // Seed everything when the dialog opens. Re-runs on user change.
  useEffect(() => {
    if (!user) return;
    setActiveTab("basic");
    setName(user.name ?? "");

    if (user.hr) {
      setHrPosition(user.hr.employee.positionEn ?? "");
      setHrLevel(user.hr.employee.level ?? "");
      setHrBaseSalary(String(user.hr.employee.baseSalary ?? ""));
      setHrCurrency(user.hr.employee.currency ?? "EGP");
      setHrManagerId(user.hr.employee.directManager?.id ?? "");
      // Pull HR managers for the picker (employees with at least one report
      // OR everyone — we keep it simple and offer all employees).
      fetch("/api/admin/employees")
        .then((r) => (r.ok ? r.json() : { employees: [] }))
        .then((d) => {
          const list = (d.employees ?? d ?? []) as Array<{ id: string; fullNameEn: string }>;
          setHrManagers(list);
        })
        .catch(() => setHrManagers([]));
    }

    if (user.crm) {
      setCrmFullName(user.crm.fullName);
      setCrmRole(user.crm.role);
      setCrmTarget(user.crm.monthlyTargetEGP ? String(user.crm.monthlyTargetEGP) : "");
      setCrmManagerId(user.crm.managerId ?? "");
      setCrmActive(user.crm.active);
      fetch("/api/crm/admin/users")
        .then((r) => (r.ok ? r.json() : { users: [] }))
        .then((data) => {
          const list: Array<{ id: string; fullName: string; role: string; managerId: string | null; managedByIds?: string[] }> =
            Array.isArray(data) ? data : data.users ?? data.data ?? [];
          const normalized = list.map((m) => ({ ...m, managedByIds: m.managedByIds ?? [] }));
          setCrmManagers(normalized.filter((m) => m.role === "MANAGER" || m.role === "ADMIN"));
          // Anyone who is REP/ACCOUNT_MGR/ASSISTANT can be a team member;
          // managers/admins shouldn't report to other managers from this UI.
          setCrmReps(normalized.filter((m) => m.role !== "MANAGER" && m.role !== "ADMIN"));
          // Pre-select reps that have THIS manager in their managedByIds.
          // A rep can be on multiple managers' teams; we only check the M2M
          // join here, the legacy single-FK managerId is no longer the source
          // of truth for team composition.
          if (user.crm) {
            const myId = user.crm.id;
            setTeamMemberIds(
              new Set(normalized.filter((m) => m.managedByIds.includes(myId)).map((m) => m.id))
            );
          }
        })
        .catch(() => {
          setCrmManagers([]);
          setCrmReps([]);
        });
    }

    if (user.partner) {
      setPartnerCompany(user.partner.companyName);
      setPartnerPhone(user.partner.contactPhone ?? "");
      setPartnerRate(String(user.partner.commissionRate));
      setPartnerActive(user.partner.isActive);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  function toggleTeamMember(repId: string) {
    setTeamMemberIds((cur) => {
      const next = new Set(cur);
      if (next.has(repId)) next.delete(repId);
      else next.add(repId);
      return next;
    });
  }

  async function submit() {
    if (!user) return;
    const body: Record<string, unknown> = {};

    // Basic — only send if it actually changed.
    if (name.trim() !== (user.name ?? "")) {
      body.name = name.trim() || null;
    }

    if (user.hr) {
      const hr: Record<string, unknown> = {};
      const emp = user.hr.employee;
      if (hrPosition !== (emp.positionEn ?? "")) hr.positionEn = hrPosition || null;
      if (hrLevel !== (emp.level ?? "")) hr.level = hrLevel || null;
      const newSalary = hrBaseSalary === "" ? undefined : Number(hrBaseSalary);
      if (newSalary !== undefined && newSalary !== Number(emp.baseSalary)) {
        hr.baseSalary = newSalary;
      }
      if (hrCurrency !== emp.currency) hr.currency = hrCurrency;
      const currentMgr = emp.directManager?.id ?? "";
      if (hrManagerId !== currentMgr) {
        hr.directManagerId = hrManagerId || null;
      }
      if (Object.keys(hr).length) body.hr = hr;
    }

    if (user.crm) {
      const crm: Record<string, unknown> = {};
      if (crmFullName !== user.crm.fullName) crm.fullName = crmFullName.trim();
      if (crmRole !== user.crm.role) crm.role = crmRole;
      const newTarget = crmTarget === "" ? null : Number(crmTarget);
      const oldTarget = user.crm.monthlyTargetEGP ? Number(user.crm.monthlyTargetEGP) : null;
      if (newTarget !== oldTarget) crm.monthlyTargetEGP = newTarget;
      const currentMgr = user.crm.managerId ?? "";
      if (crmManagerId !== currentMgr) crm.managerId = crmManagerId || null;
      if (crmActive !== user.crm.active) crm.active = crmActive;
      // Team members only meaningful for managers/admins. Diff against the
      // M2M join (managedByIds), not the legacy single-FK managerId.
      if (crmRole === "MANAGER" || crmRole === "ADMIN") {
        const myId = user.crm!.id;
        const currentReports = new Set(
          crmReps.filter((r) => r.managedByIds.includes(myId)).map((r) => r.id)
        );
        const next = teamMemberIds;
        const sameSet =
          next.size === currentReports.size &&
          [...next].every((id) => currentReports.has(id));
        if (!sameSet) crm.teamMemberIds = [...next];
      }
      if (Object.keys(crm).length) body.crm = crm;
    }

    if (user.partner) {
      const partner: Record<string, unknown> = {};
      if (partnerCompany !== user.partner.companyName) partner.companyName = partnerCompany.trim();
      if (partnerPhone !== (user.partner.contactPhone ?? "")) {
        partner.contactPhone = partnerPhone || null;
      }
      const newRate = partnerRate === "" ? undefined : Number(partnerRate);
      if (newRate !== undefined && newRate !== user.partner.commissionRate) {
        partner.commissionRate = newRate;
      }
      if (partnerActive !== user.partner.isActive) partner.isActive = partnerActive;
      if (Object.keys(partner).length) body.partner = partner;
    }

    if (Object.keys(body).length === 0) {
      toast.info("Nothing to save — no fields changed.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Failed to update user");
        return;
      }
      toast.success(`Updated ${user.email}`);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={!!user}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit user</DialogTitle>
        </DialogHeader>
        {user && (
          <div className="space-y-4">
            <div className="rounded-md bg-muted/40 p-3 text-sm">
              <p className="font-medium">{user.name ?? user.email}</p>
              <p className="text-xs text-muted-foreground">{user.email}</p>
              <div className="flex flex-wrap gap-1 mt-1.5">
                {user.modules.hr && <ModuleChip kind="hr" />}
                {user.modules.crm && <ModuleChip kind="crm" />}
                {user.modules.partners && <ModuleChip kind="partners" />}
              </div>
            </div>

            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
              {/* Tailwind can't see template-string classes, so map count → fixed class. */}
              <TabsList
                className={cn(
                  "grid w-full",
                  tabs.length === 1 && "grid-cols-1",
                  tabs.length === 2 && "grid-cols-2",
                  tabs.length === 3 && "grid-cols-3",
                  tabs.length === 4 && "grid-cols-4"
                )}
              >
                {tabs.includes("basic") && <TabsTrigger value="basic">Basic</TabsTrigger>}
                {tabs.includes("hr") && <TabsTrigger value="hr">HR</TabsTrigger>}
                {tabs.includes("crm") && <TabsTrigger value="crm">CRM</TabsTrigger>}
                {tabs.includes("partners") && <TabsTrigger value="partners">Partner</TabsTrigger>}
              </TabsList>
            </Tabs>

            {activeTab === "basic" && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs">Display name</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Email (read-only)</Label>
                  <Input value={user.email} disabled />
                  <p className="text-[11px] text-muted-foreground">
                    Email is the login identifier — change it from the database directly if absolutely needed.
                  </p>
                </div>
              </div>
            )}

            {activeTab === "hr" && user.hr && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Position</Label>
                    <Input value={hrPosition} onChange={(e) => setHrPosition(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Level</Label>
                    <Input value={hrLevel} onChange={(e) => setHrLevel(e.target.value)} placeholder="junior / mid / senior" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Base salary</Label>
                    <Input type="number" value={hrBaseSalary} onChange={(e) => setHrBaseSalary(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Currency</Label>
                    <Input value={hrCurrency} onChange={(e) => setHrCurrency(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Direct manager</Label>
                  <select
                    value={hrManagerId}
                    onChange={(e) => setHrManagerId(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="">— None —</option>
                    {hrManagers
                      .filter((m) => m.id !== user.hr!.employee.id)
                      .map((m) => (
                        <option key={m.id} value={m.id}>{m.fullNameEn}</option>
                      ))}
                  </select>
                </div>
              </div>
            )}

            {activeTab === "crm" && user.crm && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs">Full name (CRM)</Label>
                  <Input value={crmFullName} onChange={(e) => setCrmFullName(e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">CRM role</Label>
                    <select
                      value={crmRole}
                      onChange={(e) => setCrmRole(e.target.value)}
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    >
                      <option value="REP">Sales rep</option>
                      <option value="ACCOUNT_MGR">Account manager</option>
                      <option value="ASSISTANT">Assistant</option>
                      <option value="MANAGER">Sales manager</option>
                      <option value="ADMIN">CRM admin</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Monthly target (EGP)</Label>
                    <Input type="number" value={crmTarget} onChange={(e) => setCrmTarget(e.target.value)} placeholder="50000" />
                  </div>
                  {(crmRole === "REP" || crmRole === "ACCOUNT_MGR" || crmRole === "ASSISTANT") && (
                    <div className="space-y-1 col-span-2">
                      <Label className="text-xs">Reports to</Label>
                      <select
                        value={crmManagerId}
                        onChange={(e) => setCrmManagerId(e.target.value)}
                        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                      >
                        <option value="">— None —</option>
                        {crmManagers
                          .filter((m) => m.id !== user.crm!.id)
                          .map((m) => (
                            <option key={m.id} value={m.id}>{m.fullName}</option>
                          ))}
                      </select>
                    </div>
                  )}
                  <div className="space-y-1 col-span-2 flex items-center gap-2">
                    <input
                      id="crm-active"
                      type="checkbox"
                      checked={crmActive}
                      onChange={(e) => setCrmActive(e.target.checked)}
                      className="h-4 w-4"
                    />
                    <Label htmlFor="crm-active" className="text-xs">Active in CRM (uncheck to hide from owner pickers)</Label>
                  </div>
                </div>

                {(crmRole === "MANAGER" || crmRole === "ADMIN") && (
                  <div className="space-y-1">
                    <Label className="text-xs">Team members</Label>
                    <p className="text-[11px] text-muted-foreground">
                      Tick each rep that reports to this manager. A rep can be on multiple managers&apos; teams — toggling here only affects this manager&apos;s team.
                    </p>
                    <div className="rounded-md border max-h-48 overflow-y-auto divide-y">
                      {crmReps.length === 0 ? (
                        <p className="text-xs text-muted-foreground p-3">No reps available.</p>
                      ) : (
                        crmReps.map((r) => {
                          const otherManagerCount = r.managedByIds.filter(
                            (id) => id !== user.crm!.id
                          ).length;
                          return (
                            <label key={r.id} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted/40 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={teamMemberIds.has(r.id)}
                                onChange={() => toggleTeamMember(r.id)}
                                className="h-4 w-4"
                              />
                              <span className="flex-1 truncate">{r.fullName}</span>
                              <span className="text-[10px] uppercase text-muted-foreground">{r.role}</span>
                              {otherManagerCount > 0 && (
                                <span
                                  className="text-[10px] text-muted-foreground"
                                  title={`Also on ${otherManagerCount} other manager${otherManagerCount === 1 ? "'s" : "s'"} team`}
                                >
                                  +{otherManagerCount}
                                </span>
                              )}
                            </label>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === "partners" && user.partner && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs">Partner company</Label>
                  <Input value={partnerCompany} onChange={(e) => setPartnerCompany(e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Contact phone</Label>
                    <Input value={partnerPhone} onChange={(e) => setPartnerPhone(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Commission rate (%)</Label>
                    <Input type="number" value={partnerRate} onChange={(e) => setPartnerRate(e.target.value)} min={0} max={100} />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    id="partner-active"
                    type="checkbox"
                    checked={partnerActive}
                    onChange={(e) => setPartnerActive(e.target.checked)}
                    className="h-4 w-4"
                  />
                  <Label htmlFor="partner-active" className="text-xs">Active partner</Label>
                </div>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>
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
