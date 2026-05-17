import { PrismaClient } from "../src/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { config } from "dotenv";
config();

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const db = new PrismaClient({ adapter });

  // Find any CRM users that are MISSING an entityId — they'd be unable
  // to create opportunities because the form requires `entityId` and the
  // server `userEntityId` defaults to null for them.
  const broken = await db.crmUserProfile.findMany({
    where: { entityId: null, active: true },
    include: { user: { select: { email: true } } },
  });
  console.log(`CRM users with NULL entityId (will fail to create opps): ${broken.length}`);
  for (const u of broken) {
    console.log(`  - ${u.user.email} (role=${u.role}, id=${u.id})`);
  }

  const entities = await db.crmEntity.findMany({ select: { id: true, code: true, nameEn: true } });
  console.log(`\nActive entities: ${entities.length}`);
  for (const e of entities) console.log(`  - ${e.code} / ${e.nameEn} (${e.id})`);

  await db.$disconnect();
  await pool.end();
}
main().catch((e) => { console.error("ERROR:", e); process.exit(1); });
