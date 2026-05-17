import { PrismaClient } from "../src/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { config } from "dotenv";
config();
async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const db = new PrismaClient({ adapter: new PrismaPg(pool) });
  console.log("Casting enum columns to TEXT…");
  await db.$executeRawUnsafe(`
    ALTER TABLE "crm_opportunities"
      ALTER COLUMN "stage" DROP DEFAULT,
      ALTER COLUMN "stage" TYPE TEXT USING "stage"::text,
      ALTER COLUMN "stage" SET DEFAULT 'NEW';
  `);
  console.log("  ✓ crm_opportunities.stage");
  await db.$executeRawUnsafe(`
    ALTER TABLE "crm_stage_histories"
      ALTER COLUMN "fromStage" TYPE TEXT USING "fromStage"::text,
      ALTER COLUMN "toStage" TYPE TEXT USING "toStage"::text;
  `);
  console.log("  ✓ crm_stage_histories.fromStage/toStage");
  await db.$executeRawUnsafe(`
    ALTER TABLE "crm_stage_configs"
      ALTER COLUMN "stage" TYPE TEXT USING "stage"::text;
  `);
  console.log("  ✓ crm_stage_configs.stage");
  // Drop the now-unused enum type
  await db.$executeRawUnsafe(`DROP TYPE IF EXISTS "CrmOpportunityStage";`);
  console.log("  ✓ dropped CrmOpportunityStage enum");
  await db.$disconnect();
  await pool.end();
}
main().catch((e) => { console.error("ERROR:", e); process.exit(1); });
