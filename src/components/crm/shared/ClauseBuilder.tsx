"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, X } from "lucide-react";

/**
 * Shared "when X is Y" rule builder. Replaces the JSON-textarea UX
 * everywhere conditions / predicates are configured: workflows,
 * alert rules, trigger configs.
 *
 * Each row is one clause: { field, op, value }. The parent decides:
 *   - Which `fields` are pickable (label + type + optional options)
 *   - Which operators are available per field-type
 *
 * Two output shapes the parent can choose:
 *   - "array"  — produces a flat `[{field, op, value}, ...]` (alert rules)
 *   - "all"    — wraps in `{ all: [...] }` (workflow conditions)
 *   - "any"    — wraps in `{ any: [...] }`
 */

export type FieldDef = {
  key: string;
  label: string;
  type: "text" | "number" | "enum";
  options?: { value: string; label: string }[];
};

export type Clause = {
  field: string;
  op: string;
  value: string | number | string[] | null;
};

const OPS_BY_TYPE: Record<FieldDef["type"], { value: string; label: string }[]> = {
  text: [
    { value: "eq", label: "is" },
    { value: "neq", label: "is not" },
    { value: "contains", label: "contains" },
    { value: "exists", label: "is set" },
  ],
  number: [
    { value: "eq", label: "equals" },
    { value: "neq", label: "doesn't equal" },
    { value: "gt", label: "greater than" },
    { value: "gte", label: "≥" },
    { value: "lt", label: "less than" },
    { value: "lte", label: "≤" },
  ],
  enum: [
    { value: "eq", label: "is" },
    { value: "neq", label: "is not" },
    { value: "in", label: "is one of" },
  ],
};

export function ClauseBuilder({
  fields,
  clauses,
  onChange,
  emptyLabel = "Add a condition",
}: {
  fields: FieldDef[];
  clauses: Clause[];
  onChange: (next: Clause[]) => void;
  emptyLabel?: string;
}) {
  function addClause() {
    const first = fields[0];
    if (!first) return;
    onChange([
      ...clauses,
      { field: first.key, op: OPS_BY_TYPE[first.type][0].value, value: "" },
    ]);
  }
  function updateAt(idx: number, patch: Partial<Clause>) {
    onChange(clauses.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }
  function removeAt(idx: number) {
    onChange(clauses.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-2">
      {clauses.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          No conditions yet — this rule will match every event.
        </p>
      ) : (
        clauses.map((c, idx) => {
          const fieldDef = fields.find((f) => f.key === c.field) ?? fields[0];
          const ops = OPS_BY_TYPE[fieldDef.type];
          const showValue = c.op !== "exists";
          const isMulti = c.op === "in";
          return (
            <div key={idx} className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground w-12">
                {idx === 0 ? "When" : "and"}
              </span>
              <select
                value={c.field}
                onChange={(e) => {
                  const newField = fields.find((f) => f.key === e.target.value);
                  if (!newField) return;
                  // Reset op + value when field changes — operator list
                  // depends on the new field's type.
                  updateAt(idx, {
                    field: newField.key,
                    op: OPS_BY_TYPE[newField.type][0].value,
                    value: "",
                  });
                }}
                className="h-8 rounded-md border bg-background px-2 text-xs"
              >
                {fields.map((f) => (
                  <option key={f.key} value={f.key}>{f.label}</option>
                ))}
              </select>
              <select
                value={c.op}
                onChange={(e) => updateAt(idx, { op: e.target.value, value: "" })}
                className="h-8 rounded-md border bg-background px-2 text-xs"
              >
                {ops.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              {showValue &&
                (fieldDef.type === "enum" && fieldDef.options ? (
                  isMulti ? (
                    // "is one of" — comma-separated text for multi-select
                    // (keeps the row tight; alt is a multi-checkbox popover).
                    <Input
                      className="h-8 text-xs flex-1 min-w-32"
                      placeholder="HOT, WARM"
                      value={Array.isArray(c.value) ? c.value.join(", ") : (c.value ?? "")}
                      onChange={(e) =>
                        updateAt(idx, {
                          value: e.target.value
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  ) : (
                    <select
                      value={(c.value as string) ?? ""}
                      onChange={(e) => updateAt(idx, { value: e.target.value })}
                      className="h-8 rounded-md border bg-background px-2 text-xs flex-1 min-w-32"
                    >
                      <option value="">—</option>
                      {fieldDef.options.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  )
                ) : (
                  <Input
                    type={fieldDef.type === "number" ? "number" : "text"}
                    className="h-8 text-xs flex-1 min-w-32"
                    value={
                      c.value === null
                        ? ""
                        : typeof c.value === "number"
                          ? String(c.value)
                          : String(c.value)
                    }
                    onChange={(e) =>
                      updateAt(idx, {
                        value:
                          fieldDef.type === "number"
                            ? e.target.value === ""
                              ? null
                              : Number(e.target.value)
                            : e.target.value,
                      })
                    }
                  />
                ))}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                onClick={() => removeAt(idx)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          );
        })
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 text-xs"
        onClick={addClause}
      >
        <Plus className="h-3.5 w-3.5 me-1" />
        {emptyLabel}
      </Button>
    </div>
  );
}

/**
 * Convert a list of clauses to the storage shape the server expects.
 *   "array" → flat JSON array (alert-rules `predicateJson`)
 *   "all"   → `{ all: [...] }` (workflow conditionJson, ALL must match)
 *   "any"   → `{ any: [...] }`
 */
export function clausesToJson(clauses: Clause[], shape: "array" | "all" | "any") {
  if (clauses.length === 0) return shape === "array" ? [] : null;
  if (shape === "array") return clauses;
  return { [shape]: clauses };
}

/**
 * Inverse: parse stored JSON back into editable clauses. Returns []
 * when the stored value is null / empty / unrecognised so the
 * builder UI starts fresh rather than crashing.
 *
 * Normalises legacy / hand-written data on the way in: an `in`
 * clause whose value was stored as a string ("HOT, WARM") is
 * silently dead in the engine (its Array.isArray check fails). We
 * coerce it into a string[] so the builder, the round-trip, and
 * the engine all agree on the shape.
 */
function normaliseClause(raw: unknown): Clause | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as { field?: unknown; op?: unknown; value?: unknown };
  if (typeof o.field !== "string" || typeof o.op !== "string") return null;
  let value = o.value as Clause["value"];
  if (o.op === "in" && typeof value === "string") {
    value = value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return { field: o.field, op: o.op, value: value ?? null };
}

export function clausesFromJson(stored: unknown): Clause[] {
  if (!stored) return [];
  if (Array.isArray(stored)) {
    return stored.map(normaliseClause).filter((c): c is Clause => c !== null);
  }
  if (typeof stored === "object" && stored !== null) {
    const o = stored as { all?: unknown; any?: unknown; field?: unknown };
    if (Array.isArray(o.all)) {
      return o.all.map(normaliseClause).filter((c): c is Clause => c !== null);
    }
    if (Array.isArray(o.any)) {
      return o.any.map(normaliseClause).filter((c): c is Clause => c !== null);
    }
    if ("field" in o && "op" in o) {
      const single = normaliseClause(o);
      return single ? [single] : [];
    }
  }
  return [];
}
