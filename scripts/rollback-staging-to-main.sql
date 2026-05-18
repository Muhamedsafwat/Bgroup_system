-- ============================================================================
-- ROLLBACK: staging → main schema (undo the forward migration)
-- Generated: 2026-05-19
--
-- PURPOSE:
--   Revert the staging migration back to the main-branch schema.
--   Run this if the staging tests fail and you need to reset.
--
-- USAGE:
--   psql "$DATABASE_URL" -f scripts/rollback-staging-to-main.sql
--
-- WARNING:
--   • This DROPS the new tables (crm_cold_leads, etc.) and their data.
--   • This recreates the CrmOpportunityStage enum and casts columns back.
--   • Any data in new columns (e.g. customerCompanyName) will be lost.
--   • Only run this if you are sure you want to revert.
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Drop new tables (order matters — child tables first)
-- ============================================================================

DROP TABLE IF EXISTS crm_cold_lead_dispositions CASCADE;
DROP TABLE IF EXISTS crm_cold_leads CASCADE;
DROP TABLE IF EXISTS crm_cold_lead_imports CASCADE;
DROP TABLE IF EXISTS crm_team_memberships CASCADE;
DROP TABLE IF EXISTS crm_customer_needs CASCADE;
DROP TABLE IF EXISTS crm_meeting_type_configs CASCADE;

-- ============================================================================
-- STEP 2: Recreate CrmOpportunityStage enum
-- ============================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CrmOpportunityStage') THEN
    CREATE TYPE "CrmOpportunityStage" AS ENUM (
      'NEW', 'CONTACTED', 'DISCOVERY', 'QUALIFIED', 'TECH_MEETING',
      'PROPOSAL_SENT', 'NEGOTIATION', 'VERBAL_YES', 'POSTPONED',
      'WON', 'LOST'
    );
  END IF;
END $$;

-- ============================================================================
-- STEP 3: Convert TEXT stage columns back to enum
-- ============================================================================

ALTER TABLE crm_opportunities
  ALTER COLUMN "stage" TYPE "CrmOpportunityStage"
  USING "stage"::"CrmOpportunityStage";
ALTER TABLE crm_opportunities
  ALTER COLUMN "stage" SET DEFAULT 'NEW'::"CrmOpportunityStage";

ALTER TABLE crm_stage_histories
  ALTER COLUMN "fromStage" TYPE "CrmOpportunityStage"
  USING "fromStage"::"CrmOpportunityStage";

ALTER TABLE crm_stage_histories
  ALTER COLUMN "toStage" TYPE "CrmOpportunityStage"
  USING "toStage"::"CrmOpportunityStage";

ALTER TABLE crm_stage_configs
  ALTER COLUMN "stage" TYPE "CrmOpportunityStage"
  USING "stage"::"CrmOpportunityStage";

-- ============================================================================
-- STEP 4: Remove columns added to crm_opportunities
-- ============================================================================

ALTER TABLE crm_opportunities DROP COLUMN IF EXISTS "customerCompanyName";
ALTER TABLE crm_opportunities DROP COLUMN IF EXISTS "customerContactName";
ALTER TABLE crm_opportunities DROP COLUMN IF EXISTS "customerContactPhone";
ALTER TABLE crm_opportunities DROP COLUMN IF EXISTS "customerContactEmail";
ALTER TABLE crm_opportunities DROP COLUMN IF EXISTS "deletedAt";
ALTER TABLE crm_opportunities DROP COLUMN IF EXISTS "deletedById";

-- Make companyId required again
ALTER TABLE crm_opportunities ALTER COLUMN "companyId" SET NOT NULL;

-- ============================================================================
-- STEP 5: Remove columns added to crm_meetings
-- ============================================================================

ALTER TABLE crm_meetings DROP COLUMN IF EXISTS "approvedById";
ALTER TABLE crm_meetings DROP COLUMN IF EXISTS "approvedAt";
ALTER TABLE crm_meetings DROP COLUMN IF EXISTS "deniedReason";
ALTER TABLE crm_meetings DROP COLUMN IF EXISTS "deniedAt";

ALTER TABLE crm_meetings ALTER COLUMN status SET DEFAULT 'WAITING'::"CrmMeetingStatus";

-- ============================================================================
-- STEP 6: Remove columns added to crm_stage_configs
-- ============================================================================

ALTER TABLE crm_stage_configs DROP COLUMN IF EXISTS "isActive";
ALTER TABLE crm_stage_configs DROP COLUMN IF EXISTS "customLabelEn";
ALTER TABLE crm_stage_configs DROP COLUMN IF EXISTS "customLabelAr";

-- ============================================================================
-- STEP 7: Remove columns added to crm_user_profiles
-- ============================================================================

ALTER TABLE crm_user_profiles DROP COLUMN IF EXISTS "managerId";
ALTER TABLE crm_user_profiles DROP COLUMN IF EXISTS "hrEmployeeId";

-- ============================================================================
-- STEP 8: Remove mustChangePassword from users
-- ============================================================================

ALTER TABLE users DROP COLUMN IF EXISTS "mustChangePassword";

-- ============================================================================
-- STEP 9: Remove soft-delete columns from HR/Partner tables
-- ============================================================================

ALTER TABLE hr_employees DROP COLUMN IF EXISTS "deletedAt";
ALTER TABLE hr_employees DROP COLUMN IF EXISTS "deletedById";

ALTER TABLE partner_leads DROP COLUMN IF EXISTS "deletedAt";
ALTER TABLE partner_leads DROP COLUMN IF EXISTS "deletedById";

ALTER TABLE partner_clients DROP COLUMN IF EXISTS "deletedAt";
ALTER TABLE partner_clients DROP COLUMN IF EXISTS "deletedById";

ALTER TABLE partner_deals DROP COLUMN IF EXISTS "deletedAt";
ALTER TABLE partner_deals DROP COLUMN IF EXISTS "deletedById";

-- ============================================================================
-- STEP 10: Drop CrmColdLeadStatus enum
-- ============================================================================

DROP TYPE IF EXISTS "CrmColdLeadStatus";

-- ============================================================================
-- STEP 11: Remove added enum values from CrmMeetingStatus
-- (PG doesn't support DROP VALUE — we need to recreate the enum)
-- ============================================================================

-- This is tricky: PG has no ALTER TYPE DROP VALUE. We recreate the type.
-- Only safe if no rows use PENDING_APPROVAL, APPROVED, or DENIED.

ALTER TYPE "CrmMeetingStatus" RENAME TO "CrmMeetingStatus_old";

CREATE TYPE "CrmMeetingStatus" AS ENUM ('WAITING', 'CONFIRMED', 'DONE', 'CANCELLED');

ALTER TABLE crm_meetings
  ALTER COLUMN status TYPE "CrmMeetingStatus"
  USING status::TEXT::"CrmMeetingStatus";
ALTER TABLE crm_meetings
  ALTER COLUMN status SET DEFAULT 'WAITING'::"CrmMeetingStatus";

DROP TYPE "CrmMeetingStatus_old";

COMMIT;

SELECT 'Rollback completed successfully.' AS result;
