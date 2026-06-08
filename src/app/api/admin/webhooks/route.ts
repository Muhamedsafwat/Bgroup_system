import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/admin-auth";
import { generateWebhookSecret } from "@/lib/webhooks";
import { describeZodError } from "@/lib/zod-errors";

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

/**
 * Reject SSRF-relevant URLs: private CIDR ranges, link-local, loopback,
 * file://, gopher://, javascript:, etc. We only allow http(s) public
 * hosts. Hostnames that resolve to private IPs are not caught here —
 * the webhook dispatcher should re-validate at delivery time (DNS
 * rebinding) but at create time we filter the obvious cases.
 */
function isInternalUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return true;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return true;
  const host = u.hostname.toLowerCase();
  if (!host) return true;
  // Loopback names
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  // IPv4 literals
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [parseInt(ipv4[1], 10), parseInt(ipv4[2], 10)];
    if (a === 10) return true;
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local + AWS IMDS
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 0) return true;
    if (a >= 224) return true; // multicast / reserved
  }
  // IPv6 literals — bracketed
  if (host.startsWith("[") || host.includes(":")) return true;
  // `.internal` / `.local` corp suffixes
  if (host.endsWith(".internal") || host.endsWith(".local")) return true;
  return false;
}

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
