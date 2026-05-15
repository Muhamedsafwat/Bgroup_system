"use client";

import { useState, useEffect } from "react";
import { useLocale } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EntityBadge } from "@/components/crm/shared/EntityBadge";
import { EmptyState } from "@/components/crm/shared/EmptyState";
import { Package, Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  createProduct,
  updateProduct,
  deleteProduct,
  listEntitiesForProductForm,
} from "./actions";

type ProductItem = {
  id: string;
  code: string;
  category: string;
  nameEn: string;
  nameAr: string;
  description?: string | null;
  descriptionAr?: string | null;
  basePrice: unknown;
  currency: string;
  dealType: string;
  active: boolean;
  entity: {
    id: string;
    code: string;
    nameEn: string;
    nameAr: string;
    color: string;
  };
};

type EntityOption = {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  color: string;
};

const CURRENCIES = ["EGP", "USD", "SAR", "AED", "QAR"] as const;
const DEAL_TYPES = ["ONE_TIME", "MONTHLY", "ANNUAL", "SAAS", "MIXED", "RETAINER"] as const;

/**
 * CRM Products page — admins (CEO / ADMIN) get full CRUD; everyone else gets
 * a read-only grouped view. Add / Edit / Delete share the same dialog; soft
 * delete is used because historical opportunities reference products by FK.
 */
