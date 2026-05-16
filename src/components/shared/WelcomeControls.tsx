"use client";

import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import { useTheme } from "next-themes";
import { LogOut, Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Top-right control cluster shown on the root welcome page (`/`). The root
 * page lives OUTSIDE the (dashboard) layout group so it has no Header — these
 * two controls are the bare minimum so a user landing on the welcome screen
 * can still toggle theme and sign out without first clicking into a module.
 *
 * For pages INSIDE (dashboard), the regular Header already provides both, so
 * we don't render this on compact welcome surfaces (module-home banners).
 */
export function WelcomeControls() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = (theme === "system" ? resolvedTheme : theme) === "dark";

  return (
    <div className="absolute top-4 end-4 flex items-center gap-1.5 z-10">
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9"
        aria-label="Toggle theme"
        onClick={() => setTheme(isDark ? "light" : "dark")}
      >
        {mounted ? (
          isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />
        ) : (
          // Render an inert placeholder during SSR so the button reserves
          // space without flipping when the client mounts and reads theme.
          <Sun className="h-4 w-4 opacity-0" />
        )}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-9 gap-1.5"
        onClick={() => signOut({ callbackUrl: "/login" })}
        aria-label="Sign out"
      >
        <LogOut className="h-4 w-4" />
        <span className="hidden sm:inline text-sm">Sign out</span>
      </Button>
    </div>
  );
}
