import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });
const users = await db.user.findMany({
  select: {
    email: true,
    name: true,
    hrAccess: true, crmAccess: true, partnersAccess: true,
    hrProfile: { select: { isSuperuser: true, roles: { select: { role: { select: { name: true } } } } } },
    crmProfile: { select: { role: true, managerId: true } },
    partnerProfile: { select: { id: true } },
  },
  take: 30,
});
for (const u of users) {
  const hrRoles = u.hrProfile?.roles?.map(r => r.role.name).join(",") ?? "-";
  console.log(JSON.stringify({
    email: u.email,
    modules: [u.hrAccess && "hr", u.crmAccess && "crm", u.partnersAccess && "partners"].filter(Boolean).join("+"),
    hrRoles,
    isSuperuser: u.hrProfile?.isSuperuser ?? false,
    crmRole: u.crmProfile?.role,
    crmHasManager: !!u.crmProfile?.managerId,
    isPartner: !!u.partnerProfile,
  }));
}
await db.$disconnect(); await pool.end();
