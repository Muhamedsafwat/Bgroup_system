import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  console.log("Smoke test: a rep on TWO managers' teams should appear in BOTH pipelines.\n");

  // Find two MANAGER/ADMIN profiles and one REP/ACCOUNT_MGR profile to use.
  // ADMIN counts as "manager" for the M2M model — the scope helpers OR
  // both managerId and managedBy regardless of which role the manager is.
  const managers = await db.crmUserProfile.findMany({
    where: { role: { in: ["MANAGER", "ADMIN"] }, active: true },
    select: { id: true, fullName: true, role: true },
    take: 2,
  });
  if (managers.length < 2) {
    console.error(`Need 2 active MANAGER/ADMIN profiles, found ${managers.length}. Seed first.`);
    process.exit(1);
  }
  const [m1, m2] = managers;
  const rep = await db.crmUserProfile.findFirst({
    where: { role: { in: ["REP", "ACCOUNT_MGR"] }, active: true },
    select: { id: true, fullName: true },
  });
  if (!rep) {
    console.error("No REP/ACCOUNT_MGR profile found. Seed first.");
    process.exit(1);
  }

  console.log(`m1: ${m1.fullName} (${m1.id})`);
  console.log(`m2: ${m2.fullName} (${m2.id})`);
  console.log(`rep: ${rep.fullName} (${rep.id})\n`);

  // Wipe any pre-existing memberships for this rep so the test is clean,
  // then add memberships to BOTH managers.
  await db.crmTeamMembership.deleteMany({ where: { repId: rep.id } });
  await db.crmTeamMembership.createMany({
    data: [
      { managerId: m1.id, repId: rep.id },
      { managerId: m2.id, repId: rep.id },
    ],
  });
  console.log("Memberships created: rep is now on m1 AND m2's teams.\n");

  // Ensure the rep has at least one open opportunity to be visible.
  const oppCount = await db.crmOpportunity.count({
    where: { ownerId: rep.id, stage: { notIn: ["WON", "LOST"] } },
  });
  console.log(`Open opps owned by rep: ${oppCount}`);
  if (oppCount === 0) {
    console.log("WARNING: rep has no open opps — pipeline visibility will be vacuously true.\n");
  } else {
    console.log("");
  }

  // Replicate the MANAGER scope from src/lib/crm/rbac.ts.
  const scopeFor = (mgrId) => ({
    OR: [
      { ownerId: mgrId },
      { owner: { managerId: mgrId } },
      { owner: { managedBy: { some: { managerId: mgrId } } } },
    ],
  });

  const repOppsM1 = await db.crmOpportunity.findMany({
    where: {
      ...scopeFor(m1.id),
      ownerId: rep.id,
      stage: { notIn: ["WON", "LOST"] },
    },
    select: { id: true, code: true, title: true },
  });
  const repOppsM2 = await db.crmOpportunity.findMany({
    where: {
      ...scopeFor(m2.id),
      ownerId: rep.id,
      stage: { notIn: ["WON", "LOST"] },
    },
    select: { id: true, code: true, title: true },
  });

  console.log(`m1 sees ${repOppsM1.length} of rep's opps`);
  console.log(`m2 sees ${repOppsM2.length} of rep's opps`);

  if (oppCount > 0 && repOppsM1.length === oppCount && repOppsM2.length === oppCount) {
    console.log("\nPASS: rep is visible in both managers' pipelines.");
    process.exit(0);
  } else if (oppCount === 0) {
    console.log("\nINCONCLUSIVE: rep has no opps, but join table writes succeeded.");
    process.exit(0);
  } else {
    console.log("\nFAIL: at least one manager doesn't see the rep's opps.");
    process.exit(2);
  }
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
