"use client";

import { useSession } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  Users,
  TrendingUp,
  Handshake,
  ShieldCheck,
  ChevronDown,
} from "lucide-react";
import { useLocale } from "@/lib/i18n";

interface ModuleInfo {
  id: "hr" | "crm" | "partners" | "admin";
  label: string;
  icon: React.ElementType;
  defaultRoute: string;
  color: string;
  /** If true, only platform-admins see this entry. */
  adminOnly?: boolean;
}

function getModules(isAr: boolean): ModuleInfo[] {
  return [
    { id: "admin", label: isAr ? "الإدارة" : "Admin", icon: ShieldCheck, defaultRoute: "/admin", color: "text-rose-600", adminOnly: true },
    { id: "hr", label: isAr ? "نظام الموارد البشرية" : "HR System", icon: Users, defaultRoute: "/hr/dashboard", color: "text-indigo-600" },
    { id: "crm", label: isAr ? "CRM" : "CRM", icon: TrendingUp, defaultRoute: "/crm/sales-board", color: "text-emerald-600" },
    { id: "partners", label: isAr ? "الشركاء" : "Partners", icon: Handshake, defaultRoute: "/partners/dashboard", color: "text-amber-600" },
  ];
}

export function ModuleSwitcher({ collapsed }: { collapsed: boolean }) {
  const { data: session } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { locale } = useLocale();
  const MODULES = getModules(locale === "ar");

  const userModules = session?.user?.modules || [];
  const isPlatformAdmin =
    !!session?.user?.hrRoles?.includes("super_admin") ||
    (userModules.includes("partners") && !session?.user?.partnerId);

  // Filter: admin module visible only to platform admins; others gated by user.modules.
  const availableModules = MODULES.filter((m) => {
    if (m.id === "admin") return isPlatformAdmin;
    return userModules.includes(m.id as "hr" | "crm" | "partners");
  });

  // Detect active module from pathname
  const activeModule =
    pathname.startsWith("/admin")
      ? MODULES.find((m) => m.id === "admin")
      : MODULES.find((m) => pathname.startsWith(`/${m.id}`)) || availableModules[0];

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (availableModules.length <= 1) {
    // Single module — just show the label
    const mod = activeModule || availableModules[0];
    if (!mod) return null;
    const Icon = mod.icon;
    return (
      <div className={cn("flex items-center gap-2 px-3 py-2", collapsed && "justify-center px-0")}>
        <Icon className={cn("h-5 w-5", mod.color)} />
        {!collapsed && <span className="font-semibold text-sm">{mod.label}</span>}
      </div>
    );
  }

  const Icon = activeModule?.icon || Users;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-2 px-3 py-2 rounded-lg w-full hover:bg-accent transition-colors",
          collapsed && "justify-center px-2"
        )}
      >
        <Icon className={cn("h-5 w-5", activeModule?.color)} />
        {!collapsed && (
          <>
            <span className="font-semibold text-sm flex-1 text-left">{activeModule?.label}</span>
            <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
          </>
        )}
      </button>

      {open && (
        <div className={cn(
          "absolute z-50 mt-1 w-48 rounded-lg border bg-popover p-1 shadow-md",
          collapsed ? "left-full ml-2 top-0" : "left-0 top-full"
        )}>
          {availableModules.map((mod) => {
            const ModIcon = mod.icon;
            const isActive = activeModule?.id === mod.id;
            return (
              <button
                key={mod.id}
                onClick={() => {
                  router.push(mod.defaultRoute);
                  setOpen(false);
                }}
                className={cn(
                  "flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm transition-colors",
                  isActive ? "bg-accent font-medium" : "hover:bg-accent/50"
                )}
              >
                <ModIcon className={cn("h-4 w-4", mod.color)} />
                <span>{mod.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
