import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
// audit v12 MEDIUM (MED-54): use canonical isPlatformAdmin instead of local copy
import { isPlatformAdmin } from "@/lib/crm/admin-gates";

/**
 * GET /api/admin/services-catalogue
 * Single source of truth for "what we sell" — driven by CrmProduct. Partner
 * deals + opportunity products both read from here; partner-side
 * `PartnerService` rows are mirrored on demand via POST below.
 */
export async function GET() {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const products = await db.crmProduct.findMany({
    where: { active: true },
    orderBy: { nameEn: "asc" },
    select: {
      id: true,
      code: true,
      nameEn: true,
      nameAr: true,
      description: true,
      basePrice: true,
      currency: true,
      category: true,
      active: true,
    },
  });
  return NextResponse.json({ products });
}

/**
 * POST /api/admin/services-catalogue/sync
 * Mirrors CrmProduct rows into PartnerService so the partner-side UI keeps
 * working without forking. The Partner module reads its catalogue from
 * PartnerService; this route keeps that table in sync with the canonical
 * CrmProduct list. Idempotent: existing rows get updated; missing ones
 * created.
 */
export async function POST() {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isPlatformAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const products = await db.crmProduct.findMany({
    where: { active: true },
    select: { id: true, code: true, nameEn: true, description: true, basePrice: true },
  });

  let created = 0;
  let updated = 0;
  // Use the product code as a stable PartnerService.id so re-syncs are idempotent.
  for (const p of products) {
    const partnerServiceId = `crm-product-${p.code}`;
    const existing = await db.partnerService.findUnique({ where: { id: partnerServiceId } });
    if (existing) {
      await db.partnerService.update({
        where: { id: partnerServiceId },
        data: {
          name: p.nameEn,
          description: p.description ?? "",
          basePrice: Number(p.basePrice),
          isActive: true,
        },
      });
      updated += 1;
    } else {
      await db.partnerService.create({
        data: {
          id: partnerServiceId,
          name: p.nameEn,
          description: p.description ?? "",
          basePrice: Number(p.basePrice),
          isActive: true,
        },
      });
      created += 1;
    }
  }

  return NextResponse.json({ ok: true, productsScanned: products.length, created, updated });
}
