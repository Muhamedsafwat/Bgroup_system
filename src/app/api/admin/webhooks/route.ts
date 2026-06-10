import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/admin-auth";
import { generateWebhookSecret } from "@/lib/webhooks";
import { describeZodError } from "@/lib/zod-errors";
// audit v12 MEDIUM (MED-63): use canonical shared SSRF guard instead of local copy
import { isInternalUrl } from "@/lib/security/internal-url";

/**
 * Whitelist a known set of event keys. Without this an admin could
 * register arbitrary strings (millions of them) and they'd flow into
 * downstream dispatch logic that pattern-matches against them.
 */
const KNOWN_WEBHOOK_EVENTS = [
  "opp.created",
  "opp.updated",
  "opp.stage.changed",
  "opp.won",
  "opp.lost",
  "lead.created",
  "lead.disposition",
  "lead.converted",
  "deal.won",
  "deal.commission.paid",
  "hr.bonus.approved",
  "hr.overtime.approved",
  "hr.incident.created",
  "user.invited",
] as const;

const createSchema = z.object({
  url: z
    .string()
    .url()
    .max(2000)
    .refine((v) => !isInternalUrl(v), {
      message:
        "URL must be a public http(s) endpoint — private / loopback / link-local hosts are not allowed",
    }),
  events: z
    .array(z.enum(KNOWN_WEBHOOK_EVENTS))
    .min(1)
    .max(KNOWN_WEBHOOK_EVENTS.length),
});

export async function GET() {
  const { error } = await requirePlatformAdmin();
  if (error) return error;
  const endpoints = await db.webhookEndpoint.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      url: true,
      events: true,
      isActive: true,
      failureCount: true,
      lastDeliveryAt: true,
      createdAt: true,
    },
  });
  return NextResponse.json({ endpoints });
}

export async function POST(req: Request) {
  const { session, error } = await requirePlatformAdmin();
  if (error) return error;
  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    const __z = describeZodError(parsed.error);
    return NextResponse.json({ error: __z.message, fieldErrors: __z.fieldErrors }, { status: 422 });
  }
  const secret = generateWebhookSecret();
  const endpoint = await db.webhookEndpoint.create({
    data: {
      ownerId: session.user.id!,
      url: parsed.data.url,
      events: parsed.data.events,
      secret,
    },
  });
  // Return the secret exactly once.
  return NextResponse.json(
    { endpoint: { id: endpoint.id, url: endpoint.url, events: endpoint.events }, secret },
    { status: 201 }
  );
}
