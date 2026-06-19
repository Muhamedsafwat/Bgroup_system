import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getServerT } from "@/lib/i18n/server";
import { WelcomeHero, type WelcomeTile } from "@/components/shared/WelcomeHero";
import { firstNameOf, type Tone } from "@/lib/welcome";

/**
 * Welcome / quick-actions landing page. The visual treatment is shared with
 * every per-module home page via <WelcomeHero /> so the look stays consistent
 * everywhere the user lands.
 *
 * Persona labels + shortcut chips live here. They take an `isAr` flag so the
 * page can render fully in Arabic when the user has the AR locale cookie.
 */

type RolePersona = {
  pillLabel: string;
  pillTone: Tone;
  question?: string;
  actions: WelcomeTile[];
  shortcuts: { href: string; label: string }[];
};

function commonTours(isAr: boolean) {
  return [
    { href: "/tasks", label: isAr ? "مهامي" : "My tasks" },
    { href: "/today", label: isAr ? "اليوم" : "Today" },
  ];
}

function personaFor(args: {
  modules: ("hr" | "crm" | "partners")[];
  hrRoles: string[];
  crmRole?: string | null;
  partnerId?: string | null;
  isPlatformAdmin: boolean;
  isAr: boolean;
}): RolePersona {
  const { modules, hrRoles, crmRole, partnerId, isPlatformAdmin, isAr } = args;
  const tours = commonTours(isAr);

  if (isPlatformAdmin) {
    return {
      pillLabel: isAr ? "أدمن المنصة" : "Platform admin",
      pillTone: "indigo",
      actions: [
        { href: "/admin", label: isAr ? "الإدارة - الرئيسية" : "Admin home", description: isAr ? "لوحة · مستخدمون · إعدادات" : "Board · users · settings", icon: "LayoutDashboard", tone: "indigo" },
        { href: "/admin/users", label: isAr ? "جميع المستخدمين" : "All users", description: isAr ? "كل حساب في مكان واحد" : "Every account in one place", icon: "Users", tone: "rose" },
        { href: "/admin/board", label: isAr ? "لوحة المجموعة" : "Group board", description: isAr ? "مؤشرات عبر الوحدات" : "Cross-module KPIs", icon: "TrendingUp", tone: "emerald" },
        { href: "/admin/settings", label: isAr ? "الإعدادات" : "Settings", description: isAr ? "التصنيفات · سير العمل" : "Taxonomy · workflows", icon: "FileText", tone: "amber" },
        { href: "/admin/workflows-sequential", label: isAr ? "سير العمل" : "Workflows", description: isAr ? "ضبط + تشغيل" : "Configure + trigger", icon: "Workflow", tone: "violet" },
        { href: "/admin/users/new", label: isAr ? "إضافة مستخدم" : "Add a user", description: isAr ? "نموذج واحد، أي وحدة" : "One form, any module", icon: "Plus", tone: "sky" },
      ],
      shortcuts: [
        { href: "/hr/dashboard", label: isAr ? "فتح الموارد البشرية" : "Open HR" },
        { href: "/crm/sales-board", label: isAr ? "فتح الـ CRM" : "Open CRM" },
        { href: "/partners/dashboard", label: isAr ? "فتح الشركاء" : "Open Partners" },
        ...tours,
      ],
    };
  }

  if (modules.includes("crm")) {
    if (crmRole === "MANAGER") {
      return {
        pillLabel: isAr ? "مدير مبيعات" : "Sales manager",
        pillTone: "indigo",
        actions: [
          { href: "/crm/group", label: isAr ? "بايبلاين الفريق" : "Team pipeline", description: isAr ? "صحة · توقعات · ترتيب" : "Health · forecast · leaderboard", icon: "TrendingUp", tone: "indigo" },
          { href: "/crm/opportunities", label: isAr ? "الفرص" : "Opportunities", description: isAr ? "إعادة تعيين · بدء سير عمل" : "Reassign · start workflows", icon: "Briefcase", tone: "rose" },
          { href: "/crm/meetings", label: isAr ? "الاجتماعات" : "Meetings", description: isAr ? "جدولة + مراجعة" : "Schedule + review", icon: "Calendar", tone: "emerald" },
          { href: "/crm/group/forecast", label: isAr ? "التوقعات" : "Forecast", description: isAr ? "هذا الربع" : "This quarter's view", icon: "TrendingUp", tone: "amber" },
          { href: "/crm/opportunities/new", label: isAr ? "فرصة جديدة" : "New opportunity", description: isAr ? "سجّل عميلًا لفريقك" : "Log a lead for your team", icon: "Plus", tone: "sky" },
          { href: "/crm/admin/users", label: isAr ? "مندوبيّ" : "My reps", description: isAr ? "إدارة الفريق" : "Manage the team", icon: "Users", tone: "violet" },
        ],
        shortcuts: [{ href: "/crm/my", label: isAr ? "التحول لعرض المندوب" : "Switch to rep view" }, ...tours],
      };
    }
    if (crmRole === "ASSISTANT") {
      return {
        pillLabel: isAr ? "مساعد" : "Assistant",
        pillTone: "amber",
        question: isAr ? "ماذا يحتاج موافقتك اليوم؟" : "What needs your sign-off today?",
        actions: [
          { href: "/crm/meetings", label: isAr ? "قائمة الاعتماد" : "Approval queue", description: isAr ? "طلبات اجتماعات قيد الانتظار" : "Pending meeting requests", icon: "Calendar", tone: "amber" },
          { href: "/crm/meetings", label: isAr ? "الاجتماعات والتقويم" : "Meetings & calendar", description: isAr ? "جدول اليوم" : "Today's schedule", icon: "CalendarCheck", tone: "emerald" },
          { href: "/crm/my", label: isAr ? "يومي" : "My day", description: isAr ? "ما يجري مع اجتماعاتك" : "What's happening with your meetings", icon: "LayoutDashboard", tone: "indigo" },
          { href: "/tasks", label: isAr ? "مهامي" : "My tasks", description: isAr ? "المهام المسندة إليّ" : "Things assigned to me", icon: "ListTodo", tone: "rose" },
        ],
        shortcuts: tours,
      };
    }
    if (crmRole === "ADMIN" && !isPlatformAdmin) {
      return {
        pillLabel: isAr ? "أدمن CRM" : "CRM admin",
        pillTone: "indigo",
        actions: [
          { href: "/crm/sales-board", label: isAr ? "لوحة المبيعات" : "Sales board", description: isAr ? "بايبلاين على مستوى المؤسسة" : "Org-wide pipeline", icon: "TrendingUp", tone: "indigo" },
          { href: "/admin/settings", label: isAr ? "الإعدادات" : "Settings", description: isAr ? "مستخدمون · تصنيفات · منتجات" : "Users · taxonomy · products", icon: "FileText", tone: "amber" },
          { href: "/admin/users", label: isAr ? "المستخدمون" : "Users", description: isAr ? "إضافة · تعديل · تعيين" : "Add · edit · assign", icon: "Users", tone: "rose" },
          { href: "/crm/opportunities", label: isAr ? "الفرص" : "Opportunities", description: isAr ? "كل صفقة في النظام" : "Every deal in the system", icon: "Briefcase", tone: "emerald" },
        ],
        shortcuts: tours,
      };
    }
    return {
      pillLabel: isAr
        ? (crmRole === "ACCOUNT_MGR" ? "مدير حسابات" : "مندوب مبيعات")
        : (crmRole === "ACCOUNT_MGR" ? "Account manager" : "Sales rep"),
      pillTone: "sky",
      actions: [
        { href: "/crm/opportunities/new", label: isAr ? "فرصة جديدة" : "New opportunity", description: isAr ? "سجّل عميلًا" : "Log a lead", icon: "Plus", tone: "sky" },
        { href: "/crm/cold-leads", label: isAr ? "العملاء المحتملون" : "Cold leads", description: isAr ? "قائمة الاتصال" : "Your call queue", icon: "Phone", tone: "amber" },
        { href: "/crm/meetings", label: isAr ? "حجز اجتماع" : "Book a meeting", description: isAr ? "اطلب الاعتماد" : "Request approval", icon: "Calendar", tone: "rose" },
        { href: "/crm/my", label: isAr ? "بايبلايني" : "My pipeline", description: isAr ? "مكالمات وفرص اليوم" : "Today's calls + opps", icon: "LayoutDashboard", tone: "indigo" },
        { href: "/crm/opportunities", label: isAr ? "الفرص" : "Opportunities", description: isAr ? "كل ما تملك" : "Everything you own", icon: "Briefcase", tone: "violet" },
      ],
      shortcuts: [
        { href: "/crm/contacts", label: isAr ? "جهات الاتصال" : "Contacts" },
        { href: "/crm/reports", label: isAr ? "التقارير اليومية" : "Daily reports" },
        ...tours,
      ],
    };
  }

  if (modules.includes("partners") && partnerId) {
    return {
      pillLabel: isAr ? "شريك" : "Partner",
      pillTone: "emerald",
      actions: [
        { href: "/partners/leads", label: isAr ? "تسجيل عميل" : "Register a lead", description: isAr ? "أحضر عميلًا محتملًا" : "Bring in a prospect", icon: "Plus", tone: "sky" },
        { href: "/partners/deals", label: isAr ? "صفقاتي" : "My deals", description: isAr ? "الحالة · العمولات" : "Status · commissions", icon: "Handshake", tone: "emerald" },
        { href: "/partners/commissions", label: isAr ? "العمولات" : "Commissions", description: isAr ? "الأرباح · المدفوعات" : "Earnings · payouts", icon: "Receipt", tone: "amber" },
        { href: "/partners/dashboard", label: isAr ? "لوحة التحكم" : "Dashboard", description: isAr ? "الأرقام الرئيسية" : "Headline numbers", icon: "LayoutDashboard", tone: "indigo" },
      ],
      shortcuts: [
        { href: "/partners/contracts", label: isAr ? "العقود" : "Contracts" },
        { href: "/partners/invoices", label: isAr ? "الفواتير" : "Invoices" },
        { href: "/partners/notifications", label: isAr ? "الإشعارات" : "Notifications" },
      ],
    };
  }

  if (modules.includes("hr")) {
    if (hrRoles.includes("hr_manager")) {
      return {
        pillLabel: isAr ? "مدير الموارد البشرية" : "HR manager",
        pillTone: "indigo",
        actions: [
          { href: "/hr/dashboard", label: isAr ? "لوحة الموارد البشرية" : "HR dashboard", description: isAr ? "قائمة الإجراءات + مؤشرات" : "Action queue + KPIs", icon: "LayoutDashboard", tone: "indigo" },
          { href: "/hr/employees", label: isAr ? "الموظفون" : "Employees", description: isAr ? "تصفح + إضافة" : "Browse + add", icon: "Users", tone: "rose" },
          { href: "/hr/overtime/pending", label: isAr ? "اعتمادات الإضافي" : "Overtime approvals", description: isAr ? "بانتظار موافقتك" : "Awaiting your signoff", icon: "CheckSquare", tone: "emerald" },
          { href: "/hr/incidents/submit", label: isAr ? "تسجيل مخالفة" : "Submit incident", description: isAr ? "سجل تأديبي" : "Disciplinary record", icon: "AlertTriangle", tone: "amber" },
          { href: "/hr/payroll/monthly", label: isAr ? "رواتب الشهر" : "Monthly payroll", description: isAr ? "احتسب + اقفل" : "Calculate + lock", icon: "Wallet", tone: "violet" },
          { href: "/admin/users/new", label: isAr ? "إضافة موظف جديد" : "Onboard a hire", description: isAr ? "نموذج واحد لكل الوحدات" : "One form, every module", icon: "Plus", tone: "sky" },
        ],
        shortcuts: [
          { href: "/hr/org-chart", label: isAr ? "الهيكل التنظيمي" : "Org chart" },
          { href: "/hr/calendar", label: isAr ? "تقويم الإجازات" : "Time-off calendar" },
          ...tours,
        ],
      };
    }
    if (hrRoles.includes("accountant")) {
      return {
        pillLabel: isAr ? "المحاسب" : "Accountant",
        pillTone: "emerald",
        actions: [
          { href: "/hr/accountant", label: isAr ? "اللوحة المالية" : "Financial dashboard", description: isAr ? "الرواتب + التزام العمولات" : "Payroll + commission liability", icon: "Wallet", tone: "indigo" },
          { href: "/hr/payroll/monthly", label: isAr ? "تشغيل الرواتب" : "Run payroll", description: isAr ? "رواتب هذا الشهر" : "This month's salaries", icon: "Wallet", tone: "emerald" },
          { href: "/hr/bonuses/all", label: isAr ? "المكافآت" : "Bonuses", description: isAr ? "اعتماد / تسجيل" : "Approve / log", icon: "Plus", tone: "amber" },
          { href: "/hr/reports/excel", label: isAr ? "التقارير" : "Reports", description: isAr ? "تصدير Excel" : "Excel exports", icon: "FileText", tone: "violet" },
        ],
        shortcuts: tours,
      };
    }
    if (hrRoles.includes("team_lead")) {
      return {
        pillLabel: isAr ? "قائد الفريق" : "Team lead",
        pillTone: "violet",
        actions: [
          { href: "/hr/team", label: isAr ? "فريقي" : "My team", description: isAr ? "التابعون + ملخص الحضور" : "Reports + attendance roll-up", icon: "Users", tone: "indigo" },
          { href: "/hr/overtime/pending", label: isAr ? "اعتماد الإضافي" : "Approve overtime", description: isAr ? "طلبات قيد الانتظار" : "Pending requests", icon: "CheckSquare", tone: "emerald" },
          { href: "/hr/team/attendance", label: isAr ? "حضور اليوم" : "Today's attendance", description: isAr ? "من حضر" : "Who's in", icon: "Calendar", tone: "amber" },
          { href: "/tasks", label: isAr ? "مهامي" : "My tasks", description: isAr ? "المهام لديّ" : "Things on my plate", icon: "ListTodo", tone: "rose" },
        ],
        shortcuts: tours,
      };
    }
    return {
      pillLabel: isAr ? "موظف" : "Employee",
      pillTone: "rose",
      actions: [
        { href: "/hr/employee/home", label: isAr ? "صفحتي" : "My home", description: isAr ? "اليوم + أحدث الرواتب" : "Today + recent payslips", icon: "LayoutDashboard", tone: "indigo" },
        { href: "/hr/employee/attendance", label: isAr ? "تسجيل دخول / خروج" : "Check in / out", description: isAr ? "حالة اليوم" : "Today's status", icon: "Calendar", tone: "emerald" },
        { href: "/hr/employee/overtime", label: isAr ? "طلب إضافي" : "Request overtime", description: isAr ? "تقديم طلب" : "Submit a request", icon: "Plus", tone: "amber" },
        { href: "/hr/employee/tasks", label: isAr ? "مهامي" : "My tasks", description: isAr ? "ابدأ · أنهِ · أرفق" : "Start · end · attach", icon: "ListTodo", tone: "rose" },
        { href: "/hr/employee/salary", label: isAr ? "راتبي" : "My salary", description: isAr ? "الكشوف · السجل" : "Slips · history", icon: "Wallet", tone: "violet" },
        { href: "/hr/employee/profile", label: isAr ? "الملف الشخصي" : "Profile", description: isAr ? "بياناتي الشخصية" : "My personal info", icon: "Users", tone: "sky" },
      ],
      shortcuts: tours,
    };
  }

  return {
    pillLabel: isAr ? "مرحبًا" : "Welcome",
    pillTone: "indigo",
    actions: [
      { href: "/tasks", label: isAr ? "مهامي" : "My tasks", description: isAr ? "كل ما هو مسند إليّ" : "Everything assigned to me", icon: "ListTodo", tone: "indigo" },
      { href: "/today", label: isAr ? "اليوم" : "Today", description: isAr ? "اعتمادات · مكالمات · اجتماعات" : "Approvals · calls · meetings", icon: "ClipboardList", tone: "rose" },
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
  const { locale } = await getServerT();
  const isAr = locale === "ar";

  const persona = personaFor({
    modules,
    hrRoles,
    crmRole,
    partnerId,
    isPlatformAdmin,
    isAr,
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
