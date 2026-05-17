import { PrismaClient } from "../src/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { config } from "dotenv";
config();
async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const db = new PrismaClient({ adapter: new PrismaPg(pool) });
  console.log("=== Stage configs (DB) ===");
  const cfgs = await db.crmStageConfig.findMany({
    orderBy: [{ displayOrder: "asc" }],
    select: { stage: true, entityId: true, probabilityPct: true, displayOrder: true, isActive: true },
  });
  for (const c of cfgs) {
    console.log(`  ${c.stage.padEnd(16)} entity=${c.entityId ?? "(global)"}  prob=${c.probabilityPct}%  order=${c.displayOrder} active=${c.isActive}`);
  }
  console.log("\n=== Opportunities — stage + probability ===");
  const opps = await db.crmOpportunity.findMany({
    where: { deletedAt: null },
    select: { code: true, stage: true, probabilityPct: true, estimatedValueEGP: true, weightedValueEGP: true },
  });
  for (const o of opps) {
    const ev = Number(o.estimatedValueEGP);
    const wv = Number(o.weightedValueEGP);
    const expected = Math.round(ev * (o.probabilityPct / 100));
    const match = expected === wv ? "✓" : `✗ expected ${expected}, got ${wv}`;
    console.log(`  ${o.code}  stage=${o.stage}  prob=${o.probabilityPct}%  value=${ev}  weighted=${wv}  ${match}`);
  }
  await db.$disconnect();
  await pool.end();
}
main().catch(console.error);
