import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { describeZodError } from "@/lib/zod-errors";
import { scopeOpportunityByRole } from "@/lib/crm/rbac";
import { publish } from "@/lib/events/bus";
import type { Prisma } from "@/generated/prisma";

/**
 * GET  /api/crm/opportunities/[id]/comments
 * POST /api/crm/opportunities/[id]/comments  { body, mentionIds? }
 *
 * Visibility: anyone who can see the opp (via `scopeOpportunityByRole`)
 * can read AND post comments. Mentions create a CrmNotification row per
 * mentioned user, fanned out via the SSE bus so their bell badge
 * updates immediately.
 *
 * Body format: free text. Mention tokens are stored as `@<crmProfileId>`
 * inline so renames don't break old comments (the client resolves
 * fullName from the included `mentions` array on render). The dropdown
 * picker passes both the inserted token and the id list so the server
 * doesn't have to re-parse free text — `mentionIds` is the source of
 * truth for notification fan-out.
 */
const postSchema = z.object({
  body: z.string().trim().min(1, "Comment is required").max(5000),
  /// Whitelist of CrmUserProfile ids that should receive a mention
  /// notification. The body normally contains `@<crmProfileId>` tokens
  /// matching these; mismatches are silently dropped (the client may
  /// have edited a token out by hand). De-duplicated server-side.
  mentionIds: z.array(z.string().min(1)).max(50).optional(),
});

async function gate(session: Session, oppId: string) {
  const sUser = sessionUserOrNull(session);
  if (!sUser) return null;
  const opp = await db.crmOpportunity.findFirst({
    where: { id: oppId, ...scopeOpportunityByRole(sUser), deletedAt: null },
    select: { id: true, title: true, code: true, entityId: true },
  });
  return opp ? { sUser, opp } : null;
}

