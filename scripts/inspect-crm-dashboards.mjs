import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const adapter = new PrismaPg(pool);
const db = new PrismaClient({ adapter });

const total = await db.crmDashboard.count();
const sharedCount = await db.crmDashboard.count({ where: { isShared: true } });
const privateCount = await db.crmDashboard.count({ where: { isShared: false } });

console.log("CrmDashboard counts:", JSON.stringify({ total, sharedCount, privateCount }));

const sample = await db.crmDashboard.findMany({
  take: 5,
  orderBy: { createdAt: "desc" },
  select: {
    id: true,
    name: true,
    ownerId: true,
    isShared: true,
    createdAt: true,
    updatedAt: true,
    owner: { select: { fullName: true, role: true } },
  },
});
console.log("Recent rows:", JSON.stringify(sample, null, 2));

const sharedSample = await db.crmDashboard.findMany({
  where: { isShared: true },
  take: 5,
  orderBy: { updatedAt: "desc" },
  select: {
    id: true,
    name: true,
    ownerId: true,
    owner: { select: { fullName: true, role: true } },
  },
});
console.log("Shared rows sample:", JSON.stringify(sharedSample, null, 2));

await db.$disconnect();
await pool.end();
