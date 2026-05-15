// One-shot repair: find every CrmUserProfile whose unified User row has no
// password (or a blank email), so the admin can see who's broken and reset.
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import bcrypt from "bcryptjs";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

const profiles = await db.crmUserProfile.findMany({
  include: { user: { select: { id: true, email: true, password: true } } },
  orderBy: { fullName: "asc" },
});

console.log(`Found ${profiles.length} CRM profiles. Checking for broken logins...\n`);

let resetCount = 0;
const newPwd = "password123";
const hashed = await bcrypt.hash(newPwd, 12);

for (const p of profiles) {
  const hasPwd = !!p.user?.password;
  const hasEmail = !!p.user?.email;
  if (!hasPwd) {
    if (!hasEmail) {
      console.log(`⚠ ${p.fullName} — no email AND no password (can't fix automatically; edit in UI)`);
      continue;
    }
    await db.user.update({
      where: { id: p.user.id },
      data: { password: hashed, crmAccess: true },
    });
    console.log(`✓ ${p.fullName} <${p.user.email}> — password reset to "${newPwd}"`);
    resetCount++;
  } else {
    console.log(`  ${p.fullName} <${p.user.email ?? "(no email)"}> — ok`);
  }
}

console.log(`\nReset ${resetCount} user(s) to password "${newPwd}".`);
await db.$disconnect();
