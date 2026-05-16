import { PrismaClient } from "../src/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { config } from "dotenv";
config();
async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const db = new PrismaClient({ adapter: new PrismaPg(pool) });
  // Ping every 3 minutes — well inside Neon's idle-suspend window (~5 min
  // on free tier). Keeps the connection warm so a long test suite doesn't
  // hit a cold-start mid-run.
  while (true) {
    try {
      await db.$queryRaw`SELECT 1`;
      console.log(new Date().toISOString(), "ping ok");
    } catch (e) {
      console.error("ping failed:", e);
    }
    await new Promise((r) => setTimeout(r, 180_000));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
