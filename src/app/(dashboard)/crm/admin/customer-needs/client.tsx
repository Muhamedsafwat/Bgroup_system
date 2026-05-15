"use client";

import { useState } from "react";
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
import { Plus, Trash2, RotateCcw, Pencil, X, Check } from "lucide-react";
import { toast } from "sonner";
import {
  createCustomerNeed,
  updateCustomerNeed,
} from "../actions";

type Need = {
  id: string;
  labelEn: string;
  labelAr: string;
  category: string;
  active: boolean;
  sortOrder: number;
};

export function CustomerNeedsClient({ initial }: { initial: Need[] }) {
  const [needs, setNeeds] = useState<Need[]>(initial);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Add form
  const [newLabel, setNewLabel] = useState("");
  const [newLabelAr, setNewLabelAr] = useState("");
  const [newCategory, setNewCategory] = useState("");

  // Edit form
  const [editLabel, setEditLabel] = useState("");
  const [editLabelAr, setEditLabelAr] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editSort, setEditSort] = useState(0);

  async function handleAdd() {
    if (!newLabel.trim()) {
      toast.error("Label is required");
      return;
    }
    setSaving(true);
    try {
      const created = await createCustomerNeed({
        labelEn: newLabel,
        labelAr: newLabelAr,
        category: newCategory,
        sortOrder: needs.length * 10,
      });
      setNeeds([...needs, created as Need]);
      setAdding(false);
      setNewLabel("");
      setNewLabelAr("");
      setNewCategory("");
      toast.success("Added");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(n: Need) {
    setEditingId(n.id);
    setEditLabel(n.labelEn);
    setEditLabelAr(n.labelAr);
    setEditCategory(n.category);
    setEditSort(n.sortOrder);
  }

  async function saveEdit(id: string) {
    setSaving(true);
    try {
      const updated = await updateCustomerNeed(id, {
        labelEn: editLabel,
        labelAr: editLabelAr,
        category: editCategory,
        sortOrder: editSort,
      });
      setNeeds(needs.map((n) => (n.id === id ? (updated as Need) : n)));
      setEditingId(null);
      toast.success("Saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(n: Need) {
    setSaving(true);
    try {
      const updated = await updateCustomerNeed(n.id, { active: !n.active });
      setNeeds(needs.map((x) => (x.id === n.id ? (updated as Need) : x)));
      toast.success(n.active ? "Hidden from picker" : "Restored");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Customer needs</h1>
          <p className="text-sm text-muted-foreground mt-1">
            The list that powers the &ldquo;What does the customer need?&rdquo; dropdown when reps book a meeting and tag opportunities. Hide an entry instead of deleting it so historical rows still display correctly.
          </p>
        </div>
        {!adding && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4 me-1" /> Add need
          </Button>
        )}
      </div>

      {adding && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
              <div>
                <Label className="text-xs">Label (English)</Label>
                <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} autoFocus />
              </div>
              <div>
                <Label className="text-xs">Label (Arabic)</Label>
                <Input value={newLabelAr} onChange={(e) => setNewLabelAr(e.target.value)} dir="rtl" />
              </div>
              <div>
                <Label className="text-xs">Category (optional)</Label>
                <Input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="e.g. Healthcare" />
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleAdd} disabled={saving || !newLabel.trim()}>
                  Add
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Sort</TableHead>
                <TableHead>Label (EN)</TableHead>
                <TableHead>Label (AR)</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-32">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {needs.map((n) => (
                <TableRow key={n.id} className={n.active ? "" : "opacity-60"}>
                  <TableCell>
                    {editingId === n.id ? (
                      <Input
                        type="number"
                        className="w-16"
                        value={editSort}
                        onChange={(e) => setEditSort(Number(e.target.value) || 0)}
                      />
                    ) : (
                      <span className="text-muted-foreground text-sm">{n.sortOrder}</span>
                    )}
                  </TableCell>
                  <TableCell className="font-medium">
                    {editingId === n.id ? (
                      <Input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} />
                    ) : (
                      n.labelEn
                    )}
                  </TableCell>
                  <TableCell>
                    {editingId === n.id ? (
                      <Input value={editLabelAr} onChange={(e) => setEditLabelAr(e.target.value)} dir="rtl" />
                    ) : (
                      <span className="text-muted-foreground">{n.labelAr || "—"}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {editingId === n.id ? (
                      <Input value={editCategory} onChange={(e) => setEditCategory(e.target.value)} />
                    ) : (
                      <span className="text-xs text-muted-foreground">{n.category || "—"}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {n.active ? (
                      <Badge variant="default" className="bg-emerald-600">Active</Badge>
                    ) : (
                      <Badge variant="secondary">Hidden</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {editingId === n.id ? (
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => saveEdit(n.id)} disabled={saving}>
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => startEdit(n)} title="Edit">
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => toggleActive(n)}
                          disabled={saving}
                          title={n.active ? "Hide from picker" : "Restore"}
                          className={n.active ? "text-destructive" : ""}
                        >
                          {n.active ? <Trash2 className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}
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
