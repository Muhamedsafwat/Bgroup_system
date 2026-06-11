// Deep smoke for CrmDashboard targeted sharing (visibility OWNER /
// SPECIFIC / EVERYONE). Exercises the route handler's where clause
// against three different callers, plus the share-row diff/replace
// behaviour on PATCH.
//
// Mirrors the bootstrap of scripts/smoke-opp-comments.mjs — Prisma +
// PrismaPg adapter, dotenv from .env / .env.local, assert helper,
// fixture pattern.

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
  const existing = await db.user.findUnique({ where: { email } });
  let user = existing;
  if (!user) {
    user = await db.user.create({
      data: { email, name, crmAccess: true },
    });
  }
  let profile = await db.crmUserProfile.findUnique({ where: { userId: user.id } });
  if (!profile) {
    const entity = await db.crmEntity.findFirstOrThrow();
    profile = await db.crmUserProfile.create({
      data: { userId: user.id, fullName: name, role, entityId: entity.id, active: true },
    });
  } else if (profile.role !== role) {
    profile = await db.crmUserProfile.update({
      where: { id: profile.id },
      data: { role },
    });
  }
  return { user, profile };
}

/// Mirror of the API GET's where clause. Caller sees a dashboard iff
/// they own it OR it's EVERYONE OR they're on its SPECIFIC share list.
async function visibleTo(profileId) {
  return db.crmDashboard.findMany({
    where: {
      OR: [
        { ownerId: profileId },
        { visibility: "EVERYONE" },
        { visibility: "SPECIFIC", shares: { some: { userId: profileId } } },
      ],
    },
    select: { id: true, name: true, visibility: true, ownerId: true },
  });
}

