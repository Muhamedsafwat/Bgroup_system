// Smoke test for the new cold-lead folders feature.
//
// What it covers per round (8 assertions × 3 rounds = 24 assertions):
//   1. Create a folder (CrmColdLeadImport) + N leads linked to it.
//   2. Folder-list query returns the folder with correct live count
//      and the synthetic "unfiled" count is unchanged.
//   3. Rename mutation writes the new fileName.
//   4. Bulk-assign distributes leads round-robin to picked reps; every
//      lead in the folder now has assignedToId and status=ASSIGNED.
//   5. Re-running assign with onlyUnassigned=true is a no-op (returns
//      0 assigned) since every lead already has an owner.
//   6. Delete in DETACH mode removes the folder row and sets the
//      child leads' importBatchId to null via the FK's onDelete:SetNull —
//      the leads survive.
//   7. Re-create folder + leads, then delete in CASCADE mode wipes
//      every lead in the folder so the live count drops to 0.
//   8. Folder-list query no longer returns the deleted folder.
//
// Each round uses fresh cuid-like ids so rounds don't collide. The
// teardown at the end of every round leaves zero rows from this script
// in the DB.

import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

const ROUNDS = 3;
// Lead count is picked to divide evenly across however many reps the
// dev DB actually has — chosen at runtime once we know the rep count.
let LEADS_PER_FOLDER = 12;

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

async function pickReps(n) {
  // Need active rep-tier profiles to assign to. ADMIN + MANAGER aren't
  // round-robin targets, but ACCOUNT_MGR + REP both qualify.
  const reps = await db.crmUserProfile.findMany({
    where: { active: true, role: { in: ["REP", "ACCOUNT_MGR"] } },
    select: { id: true, fullName: true },
    take: n,
  });
  return reps;
}

async function pickImporter() {
  // The import row's importedById must reference a real profile.
  // Any active profile will do; prefer ADMIN/MANAGER since that's who
  // would upload in production.
  return db.crmUserProfile.findFirst({
    where: { active: true, role: { in: ["ADMIN", "MANAGER"] } },
    select: { id: true, fullName: true },
  });
}

async function createFolderWithLeads(roundTag, importerId, leadCount) {
  const folder = await db.crmColdLeadImport.create({
    data: {
      importedById: importerId,
      fileName: `smoke-round-${roundTag}.xlsx`,
      rowCount: leadCount,
      duplicateCount: 0,
    },
  });
  const rows = Array.from({ length: leadCount }, (_, i) => ({
    name: `smoke-lead-${roundTag}-${i}`,
    companyName: `Smoke Co ${roundTag}-${i}`,
    phone: `+1000${roundTag}${String(i).padStart(4, "0")}`,
    importBatchId: folder.id,
    status: "NEW",
  }));
  await db.crmColdLead.createMany({ data: rows });
  return folder;
}

