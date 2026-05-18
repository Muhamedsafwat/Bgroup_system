"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useState } from "react";
import {
  LayoutDashboard,
  Users,
  TrendingUp,
  Phone,
  Handshake,
  DollarSign,
  Briefcase,
  Clock,
  ClipboardList,
  Menu,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Sidebar } from "@/components/layout/Sidebar";
import { useLocale } from "@/lib/i18n";
import type { Dictionary } from "@/lib/i18n";

type NavItem = { href: string; label: string; icon: LucideIcon };
type MobileT = Dictionary["mobileNav"];

function navForModule(
  module: "hr" | "crm" | "partners" | null,
  hrRoles: string[] | undefined,
  t: MobileT
): NavItem[] {
  if (module === "hr") {
    const isAdmin = hrRoles?.some((r) => ["super_admin", "hr_manager"].includes(r));
    if (isAdmin) {
      return [
        { href: "/hr/dashboard", label: t.home, icon: LayoutDashboard },
        { href: "/hr/employees", label: t.people, icon: Users },
        { href: "/hr/attendance/today", label: t.today, icon: Clock },
        { href: "/hr/payroll/monthly", label: t.pay, icon: DollarSign },
      ];
    }
    return [
      { href: "/hr/employee/home", label: t.home, icon: LayoutDashboard },
      { href: "/hr/employee/attendance", label: t.time, icon: Clock },
      { href: "/hr/employee/overtime", label: t.overtime, icon: ClipboardList },
      { href: "/hr/employee/salary", label: t.pay, icon: DollarSign },
    ];
  }
  if (module === "crm") {
    return [
      { href: "/crm/my", label: t.home, icon: LayoutDashboard },
      { href: "/crm/opportunities", label: t.pipeline, icon: TrendingUp },
      { href: "/crm/calls", label: t.calls, icon: Phone },
      { href: "/crm/companies", label: t.companies, icon: Briefcase },
    ];
  }
  if (module === "partners") {
    return [
      { href: "/partners/dashboard", label: t.home, icon: LayoutDashboard },
      { href: "/partners/leads", label: t.leads, icon: Users },
      { href: "/partners/deals", label: t.deals, icon: Handshake },
      { href: "/partners/commissions", label: t.earn, icon: DollarSign },
    ];
  }
  // Fallback: cross-module home
  return [
    { href: "/today", label: t.today, icon: LayoutDashboard },
    { href: "/hr/dashboard", label: t.hr, icon: Users },
    { href: "/crm/my", label: t.crm, icon: TrendingUp },
    { href: "/partners/dashboard", label: t.partners, icon: Handshake },
  ];
}

export function MobileBottomNav() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [moreOpen, setMoreOpen] = useState(false);
  const { t } = useLocale();

  const activeModule: "hr" | "crm" | "partners" | null = pathname.startsWith("/hr")
    ? "hr"
    : pathname.startsWith("/crm")
      ? "crm"
      : pathname.startsWith("/partners")
        ? "partners"
        : null;

  const items = navForModule(activeModule, session?.user?.hrRoles, t.mobileNav);

  function isActive(href: string) {
    if (pathname === href) return true;
    // Don't treat the module home as a prefix match for sub-pages.
    return pathname.startsWith(href + "/");
  }

  return (
    <>
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="grid grid-cols-5">
          {items.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex flex-col items-center justify-center gap-0.5 py-2 text-xs transition-colors",
                    active
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className="h-5 w-5" />
                  <span className="text-[10px] leading-none">{item.label}</span>
                </Link>
              </li>
            );
          })}
          <li>
            <button
              onClick={() => setMoreOpen(true)}
              className="w-full flex flex-col items-center justify-center gap-0.5 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
              aria-label={t.mobileNav.more}
            >
              <Menu className="h-5 w-5" />
              <span className="text-[10px] leading-none">{t.mobileNav.more}</span>
            </button>
          </li>
        </ul>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="left" className="p-0 w-72">
          <Sidebar />
        </SheetContent>
      </Sheet>
    </>
  );
}
