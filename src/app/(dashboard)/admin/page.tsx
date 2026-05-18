import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getServerT } from "@/lib/i18n/server";
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

export default async function AdminHomePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const isAdmin =
    !!session.user.hrRoles?.includes("super_admin") ||
    (!!session.user.modules?.includes("partners") && !session.user.partnerId);
  if (!isAdmin) redirect("/");

  const { locale } = await getServerT();
  const isAr = locale === "ar";

  // Tile labels + descriptions resolved at render time so the page swaps
  // language when the user clicks the locale toggle. Previously this was a
  // module-scope TILES array that froze the strings on first render.
  const TILES = [
    {
      href: "/admin/board",
      label: isAr ? "لوحة المجموعة" : "Group board",
      description: isAr ? "مؤشرات الأداء وترتيبات عبر الوحدات" : "Cross-module KPIs and leaderboards",
      icon: BarChart3,
      tone: "tile-indigo",
    },
    {
      href: "/admin/users",
      label: isAr ? "جميع المستخدمين" : "All users",
      description: isAr ? "الموظفون، المندوبون، الشركاء، الأدمنز — في مكان واحد" : "Employees, sales reps, partners, admins — one place",
      icon: Users,
      tone: "tile-violet",
    },
    {
      href: "/admin/partners",
      label: isAr ? "الشركاء" : "Partners",
      description: isAr ? "إضافة وتعديل وتعطيل حسابات الشركاء" : "Add, edit, deactivate partner accounts",
      icon: Handshake,
      tone: "tile-amber",
    },
    {
      href: "/admin/settings",
      label: isAr ? "كل الإعدادات" : "All settings",
      description: isAr ? "إعدادات الموارد البشرية والـ CRM والشركاء موحّدة" : "HR + CRM + Partner settings consolidated",
      icon: Settings,
      tone: "tile-sky",
    },
    {
      href: "/crm/products",
      label: isAr ? "المنتجات والخدمات" : "Products & services",
      description: isAr ? "المصدر الموحّد لكتالوج ما يُباع" : "The single catalogue of what's sold",
      icon: Package,
      tone: "tile-emerald",
    },
    {
      href: "/admin/onboarding-templates",
      label: isAr ? "قوالب الانضمام" : "Onboarding templates",
      description: isAr ? "قوائم تحقق جاهزة للموظفين الجدد" : "Pre-built checklists for new hires",
      icon: ClipboardList,
      tone: "tile-rose",
    },
    {
      href: "/admin/workflows-sequential",
      label: isAr ? "سير العمل" : "Workflows",
      description: isAr ? "أتمتة خطوة بخطوة بنمط n8n" : "n8n-style step-by-step automations",
      icon: Layers,
      tone: "tile-violet",
    },
    {
      href: "/hr/dashboard",
      label: isAr ? "لوحة الموارد البشرية" : "HR dashboard",
      description: isAr ? "عدد الموظفين، الحضور، الرواتب" : "Headcount, attendance, payroll",
      icon: LayoutDashboard,
      tone: "tile-indigo",
    },
    {
      href: "/crm/sales-board",
      label: isAr ? "لوحة الـ CRM" : "CRM dashboard",
      description: isAr ? "البايبلاين + لوحة المبيعات" : "Pipeline + sales board",
      icon: TrendingUp,
      tone: "tile-emerald",
    },
    {
      href: "/partners/dashboard",
      label: isAr ? "لوحة الشركاء" : "Partners dashboard",
      description: isAr ? "صفقات الشركاء والعمولات" : "Partner deals + commissions",
      icon: Handshake,
      tone: "tile-amber",
    },
  ];

  return (
    <div className="space-y-4">
      <WelcomeBanner
        firstName={firstNameOf(session.user.name, session.user.email)}
        rolePill={isAr ? "أدمن المنصة" : "Platform admin"}
        pillTone="indigo"
        email={session.user.email}
        subtitle={
          isAr
            ? "المستخدمون، الشركاء، الكتالوج، الإعدادات، سير العمل، ولوحات عبر الوحدات"
            : "Users, partners, catalogue, settings, workflows, and cross-module dashboards"
        }
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
                  {isAr ? "فتح" : "Open"} <ArrowRight className="h-3 w-3" />
                </span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
