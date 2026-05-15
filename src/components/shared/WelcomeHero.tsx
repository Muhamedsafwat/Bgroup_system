"use client";

import Link from "next/link";
import {
  ArrowRight,
  Sparkles,
  LayoutDashboard,
  Users,
  TrendingUp,
  Briefcase,
  Calendar,
  ClipboardList,
  ListTodo,
  Wallet,
  CheckSquare,
  AlertTriangle,
  Plus,
  Handshake,
  Receipt,
  Workflow,
  Building2,
  Phone,
  FileText,
} from "lucide-react";
import type { ComponentType } from "react";
import { firstNameOf as _firstNameOf, timeOfDay as _timeOfDay, type Tone } from "@/lib/welcome";

/**
 * Server components can't serialize function references across the RSC
 * boundary, so we accept icon NAMES (strings) in props and resolve to the
 * actual icon component here on the client side.
 */
const ICONS: Record<string, ComponentType<{ className?: string }>> = {
  LayoutDashboard,
  Users,
  TrendingUp,
  Briefcase,
  Calendar,
  ClipboardList,
  ListTodo,
  Wallet,
  CheckSquare,
  AlertTriangle,
  Plus,
  Handshake,
  Receipt,
  Workflow,
  Building2,
  Phone,
  FileText,
};

export type WelcomeIconName = keyof typeof ICONS | string;

/**
 * Shared welcome hero used across the root landing (`/`) AND every per-module
 * home page. Same visual treatment everywhere so the user always lands on the
 * same calm welcome no matter how they arrive (login → /, sidebar → /hr/dashboard,
 * module switcher → /crm/my, etc.).
 *
 * Render the hero at the top of the page; render the page's specific dashboard
 * cards underneath.
 *
 * NOTE: `firstNameOf` and `timeOfDay` are pure functions that live in
 * `@/lib/welcome` (no "use client" boundary), so SERVER components can import
 * them directly. The re-exports below preserve the old import paths for
 * existing client callers; nothing should break.
 */

export type { Tone } from "@/lib/welcome";

export type WelcomeTile = {
  href: string;
  label: string;
  description: string;
  /// Name of a lucide-react icon (must be a key of the ICONS registry above).
  /// Passing a string instead of a component reference is the trick that lets
  /// this prop cross the server → client RSC boundary cleanly.
  icon: WelcomeIconName;
  tone: Tone;
};

const TONE_BG: Record<Tone, string> = {
  rose: "bg-rose-100",
  sky: "bg-sky-100",
  emerald: "bg-emerald-100",
  amber: "bg-amber-100",
  violet: "bg-violet-100",
  indigo: "bg-indigo-100",
};
const TONE_FG: Record<Tone, string> = {
  rose: "text-rose-600",
  sky: "text-sky-600",
  emerald: "text-emerald-600",
  amber: "text-amber-600",
  violet: "text-violet-600",
  indigo: "text-indigo-600",
};
const TONE_PILL: Record<Tone, string> = {
  rose: "text-rose-600",
  sky: "text-sky-600",
  emerald: "text-emerald-600",
  amber: "text-amber-600",
  violet: "text-violet-600",
  indigo: "text-indigo-600",
};

const GREETINGS = {
  morning: "Good morning",
  afternoon: "Good afternoon",
  evening: "Good evening",
} as const;

/// Re-exports so any existing `import { firstNameOf } from "@/components/shared/WelcomeHero"`
/// keeps working. New code should import from `@/lib/welcome` directly.
export const timeOfDay = _timeOfDay;
export const firstNameOf = _firstNameOf;

/**
 * Lightweight greeting banner used at the top of every module home page so
 * the welcome treatment carries through to /hr/dashboard, /crm/my,
 * /partners/dashboard, /admin etc. Just the time-of-day greeting + first
 * name + role pill — the dashboard content below provides the substance.
 */
