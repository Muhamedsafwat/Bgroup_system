import { PrismaClient } from "../src/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { config } from "dotenv";
config();
async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const db = new PrismaClient({ adapter });
  // Existing users (pre-feature) should not be forced to change. Only newly-
  // created users via the admin form (and admin-reset targets) get the flag.
  const r = await db.user.updateMany({
    where: { mustChangePassword: true },
    data: { mustChangePassword: false },
  });
  console.log("Cleared mustChangePassword on", r.count, "existing rows");
  await db.$disconnect();
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
