import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Users,
  Landmark,
  DollarSign,
  Layers,
  AlertCircle,
  Tag,
  Package,
  HeartPulse,
  Building2,
  Clock,
  Wallet,
  Briefcase,
  Settings,
  ShieldCheck,
  ArrowRight,
  Handshake,
  Target,
  Calendar,
} from "lucide-react";

export const dynamic = "force-dynamic";

const GROUPS: Array<{
  title: string;
  items: Array<{
    href: string;
    label: string;
    description: string;
    icon: typeof Users;
    tone: string;
  }>;
}> = [
  {
    title: "CRM",
    items: [
      { href: "/crm/admin/entities", label: "Entities", description: "Group subsidiaries", icon: Landmark, tone: "tile-violet" },
      { href: "/crm/admin/fx-rates", label: "FX rates", description: "Currency conversions", icon: DollarSign, tone: "tile-emerald" },
      { href: "/crm/admin/stage-config", label: "Pipeline stages", description: "Probabilities + SLAs", icon: Layers, tone: "tile-amber" },
      { href: "/crm/admin/loss-reasons", label: "Loss reasons", description: "Why deals are lost", icon: AlertCircle, tone: "tile-rose" },
      { href: "/crm/admin/lead-sources", label: "Lead sources", description: "Where leads come from", icon: Tag, tone: "tile-sky" },
      { href: "/crm/admin/customer-needs", label: "Customer needs", description: "Dropdown reps pick from for meetings + opps", icon: Target, tone: "tile-emerald" },
      { href: "/crm/admin/meeting-types", label: "Meeting types", description: "Rename + reorder meeting type labels", icon: Calendar, tone: "tile-amber" },
      { href: "/crm/products", label: "Products & services", description: "Single source of catalogue (Partner services use this list)", icon: Package, tone: "tile-violet" },
      { href: "/crm/group/health", label: "Pipeline health", description: "Stale opps + missing next-actions", icon: HeartPulse, tone: "tile-rose" },
    ],
  },
  {
    title: "HR",
    items: [
      { href: "/hr/settings/companies", label: "Companies", description: "Group entities + structure", icon: Building2, tone: "tile-indigo" },
      { href: "/hr/settings/departments", label: "Departments", description: "Per-company departments", icon: Briefcase, tone: "tile-violet" },
      { href: "/hr/settings/violations", label: "Violation rules", description: "Incident categories + actions", icon: AlertCircle, tone: "tile-rose" },
      { href: "/hr/settings/bonuses", label: "Bonus rules", description: "Categories + amounts", icon: Wallet, tone: "tile-emerald" },
      { href: "/hr/settings/overtime-policy", label: "Overtime policy", description: "Rates + caps", icon: Clock, tone: "tile-amber" },
      { href: "/hr/settings/leave-policy", label: "Leave policy", description: "Types + entitlements", icon: Clock, tone: "tile-sky" },
      { href: "/hr/settings/app-settings", label: "App settings", description: "Currency, locale, branding", icon: Settings, tone: "tile-violet" },
    ],
  },
  {
    title: "Partners",
    items: [
      { href: "/admin/partners", label: "Partners", description: "Add / edit / deactivate partners", icon: Handshake, tone: "tile-amber" },
      { href: "/partners/services", label: "Partner services", description: "Service catalogue (synced with CRM products)", icon: Briefcase, tone: "tile-emerald" },
      { href: "/partners/admin/audit-logs", label: "Audit logs", description: "Every partner-side action", icon: ShieldCheck, tone: "tile-rose" },
    ],
  },
  {
    title: "Users",
    items: [
      { href: "/admin/users", label: "All users (unified)", description: "Every account across HR, CRM, and Partners in one tab", icon: Users, tone: "tile-indigo" },
      { href: "/admin/users/new", label: "Add new user", description: "One form, pick the modules they participate in", icon: Users, tone: "tile-sky" },
    ],
  },
];

export default async function AdminSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // Unified Settings page is open to any module-admin so HR managers / CRM
  // admins / partner admins all land HERE instead of their old per-module
  // settings — the welcome page steers them via the "Settings" tile.
  const hrRoles = session.user.hrRoles ?? [];
  const crmRole = session.user.crmRole;
  const canEnter =
    hrRoles.includes("super_admin") ||
    hrRoles.includes("hr_manager") ||
    crmRole === "ADMIN" ||
    (!!session.user.modules?.includes("partners") && !session.user.partnerId);
  if (!canEnter) redirect("/");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">All settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every admin-configurable surface across CRM, HR, and Partners — consolidated. Per-module settings tabs were removed; this is the single home for taxonomy, users, and policy.
        </p>
      </div>
      {GROUPS.map((g) => (
        <section key={g.title} className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{g.title}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {g.items.map((s) => (
              <Link key={s.href} href={s.href} className="block group">
                <Card className="hover:-translate-y-0.5 transition-transform h-full">
                  <CardHeader className="flex flex-row items-start justify-between pb-2">
                    <CardTitle className="text-base">{s.label}</CardTitle>
                    <div className={`h-10 w-10 rounded-xl ${s.tone} flex items-center justify-center shrink-0`}>
                      <s.icon className="h-5 w-5" />
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">{s.description}</p>
                    <span className="text-xs text-primary mt-2 inline-flex items-center gap-1 group-hover:underline">
                      Open <ArrowRight className="h-3 w-3" />
                    </span>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
