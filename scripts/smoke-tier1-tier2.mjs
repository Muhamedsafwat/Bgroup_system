// Smoke: Tier-1 + Tier-2 schema + data-layer contracts.
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

let passed = 0;
let failed = 0;
function assert(cond, label) {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}`);
    failed++;
  }
}

async function main() {
  console.log("Smoke: Tier-1 + Tier-2 schema round-trip\n");

  // Tier-1 #11 — MEDDPICC
  const opp = await db.crmOpportunity.findFirst({
    where: { deletedAt: null },
    select: { id: true },
  });
  if (opp) {
    const m = await db.crmOpportunityMeddpicc.upsert({
      where: { opportunityId: opp.id },
      create: { opportunityId: opp.id, metricsScore: 2 },
      update: { metricsScore: 2 },
    });
    assert(m.metricsScore === 2, "#11 MEDDPICC upsert + score persisted");
    await db.crmOpportunityMeddpicc.delete({ where: { id: m.id } });
  }

  // Tier-1 #14 — Lead SLA policy
  await db.crmLeadSlaPolicy.upsert({
    where: { status: "NEW" },
    create: { status: "NEW", targetMinutes: 5, reminderPct: 50, breachAction: "notify-manager" },
    update: { targetMinutes: 5 },
  });
  const slaPolicy = await db.crmLeadSlaPolicy.findUnique({ where: { status: "NEW" } });
  assert(slaPolicy?.targetMinutes === 5, "#14 SLA policy upsert");
  await db.crmLeadSlaPolicy.delete({ where: { status: "NEW" } });

  // Tier-1 #18 — Quota periodization
  const rep = await db.crmUserProfile.findFirst({
    where: { active: true, role: { in: ["REP", "ACCOUNT_MGR"] } },
    select: { id: true },
  });
  if (rep) {
    const periodStart = new Date("2026-05-01T00:00:00.000Z");
    const q = await db.crmQuota.upsert({
      where: {
        repId_period_periodStart_splitKind: {
          repId: rep.id,
          period: "monthly",
          periodStart,
          splitKind: "all",
        },
      },
      create: {
        repId: rep.id,
        period: "monthly",
        periodStart,
        amountEGP: 50000,
        splitKind: "all",
      },
      update: { amountEGP: 50000 },
    });
    assert(Number(q.amountEGP) === 50000, "#18 quota upsert");
    await db.crmQuota.delete({ where: { id: q.id } });
  }

  // Tier-1 #27 — Competitor M2M
  const comp = await db.crmCompetitor.create({ data: { name: `smoke-${Date.now()}` } });
  assert(!!comp.id, "#27 competitor created");
  await db.crmCompetitor.delete({ where: { id: comp.id } });

  // Tier-2 #31 — Pipeline CRUD
  const p = await db.crmPipeline.create({
    data: { name: `smoke-pipe-${Date.now()}`, kind: "renewal" },
  });
  assert(p.kind === "renewal", "#31 pipeline created with kind=renewal");
  await db.crmPipeline.delete({ where: { id: p.id } });

  // Tier-2 #36 — Workflow
  const wf = await db.crmWorkflow.create({
    data: {
      name: `smoke-wf-${Date.now()}`,
      triggerKind: "opp.stage.changed",
      actionJson: { kind: "notify", channel: "in-app" },
    },
  });
  assert(wf.triggerKind === "opp.stage.changed", "#36 workflow created");
  await db.crmWorkflow.delete({ where: { id: wf.id } });

  // Tier-2 #37 — Custom field def
  const cf = await db.crmCustomFieldDef.create({
    data: {
      objectType: "opportunity",
      slug: `smoke_${Date.now()}`,
      label: "Smoke field",
      kind: "text",
    },
  });
  assert(cf.kind === "text", "#37 custom field def created");
  await db.crmCustomFieldDef.delete({ where: { id: cf.id } });

  // Tier-2 #39 — Alert rule
  const ar = await db.crmAlertRule.create({
    data: {
      name: `smoke-alert-${Date.now()}`,
      scope: "opportunity",
      predicateJson: [{ field: "stage", op: "in", value: ["LOST"] }],
    },
  });
  assert(ar.scope === "opportunity", "#39 alert rule created");
  await db.crmAlertRule.delete({ where: { id: ar.id } });

  // Tier-2 #41 — Cohort matrix shape (read-only smoke)
  const count = await db.crmOpportunity.count({ where: { deletedAt: null } });
  assert(count >= 0, `#41 cohort source queryable (${count} opps in DB)`);
}

main()
  .then(() => {
    console.log("\n──────────────────────────────────────────────");
    console.log(`Result: ${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
  })
  .catch((e) => {
    console.error("\nFATAL:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
    await pool.end();
  });
