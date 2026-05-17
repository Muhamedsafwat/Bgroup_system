import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const adapter = new PrismaPg(pool);
const db = new PrismaClient({ adapter });

const ids = ["cmodlf3pn00009suxlrn4u3tj", "cmp8w362z0000bsux2t02yijf"];
for (const id of ids) {
  const opp = await db.crmOpportunity.findUnique({
    where: { id },
    select: { id: true, title: true, ownerId: true, deletedAt: true, owner: { select: { fullName: true, role: true, managerId: true } } },
  });
  console.log(id + ":", JSON.stringify(opp));
}

const recent = await db.crmOpportunity.findMany({
  take: 5,
  orderBy: { createdAt: "desc" },
  select: { id: true, title: true, owner: { select: { fullName: true, role: true } } },
});
console.log("Recent:", JSON.stringify(recent, null, 2));

await db.$disconnect();
await pool.end();
