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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, RotateCcw } from "lucide-react";
import {
  updateStageConfig,
  createStageConfig,
  deleteStageConfig,
  restoreStageConfig,
} from "../actions";

const ALL_STAGES = [
  "NEW",
  "CONTACTED",
  "DISCOVERY",
  "QUALIFIED",
  "TECH_MEETING",
  "PROPOSAL_SENT",
  "NEGOTIATION",
  "VERBAL_YES",
  "POSTPONED",
  "WON",
  "LOST",
] as const;

type StageConfigItem = {
  id: string;
  stage: string;
  entityId: string | null;
  probabilityPct: number;
  slaHours: number | null;
  displayOrder: number;
  isActive: boolean;
  customLabelEn: string | null;
  customLabelAr: string | null;
  // Tier-0 #2 + #3 + #1 extensions. All nullable until admin sets them.
  stageType?: string | null;
  forecastCategory?: string | null;
  targetDays?: number | null;
  maxDays?: number | null;
  requiredFieldsJson?: unknown;
  entity: {
    id: string;
    code: string;
    nameEn: string;
    nameAr: string;
  } | null;
};

/// Opportunity fields the admin can require before EXITING this stage.
/// Keep this list aligned with the actual CrmOpportunity columns reps
/// fill on the create / edit form.
const REQUIRABLE_FIELDS: { key: string; label: string }[] = [
  { key: "estimatedValue", label: "Estimated value" },
  { key: "expectedCloseDate", label: "Expected close date" },
  { key: "nextAction", label: "Next action" },
  { key: "nextActionDate", label: "Next action date" },
  { key: "primaryContactId", label: "Primary contact" },
  { key: "customerContactName", label: "Customer contact name" },
  { key: "customerContactPhone", label: "Customer contact phone" },
  { key: "customerContactEmail", label: "Customer contact email" },
  { key: "description", label: "Description" },
  { key: "techRequirements", label: "Tech requirements" },
  { key: "leadSource", label: "Lead source" },
];

