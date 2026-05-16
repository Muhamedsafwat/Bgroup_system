import { PrismaClient } from "../src/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { config } from "dotenv";
config();

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const db = new PrismaClient({ adapter });

  // Find the admin's CRM profile (used as ownerId)
  const admin = await db.user.findUnique({
    where: { email: "admin@bgroup.com" },
    include: { crmProfile: true },
  });
  if (!admin?.crmProfile) {
    console.error("no crmProfile on admin");
    process.exit(1);
  }

  const company = await db.crmCompany.findFirst({ select: { id: true, nameEn: true, assignedToId: true } });
  if (!company) { console.error("no company"); process.exit(1); }

  const entity = await db.crmEntity.findFirst({ select: { id: true } });
  if (!entity) { console.error("no entity"); process.exit(1); }

  // Simulate the action's company scope check for ADMIN — should pass with {}
  const scoped = await db.crmCompany.findFirst({
    where: { id: company.id /* admin's scope is {} */ },
    select: { nameEn: true },
  });
  console.log("admin company scope check:", scoped ? "✓" : "✗");

  // Simulate it for REP (ownerId = admin's crmProfile id, treat as REP)
  const repScoped = await db.crmCompany.findFirst({
    where: { id: company.id, assignedToId: admin.crmProfile.id },
    select: { nameEn: true },
  });
  console.log("rep-scope on same company (assignedToId match):", repScoped ? "✓" : "✗");
  console.log("  company.assignedToId =", company.assignedToId, "; rep.id =", admin.crmProfile.id);

  // Check stage configs exist
  const stageConfig = await db.crmStageConfig.findFirst({ where: { stage: "NEW" } });
  console.log("stage NEW config:", stageConfig?.probabilityPct ?? "(null — uses default 5%)");

  // Check FX rates
  const fxs = await db.crmFxRate.findMany();
  console.log("FX rate count:", fxs.length, "currencies:", fxs.map(r => r.currency).join(","));

  // Count existing opps and pick the next code
  const lastOpp = await db.crmOpportunity.findFirst({
    where: { code: { startsWith: "OPP-" } },
    orderBy: { code: "desc" },
    select: { code: true },
  });
  console.log("last opp code:", lastOpp?.code ?? "(none)");

  await db.$disconnect();
  await pool.end();
}
main().catch((e) => { console.error("ERROR:", e); process.exit(1); });
