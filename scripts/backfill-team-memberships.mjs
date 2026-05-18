import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

// Every rep with a non-null managerId becomes a row in CrmTeamMembership
// (idempotent: skipDuplicates means re-runs are safe).
const reps = await db.crmUserProfile.findMany({
  where: { managerId: { not: null } },
  select: { id: true, managerId: true, fullName: true },
});

console.log("Backfilling", reps.length, "memberships…");
for (const r of reps) {
  await db.crmTeamMembership.upsert({
    where: { managerId_repId: { managerId: r.managerId, repId: r.id } },
    create: { managerId: r.managerId, repId: r.id },
    update: {},
  });
  console.log("  ✓", r.fullName);
}

await db.$disconnect(); await pool.end();
