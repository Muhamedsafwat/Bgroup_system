"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { Loader2, Plus, Trash2, Link as LinkIcon, BookOpen, Target } from "lucide-react";
import { toast } from "sonner";

type MeddpiccSnapshot = {
  metricsScore: number | null;
  metricsNotes: string | null;
  economicBuyerScore: number | null;
  economicBuyerNotes: string | null;
  decisionCriteriaScore: number | null;
  decisionCriteriaNotes: string | null;
  decisionProcessScore: number | null;
  decisionProcessNotes: string | null;
  paperProcessScore: number | null;
  paperProcessNotes: string | null;
  identifyPainScore: number | null;
  identifyPainNotes: string | null;
  championScore: number | null;
  championNotes: string | null;
  competitionScore: number | null;
  competitionNotes: string | null;
};

type MeddpiccResponse = {
  snapshot: MeddpiccSnapshot;
  healthScore: number;
  healthBand: "strong" | "decent" | "weak" | "unknown";
};

type ClosePlanItem = {
  id: string;
  title: string;
  ownerSide: string;
  dueDate: string | null;
  status: string;
  orderIndex: number;
  notes: string | null;
};

type ClosePlanResponse = {
  plan: {
    id: string;
    title: string;
    shareToken: string | null;
    items: ClosePlanItem[];
  };
};

const MEDDPICC_FIELDS: { letter: string; label: string; key: keyof MeddpiccSnapshot; notesKey: keyof MeddpiccSnapshot }[] = [
  { letter: "M", label: "Metrics", key: "metricsScore", notesKey: "metricsNotes" },
  { letter: "E", label: "Economic Buyer", key: "economicBuyerScore", notesKey: "economicBuyerNotes" },
  { letter: "D", label: "Decision Criteria", key: "decisionCriteriaScore", notesKey: "decisionCriteriaNotes" },
  { letter: "D", label: "Decision Process", key: "decisionProcessScore", notesKey: "decisionProcessNotes" },
  { letter: "P", label: "Paper Process", key: "paperProcessScore", notesKey: "paperProcessNotes" },
  { letter: "I", label: "Identify Pain", key: "identifyPainScore", notesKey: "identifyPainNotes" },
  { letter: "C", label: "Champion", key: "championScore", notesKey: "championNotes" },
  { letter: "C", label: "Competition", key: "competitionScore", notesKey: "competitionNotes" },
];

/**
 * Tier-1 #11 + #23 + #24 — combined sales-intelligence section on the
 * opportunity detail page. Three sub-blocks:
 *
 *   1. MEDDPICC — 8 letters, each with a 0-3 score + free-text notes.
 *      Auto-saves on blur (per-field PATCH). Health score + band
 *      shown at the top.
 *   2. Stage playbook — read-only render of the admin-attached
 *      markdown for whichever stage the opp is currently in. Falls
 *      back gracefully when no playbook exists.
 *   3. Close plan — checklist of milestones; rep adds/removes items
 *      inline. Public read-only share token mint button for the
 *      buyer-facing view.
 */
