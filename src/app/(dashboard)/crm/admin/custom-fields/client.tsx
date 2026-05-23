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
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useLocale } from "@/lib/i18n";

type Def = {
  id: string;
  objectType: string;
  slug: string;
  label: string;
  kind: string;
  required: boolean;
  displayOrder: number;
  active: boolean;
  definition: unknown;
};

const OBJECT_TYPES = ["opportunity", "contact", "coldLead", "company"] as const;
const KINDS = ["text", "number", "picklist", "date", "boolean", "lookup"] as const;

/**
 * Tier-2 #37 — custom-fields meta-schema admin. Grouped by objectType.
 * For picklist kind, the JSON `definition` carries `{ options: [...] }`.
 */
export function CustomFieldsClient() {
  const { locale } = useLocale();
  const [defs, setDefs] = useState<Def[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [objectType, setObjectType] = useState<(typeof OBJECT_TYPES)[number]>("opportunity");
  const [slug, setSlug] = useState("");
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<(typeof KINDS)[number]>("text");
  const [required, setRequired] = useState(false);
  const [picklistOptions, setPicklistOptions] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/crm/admin/custom-fields");
      if (res.ok) setDefs((await res.json()).defs ?? []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  function reset() {
    setObjectType("opportunity");
    setSlug("");
    setLabel("");
    setKind("text");
    setRequired(false);
    setPicklistOptions("");
  }
  function openCreate() {
    reset();
    setOpen(true);
  }

  async function save() {
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        objectType,
        slug,
        label,
        kind,
        required,
      };
      if (kind === "picklist" && picklistOptions.trim()) {
        body.definition = {
          options: picklistOptions
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
        };
      }
      const res = await fetch("/api/crm/admin/custom-fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Save failed");
        return;
      }
      toast.success("Custom field created");
      setOpen(false);
      load();
    } finally {
      setBusy(false);
    }
  }

  async function softDelete(id: string) {
    if (!confirm("Deactivate this custom field? Existing values stay readable.")) return;
    const res = await fetch(`/api/crm/admin/custom-fields?id=${id}`, { method: "DELETE" });
    if (res.ok) load();
  }

  const grouped = OBJECT_TYPES.map((t) => ({
    objectType: t,
    items: defs.filter((d) => d.objectType === t),
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          {locale === "ar" ? "حقول مخصصة" : "Custom fields"}
        </h1>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 me-2" />
          {locale === "ar" ? "حقل جديد" : "New field"}
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>
      ) : (
        grouped.map((g) => (
          <Card key={g.objectType}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base capitalize">
                {g.objectType} ({g.items.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {g.items.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-2">
                  {locale === "ar" ? "لا حقول مخصصة." : "No custom fields yet."}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{locale === "ar" ? "التسمية" : "Label"}</TableHead>
                      <TableHead>{locale === "ar" ? "المعرّف" : "Slug"}</TableHead>
                      <TableHead>{locale === "ar" ? "النوع" : "Kind"}</TableHead>
                      <TableHead>{locale === "ar" ? "مطلوب" : "Required"}</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {g.items.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell className="font-medium">{d.label}</TableCell>
                        <TableCell>
                          <code className="text-xs">{d.slug}</code>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{d.kind}</Badge>
                        </TableCell>
                        <TableCell>
                          {d.required && <Badge variant="default" className="text-xs">required</Badge>}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive"
                            onClick={() => softDelete(d.id)}
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
        ))
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{locale === "ar" ? "حقل جديد" : "New custom field"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Object</Label>
                <select
                  value={objectType}
                  onChange={(e) => setObjectType(e.target.value as (typeof OBJECT_TYPES)[number])}
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                >
                  {OBJECT_TYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs">Kind</Label>
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])}
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                >
                  {KINDS.map((k) => <option key={k}>{k}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Slug (snake_case)</Label>
                <Input
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="industry_tier"
                />
              </div>
              <div>
                <Label className="text-xs">Label (human)</Label>
                <Input value={label} onChange={(e) => setLabel(e.target.value)} />
              </div>
            </div>
            {kind === "picklist" && (
              <div>
                <Label className="text-xs">Options (one per line)</Label>
                <textarea
                  value={picklistOptions}
                  onChange={(e) => setPicklistOptions(e.target.value)}
                  rows={4}
                  className="w-full rounded-md border bg-background p-2 text-sm font-mono"
                />
              </div>
            )}
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={required} onCheckedChange={(v) => setRequired(!!v)} />
              <span>Required</span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              onClick={save}
              disabled={busy || !slug.trim() || !label.trim()}
            >
              {busy && <Loader2 className="h-4 w-4 me-1.5 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
