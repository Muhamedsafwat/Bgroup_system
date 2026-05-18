-- ============================================================================
-- Migration: main → staging schema
-- Generated: 2026-05-19
--
-- PURPOSE:
--   Apply all staging-branch schema changes to a database currently running
--   the main-branch schema. Run this on the STAGING database first to
--   validate before applying to production.
--
-- USAGE:
--   psql "$DATABASE_URL" -f scripts/migrate-main-to-staging.sql
--
-- SAFETY:
--   • Wrapped in a single transaction — any error rolls back everything.
--   • Uses IF NOT EXISTS / IF EXISTS where possible for idempotency.
--   • Converts enum columns BEFORE dropping the enum type.
--   • Preserves all existing data.
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Add new enum type — CrmColdLeadStatus
-- ============================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CrmColdLeadStatus') THEN
    CREATE TYPE "CrmColdLeadStatus" AS ENUM (
      'NEW', 'ASSIGNED', 'NO_ANSWER', 'WAITING_LIST',
      'NOT_INTERESTED', 'CONVERTED', 'ARCHIVED'
    );
  END IF;
END $$;

-- ============================================================================
-- STEP 2: Extend CrmMeetingStatus enum with new values
-- ============================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'PENDING_APPROVAL' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'CrmMeetingStatus')) THEN
    ALTER TYPE "CrmMeetingStatus" ADD VALUE 'PENDING_APPROVAL' BEFORE 'WAITING';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'APPROVED' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'CrmMeetingStatus')) THEN
    ALTER TYPE "CrmMeetingStatus" ADD VALUE 'APPROVED' AFTER 'WAITING';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'DENIED' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'CrmMeetingStatus')) THEN
    ALTER TYPE "CrmMeetingStatus" ADD VALUE 'DENIED' AFTER 'APPROVED';
  END IF;
END $$;

-- NOTE: ALTER TYPE ADD VALUE cannot run inside a transaction in PG < 12.
-- If you're on PG >= 12, this works. If on PG < 12, each ADD VALUE must
-- be in its own transaction. Adjust accordingly.

-- ============================================================================
-- STEP 3: Convert CrmOpportunityStage enum columns to TEXT
-- (Must happen BEFORE dropping the enum type)
-- ============================================================================

-- 3a. crm_opportunities.stage: enum → text
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'crm_opportunities' AND column_name = 'stage'
      AND udt_name = 'CrmOpportunityStage'
  ) THEN
    ALTER TABLE crm_opportunities
      ALTER COLUMN "stage" TYPE TEXT USING "stage"::TEXT;
    ALTER TABLE crm_opportunities
      ALTER COLUMN "stage" SET DEFAULT 'NEW';
  END IF;
END $$;

-- 3b. crm_stage_histories.fromStage: enum → text
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'crm_stage_histories' AND column_name = 'fromStage'
      AND udt_name = 'CrmOpportunityStage'
  ) THEN
    ALTER TABLE crm_stage_histories
      ALTER COLUMN "fromStage" TYPE TEXT USING "fromStage"::TEXT;
  END IF;
END $$;

-- 3c. crm_stage_histories.toStage: enum → text
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'crm_stage_histories' AND column_name = 'toStage'
      AND udt_name = 'CrmOpportunityStage'
  ) THEN
    ALTER TABLE crm_stage_histories
      ALTER COLUMN "toStage" TYPE TEXT USING "toStage"::TEXT;
  END IF;
END $$;

-- 3d. crm_stage_configs.stage: enum → text
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'crm_stage_configs' AND column_name = 'stage'
      AND udt_name = 'CrmOpportunityStage'
  ) THEN
    ALTER TABLE crm_stage_configs
      ALTER COLUMN "stage" TYPE TEXT USING "stage"::TEXT;
  END IF;
END $$;

-- 3e. Now safe to drop the enum
DROP TYPE IF EXISTS "CrmOpportunityStage";

-- ============================================================================
-- STEP 4: Add mustChangePassword to users table
-- ============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- ============================================================================
-- STEP 5: Modify crm_user_profiles — add manager self-ref + HR link
-- ============================================================================

