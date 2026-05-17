import { PrismaClient } from "../src/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { config } from "dotenv";
config();

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const db = new PrismaClient({ adapter });
  const u = await db.user.findUnique({
    where: { email: "amirahamdy@bgroup.com" },
    include: {
      crmProfile: true,
      hrProfile: { include: { roles: { include: { role: true } } } },
      partnerProfile: true,
    },
  });
  console.log("user:", {
    email: u?.email,
    hrAccess: u?.hrAccess,
    crmAccess: u?.crmAccess,
    partnersAccess: u?.partnersAccess,
    mustChangePassword: u?.mustChangePassword,
  });
  console.log("crmProfile:", u?.crmProfile);
  console.log("hrRoles:", u?.hrProfile?.roles.map((r) => r.role.name));
  // Companies assigned to this user (as a rep)
  if (u?.crmProfile) {
    const companies = await db.crmCompany.findMany({
      where: { assignedToId: u.crmProfile.id },
      select: { id: true, nameEn: true },
    });
    console.log("companies assigned to this rep:", companies.length, "=>", companies);
  }
  await db.$disconnect();
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
