"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import { Search, Sun, Moon } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useCommandPalette } from "@/components/layout/CommandPaletteProvider";
import { NotificationCenter } from "@/components/layout/NotificationCenter";
import { LocaleToggle } from "@/components/layout/LocaleToggle";
import { useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Cuid / ULID / UUID — any of these means this segment is an entity id, not a navigable category. */
function looksLikeId(segment: string): boolean {
  return (
    /^c[a-z0-9]{20,}$/.test(segment) || // cuid (Prisma default)
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment) || // uuid
    /^\d+$/.test(segment) // pure numeric id
  );
}

function getBreadcrumbs(
  pathname: string,
  tSidebar: { hrDashboard: string; crmDashboard: string; partnersDashboard: string; tasks: string; adminHome: string; dashboard: string; employees: string; orgChart: string; attendance: string; timeOff: string; overtime: string; incidents: string; bonuses: string; payroll: string; reports: string; settings: string; pipeline: string; opportunities: string; coldLeads: string; companies: string; contacts: string; meetingsCalendar: string; dailyReports: string; salesDashboard: string; leads: string; clients: string; deals: string; contracts: string; invoices: string; commissions: string; services: string; notifications: string; auditLogs: string; allUsers: string; partners: string; allSettings: string; productsServices: string; onboardingTemplates: string; workflows: string },
  tMobile: { hr: string; crm: string; partners: string },
  locale: "en" | "ar"
): { label: string; href?: string }[] {
  const isAr = locale === "ar";
  const parts = pathname.split("/").filter(Boolean);
  const crumbs: { label: string; href?: string }[] = [];

  // Module root crumb — uses the same label the sidebar shows.
  if (parts[0] === "hr") crumbs.push({ label: tMobile.hr, href: "/hr/dashboard" });
  else if (parts[0] === "crm") crumbs.push({ label: tMobile.crm, href: "/crm/my" });
  else if (parts[0] === "partners") crumbs.push({ label: tMobile.partners, href: "/partners/dashboard" });
  else if (parts[0] === "tasks") crumbs.push({ label: tSidebar.tasks, href: "/tasks" });
  else if (parts[0] === "admin") crumbs.push({ label: tSidebar.adminHome, href: "/admin/board" });

  // Map common URL segments to translated labels so the breadcrumb doesn't
  // render "Dashboard" / "Employees" in English on an Arabic page. Unmapped
  // segments fall through to the title-cased default — fine for rare or
  // page-name segments where translating doesn't pay off.
  const segMap: Record<string, string> = {
    dashboard: tSidebar.dashboard,
    employees: tSidebar.employees,
    "org-chart": tSidebar.orgChart,
    attendance: tSidebar.attendance,
    calendar: tSidebar.timeOff,
    overtime: tSidebar.overtime,
    incidents: tSidebar.incidents,
    bonuses: tSidebar.bonuses,
    payroll: tSidebar.payroll,
    reports: tSidebar.reports,
    settings: tSidebar.settings,
    pipeline: tSidebar.pipeline,
    opportunities: tSidebar.opportunities,
    "cold-leads": tSidebar.coldLeads,
    companies: tSidebar.companies,
    contacts: tSidebar.contacts,
    meetings: tSidebar.meetingsCalendar,
    calls: isAr ? "سجل المكالمات" : "Call Log",
    "sales-board": tSidebar.salesDashboard,
    leads: tSidebar.leads,
    clients: tSidebar.clients,
    deals: tSidebar.deals,
    contracts: tSidebar.contracts,
    invoices: tSidebar.invoices,
    commissions: tSidebar.commissions,
    services: tSidebar.services,
    notifications: tSidebar.notifications,
    "audit-logs": tSidebar.auditLogs,
    users: tSidebar.allUsers,
    partners: tSidebar.partners,
    "products-services": tSidebar.productsServices,
    "onboarding-templates": tSidebar.onboardingTemplates,
    workflows: tSidebar.workflows,
    // Common leaf-segment labels appearing in URLs like /hr/attendance/today,
    // /hr/overtime/pending, /hr/incidents/all — these become the trailing
    // breadcrumb on those pages. Without translation they leak English on
    // an otherwise-Arabic page.
    today: isAr ? "اليوم" : "Today",
    pending: isAr ? "قيد الانتظار" : "Pending",
    approved: isAr ? "معتمد" : "Approved",
    denied: isAr ? "مرفوض" : "Denied",
    rejected: isAr ? "مرفوض" : "Rejected",
    all: isAr ? "الكل" : "All",
    new: isAr ? "جديد" : "New",
    add: isAr ? "إضافة" : "Add",
    edit: isAr ? "تعديل" : "Edit",
    report: isAr ? "تقرير" : "Report",
    monthly: isAr ? "شهري" : "Monthly",
    history: isAr ? "السجل" : "History",
    submit: isAr ? "تقديم" : "Submit",
    award: isAr ? "منح" : "Award",
    progressive: isAr ? "متدرج" : "Progressive",
    excel: "Excel",
    pdf: "PDF",
    profile: isAr ? "الملف الشخصي" : "Profile",
    home: isAr ? "الرئيسية" : "Home",
    salary: isAr ? "الراتب" : "Salary",
    documents: isAr ? "المستندات" : "Documents",
    employee: isAr ? "الموظف" : "Employee",
    management: isAr ? "الإدارة" : "Management",
    "my-team": isAr ? "فريقي" : "My Team",
    team: isAr ? "الفريق" : "Team",
    tasks: tSidebar.tasks,
    products: tSidebar.productsServices,
    "stage-config": isAr ? "إعدادات المراحل" : "Stage Config",
    "loss-reasons": isAr ? "أسباب الخسارة" : "Loss reasons",
    "lead-sources": isAr ? "مصادر العملاء" : "Lead sources",
    "fx-rates": isAr ? "أسعار العملات" : "FX rates",
    "customer-needs": isAr ? "احتياجات العملاء" : "Customer needs",
    "meeting-types": isAr ? "أنواع الاجتماعات" : "Meeting types",
    entities: isAr ? "الكيانات" : "Entities",
    departments: isAr ? "الأقسام" : "Departments",
    violations: isAr ? "المخالفات" : "Violations",
    "leave-policy": isAr ? "سياسة الإجازات" : "Leave policy",
    "overtime-policy": isAr ? "سياسة الإضافي" : "Overtime policy",
    "app-settings": isAr ? "إعدادات التطبيق" : "App settings",
    accountant: isAr ? "المحاسب" : "Accountant",
    group: isAr ? "المجموعة" : "Group",
    forecast: isAr ? "التوقعات" : "Forecast",
    health: isAr ? "صحة البايبلاين" : "Health",
    leaderboard: isAr ? "ترتيب الأداء" : "Leaderboard",
    my: isAr ? "خاصتي" : "My",
    board: isAr ? "اللوحة" : "Board",
  };

  // Sub-pages — accumulate href as we walk, skip id-like and bracket segments.
  let cursor = "/" + (parts[0] ?? "");
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    cursor += "/" + part;
    if (part.startsWith("[")) continue;
    if (looksLikeId(part)) continue;
    const label =
      segMap[part] ??
      part.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    crumbs.push({ label, href: cursor });
  }

  return crumbs;
}

