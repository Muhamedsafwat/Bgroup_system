/**
 * Backfill / repair CrmStageConfig rows so weighted-value calculations work
 * for every stage in the enum. Previously the seed only inserted 8 stages
 * and `getStageProbability` looked for global (entityId: null) rows that
 * never existed — so every opportunity ended up with the 5% fallback.
 *
 * Usage: npx tsx scripts/backfill-stage-configs.ts
 */
import { PrismaClient } from "../src/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { config } from "dotenv";

config();

const STAGE_DEFAULTS = [
  { stage: "NEW" as const,           order: 1,  probability: 5,   sla: 24 as number | null },
  { stage: "CONTACTED" as const,     order: 2,  probability: 15,  sla: 48 },
  { stage: "DISCOVERY" as const,     order: 3,  probability: 30,  sla: 72 },
  { stage: "QUALIFIED" as const,     order: 4,  probability: 50,  sla: 168 },
  { stage: "TECH_MEETING" as const,  order: 5,  probability: 60,  sla: 168 },
  { stage: "PROPOSAL_SENT" as const, order: 6,  probability: 75,  sla: 168 },
  { stage: "NEGOTIATION" as const,   order: 7,  probability: 85,  sla: 168 },
  { stage: "VERBAL_YES" as const,    order: 8,  probability: 95,  sla: 72  },
  { stage: "WON" as const,           order: 9,  probability: 100, sla: null },
  { stage: "LOST" as const,          order: 10, probability: 0,   sla: null },
  { stage: "POSTPONED" as const,     order: 11, probability: 0,   sla: null },
];

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const db = new PrismaClient({ adapter });

  const entities = await db.crmEntity.findMany({ select: { id: true, code: true } });
  console.log(`Backfilling ${STAGE_DEFAULTS.length} stages × ${entities.length} entities`);
  for (const cfg of STAGE_DEFAULTS) {
    for (const e of entities) {
      await db.crmStageConfig.upsert({
        where: { entityId_stage: { entityId: e.id, stage: cfg.stage } },
        create: { entityId: e.id, stage: cfg.stage, probabilityPct: cfg.probability, slaHours: cfg.sla, displayOrder: cfg.order },
        update: { probabilityPct: cfg.probability, slaHours: cfg.sla, displayOrder: cfg.order },
      });
    }
  }

  const opps = await db.crmOpportunity.findMany({
    where: { deletedAt: null },
    select: { id: true, stage: true, estimatedValueEGP: true, probabilityPct: true },
  });
  let fixed = 0;
  for (const o of opps) {
    const cfg = STAGE_DEFAULTS.find((s) => s.stage === o.stage)!;
    if (o.probabilityPct === cfg.probability) continue;
    const estEgp = Number(o.estimatedValueEGP);
    const newWeighted = estEgp * (cfg.probability / 100);
    await db.crmOpportunity.update({
      where: { id: o.id },
      data: { probabilityPct: cfg.probability, weightedValueEGP: newWeighted },
    });
    fixed++;
  }
  console.log(`Re-weighted ${fixed} / ${opps.length} opportunities`);
  await db.$disconnect();
  await pool.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
