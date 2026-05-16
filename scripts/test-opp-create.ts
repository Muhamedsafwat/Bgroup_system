import { PrismaClient } from "../src/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { config } from "dotenv";
config();

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const db = new PrismaClient({ adapter });

  // Find the admin user
  const admin = await db.user.findUnique({
    where: { email: "admin@bgroup.com" },
    include: { crmProfile: true },
  });
  console.log("admin crmProfile:", { id: admin?.crmProfile?.id, role: admin?.crmProfile?.role, entityId: admin?.crmProfile?.entityId });

  // Find a company assigned to anyone
  const company = await db.crmCompany.findFirst({
    select: { id: true, nameEn: true, assignedToId: true },
  });
  console.log("company:", company);

  const entity = await db.crmEntity.findFirst({ select: { id: true, code: true, nameEn: true } });
  console.log("entity:", entity);

  // Try to create
  try {
    const opp = await db.crmOpportunity.create({
      data: {
        code: "TEST-" + Date.now(),
        companyId: company!.id,
        ownerId: admin!.crmProfile!.id,
        entityId: entity!.id,
        title: "Test from script",
        stage: "NEW",
        priority: "COLD",
        dealType: "ONE_TIME",
        estimatedValue: 1000,
        currency: "EGP",
        estimatedValueEGP: 1000,
        probabilityPct: 5,
        weightedValueEGP: 50,
        expectedCloseDate: new Date(Date.now() + 30 * 86400 * 1000),
        nextAction: "FOLLOW_UP",
        nextActionDate: new Date(Date.now() + 7 * 86400 * 1000),
      },
    });
    console.log("✓ created", opp.code);
    // Roll back
    await db.crmOpportunity.delete({ where: { id: opp.id } });
    console.log("✓ deleted again");
  } catch (err) {
    console.error("✗ failed:", err);
  }

  await db.$disconnect();
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
