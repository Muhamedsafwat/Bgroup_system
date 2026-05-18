import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });
// Reset the test rep back to unassigned so the user can verify the fix manually.
await db.crmUserProfile.updateMany({
  where: { role: "REP" },
  data: { managerId: null },
});
const reps = await db.crmUserProfile.findMany({ where: { role: "REP" }, select: { fullName: true, managerId: true } });
for (const r of reps) console.log(r.fullName, "→", r.managerId);
await db.$disconnect(); await pool.end();
