"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type Company = { id: string; nameEn: string; nameAr: string | null };

/**
 * In-page searchable picker shown on `/crm/contacts/new` when no companyId
 * was provided in the URL. Picks one → redirects to the same route with
 * `?companyId=<id>` so the server component re-runs and renders the form.
 */
export function NewContactCompanyPicker({ companies }: { companies: Company[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return companies.slice(0, 50);
    return companies
      .filter(
        (c) =>
          c.nameEn.toLowerCase().includes(needle) ||
          (c.nameAr && c.nameAr.toLowerCase().includes(needle))
      )
      .slice(0, 50);
  }, [companies, q]);

  function pick(id: string) {
    router.push(`/crm/contacts/new?companyId=${encodeURIComponent(id)}`);
  }

  return (
    <Card>
      <CardContent className="p-3 space-y-3">
        <div className="relative">
          <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search companies…"
            className="ps-9"
            autoFocus
          />
        </div>
        <div className="max-h-80 overflow-y-auto rounded-md border divide-y">
          {filtered.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground text-center">
              No companies match. <Link href="/crm/companies/new" className="text-primary hover:underline">Create one</Link> first.
            </p>
          ) : (
            filtered.map((c) => (
              <button
                type="button"
                key={c.id}
                onClick={() => pick(c.id)}
                className="block w-full text-start px-3 py-2 hover:bg-accent transition-colors"
              >
                <span className="block text-sm font-medium">{c.nameEn}</span>
                {c.nameAr && <span className="block text-xs text-muted-foreground" dir="rtl">{c.nameAr}</span>}
              </button>
            ))
          )}
        </div>
        <div className="flex justify-end">
          <Link href="/crm/contacts">
            <Button variant="ghost" size="sm">Cancel</Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
