import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { requireAuthSession } from "@/lib/admin-auth";
import { describeZodError } from "@/lib/zod-errors";

const upsertSchema = z.object({
  preferences: z
    .array(
      z.object({
        eventType: z.string().min(1),
        channel: z.enum(["IN_APP", "EMAIL", "PUSH", "WHATSAPP"]),
        enabled: z.boolean(),
      })
    )
    .min(1)
    .max(200),
});

export async function GET() {
  const { session, error } = await requireAuthSession();
  if (error) return error;
  const prefs = await db.notificationPreference.findMany({
    where: { userId: session.user.id! },
  });
  return NextResponse.json({ preferences: prefs });
}

/** Bulk upsert preferences. */
export async function PUT(req: Request) {
  const { session, error } = await requireAuthSession();
  if (error) return error;
  const body = await req.json();
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    { const __z = describeZodError(parsed.error); return NextResponse.json({ error: __z.message, fieldErrors: __z.fieldErrors }, { status: 400 }); }
  }

  const ops = parsed.data.preferences.map((p) =>
    db.notificationPreference.upsert({
      where: {
        userId_eventType_channel: {
          userId: session.user.id!,
          eventType: p.eventType,
          channel: p.channel,
        },
      },
      create: {
        userId: session.user.id!,
        eventType: p.eventType,
        channel: p.channel,
        enabled: p.enabled,
      },
      update: { enabled: p.enabled },
    })
  );
  await db.$transaction(ops);
  return NextResponse.json({ ok: true });
}
