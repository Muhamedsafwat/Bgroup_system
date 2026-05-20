"use client";

import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { CommandPaletteProvider } from "@/components/layout/CommandPaletteProvider";
import { OnboardingWizard } from "@/components/onboarding/Wizard";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <CommandPaletteProvider>
      <div className="flex min-h-screen bg-background text-foreground">
        {/* Desktop sidebar (>= md) */}
        <div className="hidden md:flex">
          <Sidebar />
        </div>

        <div className="flex-1 flex flex-col min-w-0 overflow-x-hidden">
          <Header />
          {/* pb-16 on mobile so bottom-nav doesn't overlap the last row of
              content. min-w-0 on <main> prevents a wide child (long URL,
              long word, wide table without overflow-x) from pushing the
              whole page horizontally on phones. */}
          <main className="flex-1 bg-muted/30 pb-16 md:pb-0 min-w-0">
            <div className="px-3 md:px-6 py-4 md:py-6 min-w-0">{children}</div>
          </main>
        </div>

        <MobileBottomNav />
        <OnboardingWizard />
      </div>
    </CommandPaletteProvider>
  );
}
