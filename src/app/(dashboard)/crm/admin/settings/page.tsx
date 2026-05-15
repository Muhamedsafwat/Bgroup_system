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
  ArrowRight,
  Target,
  Calendar,
} from "lucide-react";

export const dynamic = "force-dynamic";

const SETTINGS_LINKS = [
  { href: "/crm/admin/users", label: "Users", description: "Sales reps and their roles", icon: Users, tone: "tile-indigo" },
  { href: "/crm/admin/entities", label: "Entities", description: "Group subsidiaries selling under the CRM", icon: Landmark, tone: "tile-violet" },
  { href: "/crm/admin/fx-rates", label: "FX rates", description: "Currency conversions for opportunity values", icon: DollarSign, tone: "tile-emerald" },
  { href: "/crm/admin/stage-config", label: "Pipeline stages", description: "Stage probabilities and SLAs", icon: Layers, tone: "tile-amber" },
  { href: "/crm/admin/loss-reasons", label: "Loss reasons", description: "Why deals are marked lost", icon: AlertCircle, tone: "tile-rose" },
  { href: "/crm/admin/lead-sources", label: "Lead sources", description: "Where leads come from", icon: Tag, tone: "tile-sky" },
  { href: "/crm/admin/customer-needs", label: "Customer needs", description: "The dropdown reps pick from when booking meetings & tagging opps", icon: Target, tone: "tile-emerald" },
  { href: "/crm/admin/meeting-types", label: "Meeting types", description: "Rename & reorder meeting type labels", icon: Calendar, tone: "tile-amber" },
  { href: "/crm/products", label: "Products & services", description: "The catalogue of what reps sell", icon: Package, tone: "tile-violet" },
  { href: "/crm/group/health", label: "Pipeline health", description: "Stale opps + missing next-actions", icon: HeartPulse, tone: "tile-rose" },
];

export default async function CrmAdminSettingsPage() {
  // CRM settings have been consolidated under /admin/settings — that page
  // groups CRM, HR, Partners, and Users in one place. This route stays
  // alive only as a redirect so old bookmarks and sidebar entries don't 404.
  const session = await auth();
  if (!session?.user) redirect("/login");
  redirect("/admin/settings");
  // unreachable, satisfies the type checker for the unused JSX below:
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">CRM Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          One place for everything CRM admins manage — users, taxonomy, financial config, pipeline definition, and product catalogue.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {SETTINGS_LINKS.map((s) => (
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
    </div>
  );
}
