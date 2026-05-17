import { PrismaClient } from "../src/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { config } from "dotenv";
config();
async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const db = new PrismaClient({ adapter: new PrismaPg(pool) });
  const us = await db.user.findMany({
    where: { email: { contains: "amira", mode: "insensitive" } },
    select: { email: true, hrAccess: true, crmAccess: true, partnersAccess: true, mustChangePassword: true, crmProfile: { select: { id: true, entityId: true, role: true, managerId: true } } },
  });
  console.log("matches:", JSON.stringify(us, null, 2));
  await db.$disconnect();
  await pool.end();
}
main().catch(console.error);
