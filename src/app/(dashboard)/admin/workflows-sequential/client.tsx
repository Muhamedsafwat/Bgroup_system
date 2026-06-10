"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Workflow, Play, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

type Workflow = {
  id: string;
  name: string;
  description: string;
  module: string;
  isActive: boolean;
  steps: Array<{ id: string; position: number; name: string; budgetHours: number }>;
  updatedAt: string;
};

export function WorkflowsListClient() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);

  // audit v12 MEDIUM (MED-66): handle non-OK responses and surface errors to the user
  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/sequential-workflows");
      if (res.ok) {
        const data = await res.json();
        setWorkflows(data.workflows ?? []);
      } else {
        toast.error("Failed to load workflows");
      }
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh();
  }, []);

  async function trigger(id: string) {
    const res = await fetch(`/api/admin/sequential-workflows/${id}/trigger`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "Trigger failed");
      return;
    }
    toast.success(`Run started — first task: ${data.firstTaskId}`);
  }

  // audit v12 MEDIUM (MED-66): wrap fetch in try/catch to handle network-level errors
  async function remove(id: string) {
    if (!confirm("Delete this workflow? In-flight runs will be cascaded.")) return;
    try {
      const res = await fetch(`/api/admin/sequential-workflows/${id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("Delete failed");
        return;
      }
      toast.success("Deleted");
      refresh();
    } catch {
      toast.error("Delete failed — network error");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Link href="/admin/workflows-sequential/new">
          <Button size="sm">
            <Plus className="h-4 w-4 me-1.5" />
            New workflow
          </Button>
        </Link>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
      ) : workflows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Workflow className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm">No workflows yet. Create one to start orchestrating step-by-step handoffs.</p>
          </CardContent>
        </Card>
      ) : (
        workflows.map((w) => (
          <Card key={w.id}>
            <CardHeader className="flex flex-row items-center justify-between py-3">
              <div className="flex-1">
                <CardTitle className="text-base flex items-center gap-2">
                  {w.name}
                  <span className="text-[10px] uppercase rounded px-1.5 py-0.5 bg-muted text-muted-foreground">
                    {w.module}
                  </span>
                  {!w.isActive && (
                    <span className="text-[10px] uppercase rounded px-1.5 py-0.5 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                      inactive
                    </span>
                  )}
                </CardTitle>
                {w.description && (
                  <p className="text-xs text-muted-foreground mt-0.5">{w.description}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{w.steps.length} steps</span>
                <Button size="sm" variant="outline" onClick={() => trigger(w.id)} disabled={!w.isActive}>
                  <Play className="h-4 w-4 me-1.5" />
                  Run
                </Button>
                <Link href={`/admin/workflows-sequential/${w.id}`}>
                  <Button size="sm" variant="outline">
                    <Pencil className="h-4 w-4 me-1.5" />
                    Edit
                  </Button>
                </Link>
                <Button size="sm" variant="ghost" onClick={() => remove(w.id)} aria-label="Delete">
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-center gap-2">
                {w.steps.map((s, i) => (
                  <div key={s.id} className="flex items-center gap-2">
                    <div className="px-2.5 py-1 rounded-md bg-muted text-xs flex items-center gap-1.5">
                      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-semibold">
                        {i + 1}
                      </span>
                      <span>{s.name}</span>
                      <span className="text-muted-foreground">· {s.budgetHours}h</span>
                    </div>
                    {i < w.steps.length - 1 && <span className="text-muted-foreground">→</span>}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
