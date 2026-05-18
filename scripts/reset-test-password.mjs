// Reset test account passwords so the RBAC audit can log them all in.
// Targets only known test seed emails — never run this against real users.
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import bcrypt from "bcryptjs";
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

const TEST_EMAILS = [
  "ddd@bgroup.com",
  "sales1@bgroup.com",
  "emp@bgroup.com",
  "emp2@bgroup.com",
  "partner1@bgroup.com",
];

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

const hashed = await bcrypt.hash("password123", 12);
for (const email of TEST_EMAILS) {
  const u = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (!u) {
    console.log("skip (no user):", email);
    continue;
  }
  await db.user.update({
    where: { email },
    data: { password: hashed, mustChangePassword: false },
  });
  console.log("reset:", email);
}

await db.$disconnect();
await pool.end();