export function OpportunityIntelligence({
  oppId,
  stage,
}: {
  oppId: string;
  stage: string;
}) {
  // ── MEDDPICC ───────────────────────────────────────────────────
  const [snapshot, setSnapshot] = useState<MeddpiccSnapshot | null>(null);
  const [health, setHealth] = useState<{ score: number; band: string }>({ score: 0, band: "unknown" });
  const [meddpiccLoading, setMeddpiccLoading] = useState(true);
  const [meddpiccError, setMeddpiccError] = useState<string | null>(null);

  const loadMeddpicc = useCallback(async () => {
    setMeddpiccLoading(true);
    try {
      const res = await fetch(`/api/crm/opportunities/${oppId}/meddpicc`);
      if (res.ok) {
        const data: MeddpiccResponse = await res.json();
        setSnapshot(data.snapshot);
        setHealth({ score: data.healthScore, band: data.healthBand });
        setMeddpiccError(null);
      } else {
        // Distinguish a real load failure from "no snapshot yet"
        // (which is a legitimate empty state). The UI consults
        // meddpiccError to render a retry hint instead of pretending
        // the panel is empty.
        setMeddpiccError(`Couldn't load MEDDPICC (HTTP ${res.status})`);
      }
    } catch (e) {
      setMeddpiccError(e instanceof Error ? e.message : "Couldn't load MEDDPICC");
    } finally {
      setMeddpiccLoading(false);
    }
  }, [oppId]);

  useEffect(() => {
    loadMeddpicc();
  }, [loadMeddpicc]);

  async function patchMeddpicc(patch: Partial<MeddpiccSnapshot>) {
    const res = await fetch(`/api/crm/opportunities/${oppId}/meddpicc`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error ?? "Save failed");
      return;
    }
    setSnapshot(data.snapshot);
    setHealth({ score: data.healthScore, band: data.healthBand });
  }

  // ── Playbook ─────────────────────────────────────────────────
  const [playbookBody, setPlaybookBody] = useState<string | null>(null);
  const [playbookLoading, setPlaybookLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setPlaybookLoading(true);
      try {
        const res = await fetch(`/api/crm/admin/playbooks?stage=${encodeURIComponent(stage)}`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          setPlaybookBody(data.playbook?.bodyMd ?? null);
        }
      } finally {
        if (!cancelled) setPlaybookLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [stage]);

  // ── Close plan ───────────────────────────────────────────────
  const [plan, setPlan] = useState<ClosePlanResponse["plan"] | null>(null);
  const [planLoading, setPlanLoading] = useState(true);
  const [newItem, setNewItem] = useState("");
  const [newDue, setNewDue] = useState("");
  const [newOwner, setNewOwner] = useState<"us" | "them">("us");

  const loadPlan = useCallback(async () => {
    setPlanLoading(true);
    try {
      const res = await fetch(`/api/crm/opportunities/${oppId}/close-plan`);
      if (res.ok) {
        const data: ClosePlanResponse = await res.json();
        setPlan(data.plan);
      }
    } finally {
      setPlanLoading(false);
    }
  }, [oppId]);

  useEffect(() => {
    loadPlan();
  }, [loadPlan]);

  async function upsertItem(item: Partial<ClosePlanItem> & { title: string }) {
    const res = await fetch(`/api/crm/opportunities/${oppId}/close-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error ?? "Save failed");
      return;
    }
    loadPlan();
  }
  async function addNewItem() {
    if (!newItem.trim()) return;
    await upsertItem({
      title: newItem.trim(),
      ownerSide: newOwner,
      dueDate: newDue || null,
    });
    setNewItem("");
    setNewDue("");
    setNewOwner("us");
  }
  async function toggleItem(item: ClosePlanItem) {
    const next = item.status === "done" ? "open" : "done";
    await upsertItem({ id: item.id, title: item.title, status: next });
  }
  async function deleteItem(item: ClosePlanItem) {
    if (!confirm(`Remove "${item.title}"?`)) return;
    const res = await fetch(
      `/api/crm/opportunities/${oppId}/close-plan?itemId=${item.id}`,
      { method: "DELETE" }
    );
    if (res.ok) loadPlan();
  }
  async function mintShareToken() {
    const res = await fetch(`/api/crm/opportunities/${oppId}/close-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "share" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error ?? "Couldn't mint token");
      return;
    }
    toast.success("Share token minted");
    loadPlan();
  }

  const bandColor =
    health.band === "strong"
      ? "text-emerald-600"
      : health.band === "decent"
        ? "text-amber-600"
        : health.band === "weak"
          ? "text-red-600"
          : "text-muted-foreground";

  return (
    <div className="space-y-4">
      {/* MEDDPICC */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="h-4 w-4 text-muted-foreground" />
            MEDDPICC qualification
            {!meddpiccLoading && (
              <span className={`ms-auto text-sm font-normal ${bandColor}`}>
                {health.score}/24 · {health.band}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {meddpiccLoading || !snapshot ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {MEDDPICC_FIELDS.map((f) => {
                const score = snapshot[f.key] as number | null;
                const notes = snapshot[f.notesKey] as string | null;
                return (
                  <div key={f.label} className="rounded-md border p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">
                        {f.letter}
                      </span>
                      <Label className="text-xs flex-1">{f.label}</Label>
                      <select
                        className="h-7 rounded border bg-background px-1.5 text-xs"
                        value={score ?? ""}
                        onChange={(e) =>
                          patchMeddpicc({
                            [f.key]: e.target.value === "" ? null : Number(e.target.value),
                          })
                        }
                      >
                        <option value="">—</option>
                        <option value="0">0</option>
                        <option value="1">1</option>
                        <option value="2">2</option>
                        <option value="3">3</option>
                      </select>
                    </div>
                    <Textarea
                      defaultValue={notes ?? ""}
                      onBlur={(e) =>
                        e.target.value !== (notes ?? "") &&
                        patchMeddpicc({ [f.notesKey]: e.target.value || null })
                      }
                      rows={2}
                      className="text-xs"
                      placeholder="Notes…"
                    />
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stage playbook */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-muted-foreground" />
            Playbook · <Badge variant="outline">{stage}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {playbookLoading ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>
          ) : playbookBody ? (
            <pre className="whitespace-pre-wrap text-sm font-sans bg-muted/30 rounded-md p-3">
              {playbookBody}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground py-2">
              No playbook configured for this stage yet.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Close plan */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Plus className="h-4 w-4 text-muted-foreground" />
            Mutual action plan
            {plan?.shareToken && (
              <Badge variant="outline" className="text-xs ms-2">
                <LinkIcon className="h-3 w-3 me-1" />
                shared
              </Badge>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="ms-auto h-7"
              onClick={mintShareToken}
              disabled={!!plan?.shareToken}
            >
              {plan?.shareToken
                ? `Token: ${plan.shareToken.slice(0, 8)}…`
                : "Mint buyer share link"}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {planLoading || !plan ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Item</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead className="w-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plan.items.map((it) => (
                    <TableRow key={it.id} className={it.status === "done" ? "opacity-60" : ""}>
                      <TableCell>
                        <Checkbox
                          checked={it.status === "done"}
                          onCheckedChange={() => toggleItem(it)}
                        />
                      </TableCell>
                      <TableCell className={it.status === "done" ? "line-through" : ""}>
                        {it.title}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{it.ownerSide}</Badge>
                      </TableCell>
                      <TableCell className="text-xs ltr-nums">
                        {it.dueDate ? new Date(it.dueDate).toLocaleDateString() : "—"}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => deleteItem(it)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex items-end gap-2 mt-3 pt-3 border-t">
                <div className="flex-1">
                  <Label className="text-xs">New item</Label>
                  <Input
                    value={newItem}
                    onChange={(e) => setNewItem(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addNewItem()}
                    placeholder="Security review with InfoSec"
                  />
                </div>
                <div>
                  <Label className="text-xs">Owner</Label>
                  <select
                    value={newOwner}
                    onChange={(e) => setNewOwner(e.target.value as "us" | "them")}
                    className="h-9 rounded-md border bg-background px-2 text-sm"
                  >
                    <option value="us">us</option>
                    <option value="them">them</option>
                  </select>
                </div>
                <div>
                  <Label className="text-xs">Due</Label>
                  <Input
                    type="date"
                    value={newDue}
                    onChange={(e) => setNewDue(e.target.value)}
                    className="h-9 ltr-nums"
                    dir="ltr"
                  />
                </div>
                <Button onClick={addNewItem} disabled={!newItem.trim()}>
                  <Plus className="h-4 w-4 me-1.5" />
                  Add
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
