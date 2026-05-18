"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { ModuleSwitcher } from "./ModuleSwitcher";
import { SidebarAccountDialog } from "./SidebarAccountDialog";
import {
  // HR icons
  LayoutDashboard,
  Users,
  Clock,
  AlertTriangle,
  Gift,
  Timer,
  Wallet,
  FileBarChart,
  Settings,
  // CRM icons
  Kanban,
  Phone,
  CalendarCheck,
  Target,
  TrendingUp,
  Building2,
  Contact,
  Package,
  BarChart3,
  Trophy,
  HeartPulse,
  UserCog,
  Landmark,
  DollarSign,
  Layers,
  AlertCircle,
  Tag,
  // Partners icons
  Handshake,
  UserCheck,
  FileText,
  Receipt,
  Briefcase,
  Bell,
  Shield,
  ClipboardList,
  ListTodo,
  // Layout icons
  ChevronLeft,
  ChevronRight,
  LogOut,
} from "lucide-react";
import { signOut } from "next-auth/react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useLocale } from "@/lib/i18n";
import type { Dictionary } from "@/lib/i18n";

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  roles?: string[];
}

interface NavSection {
  title?: string;
  items: NavItem[];
}

// Each nav builder takes the sidebar slice of the dictionary so labels swap
// automatically when the user flips the language toggle.
type SidebarT = Dictionary["sidebar"];

// ─── HR Navigation ─────────────────────────────────────────────────

function getHrNav(roles: string[], t: SidebarT): NavSection[] {
  const isAdmin = roles.includes("super_admin") || roles.includes("hr_manager");
  const isCEO = roles.includes("ceo");
  const isTeamLead = roles.includes("team_lead");
  const isAccountant = roles.includes("accountant");
  const isEmployee = roles.includes("employee");

  const sections: NavSection[] = [];

  if (isAdmin) {
    sections.push({
      items: [
        { href: "/hr/dashboard", label: t.dashboard, icon: LayoutDashboard },
        { href: "/hr/employees", label: t.employees, icon: Users },
        { href: "/hr/org-chart", label: t.orgChart, icon: Users },
        { href: "/tasks", label: t.tasks, icon: ListTodo },
      ],
    });
    sections.push({
      title: t.sectionManagement,
      items: [
        { href: "/hr/attendance/today", label: t.attendance, icon: Clock },
        { href: "/hr/calendar", label: t.timeOff, icon: Clock },
        { href: "/hr/overtime/pending", label: t.overtime, icon: Timer },
        { href: "/hr/incidents/all", label: t.incidents, icon: AlertTriangle },
        { href: "/hr/bonuses/all", label: t.bonuses, icon: Gift },
        { href: "/hr/payroll/monthly", label: t.payroll, icon: Wallet },
      ],
    });
    sections.push({
      title: t.sectionReports,
      items: [
        { href: "/hr/reports/excel", label: t.reports, icon: FileBarChart },
        { href: "/admin/settings", label: t.settings, icon: Settings },
      ],
    });
  }

  if (isCEO) {
    sections.push({
      items: [
        { href: "/hr/management", label: t.overview, icon: LayoutDashboard },
        { href: "/hr/employees", label: t.employees, icon: Users },
        { href: "/hr/payroll/monthly", label: t.payroll, icon: Wallet },
      ],
    });
  }

  if (isTeamLead) {
    sections.push({
      items: [{ href: "/hr/team", label: t.myTeam, icon: Users }],
    });
  }

  if (isAccountant) {
    sections.push({
      items: [{ href: "/hr/accountant", label: t.payroll, icon: Wallet }],
    });
  }

  if (isEmployee) {
    sections.push({
      items: [
        { href: "/hr/employee/home", label: t.home, icon: LayoutDashboard },
        { href: "/hr/employee/tasks", label: t.myTasks, icon: ListTodo },
        { href: "/hr/employee/attendance", label: t.myAttendance, icon: Clock },
        { href: "/hr/employee/overtime", label: t.myOvertime, icon: Timer },
        { href: "/hr/employee/salary", label: t.mySalary, icon: Wallet },
        { href: "/hr/employee/incidents", label: t.myIncidents, icon: AlertTriangle },
        { href: "/hr/employee/profile", label: t.profile, icon: UserCog },
      ],
    });
  }

  return sections;
}

