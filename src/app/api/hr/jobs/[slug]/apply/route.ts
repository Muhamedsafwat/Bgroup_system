import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { describeZodError } from "@/lib/zod-errors";

// Public endpoint — no auth. Rate-limited by IP via the existing helper.
import { checkRateLimit } from "@/lib/hr/rate-limit";

const applySchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.email(),
  phone: z.string().max(40).optional(),
  resumeUrl: z.string().url().optional(),
  /// Honeypot: real applicants will leave this empty.
  website: z.string().optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  // Honeypot rejection.
  const body = await req.json();
  const parsed = applySchema.safeParse(body);
  if (!parsed.success) {
    { const __z = describeZodError(parsed.error); return NextResponse.json({ error: __z.message, fieldErrors: __z.fieldErrors }, { status: 400 }); }
  }
  if (parsed.data.website) {
    // Bot trap — silently accept but don't store.
    return NextResponse.json({ ok: true });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limit = checkRateLimit(`apply:${ip}`, 10, 60 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many applications from this IP. Try again later." },
      { status: 429 }
    );
  }

  const { slug } = await params;
  const job = await db.job.findUnique({ where: { slug } });
  if (!job || job.status !== "OPEN") {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  // Upsert candidate by email.
  const candidate = await db.candidate.upsert({
    where: { email: parsed.data.email },
    create: {
      email: parsed.data.email,
      fullName: parsed.data.fullName,
      phone: parsed.data.phone,
      resumeUrl: parsed.data.resumeUrl,
    },
    update: {
      fullName: parsed.data.fullName,
      phone: parsed.data.phone,
      resumeUrl: parsed.data.resumeUrl,
    },
  });

  // Create or revive an application.
  const application = await db.jobApplication.upsert({
    where: { jobId_candidateId: { jobId: job.id, candidateId: candidate.id } },
    create: { jobId: job.id, candidateId: candidate.id, stage: "APPLIED" },
    update: { stage: "APPLIED" },
  });

  return NextResponse.json({ ok: true, applicationId: application.id }, { status: 201 });
}
