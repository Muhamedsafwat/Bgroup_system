/**
 * Database migration: main (production) → staging schema.
 *
 * Applies all schema changes introduced in the staging branch to a database
 * currently running the main-branch schema. Run on the STAGING database first
 * to validate before applying to production.
 *
 * Usage:
 *   npx tsx scripts/migrate-main-to-staging.ts
 *
 * What it does:
 *   1.  Adds CrmColdLeadStatus enum
 *   2.  Extends CrmMeetingStatus with PENDING_APPROVAL / APPROVED / DENIED
 *   3.  Converts CrmOpportunityStage enum → TEXT (stage, fromStage, toStage)
 *   4.  Drops the CrmOpportunityStage enum
 *   5.  Adds mustChangePassword to users
 *   6.  Adds managerId + hrEmployeeId to crm_user_profiles
 *   7.  Creates crm_team_memberships
 *   8.  Creates crm_cold_lead_imports, crm_cold_leads, crm_cold_lead_dispositions
 *   9.  Adds customer* + soft-delete columns to crm_opportunities, makes companyId nullable
 *   10. Adds approval columns to crm_meetings
 *   11. Adds isActive / customLabel* to crm_stage_configs
 *   12. Creates crm_customer_needs + crm_meeting_type_configs
 *   13. Adds soft-delete to hr_employees, partner_leads, partner_clients, partner_deals
 *
 * The entire migration runs inside a single SQL transaction — any error
 * rolls everything back.
 */

import pg from "pg";
import { config } from "dotenv";