export function Header() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { setOpen } = useCommandPalette();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const { t, locale } = useLocale();
  const breadcrumbs = getBreadcrumbs(pathname, t.sidebar, t.mobileNav, locale);

  // next-themes resolves on the client only; gate the icon swap to avoid hydration mismatch.
  useEffect(() => setMounted(true), []);

  // Reference session so existing imports remain meaningful for future work
  // (notification center, role-aware breadcrumbs).
  void session;

  const isMac =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const shortcutLabel = isMac ? "⌘K" : "Ctrl K";
  const isDark = mounted && resolvedTheme === "dark";

  // On narrow screens, dropping every crumb but the trailing two keeps the
  // header readable without losing the user's place — the module crumb is
  // already covered by the bottom-nav active state.
  const mobileCrumbs = breadcrumbs.slice(-2);

  return (
    <header className="h-14 border-b bg-background flex items-center justify-between gap-2 px-3 md:px-6">
      {/* Breadcrumbs — desktop shows the full trail; mobile shows only the
          tail to leave room for the action buttons. min-w-0 + overflow-hidden
          on the nav means a long final label truncates instead of pushing
          the right-side buttons off-screen. */}
      <nav
        className="flex items-center gap-1 text-sm min-w-0 overflow-hidden"
        aria-label="Breadcrumb"
      >
        <span className="hidden md:contents">
          {breadcrumbs.map((crumb, i) => {
            const isLast = i === breadcrumbs.length - 1;
            return (
              <span key={i} className="flex items-center gap-1 min-w-0">
                {i > 0 && <span className="text-muted-foreground mx-1 shrink-0">/</span>}
                {isLast || !crumb.href ? (
                  <span className={cn("truncate", isLast ? "font-medium" : "text-muted-foreground")}>
                    {crumb.label}
                  </span>
                ) : (
                  <Link
                    href={crumb.href}
                    className="text-muted-foreground hover:text-foreground hover:underline transition-colors truncate"
                  >
                    {crumb.label}
                  </Link>
                )}
              </span>
            );
          })}
        </span>
        <span className="contents md:hidden">
          {mobileCrumbs.map((crumb, i) => {
            const isLast = i === mobileCrumbs.length - 1;
            return (
              <span key={i} className="flex items-center gap-1 min-w-0">
                {i > 0 && <span className="text-muted-foreground mx-1 shrink-0">/</span>}
                {isLast || !crumb.href ? (
                  <span className={cn("truncate", isLast ? "font-medium" : "text-muted-foreground")}>
                    {crumb.label}
                  </span>
                ) : (
                  <Link
                    href={crumb.href}
                    className="text-muted-foreground hover:text-foreground hover:underline transition-colors truncate"
                  >
                    {crumb.label}
                  </Link>
                )}
              </span>
            );
          })}
        </span>
      </nav>

      {/* Right section — shrink-0 so the breadcrumb area gets all the squeeze
          when space runs out; gap drops on mobile to fit four controls. */}
      <div className="flex items-center gap-1 md:gap-2 shrink-0">
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-2 text-muted-foreground px-2 md:px-3"
          onClick={() => setOpen(true)}
          aria-label={t.common.search}
        >
          <Search className="h-4 w-4" />
          <span className="hidden sm:inline">{t.common.search}</span>
          <kbd className="hidden sm:inline-flex items-center px-1.5 h-5 rounded bg-muted text-xs font-mono">
            {shortcutLabel}
          </kbd>
        </Button>
        <LocaleToggle />
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label={t.common.theme}
          onClick={() => setTheme(isDark ? "light" : "dark")}
        >
          {mounted ? (
            isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />
          ) : (
            // Render an inert placeholder during SSR to keep widths stable.
            <Sun className="h-4 w-4 opacity-0" />
          )}
        </Button>
        <NotificationCenter />
      </div>
    </header>
  );
}