function sessionUserOrNull(session: Session) {
  if (!session?.user?.crmProfileId) return null;
  return {
    id: session.user.crmProfileId,
    email: session.user.email!,
    fullName: session.user.name ?? "",
    role: session.user.crmRole!,
    entityId: session.user.crmEntityId ?? null,
  };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const allowed = await gate(session, id);
  if (!allowed) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const comments = await db.crmOpportunityComment.findMany({
    where: { opportunityId: id, deletedAt: null },
    orderBy: { createdAt: "asc" },
    include: {
      author: {
        select: { id: true, fullName: true, avatarUrl: true, role: true },
      },
      mentions: {
        include: {
          mentioned: {
            select: { id: true, fullName: true, avatarUrl: true },
          },
        },
      },
    },
  });
  return NextResponse.json({
    comments: comments.map((c) => ({
      id: c.id,
      body: c.body,
      author: c.author,
      mentions: c.mentions.map((m) => m.mentioned),
      createdAt: c.createdAt.toISOString(),
      editedAt: c.editedAt?.toISOString() ?? null,
      isOwn: c.authorId === session.user.crmProfileId,
    })),
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const allowed = await gate(session, id);
  if (!allowed) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { sUser, opp } = allowed;
  const body = await req.json().catch(() => null);
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    const { message, fieldErrors } = describeZodError(parsed.error);
    return NextResponse.json({ error: message, fieldErrors }, { status: 422 });
  }
  // De-dupe + drop self-mentions so authors don't notify themselves.
  const mentionIds = Array.from(
    new Set((parsed.data.mentionIds ?? []).filter((mid) => mid !== sUser.id)),
  );
  // Resolve each mentioned id to a User.id (we notify by auth user).
  // Silently skip invalid / inactive profiles so a stale token in the
  // body doesn't 400 the whole comment.
  const validMentions =
    mentionIds.length === 0
      ? []
      : await db.crmUserProfile.findMany({
          // audit v12 MEDIUM (MED-17) recheck: scope to the opportunity's
          // entity so cross-entity profile ids in mentionIds are silently
          // dropped and receive no notification, mention row, or chip.
          where: { id: { in: mentionIds }, active: true, entityId: opp.entityId },
          select: { id: true, userId: true, fullName: true },
        });

  const oppHref = `/crm/opportunities/${opp.id}`;
  const authorName = sUser.fullName || session.user.email || "Someone";
  const title = `${authorName} mentioned you on ${opp.title}`;

  // Resolve `@<crmProfileId>` tokens in the body into `@<fullName>`
  // for the notification message. The bell renderer is a plain text
  // surface (no chip resolver like OpportunityComments has), so
  // storing raw cuid tokens would show "@clx1a2b3c4..." in the bell.
  // The token stays in the comment.body itself so renames in the
  // future still re-resolve cleanly inside the thread.
  const nameByProfileId = new Map(validMentions.map((m) => [m.id, m.fullName]));
  // Match cuid1 (lowercase base36 >=8 chars) + cuid2 (mixed-case)
  // + uuid (with dashes). Symmetric with the renderer regex in
  // OpportunityComments.tsx so server-resolved preview names and
  // client-rendered chips agree on which `@<id>` substrings are
  // mention tokens.
  // audit v12 LOW (LOW-4): use Unicode-aware truncation so surrogate pairs
  // (e.g. emoji) are never split, and trim back to the last whitespace so a
  // resolved @FullName mention chip is never left partially included.
  const previewBodyRaw = parsed.data.body.replace(/@([A-Za-z0-9_-]{8,})/g, (full, id) => {
    const n = nameByProfileId.get(id);
    return n ? `@${n}` : full;
  });
  const previewBodyCapped = [...previewBodyRaw].slice(0, 200).join("");
  const previewBody =
    previewBodyCapped.length < [...previewBodyRaw].length &&
    previewBodyCapped.length > 0 &&
    !/\s$/.test(previewBodyCapped)
      ? previewBodyCapped.replace(/\S+$/, "").trimEnd() || previewBodyCapped
      : previewBodyCapped;

  const comment = await db.$transaction(async (tx) => {
    const created = await tx.crmOpportunityComment.create({
      data: {
        opportunityId: opp.id,
        authorId: sUser.id,
        actingAdminId: session.user.actingAsCrmProfileId ?? null,
        body: parsed.data.body,
        mentions: {
          create: validMentions.map((m) => ({ mentionedUserId: m.id })),
        },
      },
      include: {
        author: {
          select: { id: true, fullName: true, avatarUrl: true, role: true },
        },
        mentions: {
          include: {
            mentioned: {
              select: { id: true, fullName: true, avatarUrl: true },
            },
          },
        },
      },
    });
    // Fan out notifications — one row per unique mentioned user. We
    // do this inside the same tx so a failed notification doesn't
    // leave a comment with no audit trail (and vice-versa).
    if (validMentions.length > 0) {
      await tx.crmNotification.createMany({
        data: validMentions.map((m) => ({
          userId: m.userId,
          type: "mention",
          title,
          message: previewBody,
          href: oppHref,
          metadata: {
            opportunityId: opp.id,
            opportunityCode: opp.code,
            commentId: created.id,
            mentionedById: sUser.id,
          } as Prisma.InputJsonValue,
        })),
      });
    }
    return created;
  });

  // Push SSE events so each mentioned user's bell badge updates
  // without waiting for the 60s poll. The bus is per-user so other
  // sessions don't get spammed.
  for (const m of validMentions) {
    publish({
      type: "notification.created",
      userId: m.userId,
      payload: {
        title,
        message: previewBody,
      },
    });
  }

  // audit v12 MEDIUM (MED-15): publish data.invalidate so the posting
  // user's other open tabs re-fetch the comments list immediately
  // instead of waiting for the 30s polling interval.
  publish({
    type: "data.invalidate",
    userId: sUser.id,
    payload: { queryKeys: [["comments", opp.id]] },
  });

  return NextResponse.json({
    ok: true,
    comment: {
      id: comment.id,
      body: comment.body,
      author: comment.author,
      mentions: comment.mentions.map((m) => m.mentioned),
      createdAt: comment.createdAt.toISOString(),
      editedAt: null,
      isOwn: true,
    },
  });
}