-- 5a. managerId (self-referencing FK for primary manager)
ALTER TABLE crm_user_profiles ADD COLUMN IF NOT EXISTS "managerId" TEXT;

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

-- 5b. hrEmployeeId (unique FK to hr_employees)
ALTER TABLE crm_user_profiles ADD COLUMN IF NOT EXISTS "hrEmployeeId" TEXT;

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

CREATE UNIQUE INDEX IF NOT EXISTS "crm_user_profiles_hrEmployeeId_key"
  ON crm_user_profiles ("hrEmployeeId");

-- ============================================================================
-- STEP 6: Create crm_team_memberships table
-- ============================================================================

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
);

CREATE UNIQUE INDEX IF NOT EXISTS "crm_team_memberships_managerId_repId_key"
  ON crm_team_memberships ("managerId", "repId");
CREATE INDEX IF NOT EXISTS "crm_team_memberships_repId_idx"
  ON crm_team_memberships ("repId");

-- ============================================================================
-- STEP 7: Create CRM cold-leads tables
-- ============================================================================

-- 7a. crm_cold_lead_imports
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
);

CREATE INDEX IF NOT EXISTS "crm_cold_lead_imports_importedById_idx"
  ON crm_cold_lead_imports ("importedById");
CREATE INDEX IF NOT EXISTS "crm_cold_lead_imports_createdAt_idx"
  ON crm_cold_lead_imports ("createdAt");

-- 7b. crm_cold_leads
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
);

CREATE UNIQUE INDEX IF NOT EXISTS "crm_cold_leads_convertedOpportunityId_key"
  ON crm_cold_leads ("convertedOpportunityId");
CREATE INDEX IF NOT EXISTS "crm_cold_leads_status_idx"
  ON crm_cold_leads (status);
CREATE INDEX IF NOT EXISTS "crm_cold_leads_assignedToId_idx"
  ON crm_cold_leads ("assignedToId");
CREATE INDEX IF NOT EXISTS "crm_cold_leads_industry_idx"
  ON crm_cold_leads (industry);
CREATE INDEX IF NOT EXISTS "crm_cold_leads_category_idx"
  ON crm_cold_leads (category);
CREATE INDEX IF NOT EXISTS "crm_cold_leads_location_idx"
  ON crm_cold_leads (location);
CREATE INDEX IF NOT EXISTS "crm_cold_leads_importBatchId_idx"
  ON crm_cold_leads ("importBatchId");
CREATE INDEX IF NOT EXISTS "crm_cold_leads_recycleEligibleAt_idx"
  ON crm_cold_leads ("recycleEligibleAt");

-- 7c. crm_cold_lead_dispositions
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
);

CREATE INDEX IF NOT EXISTS "crm_cold_lead_dispositions_coldLeadId_idx"
  ON crm_cold_lead_dispositions ("coldLeadId");
CREATE INDEX IF NOT EXISTS "crm_cold_lead_dispositions_repId_dispositionedAt_idx"
  ON crm_cold_lead_dispositions ("repId", "dispositionedAt");

-- ============================================================================
-- STEP 8: Modify crm_opportunities — new columns + companyId nullable
-- ============================================================================

-- 8a. New free-text customer fields
ALTER TABLE crm_opportunities ADD COLUMN IF NOT EXISTS "customerCompanyName" TEXT;
ALTER TABLE crm_opportunities ADD COLUMN IF NOT EXISTS "customerContactName" TEXT;
ALTER TABLE crm_opportunities ADD COLUMN IF NOT EXISTS "customerContactPhone" TEXT;
ALTER TABLE crm_opportunities ADD COLUMN IF NOT EXISTS "customerContactEmail" TEXT;

-- 8b. Make companyId optional (was required in main)
ALTER TABLE crm_opportunities ALTER COLUMN "companyId" DROP NOT NULL;

-- 8c. Soft-delete columns
ALTER TABLE crm_opportunities ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE crm_opportunities ADD COLUMN IF NOT EXISTS "deletedById" TEXT;

-- 8d. New index on deletedAt
CREATE INDEX IF NOT EXISTS "crm_opportunities_deletedAt_idx"
  ON crm_opportunities ("deletedAt");