export function WelcomeBanner({
  firstName,
  rolePill,
  pillTone = "indigo",
  email,
  subtitle,
}: {
  firstName: string;
  rolePill: string;
  pillTone?: Tone;
  email?: string | null;
  /** Optional second-line copy. Defaults to a friendly "Here's your..." line. */
  subtitle?: string;
}) {
  const greet = GREETINGS[timeOfDay()];
  return (
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2 pb-2">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
          {greet}, {firstName} <span aria-hidden>👋</span>
        </h1>
        <p className={`text-sm font-medium mt-0.5 ${TONE_PILL[pillTone]}`}>
          {rolePill}
          {email && (
            <span className="text-muted-foreground font-normal"> · {email}</span>
          )}
        </p>
      </div>
      {subtitle && (
        <p className="text-sm text-muted-foreground sm:text-end">{subtitle}</p>
      )}
    </div>
  );
}

/**
 * Tighter variant used on module home pages — same DNA as the full hero but
 * compact (no big brand mark) so it fits above existing dashboard content.
 */
export function WelcomeHero({
  greeting,
  firstName,
  rolePill,
  pillTone = "indigo",
  question,
  email,
  tiles,
  shortcuts,
  compact = false,
}: {
  greeting?: string;
  firstName: string;
  rolePill: string;
  pillTone?: Tone;
  question?: string;
  email?: string | null;
  tiles: WelcomeTile[];
  shortcuts?: { href: string; label: string }[];
  /** Compact = no big brand mark + tighter spacing, for module home pages */
  compact?: boolean;
}) {
  const greet = greeting ?? GREETINGS[timeOfDay()];

  return (
    <div className={compact ? "w-full" : "min-h-[60vh] flex items-center justify-center py-6"}>
      <div className="w-full max-w-4xl mx-auto">
        {/* Hero — brand mark + greeting + role pill */}
        <div className={`flex flex-col items-center text-center ${compact ? "mb-5" : "mb-8"}`}>
          {!compact && (
            <>
              <div className="h-14 w-14 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center mb-4 shadow-card">
                <Sparkles className="h-7 w-7" />
              </div>
              <p className="text-xs font-semibold tracking-[0.2em] uppercase text-primary mb-1">
                BGroup Super App
              </p>
            </>
          )}
          <h1 className={`font-bold text-foreground ${compact ? "text-2xl" : "text-3xl sm:text-4xl"}`}>
            {greet}, {firstName} <span aria-hidden>👋</span>
          </h1>
          <p className={`text-sm font-medium mt-1 ${TONE_PILL[pillTone]}`}>
            {rolePill}
            {email && (
              <span className="text-muted-foreground font-normal"> · {email}</span>
            )}
          </p>
        </div>

        {/* Subheading */}
        <p className="text-sm text-muted-foreground text-center mb-5">
          {question ?? "What do you want to do now?"}
        </p>

        {/* Quick action tiles */}
        {tiles.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            {tiles.map((a) => {
              const Icon = ICONS[a.icon] ?? LayoutDashboard;
              return (
                <Link
                  key={a.href}
                  href={a.href}
                  className="group rounded-2xl bg-card border border-border p-5 hover:border-primary/30 hover:shadow-card-hover transition-all flex flex-col items-center text-center"
                >
                  <div className={`h-14 w-14 rounded-2xl ${TONE_BG[a.tone]} flex items-center justify-center mb-3`}>
                    <Icon className={`h-6 w-6 ${TONE_FG[a.tone]}`} />
                  </div>
                  <p className="font-semibold text-foreground">{a.label}</p>
                  <p className="text-xs text-muted-foreground mt-1">{a.description}</p>
                </Link>
              );
            })}
          </div>
        )}

        {/* Shortcuts strip */}
        {shortcuts && shortcuts.length > 0 && (
          <div className="flex flex-col items-center gap-3 mb-2">
            <p className="text-xs text-muted-foreground uppercase tracking-widest flex items-center gap-2">
              <ArrowRight className="h-3 w-3" /> Shortcuts
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {shortcuts.map((s) => (
                <Link
                  key={s.href}
                  href={s.href}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 h-8 text-xs text-foreground hover:border-primary/40 hover:bg-primary/5 transition-colors"
                >
                  {s.label}
                  <ArrowRight className="h-3 w-3" />
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
