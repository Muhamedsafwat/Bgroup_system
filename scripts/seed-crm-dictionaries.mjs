// One-shot: seed CrmCustomerNeed + CrmMeetingTypeConfig with the values
// that used to be hardcoded in the meetings booking form. Re-running is
// safe — uses upsert keyed on the unique label/code.
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

const NEEDS = [
  { labelEn: "B-Clinics", category: "Healthcare", sortOrder: 10 },
  { labelEn: "B-Optical", category: "Healthcare", sortOrder: 20 },
  { labelEn: "Social Media Management", category: "Marketing", sortOrder: 30 },
  { labelEn: "Website", category: "Web", sortOrder: 40 },
  { labelEn: "ERP System", category: "Software", sortOrder: 50 },
  { labelEn: "Mobile App", category: "Software", sortOrder: 60 },
];

for (const n of NEEDS) {
  await db.crmCustomerNeed.upsert({
    where: { labelEn: n.labelEn },
    create: { ...n, active: true, labelAr: "" },
    update: {},
  });
}

const TYPES = [
  { code: "DEMO", labelEn: "Demo", sortOrder: 10 },
  { code: "OFFICE_VISIT", labelEn: "Office visit", sortOrder: 20 },
  { code: "FOLLOWUP", labelEn: "Follow-up", sortOrder: 30 },
  { code: "PROPOSAL", labelEn: "Proposal review", sortOrder: 40 },
  { code: "ONBOARDING", labelEn: "Onboarding", sortOrder: 50 },
];
for (const t of TYPES) {
  await db.crmMeetingTypeConfig.upsert({
    where: { code: t.code },
    create: { ...t, active: true, labelAr: "" },
    update: {},
  });
}

console.log(
  `Seeded ${NEEDS.length} customer needs + ${TYPES.length} meeting types`
);
await db.$disconnect();
