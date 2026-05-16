"use client";

import { useState } from "react";
import { useLocale } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { createLeadSource, deleteLeadSource, updateLeadSource } from "../actions";

type LeadSourceItem = {
  id: string;
  code: string;
  labelEn: string;
  labelAr: string;
  entityId: string | null;
  active: boolean;
  entity: {
    id: string;
    code: string;
    nameEn: string;
    nameAr: string;
  } | null;
};

export function LeadSourcesClient({ sources }: { sources: LeadSourceItem[] }) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<LeadSourceItem | null>(null);
  const [saving, setSaving] = useState(false);

  const [labelEn, setLabelEn] = useState("");
  const [labelAr, setLabelAr] = useState("");
  const [code, setCode] = useState("");

  function openCreate() {
    setEditing(null);
    setLabelEn("");
    setLabelAr("");
    setCode("");
    setOpen(true);
  }

  function openEdit(source: LeadSourceItem) {
    setEditing(source);
    setLabelEn(source.labelEn);
    setLabelAr(source.labelAr);
    setCode(source.code);
    setOpen(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      if (editing) {
        await updateLeadSource(editing.id, { labelEn, labelAr, code });
        toast.success("Updated");
      } else {
        await createLeadSource({ labelEn, labelAr, code });
        toast.success("Created");
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(source: LeadSourceItem) {
    setSaving(true);
    try {
      await updateLeadSource(source.id, { active: !source.active });
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(source: LeadSourceItem) {
    const ok = window.confirm(
      `Permanently delete lead source "${source.labelEn}"? Cannot be undone.`
    );
    if (!ok) return;
    setSaving(true);
    try {
      await deleteLeadSource(source.id);
      toast.success(`"${source.labelEn}" deleted`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t.nav.leadSources}</h1>
        <Button onClick={openCreate}>{t.common.create}</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{locale === "ar" ? "الكود" : "Code"}</TableHead>
                  <TableHead>{locale === "ar" ? "التسمية (EN)" : "Label (EN)"}</TableHead>
                  <TableHead>{locale === "ar" ? "التسمية (AR)" : "Label (AR)"}</TableHead>
                  <TableHead>{t.forms.entity}</TableHead>
                  <TableHead>{t.common.status}</TableHead>
                  <TableHead>{t.common.actions}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sources.map((source) => (
                  <TableRow key={source.id}>
                    <TableCell className="font-mono text-xs">
                      {source.code}
                    </TableCell>
                    <TableCell>{source.labelEn}</TableCell>
                    <TableCell dir="rtl">{source.labelAr}</TableCell>
                    <TableCell>
                      {source.entity ? (
                        <span className="text-sm">
                          {locale === "ar"
                            ? source.entity.nameAr
                            : source.entity.nameEn}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-sm">
                          {locale === "ar" ? "عام" : "Global"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {source.active ? (
                        <Badge variant="default" className="bg-emerald-600">
                          {t.common.active}
                        </Badge>
                      ) : (
                        <Badge variant="secondary">{t.common.inactive}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEdit(source)}
                          disabled={saving}
                        >
                          {t.common.edit}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleActive(source)}
                          disabled={saving}
                        >
                          {source.active ? t.common.inactive : t.common.active}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(source)}
                          disabled={saving}
                          className="text-destructive hover:text-destructive"
                          title="Delete permanently"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {sources.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      {t.common.noResults}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editing ? t.common.edit : t.common.create} {t.nav.leadSources}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">
                {locale === "ar" ? "الكود" : "Code"}
              </label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="REFERRAL"
                className="font-mono"
                disabled={!!editing}
              />
            </div>
            <div>
              <label className="text-sm font-medium">
                {locale === "ar" ? "التسمية (EN)" : "Label (EN)"}
              </label>
              <Input
                value={labelEn}
                onChange={(e) => setLabelEn(e.target.value)}
                placeholder="Label in English"
              />
            </div>
            <div>
              <label className="text-sm font-medium">
                {locale === "ar" ? "التسمية (AR)" : "Label (AR)"}
              </label>
              <Input
                value={labelAr}
                onChange={(e) => setLabelAr(e.target.value)}
                placeholder="التسمية بالعربية"
                dir="rtl"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                {t.common.cancel}
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || !labelEn || !labelAr || !code}
              >
                {t.common.save}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
