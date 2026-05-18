import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

const mgr = await db.crmUserProfile.findFirst({ where: { role: "MANAGER", active: true } });
const rep = await db.crmUserProfile.findFirst({ where: { role: "REP", active: true } });
console.log("BEFORE  rep.managerId =", rep?.managerId);

const updated = await db.crmUserProfile.update({
  where: { id: rep.id },
  data: { managerId: mgr.id },
});
console.log("AFTER   rep.managerId =", updated.managerId);

const refetch = await db.crmUserProfile.findUnique({ where: { id: rep.id }, select: { managerId: true, manager: { select: { fullName: true } } } });
console.log("RE-FETCH rep.managerId =", refetch?.managerId, " manager:", refetch?.manager?.fullName);

await db.$disconnect(); await pool.end();
