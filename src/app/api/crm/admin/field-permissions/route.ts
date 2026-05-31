import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { describeZodError } from "@/lib/zod-errors";
import { isAdminOnly } from "@/lib/crm/admin-gates";

/**
 * Tier-1 #29 — field-level permissions matrix per (objectType, role).
 *
 * Stored as a single JSON blob keyed by stable id (one row per
 * objectType + role pair). Shape:
 *
 *   { "estimatedValue": "readonly", "ownerId": "hidden", ... }
 *
 * Reads default to "editable" when a key isn't in the map, so adding
 * new fields doesn't break existing roles.
 *
 * For the first cut we lean on CrmCustomFieldDef's matrix table —
 * but the field set here is the CORE schema, not custom fields. The
 * runtime enforcement (in opportunity updateOpportunity etc.) reads
 * these via `getFieldPermissions(role, "opportunity")`.
 *
 * Gate: ADMIN (settings-class).
 */

const upsertSchema = z.object({
  objectType: z.enum(["opportunity", "contact", "coldLead", "company"]),
  role: z.enum(["REP", "ACCOUNT_MGR", "ASSISTANT", "MANAGER", "ADMIN"]),
  matrix: z.record(z.string(), z.enum(["editable", "readonly", "hidden"])),
});

// Stored as CrmSavedView rows scoped "field-permissions:opportunity:REP"
// so we don't need yet another schema model. Hacky but pragmatic — the
// existing infrastructure already handles JSON config + admin gating,
// and field permissions are a small surface area.
function scopeFor(objectType: string, role: string) {
  return `field-permissions:${objectType}:${role}`;
}

export async function GET(req: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdminOnly(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const objectType = url.searchParams.get("objectType") ?? "opportunity";
  const rows = await db.crmSavedView.findMany({
    where: { scope: { startsWith: `field-permissions:${objectType}:` } },
  });
  return NextResponse.json({
    matrices: rows.map((r) => ({
      role: r.scope.split(":")[2],
      matrix: r.filtersJson,
    })),
  });
}

export async function PUT(req: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdminOnly(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    const { message, fieldErrors } = describeZodError(parsed.error);
    return NextResponse.json({ error: message, fieldErrors }, { status: 422 });
  }
  const scope = scopeFor(parsed.data.objectType, parsed.data.role);
  const name = `field-permissions ${parsed.data.objectType}/${parsed.data.role}`;
  const ownerId = session.user.crmProfileId!;
  const existing = await db.crmSavedView.findFirst({ where: { scope, ownerId } });
  const row = existing
    ? await db.crmSavedView.update({
        where: { id: existing.id },
        data: { filtersJson: parsed.data.matrix },
      })
    : await db.crmSavedView.create({
        data: { scope, name, filtersJson: parsed.data.matrix, ownerId, isShared: true },
      });
  return NextResponse.json({ ok: true, id: row.id });
}