config();

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║  Migration: main → staging schema                   ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log();

  try {
    await client.query("BEGIN");
    console.log("Transaction started.\n");

    // ================================================================
    // STEP 1: Add CrmColdLeadStatus enum
    // ================================================================
    console.log("[1/16] Creating CrmColdLeadStatus enum...");
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CrmColdLeadStatus') THEN
          CREATE TYPE "CrmColdLeadStatus" AS ENUM (
            'NEW', 'ASSIGNED', 'NO_ANSWER', 'WAITING_LIST',
            'NOT_INTERESTED', 'CONVERTED', 'ARCHIVED'
          );
        END IF;
      END $$;
    `);
    console.log("  ✓ Done\n");

    // ================================================================
    // STEP 2: Extend CrmMeetingStatus enum
    // NOTE: ALTER TYPE ADD VALUE cannot run inside a transaction on PG < 12.
    //       PG 12+ allows it. We commit+begin around these if needed.
    // ================================================================
    console.log("[2/16] Extending CrmMeetingStatus enum...");

    // Check PG version for transactional ADD VALUE support
    const versionResult = await client.query("SHOW server_version_num");
    const pgVersion = parseInt(versionResult.rows[0].server_version_num, 10);

    if (pgVersion < 120000) {
      // PG < 12: Must run ADD VALUE outside transaction
      await client.query("COMMIT");

      const addEnumValue = async (value: string, position: string) => {
        const exists = await client.query(
          `SELECT 1 FROM pg_enum WHERE enumlabel = $1
           AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'CrmMeetingStatus')`,
          [value]
        );
        if (exists.rowCount === 0) {
          await client.query(
            `ALTER TYPE "CrmMeetingStatus" ADD VALUE '${value}' ${position}`
          );
        }
      };

      await addEnumValue("PENDING_APPROVAL", "BEFORE 'WAITING'");
      await addEnumValue("APPROVED", "AFTER 'WAITING'");
      await addEnumValue("DENIED", "AFTER 'APPROVED'");

      await client.query("BEGIN");
    } else {
      // PG 12+: ADD VALUE works inside transactions
      for (const [value, position] of [
        ["PENDING_APPROVAL", "BEFORE 'WAITING'"],
        ["APPROVED", "AFTER 'WAITING'"],
        ["DENIED", "AFTER 'APPROVED'"],
      ] as const) {
        const exists = await client.query(
          `SELECT 1 FROM pg_enum WHERE enumlabel = $1
           AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'CrmMeetingStatus')`,
          [value]
        );
        if (exists.rowCount === 0) {
          await client.query(
            `ALTER TYPE "CrmMeetingStatus" ADD VALUE '${value}' ${position}`
          );
        }
      }
    }
    console.log("  ✓ Done\n");

    // ================================================================
    // STEP 3: Convert CrmOpportunityStage columns from enum → TEXT
    // ================================================================
    console.log("[3/16] Converting CrmOpportunityStage columns to TEXT...");

    // Helper: convert column from enum to text if it's still an enum
    const convertEnumToText = async (
      table: string,
      column: string,
      defaultVal?: string
    ) => {
      const check = await client.query(
        `SELECT udt_name FROM information_schema.columns
         WHERE table_name = $1 AND column_name = $2`,
        [table, column]
      );
      if (check.rows.length > 0 && check.rows[0].udt_name === "CrmOpportunityStage") {
        await client.query(
          `ALTER TABLE ${table} ALTER COLUMN "${column}" TYPE TEXT USING "${column}"::TEXT`
        );
        if (defaultVal) {
          await client.query(
            `ALTER TABLE ${table} ALTER COLUMN "${column}" SET DEFAULT '${defaultVal}'`
          );
        }
        console.log(`  ✓ ${table}."${column}" → TEXT`);
      } else {
        console.log(`  → ${table}."${column}" already TEXT, skipping`);
      }
    };

    await convertEnumToText("crm_opportunities", "stage", "NEW");
    await convertEnumToText("crm_stage_histories", "fromStage");
    await convertEnumToText("crm_stage_histories", "toStage");
    await convertEnumToText("crm_stage_configs", "stage");
    console.log();

    // ================================================================
    // STEP 4: Drop CrmOpportunityStage enum
    // ================================================================
    console.log("[4/16] Dropping CrmOpportunityStage enum...");
    await client.query(`DROP TYPE IF EXISTS "CrmOpportunityStage"`);
    console.log("  ✓ Done\n");

    // ================================================================
    // STEP 5: Add mustChangePassword to users
    // ================================================================
    console.log("[5/16] Adding mustChangePassword to users...");
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false
    `);
    console.log("  ✓ Done\n");

    // ================================================================
    // STEP 6: Add managerId + hrEmployeeId to crm_user_profiles
    // ================================================================
    console.log("[6/16] Adding managerId + hrEmployeeId to crm_user_profiles...");

    await client.query(`
      ALTER TABLE crm_user_profiles ADD COLUMN IF NOT EXISTS "managerId" TEXT
    `);
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'crm_user_profiles_managerId_fkey'
        ) THEN
          ALTER TABLE crm_user_profiles
            ADD CONSTRAINT "crm_user_profiles_managerId_fkey"
            FOREIGN KEY ("managerId") REFERENCES crm_user_profiles(id)
            ON DELETE SET NULL ON UPDATE CASCADE;
        END IF;
      END $$;
    `);

    await client.query(`
      ALTER TABLE crm_user_profiles ADD COLUMN IF NOT EXISTS "hrEmployeeId" TEXT
    `);
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'crm_user_profiles_hrEmployeeId_fkey'
        ) THEN
          ALTER TABLE crm_user_profiles
            ADD CONSTRAINT "crm_user_profiles_hrEmployeeId_fkey"
            FOREIGN KEY ("hrEmployeeId") REFERENCES hr_employees(id)
            ON DELETE SET NULL ON UPDATE CASCADE;
        END IF;
      END $$;
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "crm_user_profiles_hrEmployeeId_key"
        ON crm_user_profiles ("hrEmployeeId")
    `);
    console.log("  ✓ Done\n");

    // ================================================================
    // STEP 7: Create crm_team_memberships
    // ================================================================
    console.log("[7/16] Creating crm_team_memberships table...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS crm_team_memberships (
        id TEXT NOT NULL,
        "managerId" TEXT NOT NULL,
        "repId" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT crm_team_memberships_pkey PRIMARY KEY (id),
        CONSTRAINT "crm_team_memberships_managerId_fkey"
          FOREIGN KEY ("managerId") REFERENCES crm_user_profiles(id)
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "crm_team_memberships_repId_fkey"
          FOREIGN KEY ("repId") REFERENCES crm_user_profiles(id)
          ON DELETE CASCADE ON UPDATE CASCADE
      )
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "crm_team_memberships_managerId_repId_key"
        ON crm_team_memberships ("managerId", "repId")
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS "crm_team_memberships_repId_idx"
        ON crm_team_memberships ("repId")
    `);
    console.log("  ✓ Done\n");

    // ================================================================
    // STEP 8: Create cold-leads tables
    // ================================================================
    console.log("[8/16] Creating crm_cold_lead_imports table...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS crm_cold_lead_imports (
        id TEXT NOT NULL,
        "importedById" TEXT NOT NULL,
        "fileName" TEXT NOT NULL,
        "rowCount" INT NOT NULL DEFAULT 0,
        "duplicateCount" INT NOT NULL DEFAULT 0,
        notes TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT crm_cold_lead_imports_pkey PRIMARY KEY (id),
        CONSTRAINT "crm_cold_lead_imports_importedById_fkey"
          FOREIGN KEY ("importedById") REFERENCES crm_user_profiles(id)
          ON DELETE RESTRICT ON UPDATE CASCADE
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS "crm_cold_lead_imports_importedById_idx"
        ON crm_cold_lead_imports ("importedById")
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS "crm_cold_lead_imports_createdAt_idx"
        ON crm_cold_lead_imports ("createdAt")
    `);
    console.log("  ✓ Done\n");

    console.log("[9/16] Creating crm_cold_leads table...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS crm_cold_leads (
        id TEXT NOT NULL,
        name TEXT NOT NULL,
        "companyName" TEXT,
        phone TEXT,
        email TEXT,
        website TEXT,
        "contactPerson" TEXT,
        "contactPosition" TEXT,
        "socialMedia" TEXT,
        industry TEXT,
        category TEXT,
        location TEXT,
        source TEXT,
        notes TEXT,
        status "CrmColdLeadStatus" NOT NULL DEFAULT 'NEW',
        "assignedToId" TEXT,
        "assignedAt" TIMESTAMP(3),
        "lastDispositionAt" TIMESTAMP(3),
        "recycleEligibleAt" TIMESTAMP(3),
        "convertedOpportunityId" TEXT,
        "importBatchId" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT crm_cold_leads_pkey PRIMARY KEY (id),
        CONSTRAINT "crm_cold_leads_assignedToId_fkey"
          FOREIGN KEY ("assignedToId") REFERENCES crm_user_profiles(id)
          ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "crm_cold_leads_convertedOpportunityId_fkey"
          FOREIGN KEY ("convertedOpportunityId") REFERENCES crm_opportunities(id)
          ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "crm_cold_leads_importBatchId_fkey"
          FOREIGN KEY ("importBatchId") REFERENCES crm_cold_lead_imports(id)
          ON DELETE SET NULL ON UPDATE CASCADE
      )
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "crm_cold_leads_convertedOpportunityId_key"
        ON crm_cold_leads ("convertedOpportunityId")
    `);
    for (const col of [
      "status", "assignedToId", "industry", "category",
      "location", "importBatchId", "recycleEligibleAt",
    ]) {
      await client.query(`
        CREATE INDEX IF NOT EXISTS "crm_cold_leads_${col}_idx"
          ON crm_cold_leads ("${col}")
      `);
    }
    console.log("  ✓ Done\n");

    console.log("[10/16] Creating crm_cold_lead_dispositions table...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS crm_cold_lead_dispositions (
        id TEXT NOT NULL,
        "coldLeadId" TEXT NOT NULL,
        "repId" TEXT NOT NULL,
        disposition "CrmColdLeadStatus" NOT NULL,
        notes TEXT,
        "dispositionedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT crm_cold_lead_dispositions_pkey PRIMARY KEY (id),
        CONSTRAINT "crm_cold_lead_dispositions_coldLeadId_fkey"
          FOREIGN KEY ("coldLeadId") REFERENCES crm_cold_leads(id)
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "crm_cold_lead_dispositions_repId_fkey"
          FOREIGN KEY ("repId") REFERENCES crm_user_profiles(id)
          ON DELETE RESTRICT ON UPDATE CASCADE
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS "crm_cold_lead_dispositions_coldLeadId_idx"
        ON crm_cold_lead_dispositions ("coldLeadId")
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS "crm_cold_lead_dispositions_repId_dispositionedAt_idx"
        ON crm_cold_lead_dispositions ("repId", "dispositionedAt")
    `);
    console.log("  ✓ Done\n");

    // ================================================================
    // STEP 9: Modify crm_opportunities
    // ================================================================
    console.log("[11/16] Modifying crm_opportunities...");

    // New columns
    for (const col of [
      "customerCompanyName",
      "customerContactName",
      "customerContactPhone",
      "customerContactEmail",
    ]) {
      await client.query(`
        ALTER TABLE crm_opportunities ADD COLUMN IF NOT EXISTS "${col}" TEXT
      `);
    }

    // Make companyId nullable
    const companyIdNullable = await client.query(`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_name = 'crm_opportunities' AND column_name = 'companyId'
    `);
    if (companyIdNullable.rows[0]?.is_nullable === "NO") {
      await client.query(`
        ALTER TABLE crm_opportunities ALTER COLUMN "companyId" DROP NOT NULL
      `);
      console.log('  ✓ companyId made nullable');
    }

    // Soft-delete columns
    await client.query(`
      ALTER TABLE crm_opportunities ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3)
    `);
    await client.query(`
      ALTER TABLE crm_opportunities ADD COLUMN IF NOT EXISTS "deletedById" TEXT
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS "crm_opportunities_deletedAt_idx"
        ON crm_opportunities ("deletedAt")
    `);
    console.log("  ✓ Done\n");

    // ================================================================
    // STEP 10: Modify crm_meetings — approval workflow
    // ================================================================
    console.log("[12/16] Adding approval columns to crm_meetings...");

    await client.query(`
      ALTER TABLE crm_meetings ADD COLUMN IF NOT EXISTS "approvedById" TEXT
    `);
    await client.query(`
      ALTER TABLE crm_meetings ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3)
    `);
    await client.query(`
      ALTER TABLE crm_meetings ADD COLUMN IF NOT EXISTS "deniedReason" TEXT
    `);
    await client.query(`
      ALTER TABLE crm_meetings ADD COLUMN IF NOT EXISTS "deniedAt" TIMESTAMP(3)
    `);
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'crm_meetings_approvedById_fkey'
        ) THEN
          ALTER TABLE crm_meetings
            ADD CONSTRAINT "crm_meetings_approvedById_fkey"
            FOREIGN KEY ("approvedById") REFERENCES crm_user_profiles(id)
            ON DELETE SET NULL ON UPDATE CASCADE;
        END IF;
      END $$;
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS "crm_meetings_approvedById_idx"
        ON crm_meetings ("approvedById")
    `);

    // Change default from WAITING to PENDING_APPROVAL
    await client.query(`
      ALTER TABLE crm_meetings
        ALTER COLUMN status SET DEFAULT 'PENDING_APPROVAL'::"CrmMeetingStatus"
    `);
    console.log("  ✓ Done\n");

    // ================================================================
    // STEP 11: Modify crm_stage_configs
    // ================================================================
    console.log("[13/16] Adding isActive + customLabel columns to crm_stage_configs...");
    await client.query(`
      ALTER TABLE crm_stage_configs ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true
    `);
    await client.query(`
      ALTER TABLE crm_stage_configs ADD COLUMN IF NOT EXISTS "customLabelEn" TEXT
    `);
    await client.query(`
      ALTER TABLE crm_stage_configs ADD COLUMN IF NOT EXISTS "customLabelAr" TEXT
    `);
    console.log("  ✓ Done\n");

    // ================================================================
    // STEP 12: Create crm_customer_needs + crm_meeting_type_configs
    // ================================================================
    console.log("[14/16] Creating crm_customer_needs table...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS crm_customer_needs (
        id TEXT NOT NULL,
        "labelEn" TEXT NOT NULL,
        "labelAr" TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT '',
        active BOOLEAN NOT NULL DEFAULT true,
        "sortOrder" INT NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT crm_customer_needs_pkey PRIMARY KEY (id)
      )
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "crm_customer_needs_labelEn_key"
        ON crm_customer_needs ("labelEn")
    `);
    console.log("  ✓ Done\n");

    console.log("[15/16] Creating crm_meeting_type_configs table...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS crm_meeting_type_configs (
        id TEXT NOT NULL,
        code TEXT NOT NULL,
        "labelEn" TEXT NOT NULL,
        "labelAr" TEXT NOT NULL DEFAULT '',
        active BOOLEAN NOT NULL DEFAULT true,
        "sortOrder" INT NOT NULL DEFAULT 0,
        CONSTRAINT crm_meeting_type_configs_pkey PRIMARY KEY (id)
      )
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "crm_meeting_type_configs_code_key"
        ON crm_meeting_type_configs (code)
    `);
    console.log("  ✓ Done\n");

    // ================================================================
    // STEP 13: Soft-delete on hr_employees, partner_leads/clients/deals
    // ================================================================
    console.log("[16/16] Adding soft-delete columns...");

    const softDeleteTables = [
      "hr_employees",
      "partner_leads",
      "partner_clients",
      "partner_deals",
    ];

    for (const table of softDeleteTables) {
      await client.query(`
        ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3)
      `);
      await client.query(`
        ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS "deletedById" TEXT
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS "${table}_deletedAt_idx"
          ON ${table} ("deletedAt")
      `);
      console.log(`  ✓ ${table}`);
    }
    console.log();

    // ================================================================
    // COMMIT
    // ================================================================
    await client.query("COMMIT");

    console.log("╔══════════════════════════════════════════════════════╗");
    console.log("║  ✅  Migration completed successfully!               ║");
    console.log("╚══════════════════════════════════════════════════════╝");
    console.log();

    // Verification
    console.log("Verification:");
    const newTables = [
      "crm_team_memberships",
      "crm_cold_leads",
      "crm_cold_lead_imports",
      "crm_cold_lead_dispositions",
      "crm_customer_needs",
      "crm_meeting_type_configs",
    ];
    for (const t of newTables) {
      const res = await client.query(
        `SELECT COUNT(*) FROM information_schema.tables WHERE table_name = $1`,
        [t]
      );
      const exists = parseInt(res.rows[0].count, 10) > 0;
      console.log(`  ${exists ? "✓" : "✗"} ${t}`);
    }

    // Verify enum was dropped
    const enumCheck = await client.query(
      `SELECT 1 FROM pg_type WHERE typname = 'CrmOpportunityStage'`
    );
    console.log(
      `  ${enumCheck.rowCount === 0 ? "✓" : "✗"} CrmOpportunityStage enum dropped`
    );

    // Verify stage column type
    const stageType = await client.query(
      `SELECT data_type FROM information_schema.columns
       WHERE table_name = 'crm_opportunities' AND column_name = 'stage'`
    );
    console.log(
      `  ✓ crm_opportunities.stage type = ${stageType.rows[0]?.data_type}`
    );

    console.log();
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("\n❌ Migration FAILED — all changes rolled back.\n");
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