-- ============================================================================
-- STEP 9: Modify crm_meetings — approval workflow
-- ============================================================================

ALTER TABLE crm_meetings ADD COLUMN IF NOT EXISTS "approvedById" TEXT;
ALTER TABLE crm_meetings ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);
ALTER TABLE crm_meetings ADD COLUMN IF NOT EXISTS "deniedReason" TEXT;
ALTER TABLE crm_meetings ADD COLUMN IF NOT EXISTS "deniedAt" TIMESTAMP(3);

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

CREATE INDEX IF NOT EXISTS "crm_meetings_approvedById_idx"
  ON crm_meetings ("approvedById");

-- 9b. Change default from WAITING to PENDING_APPROVAL for new rows
ALTER TABLE crm_meetings ALTER COLUMN status SET DEFAULT 'PENDING_APPROVAL'::"CrmMeetingStatus";

-- ============================================================================
-- STEP 10: Modify crm_stage_configs — new columns
-- ============================================================================

ALTER TABLE crm_stage_configs ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE crm_stage_configs ADD COLUMN IF NOT EXISTS "customLabelEn" TEXT;
ALTER TABLE crm_stage_configs ADD COLUMN IF NOT EXISTS "customLabelAr" TEXT;

-- ============================================================================
-- STEP 11: Create crm_customer_needs table
-- ============================================================================

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
);

CREATE UNIQUE INDEX IF NOT EXISTS "crm_customer_needs_labelEn_key"
  ON crm_customer_needs ("labelEn");

-- ============================================================================
-- STEP 12: Create crm_meeting_type_configs table
-- ============================================================================

CREATE TABLE IF NOT EXISTS crm_meeting_type_configs (
  id TEXT NOT NULL,
  code TEXT NOT NULL,
  "labelEn" TEXT NOT NULL,
  "labelAr" TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INT NOT NULL DEFAULT 0,
  CONSTRAINT crm_meeting_type_configs_pkey PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS "crm_meeting_type_configs_code_key"
  ON crm_meeting_type_configs (code);

-- ============================================================================
-- STEP 13: Add soft-delete to hr_employees
-- ============================================================================

ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS "deletedById" TEXT;

CREATE INDEX IF NOT EXISTS "hr_employees_deletedAt_idx"
  ON hr_employees ("deletedAt");

-- ============================================================================
-- STEP 14: Add soft-delete to partner_leads
-- ============================================================================

ALTER TABLE partner_leads ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE partner_leads ADD COLUMN IF NOT EXISTS "deletedById" TEXT;

CREATE INDEX IF NOT EXISTS "partner_leads_deletedAt_idx"
  ON partner_leads ("deletedAt");

-- ============================================================================
-- STEP 15: Add soft-delete to partner_clients
-- ============================================================================

ALTER TABLE partner_clients ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE partner_clients ADD COLUMN IF NOT EXISTS "deletedById" TEXT;

CREATE INDEX IF NOT EXISTS "partner_clients_deletedAt_idx"
  ON partner_clients ("deletedAt");

-- ============================================================================
-- STEP 16: Add soft-delete to partner_deals
-- ============================================================================

ALTER TABLE partner_deals ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE partner_deals ADD COLUMN IF NOT EXISTS "deletedById" TEXT;

CREATE INDEX IF NOT EXISTS "partner_deals_deletedAt_idx"
  ON partner_deals ("deletedAt");

-- ============================================================================
-- DONE
-- ============================================================================

COMMIT;

-- Post-migration: verify counts
SELECT 'Migration completed successfully.' AS result;
SELECT table_name, COUNT(*) AS row_count
FROM (
  SELECT 'crm_team_memberships' AS table_name FROM crm_team_memberships
  UNION ALL SELECT 'crm_cold_leads' FROM crm_cold_leads
  UNION ALL SELECT 'crm_cold_lead_imports' FROM crm_cold_lead_imports
  UNION ALL SELECT 'crm_cold_lead_dispositions' FROM crm_cold_lead_dispositions
  UNION ALL SELECT 'crm_customer_needs' FROM crm_customer_needs
  UNION ALL SELECT 'crm_meeting_type_configs' FROM crm_meeting_type_configs
) t
GROUP BY table_name;