// ─── CRM Navigation ──────────────────────────────────────���─────────

function getCrmNav(crmRole: string | undefined, t: SidebarT): NavSection[] {
  const sections: NavSection[] = [];
  const isManager = crmRole === "MANAGER" || crmRole === "ADMIN";

  if (crmRole === "ASSISTANT") {
    sections.push({
      title: t.sectionWork,
      items: [
        { href: "/crm/my", label: t.myDay, icon: LayoutDashboard },
        { href: "/crm/meetings", label: t.meetingsCalendar, icon: CalendarCheck },
        { href: "/tasks", label: t.myTasks, icon: ClipboardList },
      ],
    });
    return sections;
  }

  const workItems = [
    { href: "/crm/sales-board", label: t.salesDashboard, icon: BarChart3 },
    { href: "/crm/pipeline", label: t.pipeline, icon: TrendingUp },
    { href: "/crm/opportunities", label: t.opportunities, icon: TrendingUp },
    { href: "/crm/cold-leads", label: t.coldLeads, icon: Phone },
    ...(isManager
      ? [{ href: "/crm/companies", label: t.companies, icon: Building2 }]
      : []),
    { href: "/crm/contacts", label: t.contacts, icon: Contact },
    { href: "/crm/meetings", label: t.meetingsCalendar, icon: CalendarCheck },
    { href: "/crm/reports", label: t.dailyReports, icon: ClipboardList },
  ];
  sections.push({ title: t.sectionWork, items: workItems });

  if (crmRole === "ADMIN") {
    sections.push({
      title: t.sectionAdmin,
      items: [{ href: "/admin/settings", label: t.settings, icon: Settings }],
    });
  }

  return sections;
}

// ─── Partners Navigation ───────────────────────────────────────────

function getPartnersNav(isAdmin: boolean, t: SidebarT): NavSection[] {
  if (isAdmin) {
    return [
      {
        items: [
          { href: "/partners/dashboard", label: t.dashboard, icon: LayoutDashboard },
          { href: "/partners/admin/partners", label: t.partners, icon: Users },
          { href: "/partners/admin/contracts", label: t.contracts, icon: FileText },
          { href: "/partners/admin/invoices", label: t.invoices, icon: Receipt },
          { href: "/partners/admin/commissions", label: t.commissions, icon: DollarSign },
          { href: "/partners/services", label: t.services, icon: Briefcase },
          { href: "/tasks", label: t.tasks, icon: ListTodo },
          { href: "/partners/admin/audit-logs", label: t.auditLogs, icon: ClipboardList },
        ],
      },
    ];
  }

  return [
    {
      items: [
        { href: "/partners/dashboard", label: t.dashboard, icon: LayoutDashboard },
        { href: "/partners/leads", label: t.leads, icon: Users },
        { href: "/partners/clients", label: t.clients, icon: UserCheck },
        { href: "/partners/deals", label: t.deals, icon: Handshake },
        { href: "/partners/contracts", label: t.contracts, icon: FileText },
        { href: "/partners/invoices", label: t.invoices, icon: Receipt },
        { href: "/partners/commissions", label: t.commissions, icon: DollarSign },
        { href: "/partners/services", label: t.services, icon: Briefcase },
        { href: "/tasks", label: t.myTasks, icon: ListTodo },
      ],
    },
    {
      items: [
        { href: "/partners/notifications", label: t.notifications, icon: Bell },
        { href: "/partners/settings", label: t.settings, icon: Settings },
      ],
    },
  ];
}

// ─── Admin Navigation ─────────────────────────────────────────────

