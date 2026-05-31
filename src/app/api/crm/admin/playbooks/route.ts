import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { describeZodError } from "@/lib/zod-errors";
import { isAdminOnly } from "@/lib/crm/admin-gates";

/**
 * Tier-1 #24 — per-stage playbook content (admin-defined markdown).
 *   GET                 → list every playbook.
 *   GET ?stage=         → one playbook by stage code.
 *   PUT                 → upsert (one playbook per stage).
 *   DELETE ?stage=      → drop one.
 *
 * Settings-class: ADMIN + super_admin only.
 */

const upsertSchema = z.object({
  stage: z.string().trim().min(1).max(40),
  bodyMd: z.string().trim().max(50000),
  active: z.boolean().optional(),
});

export async function GET(req: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Reads are open to any CRM user so reps can see playbooks inline
  // on their opportunity detail. Writes still admin-only.
  if (!session.user.modules?.includes("crm")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const url = new URL(req.url);
  const stage = url.searchParams.get("stage");
  if (stage) {
    const pb = await db.crmStagePlaybook.findUnique({ where: { stage } });
    return NextResponse.json({ playbook: pb });
  }
  const playbooks = await db.crmStagePlaybook.findMany({ orderBy: { stage: "asc" } });
  return NextResponse.json({ playbooks });
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
  const pb = await db.crmStagePlaybook.upsert({
    where: { stage: parsed.data.stage },
    create: {
      stage: parsed.data.stage,
      bodyMd: parsed.data.bodyMd,
      active: parsed.data.active ?? true,
    },
    update: {
      bodyMd: parsed.data.bodyMd,
      ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
    },
  });
  return NextResponse.json({ ok: true, playbook: pb });
}

export async function DELETE(req: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdminOnly(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const stage = url.searchParams.get("stage");
  if (!stage) return NextResponse.json({ error: "stage is required" }, { status: 400 });
  await db.crmStagePlaybook.delete({ where: { stage } });
  return NextResponse.json({ ok: true });
}
