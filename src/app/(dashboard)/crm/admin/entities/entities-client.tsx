"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { createEntity, deleteEntity, updateEntity } from "../actions";

type EntityItem = {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  color: string;
  active: boolean;
};

type Mode = "create" | "edit";

export function EntitiesClient({ entities }: { entities: EntityItem[] }) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("create");
  const [editingId, setEditingId] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [color, setColor] = useState("#3b82f6");

  function openCreate() {
    setMode("create");
    setEditingId(null);
    setCode("");
    setNameEn("");
    setNameAr("");
    setColor("#3b82f6");
    setOpen(true);
  }

  function openEdit(entity: EntityItem) {
    setMode("edit");
    setEditingId(entity.id);
    setCode(entity.code);
    setNameEn(entity.nameEn);
    setNameAr(entity.nameAr);
    setColor(entity.color);
    setOpen(true);
  }

  async function handleSave() {
    startTransition(async () => {
      try {
        if (mode === "create") {
          await createEntity({ code, nameEn, nameAr, color });
          toast.success(`Entity "${nameEn}" created`);
        } else if (editingId) {
          await updateEntity(editingId, { nameEn, nameAr, color });
          toast.success(`Entity "${nameEn}" updated`);
        }
        setOpen(false);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  async function toggleActive(entity: EntityItem) {
    startTransition(async () => {
      try {
        await updateEntity(entity.id, { active: !entity.active });
        toast.success(`Entity "${entity.nameEn}" ${!entity.active ? "activated" : "deactivated"}`);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Update failed");
      }
    });
  }

  async function handleDelete(entity: EntityItem) {
    const ok = window.confirm(
      `Permanently delete entity "${entity.nameEn}" (${entity.code})? This cannot be undone.`
    );
    if (!ok) return;
    startTransition(async () => {
      try {
        await deleteEntity(entity.id);
        toast.success(`Entity "${entity.nameEn}" deleted`);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Delete failed");
      }
    });
  }

  const canSave =
    !!nameEn.trim() &&
    !!nameAr.trim() &&
    /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color) &&
    (mode === "edit" || /^[A-Za-z0-9_-]+$/.test(code));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t.nav.entities}</h1>
        <Button onClick={openCreate} disabled={pending}>
          <Plus className="me-1 h-4 w-4" />
          {locale === "ar" ? "إضافة كيان" : "New entity"}
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {entities.map((entity) => (
          <Card key={entity.id} className="relative">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-3">
                  <div
                    className="h-4 w-4 rounded-full"
                    style={{ backgroundColor: entity.color }}
                  />
                  <span>{locale === "ar" ? entity.nameAr : entity.nameEn}</span>
                </CardTitle>
                <Badge variant="outline" className="font-mono">
                  {entity.code}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>EN: {entity.nameEn}</p>
                <p dir="rtl">AR: {entity.nameAr}</p>
                <p>
                  {locale === "ar" ? "اللون" : "Color"}:{" "}
                  <span
                    className="inline-block h-3 w-8 rounded align-middle"
                    style={{ backgroundColor: entity.color }}
                  />
                  <span className="ms-2 font-mono text-xs">{entity.color}</span>
                </p>
              </div>
              <div className="mt-4 flex items-center justify-between">
                {entity.active ? (
                  <Badge variant="default" className="bg-emerald-600">
                    {t.common.active}
                  </Badge>
                ) : (
                  <Badge variant="secondary">{t.common.inactive}</Badge>
                )}
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openEdit(entity)}
                    disabled={pending}
                  >
                    {t.common.edit}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleActive(entity)}
                    disabled={pending}
                  >
                    {entity.active ? t.common.inactive : t.common.active}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(entity)}
                    disabled={pending}
                    className="text-destructive hover:text-destructive"
                    title={locale === "ar" ? "حذف" : "Delete"}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {mode === "create"
                ? locale === "ar"
                  ? "إضافة كيان"
                  : "New entity"
                : `${t.common.edit} ${t.nav.entities}`}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {mode === "create" && (
              <div>
                <label className="text-sm font-medium">
                  {locale === "ar" ? "الرمز" : "Code"}
                </label>
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="BG"
                  maxLength={20}
                  className="font-mono"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {locale === "ar"
                    ? "أحرف وأرقام و _ - فقط"
                    : "Letters, numbers, _ and - only"}
                </p>
              </div>
            )}
            <div>
              <label className="text-sm font-medium">
                {t.common.name} (EN)
              </label>
              <Input
                value={nameEn}
                onChange={(e) => setNameEn(e.target.value)}
                placeholder="Name (English)"
              />
            </div>
            <div>
              <label className="text-sm font-medium">
                {t.common.name} (AR)
              </label>
              <Input
                value={nameAr}
                onChange={(e) => setNameAr(e.target.value)}
                placeholder="الاسم بالعربية"
                dir="rtl"
              />
            </div>
            <div>
              <label className="text-sm font-medium">
                {locale === "ar" ? "اللون" : "Color"}
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-10 w-14 cursor-pointer rounded border"
                />
                <Input
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  placeholder="#3b82f6"
                  className="font-mono"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                {t.common.cancel}
              </Button>
              <Button onClick={handleSave} disabled={pending || !canSave}>
                {t.common.save}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