function getAdminNav(t: SidebarT): NavSection[] {
  return [
    {
      items: [
        { href: "/admin", label: t.adminHome, icon: LayoutDashboard },
        { href: "/admin/board", label: t.groupBoard, icon: BarChart3 },
      ],
    },
    {
      title: t.sectionPeople,
      items: [
        { href: "/admin/users", label: t.allUsers, icon: Users },
        { href: "/admin/partners", label: t.partners, icon: Handshake },
        { href: "/hr/employees", label: t.employees, icon: Users },
        { href: "/hr/org-chart", label: t.orgChart, icon: Users },
      ],
    },
    {
      title: t.sectionDashboards,
      items: [
        { href: "/hr/dashboard", label: t.hrDashboard, icon: LayoutDashboard },
        { href: "/crm/sales-board", label: t.crmDashboard, icon: TrendingUp },
        { href: "/partners/dashboard", label: t.partnersDashboard, icon: Handshake },
      ],
    },
    {
      title: t.sectionCatalogue,
      items: [
        { href: "/admin/settings", label: t.allSettings, icon: Settings },
        { href: "/crm/products", label: t.productsServices, icon: Package },
        { href: "/admin/onboarding-templates", label: t.onboardingTemplates, icon: ClipboardList },
        { href: "/admin/workflows-sequential", label: t.workflows, icon: Layers },
      ],
    },
  ];
}

