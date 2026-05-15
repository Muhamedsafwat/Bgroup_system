// Consolidate CrmRole values per the new spec:
//   CEO          → ADMIN      (same user, just called "admin")
//   TECH_DIRECTOR → ASSISTANT  (approver of technical meetings)
//   FINANCE      → ADMIN       (kept admin-level access; finance role no longer exists)
//
// Run before dropping the legacy enum values from the schema. Idempotent.
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

const MIGRATIONS = [
  { from: "CEO", to: "ADMIN" },
  { from: "TECH_DIRECTOR", to: "ASSISTANT" },
  { from: "FINANCE", to: "ADMIN" },
];

for (const m of MIGRATIONS) {
  const r = await db.crmUserProfile.updateMany({
    where: { role: m.from },
    data: { role: m.to },
  });
  console.log(`${m.from} → ${m.to}: ${r.count} row(s) migrated`);
}

// Same migrations on CrmStageHistory if it stores role.
// (CrmStageHistory has no role column — only timestamps + stages — so nothing to do.)

await db.$disconnect();
