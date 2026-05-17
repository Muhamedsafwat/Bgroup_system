import { PrismaClient } from "../src/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { config } from "dotenv";
config();
async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const db = new PrismaClient({ adapter: new PrismaPg(pool) });
  const [
    users, employees, partners,
    coldLeads, coldLeadImports, coldLeadDispositions,
    opps, companies, contacts, calls, meetings,
    products, entities, dailyReports,
    tasks, notifications,
  ] = await Promise.all([
    db.user.count(),
    db.hrEmployee.count(),
    db.partnerProfile.count(),
    db.crmColdLead.count(),
    db.crmColdLeadImport.count(),
    db.crmColdLeadDisposition.count(),
    db.crmOpportunity.count({ where: { deletedAt: null } }),
    db.crmCompany.count(),
    db.crmContact.count(),
    db.crmCall.count(),
    db.crmMeeting.count(),
    db.crmProduct.count(),
    db.crmEntity.count(),
    db.crmDailyReport.count(),
    db.task.count(),
    db.hrNotification.count(),
  ]);
  console.log("=== Data snapshot ===");
  console.log("Users:", users, "| HR Employees:", employees, "| Partners:", partners);
  console.log("Cold Leads:", coldLeads, "| Imports:", coldLeadImports, "| Dispositions:", coldLeadDispositions);
  console.log("Opportunities:", opps, "| Companies:", companies, "| Contacts:", contacts);
  console.log("Calls:", calls, "| Meetings:", meetings, "| Daily Reports:", dailyReports);
  console.log("Products:", products, "| Entities:", entities, "| Tasks:", tasks, "| Notifications:", notifications);

  console.log("\n=== Recent cold lead imports ===");
  const imports = await db.crmColdLeadImport.findMany({
    orderBy: { createdAt: "desc" }, take: 5,
    include: { importedBy: { select: { fullName: true } } },
  });
  for (const i of imports) {
    console.log(`  ${i.createdAt.toISOString().slice(0,16)} · ${i.importedBy.fullName} · "${i.fileName}" · ${i.rowCount} inserted · ${i.duplicateCount} dupes`);
  }

  console.log("\n=== Cold lead bucket counts ===");
  const buckets = await db.crmColdLead.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  for (const b of buckets) console.log(`  ${b.status.padEnd(16)} ${b._count._all}`);

  console.log("\n=== Recent opps ===");
  const recentOpps = await db.crmOpportunity.findMany({
    orderBy: { createdAt: "desc" }, take: 5, where: { deletedAt: null },
    select: { code: true, title: true, customerCompanyName: true, company: { select: { nameEn: true } }, owner: { select: { fullName: true } }, stage: true, createdAt: true },
  });
  for (const o of recentOpps) {
    const customer = o.customerCompanyName ?? o.company?.nameEn ?? "(none)";
    console.log(`  ${o.code} · ${customer} · ${o.owner.fullName} · ${o.stage} · ${o.createdAt.toISOString().slice(0,16)}`);
  }

  await db.$disconnect();
  await pool.end();
}
main().catch((e) => { console.error("ERROR:", e); process.exit(1); });