// ─── Main Sidebar Component ────────────────────────────────────────

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [collapsed, setCollapsed] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const { t } = useLocale();
  const tSidebar = t.sidebar;

  const modules = session?.user?.modules || [];

  // Detect active module from pathname.
  let detected: "hr" | "crm" | "partners" | null = null;
  let detectedExt: "hr" | "crm" | "partners" | "admin" | null = null;
  if (pathname.startsWith("/hr")) detectedExt = "hr";
  else if (pathname.startsWith("/crm")) detectedExt = "crm";
  else if (pathname.startsWith("/partners")) detectedExt = "partners";
  else if (pathname.startsWith("/admin")) detectedExt = "admin";
  detected = detectedExt === "admin" ? null : (detectedExt as "hr" | "crm" | "partners" | null);

  // Persist the last module the user was inside so cross-module pages
  // (/tasks, /today, /account/*) keep the previous module's nav.
  const [lastModule, setLastModule] = useState<"hr" | "crm" | "partners">(() => {
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem("bgroup.activeModule");
      if (stored === "hr" || stored === "crm" || stored === "partners") return stored;
    }
    return "hr";
  });

  useEffect(() => {
    if (detected && detected !== lastModule) {
      setLastModule(detected);
      if (typeof window !== "undefined") {
        window.localStorage.setItem("bgroup.activeModule", detected);
      }
    }
  }, [detected, lastModule]);

  const activeModule: "hr" | "crm" | "partners" | "admin" =
    detectedExt ??
    (modules.includes(lastModule) ? lastModule : (modules[0] as "hr" | "crm" | "partners" | undefined) ?? "hr");

  // Get nav sections for active module — translation slice is passed in
  // so the labels swap instantly when the user clicks the LocaleToggle.
  let sections: NavSection[] = [];
  if (activeModule === "admin") {
    sections = getAdminNav(tSidebar);
  } else if (activeModule === "hr") {
    const hrRoles = session?.user?.hrRoles || [];
    sections = getHrNav(hrRoles, tSidebar);
  } else if (activeModule === "crm") {
    sections = getCrmNav(session?.user?.crmRole, tSidebar);
  } else if (activeModule === "partners") {
    const isPartnersAdmin = !session?.user?.partnerId;
    sections = getPartnersNav(isPartnersAdmin, tSidebar);
  }

  function isActive(href: string) {
    // Module-root "home" links (the dashboards we use as each module's
    // landing page) must light up ONLY on the exact path — otherwise they
    // would stay active on every child route in the module, double-lighting
    // alongside the actual page entry.
    const rootOnly = new Set([
      "/admin",
      "/hr/dashboard",
      "/crm/my",
      "/partners/dashboard",
    ]);
    if (rootOnly.has(href)) return pathname === href;
    // For every other link, boundary-aware match: exact path OR sub-segment.
    if (href === pathname) return true;
    return pathname.startsWith(href + "/");
  }

  const CollapseIcon = collapsed ? ChevronRight : ChevronLeft;

  return (
    <aside
      className={cn(
        "flex flex-col border-r bg-sidebar text-sidebar-foreground h-screen sticky top-0 transition-all duration-200",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {/* Logo + Module Switcher */}
      <div className="flex items-center justify-between px-3 h-16 border-b">
        {!collapsed && (
          <Link href="/" className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-xl bg-primary-gradient flex items-center justify-center text-primary-foreground font-bold text-base shadow-sm">
              B
            </div>
            <span className="font-bold text-lg tracking-tight">BGroup</span>
          </Link>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1.5 rounded-lg hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
        >
          <CollapseIcon className="h-4 w-4" />
        </button>
      </div>

      {/* Module Switcher */}
      {modules.length > 0 && (
        <div className="px-2 py-2 border-b">
          <ModuleSwitcher collapsed={collapsed} />
        </div>
      )}

      {/* Navigation */}
      <ScrollArea className="flex-1 py-2">
        <nav className="space-y-1 px-2">
          {sections.map((section, sIdx) => (
            <div key={sIdx}>
              {sIdx > 0 && <Separator className="my-2" />}
              {section.title && !collapsed && (
                <div className="px-3 py-1 text-xs font-semibold text-muted-foreground uppercase">
                  {section.title}
                </div>
              )}
              {section.items.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all",
                      active
                        ? "bg-primary-gradient text-primary-foreground font-medium shadow-sm"
                        : "text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                      collapsed && "justify-center px-2"
                    )}
                    title={collapsed ? item.label : undefined}
                  >
                    {/* Active indicator stripe on the left */}
                    {active && !collapsed && (
                      <span className="absolute -left-2 top-1/2 -translate-y-1/2 h-5 w-1 rounded-full bg-primary-gradient" aria-hidden />
                    )}
                    <Icon className={cn("h-5 w-5 shrink-0", active ? "text-primary-foreground" : "text-current opacity-80")} />
                    {!collapsed && <span>{item.label}</span>}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      </ScrollArea>

      {/* User + Logout. The identity tile is a button that opens the
          unified account dialog (photo + password + 2FA link). When the
          sidebar is collapsed, the photo-circle alone acts as the trigger. */}
      <div className="border-t p-3">
        {session?.user && (
          <button
            type="button"
            onClick={() => setAccountOpen(true)}
            className={cn(
              "flex items-center gap-3 mb-2 w-full rounded-lg p-1.5 hover:bg-sidebar-accent text-start transition-colors",
              collapsed && "justify-center"
            )}
            title={collapsed ? (session.user.name ?? session.user.email ?? tSidebar.account) : tSidebar.account}
          >
            <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-sm font-medium shrink-0 overflow-hidden">
              {session.user.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={session.user.image} alt="" className="h-full w-full object-cover" />
              ) : (
                session.user.name?.charAt(0) || "U"
              )}
            </div>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{session.user.name}</p>
                <p className="text-xs text-muted-foreground truncate">{session.user.email}</p>
              </div>
            )}
          </button>
        )}
        <button
          onClick={() => signOut({ redirectTo: "/login" })}
          className={cn(
            "flex items-center gap-3 px-3 py-2 rounded-lg text-sm w-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors",
            collapsed && "justify-center px-2"
          )}
          title={collapsed ? tSidebar.logout : undefined}
        >
          <LogOut className="h-5 w-5 shrink-0" />
          {!collapsed && <span>{tSidebar.logout}</span>}
        </button>
      </div>
      <SidebarAccountDialog open={accountOpen} onOpenChange={setAccountOpen} />
    </aside>
  );
}
