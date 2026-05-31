"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { useLocale } from "@/lib/i18n";
import {
  ClauseBuilder,
  type Clause,
  type FieldDef,
  clausesFromJson,
} from "@/components/crm/shared/ClauseBuilder";

type Rule = {
  id: string;
  name: string;
  scope: string;
  predicateJson: unknown;
  channels: string[];
  suppressionDays: number;
  isActive: boolean;
};

const OPP_FIELDS: FieldDef[] = [
  {
    key: "stage",
    label: "Stage",
    type: "enum",
    options: [
      { value: "NEW", label: "New" },
      { value: "CONTACTED", label: "Contacted" },
      { value: "DISCOVERY", label: "Discovery" },
      { value: "QUALIFIED", label: "Qualified" },
      { value: "TECH_MEETING", label: "Tech meeting" },
      { value: "PROPOSAL_SENT", label: "Proposal sent" },
      { value: "NEGOTIATION", label: "Negotiation" },
      { value: "VERBAL_YES", label: "Verbal yes" },
      { value: "WON", label: "Won" },
      { value: "LOST", label: "Lost" },
    ],
  },
  {
    key: "priority",
    label: "Priority",
    type: "enum",
    options: [
      { value: "HOT", label: "Hot" },
      { value: "WARM", label: "Warm" },
      { value: "COLD", label: "Cold" },
    ],
  },
  { key: "amount", label: "Value (EGP)", type: "number" },
  { key: "ageDays", label: "Days in current stage", type: "number" },
];

const LEAD_FIELDS: FieldDef[] = [
  {
    key: "status",
    label: "Status",
    type: "enum",
    options: [
      { value: "NEW", label: "New" },
      { value: "ASSIGNED", label: "Assigned" },
      { value: "NO_ANSWER", label: "No answer" },
      { value: "WAITING_LIST", label: "Waiting list" },
      { value: "NOT_INTERESTED", label: "Not interested" },
      { value: "CONVERTED", label: "Converted" },
      { value: "ARCHIVED", label: "Archived" },
    ],
  },
  { key: "attempts", label: "Contact attempts", type: "number" },
];

const CHANNEL_OPTIONS = [
  { value: "in-app", label: "In-app notification" },
  { value: "email", label: "Email" },
  { value: "slack", label: "Slack" },
];

const SUPPRESSION_PRESETS = [
  { value: 0, label: "No suppression" },
  { value: 1, label: "Once per day per record" },
  { value: 7, label: "Once per week per record" },
  { value: 30, label: "Once per month per record" },
];

export function AlertRulesClient() {
  const { locale } = useLocale();
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Rule | null>(null);

  const [name, setName] = useState("");
  const [scope, setScope] = useState<"opportunity" | "coldLead">("opportunity");
  const [clauses, setClauses] = useState<Clause[]>([]);
  const [channels, setChannels] = useState<Set<string>>(new Set(["in-app"]));
  const [suppression, setSuppression] = useState(1);

  const fields = scope === "opportunity" ? OPP_FIELDS : LEAD_FIELDS;

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/crm/admin/alert-rules");
      if (res.ok) setRules((await res.json()).rules ?? []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  function openCreate() {
    setEditing(null);
    setName("");
    setScope("opportunity");
    setClauses([]);
    setChannels(new Set(["in-app"]));
    setSuppression(1);
    setOpen(true);
  }
  function openEdit(r: Rule) {
    setEditing(r);
    setName(r.name);
    setScope(r.scope as "opportunity" | "coldLead");
    setClauses(clausesFromJson(r.predicateJson));
    setChannels(new Set(r.channels));
    setSuppression(r.suppressionDays);
    setOpen(true);
  }

  async function save() {
    if (!name.trim()) {
      toast.error("Pick a name");
      return;
    }
    if (clauses.length === 0) {
      toast.error("Add at least one condition");
      return;
    }
    if (channels.size === 0) {
      toast.error("Pick at least one channel");
      return;
    }
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        name,
        scope,
        predicateJson: clauses,
        channels: Array.from(channels),
        suppressionDays: suppression,
      };
      const res = await fetch("/api/crm/admin/alert-rules", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing ? { id: editing.id, ...body } : body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Save failed");
        return;
      }
      toast.success(editing ? "Rule updated" : "Rule created");
      setOpen(false);
      load();
    } finally {
      setBusy(false);
    }
  }

  async function toggle(r: Rule) {
    const res = await fetch("/api/crm/admin/alert-rules", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: r.id, isActive: !r.isActive }),
    });
    if (res.ok) load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          {locale === "ar" ? "قواعد التنبيه" : "Alert rules"}
        </h1>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 me-2" />
          {locale === "ar" ? "قاعدة جديدة" : "New rule"}
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {locale === "ar"
              ? "حدد متى يتم إرسال التنبيه عبر القنوات المختارة."
              : "Pick conditions and channels — system pings on matches."}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>
          ) : rules.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No alert rules yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Channels</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell><Badge variant="outline">{r.scope}</Badge></TableCell>
                    <TableCell className="flex gap-1 flex-wrap">
                      {r.channels.map((c) => (
                        <Badge key={c} variant="outline" className="text-[10px]">{c}</Badge>
                      ))}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => toggle(r)}>
                        {r.isActive ? "Active" : "Inactive"}
                      </Button>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>Edit</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit alert rule" : "New alert rule"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Big deal in proposal"
                  autoFocus
                />
              </div>
              <div>
                <Label className="text-xs">Watch</Label>
                <select
                  value={scope}
                  onChange={(e) => {
                    setScope(e.target.value as "opportunity" | "coldLead");
                    setClauses([]);
                  }}
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                >
                  <option value="opportunity">Opportunities</option>
                  <option value="coldLead">Cold leads</option>
                </select>
              </div>
            </div>

            <Card className="bg-muted/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Match when</CardTitle>
              </CardHeader>
              <CardContent>
                <ClauseBuilder
                  fields={fields}
                  clauses={clauses}
                  onChange={setClauses}
                  emptyLabel="Add condition"
                />
              </CardContent>
            </Card>

            <div>
              <Label className="text-xs">Send to</Label>
              <div className="grid grid-cols-3 gap-2 mt-1">
                {CHANNEL_OPTIONS.map((c) => (
                  <label
                    key={c.value}
                    className="flex items-center gap-2 rounded-md border p-2 cursor-pointer hover:bg-accent"
                  >
                    <Checkbox
                      checked={channels.has(c.value)}
                      onCheckedChange={(v) => {
                        setChannels((prev) => {
                          const next = new Set(prev);
                          if (v) next.add(c.value);
                          else next.delete(c.value);
                          return next;
                        });
                      }}
                    />
                    <span className="text-sm">{c.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-xs">Don&apos;t re-fire on same record</Label>
              <select
                value={suppression}
                onChange={(e) => setSuppression(Number(e.target.value))}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                {SUPPRESSION_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={save} disabled={busy || !name.trim()}>
              {busy && <Loader2 className="h-4 w-4 me-1.5 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
