"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, UserPlus, Briefcase, Handshake, Users as UsersIcon } from "lucide-react";
import { toast } from "sonner";

type Company = { id: string; nameEn: string };
type Dept = { id: string; nameEn: string; companyId: string };
type Manager = { id: string; fullNameEn: string; positionEn: string; companyId: string };
type Entity = { id: string; nameEn: string };

const CRM_ROLES = ["REP", "MANAGER", "ASSISTANT", "ACCOUNT_MGR", "ADMIN"];

export function NewUserForm({
  companies,
  departments,
  managers,
  crmEntities,
  hrRoles,
}: {
  companies: Company[];
  departments: Dept[];
  managers: Manager[];
  crmEntities: Entity[];
  hrRoles: string[];
}) {
  const router = useRouter();

  // Core
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  // Modules
  const [includeHr, setIncludeHr] = useState(true);
  const [includeCrm, setIncludeCrm] = useState(false);
  const [includePartner, setIncludePartner] = useState(false);

  // HR
  const [employeeId, setEmployeeId] = useState("");
  const [fullNameAr, setFullNameAr] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [gender, setGender] = useState<"male" | "female">("male");
  const [positionEn, setPositionEn] = useState("");
  const [companyId, setCompanyId] = useState<string>("");
  const [departmentId, setDepartmentId] = useState<string>("");
  const [directManagerId, setDirectManagerId] = useState<string>("NONE");
  const [baseSalary, setBaseSalary] = useState<number>(0);
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(new Set());

  // CRM
  const [crmFullName, setCrmFullName] = useState("");
  const [crmRole, setCrmRole] = useState("REP");
  const [crmEntityId, setCrmEntityId] = useState<string>("NONE");
  const [monthlyTargetEGP, setMonthlyTargetEGP] = useState<number>(0);

  // Partner
  const [partnerCompanyName, setPartnerCompanyName] = useState("");
  const [partnerContactPhone, setPartnerContactPhone] = useState("");
  const [commissionRate, setCommissionRate] = useState<number>(10);

  const [saving, setSaving] = useState(false);

  const filteredDepartments = useMemo(
    () => departments.filter((d) => !companyId || d.companyId === companyId),
    [departments, companyId]
  );
  const filteredManagers = useMemo(
    () => managers.filter((m) => !companyId || m.companyId === companyId),
    [managers, companyId]
  );

  function toggleRole(role: string) {
    setSelectedRoles((prev) => {
      const s = new Set(prev);
      if (s.has(role)) s.delete(role);
      else s.add(role);
      return s;
    });
  }

  async function submit() {
    if (!email.trim() || !password || !name.trim()) {
      toast.error("Email, password, and name are required");
      return;
    }
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    if (includeHr && (!employeeId.trim() || !fullNameAr.trim() || !nationalId.trim() || !companyId)) {
      toast.error("HR section: employee ID, Arabic name, national ID, and company are required");
      return;
    }
    if (includeCrm && !crmFullName.trim()) {
      toast.error("CRM section: full name is required");
      return;
    }
    if (includePartner && !partnerCompanyName.trim()) {
      toast.error("Partner section: company name is required");
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        email: email.trim(),
        password,
        name: name.trim(),
      };
      if (includeHr) {
        payload.hr = {
          employeeId: employeeId.trim(),
          fullNameEn: name.trim(),
          fullNameAr: fullNameAr.trim(),
          nationalId: nationalId.trim(),
          gender,
          positionEn: positionEn.trim() || undefined,
          companyId,
          departmentId: departmentId || undefined,
          directManagerId: directManagerId !== "NONE" ? directManagerId : undefined,
          baseSalary: baseSalary || undefined,
          currency: "EGP",
          roles: Array.from(selectedRoles),
        };
      }
      if (includeCrm) {
        payload.crm = {
          fullName: crmFullName.trim(),
          role: crmRole,
          entityId: crmEntityId !== "NONE" ? crmEntityId : undefined,
          monthlyTargetEGP: monthlyTargetEGP || undefined,
        };
      }
      if (includePartner) {
        payload.partner = {
          companyName: partnerCompanyName.trim(),
          contactPhone: partnerContactPhone.trim() || undefined,
          commissionRate,
        };
      }

      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Failed to create user");
        return;
      }
      toast.success("User created");
      router.push("/admin/users");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Core */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-primary" />
            Account
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <Label>Full name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sara Mahmoud" />
          </div>
          <div>
            <Label>Email *</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@bgroup.com" />
          </div>
          <div>
            <Label>Password *</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="min 8 chars" />
          </div>
        </CardContent>
      </Card>

      {/* Module toggles */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Modules</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-2 rounded-md border px-3 py-1.5 cursor-pointer hover:bg-muted/40">
              <Checkbox checked={includeHr} onCheckedChange={(v) => setIncludeHr(!!v)} />
              <UsersIcon className="h-4 w-4 text-indigo-600" />
              <span className="text-sm font-medium">HR employee</span>
            </label>
            <label className="flex items-center gap-2 rounded-md border px-3 py-1.5 cursor-pointer hover:bg-muted/40">
              <Checkbox checked={includeCrm} onCheckedChange={(v) => setIncludeCrm(!!v)} />
              <Briefcase className="h-4 w-4 text-emerald-600" />
              <span className="text-sm font-medium">Sales rep (CRM profile)</span>
            </label>
            <label className="flex items-center gap-2 rounded-md border px-3 py-1.5 cursor-pointer hover:bg-muted/40">
              <Checkbox checked={includePartner} onCheckedChange={(v) => setIncludePartner(!!v)} />
              <Handshake className="h-4 w-4 text-amber-600" />
              <span className="text-sm font-medium">Partner</span>
            </label>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Tick &ldquo;HR employee&rdquo; + &ldquo;Sales rep&rdquo; for a sales person — they get bonuses,
            incidents, overtime, payroll AND commissions.
          </p>
        </CardContent>
      </Card>

      {/* HR section */}
      {includeHr && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <UsersIcon className="h-4 w-4 text-indigo-600" />
              HR employee details
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label>Employee ID *</Label>
              <Input value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} placeholder="EMP-BF-019" />
            </div>
            <div>
              <Label>Full name (Arabic) *</Label>
              <Input value={fullNameAr} onChange={(e) => setFullNameAr(e.target.value)} placeholder="سارة محمود" />
            </div>
            <div>
              <Label>National ID *</Label>
              <Input value={nationalId} onChange={(e) => setNationalId(e.target.value)} />
            </div>
            <div>
              <Label>Gender</Label>
              <Select value={gender} onValueChange={(v) => setGender((v as "male" | "female") ?? "male")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <Label>Position</Label>
              <Input value={positionEn} onChange={(e) => setPositionEn(e.target.value)} placeholder="e.g. Senior Engineer" />
            </div>
            <div>
              <Label>Company *</Label>
              <Select value={companyId} onValueChange={(v) => { setCompanyId(v ?? ""); setDepartmentId(""); setDirectManagerId("NONE"); }}>
                <SelectTrigger>
                  <SelectValue placeholder="Select company">
                    {(v) => companies.find((c) => c.id === v)?.nameEn ?? "Select company"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.nameEn}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Department</Label>
              <Select value={departmentId} onValueChange={(v) => setDepartmentId(v ?? "")} disabled={!companyId}>
                <SelectTrigger>
                  <SelectValue placeholder={companyId ? "Select department" : "Pick company first"}>
                    {(v) => filteredDepartments.find((d) => d.id === v)?.nameEn ?? (companyId ? "Select department" : "Pick company first")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {filteredDepartments.map((d) => <SelectItem key={d.id} value={d.id}>{d.nameEn}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Direct manager <span className="text-xs text-muted-foreground">(org-chart auth)</span></Label>
              <Select value={directManagerId} onValueChange={(v) => setDirectManagerId(v ?? "NONE")} disabled={!companyId}>
                <SelectTrigger>
                  <SelectValue placeholder="Optional">
                    {(v) => {
                      if (v === "NONE" || !v) return "— No manager —";
                      const m = filteredManagers.find((x) => x.id === v);
                      return m ? `${m.fullNameEn}${m.positionEn ? ` · ${m.positionEn}` : ""}` : "Optional";
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">— No manager (top of tree) —</SelectItem>
                  {filteredManagers.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.fullNameEn} {m.positionEn ? `· ${m.positionEn}` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Base salary (EGP)</Label>
              <Input type="number" min={0} value={baseSalary} onChange={(e) => setBaseSalary(Number(e.target.value) || 0)} />
            </div>
            <div className="md:col-span-3">
              <Label className="mb-1.5 block">HR roles <span className="text-xs text-muted-foreground">(team-lead access is auto-derived from org chart — no flag needed)</span></Label>
              <div className="flex flex-wrap gap-2">
                {hrRoles.map((r) => (
                  <label key={r} className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 cursor-pointer text-xs hover:bg-muted/40">
                    <Checkbox checked={selectedRoles.has(r)} onCheckedChange={() => toggleRole(r)} />
                    <span>{r}</span>
                  </label>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* CRM section */}
      {includeCrm && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-emerald-600" />
              Sales rep details
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label>Display name *</Label>
              <Input value={crmFullName} onChange={(e) => setCrmFullName(e.target.value)} placeholder="As shown in the CRM" />
            </div>
            <div>
              <Label>CRM role</Label>
              <Select value={crmRole} onValueChange={(v) => setCrmRole(v ?? "REP")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CRM_ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Entity</Label>
              <Select value={crmEntityId} onValueChange={(v) => setCrmEntityId(v ?? "NONE")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">— No entity —</SelectItem>
                  {crmEntities.map((e) => <SelectItem key={e.id} value={e.id}>{e.nameEn}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Monthly target (EGP)</Label>
              <Input type="number" min={0} value={monthlyTargetEGP} onChange={(e) => setMonthlyTargetEGP(Number(e.target.value) || 0)} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Partner section */}
      {includePartner && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Handshake className="h-4 w-4 text-amber-600" />
              Partner details
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label>Company name *</Label>
              <Input value={partnerCompanyName} onChange={(e) => setPartnerCompanyName(e.target.value)} placeholder="ByteForce" />
            </div>
            <div>
              <Label>Contact phone</Label>
              <Input value={partnerContactPhone} onChange={(e) => setPartnerContactPhone(e.target.value)} placeholder="+201..." />
            </div>
            <div>
              <Label>Commission rate (%)</Label>
              <Input type="number" min={0} max={100} value={commissionRate} onChange={(e) => setCommissionRate(Number(e.target.value) || 0)} />
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.back()} disabled={saving}>Cancel</Button>
        <Button onClick={submit} disabled={saving}>
          <Save className="h-4 w-4 me-1.5" />
          {saving ? "Creating..." : "Create user"}
        </Button>
      </div>
    </div>
  );
}
