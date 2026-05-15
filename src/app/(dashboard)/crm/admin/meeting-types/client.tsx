"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Trash2, RotateCcw, Pencil, X, Check } from "lucide-react";
import { toast } from "sonner";
import { updateMeetingTypeConfig } from "../actions";

type Row = {
  id: string;
  code: string;
  labelEn: string;
  labelAr: string;
  active: boolean;
  sortOrder: number;
};

export function MeetingTypesClient({ initial }: { initial: Row[] }) {
  const [rows, setRows] = useState<Row[]>(initial);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editLabelAr, setEditLabelAr] = useState("");
  const [editSort, setEditSort] = useState(0);
  const [saving, setSaving] = useState(false);

  function startEdit(r: Row) {
    setEditingId(r.id);
    setEditLabel(r.labelEn);
    setEditLabelAr(r.labelAr);
    setEditSort(r.sortOrder);
  }

  async function saveEdit(id: string) {
    setSaving(true);
    try {
      const updated = await updateMeetingTypeConfig(id, {
        labelEn: editLabel,
        labelAr: editLabelAr,
        sortOrder: editSort,
      });
      setRows(rows.map((r) => (r.id === id ? (updated as Row) : r)));
      setEditingId(null);
      toast.success("Saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(r: Row) {
    setSaving(true);
    try {
      const updated = await updateMeetingTypeConfig(r.id, { active: !r.active });
      setRows(rows.map((x) => (x.id === r.id ? (updated as Row) : x)));
      toast.success(r.active ? "Hidden" : "Restored");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Meeting types</h1>
        <p className="text-sm text-muted-foreground mt-1">
          The dropdown reps pick from when booking a meeting. The set of codes
          (DEMO / OFFICE_VISIT / FOLLOWUP / PROPOSAL / ONBOARDING) is fixed
          because they&apos;re tied to business rules, but you can rename the
          labels, reorder them, or hide types you don&apos;t run.
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Sort</TableHead>
                <TableHead className="w-32">Code</TableHead>
                <TableHead>Label (EN)</TableHead>
                <TableHead>Label (AR)</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-32">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} className={r.active ? "" : "opacity-60"}>
                  <TableCell>
                    {editingId === r.id ? (
                      <Input
                        type="number"
                        className="w-16"
                        value={editSort}
                        onChange={(e) => setEditSort(Number(e.target.value) || 0)}
                      />
                    ) : (
                      <span className="text-muted-foreground text-sm">{r.sortOrder}</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.code}</TableCell>
                  <TableCell className="font-medium">
                    {editingId === r.id ? (
                      <Input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} autoFocus />
                    ) : (
                      r.labelEn
                    )}
                  </TableCell>
                  <TableCell>
                    {editingId === r.id ? (
                      <Input value={editLabelAr} onChange={(e) => setEditLabelAr(e.target.value)} dir="rtl" />
                    ) : (
                      <span className="text-muted-foreground">{r.labelAr || "—"}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {r.active ? (
                      <Badge variant="default" className="bg-emerald-600">Active</Badge>
                    ) : (
                      <Badge variant="secondary">Hidden</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {editingId === r.id ? (
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => saveEdit(r.id)} disabled={saving}>
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => startEdit(r)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => toggleActive(r)}
                          disabled={saving}
                          className={r.active ? "text-destructive" : ""}
                        >
                          {r.active ? <Trash2 className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
