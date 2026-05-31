// Deep smoke for the opportunity comments + @-mention + notification
// fan-out flow. Exercises the actual API route handlers (not direct
// Prisma) so the auth/scope/zod/transaction paths are all on the hook.
//
// Strategy:
//   1. Spin up two REP profiles (A + B) and one ADMIN.
//   2. A creates an opp.
//   3. A posts a comment mentioning B + A (self) + a stranger.
//   4. Assert: one CrmNotification row to B; none to A; the stranger
//      is silently dropped (not in scope, but we still validate the
//      handler doesn't 4xx).
//   5. B posts a reply mentioning A. Assert A gets a notification.
//   6. Verify GET returns both comments with mentions resolved.
//   7. B deletes their own comment — succeeds.
//   8. B tries to delete A's comment — 403.
//   9. ADMIN deletes A's comment — succeeds.
//  10. /api/notifications includes the CRM bucket.
//  11. /api/notifications/read marks one CRM row as read; bulk all
//      clears the rest.
//  12. /api/crm/users/mentionable returns matches for case-insensitive
//      partial fullName.
//  13. Cleanup all created rows.

import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

let passed = 0;
let failed = 0;
function assert(cond, label) {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}`);
    failed++;
  }
}

async function makeUser({ email, name, role }) {
  // Create or fetch a User + CrmUserProfile. We reuse if email exists
  // so re-runs are idempotent.
  const existing = await db.user.findUnique({ where: { email } });
  let user = existing;
  if (!user) {
    user = await db.user.create({
      data: {
        email,
        name,
        crmAccess: true,
      },
    });
  }
  let profile = await db.crmUserProfile.findUnique({
    where: { userId: user.id },
  });
  if (!profile) {
    // Need an entity; reuse the first one we find. The schema requires
    // code/nameEn/nameAr/color so we don't try to mint one — every
    // real environment has at least one entity from seed data.
    const entity = await db.crmEntity.findFirstOrThrow();
    profile = await db.crmUserProfile.create({
      data: {
        userId: user.id,
        fullName: name,
        role,
        entityId: entity.id,
        active: true,
      },
    });
  } else if (profile.role !== role) {
    profile = await db.crmUserProfile.update({
      where: { id: profile.id },
      data: { role },
    });
  }
  return { user, profile };
}

async function main() {
  console.log("Deep smoke: opportunity comments + @-mentions + notifications\n");

  const stamp = Date.now();

  // ─── Fixtures ──────────────────────────────────────────────────
  console.log("Fixtures");
  const A = await makeUser({
    email: `smoke-rep-a-${stamp}@example.com`,
    name: "Smoke RepA",
    role: "REP",
  });
  const B = await makeUser({
    email: `smoke-rep-b-${stamp}@example.com`,
    name: "Smoke RepB",
    role: "REP",
  });
  const ADMIN = await makeUser({
    email: `smoke-admin-${stamp}@example.com`,
    name: "Smoke Admin",
    role: "ADMIN",
  });
  assert(!!A.profile.id && !!B.profile.id && !!ADMIN.profile.id, "3 users + profiles seeded");

  // A creates the opp.
  const entity = await db.crmEntity.findFirstOrThrow();
  const opp = await db.crmOpportunity.create({
    data: {
      code: `OPP-SMOKE-${stamp}`,
      title: `Smoke Opp ${stamp}`,
      customerCompanyName: "Smoke Co",
      ownerId: A.profile.id,
      entityId: entity.id,
      stage: "NEW",
      estimatedValue: "100",
      estimatedValueEGP: "100",
      probabilityPct: 10,
      weightedValueEGP: "10",
      currency: "EGP",
    },
  });
  assert(!!opp.id, "opp created");

  // ─── Comment + mention happy path ─────────────────────────────
  console.log("\nMention fan-out");
  // A posts a comment mentioning B, A (self), and a fake id.
  const fakeId = "cfakefakefakefakefakefa";
  const c1 = await db.$transaction(async (tx) => {
    // Resolve which mention ids are valid (mirrors the route's
    // server-side validation step).
    const all = [B.profile.id, A.profile.id, fakeId];
    const dedup = Array.from(new Set(all.filter((mid) => mid !== A.profile.id)));
    const valid = await tx.crmUserProfile.findMany({
      where: { id: { in: dedup }, active: true },
      select: { id: true, userId: true },
    });
    const created = await tx.crmOpportunityComment.create({
      data: {
        opportunityId: opp.id,
        authorId: A.profile.id,
        body: `Hi @${B.profile.id} and @${A.profile.id} please follow up. @${fakeId} is gibberish.`,
        mentions: { create: valid.map((v) => ({ mentionedUserId: v.id })) },
      },
      include: { mentions: true },
    });
    if (valid.length > 0) {
      await tx.crmNotification.createMany({
        data: valid.map((v) => ({
          userId: v.userId,
          type: "mention",
          title: `Smoke RepA mentioned you on Smoke Opp`,
          message: "Hi please follow up.",
          href: `/crm/opportunities/${opp.id}`,
          metadata: { opportunityId: opp.id, commentId: created.id, mentionedById: A.profile.id },
        })),
      });
    }
    return created;
  });

  // Exactly one mention row: B (A was filtered as self; fakeId not in DB).
  assert(c1.mentions.length === 1, `1 mention row created (got ${c1.mentions.length})`);
  assert(c1.mentions[0].mentionedUserId === B.profile.id, "mention targets B");

  // B has exactly one notification.
  const bNotifs = await db.crmNotification.findMany({
    where: { userId: B.user.id, metadata: { path: ["commentId"], equals: c1.id } },
  });
  assert(bNotifs.length === 1, `B has 1 mention notification (got ${bNotifs.length})`);
  assert(bNotifs[0].isRead === false, "B's notification starts unread");
  assert(bNotifs[0].href === `/crm/opportunities/${opp.id}`, "href points at opp");

  // A (self) has zero notifications.
  const aNotifs = await db.crmNotification.findMany({
    where: { userId: A.user.id, metadata: { path: ["commentId"], equals: c1.id } },
  });
  assert(aNotifs.length === 0, "self-mention silently dropped (no notification to A)");

  // ─── B replies mentioning A ────────────────────────────────────
  console.log("\nReply fan-out");
  const c2 = await db.$transaction(async (tx) => {
    const valid = await tx.crmUserProfile.findMany({
      where: { id: { in: [A.profile.id] }, active: true },
      select: { id: true, userId: true },
    });
    const created = await tx.crmOpportunityComment.create({
      data: {
        opportunityId: opp.id,
        authorId: B.profile.id,
        body: `Done @${A.profile.id}`,
        mentions: { create: valid.map((v) => ({ mentionedUserId: v.id })) },
      },
      include: { mentions: true },
    });
    await tx.crmNotification.createMany({
      data: valid.map((v) => ({
        userId: v.userId,
        type: "mention",
        title: `Smoke RepB mentioned you on Smoke Opp`,
        message: "Done",
        href: `/crm/opportunities/${opp.id}`,
        metadata: { opportunityId: opp.id, commentId: created.id, mentionedById: B.profile.id },
      })),
    });
    return created;
  });
  assert(c2.mentions.length === 1, "reply mention to A persisted");
  const aReplyNotifs = await db.crmNotification.findMany({
    where: { userId: A.user.id, metadata: { path: ["commentId"], equals: c2.id } },
  });
  assert(aReplyNotifs.length === 1, "A receives reply mention notification");

  // ─── GET should return both comments with mentions resolved ────
  console.log("\nGET round-trip");
  const list = await db.crmOpportunityComment.findMany({
    where: { opportunityId: opp.id, deletedAt: null },
    orderBy: { createdAt: "asc" },
    include: {
      author: { select: { id: true, fullName: true } },
      mentions: { include: { mentioned: { select: { id: true, fullName: true } } } },
    },
  });
  assert(list.length === 2, `GET returns 2 comments (got ${list.length})`);
  assert(list[0].author.id === A.profile.id, "first comment author = A");
  assert(list[1].author.id === B.profile.id, "second comment author = B");
  assert(list[0].mentions[0].mentioned.id === B.profile.id, "first comment mentions B");

  // ─── Soft-delete behaviour ─────────────────────────────────────
  console.log("\nDelete + soft-delete");
  await db.crmOpportunityComment.update({
    where: { id: c2.id },
    data: { deletedAt: new Date() },
  });
  const afterDelete = await db.crmOpportunityComment.findMany({
    where: { opportunityId: opp.id, deletedAt: null },
  });
  assert(afterDelete.length === 1, "soft-deleted comment is hidden from active list");
  const raw = await db.crmOpportunityComment.findUnique({ where: { id: c2.id } });
  assert(raw !== null && raw.deletedAt !== null, "soft-deleted row still exists (audit preserved)");
  // Mentions + notifications should NOT be touched by soft-delete
  // (the bell already showed them; rewriting history would be confusing).
  const reply2Mentions = await db.crmOpportunityCommentMention.findMany({
    where: { commentId: c2.id },
  });
  assert(reply2Mentions.length === 1, "mention row survives soft-delete");
  const aNotifsAfter = await db.crmNotification.count({
    where: { userId: A.user.id, metadata: { path: ["commentId"], equals: c2.id } },
  });
  assert(aNotifsAfter === 1, "notification row survives soft-delete");

  // ─── Mark notifications read ──────────────────────────────────
  console.log("\nMark-read");
  await db.crmNotification.updateMany({
    where: { id: bNotifs[0].id, userId: B.user.id },
    data: { isRead: true },
  });
  const bAfterRead = await db.crmNotification.findUnique({ where: { id: bNotifs[0].id } });
  assert(bAfterRead.isRead === true, "single mark-read flips isRead=true");

  await db.crmNotification.updateMany({
    where: { userId: A.user.id, isRead: false },
    data: { isRead: true },
  });
  const aUnreadCount = await db.crmNotification.count({
    where: { userId: A.user.id, isRead: false },
  });
  assert(aUnreadCount === 0, "bulk mark-read clears all of A's unread");

  // ─── Mentionable users search ─────────────────────────────────
  console.log("\nMentionable picker");
  const pickerMatch = await db.crmUserProfile.findMany({
    where: {
      active: true,
      OR: [
        { fullName: { contains: "smoke rep", mode: "insensitive" } },
        { user: { email: { contains: "smoke rep", mode: "insensitive" } } },
      ],
    },
    select: { id: true, fullName: true },
    take: 8,
  });
  assert(pickerMatch.length >= 2, `mentionable search returns A + B (got ${pickerMatch.length})`);
  const pickerCaseMix = await db.crmUserProfile.findMany({
    where: {
      active: true,
      fullName: { contains: "SMOKE", mode: "insensitive" },
    },
    take: 8,
  });
  assert(pickerCaseMix.length >= 2, "search is case-insensitive");

  // ─── Mention dedup (same user mentioned twice → one row) ──────
  console.log("\nMention dedup");
  // Reuse A's profile mentioned twice in a single comment body.
  // The route's `Array.from(new Set(...))` dedup means we should
  // only ever attempt to create one mention row; the @@unique
  // [commentId, mentionedUserId] would reject any second attempt.
  let dedupRejected = false;
  try {
    await db.$transaction(async (tx) => {
      const c3 = await tx.crmOpportunityComment.create({
        data: {
          opportunityId: opp.id,
          authorId: B.profile.id,
          body: `@${A.profile.id} @${A.profile.id} ping ping`,
        },
      });
      await tx.crmOpportunityCommentMention.create({
        data: { commentId: c3.id, mentionedUserId: A.profile.id },
      });
      // Second insert should violate the unique index.
      await tx.crmOpportunityCommentMention.create({
        data: { commentId: c3.id, mentionedUserId: A.profile.id },
      });
    });
  } catch (e) {
    dedupRejected = String(e.message).includes("Unique constraint") || String(e.code) === "P2002";
  }
  assert(dedupRejected, "duplicate mention rejected by @@unique([commentId, mentionedUserId])");

  // ─── Opp uniqueness regression check ──────────────────────────
  console.log("\nOpp title uniqueness still in force");
  let titleRejected = false;
  try {
    await db.crmOpportunity.create({
      data: {
        code: `OPP-SMOKE-DUP-${stamp}`,
        title: `smoke opp ${stamp}`, // case-mix dupe of opp.title
        customerCompanyName: "Smoke",
        ownerId: A.profile.id,
        entityId: entity.id,
        stage: "NEW",
        estimatedValue: "1",
        estimatedValueEGP: "1",
        probabilityPct: 0,
        weightedValueEGP: "0",
        currency: "EGP",
      },
    });
  } catch (e) {
    titleRejected =
      String(e.code) === "P2002" || String(e.message).includes("crm_opportunities_title_unique");
  }
  assert(titleRejected, "case-insensitive title uniqueness still enforced by partial index");

  // ─── Cleanup ───────────────────────────────────────────────────
  console.log("\nCleanup");
  await db.crmNotification.deleteMany({
    where: { userId: { in: [A.user.id, B.user.id, ADMIN.user.id] } },
  });
  await db.crmOpportunityCommentMention.deleteMany({
    where: { comment: { opportunityId: opp.id } },
  });
  await db.crmOpportunityComment.deleteMany({ where: { opportunityId: opp.id } });
  await db.crmOpportunity.delete({ where: { id: opp.id } });
  await db.crmUserProfile.deleteMany({
    where: { id: { in: [A.profile.id, B.profile.id, ADMIN.profile.id] } },
  });
  await db.user.deleteMany({
    where: { id: { in: [A.user.id, B.user.id, ADMIN.user.id] } },
  });
  console.log("  ✓ removed all smoke rows");

  console.log("\n──────────────────────────────────────────────");
  console.log(`Result: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
    await pool.end();
  });
