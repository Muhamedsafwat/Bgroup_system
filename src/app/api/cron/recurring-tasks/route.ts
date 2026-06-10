import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseRecurrence, computeNextFixedDueAt } from "@/lib/tasks/recurrence";

/**
 * Cron endpoint that walks every task with a `fixed_schedule` recurrence and
 * spawns a fresh instance whenever the next-due date has passed since the
 * template's last spawn anchor.
 *
 * Auth modes (any one suffices):
 *   - Bearer token equal to env var `CRON_SECRET` (used by external cron).
 *   - Platform admin session (`super_admin` HR role only) — lets ops trigger
 *     manually from the dashboard if needed.
 *
 * Idempotent: only spawns the next instance once per template per cycle.
 */
function authorised(req: Request, session: Session | null) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth === `Bearer ${expected}`) return true;
  }
  // audit v12 MEDIUM (MED-53): restrict session-based access to super_admin only;
  // removed partners-admin branch to align with alert-rules/route.ts.
  if (session?.user?.id && session.user.hrRoles?.includes("super_admin")) {
    return true;
  }
  return false;
}

export async function POST(req: Request) {
  const session = (await auth().catch(() => null)) as Session | null;
  if (!authorised(req, session)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Templates are the source of truth: tasks where recurrence.kind === "fixed_schedule"
  // AND `recurrenceTemplateId` is null (i.e. they ARE the template).
  // Prisma JSON filters: equals on a path.
  const templates = await db.task.findMany({
    where: {
      recurrenceTemplateId: null,
      // JSON path filter — Prisma supports `path` + `equals` for nested keys.
      recurrence: { path: ["kind"], equals: "fixed_schedule" },
    },
  });

  let spawned = 0;
  let skipped = 0;

  for (const tpl of templates) {
    const rule = parseRecurrence(tpl.recurrence);
    if (!rule || rule.kind !== "fixed_schedule") {
      skipped += 1;
      continue;
    }

    // Anchor: the latest descendant's createdAt, falling back to the template's createdAt.
    const last = await db.task.findFirst({
      where: { recurrenceTemplateId: tpl.id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    const anchor = last?.createdAt ?? tpl.createdAt;

    const nextDue = computeNextFixedDueAt(rule, anchor);
    if (!nextDue) {
      skipped += 1;
      continue;
    }

    // Only spawn if the next-due is in the past or now (i.e. the cadence has elapsed).
    if (nextDue.getTime() > Date.now()) {
      skipped += 1;
      continue;
    }

    await db.task.create({
      data: {
        title: tpl.title,
        description: tpl.description,
        type: tpl.type,
        priority: tpl.priority,
        status: "TODO",
        assigneeId: tpl.assigneeId,
        createdById: tpl.createdById,
        entityType: tpl.entityType,
        entityId: tpl.entityId,
        module: tpl.module,
        dueAt: nextDue,
        recurrence: tpl.recurrence ?? undefined,
        recurrenceTemplateId: tpl.id,
        parentId: tpl.parentId,
      },
    });
    spawned += 1;
  }

  return NextResponse.json({ ok: true, templatesScanned: templates.length, spawned, skipped });
}