export function ProductsClient({
  products: initial,
  canEdit,
}: {
  products: ProductItem[];
  canEdit: boolean;
}) {
  const { t, locale } = useLocale();
  const [products, setProducts] = useState(initial);
  const [entities, setEntities] = useState<EntityOption[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProductItem | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [code, setCode] = useState("");
  const [entityId, setEntityId] = useState("");
  const [category, setCategory] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [description, setDescription] = useState("");
  const [basePrice, setBasePrice] = useState("");
  const [currency, setCurrency] = useState<typeof CURRENCIES[number]>("EGP");
  const [dealType, setDealType] = useState<typeof DEAL_TYPES[number]>("ONE_TIME");
  const [active, setActive] = useState(true);

  // Lazy-load entities only when admin opens the dialog the first time.
  useEffect(() => {
    if (canEdit && entities.length === 0 && dialogOpen) {
      listEntitiesForProductForm().then(setEntities).catch(() => setEntities([]));
    }
  }, [canEdit, dialogOpen, entities.length]);

  function resetForm() {
    setCode("");
    setEntityId("");
    setCategory("");
    setNameEn("");
    setNameAr("");
    setDescription("");
    setBasePrice("");
    setCurrency("EGP");
    setDealType("ONE_TIME");
    setActive(true);
  }

  function openCreate() {
    setEditing(null);
    resetForm();
    setDialogOpen(true);
  }

  function openEdit(p: ProductItem) {
    setEditing(p);
    setCode(p.code);
    setEntityId(p.entity.id);
    setCategory(p.category);
    setNameEn(p.nameEn);
    setNameAr(p.nameAr ?? "");
    setDescription(p.description ?? "");
    setBasePrice(String(Number(p.basePrice)));
    setCurrency(p.currency as typeof CURRENCIES[number]);
    setDealType(p.dealType as typeof DEAL_TYPES[number]);
    setActive(p.active);
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!code.trim() || !entityId || !category.trim() || !nameEn.trim() || !basePrice) {
      toast.error("Code, entity, category, name, and price are required");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        code: code.trim(),
        entityId,
        category: category.trim(),
        nameEn: nameEn.trim(),
        nameAr: nameAr.trim() || undefined,
        description: description.trim() || null,
        basePrice: Number(basePrice),
        currency,
        dealType,
        active,
      };
      if (editing) {
        const updated = await updateProduct(editing.id, payload);
        setProducts(products.map((p) => (p.id === editing.id ? (updated as ProductItem) : p)));
        toast.success("Product updated");
      } else {
        const created = await createProduct(payload);
        setProducts([...products, created as ProductItem]);
        toast.success("Product created");
      }
      setDialogOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(p: ProductItem) {
    if (!confirm(`Hide "${p.nameEn}" from the catalogue? Historical opportunities are unaffected.`))
      return;
    setSaving(true);
    try {
      const updated = await deleteProduct(p.id);
      setProducts(products.map((x) => (x.id === p.id ? (updated as ProductItem) : x)));
      toast.success("Product hidden");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setSaving(false);
    }
  }

  // Group by entity, then by category — identical visual to the prior version.
  const grouped = new Map<
    string,
    { entity: ProductItem["entity"]; categories: Map<string, ProductItem[]> }
  >();
  for (const product of products) {
    const entityCode = product.entity.code;
    if (!grouped.has(entityCode)) {
      grouped.set(entityCode, { entity: product.entity, categories: new Map() });
    }
    const entityGroup = grouped.get(entityCode)!;
    if (!entityGroup.categories.has(product.category)) {
      entityGroup.categories.set(product.category, []);
    }
    entityGroup.categories.get(product.category)!.push(product);
  }

  const dealTypeLabels = t.dealTypes as Record<string, string>;
  const currencyLabels = t.currencies as Record<string, string>;

  if (products.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">{t.nav.products}</h1>
          {canEdit && (
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4 me-1" /> Add product
            </Button>
          )}
        </div>
        <EmptyState
          icon={<Package className="h-8 w-8 text-muted-foreground" />}
          title={t.common.noResults}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t.nav.products}</h1>
        {canEdit && (
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4 me-1" /> Add product
          </Button>
        )}
      </div>

      {Array.from(grouped.entries()).map(([entityCode, { entity, categories }]) => (
        <Card key={entityCode}>
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              <EntityBadge
                code={entity.code}
                name={locale === "ar" ? entity.nameAr : entity.nameEn}
                color={entity.color}
              />
              <span>{locale === "ar" ? entity.nameAr : entity.nameEn}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {Array.from(categories.entries()).map(([cat, items]) => (
              <div key={cat}>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  {cat}
                </h3>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-24">Code</TableHead>
                        <TableHead>{t.common.name}</TableHead>
                        <TableHead>{t.forms.basePrice}</TableHead>
                        <TableHead>{t.forms.currency}</TableHead>
                        <TableHead>{t.forms.dealType}</TableHead>
                        <TableHead>{t.common.status}</TableHead>
                        {canEdit && <TableHead className="w-32">Actions</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((product) => (
                        <TableRow key={product.id}>
                          <TableCell className="font-mono text-xs ltr-nums">
                            {product.code}
                          </TableCell>
                          <TableCell className="font-medium">
                            {locale === "ar" ? product.nameAr : product.nameEn}
                          </TableCell>
                          <TableCell className="ltr-nums">
                            {Number(product.basePrice).toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </TableCell>
                          <TableCell>
                            {currencyLabels[product.currency] ?? product.currency}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {dealTypeLabels[product.dealType] ?? product.dealType}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {product.active ? (
                              <Badge variant="default" className="bg-emerald-600">
                                {t.common.active}
                              </Badge>
                            ) : (
                              <Badge variant="secondary">{t.common.inactive}</Badge>
                            )}
                          </TableCell>
                          {canEdit && (
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => openEdit(product)}
                                  title="Edit"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-destructive hover:text-destructive"
                                  onClick={() => handleDelete(product)}
                                  disabled={saving || !product.active}
                                  title={product.active ? "Hide from catalogue" : "Already hidden"}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      {canEdit && (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit product" : "Add product"}</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Code</Label>
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="e.g. ERP-PRO"
                  disabled={!!editing}
                />
              </div>
              <div>
                <Label>Entity</Label>
                <Select
                  value={entityId || undefined}
                  onValueChange={(v) => setEntityId(v ?? "")}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Pick an entity">
                      {(() => {
                        const e = entities.find((x) => x.id === entityId);
                        return e ? `${e.nameEn} (${e.code})` : "Pick an entity";
                      })()}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {entities.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.nameEn} ({e.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Category</Label>
                <Input
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="e.g. Services"
                />
              </div>
              <div>
                <Label>Name (English)</Label>
                <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
              </div>
              <div>
                <Label>Name (Arabic)</Label>
                <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} dir="rtl" />
              </div>
              <div className="sm:col-span-2">
                <Label>Description (optional)</Label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Short marketing description"
                />
              </div>
              <div>
                <Label>Base price</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={basePrice}
                  onChange={(e) => setBasePrice(e.target.value)}
                />
              </div>
              <div>
                <Label>Currency</Label>
                <Select value={currency} onValueChange={(v) => setCurrency(v as typeof CURRENCIES[number])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Deal type</Label>
                <Select value={dealType} onValueChange={(v) => setDealType(v as typeof DEAL_TYPES[number])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DEAL_TYPES.map((d) => (
                      <SelectItem key={d} value={d}>
                        {dealTypeLabels[d] ?? d.replace("_", " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2 pt-6">
                <input
                  type="checkbox"
                  id="active"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                />
                <Label htmlFor="active" className="cursor-pointer">
                  Active (visible in pickers)
                </Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : editing ? "Save" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