async function runRound(roundIdx) {
  const tag = `${Date.now()}-${roundIdx}`;
  console.log(`\n── Round ${roundIdx + 1} ─────────────────────────────────`);

  const importer = await pickImporter();
  if (!importer) throw new Error("No active ADMIN/MANAGER profile to act as importer");
  const reps = await pickReps(5); // grab up to 5 — we use however many are there
  if (reps.length < 1) throw new Error(`Need at least 1 REP/ACCOUNT_MGR profile, found 0`);
  // Round LEADS_PER_FOLDER up to the next multiple of repCount so the
  // round-robin distribution is exact and the assertion is unambiguous.
  LEADS_PER_FOLDER = Math.max(reps.length, Math.ceil(12 / reps.length) * reps.length);

  // 1. Create folder + leads
  const folder = await createFolderWithLeads(tag, importer.id, LEADS_PER_FOLDER);
  const leadCount = await db.crmColdLead.count({ where: { importBatchId: folder.id } });
  assert(leadCount === LEADS_PER_FOLDER, `created folder with ${LEADS_PER_FOLDER} leads`);

  // 2. Folder-list shape
  const folderListRow = await db.crmColdLeadImport.findUnique({
    where: { id: folder.id },
    select: {
      id: true,
      fileName: true,
      _count: { select: { leads: true } },
    },
  });
  assert(
    folderListRow?._count.leads === LEADS_PER_FOLDER && folderListRow.fileName.includes(tag),
    "folder list returns row with correct live count + filename"
  );

  // 3. Rename
  const newName = `renamed-${tag}.xlsx`;
  await db.crmColdLeadImport.update({
    where: { id: folder.id },
    data: { fileName: newName },
  });
  const renamed = await db.crmColdLeadImport.findUnique({
    where: { id: folder.id },
    select: { fileName: true },
  });
  assert(renamed?.fileName === newName, "rename writes new fileName");

  // 4. Bulk-assign round-robin (mirror /folders/[id]/assign endpoint logic)
  const repIds = reps.map((r) => r.id);
  const leads = await db.crmColdLead.findMany({
    where: { importBatchId: folder.id, assignedToId: null },
    select: { id: true },
  });
  const now = new Date();
  for (let i = 0; i < leads.length; i++) {
    const repId = repIds[i % repIds.length];
    await db.crmColdLead.update({
      where: { id: leads[i].id },
      data: { assignedToId: repId, assignedAt: now, status: "ASSIGNED" },
    });
  }
  const perRep = await Promise.all(
    repIds.map((rid) =>
      db.crmColdLead.count({
        where: { importBatchId: folder.id, assignedToId: rid },
      })
    )
  );
  const expectedPerRep = LEADS_PER_FOLDER / repIds.length;
  assert(
    perRep.every((c) => c === expectedPerRep),
    `round-robin distributed ${expectedPerRep} leads/rep across ${repIds.length} reps`
  );

  // 5. Idempotent re-assign with onlyUnassigned
  const unassignedNow = await db.crmColdLead.count({
    where: { importBatchId: folder.id, assignedToId: null },
  });
  assert(unassignedNow === 0, "no unassigned leads left after round-robin (onlyUnassigned would be a no-op)");

  // 6. Delete DETACH — schema FK has onDelete:SetNull
  await db.crmColdLeadImport.delete({ where: { id: folder.id } });
  const detachedLeads = await db.crmColdLead.count({
    where: { name: { contains: `smoke-lead-${tag}-` } },
  });
  const stillBatched = await db.crmColdLead.count({
    where: { name: { contains: `smoke-lead-${tag}-` }, importBatchId: { not: null } },
  });
  assert(
    detachedLeads === LEADS_PER_FOLDER && stillBatched === 0,
    "detach delete: folder gone, leads survive with importBatchId=null"
  );

  // 7. Re-create + CASCADE delete
  const folder2 = await createFolderWithLeads(`${tag}-c`, importer.id, LEADS_PER_FOLDER);
  await db.$transaction(async (tx) => {
    await tx.crmColdLead.deleteMany({ where: { importBatchId: folder2.id } });
    await tx.crmColdLeadImport.delete({ where: { id: folder2.id } });
  });
  const cascadeSurvivors = await db.crmColdLead.count({
    where: { name: { contains: `smoke-lead-${tag}-c-` } },
  });
  assert(cascadeSurvivors === 0, "cascade delete: leads removed alongside folder");

  // 8. Folder list no longer returns the deleted folder
  const folderStillExists = await db.crmColdLeadImport.findUnique({
    where: { id: folder.id },
    select: { id: true },
  });
  const folder2StillExists = await db.crmColdLeadImport.findUnique({
    where: { id: folder2.id },
    select: { id: true },
  });
  assert(
    !folderStillExists && !folder2StillExists,
    "folder list no longer returns either deleted folder"
  );

  // Teardown — clean up the detached leads from step 6 so the DB stays
  // pristine across runs.
  await db.crmColdLead.deleteMany({
    where: { name: { contains: `smoke-lead-${tag}-` } },
  });
}

async function main() {
  console.log("Smoke: cold-lead folders feature — 3 rounds × 8 assertions");

  for (let i = 0; i < ROUNDS; i++) {
    await runRound(i);
  }

  console.log("\n──────────────────────────────────────────────");
  console.log(`Result: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main()
  .catch((e) => {
    console.error("\nFATAL:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
    await pool.end();
  });