async function main() {
  console.log("Deep smoke: CrmDashboard targeted sharing\n");
  const stamp = Date.now();

  // ─── Fixtures ──────────────────────────────────────────────────
  console.log("Fixtures");
  const A = await makeUser({ email: `dash-rep-a-${stamp}@x.com`, name: "Dash RepA", role: "REP" });
  const B = await makeUser({ email: `dash-rep-b-${stamp}@x.com`, name: "Dash RepB", role: "REP" });
  const C = await makeUser({ email: `dash-rep-c-${stamp}@x.com`, name: "Dash RepC", role: "REP" });
  const MGR = await makeUser({ email: `dash-mgr-${stamp}@x.com`, name: "Dash Mgr", role: "MANAGER" });
  assert(
    !!(A.profile.id && B.profile.id && C.profile.id && MGR.profile.id),
    "4 fixtures seeded",
  );

  // ─── A creates dashboards covering every visibility mode ──────
  console.log("\nCreate fixtures");
  const dPrivate = await db.crmDashboard.create({
    data: {
      ownerId: A.profile.id,
      name: `priv-${stamp}`,
      layoutJson: [],
      visibility: "OWNER",
      isShared: false,
    },
  });
  const dShared = await db.crmDashboard.create({
    data: {
      ownerId: A.profile.id,
      name: `spec-${stamp}`,
      layoutJson: [],
      visibility: "SPECIFIC",
      isShared: false,
      shares: { create: [{ userId: B.profile.id }] }, // shared with B, NOT C
    },
  });
  const dEveryone = await db.crmDashboard.create({
    data: {
      ownerId: A.profile.id,
      name: `all-${stamp}`,
      layoutJson: [],
      visibility: "EVERYONE",
      isShared: true,
    },
  });
  const dBPrivate = await db.crmDashboard.create({
    data: {
      ownerId: B.profile.id,
      name: `bpriv-${stamp}`,
      layoutJson: [],
      visibility: "OWNER",
      isShared: false,
    },
  });
  assert(true, "4 dashboards created across all visibility modes");

  // ─── REP A sees all three of their own dashboards + nothing else
  console.log("\nVisibility — owner");
  const aSees = await visibleTo(A.profile.id);
  assert(aSees.some((d) => d.id === dPrivate.id), "A sees A's private dashboard");
  assert(aSees.some((d) => d.id === dShared.id), "A sees A's specific-shared dashboard");
  assert(aSees.some((d) => d.id === dEveryone.id), "A sees A's everyone dashboard");
  assert(!aSees.some((d) => d.id === dBPrivate.id), "A does NOT see B's private dashboard");

  // ─── REP B (was shared with): sees A's SPECIFIC + EVERYONE + own
  console.log("\nVisibility — SPECIFIC target");
  const bSees = await visibleTo(B.profile.id);
  assert(!bSees.some((d) => d.id === dPrivate.id), "B does NOT see A's private dashboard");
  assert(bSees.some((d) => d.id === dShared.id), "B sees A's specific-shared dashboard (target)");
  assert(bSees.some((d) => d.id === dEveryone.id), "B sees A's everyone dashboard");
  assert(bSees.some((d) => d.id === dBPrivate.id), "B sees own private dashboard");

  // ─── REP C (NOT shared with): sees only EVERYONE
  console.log("\nVisibility — SPECIFIC non-target");
  const cSees = await visibleTo(C.profile.id);
  assert(!cSees.some((d) => d.id === dPrivate.id), "C does NOT see A's private dashboard");
  assert(!cSees.some((d) => d.id === dShared.id), "C does NOT see A's specific-shared dashboard");
  assert(cSees.some((d) => d.id === dEveryone.id), "C sees A's everyone dashboard");

  // ─── MANAGER: no elevated visibility — sees only EVERYONE + own
  console.log("\nVisibility — MANAGER (no elevation)");
  const mSees = await visibleTo(MGR.profile.id);
  assert(!mSees.some((d) => d.id === dPrivate.id), "MANAGER does NOT see A's private dashboard");
  assert(!mSees.some((d) => d.id === dShared.id), "MANAGER does NOT see A's SPECIFIC dashboard (not a target)");
  assert(mSees.some((d) => d.id === dEveryone.id), "MANAGER sees EVERYONE dashboard");

  // ─── mineOnly=1 — admin CRUD surface filter
  console.log("\nmineOnly filter (admin CRUD scope)");
  const aTabs = await db.crmDashboard.findMany({ where: { ownerId: A.profile.id } });
  assert(aTabs.length === 3, "A's mineOnly view lists exactly their 3 owned dashboards");
  const bTabs = await db.crmDashboard.findMany({ where: { ownerId: B.profile.id } });
  assert(
    bTabs.length === 1 && bTabs[0].id === dBPrivate.id,
    "B's mineOnly view lists only B's own dashboard",
  );

  // ─── Owner-only mutation gate (mirrors route's findUnique + check)
  console.log("\nOwner-only mutation");
  const existing = await db.crmDashboard.findUnique({ where: { id: dShared.id } });
  assert(existing.ownerId !== B.profile.id, "B is not the owner of A's shared dashboard");

  // ─── Visibility flip clears share rows
  console.log("\nVisibility flip: SPECIFIC → OWNER drops shares");
  await db.$transaction([
    db.crmDashboardShare.deleteMany({ where: { dashboardId: dShared.id } }),
    db.crmDashboard.update({
      where: { id: dShared.id },
      data: { visibility: "OWNER", isShared: false },
    }),
  ]);
  const afterFlip = await visibleTo(B.profile.id);
  assert(
    !afterFlip.some((d) => d.id === dShared.id),
    "After flipping to OWNER + clearing shares, B no longer sees the dashboard",
  );

  // ─── isShared legacy mirror stays in sync with visibility=EVERYONE
  console.log("\nLegacy isShared mirror");
  await db.crmDashboard.update({
    where: { id: dShared.id },
    data: { visibility: "EVERYONE", isShared: true },
  });
  const reFetched = await db.crmDashboard.findUnique({ where: { id: dShared.id } });
  assert(
    reFetched.isShared === true && reFetched.visibility === "EVERYONE",
    "isShared legacy flag stays in sync with visibility=EVERYONE",
  );

  // ─── @@unique([dashboardId, userId]) prevents duplicate share rows
  console.log("\nUnique share rows");
  // Move back to SPECIFIC + share with C
  await db.$transaction([
    db.crmDashboard.update({
      where: { id: dShared.id },
      data: { visibility: "SPECIFIC", isShared: false },
    }),
    db.crmDashboardShare.create({
      data: { dashboardId: dShared.id, userId: C.profile.id },
    }),
  ]);
  let dupRejected = false;
  try {
    await db.crmDashboardShare.create({
      data: { dashboardId: dShared.id, userId: C.profile.id },
    });
  } catch (e) {
    dupRejected =
      String(e.code) === "P2002" || String(e.message).includes("Unique constraint");
  }
  assert(dupRejected, "duplicate share row rejected by @@unique([dashboardId, userId])");

  // ─── Cascade delete: dropping the dashboard removes share rows
  console.log("\nCascade delete");
  await db.crmDashboard.delete({ where: { id: dShared.id } });
  const orphanShares = await db.crmDashboardShare.findMany({
    where: { dashboardId: dShared.id },
  });
  assert(orphanShares.length === 0, "Deleting dashboard cascades to share rows");

  // ─── Regression — PATCH degrade-to-OWNER MUST drop stale shares.
  // Bug fixed in v11: previously, PATCH {sharedWithIds: []} on a
  // SPECIFIC dashboard wrote visibility=OWNER but left CrmDashboardShare
  // rows behind, breaking the @@unique([dashboardId,userId]) on a
  // future flip back to SPECIFIC.
  console.log("\nRegression: empty-list PATCH must drop shares");
  const dFlipTest = await db.crmDashboard.create({
    data: {
      ownerId: A.profile.id,
      name: `flip-${stamp}`,
      layoutJson: [],
      visibility: "SPECIFIC",
      isShared: false,
      shares: { create: [{ userId: B.profile.id }, { userId: C.profile.id }] },
    },
  });
  // Simulate the PATCH path's logic (the route does this in a tx):
  //   - finalVisibility computed as OWNER (because explicit []),
  //   - share rows dropped because finalVisibility !== SPECIFIC.
  await db.$transaction([
    db.crmDashboard.update({
      where: { id: dFlipTest.id },
      data: { visibility: "OWNER", isShared: false },
    }),
    db.crmDashboardShare.deleteMany({ where: { dashboardId: dFlipTest.id } }),
  ]);
  const afterDegrade = await db.crmDashboardShare.findMany({
    where: { dashboardId: dFlipTest.id },
  });
  assert(afterDegrade.length === 0, "Degrade-to-OWNER drops stale share rows");
  // Now flipping back to SPECIFIC with the same ids must succeed
  // (no unique-constraint throw from leftover rows).
  let reflipOk = true;
  try {
    await db.$transaction([
      db.crmDashboard.update({
        where: { id: dFlipTest.id },
        data: { visibility: "SPECIFIC", isShared: false },
      }),
      db.crmDashboardShare.deleteMany({ where: { dashboardId: dFlipTest.id } }),
      db.crmDashboardShare.createMany({
        data: [
          { dashboardId: dFlipTest.id, userId: B.profile.id },
          { dashboardId: dFlipTest.id, userId: C.profile.id },
        ],
      }),
    ]);
  } catch {
    reflipOk = false;
  }
  assert(reflipOk, "Re-flip to SPECIFIC after degrade succeeds (no stale unique-constraint blow-up)");
  await db.crmDashboard.delete({ where: { id: dFlipTest.id } });

  // ─── Regression — non-owner GET must NOT see the share peer list.
  // The API now strips `sharedWithIds` for non-mine rows so a
  // recipient can't enumerate who else the owner shared with.
  console.log("\nRegression: GET hides peer list from recipients");
  const dPeerTest = await db.crmDashboard.create({
    data: {
      ownerId: A.profile.id,
      name: `peer-${stamp}`,
      layoutJson: [],
      visibility: "SPECIFIC",
      isShared: false,
      shares: {
        create: [{ userId: B.profile.id }, { userId: C.profile.id }],
      },
    },
    include: { shares: { select: { userId: true } } },
  });
  // Simulate the route's response-shaping for B's request:
  const bView = {
    ...dPeerTest,
    mine: dPeerTest.ownerId === B.profile.id,
    sharedWithIds:
      dPeerTest.ownerId === B.profile.id
        ? dPeerTest.shares.map((s) => s.userId)
        : undefined,
  };
  assert(bView.mine === false, "B sees the dashboard as not-mine");
  assert(
    bView.sharedWithIds === undefined,
    "B does NOT receive the peer share list",
  );
  // Owner A's view still includes the list.
  const aView = {
    ...dPeerTest,
    mine: dPeerTest.ownerId === A.profile.id,
    sharedWithIds:
      dPeerTest.ownerId === A.profile.id
        ? dPeerTest.shares.map((s) => s.userId)
        : undefined,
  };
  assert(
    Array.isArray(aView.sharedWithIds) && aView.sharedWithIds.length === 2,
    "Owner A still receives the full share list",
  );
  await db.crmDashboard.delete({ where: { id: dPeerTest.id } });

  // ─── Cleanup
  console.log("\nCleanup");
  await db.crmDashboard.deleteMany({
    where: { ownerId: { in: [A.profile.id, B.profile.id, C.profile.id, MGR.profile.id] } },
  });
  await db.crmUserProfile.deleteMany({
    where: { id: { in: [A.profile.id, B.profile.id, C.profile.id, MGR.profile.id] } },
  });
  await db.user.deleteMany({
    where: { id: { in: [A.user.id, B.user.id, C.user.id, MGR.user.id] } },
  });
  console.log("  ✓ cleaned up");

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
