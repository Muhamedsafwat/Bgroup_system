import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { WelcomeHero, type WelcomeTile } from "@/components/shared/WelcomeHero";
import { firstNameOf, type Tone } from "@/lib/welcome";

/**
 * Welcome / quick-actions landing page. The visual treatment is shared with
 * every per-module home page via <WelcomeHero /> so the look stays consistent
 * everywhere the user lands.
 */

type RolePersona = {
  pillLabel: string;
  pillTone: Tone;
  question?: string;
  actions: WelcomeTile[];
  shortcuts: { href: string; label: string }[];
};

const COMMON_TOURS: { href: string; label: string }[] = [
  { href: "/tasks", label: "My tasks" },
  { href: "/today", label: "Today" },
];

function personaFor(args: {
  modules: ("hr" | "crm" | "partners")[];
  hrRoles: string[];
  crmRole?: string | null;
  partnerId?: string | null;
  isPlatformAdmin: boolean;
}): RolePersona {
  const { modules, hrRoles, crmRole, partnerId, isPlatformAdmin } = args;

  if (isPlatformAdmin) {
    return {
      pillLabel: "Platform admin",
      pillTone: "indigo",
      actions: [
        { href: "/admin", label: "Admin home", description: "Board · users · settings", icon: "LayoutDashboard", tone: "indigo" },
        { href: "/admin/users", label: "All users", description: "Every account in one place", icon: "Users", tone: "rose" },
        { href: "/admin/board", label: "Group board", description: "Cross-module KPIs", icon: "TrendingUp", tone: "emerald" },
        { href: "/admin/settings", label: "Settings", description: "Taxonomy · workflows", icon: "FileText", tone: "amber" },
        { href: "/admin/workflows-sequential", label: "Workflows", description: "Configure + trigger", icon: "Workflow", tone: "violet" },
        { href: "/admin/users/new", label: "Add a user", description: "One form, any module", icon: "Plus", tone: "sky" },
      ],
      shortcuts: [
        { href: "/hr/dashboard", label: "Open HR" },
        { href: "/crm/sales-board", label: "Open CRM" },
        { href: "/partners/dashboard", label: "Open Partners" },
        ...COMMON_TOURS,
      ],
    };
  }

  if (modules.includes("crm")) {
    if (crmRole === "MANAGER") {
      return {
        pillLabel: "Sales manager",
        pillTone: "indigo",
        actions: [
          { href: "/crm/group", label: "Team pipeline", description: "Health · forecast · leaderboard", icon: "TrendingUp", tone: "indigo" },
          { href: "/crm/opportunities", label: "Opportunities", description: "Reassign · start workflows", icon: "Briefcase", tone: "rose" },
          { href: "/crm/meetings", label: "Meetings", description: "Schedule + review", icon: "Calendar", tone: "emerald" },
          { href: "/crm/group/forecast", label: "Forecast", description: "This quarter's view", icon: "TrendingUp", tone: "amber" },
          { href: "/crm/opportunities/new", label: "New opportunity", description: "Log a lead for your team", icon: "Plus", tone: "sky" },
          { href: "/crm/admin/users", label: "My reps", description: "Manage the team", icon: "Users", tone: "violet" },
        ],
        shortcuts: [{ href: "/crm/my", label: "Switch to rep view" }, ...COMMON_TOURS],
      };
    }
    if (crmRole === "ASSISTANT") {
      return {
        pillLabel: "Assistant",
        pillTone: "amber",
        question: "What needs your sign-off today?",
        actions: [
          { href: "/crm/meetings", label: "Approval queue", description: "Pending meeting requests", icon: "Calendar", tone: "amber" },
          { href: "/crm/opportunities", label: "Opportunities", description: "Browse the pipeline", icon: "Briefcase", tone: "indigo" },
          { href: "/crm/companies", label: "Companies", description: "Customer accounts", icon: "Building2", tone: "emerald" },
          { href: "/tasks", label: "My tasks", description: "Things assigned to me", icon: "ListTodo", tone: "rose" },
        ],
        shortcuts: COMMON_TOURS,
      };
    }
    if (crmRole === "ADMIN" && !isPlatformAdmin) {
      return {
        pillLabel: "CRM admin",
        pillTone: "indigo",
        actions: [
          { href: "/crm/sales-board", label: "Sales board", description: "Org-wide pipeline", icon: "TrendingUp", tone: "indigo" },
          { href: "/admin/settings", label: "Settings", description: "Users · taxonomy · products", icon: "FileText", tone: "amber" },
          { href: "/admin/users", label: "Users", description: "Add · edit · assign", icon: "Users", tone: "rose" },
          { href: "/crm/opportunities", label: "Opportunities", description: "Every deal in the system", icon: "Briefcase", tone: "emerald" },
        ],
        shortcuts: COMMON_TOURS,
      };
    }
    return {
      pillLabel: crmRole === "ACCOUNT_MGR" ? "Account manager" : "Sales rep",
      pillTone: "sky",
      actions: [
        { href: "/crm/opportunities/new", label: "New opportunity", description: "Log a lead", icon: "Plus", tone: "sky" },
        { href: "/crm/companies", label: "Add company", description: "Save a new account", icon: "Building2", tone: "emerald" },
        { href: "/crm/calls", label: "Log a call", description: "Add to today's report", icon: "Phone", tone: "amber" },
        { href: "/crm/meetings", label: "Book a meeting", description: "Request approval", icon: "Calendar", tone: "rose" },
        { href: "/crm/my", label: "My pipeline", description: "Today's calls + opps", icon: "LayoutDashboard", tone: "indigo" },
        { href: "/crm/opportunities", label: "Opportunities", description: "Everything you own", icon: "Briefcase", tone: "violet" },
      ],
      shortcuts: [
        { href: "/crm/contacts", label: "Contacts" },
        { href: "/crm/reports", label: "Daily reports" },
        ...COMMON_TOURS,
      ],
    };
  }

  if (modules.includes("partners") && partnerId) {
    return {
      pillLabel: "Partner",
      pillTone: "emerald",
      actions: [
        { href: "/partners/leads", label: "Register a lead", description: "Bring in a prospect", icon: "Plus", tone: "sky" },
        { href: "/partners/deals", label: "My deals", description: "Status · commissions", icon: "Handshake", tone: "emerald" },
        { href: "/partners/commissions", label: "Commissions", description: "Earnings · payouts", icon: "Receipt", tone: "amber" },
        { href: "/partners/dashboard", label: "Dashboard", description: "Headline numbers", icon: "LayoutDashboard", tone: "indigo" },
      ],
      shortcuts: [
        { href: "/partners/contracts", label: "Contracts" },
        { href: "/partners/invoices", label: "Invoices" },
        { href: "/partners/notifications", label: "Notifications" },
      ],
    };
  }

  if (modules.includes("hr")) {
    if (hrRoles.includes("hr_manager")) {
      return {
        pillLabel: "HR manager",
        pillTone: "indigo",
        actions: [
          { href: "/hr/dashboard", label: "HR dashboard", description: "Action queue + KPIs", icon: "LayoutDashboard", tone: "indigo" },
          { href: "/hr/employees", label: "Employees", description: "Browse + add", icon: "Users", tone: "rose" },
          { href: "/hr/overtime/pending", label: "Overtime approvals", description: "Awaiting your signoff", icon: "CheckSquare", tone: "emerald" },
          { href: "/hr/incidents/submit", label: "Submit incident", description: "Disciplinary record", icon: "AlertTriangle", tone: "amber" },
          { href: "/hr/payroll/monthly", label: "Monthly payroll", description: "Calculate + lock", icon: "Wallet", tone: "violet" },
          { href: "/admin/users/new", label: "Onboard a hire", description: "One form, every module", icon: "Plus", tone: "sky" },
        ],
        shortcuts: [
          { href: "/hr/org-chart", label: "Org chart" },
          { href: "/hr/calendar", label: "Time-off calendar" },
          ...COMMON_TOURS,
        ],
      };
    }
    if (hrRoles.includes("accountant")) {
      return {
        pillLabel: "Accountant",
        pillTone: "emerald",
        actions: [
          { href: "/hr/accountant", label: "Financial dashboard", description: "Payroll + commission liability", icon: "Wallet", tone: "indigo" },
          { href: "/hr/payroll/monthly", label: "Run payroll", description: "This month's salaries", icon: "Wallet", tone: "emerald" },
          { href: "/hr/bonuses/all", label: "Bonuses", description: "Approve / log", icon: "Plus", tone: "amber" },
          { href: "/hr/reports/excel", label: "Reports", description: "Excel exports", icon: "FileText", tone: "violet" },
        ],
        shortcuts: COMMON_TOURS,
      };
    }
    if (hrRoles.includes("team_lead")) {
      return {
        pillLabel: "Team lead",
        pillTone: "violet",
        actions: [
          { href: "/hr/team", label: "My team", description: "Reports + attendance roll-up", icon: "Users", tone: "indigo" },
          { href: "/hr/overtime/pending", label: "Approve overtime", description: "Pending requests", icon: "CheckSquare", tone: "emerald" },
          { href: "/hr/team/attendance", label: "Today's attendance", description: "Who's in", icon: "Calendar", tone: "amber" },
          { href: "/tasks", label: "My tasks", description: "Things on my plate", icon: "ListTodo", tone: "rose" },
        ],
        shortcuts: COMMON_TOURS,
      };
    }
    return {
      pillLabel: "Employee",
      pillTone: "rose",
      actions: [
        { href: "/hr/employee/home", label: "My home", description: "Today + recent payslips", icon: "LayoutDashboard", tone: "indigo" },
        { href: "/hr/employee/attendance", label: "Check in / out", description: "Today's status", icon: "Calendar", tone: "emerald" },
        { href: "/hr/employee/overtime", label: "Request overtime", description: "Submit a request", icon: "Plus", tone: "amber" },
        { href: "/hr/employee/tasks", label: "My tasks", description: "Start · end · attach", icon: "ListTodo", tone: "rose" },
        { href: "/hr/employee/salary", label: "My salary", description: "Slips · history", icon: "Wallet", tone: "violet" },
        { href: "/hr/employee/profile", label: "Profile", description: "My personal info", icon: "Users", tone: "sky" },
      ],
      shortcuts: COMMON_TOURS,
    };
  }

  return {
    pillLabel: "Welcome",
    pillTone: "indigo",
    actions: [
      { href: "/tasks", label: "My tasks", description: "Everything assigned to me", icon: "ListTodo", tone: "indigo" },
      { href: "/today", label: "Today", description: "Approvals · calls · meetings", icon: "ClipboardList", tone: "rose" },
    ],
    shortcuts: [],
  };
}

export default async function RootPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const modules = (session.user.modules ?? []) as ("hr" | "crm" | "partners")[];
  const hrRoles = session.user.hrRoles ?? [];
  const crmRole = session.user.crmRole ?? null;
  const partnerId = session.user.partnerId ?? null;
  const isPlatformAdmin =
    hrRoles.includes("super_admin") ||
    (modules.includes("partners") && !partnerId);

  const persona = personaFor({
    modules,
    hrRoles,
    crmRole,
    partnerId,
    isPlatformAdmin,
  });

  const firstName = firstNameOf(session.user.name, session.user.email);

  return (
    <WelcomeHero
      firstName={firstName}
      rolePill={persona.pillLabel}
      pillTone={persona.pillTone}
      question={persona.question}
      email={session.user.email}
      tiles={persona.actions}
      shortcuts={persona.shortcuts}
    />
  );
}
