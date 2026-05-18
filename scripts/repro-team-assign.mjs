// Direct repro: pick a manager + a rep, set the rep.managerId = manager.id
// through Prisma (bypasses the action layer to confirm the data model works).
// Then list managers + their reports to see the resulting state.
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

const managers = await db.crmUserProfile.findMany({
  where: { role: { in: ["MANAGER", "ADMIN"] }, active: true },
  select: { id: true, fullName: true, role: true },
});
const reps = await db.crmUserProfile.findMany({
  where: { role: { in: ["REP", "ACCOUNT_MGR"] }, active: true },
  select: { id: true, fullName: true, role: true, managerId: true,
    manager: { select: { id: true, fullName: true } } },
});

console.log("MANAGERS:");
for (const m of managers) console.log(`  ${m.id}  ${m.role.padEnd(8)} ${m.fullName}`);
console.log("\nREPS (with their current manager):");
for (const r of reps) {
  console.log(`  ${r.id}  ${r.role.padEnd(11)} ${r.fullName.padEnd(20)} → manager: ${r.manager?.fullName ?? "(none)"} (${r.managerId ?? "null"})`);
}

await db.$disconnect();
await pool.end();
