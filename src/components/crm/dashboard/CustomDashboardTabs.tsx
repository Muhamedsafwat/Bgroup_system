"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, LayoutDashboard, User } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { toast } from "sonner"; // audit v12 MEDIUM (MED-21)

/**
 * Wraps the rep's built-in "My Day" landing in a tab strip, exposing
 * every custom dashboard the current user has visibility into:
 *   - dashboards they OWN
 *   - dashboards with visibility = EVERYONE
 *   - dashboards with visibility = SPECIFIC where the user is on the
 *     CrmDashboardShare list
 *
 * The default tab is "My Day" — the existing MyDashboardClient — so
 * the page renders identically to the legacy UX when the user has no
 * custom dashboards (and the only added DOM is the tab strip).
 *
 * Per the user's request: a dashboard customised for a specific
 * individual appears as a tab on THEIR landing page, not anyone
 * else's. The /api/crm/dashboards visibility filter does that work;
 * this component just renders the result.
 */

type Widget = {
  kind: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  params?: Record<string, unknown>;
};

type Dashboard = {
  id: string;
  name: string;
  layoutJson: Widget[] | unknown;
  visibility: "OWNER" | "SPECIFIC" | "EVERYONE";
  ownerId: string;
  owner: { id: string; fullName: string } | null;
  mine: boolean;
};

function parseLayout(stored: unknown): Widget[] {
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((w): Widget[] => {
    if (typeof w !== "object" || w === null) return [];
    const obj = w as Record<string, unknown>;
    if (typeof obj.kind !== "string") return [];
    return [{ kind: obj.kind, x: typeof obj.x === "number" ? obj.x : undefined, y: typeof obj.y === "number" ? obj.y : undefined, w: typeof obj.w === "number" ? obj.w : undefined, h: typeof obj.h === "number" ? obj.h : undefined }];
  });
}

const WIDGET_LABELS: Record<string, { en: string; ar: string; description: string }> = {
  "kpi.pipeline": { en: "Weighted pipeline", ar: "خط الأنابيب المرجح", description: "Total weighted value of open opps." },
  "kpi.coverage": { en: "Coverage ratio", ar: "نسبة التغطية", description: "Weighted pipeline ÷ remaining quota." },
  "kpi.won-mtd": { en: "Won this month", ar: "ربحت هذا الشهر", description: "Count + value of opps closed-won." },
  "kpi.stalled": { en: "Stalled deals", ar: "صفقات متوقفة", description: "Opps past their stage maxDays." },
  leaderboard: { en: "Rep leaderboard", ar: "ترتيب المندوبين", description: "Reps ranked by attainment." },
  "stage-funnel": { en: "Pipeline by stage", ar: "خط الأنابيب حسب المرحلة", description: "Open opps per stage." },
  "loss-reasons": { en: "Why we lose", ar: "أسباب الخسارة", description: "Top loss reasons." },
  "win-rate": { en: "Win rate", ar: "معدل الفوز", description: "Win rate sliced by owner / source." },
  "activity-trend": { en: "Activity trend", ar: "اتجاه النشاط", description: "Calls + meetings per day." },
};

/**
 * Per-dashboard renderer. The widget tile catalogue is intentionally
 * a layout placeholder — actual KPI/chart wiring lives behind a
 * separate Tier-2 ticket. The contract here is: every widget the
 * admin picked is visible as a labelled tile so the recipient can
 * see WHAT was shared with them. Wiring each tile to its live data
 * source (recharts / KPI fetcher) is a follow-up; the sharing /
 * tab-discovery surface is what the user is asking for now.
 */
