"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Folder,
  FolderOpen,
  Loader2,
  MoreHorizontal,
  Pencil,
  Send,
  Trash2,
  Inbox,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLocale } from "@/lib/i18n";

type Rep = { id: string; fullName: string; fullNameAr: string | null };

type Folder = {
  id: string;
  fileName: string;
  uploadedAt: string;
  uploadedBy: { id: string; fullName: string } | null;
  originalCount: number;
  duplicateCount: number;
  liveCount: number;
  notes: string | null;
};

/**
 * Folder-grid view of the cold-lead directory. Each card = one upload
 * batch (CrmColdLeadImport row). Manager + admin actions:
 *
 *   - Open    → drill into the flat list filtered to this folder
 *   - Rename  → updates the folder's display name (file name)
 *   - Assign  → bulk round-robin every lead in the folder to picked reps
 *   - Delete  → detach (default, leads survive as "Unfiled") OR
 *               cascade (also wipes every lead in the folder)
 *
 * Also surfaces a synthetic "Unfiled" tile so leads with no batch
 * (created manually or whose folder was deleted in detach mode) stay
 * navigable from this view.
 */
export function FoldersView({
  reps,
  onOpenFolder,
}: {
  reps: Rep[];
  onOpenFolder: (batchId: string, label: string) => void;
}) {
  const { locale } = useLocale();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [unfiledCount, setUnfiledCount] = useState(0);
  const [loading, setLoading] = useState(true);

  // Per-folder dialog state — only one open at a time, so a single
  // active-folder ref + a dialog-mode flag is simpler than three
  // independent open booleans.
  const [active, setActive] = useState<Folder | null>(null);
  const [mode, setMode] = useState<"rename" | "assign" | "delete" | null>(null);

  // Rename dialog state
  const [renameValue, setRenameValue] = useState("");
  // Assign dialog state — multi-select round-robin
  const [assignRepIds, setAssignRepIds] = useState<Set<string>>(new Set());
  const [onlyUnassigned, setOnlyUnassigned] = useState(true);
  // Delete dialog state
  const [alsoDeleteLeads, setAlsoDeleteLeads] = useState(false);
  const [working, setWorking] = useState(false);

  async function loadFolders() {
    setLoading(true);
    try {
      const res = await fetch("/api/crm/cold-leads/folders");
      if (!res.ok) {
        toast.error(locale === "ar" ? "فشل تحميل المجلدات" : "Failed to load folders");
        return;
      }
      const data = await res.json();
      setFolders(data.folders ?? []);
      setUnfiledCount(data.unfiledCount ?? 0);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadFolders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startRename(folder: Folder) {
    setActive(folder);
    setRenameValue(folder.fileName);
    setMode("rename");
  }
  function startAssign(folder: Folder) {
    setActive(folder);
    setAssignRepIds(new Set());
    setOnlyUnassigned(true);
    setMode("assign");
  }
  function startDelete(folder: Folder) {
    setActive(folder);
    setAlsoDeleteLeads(false);
    setMode("delete");
  }
  function closeDialog() {
    setActive(null);
    setMode(null);
    setRenameValue("");
    setAssignRepIds(new Set());
    setAlsoDeleteLeads(false);
  }

  async function submitRename() {
    if (!active) return;
    const next = renameValue.trim();
    if (!next || next === active.fileName) {
      closeDialog();
      return;
    }
    setWorking(true);
    try {
      const res = await fetch(`/api/crm/cold-leads/folders/${active.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? (locale === "ar" ? "فشل إعادة التسمية" : "Rename failed"));
        return;
      }
      toast.success(locale === "ar" ? "تم تغيير الاسم" : "Folder renamed");
      closeDialog();
      loadFolders();
    } finally {
      setWorking(false);
    }
  }

  async function submitAssign() {
    if (!active || assignRepIds.size === 0) return;
    setWorking(true);
    try {
      const res = await fetch(`/api/crm/cold-leads/folders/${active.id}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repIds: Array.from(assignRepIds),
          onlyUnassigned,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? (locale === "ar" ? "فشل التعيين" : "Assignment failed"));
        return;
      }
      toast.success(
        locale === "ar"
          ? `تم تعيين ${data.assigned} عميل`
          : `Assigned ${data.assigned} lead${data.assigned === 1 ? "" : "s"}`
      );
      closeDialog();
      loadFolders();
    } finally {
      setWorking(false);
    }
  }

  async function submitDelete() {
    if (!active) return;
    setWorking(true);
    try {
      const url = `/api/crm/cold-leads/folders/${active.id}${alsoDeleteLeads ? "?deleteLeads=true" : ""}`;
      const res = await fetch(url, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? (locale === "ar" ? "فشل الحذف" : "Delete failed"));
        return;
      }
      toast.success(
        alsoDeleteLeads
          ? (locale === "ar"
              ? `تم حذف المجلد و ${data.leadsDeleted} عميل`
              : `Deleted folder and ${data.leadsDeleted} lead${data.leadsDeleted === 1 ? "" : "s"}`)
          : (locale === "ar"
              ? `تم حذف المجلد. ${data.leadsDetached} عميل أصبح غير مصنف.`
              : `Folder deleted. ${data.leadsDetached} lead${data.leadsDetached === 1 ? "" : "s"} moved to Unfiled.`)
      );
      closeDialog();
      loadFolders();
    } finally {
      setWorking(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin me-2" />
        {locale === "ar" ? "جارٍ التحميل..." : "Loading folders..."}
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {/* Unfiled — synthetic tile that opens the flat view filtered to
            leads without a batch. Always shown, even when empty, so the
            user understands where un-batched leads live. */}
        <Card
          className="p-4 hover:bg-muted/30 transition-colors cursor-pointer flex flex-col gap-2"
          onClick={() => onOpenFolder("unfiled", locale === "ar" ? "غير مصنف" : "Unfiled")}
        >
          <div className="flex items-center gap-2">
            <Inbox className="h-5 w-5 text-muted-foreground" />
            <span className="font-medium">
              {locale === "ar" ? "غير مصنف" : "Unfiled"}
            </span>
            <span className="ms-auto text-xs text-muted-foreground">
              {unfiledCount.toLocaleString()}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {locale === "ar"
              ? "عملاء بدون مجلد رفع."
              : "Leads with no upload batch."}
          </p>
        </Card>

        {folders.map((folder) => (
          <Card key={folder.id} className="p-4 flex flex-col gap-2">
            <div className="flex items-start gap-2">
              <Folder className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
              <button
                type="button"
                onClick={() => onOpenFolder(folder.id, folder.fileName)}
                className="font-medium text-start truncate hover:underline"
                title={folder.fileName}
              >
                {folder.fileName}
              </button>
              <span className="ms-auto text-xs text-muted-foreground shrink-0">
                {folder.liveCount.toLocaleString()}
                {folder.liveCount !== folder.originalCount && (
                  <span className="text-[10px] block">
                    {locale === "ar"
                      ? `من ${folder.originalCount.toLocaleString()}`
                      : `of ${folder.originalCount.toLocaleString()}`}
                  </span>
                )}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              <span dir="ltr">{new Date(folder.uploadedAt).toLocaleDateString()}</span>
              {folder.uploadedBy && (
                <>
                  {" · "}
                  <span>{folder.uploadedBy.fullName}</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-1 pt-1 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => onOpenFolder(folder.id, folder.fileName)}
              >
                <FolderOpen className="h-3.5 w-3.5 me-1" />
                {locale === "ar" ? "فتح" : "Open"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => startAssign(folder)}
                disabled={reps.length === 0 || folder.liveCount === 0}
                title={reps.length === 0 ? (locale === "ar" ? "لا يوجد مندوبون" : "No reps") : undefined}
              >
                <Send className="h-3.5 w-3.5 me-1" />
                {locale === "ar" ? "تعيين" : "Assign"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => startRename(folder)}
              >
                <Pencil className="h-3.5 w-3.5 me-1" />
                {locale === "ar" ? "إعادة تسمية" : "Rename"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                onClick={() => startDelete(folder)}
              >
                <Trash2 className="h-3.5 w-3.5 me-1" />
                {locale === "ar" ? "حذف" : "Delete"}
              </Button>
            </div>
          </Card>
        ))}

        {folders.length === 0 && (
          <Card className="p-6 col-span-full text-center text-sm text-muted-foreground">
            <MoreHorizontal className="h-5 w-5 mx-auto mb-2 opacity-50" />
            {locale === "ar"
              ? "لا يوجد مجلدات بعد. ارفع ملف Excel من زر الاستيراد."
              : "No folders yet. Upload an Excel file with the Import button."}
          </Card>
        )}
      </div>

      {/* Rename dialog */}
      <Dialog open={mode === "rename"} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {locale === "ar" ? "إعادة تسمية المجلد" : "Rename folder"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder={locale === "ar" ? "اسم المجلد" : "Folder name"}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={working}>
              {locale === "ar" ? "إلغاء" : "Cancel"}
            </Button>
            <Button onClick={submitRename} disabled={working || !renameValue.trim()}>
              {working && <Loader2 className="h-4 w-4 me-1.5 animate-spin" />}
              {locale === "ar" ? "حفظ" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign dialog */}
      <Dialog open={mode === "assign"} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {locale === "ar"
                ? `تعيين كامل المجلد: ${active?.fileName ?? ""}`
                : `Assign entire folder: ${active?.fileName ?? ""}`}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {locale === "ar"
                ? "سيتم التوزيع بالتساوي على المندوبين المحددين."
                : "Leads in this folder will be distributed round-robin across the picked reps."}
            </p>
            <div className="max-h-64 overflow-y-auto rounded-md border divide-y">
              {reps.length === 0 ? (
                <p className="p-3 text-xs text-muted-foreground">
                  {locale === "ar" ? "لا يوجد مندوبون نشطون" : "No active reps"}
                </p>
              ) : (
                reps.map((r) => {
                  const checked = assignRepIds.has(r.id);
                  return (
                    <label
                      key={r.id}
                      className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-accent"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => {
                          setAssignRepIds((prev) => {
                            const next = new Set(prev);
                            if (v) next.add(r.id);
                            else next.delete(r.id);
                            return next;
                          });
                        }}
                      />
                      <span>{locale === "ar" && r.fullNameAr ? r.fullNameAr : r.fullName}</span>
                    </label>
                  );
                })
              )}
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={onlyUnassigned}
                onCheckedChange={(v) => setOnlyUnassigned(!!v)}
              />
              <span>
                {locale === "ar"
                  ? "تجاهل العملاء الذين تم تعيينهم مسبقاً"
                  : "Skip leads already assigned"}
              </span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={working}>
              {locale === "ar" ? "إلغاء" : "Cancel"}
            </Button>
            <Button
              onClick={submitAssign}
              disabled={working || assignRepIds.size === 0}
            >
              {working && <Loader2 className="h-4 w-4 me-1.5 animate-spin" />}
              {locale === "ar" ? "تعيين" : "Assign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete dialog */}
      <Dialog open={mode === "delete"} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {locale === "ar"
                ? `حذف المجلد: ${active?.fileName ?? ""}`
                : `Delete folder: ${active?.fileName ?? ""}`}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              {locale === "ar"
                ? `هذا المجلد يحتوي على ${active?.liveCount.toLocaleString() ?? 0} عميل.`
                : `This folder contains ${active?.liveCount.toLocaleString() ?? 0} lead${active?.liveCount === 1 ? "" : "s"}.`}
            </p>
            <label className="flex items-start gap-2 cursor-pointer rounded-md border p-3 bg-destructive/5">
              <Checkbox
                checked={alsoDeleteLeads}
                onCheckedChange={(v) => setAlsoDeleteLeads(!!v)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium block">
                  {locale === "ar"
                    ? "حذف كل العملاء داخل المجلد"
                    : "Also delete every lead inside this folder"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {locale === "ar"
                    ? "خيار للحذف الكامل. الافتراضي يحتفظ بالعملاء كـ \"غير مصنف\"."
                    : "Destructive — leaves no trace. Default is to keep the leads as \"Unfiled\"."}
                </span>
              </span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={working}>
              {locale === "ar" ? "إلغاء" : "Cancel"}
            </Button>
            <Button
              variant={alsoDeleteLeads ? "destructive" : "default"}
              onClick={submitDelete}
              disabled={working}
            >
              {working && <Loader2 className="h-4 w-4 me-1.5 animate-spin" />}
              {alsoDeleteLeads
                ? (locale === "ar" ? "حذف المجلد والعملاء" : "Delete folder + leads")
                : (locale === "ar" ? "حذف المجلد فقط" : "Delete folder only")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
