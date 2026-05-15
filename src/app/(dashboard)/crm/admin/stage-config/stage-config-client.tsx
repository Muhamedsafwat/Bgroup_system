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
  entity: {
    id: string;
    code: string;
    nameEn: string;
    nameAr: string;
  } | null;
};

export function StageConfigClient({ configs: initial }: { configs: StageConfigItem[] }) {
  const { t, locale } = useLocale();
  const [configs, setConfigs] = useState(initial);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editProb, setEditProb] = useState("");
  const [editSla, setEditSla] = useState("");
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newStage, setNewStage] = useState<string>("");
  const [newProb, setNewProb] = useState("50");
  const [newSla, setNewSla] = useState("");
  const [newLabelEn, setNewLabelEn] = useState("");

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
        customLabelAr: null,
      });
      setConfigs([...configs, created as StageConfigItem]);
      setAdding(false);
      setNewStage("");
      setNewLabelEn("");
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
            <Plus className="h-4 w-4 me-1" /> Add stage
          </Button>
        )}
      </div>

      {adding && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <p className="text-sm font-semibold">Add stage to pipeline</p>
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 items-end">
              <div>
                <label className="text-xs text-muted-foreground">Stage</label>
                <Select value={newStage} onValueChange={(v) => setNewStage(v ?? "")}>
                  <SelectTrigger><SelectValue placeholder="Pick a stage" /></SelectTrigger>
                  <SelectContent>
                    {availableStages.map((s) => (
                      <SelectItem key={s} value={s}>{stageLabels[s] ?? s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Custom label (optional)</label>
                <Input value={newLabelEn} onChange={(e) => setNewLabelEn(e.target.value)} placeholder="e.g. Discovery call" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Probability %</label>
                <Input type="number" min={0} max={100} value={newProb} onChange={(e) => setNewProb(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">SLA hours</label>
                <Input type="number" min={0} value={newSla} onChange={(e) => setNewSla(e.target.value)} placeholder="—" />
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleAdd} disabled={!newStage || saving}>Add</Button>
                <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
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
    </div>
  );
}
