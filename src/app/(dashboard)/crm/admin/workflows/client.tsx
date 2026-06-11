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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useLocale } from "@/lib/i18n";
import {
  ClauseBuilder,
  type Clause,
  type FieldDef,
  clausesFromJson,
  clausesToJson,
} from "@/components/crm/shared/ClauseBuilder";

type Workflow = {
  id: string;
  name: string;
  description: string | null;
  triggerKind: string;
  triggerConfig: unknown;
  conditionJson: unknown;
  actionJson: unknown;
  suppressionWindowMinutes: number;
  isActive: boolean;
  lastFiredAt: string | null;
};

// Triggers + the fields available on the event payload for each.
// When the admin picks a trigger, both the "Only when" filter and
// the action's "field" picker know which fields exist on that event.
const TRIGGERS: {
  value: string;
  label: string;
  fields: FieldDef[];
}[] = [
  {
    value: "opp.stage.changed",
    label: "Opportunity stage changed",
    fields: [
      {
        key: "toStage",
        label: "New stage",
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
      { key: "fromStage", label: "Previous stage", type: "text" },
      { key: "durationDays", label: "Days in previous stage", type: "number" },
    ],
  },
  {
    value: "opp.created",
    label: "Opportunity created",
    fields: [
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
      { key: "estimatedValueEGP", label: "Value (EGP)", type: "number" },
    ],
  },
  {
    value: "lead.disposition",
    label: "Cold lead disposition",
    fields: [
      {
        key: "disposition",
        label: "Disposition",
        type: "enum",
        options: [
          { value: "ASSIGNED", label: "Assigned" },
          { value: "NO_ANSWER", label: "No answer" },
          { value: "WAITING_LIST", label: "Waiting list" },
          { value: "NOT_INTERESTED", label: "Not interested" },
          { value: "CONVERTED", label: "Converted" },
          { value: "ARCHIVED", label: "Archived" },
        ],
      },
    ],
  },
];

type ActionKind = "notify-in-app" | "set-field" | "tag-priority" | "create-task" | "log-only";

const ACTIONS: { value: ActionKind; label: string; help: string }[] = [
  { value: "notify-in-app", label: "Send a notification", help: "Write a message to the activity log of the affected opportunity." },
  { value: "tag-priority", label: "Change opportunity priority", help: "Set the priority to HOT / WARM / COLD." },
  { value: "set-field", label: "Set a field on the opportunity", help: "Update one field (priority, next action, stage, etc.)" },
  { value: "create-task", label: "Create a follow-up task", help: "Insert a task on the opportunity due in N days." },
  { value: "log-only", label: "Just log it (no side effect)", help: "Useful for testing rules before turning on real actions." },
];

const SET_FIELD_OPTIONS: { value: string; label: string; type: "text" | "enum"; options?: { value: string; label: string }[] }[] = [
  {
    value: "priority",
    label: "Priority",
    type: "enum",
    options: [
      { value: "HOT", label: "Hot" },
      { value: "WARM", label: "Warm" },
      { value: "COLD", label: "Cold" },
    ],
  },
  { value: "nextAction", label: "Next action", type: "text" },
  { value: "nextActionText", label: "Next action note", type: "text" },
  { value: "stage", label: "Stage", type: "text" },
  { value: "leadSource", label: "Lead source", type: "text" },
  { value: "description", label: "Description", type: "text" },
];

const SUPPRESSION_PRESETS = [
  { value: 0, label: "No suppression — fire every time" },
  { value: 60, label: "Once per hour per opp" },
  { value: 1440, label: "Once per day per opp" },
  { value: 10080, label: "Once per week per opp" },
];

export function WorkflowsClient() {
  const { locale } = useLocale();
  const [items, setItems] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Workflow | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [triggerKind, setTriggerKind] = useState("opp.stage.changed");
  const [triggerClauses, setTriggerClauses] = useState<Clause[]>([]);
  const [conditionClauses, setConditionClauses] = useState<Clause[]>([]);
  const [conditionMode, setConditionMode] = useState<"all" | "any">("all");
  const [actionKind, setActionKind] = useState<ActionKind>("notify-in-app");
  const [actionMessage, setActionMessage] = useState("");
  const [actionField, setActionField] = useState("priority");
  const [actionFieldValue, setActionFieldValue] = useState("");
  const [actionPriority, setActionPriority] = useState<"HOT" | "WARM" | "COLD">("HOT");
  const [actionTaskTitle, setActionTaskTitle] = useState("");
  const [actionTaskDueInDays, setActionTaskDueInDays] = useState(1);
  const [suppress, setSuppress] = useState(1440);

  const triggerDef = TRIGGERS.find((t) => t.value === triggerKind) ?? TRIGGERS[0];
  const setFieldDef = SET_FIELD_OPTIONS.find((f) => f.value === actionField);

  // audit v12 MEDIUM (MED-67): handle non-OK responses and network errors in load()
  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/crm/admin/workflows");
      if (res.ok) {
        setItems((await res.json()).workflows ?? []);
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error((data as { error?: string }).error ?? "Failed to load workflows");
      }
    } catch {
      toast.error("Network error — could not load workflows");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  function reset() {
    setName("");
    setDescription("");
    setTriggerKind("opp.stage.changed");
    setTriggerClauses([]);
    setConditionClauses([]);
    setConditionMode("all");
    setActionKind("notify-in-app");
    setActionMessage("");
    setActionField("priority");
    setActionFieldValue("");
    setActionPriority("HOT");
    setActionTaskTitle("");
    setActionTaskDueInDays(1);
    setSuppress(1440);
  }

  function openCreate() {
    setEditing(null);
    reset();
    setOpen(true);
  }

  function openEdit(w: Workflow) {
    setEditing(w);
    setName(w.name);
    setDescription(w.description ?? "");
    setTriggerKind(w.triggerKind);
    setTriggerClauses(clausesFromJson(w.triggerConfig));
    setConditionClauses(clausesFromJson(w.conditionJson));
    setConditionMode(
      w.conditionJson &&
        typeof w.conditionJson === "object" &&
        "any" in (w.conditionJson as object)
        ? "any"
        : "all"
    );
    const a = (w.actionJson as Record<string, unknown>) ?? {};
    const kind = (a.kind as ActionKind) ?? "log-only";
    setActionKind(kind);
    setActionMessage((a.message as string) ?? "");
    if (kind === "set-field") {
      setActionField((a.field as string) ?? "priority");
      setActionFieldValue(String(a.value ?? ""));
    }
    if (kind === "tag-priority") {
      setActionPriority((a.priority as "HOT" | "WARM" | "COLD") ?? "HOT");
    }
    if (kind === "create-task") {
      setActionTaskTitle((a.title as string) ?? "");
      setActionTaskDueInDays(Number(a.dueInDays ?? 1));
    }
    setSuppress(w.suppressionWindowMinutes);
    setOpen(true);
  }

  function buildActionJson(): Record<string, unknown> {
    switch (actionKind) {
      case "notify-in-app":
        return { kind: "notify-in-app", message: actionMessage || "Workflow notification" };
      case "set-field":
        return { kind: "set-field", field: actionField, value: actionFieldValue };
      case "tag-priority":
        return { kind: "tag-priority", priority: actionPriority };
      case "create-task":
        return {
          kind: "create-task",
          title: actionTaskTitle || "Follow up",
          dueInDays: actionTaskDueInDays,
        };
      case "log-only":
      default:
        return { kind: "log-only" };
    }
  }

  async function save() {
    if (!name.trim()) {
      toast.error("Pick a name");
      return;
    }
    setBusy(true);
    try {
      const triggerConfig = clausesToJson(triggerClauses, "all");
      const conditionJson = clausesToJson(conditionClauses, conditionMode);
      const body: Record<string, unknown> = {
        name,
        description: description || undefined,
        triggerKind,
        actionJson: buildActionJson(),
        suppressionWindowMinutes: suppress,
      };
      if (triggerConfig) body.triggerConfig = triggerConfig;
      if (conditionJson) body.conditionJson = conditionJson;
      const res = await fetch("/api/crm/admin/workflows", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing ? { id: editing.id, ...body } : body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Save failed");
        return;
      }
      toast.success(editing ? "Workflow updated" : "Workflow created");
      setOpen(false);
      load();
    } catch {
      // audit v12 MEDIUM (MED-67): surface network-level fetch failures in save()
      toast.error("Network error — could not save workflow");
    } finally {
      setBusy(false);
    }
  }

  async function deactivate(w: Workflow) {
    if (!confirm("Disable this workflow?")) return;
    const res = await fetch(`/api/crm/admin/workflows?id=${w.id}`, { method: "DELETE" });
    if (res.ok) load();
  }

  async function toggle(w: Workflow) {
    const res = await fetch("/api/crm/admin/workflows", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: w.id, isActive: !w.isActive }),
    });
    if (res.ok) load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          {locale === "ar" ? "الأتمتة" : "Workflows"}
        </h1>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 me-2" />
          {locale === "ar" ? "أتمتة جديدة" : "New workflow"}
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {locale === "ar"
              ? "اختر متى يعمل وما يفعل — لا حاجة لكتابة كود."
              : "Pick when it runs and what it does — no coding required."}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No workflows yet. Click <strong>New workflow</strong> to start.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Last fired</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell>
                      <div className="font-medium">{w.name}</div>
                      {w.description && (
                        <div className="text-xs text-muted-foreground">{w.description}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {TRIGGERS.find((t) => t.value === w.triggerKind)?.label ?? w.triggerKind}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {w.lastFiredAt ? new Date(w.lastFiredAt).toLocaleString() : "—"}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => toggle(w)}>
                        {w.isActive ? "Active" : "Inactive"}
                      </Button>
                    </TableCell>
                    <TableCell className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(w)}>
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => deactivate(w)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit workflow" : "New workflow"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            {/* Identity */}
            <div className="space-y-2">
              <div>
                <Label className="text-xs">Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Notify manager on big wins"
                  autoFocus
                />
              </div>
              <div>
                <Label className="text-xs">Description (optional)</Label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Tells the manager when a deal > 50k closes"
                />
              </div>
            </div>

            {/* 1. Trigger */}
            <Card className="bg-muted/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">1. When something happens</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label className="text-xs">Event</Label>
                  <select
                    value={triggerKind}
                    onChange={(e) => {
                      setTriggerKind(e.target.value);
                      setTriggerClauses([]);
                      setConditionClauses([]);
                    }}
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                  >
                    {TRIGGERS.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label className="text-xs">Only fire when…</Label>
                  <p className="text-[11px] text-muted-foreground mb-1.5">
                    Optional filter. Skip to fire on every event.
                  </p>
                  <ClauseBuilder
                    fields={triggerDef.fields}
                    clauses={triggerClauses}
                    onChange={setTriggerClauses}
                    emptyLabel="Add event filter"
                  />
                </div>
              </CardContent>
            </Card>

            {/* 2. Condition */}
            <Card className="bg-muted/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span>2. Only when these conditions match</span>
                  {conditionClauses.length > 1 && (
                    <select
                      value={conditionMode}
                      onChange={(e) => setConditionMode(e.target.value as "all" | "any")}
                      className="h-7 rounded-md border bg-background px-2 text-xs"
                    >
                      <option value="all">Match ALL</option>
                      <option value="any">Match ANY</option>
                    </select>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ClauseBuilder
                  fields={triggerDef.fields}
                  clauses={conditionClauses}
                  onChange={setConditionClauses}
                  emptyLabel="Add condition"
                />
              </CardContent>
            </Card>

            {/* 3. Action */}
            <Card className="bg-muted/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">3. Then do this</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label className="text-xs">Action</Label>
                  <select
                    value={actionKind}
                    onChange={(e) => setActionKind(e.target.value as ActionKind)}
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                  >
                    {ACTIONS.map((a) => (
                      <option key={a.value} value={a.value}>{a.label}</option>
                    ))}
                  </select>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {ACTIONS.find((a) => a.value === actionKind)?.help}
                  </p>
                </div>

                {actionKind === "notify-in-app" && (
                  <div>
                    <Label className="text-xs">Message</Label>
                    <Input
                      value={actionMessage}
                      onChange={(e) => setActionMessage(e.target.value)}
                      placeholder="Big deal closed!"
                    />
                  </div>
                )}

                {actionKind === "tag-priority" && (
                  <div>
                    <Label className="text-xs">New priority</Label>
                    <select
                      value={actionPriority}
                      onChange={(e) => setActionPriority(e.target.value as "HOT" | "WARM" | "COLD")}
                      className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                    >
                      <option value="HOT">Hot</option>
                      <option value="WARM">Warm</option>
                      <option value="COLD">Cold</option>
                    </select>
                  </div>
                )}

                {actionKind === "set-field" && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Field</Label>
                      <select
                        value={actionField}
                        onChange={(e) => {
                          setActionField(e.target.value);
                          setActionFieldValue("");
                        }}
                        className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                      >
                        {SET_FIELD_OPTIONS.map((f) => (
                          <option key={f.value} value={f.value}>{f.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label className="text-xs">New value</Label>
                      {setFieldDef?.type === "enum" && setFieldDef.options ? (
                        <select
                          value={actionFieldValue}
                          onChange={(e) => setActionFieldValue(e.target.value)}
                          className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                        >
                          <option value="">—</option>
                          {setFieldDef.options.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      ) : (
                        <Input
                          value={actionFieldValue}
                          onChange={(e) => setActionFieldValue(e.target.value)}
                        />
                      )}
                    </div>
                  </div>
                )}

                {actionKind === "create-task" && (
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2">
                      <Label className="text-xs">Task title</Label>
                      <Input
                        value={actionTaskTitle}
                        onChange={(e) => setActionTaskTitle(e.target.value)}
                        placeholder="Follow up on proposal"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Due in (days)</Label>
                      <Input
                        type="number"
                        min={0}
                        max={365}
                        value={actionTaskDueInDays}
                        onChange={(e) => setActionTaskDueInDays(Number(e.target.value) || 1)}
                      />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Suppression */}
            <div>
              <Label className="text-xs">How often can this fire on the same record?</Label>
              <select
                value={suppress}
                onChange={(e) => setSuppress(Number(e.target.value))}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                {SUPPRESSION_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground mt-1">
                Prevents the same workflow from spamming the same opportunity.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
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
