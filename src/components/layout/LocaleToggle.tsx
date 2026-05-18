"use client";

import { Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n";

/**
 * Compact language switcher rendered in the unified Header (every authenticated
 * page) and also embedded above the login form. Flips `<html dir>`, writes the
 * `bgroup-locale` cookie (1 year), and re-renders the dictionary instantly —
 * no page reload needed because every consumer reads `t` from the context.
 *
 * Why a single shared component instead of inlining: the toggle's exact
 * behaviour (cookie + dir + dictionary swap) must be consistent across every
 * surface. Inlining each time made it easy to forget one of those three
 * steps on a public page like /login, leaving the user stuck in whatever
 * Accept-Language guessed at first visit.
 */
export function LocaleToggle({
  size = "sm",
  variant = "outline",
  className,
}: {
  size?: "sm" | "icon";
  variant?: "outline" | "ghost";
  className?: string;
}) {
  const { locale, setLocale, t } = useLocale();
  const next = locale === "ar" ? "en" : "ar";
  const nextLabel = next === "ar" ? t.common.arabic : t.common.english;
  // The chip shows the language you'll get when you click it — clearer than
  // showing the current locale and forcing the user to guess what the click
  // does. Matches Twitter / Google's localized-account-switcher pattern.
  return (
    <Button
      variant={variant}
      size={size === "icon" ? "icon" : "sm"}
      className={className ?? (size === "icon" ? "h-8 w-8" : "h-8 gap-1.5 px-2.5")}
      onClick={() => setLocale(next)}
      aria-label={`Switch to ${nextLabel}`}
      title={`${t.common.language}: ${nextLabel}`}
    >
      <Languages className="h-4 w-4" />
      {size !== "icon" && (
        <span className="text-xs font-semibold uppercase tracking-wide">
          {next === "ar" ? "AR" : "EN"}
        </span>
      )}
    </Button>
  );
}
