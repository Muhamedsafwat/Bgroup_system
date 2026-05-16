"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Entity = { id: string; code: string; nameEn: string; nameAr: string };
type Product = {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  entityId: string;
  basePrice: number;
  currency: string;
};

export function ConvertColdLeadClient({
  leadId,
  leadName,
  entities,
  products,
  defaultEntityId,
}: {
  leadId: string;
  leadName: string;
  entities: Entity[];
  products: Product[];
  defaultEntityId: string;
}) {
  const router = useRouter();
  const [entityId, setEntityId] = useState(defaultEntityId);
  const [estimatedValue, setEstimatedValue] = useState("");
  const [currency, setCurrency] = useState<"EGP" | "USD" | "SAR" | "AED" | "QAR">("EGP");
  const [priority, setPriority] = useState<"HOT" | "WARM" | "COLD">("WARM");
  const [dealType, setDealType] = useState<"ONE_TIME" | "MONTHLY" | "ANNUAL" | "SAAS" | "MIXED" | "RETAINER">("ONE_TIME");
  const [productIds, setProductIds] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  // Lazy initializer keeps `Date.now()` out of the render path so the lint
  // rule (and SSR/CSR mismatch checks) stay happy.
  const [nextActionDate, setNextActionDate] = useState(() =>
    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]
  );
  const [saving, setSaving] = useState(false);

  function toggleProduct(id: string) {
    setProductIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function submit() {
    setSaving(true);
    try {
      const res = await fetch(`/api/crm/cold-leads/${leadId}/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityId,
          estimatedValue: Number(estimatedValue),
          currency,
          priority,
          dealType,
          productIds,
          notes: notes.trim() || undefined,
          nextActionDate,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Conversion failed");
        return;
      }
      toast.success(`${leadName} is now an opportunity`);
      router.push(`/crm/opportunities/${data.opportunityId}`);
    } finally {
      setSaving(false);
    }
  }

  const filteredProducts = entityId ? products.filter((p) => p.entityId === entityId) : products;

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Entity</Label>
            <Select value={entityId} onValueChange={(v) => setEntityId(v ?? "")}>
              <SelectTrigger>
                <SelectValue placeholder="Pick entity">
                  {(v) => entities.find((e) => e.id === v)?.nameEn ?? "Pick entity"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {entities.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.nameEn}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Priority</Label>
            <Select value={priority} onValueChange={(v) => setPriority((v as typeof priority) ?? "WARM")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="HOT">Hot</SelectItem>
                <SelectItem value="WARM">Warm</SelectItem>
                <SelectItem value="COLD">Cold</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Estimated value</Label>
            <Input
              type="number"
              value={estimatedValue}
              onChange={(e) => setEstimatedValue(e.target.value)}
              min={0}
              step="any"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Currency</Label>
            <Select value={currency} onValueChange={(v) => setCurrency((v as typeof currency) ?? "EGP")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(["EGP", "USD", "SAR", "AED", "QAR"] as const).map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Deal type</Label>
            <Select value={dealType} onValueChange={(v) => setDealType((v as typeof dealType) ?? "ONE_TIME")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(["ONE_TIME", "MONTHLY", "ANNUAL", "SAAS", "MIXED", "RETAINER"] as const).map((d) => (
                  <SelectItem key={d} value={d}>{d.replace("_", " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Next action date</Label>
            <Input
              type="date"
              value={nextActionDate}
              onChange={(e) => setNextActionDate(e.target.value)}
            />
          </div>
        </div>

        {filteredProducts.length > 0 && (
          <div className="space-y-1.5">
            <Label>Products / services (optional)</Label>
            <div className="max-h-44 overflow-y-auto rounded-md border divide-y">
              {filteredProducts.map((p) => {
                const checked = productIds.includes(p.id);
                return (
                  <button
                    type="button"
                    key={p.id}
                    onClick={() => toggleProduct(p.id)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-start hover:bg-accent ${checked ? "bg-primary/5" : ""}`}
                  >
                    <span className={`inline-flex h-4 w-4 items-center justify-center rounded border ${checked ? "bg-primary border-primary text-primary-foreground" : "border-border"}`}>
                      {checked && <Check className="h-3 w-3" />}
                    </span>
                    <span className="flex-1 text-sm">{p.nameEn}</span>
                    <span className="text-xs text-muted-foreground">{p.basePrice} {p.currency}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <Label>Notes</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="What did the prospect say? Anything the next touch should know."
          />
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => router.back()} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || !entityId || !estimatedValue || Number(estimatedValue) <= 0}>
            {saving ? "Converting…" : "Convert to opportunity"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
