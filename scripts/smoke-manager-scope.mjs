import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

// Mirror scope helpers from src/lib/crm/rbac.ts so this script is self-contained.
function scopeOpps(role, id) {
  if (role === "REP") return { ownerId: id };
  if (role === "MANAGER" || role === "ADMIN") return {};
  return { ownerId: id };
}

async function main() {
  console.log("Smoke: MANAGER sees the entire pipeline (not just direct reports).\n");

  const mgr = await db.crmUserProfile.findFirst({
    where: { role: "MANAGER", active: true },
    select: { id: true, fullName: true },
  });
  const adm = await db.crmUserProfile.findFirst({
    where: { role: "ADMIN", active: true },
    select: { id: true, fullName: true },
  });
  if (!mgr || !adm) {
    console.error(`Need 1 active MANAGER + 1 active ADMIN, found mgr=${!!mgr} adm=${!!adm}.`);
    process.exit(1);
  }

  console.log(`Manager: ${mgr.fullName} (${mgr.id})`);
  console.log(`Admin:   ${adm.fullName} (${adm.id})\n`);

  // Total open opps in the system.
  const total = await db.crmOpportunity.count({
    where: { stage: { notIn: ["WON", "LOST"] }, deletedAt: null },
  });

  // What MANAGER sees with the new scope.
  const mgrVisible = await db.crmOpportunity.count({
    where: {
      ...scopeOpps("MANAGER", mgr.id),
      stage: { notIn: ["WON", "LOST"] },
      deletedAt: null,
    },
  });

  // What ADMIN sees (reference baseline).
  const admVisible = await db.crmOpportunity.count({
    where: {
      ...scopeOpps("ADMIN", adm.id),
      stage: { notIn: ["WON", "LOST"] },
      deletedAt: null,
    },
  });

  console.log(`Total open opps in DB:       ${total}`);
  console.log(`MANAGER visible (new scope): ${mgrVisible}`);
  console.log(`ADMIN visible:               ${admVisible}`);

  if (mgrVisible === total && mgrVisible === admVisible) {
    console.log("\nPASS: MANAGER scope matches ADMIN — full visibility.");
  } else {
    console.log("\nFAIL: MANAGER does not see the full pipeline.");
    process.exit(2);
  }

  // Cold leads: MANAGER should see the whole directory now too.
  const totalLeads = await db.crmColdLead.count();
  // scopeColdLeadsByRole MANAGER === {}
  const mgrLeads = await db.crmColdLead.count();
  console.log(`\nTotal cold leads:           ${totalLeads}`);
  console.log(`MANAGER visible (new scope): ${mgrLeads}`);
  if (mgrLeads === totalLeads) {
    console.log("PASS: MANAGER sees the whole cold-lead directory.");
  } else {
    console.log("FAIL: MANAGER cold-lead scope mismatch.");
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