export function StageConfigClient({ configs: initial }: { configs: StageConfigItem[] }) {
  const { t, locale } = useLocale();
  const [configs, setConfigs] = useState(initial);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editProb, setEditProb] = useState("");
  const [editSla, setEditSla] = useState("");
  const [saving, setSaving] = useState(false);
  // Tier-0 advanced-settings dialog. One dialog covers items 1+2+3 so
  // we don't double the inline-edit row width with five more inputs.
  const [advancedFor, setAdvancedFor] = useState<StageConfigItem | null>(null);
  const [advStageType, setAdvStageType] = useState("open");
  const [advForecastCat, setAdvForecastCat] = useState("pipeline");
  const [advTargetDays, setAdvTargetDays] = useState("");
  const [advMaxDays, setAdvMaxDays] = useState("");
  const [advRequiredFields, setAdvRequiredFields] = useState<Set<string>>(new Set());

  function openAdvanced(c: StageConfigItem) {
    setAdvancedFor(c);
    setAdvStageType(c.stageType ?? "open");
    setAdvForecastCat(c.forecastCategory ?? "pipeline");
    setAdvTargetDays(c.targetDays != null ? String(c.targetDays) : "");
    setAdvMaxDays(c.maxDays != null ? String(c.maxDays) : "");
    setAdvRequiredFields(
      new Set(Array.isArray(c.requiredFieldsJson) ? (c.requiredFieldsJson as string[]) : [])
    );
  }
  function closeAdvanced() {
    setAdvancedFor(null);
  }
  async function saveAdvanced() {
    if (!advancedFor) return;
    setSaving(true);
    try {
      const updated = await updateStageConfig(advancedFor.id, {
        stageType: advStageType as "open" | "won" | "lost" | "abandoned",
        forecastCategory: advForecastCat as "pipeline" | "bestCase" | "commit" | "closed" | "omitted",
        targetDays: advTargetDays ? Number(advTargetDays) : null,
        maxDays: advMaxDays ? Number(advMaxDays) : null,
        requiredFields: Array.from(advRequiredFields),
      });
      setConfigs(configs.map((c) => (c.id === advancedFor.id ? (updated as StageConfigItem) : c)));
      closeAdvanced();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to save advanced settings");
    } finally {
      setSaving(false);
    }
  }
  const [adding, setAdding] = useState(false);
  const [newStage, setNewStage] = useState<string>("");
  const [newProb, setNewProb] = useState("50");
  const [newSla, setNewSla] = useState("");
  const [newLabelEn, setNewLabelEn] = useState("");
  // Arabic label so admins can rename the stage in both languages at create
  // time — previously the form silently sent `customLabelAr: null` which left
  // Arabic users staring at the English fallback even after the admin had
  // edited the EN label.
  const [newLabelAr, setNewLabelAr] = useState("");

  const stageLabels = t.stages as Record<string, string>;

  // Which enum values aren't yet configured (for the default entity bucket).
  const configuredStages = new Set(configs.filter((c) => c.entityId === null).map((c) => c.stage));
  const availableStages = ALL_STAGES.filter((s) => !configuredStages.has(s));

  async function handleAdd() {
    if (!newStage) return;
    setSaving(true);
    try {
      const created = await createStageConfig({
        stage: newStage,
        entityId: null,
        probabilityPct: Number(newProb) || 50,
        slaHours: newSla ? Number(newSla) : null,
        displayOrder: configs.length,
        customLabelEn: newLabelEn || null,
        customLabelAr: newLabelAr || null,
      });
      setConfigs([...configs, created as StageConfigItem]);
      setAdding(false);
      setNewStage("");
      setNewLabelEn("");
      setNewLabelAr("");
      setNewProb("50");
      setNewSla("");
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : "Failed to add stage");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Hide this stage from the pipeline? Historical opportunities at this stage are unaffected.")) return;
    setSaving(true);
    try {
      const updated = await deleteStageConfig(id);
      setConfigs(configs.map((c) => (c.id === id ? (updated as StageConfigItem) : c)));
    } finally {
      setSaving(false);
    }
  }

  async function handleRestore(id: string) {
    setSaving(true);
    try {
      const updated = await restoreStageConfig(id);
      setConfigs(configs.map((c) => (c.id === id ? (updated as StageConfigItem) : c)));
    } finally {
      setSaving(false);
    }
  }

  function startEdit(config: StageConfigItem) {
    setEditingId(config.id);
    setEditProb(String(config.probabilityPct));
    setEditSla(config.slaHours != null ? String(config.slaHours) : "");
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function handleSave(config: StageConfigItem) {
    setSaving(true);
    try {
      await updateStageConfig(config.id, {
        probabilityPct: Number(editProb),
        slaHours: editSla ? Number(editSla) : null,
      });
      setEditingId(null);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t.nav.stageConfig}</h1>
        {!adding && availableStages.length > 0 && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4 me-1" /> {locale === "ar" ? "إضافة مرحلة" : "Add stage"}
          </Button>
        )}
      </div>

      {adding && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <p className="text-sm font-semibold">
              {locale === "ar" ? "إضافة مرحلة إلى البايبلاين" : "Add stage to pipeline"}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-6 gap-2 items-end">
              <div>
                <label className="text-xs text-muted-foreground">{locale === "ar" ? "المرحلة" : "Stage"}</label>
                <Select value={newStage} onValueChange={(v) => setNewStage(v ?? "")}>
                  <SelectTrigger><SelectValue placeholder={locale === "ar" ? "اختر مرحلة" : "Pick a stage"} /></SelectTrigger>
                  <SelectContent>
                    {availableStages.map((s) => (
                      <SelectItem key={s} value={s}>{stageLabels[s] ?? s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">
                  {locale === "ar" ? "الاسم بالإنجليزية (اختياري)" : "Label EN (optional)"}
                </label>
                <Input value={newLabelEn} onChange={(e) => setNewLabelEn(e.target.value)} placeholder="e.g. Discovery call" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">
                  {locale === "ar" ? "الاسم بالعربية (اختياري)" : "Label AR (optional)"}
                </label>
                <Input value={newLabelAr} onChange={(e) => setNewLabelAr(e.target.value)} placeholder={locale === "ar" ? "مثال: اجتماع استكشافي" : "مثال: اجتماع استكشافي"} dir="rtl" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{locale === "ar" ? "نسبة الاحتمال %" : "Probability %"}</label>
                <Input type="number" min={0} max={100} value={newProb} onChange={(e) => setNewProb(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{locale === "ar" ? "ساعات الـ SLA" : "SLA hours"}</label>
                <Input type="number" min={0} value={newSla} onChange={(e) => setNewSla(e.target.value)} placeholder="—" />
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleAdd} disabled={!newStage || saving}>{locale === "ar" ? "إضافة" : "Add"}</Button>
                <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>{locale === "ar" ? "إلغاء" : "Cancel"}</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>{t.kpis.stage}</TableHead>
                  <TableHead>{t.forms.entity}</TableHead>
                  <TableHead>
                    {locale === "ar" ? "نسبة الاحتمال %" : "Probability %"}
                  </TableHead>
                  <TableHead>
                    {locale === "ar" ? "SLA (ساعات)" : "SLA (Hours)"}
                  </TableHead>
                  <TableHead>{t.common.actions}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {configs.map((config) => (
                  <TableRow key={config.id}>
                    <TableCell className="text-muted-foreground">
                      {config.displayOrder}
                    </TableCell>
                    <TableCell className="font-medium">
                      <Badge variant="outline">
                        {stageLabels[config.stage] ?? config.stage}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {config.entity ? (
                        <span className="text-sm">
                          {locale === "ar"
                            ? config.entity.nameAr
                            : config.entity.nameEn}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-sm">
                          {locale === "ar" ? "افتراضي" : "Default"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {editingId === config.id ? (
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          value={editProb}
                          onChange={(e) => setEditProb(e.target.value)}
                          className="w-24"
                          autoFocus
                        />
                      ) : (
                        <span className="ltr-nums">{config.probabilityPct}%</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {editingId === config.id ? (
                        <Input
                          type="number"
                          min={0}
                          value={editSla}
                          onChange={(e) => setEditSla(e.target.value)}
                          className="w-24"
                          placeholder="-"
                        />
                      ) : (
                        <span className="ltr-nums">
                          {config.slaHours != null ? config.slaHours : "-"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {editingId === config.id ? (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => handleSave(config)}
                            disabled={saving}
                          >
                            {t.common.save}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={cancelEdit}
                          >
                            {t.common.cancel}
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => startEdit(config)}
                            disabled={!config.isActive}
                          >
                            {t.common.edit}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openAdvanced(config)}
                            disabled={!config.isActive}
                            title="Stage type, forecast category, stalled-deal thresholds, required fields"
                          >
                            {locale === "ar" ? "متقدم" : "Advanced"}
                          </Button>
                          {config.isActive ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDelete(config.id)}
                              disabled={saving}
                              title="Hide from pipeline"
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRestore(config.id)}
                              disabled={saving}
                              title="Restore"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Tier-0 #1+#2+#3 advanced-settings dialog */}
      <Dialog open={!!advancedFor} onOpenChange={(o) => !o && closeAdvanced()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {locale === "ar" ? "إعدادات متقدمة" : "Advanced settings"}
              {advancedFor && (
                <span className="text-sm text-muted-foreground ms-2 font-normal">
                  {advancedFor.customLabelEn ?? advancedFor.stage}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">
                  {locale === "ar" ? "نوع المرحلة" : "Stage type"}
                </Label>
                <select
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                  value={advStageType}
                  onChange={(e) => setAdvStageType(e.target.value)}
                >
                  <option value="open">open</option>
                  <option value="won">won</option>
                  <option value="lost">lost</option>
                  <option value="abandoned">abandoned</option>
                </select>
              </div>
              <div>
                <Label className="text-xs">
                  {locale === "ar" ? "فئة التوقعات" : "Forecast category"}
                </Label>
                <select
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                  value={advForecastCat}
                  onChange={(e) => setAdvForecastCat(e.target.value)}
                >
                  <option value="pipeline">pipeline</option>
                  <option value="bestCase">bestCase</option>
                  <option value="commit">commit</option>
                  <option value="closed">closed</option>
                  <option value="omitted">omitted</option>
                </select>
              </div>
              <div>
                <Label className="text-xs">
                  {locale === "ar" ? "الأيام المستهدفة" : "Target days"}
                </Label>
                <Input
                  type="number"
                  min={0}
                  max={365}
                  value={advTargetDays}
                  onChange={(e) => setAdvTargetDays(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">
                  {locale === "ar" ? "الحد الأقصى للأيام" : "Max days"}
                </Label>
                <Input
                  type="number"
                  min={0}
                  max={365}
                  value={advMaxDays}
                  onChange={(e) => setAdvMaxDays(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">
                {locale === "ar"
                  ? "حقول مطلوبة قبل ترك هذه المرحلة"
                  : "Fields required to leave this stage"}
              </Label>
              <p className="text-[11px] text-muted-foreground mb-1.5">
                {locale === "ar"
                  ? "لا يمكن للمندوب نقل الفرصة إلى مرحلة لاحقة حتى تُملأ هذه الحقول."
                  : "Reps can't advance the opp until every checked field is populated."}
              </p>
              <div className="max-h-48 overflow-y-auto rounded-md border divide-y">
                {REQUIRABLE_FIELDS.map((f) => {
                  const checked = advRequiredFields.has(f.key);
                  return (
                    <label
                      key={f.key}
                      className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-accent"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => {
                          setAdvRequiredFields((prev) => {
                            const next = new Set(prev);
                            if (v) next.add(f.key);
                            else next.delete(f.key);
                            return next;
                          });
                        }}
                      />
                      <span>{f.label}</span>
                      <span className="text-[10px] text-muted-foreground ms-auto">{f.key}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeAdvanced} disabled={saving}>
              {locale === "ar" ? "إلغاء" : "Cancel"}
            </Button>
            <Button onClick={saveAdvanced} disabled={saving}>
              {locale === "ar" ? "حفظ" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
