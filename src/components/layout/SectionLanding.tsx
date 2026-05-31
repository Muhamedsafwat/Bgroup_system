import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Generic "section landing" — replaces the empty 404 you'd otherwise
 * hit when navigating to a parent route like `/crm/admin` or
 * `/partners/admin`. Renders a card grid linking to every available
 * sub-page in the section. Used by the small `page.tsx` files that
 * sit at each route's index.
 */
export type SectionLink = {
  href: string;
  title: string;
  description?: string;
  icon?: LucideIcon;
};

export function SectionLanding({
  title,
  description,
  groups,
}: {
  title: string;
  description?: string;
  /// Pass either a flat array OR groups of related links. The card
  /// renderer flattens groups into a single grid with subheaders so
  /// pages with 15+ links (CRM admin) stay scannable.
  groups: Array<{ label?: string; links: SectionLink[] }>;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        )}
      </div>
      {groups.map((g, i) => (
        <div key={i} className="space-y-2">
          {g.label && (
            <h2 className="text-xs uppercase text-muted-foreground font-semibold tracking-wide">
              {g.label}
            </h2>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {g.links.map((link) => {
              const Icon = link.icon;
              return (
                <Link key={link.href} href={link.href}>
                  <Card className="hover:bg-muted/40 transition-colors cursor-pointer">
                    <CardContent className="p-4 flex items-start gap-3">
                      {Icon && (
                        <Icon className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">{link.title}</p>
                        {link.description && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {link.description}
                          </p>
                        )}
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
