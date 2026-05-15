import type { LucideIcon } from "lucide-react";
import type { Session } from "next-auth";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import {
  Plus,
  UserPlus,
  Building2,
  Briefcase,
  Phone,
  Handshake,
  Users,
  LayoutDashboard,
  Settings,
  Calendar,
  ClipboardList,
  CheckCircle2,
  Receipt,
  FileText,
  DollarSign,
  TrendingUp,
  Bell,
  Sun,
  Moon,
  LogOut,
} from "lucide-react";

export type CommandActionContext = {
  router: AppRouterInstance;
  /** Set the next-themes theme. Provided by the palette consumer. */
  setTheme?: (theme: "light" | "dark" | "system") => void;
  /** Trigger NextAuth signOut. Provided by the palette consumer. */
  signOut?: () => Promise<void>;
};

export type CommandAction = {
  id: string;
  label: string;
  /** Heading the action is grouped under in the palette. */
  group: "Create" | "Navigate" | "Approve" | "Tools" | "Account";
  module: "hr" | "crm" | "partners" | "global";
  icon?: LucideIcon;
  /** Extra search aliases (e.g., ["new employee", "hire"]). */
  keywords?: string[];
  /** Reserved for the keyboard-shortcut feature (D2). */
  shortcut?: string;
  /** What happens when the user picks this action. */
  perform: (ctx: CommandActionContext) => void | Promise<void>;
  /** Optional extra gate beyond the module check. */
  visible?: (session: Session | null) => boolean;
};

// Helpers for module/role gating used by the visible() predicates below.
const hasHrRole = (session: Session | null, ...roles: string[]) =>
  !!session?.user?.hrRoles?.some((r) => roles.includes(r));

const isCrmAdmin = (session: Session | null) =>
  session?.user?.crmRole === "ADMIN";

const isPartnersAdmin = (session: Session | null) =>
  !!session?.user?.modules?.includes("partners") && !session.user.partnerId;

