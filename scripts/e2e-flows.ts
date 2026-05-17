import { PrismaClient } from "../src/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { config } from "dotenv";
config();
async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const db = new PrismaClient({ adapter: new PrismaPg(pool) });
  let pass = 0, fail = 0;
  const ok = (msg: string) => { console.log(`  ✓ ${msg}`); pass++; };
  const bad = (msg: string) => { console.log(`  ✗ ${msg}`); fail++; };

  console.log("=== Stage column is plain TEXT (not enum) ===");
  const stageColType = await db.$queryRawUnsafe<{ data_type: string }[]>(`
    SELECT data_type FROM information_schema.columns
    WHERE table_name = 'crm_opportunities' AND column_name = 'stage'
  `);
  if (stageColType[0]?.data_type === "text") ok(`crm_opportunities.stage is TEXT (was enum)`);
  else bad(`crm_opportunities.stage is ${stageColType[0]?.data_type}`);

  console.log("\n=== Custom stage can be created from settings ===");
  // Try inserting a brand-new stage code that wouldn't have been a valid enum value
  const existing = await db.crmStageConfig.findFirst({ where: { stage: "PILOT" } });
  if (existing) await db.crmStageConfig.delete({ where: { id: existing.id } });
  const created = await db.crmStageConfig.create({
    data: { stage: "PILOT", entityId: null, probabilityPct: 40, displayOrder: 99, isActive: true },
  });
  ok(`Created stage "PILOT" (id=${created.id.slice(0, 10)}…)`);
  // Try assigning it to an opp
  const opp = await db.crmOpportunity.findFirst({ where: { deletedAt: null } });
  if (opp) {
    const before = opp.stage;
    await db.crmOpportunity.update({ where: { id: opp.id }, data: { stage: "PILOT" } });
    const after = await db.crmOpportunity.findUnique({ where: { id: opp.id }, select: { stage: true } });
    if (after?.stage === "PILOT") ok(`Opp ${opp.code} accepted custom stage "PILOT"`);
    else bad(`Opp didn't accept custom stage`);
    // Revert
    await db.crmOpportunity.update({ where: { id: opp.id }, data: { stage: before } });
    ok(`Reverted to ${before}`);
  }
  await db.crmStageConfig.delete({ where: { id: created.id } });
  ok(`Cleaned up test stage`);

  console.log("\n=== New opportunity fields persist ===");
  // Verify schema has the new contact fields
  const oppCols = await db.$queryRawUnsafe<{ column_name: string }[]>(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'crm_opportunities'
    AND column_name IN ('customerCompanyName','customerContactName','customerContactPhone','customerContactEmail')
  `);
  const found = oppCols.map(c => c.column_name).sort();
  const expected = ["customerCompanyName","customerContactEmail","customerContactName","customerContactPhone"];
  if (JSON.stringify(found) === JSON.stringify(expected)) ok(`All 4 customer/contact columns present`);
  else bad(`Expected ${expected.join(",")}, got ${found.join(",")}`);

  console.log("\n=== Cold-lead schema additions ===");
  const cldCols = await db.$queryRawUnsafe<{ column_name: string }[]>(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'crm_cold_leads'
    AND column_name IN ('socialMedia','website','contactPerson','contactPosition')
  `);
  if (cldCols.length === 4) ok(`Cold lead has socialMedia + website + contactPerson + contactPosition`);
  else bad(`Cold lead missing fields: got ${cldCols.length}/4`);

  console.log("\n=== mustChangePassword flag exists ===");
  const userCols = await db.$queryRawUnsafe<{ column_name: string }[]>(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'mustChangePassword'
  `);
  if (userCols.length === 1) ok(`User.mustChangePassword present`);
  else bad(`mustChangePassword missing`);

  console.log("\n=== Existing data intact ===");
  const counts = {
    users: await db.user.count(),
    opps: await db.crmOpportunity.count({ where: { deletedAt: null } }),
    coldLeads: await db.crmColdLead.count(),
    meetings: await db.crmMeeting.count(),
    products: await db.crmProduct.count(),
    stageConfigs: await db.crmStageConfig.count({ where: { isActive: true } }),
  };
  console.log(`  Users: ${counts.users}`);
  console.log(`  Opportunities: ${counts.opps}`);
  console.log(`  Cold leads: ${counts.coldLeads}`);
  console.log(`  Meetings: ${counts.meetings}`);
  console.log(`  Products: ${counts.products}`);
  console.log(`  Active stages in config: ${counts.stageConfigs}`);

  console.log(`\n${pass} pass, ${fail} fail`);
  await db.$disconnect();
  await pool.end();
  if (fail > 0) process.exit(1);
}
main().catch((e) => { console.error("ERROR:", e); process.exit(1); });
