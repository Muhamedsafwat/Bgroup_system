// HTTP-bypass RBAC + validation smoke for opp comments. Exercises
// the same logic the route handler runs (scopeOpportunityByRole gate,
// Zod input shape, mention-id resolver, role gates for delete) without
// having to spin up a server.
//
// Coverage:
//   - REP A owns opp; REP B can't see/post comments on it.
//   - REP B with ASSISTANT scope tied to a meeting on the opp CAN see.
//   - MANAGER sees + posts on any opp.
//   - Zod rejects empty body, body > 5000 chars, mentionIds > 50.
//   - Invalid mention ids are silently dropped (not a 4xx).
//   - Inactive mentioned profile is dropped.
//   - DELETE by non-author non-admin is denied; admin override works.

import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { z } from "zod";
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

// Mirror of src/lib/crm/rbac.ts scopeOpportunityByRole — kept local
// so the smoke is hermetic. Any drift from production logic is a
// signal we should re-import via tsx.
function scopeOpportunityByRole(session) {
  switch (session.role) {
    case "REP":
      return { ownerId: session.id };
    case "MANAGER":
      return {};
    case "ASSISTANT":
      return {
        meetings: {
          some: {
            OR: [
              { scheduledById: session.id },
              { approvedById: session.id },
            ],
          },
        },
      };
    case "ACCOUNT_MGR":
      return { deliveryOwnerId: session.id, stage: "WON" };
    case "ADMIN":
      return {};
    default:
      return { ownerId: session.id };
  }
}

// Mirror of route's Zod schema.
const postSchema = z.object({
  body: z.string().trim().min(1).max(5000),
  mentionIds: z.array(z.string().min(1)).max(50).optional(),
});

async function gate(session, oppId) {
  const opp = await db.crmOpportunity.findFirst({
    where: { id: oppId, ...scopeOpportunityByRole(session), deletedAt: null },
    select: { id: true, title: true, code: true },
  });
  return opp;
}

async function makeUser({ email, name, role }) {
  let user = await db.user.findUnique({ where: { email } });
  if (!user) user = await db.user.create({ data: { email, name, crmAccess: true } });
  let profile = await db.crmUserProfile.findUnique({ where: { userId: user.id } });
  if (!profile) {
    const entity = await db.crmEntity.findFirstOrThrow();
    profile = await db.crmUserProfile.create({
      data: { userId: user.id, fullName: name, role, entityId: entity.id, active: true },
    });
  } else if (profile.role !== role) {
    profile = await db.crmUserProfile.update({ where: { id: profile.id }, data: { role } });
  }
  return { user, profile };
}

function sUser(profile) {
  return {
    id: profile.id,
    role: profile.role,
    email: "smoke@example.com",
    fullName: profile.fullName,
    entityId: profile.entityId ?? null,
  };
}

