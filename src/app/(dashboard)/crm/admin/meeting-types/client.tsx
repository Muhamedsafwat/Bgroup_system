"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Trash2, RotateCcw, Pencil, X, Check, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  createMeetingTypeConfig,
  deleteMeetingTypeConfig,
  updateMeetingTypeConfig,
} from "../actions";

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

  const [addOpen, setAddOpen] = useState(false);
  const [addCode, setAddCode] = useState("");
  const [addLabelEn, setAddLabelEn] = useState("");
  const [addLabelAr, setAddLabelAr] = useState("");
  const [addSort, setAddSort] = useState(0);

  async function handleCreate() {
    setSaving(true);
    try {
      const row = (await createMeetingTypeConfig({
        code: addCode.trim().toUpperCase(),
        labelEn: addLabelEn.trim(),
        labelAr: addLabelAr.trim(),
        sortOrder: addSort,
      })) as Row;
      setRows([...rows, row].sort((a, b) => a.sortOrder - b.sortOrder));
      setAddOpen(false);
      setAddCode("");
      setAddLabelEn("");
      setAddLabelAr("");
      setAddSort(0);
      toast.success(`Meeting type "${row.labelEn}" added`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Add failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(r: Row) {
    const ok = window.confirm(
      `Permanently delete "${r.labelEn}" (${r.code})? Cannot be undone.`
    );
    if (!ok) return;
    setSaving(true);
    try {
      await deleteMeetingTypeConfig(r.id);
      setRows(rows.filter((x) => x.id !== r.id));
      toast.success(`"${r.labelEn}" deleted`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setSaving(false);
    }
  }

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
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Meeting types</h1>
          <p className="text-sm text-muted-foreground mt-1">
            The dropdown reps pick from when booking a meeting. Rename labels,
            reorder them, hide types you don&apos;t run, or add new ones. Codes
            must be UPPER_SNAKE (e.g. <span className="font-mono">SITE_VISIT</span>).
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)} disabled={saving}>
          <Plus className="me-1 h-4 w-4" />
          Add type
        </Button>
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
                        <Button size="sm" variant="ghost" onClick={() => startEdit(r)} title="Edit">
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => toggleActive(r)}
                          disabled={saving}
                          title={r.active ? "Hide" : "Restore"}
                        >
                          {r.active ? <X className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDelete(r)}
                          disabled={saving}
                          className="text-destructive hover:text-destructive"
                          title="Delete permanently"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
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

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add meeting type</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Code</Label>
              <Input
                value={addCode}
                onChange={(e) => setAddCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))}
                placeholder="SITE_VISIT"
                className="font-mono"
                maxLength={40}
              />
              <p className="text-xs text-muted-foreground">
                UPPER, digits, and underscores only.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Label (EN)</Label>
              <Input
                value={addLabelEn}
                onChange={(e) => setAddLabelEn(e.target.value)}
                placeholder="Site visit"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Label (AR)</Label>
              <Input
                value={addLabelAr}
                onChange={(e) => setAddLabelAr(e.target.value)}
                placeholder="زيارة الموقع"
                dir="rtl"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Sort order</Label>
              <Input
                type="number"
                value={addSort}
                onChange={(e) => setAddSort(Number(e.target.value) || 0)}
                min={0}
                max={999}
                className="w-24"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={saving || !addCode || !addLabelEn || !/^[A-Z0-9_]+$/.test(addCode)}
            >
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