// ─── Action catalogue ──────────────────────────────────────────────────────
// Each module contributes its actions here. Keep ids stable — they may become
// keyboard-shortcut targets in the D2 work.
export const COMMAND_ACTIONS: CommandAction[] = [
  // ── Navigate (always-on; cheap, helps new users learn the IA) ──
  {
    id: "nav.today",
    label: "Go to Today",
    group: "Navigate",
    module: "global",
    icon: Calendar,
    keywords: ["dashboard", "agenda"],
    perform: ({ router }) => router.push("/today"),
  },
  {
    id: "nav.crm.dashboard",
    label: "Go to CRM Dashboard",
    group: "Navigate",
    module: "crm",
    icon: LayoutDashboard,
    perform: ({ router }) => router.push("/crm/my"),
  },
  {
    id: "nav.crm.opportunities",
    label: "Go to Opportunities",
    group: "Navigate",
    module: "crm",
    icon: TrendingUp,
    perform: ({ router }) => router.push("/crm/opportunities"),
  },
  {
    id: "nav.crm.companies",
    label: "Go to Companies",
    group: "Navigate",
    module: "crm",
    icon: Building2,
    perform: ({ router }) => router.push("/crm/companies"),
  },
  {
    id: "nav.crm.contacts",
    label: "Go to Contacts",
    group: "Navigate",
    module: "crm",
    icon: Users,
    perform: ({ router }) => router.push("/crm/contacts"),
  },
  {
    id: "nav.crm.calls",
    label: "Go to Calls",
    group: "Navigate",
    module: "crm",
    icon: Phone,
    perform: ({ router }) => router.push("/crm/calls"),
  },
  {
    id: "nav.hr.dashboard",
    label: "Go to HR Dashboard",
    group: "Navigate",
    module: "hr",
    icon: LayoutDashboard,
    perform: ({ router }) => router.push("/hr/dashboard"),
    visible: (s) => hasHrRole(s, "super_admin", "hr_manager", "ceo", "accountant"),
  },
  {
    id: "nav.hr.employees",
    label: "Go to Employees",
    group: "Navigate",
    module: "hr",
    icon: Users,
    perform: ({ router }) => router.push("/hr/employees"),
    visible: (s) => hasHrRole(s, "super_admin", "hr_manager", "ceo", "accountant"),
  },
  {
    id: "nav.hr.attendance",
    label: "Go to Attendance",
    group: "Navigate",
    module: "hr",
    icon: ClipboardList,
    perform: ({ router }) => router.push("/hr/attendance/today"),
  },
  {
    id: "nav.hr.payroll",
    label: "Go to Payroll",
    group: "Navigate",
    module: "hr",
    icon: DollarSign,
    perform: ({ router }) => router.push("/hr/payroll/monthly"),
    visible: (s) => hasHrRole(s, "super_admin", "accountant"),
  },
  {
    id: "nav.hr.org-chart",
    label: "Go to Org chart",
    group: "Navigate",
    module: "hr",
    icon: Users,
    keywords: ["organization", "hierarchy", "reporting"],
    perform: ({ router }) => router.push("/hr/org-chart"),
  },
  {
    id: "nav.hr.calendar",
    label: "Go to Time-off calendar",
    group: "Navigate",
    module: "hr",
    icon: Calendar,
    keywords: ["leave", "holiday", "vacation"],
    perform: ({ router }) => router.push("/hr/calendar"),
  },
  {
    id: "nav.partners.dashboard",
    label: "Go to Partners Dashboard",
    group: "Navigate",
    module: "partners",
    icon: LayoutDashboard,
    perform: ({ router }) => router.push("/partners/dashboard"),
  },
  {
    id: "nav.partners.leads",
    label: "Go to Leads",
    group: "Navigate",
    module: "partners",
    icon: Users,
    perform: ({ router }) => router.push("/partners/leads"),
    visible: (s) => !!s?.user?.partnerId, // partner-side only
  },
  {
    id: "nav.partners.deals",
    label: "Go to Deals",
    group: "Navigate",
    module: "partners",
    icon: Handshake,
    perform: ({ router }) => router.push("/partners/deals"),
    visible: (s) => !!s?.user?.partnerId,
  },
  {
    id: "nav.partners.commissions",
    label: "Go to Commissions",
    group: "Navigate",
    module: "partners",
    icon: DollarSign,
    perform: ({ router }) => router.push("/partners/commissions"),
  },
  {
    id: "nav.partners.admin.partners",
    label: "Go to Admin · Partners",
    group: "Navigate",
    module: "partners",
    icon: Users,
    perform: ({ router }) => router.push("/partners/admin/partners"),
    visible: isPartnersAdmin,
  },
  {
    id: "nav.partners.admin.contracts",
    label: "Go to Admin · Contracts to review",
    group: "Navigate",
    module: "partners",
    icon: FileText,
    perform: ({ router }) => router.push("/partners/admin/contracts"),
    visible: isPartnersAdmin,
  },
  {
    id: "nav.partners.admin.invoices",
    label: "Go to Admin · Invoices to review",
    group: "Navigate",
    module: "partners",
    icon: Receipt,
    perform: ({ router }) => router.push("/partners/admin/invoices"),
    visible: isPartnersAdmin,
  },
  {
    id: "nav.partners.admin.commissions",
    label: "Go to Admin · Commissions",
    group: "Navigate",
    module: "partners",
    icon: DollarSign,
    perform: ({ router }) => router.push("/partners/admin/commissions"),
    visible: isPartnersAdmin,
  },

  // ── Create ──
  {
    id: "create.crm.opportunity",
    label: "Create opportunity",
    group: "Create",
    module: "crm",
    icon: Plus,
    keywords: ["new deal", "add opportunity"],
    perform: ({ router }) => router.push("/crm/opportunities/new"),
  },
  {
    id: "create.crm.company",
    label: "Create company",
    group: "Create",
    module: "crm",
    icon: Plus,
    keywords: ["new company", "add company"],
    perform: ({ router }) => router.push("/crm/companies/new"),
  },
  {
    id: "create.hr.employee",
    label: "Create employee",
    group: "Create",
    module: "hr",
    icon: UserPlus,
    keywords: ["new hire", "add employee"],
    perform: ({ router }) => router.push("/hr/employees/add"),
    visible: (s) => hasHrRole(s, "super_admin", "hr_manager"),
  },
  {
    id: "create.hr.bonus",
    label: "Award bonus",
    group: "Create",
    module: "hr",
    icon: Plus,
    keywords: ["bonus", "reward"],
    perform: ({ router }) => router.push("/hr/bonuses/award"),
    visible: (s) => hasHrRole(s, "super_admin", "hr_manager"),
  },
  {
    id: "create.hr.incident",
    label: "Submit incident",
    group: "Create",
    module: "hr",
    icon: Plus,
    keywords: ["violation", "warning"],
    perform: ({ router }) => router.push("/hr/incidents/submit"),
    visible: (s) => hasHrRole(s, "super_admin", "hr_manager"),
  },
  {
    id: "create.hr.overtime",
    label: "Submit overtime request",
    group: "Create",
    module: "hr",
    icon: Plus,
    keywords: ["ot", "extra hours"],
    perform: ({ router }) => router.push("/hr/employee/overtime"),
  },

  // ── Approve queues ──
  {
    id: "approve.hr.overtime",
    label: "Review pending overtime",
    group: "Approve",
    module: "hr",
    icon: CheckCircle2,
    perform: ({ router }) => router.push("/hr/overtime/pending"),
    visible: (s) => hasHrRole(s, "super_admin", "hr_manager", "team_lead"),
  },
  {
    id: "approve.partners.contracts",
    label: "Review contracts",
    group: "Approve",
    module: "partners",
    icon: FileText,
    perform: ({ router }) => router.push("/partners/admin/contracts"),
    visible: isPartnersAdmin,
  },
  {
    id: "approve.partners.invoices",
    label: "Review invoices",
    group: "Approve",
    module: "partners",
    icon: Receipt,
    perform: ({ router }) => router.push("/partners/admin/invoices"),
    visible: isPartnersAdmin,
  },

  // ── Tools ──
  {
    id: "tools.notifications",
    label: "View notifications",
    group: "Tools",
    module: "global",
    icon: Bell,
    perform: ({ router }) => router.push("/partners/notifications"),
    visible: (s) => !!s?.user?.modules?.includes("partners"),
  },
  {
    id: "tools.audit-logs",
    label: "View audit logs",
    group: "Tools",
    module: "global",
    icon: ClipboardList,
    keywords: ["audit", "log", "compliance", "activity"],
    perform: ({ router }) => router.push("/admin/audit-logs"),
    visible: (s) =>
      !!s?.user?.hrRoles?.includes("super_admin") ||
      (!!s?.user?.modules?.includes("partners") && !s.user.partnerId),
  },
  {
    id: "tools.theme.dark",
    label: "Switch to dark mode",
    group: "Tools",
    module: "global",
    icon: Moon,
    perform: ({ setTheme }) => setTheme?.("dark"),
  },
  {
    id: "tools.theme.light",
    label: "Switch to light mode",
    group: "Tools",
    module: "global",
    icon: Sun,
    perform: ({ setTheme }) => setTheme?.("light"),
  },

  // ── Account ──
  {
    id: "account.settings",
    label: "Account settings",
    group: "Account",
    module: "global",
    icon: Settings,
    perform: ({ router }) => router.push("/partners/settings"),
    visible: (s) => !!s?.user?.modules?.includes("partners"),
  },
  {
    id: "account.security",
    label: "Security · Two-factor authentication",
    group: "Account",
    module: "global",
    icon: Settings,
    keywords: ["2fa", "totp", "mfa", "password", "security"],
    perform: ({ router }) => router.push("/account/security"),
  },
  {
    id: "account.signout",
    label: "Sign out",
    group: "Account",
    module: "global",
    icon: LogOut,
    keywords: ["logout", "log out"],
    perform: async ({ signOut }) => {
      await signOut?.();
    },
  },

  // CRM admins: pin a couple of high-value admin shortcuts.
  {
    id: "nav.crm.admin.users",
    label: "Go to CRM Admin · Users",
    group: "Navigate",
    module: "crm",
    icon: Users,
    perform: ({ router }) => router.push("/crm/admin/users"),
    visible: isCrmAdmin,
  },
  {
    id: "nav.crm.admin.entities",
    label: "Go to CRM Admin · Entities",
    group: "Navigate",
    module: "crm",
    icon: Briefcase,
    perform: ({ router }) => router.push("/crm/admin/entities"),
    visible: isCrmAdmin,
  },
];

/** Filter the catalogue down to actions visible for the given session. */
export function actionsForSession(session: Session | null): CommandAction[] {
  if (!session?.user) return [];
  const modules = session.user.modules ?? [];
  return COMMAND_ACTIONS.filter((a) => {
    if (a.module !== "global" && !modules.includes(a.module)) return false;
    if (a.visible && !a.visible(session)) return false;
    return true;
  });
}
