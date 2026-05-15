"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Trash2, GripVertical, ArrowDown, Save } from "lucide-react";
import { toast } from "sonner";

type Step = {
  id?: string;
  /** UI-side stable key for drag list. */
  uid: string;
  position: number;
  name: string;
  taskTitle: string;
  taskDescription: string;
  assigneeUserId: string | null;
  assigneeRole: string | null;
  budgetHours: number;
  /** For CUSTOM workflows: ISO datetime string when the step must be done. */
  deadlineAt: string | null;
  slaIncidentOnLate: boolean;
  slaBonusOnEarly: boolean;
  taskType: string;
  taskPriority: string;
};

type WorkflowKind = "TEMPLATE" | "CUSTOM";

type Member = { id: string; name: string | null; email: string };

const TYPES = ["GENERAL", "CALL", "EMAIL", "MEETING", "FOLLOW_UP", "ADMIN", "ONBOARDING", "REVIEW", "APPROVAL"];
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const ROLES = ["creator", "trigger_user", "REP", "MANAGER", "ASSISTANT", "ACCOUNT_MGR", "ADMIN", "HR"];

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export function WorkflowBuilder({ workflowId }: { workflowId?: string }) {
  const router = useRouter();
  const isEdit = Boolean(workflowId);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [moduleName, setModuleName] = useState<"hr" | "crm" | "partners" | "general">("general");
  const [isActive, setIsActive] = useState(true);
  const [kind, setKind] = useState<WorkflowKind>("TEMPLATE");
  const [steps, setSteps] = useState<Step[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    fetch("/api/users/directory?limit=200")
      .then((r) => (r.ok ? r.json() : { users: [] }))
      .then((d) => setMembers(d.users ?? []))
      .catch(() => setMembers([]));
  }, []);

  useEffect(() => {
    if (!workflowId) return;
    fetch(`/api/admin/sequential-workflows/${workflowId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.workflow) return;
        const wf = data.workflow;
        setName(wf.name);
        setDescription(wf.description ?? "");
        setModuleName(wf.module ?? "general");
        setIsActive(wf.isActive);
        setKind((wf.kind as WorkflowKind | undefined) ?? "TEMPLATE");
        setSteps(
          (wf.steps ?? []).map((s: Omit<Step, "uid"> & { deadlineAt?: string | null }) => ({
            ...s,
            deadlineAt: s.deadlineAt ?? null,
            uid: uid(),
          }))
        );
      })
      .finally(() => setLoading(false));
  }, [workflowId]);

  function addStep() {
    setSteps((prev) => [
      ...prev,
      {
        uid: uid(),
        position: prev.length,
        name: `Step ${prev.length + 1}`,
        taskTitle: "",
        taskDescription: "",
        assigneeUserId: null,
        assigneeRole: "creator",
        budgetHours: 8,
        deadlineAt: null,
        slaIncidentOnLate: true,
        slaBonusOnEarly: true,
        taskType: "GENERAL",
        taskPriority: "MEDIUM",
      },
    ]);
  }

  function removeStep(uidToRemove: string) {
    setSteps((prev) => prev.filter((s) => s.uid !== uidToRemove).map((s, i) => ({ ...s, position: i })));
  }

  function patchStep(uidToPatch: string, patch: Partial<Step>) {
    setSteps((prev) => prev.map((s) => (s.uid === uidToPatch ? { ...s, ...patch } : s)));
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setSteps((prev) => {
      const oldIdx = prev.findIndex((s) => s.uid === active.id);
      const newIdx = prev.findIndex((s) => s.uid === over.id);
      const next = arrayMove(prev, oldIdx, newIdx);
      return next.map((s, i) => ({ ...s, position: i }));
    });
  }

  async function save() {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    if (steps.length === 0) {
      toast.error("Add at least one step");
      return;
    }
    for (const s of steps) {
      if (!s.taskTitle.trim()) {
        toast.error(`Step "${s.name}" needs a task title`);
        return;
      }
      if (kind === "CUSTOM" && !s.deadlineAt) {
        toast.error(`Step "${s.name}" needs an absolute deadline (CUSTOM workflow)`);
        return;
      }
    }

    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        description,
        module: moduleName,
        isActive,
        kind,
        steps: steps.map((s, idx) => ({
          position: idx,
          name: s.name,
          taskTitle: s.taskTitle,
          taskDescription: s.taskDescription,
          assigneeUserId: s.assigneeUserId,
          assigneeRole: s.assigneeRole,
          budgetHours: s.budgetHours,
          deadlineAt: kind === "CUSTOM" ? s.deadlineAt : null,
          slaIncidentOnLate: s.slaIncidentOnLate,
          slaBonusOnEarly: s.slaBonusOnEarly,
          taskType: s.taskType,
          taskPriority: s.taskPriority,
        })),
      };
      const res = await fetch(
        isEdit
          ? `/api/admin/sequential-workflows/${workflowId}`
          : "/api/admin/sequential-workflows",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Save failed");
        return;
      }
      toast.success(isEdit ? "Workflow updated" : "Workflow created");
      if (!isEdit && data.workflow?.id) {
        router.push(`/admin/workflows-sequential/${data.workflow.id}`);
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Definition</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Closed-deal handoff" />
          </div>
          <div>
            <Label>Module</Label>
            <Select value={moduleName} onValueChange={(v) => setModuleName(v as typeof moduleName)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="general">General</SelectItem>
                <SelectItem value="hr">HR</SelectItem>
                <SelectItem value="crm">CRM</SelectItem>
                <SelectItem value="partners">Partners</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <Label>Description</Label>
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox checked={isActive} onCheckedChange={(v) => setIsActive(!!v)} />
            <span className="text-sm">Active (allow triggering)</span>
          </div>

          {/* Kind toggle: TEMPLATE (reusable, relative budgets) vs CUSTOM
              (one-shot, absolute deadlines). Steps switch their timing
              control depending on this. */}
          <div className="md:col-span-2 rounded-lg border border-dashed border-border bg-muted/30 p-3 space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Run mode</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setKind("TEMPLATE")}
                className={`text-start rounded-md border p-3 transition-colors ${
                  kind === "TEMPLATE"
                    ? "border-primary bg-primary/5"
                    : "border-border bg-background hover:bg-muted/50"
                }`}
              >
                <p className="text-sm font-semibold">Template</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Reusable. Step duration is a relative budget (e.g. 8h after the prior step
                  completes). Triggered any number of times.
                </p>
              </button>
              <button
                type="button"
                onClick={() => setKind("CUSTOM")}
                className={`text-start rounded-md border p-3 transition-colors ${
                  kind === "CUSTOM"
                    ? "border-primary bg-primary/5"
                    : "border-border bg-background hover:bg-muted/50"
                }`}
              >
                <p className="text-sm font-semibold">Custom (one-shot)</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Each step has an absolute deadline (e.g. &ldquo;done by Friday 23:59&rdquo;).
                  Auto-archived after the run completes.
                </p>
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Steps (drag to reorder)</CardTitle>
          <Button size="sm" variant="outline" onClick={addStep}>
            <Plus className="h-4 w-4 me-1.5" />
            Add step
          </Button>
        </CardHeader>
        <CardContent>
          {steps.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No steps yet. Add the first step to start building.
            </p>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={steps.map((s) => s.uid)} strategy={verticalListSortingStrategy}>
                <ol className="space-y-3">
                  {steps.map((s, i) => (
                    <SortableStep
                      key={s.uid}
                      step={s}
                      index={i}
                      members={members}
                      kind={kind}
                      onChange={(patch) => patchStep(s.uid, patch)}
                      onRemove={() => removeStep(s.uid)}
                      isLast={i === steps.length - 1}
                    />
                  ))}
                </ol>
              </SortableContext>
            </DndContext>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push("/admin/workflows-sequential")}>
          Cancel
        </Button>
        <Button onClick={save} disabled={saving}>
          <Save className="h-4 w-4 me-1.5" />
          {saving ? "Saving..." : isEdit ? "Save changes" : "Create workflow"}
        </Button>
      </div>
    </div>
  );
}

function SortableStep({
  step,
  index,
  members,
  kind,
  onChange,
  onRemove,
  isLast,
}: {
  step: Step;
  index: number;
  members: Member[];
  kind: WorkflowKind;
  onChange: (patch: Partial<Step>) => void;
  onRemove: () => void;
  isLast: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: step.uid,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <li ref={setNodeRef} style={style} className="rounded-lg border bg-card">
      <div className="p-3 flex items-start gap-3">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="mt-1 text-muted-foreground hover:text-foreground cursor-grab"
          aria-label="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold shrink-0">
          {index + 1}
        </span>
        <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-2">
          <Input
            className="md:col-span-4"
            placeholder="Step name (e.g. Sales close)"
            value={step.name}
            onChange={(e) => onChange({ name: e.target.value })}
          />
          <Input
            className="md:col-span-5"
            placeholder="Task title (what gets created for the assignee)"
            value={step.taskTitle}
            onChange={(e) => onChange({ taskTitle: e.target.value })}
          />
          {kind === "TEMPLATE" ? (
            <Input
              type="number"
              className="md:col-span-1"
              placeholder="Hours"
              value={step.budgetHours}
              min={0.25}
              step={0.25}
              title="Hours after the previous step completes"
              onChange={(e) => onChange({ budgetHours: Number(e.target.value) || 1 })}
            />
          ) : (
            <Input
              type="datetime-local"
              className="md:col-span-2"
              title="Absolute deadline — task must be done by this date/time"
              value={step.deadlineAt ? step.deadlineAt.slice(0, 16) : ""}
              onChange={(e) => {
                const v = e.target.value;
                onChange({ deadlineAt: v ? new Date(v).toISOString() : null });
              }}
            />
          )}
          <Select
            value={step.assigneeUserId ?? `role:${step.assigneeRole ?? "creator"}`}
            onValueChange={(v) => {
              if (!v) return;
              if (v.startsWith("role:")) {
                onChange({ assigneeUserId: null, assigneeRole: v.slice(5) });
              } else {
                onChange({ assigneeUserId: v, assigneeRole: null });
              }
            }}
          >
            <SelectTrigger className="md:col-span-2"><SelectValue placeholder="Assignee" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="role:creator">Trigger user</SelectItem>
              {ROLES.filter((r) => r !== "creator" && r !== "trigger_user").map((r) => (
                <SelectItem key={r} value={`role:${r}`}>Role: {r}</SelectItem>
              ))}
              {members.length > 0 && <div className="px-2 py-1 text-xs text-muted-foreground">— Specific user —</div>}
              {members.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name ?? m.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Textarea
            className="md:col-span-12"
            rows={2}
            placeholder="Task description (optional)"
            value={step.taskDescription}
            onChange={(e) => onChange({ taskDescription: e.target.value })}
          />

          <div className="md:col-span-3">
            <Label className="text-xs">Type</Label>
            <Select value={step.taskType} onValueChange={(v) => onChange({ taskType: v ?? "GENERAL" })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{t.replace("_", " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs">Priority</Label>
            <Select value={step.taskPriority} onValueChange={(v) => onChange({ taskPriority: v ?? "MEDIUM" })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-3 flex items-center gap-2 pt-5">
            <Checkbox
              checked={step.slaIncidentOnLate}
              onCheckedChange={(v) => onChange({ slaIncidentOnLate: !!v })}
            />
            <span className="text-xs text-muted-foreground">Late → HR incident</span>
          </div>
          <div className="md:col-span-3 flex items-center gap-2 pt-5">
            <Checkbox
              checked={step.slaBonusOnEarly}
              onCheckedChange={(v) => onChange({ slaBonusOnEarly: !!v })}
            />
            <span className="text-xs text-muted-foreground">Under 50% → HR bonus</span>
          </div>
          <div className="md:col-span-1 flex justify-end pt-5">
            <Button variant="ghost" size="icon" onClick={onRemove} aria-label="Remove step">
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        </div>
      </div>
      {!isLast && (
        <div className="flex items-center justify-center pb-1">
          <ArrowDown className="h-4 w-4 text-muted-foreground" />
        </div>
      )}
    </li>
  );
}