function DashboardBody({ layout, locale }: { layout: Widget[]; locale: "en" | "ar" }) {
  if (layout.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          {locale === "ar"
            ? "هذه اللوحة لا تحتوي على ويدجت بعد."
            : "This dashboard has no widgets yet."}
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
      {layout.map((w, idx) => {
        const meta = WIDGET_LABELS[w.kind];
        const title = meta ? (locale === "ar" ? meta.ar : meta.en) : w.kind;
        return (
          <Card key={`${w.kind}-${idx}`}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <LayoutDashboard className="h-3.5 w-3.5 text-muted-foreground" />
                {title}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {meta?.description ?? w.kind}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export function CustomDashboardTabs({ children }: { children: ReactNode }) {
  const { locale } = useLocale();
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [loading, setLoading] = useState(true);
  // audit v12 MEDIUM (MED-21): track fetch failures so we can notify the user.
  const [fetchError, setFetchError] = useState(false);
  // BUG FIX (audit v11 LOW #5): persist active tab in URL hash so a
  // bookmarked / refreshed tab survives the reload.
  const [active, setActive] = useState<string>(() => {
    if (typeof window === "undefined") return "__my-day";
    const hash = window.location.hash.replace(/^#/, "");
    return hash || "__my-day";
  });
  // audit v12 MEDIUM (MED-23): track initial mount so we use replaceState on
  // first render (no spurious history entry) then pushState on subsequent tab
  // changes so Back/Forward can navigate between tabs.
  const isInitialRender = useRef(true);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url =
      active === "__my-day"
        ? window.location.pathname + window.location.search
        : `#${active}`;
    if (isInitialRender.current) {
      // First render: set the URL without adding a history entry.
      history.replaceState(null, "", url);
      isInitialRender.current = false;
    } else {
      // Subsequent tab changes: push a new entry so Back/Forward work.
      history.pushState(null, "", url);
    }
  }, [active]);
  // audit v12 MEDIUM (MED-23): listen for popstate (Back/Forward) and restore
  // the correct tab from the URL hash.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handlePopState = () => {
      const hash = window.location.hash.replace(/^#/, "");
      setActive(hash || "__my-day");
    };
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Default visibility filter — own + EVERYONE + SPECIFIC-shared-with-me.
    // This is exactly the surface the recipient should see: a
    // dashboard the admin shared with them appears as a tab here.
    fetch("/api/crm/dashboards")
      // audit v12 MEDIUM (MED-21): throw on non-2xx so .catch() handles all failures uniformly.
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d) => {
        if (!cancelled) {
          const list: Dashboard[] = d?.dashboards ?? [];
          setDashboards(list);
          // audit v12 LOW (LOW-5): validate hash-derived active tab after load;
          // fall back to default if the referenced dashboard is no longer accessible.
          setActive((prev) =>
            prev === "__my-day" || list.some((x: Dashboard) => x.id === prev)
              ? prev
              : "__my-day"
          );
        }
      })
      .catch(() => {
        // audit v12 MEDIUM (MED-21): surface fetch failures to the user via toast.
        if (!cancelled) {
          setFetchError(true);
          toast.error("Could not load dashboards", { description: "Your custom dashboards could not be fetched. Showing default view." });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // No custom dashboards visible to this user (or fetch failed) → render the
  // legacy single-page layout. On error a toast was already shown above.
  // audit v12 MEDIUM (MED-21): include fetchError so a failed fetch also falls
  // back cleanly without leaving the user in an empty-tab state.
  if (!loading && (dashboards.length === 0 || fetchError)) {
    return <>{children}</>;
  }

  return (
    <Tabs value={active} onValueChange={setActive} className="space-y-4">
      <TabsList className="flex-wrap h-auto">
        <TabsTrigger value="__my-day">
          {locale === "ar" ? "يومي" : "My Day"}
        </TabsTrigger>
        {dashboards.map((d) => (
          <TabsTrigger key={d.id} value={d.id} className="gap-1.5">
            {d.name}
            {!d.mine && (
              <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                <User className="h-2.5 w-2.5 me-0.5" />
                {d.owner?.fullName ?? "shared"}
              </Badge>
            )}
          </TabsTrigger>
        ))}
        {loading && (
          <span className="inline-flex items-center text-xs text-muted-foreground ms-2">
            <Loader2 className="h-3 w-3 animate-spin me-1" />
            {locale === "ar" ? "تحميل..." : "Loading…"}
          </span>
        )}
      </TabsList>
      <TabsContent value="__my-day" className="space-y-4">
        {children}
      </TabsContent>
      {dashboards.map((d) => (
        <TabsContent key={d.id} value={d.id} className="space-y-4">
          <DashboardBody layout={parseLayout(d.layoutJson)} locale={locale} />
        </TabsContent>
      ))}
    </Tabs>
  );
}
