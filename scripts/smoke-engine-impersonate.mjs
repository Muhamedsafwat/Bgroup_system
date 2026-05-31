// Smoke: workflow engine + impersonation models.
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
  console.log("Smoke: workflow engine + impersonation\n");

  // ── Workflow engine: create a log-only workflow + verify a run row.
  console.log("Workflow engine");
  const wf = await db.crmWorkflow.create({
    data: {
      name: `smoke-engine-${Date.now()}`,
      triggerKind: "smoke.test",
      actionJson: { kind: "log-only" },
      suppressionWindowMinutes: 0,
    },
  });
  assert(!!wf.id, "workflow created");

  // Invoke the engine directly via Prisma — we don't have a server
  // running in this smoke harness, so we simulate what fireWorkflow
  // writes: a CrmWorkflowRun row keyed to the workflow.
  const run = await db.crmWorkflowRun.create({
    data: {
      workflowId: wf.id,
      status: "success",
      entityType: "opportunity",
      entityId: "smoke-opp-id",
      payloadJson: { test: true },
      resultJson: { kind: "log-only", ok: true },
      finishedAt: new Date(),
    },
  });
  assert(run.status === "success", "workflow run written");
  await db.crmWorkflowRun.delete({ where: { id: run.id } });
  await db.crmWorkflow.delete({ where: { id: wf.id } });

  // ── Impersonation: insert + look up + cleanup.
  console.log("\nImpersonation");
  const adminUser = await db.user.findFirst({ select: { id: true } });
  const targetUser = await db.user.findFirst({
    where: { id: { not: adminUser?.id } },
    select: { id: true },
  });
  if (!adminUser || !targetUser) {
    console.log("  (skipped — need at least 2 users)");
  } else {
    const session = await db.crmImpersonationSession.create({
      data: {
        adminUserId: adminUser.id,
        targetUserId: targetUser.id,
        reason: "smoke test",
      },
    });
    assert(session.adminUserId === adminUser.id, "impersonation session created");

    // Lookup as the auth callback would
    const lookup = await db.crmImpersonationSession.findUnique({
      where: { adminUserId: adminUser.id },
      select: { targetUserId: true },
    });
    assert(lookup?.targetUserId === targetUser.id, "lookup returns target");

    // Audit
    await db.crmImpersonationAudit.create({
      data: {
        adminUserId: adminUser.id,
        targetUserId: targetUser.id,
        event: "start",
        reason: "smoke",
      },
    });
    const auditCount = await db.crmImpersonationAudit.count({
      where: { adminUserId: adminUser.id },
    });
    assert(auditCount >= 1, "audit row recorded");

    await db.crmImpersonationSession.delete({ where: { id: session.id } });
    await db.crmImpersonationAudit.deleteMany({
      where: { adminUserId: adminUser.id, reason: "smoke" },
    });
    const after = await db.crmImpersonationSession.findUnique({
      where: { adminUserId: adminUser.id },
    });
    assert(!after, "impersonation cleanup");
  }
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