async function main() {
  console.log("HTTP-bypass RBAC + validation smoke for opp comments\n");
  const stamp = Date.now();

  const A = await makeUser({ email: `rbac-rep-a-${stamp}@x.com`, name: "RBAC RepA", role: "REP" });
  const B = await makeUser({ email: `rbac-rep-b-${stamp}@x.com`, name: "RBAC RepB", role: "REP" });
  const Asst = await makeUser({
    email: `rbac-asst-${stamp}@x.com`,
    name: "RBAC Assistant",
    role: "ASSISTANT",
  });
  const Mgr = await makeUser({ email: `rbac-mgr-${stamp}@x.com`, name: "RBAC Mgr", role: "MANAGER" });
  const Adm = await makeUser({ email: `rbac-adm-${stamp}@x.com`, name: "RBAC Admin", role: "ADMIN" });
  const inactive = await makeUser({
    email: `rbac-inactive-${stamp}@x.com`,
    name: "RBAC Inactive",
    role: "REP",
  });
  await db.crmUserProfile.update({ where: { id: inactive.profile.id }, data: { active: false } });

  const entity = await db.crmEntity.findFirstOrThrow();
  const opp = await db.crmOpportunity.create({
    data: {
      code: `OPP-RBAC-${stamp}`,
      title: `RBAC opp ${stamp}`,
      customerCompanyName: "RBAC Co",
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

  // ─── Scope gate: REP B can't see A's opp ──────────────────────
  console.log("Scope gate");
  const bSees = await gate(sUser(B.profile), opp.id);
  assert(bSees === null, "REP B is denied (not the owner)");
  const aSees = await gate(sUser(A.profile), opp.id);
  assert(aSees !== null, "REP A sees their own opp");
  const mgrSees = await gate(sUser(Mgr.profile), opp.id);
  assert(mgrSees !== null, "MANAGER sees every opp");
  const admSees = await gate(sUser(Adm.profile), opp.id);
  assert(admSees !== null, "ADMIN sees every opp");

  // ASSISTANT initially has no meeting → no access.
  const asstNoMeeting = await gate(sUser(Asst.profile), opp.id);
  assert(asstNoMeeting === null, "ASSISTANT without a touched meeting is denied");
  // Attach a meeting scheduled by Asst.
  const meeting = await db.crmMeeting.create({
    data: {
      code: `MTG-RBAC-${stamp}`,
      opportunityId: opp.id,
      scheduledById: Asst.profile.id,
      startAt: new Date(),
      endAt: new Date(Date.now() + 3600_000),
      durationMinutes: 60,
    },
  });
  const asstWithMeeting = await gate(sUser(Asst.profile), opp.id);
  assert(asstWithMeeting !== null, "ASSISTANT with a touched meeting sees the opp");

  // ─── Zod validation ───────────────────────────────────────────
  console.log("\nZod validation");
  assert(!postSchema.safeParse({ body: "" }).success, "empty body rejected");
  assert(!postSchema.safeParse({ body: "   " }).success, "whitespace-only body rejected");
  assert(
    !postSchema.safeParse({ body: "x".repeat(5001) }).success,
    "body > 5000 chars rejected",
  );
  assert(
    !postSchema.safeParse({ body: "ok", mentionIds: Array(51).fill("x") }).success,
    "mentionIds > 50 rejected",
  );
  assert(postSchema.safeParse({ body: "ok", mentionIds: [] }).success, "empty mentionIds OK");
  assert(postSchema.safeParse({ body: "ok" }).success, "mentionIds optional");
  assert(
    postSchema.safeParse({ body: "  trimmed  " }).success,
    "padded body passes (server trims)",
  );

  // ─── Mention-id resolver semantics ────────────────────────────
  console.log("\nMention-id resolver");
  // Mix valid + invalid + inactive + self.
  const ids = [B.profile.id, "ckxbogusxxxxxxxxxxxxxxxx", inactive.profile.id, A.profile.id];
  const dedup = Array.from(new Set(ids.filter((mid) => mid !== A.profile.id)));
  const valid = await db.crmUserProfile.findMany({
    where: { id: { in: dedup }, active: true },
    select: { id: true, userId: true },
  });
  assert(valid.length === 1 && valid[0].id === B.profile.id, "resolver yields only active non-self matches");

  // ─── DELETE role gate ─────────────────────────────────────────
  console.log("\nDELETE role gate");
  const comment = await db.crmOpportunityComment.create({
    data: { opportunityId: opp.id, authorId: A.profile.id, body: "to be deleted" },
  });
  // Non-author REP B should be denied (they're also not in scope, but
  // we mirror the route's secondary gate: author OR isManagerOrAdmin).
  function canDelete(session, commentAuthorId) {
    if (session.id === commentAuthorId) return true;
    return session.role === "MANAGER" || session.role === "ADMIN";
  }
  assert(canDelete(sUser(A.profile), comment.authorId) === true, "author can delete own");
  assert(canDelete(sUser(B.profile), comment.authorId) === false, "non-author REP cannot delete");
  assert(canDelete(sUser(Mgr.profile), comment.authorId) === true, "MANAGER can delete any");
  assert(canDelete(sUser(Adm.profile), comment.authorId) === true, "ADMIN can delete any");
  assert(canDelete(sUser(Asst.profile), comment.authorId) === false, "ASSISTANT cannot delete someone else's");
  assert(canDelete(sUser(Asst.profile), Asst.profile.id) === true, "ASSISTANT CAN delete their own (author overrides role)");

  // ─── Self-mention drop ────────────────────────────────────────
  console.log("\nSelf-mention drop");
  // Confirm the resolver pattern strips A from their own mention list.
  const withSelf = [A.profile.id, B.profile.id];
  const filteredSelf = Array.from(new Set(withSelf.filter((mid) => mid !== A.profile.id)));
  assert(
    filteredSelf.length === 1 && filteredSelf[0] === B.profile.id,
    "self-mention removed before DB write",
  );

  // ─── Soft-delete blocks GET ───────────────────────────────────
  console.log("\nSoft-deleted comments hidden from GET");
  await db.crmOpportunityComment.update({
    where: { id: comment.id },
    data: { deletedAt: new Date() },
  });
  const visible = await db.crmOpportunityComment.findMany({
    where: { opportunityId: opp.id, deletedAt: null },
  });
  assert(visible.length === 0, "soft-deleted comment hidden from active fetch");
  const includingDeleted = await db.crmOpportunityComment.count({
    where: { opportunityId: opp.id },
  });
  assert(includingDeleted === 1, "soft-deleted row still in table");

  // ─── Cleanup ──────────────────────────────────────────────────
  console.log("\nCleanup");
  await db.crmMeeting.delete({ where: { id: meeting.id } });
  await db.crmOpportunityCommentMention.deleteMany({ where: { comment: { opportunityId: opp.id } } });
  await db.crmOpportunityComment.deleteMany({ where: { opportunityId: opp.id } });
  await db.crmOpportunity.delete({ where: { id: opp.id } });
  await db.crmUserProfile.deleteMany({
    where: {
      id: { in: [A.profile.id, B.profile.id, Asst.profile.id, Mgr.profile.id, Adm.profile.id, inactive.profile.id] },
    },
  });
  await db.user.deleteMany({
    where: {
      id: { in: [A.user.id, B.user.id, Asst.user.id, Mgr.user.id, Adm.user.id, inactive.user.id] },
    },
  });
  console.log("  ✓ all rbac smoke rows removed");

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
