import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { SectionLanding } from "@/components/layout/SectionLanding";
import {
  UserCog,
  ClipboardList,
  FileBarChart,
  Layers,
  Bell,
  LayoutDashboard,
  Settings,
  Target,
  Trophy,
  DollarSign,
  Tag,
  Briefcase,
  Building2,
  AlertCircle,
  Package,
} from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * /crm/admin index landing. Without this page the route 404'd —
 * every admin tool sat at `/crm/admin/<thing>` but the parent had
 * no index. Now we render a section landing with everything the
 * caller's role can actually reach.
 */
export default async function CrmAdminLanding() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const role = session.user.crmRole;
  const platformAdmin =
    !!session.user.hrRoles?.includes("super_admin") ||
    (!!session.user.modules?.includes("partners") && !session.user.partnerId);
  const isAdmin = platformAdmin || role === "ADMIN";
  const isManagerOrAdmin = isAdmin || role === "MANAGER";

  if (!isManagerOrAdmin) {
    redirect("/crm/my");
  }

  // Cards split into People / Reports / Settings / Automation so the
  // 15+ links don't form a wall.
  const groups: Array<{
    label?: string;
    links: { href: string; title: string; description?: string; icon?: typeof UserCog }[];
  }> = [
    {
      label: "People",
      links: [
        {
          href: "/crm/admin/users",
          title: "Users",
          description: "Create reps, assign teams, change roles.",
          icon: UserCog,
        },
        {
          href: "/crm/admin/reassign-territory",
          title: "Reassign territory",
          description: "Move a rep's book to one or more other reps.",
          icon: UserCog,
        },
      ],
    },
    {
      label: "Reports",
      links: [
        {
          href: "/crm/admin/audit-log",
          title: "Audit log",
          description: "Cross-table feed of every CRM change.",
          icon: ClipboardList,
        },
        {
          href: "/crm/admin/loss-analytics",
          title: "Loss analytics",
          description: "Why deals die — sliced 5 ways.",
          icon: FileBarChart,
        },
        {
          href: "/crm/admin/sales-report",
          title: "Sales report",
          description: "Download a weekly sales Excel for any window.",
          icon: FileBarChart,
        },
      ],
    },
  ];

  if (isAdmin) {
    groups.push(
      {
        label: "Automation",
        links: [
          {
            href: "/crm/admin/workflows",
            title: "Workflows",
            description: "When X happens, do Y. No coding.",
            icon: Layers,
          },
          {
            href: "/crm/admin/alert-rules",
            title: "Alert rules",
            description: "Ping channels when records match conditions.",
            icon: Bell,
          },
          {
            href: "/crm/admin/dashboards",
            title: "Custom dashboards",
            description: "Saved widget layouts.",
            icon: LayoutDashboard,
          },
        ],
      },
      {
        label: "Settings",
        links: [
          {
            href: "/crm/admin/pipelines",
            title: "Pipelines",
            description: "Separate stage lineups for new biz / renewals.",
            icon: Layers,
          },
          {
            href: "/crm/admin/stage-config",
            title: "Stage config",
            description: "Probabilities, gates, rotting thresholds.",
            icon: Target,
          },
          {
            href: "/crm/admin/custom-fields",
            title: "Custom fields",
            description: "Add typed fields to opps / contacts / leads.",
            icon: Settings,
          },
          {
            href: "/crm/admin/entities",
            title: "Entities",
            description: "The companies we sell on behalf of.",
            icon: Building2,
          },
          {
            href: "/crm/admin/fx-rates",
            title: "FX rates",
            description: "Currency conversion to EGP.",
            icon: DollarSign,
          },
          {
            href: "/crm/admin/loss-reasons",
            title: "Loss reasons",
            description: "Picklist on the lost-deal close form.",
            icon: AlertCircle,
          },
          {
            href: "/crm/admin/lead-sources",
            title: "Lead sources",
            description: "Picklist on the opp create form.",
            icon: Tag,
          },
          {
            href: "/crm/admin/customer-needs",
            title: "Customer needs",
            description: "Picklist for meeting booking.",
            icon: Briefcase,
          },
          {
            href: "/crm/admin/meeting-types",
            title: "Meeting types",
            description: "Categories on the meeting calendar.",
            icon: Trophy,
          },
          {
            href: "/crm/products",
            title: "Products & services",
            description: "Catalogue attached to opps.",
            icon: Package,
          },
        ],
      },
    );
  }

  return (
    <SectionLanding
      title="CRM admin"
      description="Everything you can configure or report on, in one place."
      groups={groups}
    />
  );
}
