import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart3,
  Users,
  Handshake,
  Settings,
  ClipboardList,
  Layers,
  Package,
  LayoutDashboard,
  TrendingUp,
  ArrowRight,
} from "lucide-react";
import { WelcomeBanner } from "@/components/shared/WelcomeHero";
import { firstNameOf } from "@/lib/welcome";

export const dynamic = "force-dynamic";

const TILES = [
  { href: "/admin/board", label: "Group board", description: "Cross-module KPIs and leaderboards", icon: BarChart3, tone: "tile-indigo" },
  { href: "/admin/users", label: "All users", description: "Employees, sales reps, partners, admins — one place", icon: Users, tone: "tile-violet" },
  { href: "/admin/partners", label: "Partners", description: "Add, edit, deactivate partner accounts", icon: Handshake, tone: "tile-amber" },
  { href: "/admin/settings", label: "All settings", description: "HR + CRM + Partner settings consolidated", icon: Settings, tone: "tile-sky" },
  { href: "/crm/products", label: "Products & services", description: "The single catalogue of what's sold", icon: Package, tone: "tile-emerald" },
  { href: "/admin/onboarding-templates", label: "Onboarding templates", description: "Pre-built checklists for new hires", icon: ClipboardList, tone: "tile-rose" },
  { href: "/admin/workflows-sequential", label: "Workflows", description: "n8n-style step-by-step automations", icon: Layers, tone: "tile-violet" },
  { href: "/hr/dashboard", label: "HR dashboard", description: "Headcount, attendance, payroll", icon: LayoutDashboard, tone: "tile-indigo" },
  { href: "/crm/sales-board", label: "CRM dashboard", description: "Pipeline + sales board", icon: TrendingUp, tone: "tile-emerald" },
  { href: "/partners/dashboard", label: "Partners dashboard", description: "Partner deals + commissions", icon: Handshake, tone: "tile-amber" },
];

export default async function AdminHomePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const isAdmin =
    !!session.user.hrRoles?.includes("super_admin") ||
    (!!session.user.modules?.includes("partners") && !session.user.partnerId);
  if (!isAdmin) redirect("/");

  return (
    <div className="space-y-4">
      <WelcomeBanner
        firstName={firstNameOf(session.user.name, session.user.email)}
        rolePill="Platform admin"
        pillTone="indigo"
        email={session.user.email}
        subtitle="Users, partners, catalogue, settings, workflows, and cross-module dashboards"
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {TILES.map((t) => (
          <Link key={t.href} href={t.href} className="block group">
            <Card className="hover:-translate-y-0.5 transition-transform h-full">
              <CardHeader className="flex flex-row items-start justify-between pb-2">
                <CardTitle className="text-base">{t.label}</CardTitle>
                <div className={`h-10 w-10 rounded-xl ${t.tone} flex items-center justify-center shrink-0`}>
                  <t.icon className="h-5 w-5" />
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{t.description}</p>
                <span className="text-xs text-primary mt-2 inline-flex items-center gap-1 group-hover:underline">
                  Open <ArrowRight className="h-3 w-3" />
                </span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
