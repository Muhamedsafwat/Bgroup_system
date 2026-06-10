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
import { Loader2, Plus, Pencil } from "lucide-react";
import { toast } from "sonner";
import { useLocale } from "@/lib/i18n";

type Pipeline = {
  id: string;
  name: string;
  kind: string;
  defaultForKind: boolean;
  isActive: boolean;
  displayOrder: number;
  description: string | null;
};

/**
 * Tier-2 #31 — pipelines admin UI. Each pipeline has its own stages,
 * probabilities, and rules (configured via the existing stage-config
 * page once a pipeline is selected — kept simple here).
 */
export function PipelinesClient() {
  const { locale } = useLocale();
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Pipeline | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("new-business");
  const [description, setDescription] = useState("");

  // audit v12 MEDIUM (MED-68) recheck — add error toast for non-ok response
  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/crm/admin/pipelines");
      if (res.ok) {
        setPipelines((await res.json()).pipelines ?? []);
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Failed to load pipelines");
      }
    } catch {
      toast.error("Failed to load pipelines");
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
    setKind("new-business");
    setDescription("");
    setOpen(true);
  }
  function openEdit(p: Pipeline) {
    setEditing(p);
    setName(p.name);
    setKind(p.kind);
    setDescription(p.description ?? "");
    setOpen(true);
  }

  async function save() {
    setBusy(true);
    try {
      const body = { name, kind, description: description || undefined };
      const res = await fetch("/api/crm/admin/pipelines", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing ? { id: editing.id, ...body } : body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Save failed");
        return;
      }
      toast.success(editing ? "Pipeline updated" : "Pipeline created");
      setOpen(false);
      load();
    } finally {
      setBusy(false);
    }
  }

  // audit v12 MEDIUM (MED-68) recheck — add success/error toasts for toggle
  async function toggleActive(p: Pipeline) {
    const res = await fetch("/api/crm/admin/pipelines", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: p.id, isActive: !p.isActive }),
    });
    if (res.ok) {
      toast.success(p.isActive ? "Pipeline deactivated" : "Pipeline activated");
      load();
    } else {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? "Failed to update pipeline");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          {locale === "ar" ? "خطوط البيع" : "Sales pipelines"}
        </h1>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 me-2" />
          {locale === "ar" ? "خط جديد" : "New pipeline"}
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {locale === "ar"
              ? "كل خط بيع له مراحل ونسب احتمال خاصة به."
              : "Each pipeline owns its own stages + probabilities + rotting rules."}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{locale === "ar" ? "الاسم" : "Name"}</TableHead>
                  <TableHead>{locale === "ar" ? "النوع" : "Kind"}</TableHead>
                  <TableHead>{locale === "ar" ? "الوصف" : "Description"}</TableHead>
                  <TableHead>{locale === "ar" ? "افتراضي" : "Default"}</TableHead>
                  <TableHead>{locale === "ar" ? "نشط" : "Active"}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pipelines.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{p.kind}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {p.description ?? "—"}
                    </TableCell>
                    <TableCell>
                      {p.defaultForKind && (
                        <Badge variant="default" className="text-xs">
                          default
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => toggleActive(p)}
                      >
                        {p.isActive ? "Active" : "Inactive"}
                      </Button>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => openEdit(p)}>
                        <Pencil className="h-3.5 w-3.5 me-1" />
                        {locale === "ar" ? "تعديل" : "Edit"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {pipelines.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                      {locale === "ar" ? "لا توجد خطوط بيع بعد." : "No pipelines yet."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing
                ? locale === "ar"
                  ? "تعديل خط البيع"
                  : "Edit pipeline"
                : locale === "ar"
                  ? "خط بيع جديد"
                  : "New pipeline"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">{locale === "ar" ? "الاسم" : "Name"}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </div>
            <div>
              <Label className="text-xs">{locale === "ar" ? "النوع" : "Kind"}</Label>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                <option value="new-business">new-business</option>
                <option value="renewal">renewal</option>
                <option value="expansion">expansion</option>
                <option value="custom">custom</option>
              </select>
            </div>
            <div>
              <Label className="text-xs">{locale === "ar" ? "الوصف" : "Description"}</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              {locale === "ar" ? "إلغاء" : "Cancel"}
            </Button>
            <Button onClick={save} disabled={busy || !name.trim()}>
              {busy && <Loader2 className="h-4 w-4 me-1.5 animate-spin" />}
              {locale === "ar" ? "حفظ" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
