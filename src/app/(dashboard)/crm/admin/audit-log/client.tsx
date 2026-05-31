"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, History, Filter } from "lucide-react";
import { useLocale } from "@/lib/i18n";

type Entry = {
  source: "activity" | "stage" | "disposition";
  at: string;
  action: string;
  actor: { id: string; fullName: string } | null;
  entityType: "opportunity" | "coldLead";
  entityId: string;
  entityLabel: string | null;
  detail: Record<string, unknown>;
};

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

/**
 * Tier-0 #8 — CRM audit feed. One date window + 3 secondary filters
 * (actor, action, entityId). The endpoint merges three audit sources
 * into a time-ordered list; the client just renders it.
 */
export function AuditLogClient() {
  const { locale } = useLocale();
  const today = new Date();
  const sevenAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const [from, setFrom] = useState(ymd(sevenAgo));
  const [to, setTo] = useState(ymd(today));
  const [actorId, setActorId] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [entityIdFilter, setEntityIdFilter] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [count, setCount] = useState(0);
  const [truncated, setTruncated] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ from, to });
      if (actorId.trim()) params.set("actorId", actorId.trim());
      if (actionFilter.trim()) params.set("action", actionFilter.trim());
      if (entityIdFilter.trim()) params.set("entityId", entityIdFilter.trim());
      const res = await fetch(`/api/crm/admin/audit-log?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries ?? []);
        setCount(data.count ?? 0);
        setTruncated(!!data.truncated);
      }
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          {locale === "ar" ? "سجل التدقيق" : "Audit log"}
        </h1>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            {locale === "ar" ? "تصفية" : "Filters"}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-5 gap-3 items-end">
          <div>
            <Label className="text-xs">{locale === "ar" ? "من" : "From"}</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 ltr-nums" dir="ltr" />
          </div>
          <div>
            <Label className="text-xs">{locale === "ar" ? "إلى" : "To"}</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 ltr-nums" dir="ltr" />
          </div>
          <div>
            <Label className="text-xs">{locale === "ar" ? "معرّف المستخدم" : "Actor ID"}</Label>
            <Input
              value={actorId}
              onChange={(e) => setActorId(e.target.value)}
              placeholder="crmProfileId"
              className="h-8"
            />
          </div>
          <div>
            <Label className="text-xs">{locale === "ar" ? "نوع الإجراء" : "Action"}</Label>
            <Input
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              placeholder="OWNER_REASSIGNED"
              className="h-8"
            />
          </div>
          <Button size="sm" onClick={load} disabled={loading}>
            {loading && <Loader2 className="h-3.5 w-3.5 me-1.5 animate-spin" />}
            {locale === "ar" ? "تطبيق" : "Apply"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" />
            {locale === "ar" ? `${count} حدث` : `${count} entries`}
            {truncated && (
              <Badge variant="outline" className="text-amber-700 dark:text-amber-300">
                {locale === "ar" ? "مُقتطع — ضيّق النطاق" : "truncated — narrow the range"}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              {locale === "ar" ? "لا أحداث في هذا النطاق." : "No entries in this window."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{locale === "ar" ? "الوقت" : "When"}</TableHead>
                  <TableHead>{locale === "ar" ? "الفاعل" : "Actor"}</TableHead>
                  <TableHead>{locale === "ar" ? "الإجراء" : "Action"}</TableHead>
                  <TableHead>{locale === "ar" ? "الكيان" : "Entity"}</TableHead>
                  <TableHead>{locale === "ar" ? "التفاصيل" : "Detail"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e, idx) => (
                  <TableRow key={`${e.source}-${e.entityId}-${e.at}-${idx}`}>
                    <TableCell className="ltr-nums text-xs whitespace-nowrap">
                      {new Date(e.at).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-sm">{e.actor?.fullName ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {e.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      <span className="text-muted-foreground text-xs">{e.entityType}</span>{" "}
                      {e.entityLabel ?? e.entityId.slice(0, 8)}
                    </TableCell>
                    <TableCell className="text-xs">
                      <pre className="whitespace-pre-wrap break-words max-w-xs font-mono opacity-70">
                        {Object.entries(e.detail)
                          .filter(([, v]) => v != null && v !== "")
                          .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
                          .join("\n") || "—"}
                      </pre>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
