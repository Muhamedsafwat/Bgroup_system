import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";
import { publish } from "@/lib/events/bus";
import { describeZodError } from "@/lib/zod-errors";

const bodySchema = z.object({
  module: z.enum(["hr", "partners", "crm"]),
  id: z.string().min(1),
});

const allBodySchema = z.object({
  scope: z.literal("all"),
  module: z.enum(["hr", "partners", "crm"]).optional(),
});

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const body = await req.json().catch(() => ({}));

  // Bulk: mark all (optionally per-module) as read.
  const allParsed = allBodySchema.safeParse(body);
  if (allParsed.success) {
    const ops: Promise<unknown>[] = [];
    if (!allParsed.data.module || allParsed.data.module === "hr") {
      ops.push(
        db.hrNotification.updateMany({
          where: { userId, isRead: false },
          data: { isRead: true },
        })
      );
    }
    if (!allParsed.data.module || allParsed.data.module === "partners") {
      ops.push(
        db.partnerNotification.updateMany({
          where: { userId, isRead: false },
          data: { isRead: true },
        })
      );
    }
    if (!allParsed.data.module || allParsed.data.module === "crm") {
      ops.push(
        db.crmNotification.updateMany({
          where: { userId, isRead: false },
          data: { isRead: true },
        })
      );
    }
    await Promise.all(ops);
    publish({ type: "data.invalidate", userId, payload: { queryKeys: [["notifications"]] } });
    return NextResponse.json({ ok: true });
  }

  // Single: mark one notification as read.
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    { const __z = describeZodError(parsed.error); return NextResponse.json({ error: __z.message, fieldErrors: __z.fieldErrors }, { status: 400 }); }
  }

  if (parsed.data.module === "hr") {
    const r = await db.hrNotification.updateMany({
      where: { id: parsed.data.id, userId },
      data: { isRead: true },
    });
    if (r.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  } else if (parsed.data.module === "partners") {
    const r = await db.partnerNotification.updateMany({
      where: { id: parsed.data.id, userId },
      data: { isRead: true },
    });
    if (r.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  } else {
    const r = await db.crmNotification.updateMany({
      where: { id: parsed.data.id, userId },
      data: { isRead: true },
    });
    if (r.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  publish({ type: "notification.read", userId, payload: { id: parsed.data.id } });
  return NextResponse.json({ ok: true });
}
