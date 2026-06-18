-- Idempotent completion of migration_1781132631762
-- Run this ONCE against the production database (it is safe to re-run).
-- Each statement is guarded so it only does the work that did not already
-- succeed during the original (partial) deploy.
--
-- After it completes successfully, mark the migration as applied:
--   npx prisma migrate resolve --applied migration_1781132631762
--   npx prisma migrate deploy
--
-- NOTE: this mirrors the original migration's behaviour. As in the original,
-- the "stage" columns on crm_opportunities / crm_stage_configs and the
-- fromStage/toStage columns on crm_stage_histories are converted from enum to
-- text by DROP + ADD, which resets existing values to their column default.
-- Take a database snapshot/backup before running.

-- ============================================================
-- Enums
-- ============================================================

DO $$ BEGIN
  CREATE TYPE "CrmColdLeadStatus" AS ENUM ('NEW', 'ASSIGNED', 'NO_ANSWER', 'WAITING_LIST', 'NOT_INTERESTED', 'CONVERTED', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "CrmDashboardVisibility" AS ENUM ('OWNER', 'SPECIFIC', 'EVERYONE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CrmRole: rebuild enum to ('REP','MANAGER','ASSISTANT','ACCOUNT_MGR','ADMIN')
-- only if it does not already have that exact set of values.
DO $$
DECLARE current_labels text[];
BEGIN
  SELECT array_agg(enumlabel ORDER BY enumlabel) INTO current_labels
  FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
  WHERE t.typname = 'CrmRole';

  IF current_labels IS DISTINCT FROM ARRAY['ACCOUNT_MGR','ADMIN','ASSISTANT','MANAGER','REP'] THEN
    ALTER TABLE "crm_user_profiles" ALTER COLUMN "role" DROP DEFAULT;
    DROP TYPE IF EXISTS "CrmRole_new";
    CREATE TYPE "CrmRole_new" AS ENUM ('REP', 'MANAGER', 'ASSISTANT', 'ACCOUNT_MGR', 'ADMIN');
    ALTER TABLE "crm_user_profiles" ALTER COLUMN "role" TYPE "CrmRole_new" USING ("role"::text::"CrmRole_new");
    ALTER TYPE "CrmRole" RENAME TO "CrmRole_old";
    ALTER TYPE "CrmRole_new" RENAME TO "CrmRole";
    DROP TYPE "CrmRole_old";
    ALTER TABLE "crm_user_profiles" ALTER COLUMN "role" SET DEFAULT 'REP';
  END IF;
END $$;

-- CrmMeetingStatus: add new values (no-op if already present)
ALTER TYPE "CrmMeetingStatus" ADD VALUE IF NOT EXISTS 'PENDING_APPROVAL';
ALTER TYPE "CrmMeetingStatus" ADD VALUE IF NOT EXISTS 'APPROVED';
ALTER TYPE "CrmMeetingStatus" ADD VALUE IF NOT EXISTS 'DENIED';

-- ============================================================
-- Column additions (all IF NOT EXISTS)
-- ============================================================

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "hr_employees"
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deletedById" TEXT;

ALTER TABLE "hr_audit_logs" ADD COLUMN IF NOT EXISTS "actingAdminId" TEXT;

ALTER TABLE "crm_user_profiles"
  ADD COLUMN IF NOT EXISTS "hrEmployeeId" TEXT,
  ADD COLUMN IF NOT EXISTS "managerId" TEXT;

ALTER TABLE "crm_opportunities"
  ADD COLUMN IF NOT EXISTS "customValuesJson" JSONB,
  ADD COLUMN IF NOT EXISTS "customerCompanyName" TEXT,
  ADD COLUMN IF NOT EXISTS "customerContactEmail" TEXT,
  ADD COLUMN IF NOT EXISTS "customerContactName" TEXT,
  ADD COLUMN IF NOT EXISTS "customerContactPhone" TEXT,
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deletedById" TEXT,
  ADD COLUMN IF NOT EXISTS "depositAmount" DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS "depositDate" DATE,
  ADD COLUMN IF NOT EXISTS "forecastCategoryOverride" TEXT,
  ADD COLUMN IF NOT EXISTS "pipelineId" TEXT;
ALTER TABLE "crm_opportunities" ALTER COLUMN "companyId" DROP NOT NULL;
-- stage: enum -> text (only if still the enum type)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='crm_opportunities' AND column_name='stage' AND data_type='USER-DEFINED') THEN
    ALTER TABLE "crm_opportunities" DROP COLUMN "stage";
    ALTER TABLE "crm_opportunities" ADD COLUMN "stage" TEXT NOT NULL DEFAULT 'NEW';
  END IF;
END $$;

ALTER TABLE "crm_stage_histories" ADD COLUMN IF NOT EXISTS "actingAdminId" TEXT;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='crm_stage_histories' AND column_name='fromStage' AND data_type='USER-DEFINED') THEN
    ALTER TABLE "crm_stage_histories" DROP COLUMN "fromStage";
    ALTER TABLE "crm_stage_histories" ADD COLUMN "fromStage" TEXT;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='crm_stage_histories' AND column_name='toStage' AND data_type='USER-DEFINED') THEN
    ALTER TABLE "crm_stage_histories" DROP COLUMN "toStage";
    ALTER TABLE "crm_stage_histories" ADD COLUMN "toStage" TEXT NOT NULL;
  END IF;
END $$;

ALTER TABLE "crm_calls" ADD COLUMN IF NOT EXISTS "actingAdminId" TEXT;
ALTER TABLE "crm_daily_reports" ADD COLUMN IF NOT EXISTS "actingAdminId" TEXT;

ALTER TABLE "crm_meetings"
  ADD COLUMN IF NOT EXISTS "actingAdminId" TEXT,
  ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "approvedById" TEXT,
  ADD COLUMN IF NOT EXISTS "deniedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deniedReason" TEXT;
ALTER TABLE "crm_meetings" ALTER COLUMN "status" SET DEFAULT 'PENDING_APPROVAL';

ALTER TABLE "crm_notes" ADD COLUMN IF NOT EXISTS "actingAdminId" TEXT;

ALTER TABLE "crm_activity_logs" ADD COLUMN IF NOT EXISTS "actingAdminId" TEXT;
ALTER TABLE "crm_activity_logs" ALTER COLUMN "actorId" DROP NOT NULL;

ALTER TABLE "crm_stage_configs"
  ADD COLUMN IF NOT EXISTS "customLabelAr" TEXT,
  ADD COLUMN IF NOT EXISTS "customLabelEn" TEXT,
  ADD COLUMN IF NOT EXISTS "forecastCategory" TEXT DEFAULT 'pipeline',
  ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "maxDays" INTEGER,
  ADD COLUMN IF NOT EXISTS "pipelineId" TEXT,
  ADD COLUMN IF NOT EXISTS "requiredFieldsJson" JSONB,
  ADD COLUMN IF NOT EXISTS "stageType" TEXT DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS "targetDays" INTEGER;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='crm_stage_configs' AND column_name='stage' AND data_type='USER-DEFINED') THEN
    ALTER TABLE "crm_stage_configs" DROP COLUMN "stage";
    ALTER TABLE "crm_stage_configs" ADD COLUMN "stage" TEXT NOT NULL;
  END IF;
END $$;

ALTER TABLE "partner_profiles" ADD COLUMN IF NOT EXISTS "currentTierId" TEXT;
ALTER TABLE "partner_leads"
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deletedById" TEXT;
ALTER TABLE "partner_clients"
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deletedById" TEXT;
ALTER TABLE "partner_deals"
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deletedById" TEXT;
ALTER TABLE "partner_audit_logs" ADD COLUMN IF NOT EXISTS "actingAdminId" TEXT;

-- ============================================================
-- Drop old enum (only after stage columns are converted to text)
-- ============================================================
DROP TYPE IF EXISTS "CrmOpportunityStage";

-- ============================================================
-- Tables (all IF NOT EXISTS)
-- ============================================================

CREATE TABLE IF NOT EXISTS "crm_cold_leads" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "companyName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "contactPerson" TEXT,
    "contactPosition" TEXT,
    "socialMedia" TEXT,
    "industry" TEXT,
    "category" TEXT,
    "location" TEXT,
    "source" TEXT,
    "notes" TEXT,
    "status" "CrmColdLeadStatus" NOT NULL DEFAULT 'NEW',
    "assignedToId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "lastDispositionAt" TIMESTAMP(3),
    "recycleEligibleAt" TIMESTAMP(3),
    "convertedOpportunityId" TEXT,
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_cold_leads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm_cold_lead_imports" (
    "id" TEXT NOT NULL,
    "importedById" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_cold_lead_imports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm_lead_sla_policies" (
    "id" TEXT NOT NULL,
    "status" "CrmColdLeadStatus" NOT NULL,
    "targetMinutes" INTEGER NOT NULL,
    "reminderPct" INTEGER NOT NULL DEFAULT 50,
    "breachAction" TEXT NOT NULL DEFAULT 'notify-manager',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_lead_sla_policies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm_cold_lead_dispositions" (
    "id" TEXT NOT NULL,
    "coldLeadId" TEXT NOT NULL,
    "repId" TEXT NOT NULL,
    "actingAdminId" TEXT,
    "disposition" "CrmColdLeadStatus" NOT NULL,
    "notes" TEXT,
    "dispositionedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_cold_lead_dispositions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm_team_memberships" (
    "id" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "repId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_team_memberships_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm_opportunity_meddpicc" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "metricsScore" INTEGER,
    "metricsNotes" TEXT,
    "economicBuyerScore" INTEGER,
    "economicBuyerNotes" TEXT,
    "decisionCriteriaScore" INTEGER,
    "decisionCriteriaNotes" TEXT,
    "decisionProcessScore" INTEGER,
    "decisionProcessNotes" TEXT,
    "paperProcessScore" INTEGER,
    "paperProcessNotes" TEXT,
    "identifyPainScore" INTEGER,
    "identifyPainNotes" TEXT,
    "championScore" INTEGER,
    "championNotes" TEXT,
    "competitionScore" INTEGER,
    "competitionNotes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_opportunity_meddpicc_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm_opportunity_contacts" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "whatsapp" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "roleType" TEXT,
    "influence" INTEGER,
    "sentiment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_opportunity_contacts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm_rep_capacities" (
    "id" TEXT NOT NULL,
    "repId" TEXT NOT NULL,
    "maxOpenLeads" INTEGER,
    "routingWeight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "skillTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pausedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_rep_capacities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm_lead_recycle_policies" (
    "id" TEXT NOT NULL,
    "status" "CrmColdLeadStatus" NOT NULL,
    "cooldownDays" INTEGER NOT NULL,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "recycleTarget" TEXT NOT NULL DEFAULT 'unassigned-pool',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_lead_recycle_policies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm_close_plans" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Mutual Action Plan',
    "shareToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_close_plans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm_close_plan_items" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "ownerSide" TEXT NOT NULL DEFAULT 'us',
    "dueDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'open',
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_close_plan_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm_stage_playbooks" (
    "id" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "bodyMd" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_stage_playbooks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm_stage_activity_quotas" (
    "id" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "activityType" TEXT NOT NULL,
    "minCount" INTEGER NOT NULL,
    "windowDays" INTEGER NOT NULL DEFAULT 30,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_stage_activity_quotas_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm_competitors" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_competitors_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm_opportunity_competitors" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "competitorId" TEXT NOT NULL,
    "wasPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_opportunity_competitors_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm_opportunity_comments" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "actingAdminId" TEXT,
    "body" TEXT NOT NULL,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_opportunity_comments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm_opportunity_comment_mentions" (
    "id" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "mentionedUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_opportunity_comment_mentions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm_notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "href" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_notifications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm_forecast_submissions" (
    "id" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "commitEGP" DECIMAL(14,2) NOT NULL,
    "bestCaseEGP" DECIMAL(14,2) NOT NULL,
    "notes" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_forecast_submissions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm_impersonation_sessions" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    CONSTRAINT "crm_impersonation_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm_impersonation_audits" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "reason" TEXT,
    "ipAddress" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_impersonation_audits_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm_lead_status_transitions" (
    "id" TEXT NOT NULL,
    "fromStatus" "CrmColdLeadStatus" NOT NULL,
    "toStatus" "CrmColdLeadStatus" NOT NULL,
    "requiresReason" BOOLEAN NOT NULL DEFAULT false,
    "allowedRoles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_lead_status_transitions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm_workflows" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "triggerKind" TEXT NOT NULL,
    "triggerConfig" JSONB,
    "conditionJson" JSONB,
    "actionJson" JSONB NOT NULL,
    "suppressionWindowMinutes" INTEGER NOT NULL DEFAULT 1440,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastFiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_workflows_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm_workflow_runs" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "payloadJson" JSONB,
    "resultJson" JSONB,
    "error" TEXT,
    "firedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "crm_workflow_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm_dashboards" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "layoutJson" JSONB NOT NULL,
    "visibility" "CrmDashboardVisibility" NOT NULL DEFAULT 'OWNER',
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_dashboards_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm_dashboard_shares" (
    "id" TEXT NOT NULL,
    "dashboardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_dashboard_shares_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm_alert_rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "predicateJson" JSONB NOT NULL,
    "channels" TEXT[] DEFAULT ARRAY['in-app']::TEXT[],
    "suppressionDays" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_alert_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm_alert_rule_fires" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "firedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_alert_rule_fires_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm_close_date_history" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "oldDate" TIMESTAMP(3),
    "newDate" TIMESTAMP(3),
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedById" TEXT NOT NULL,
    CONSTRAINT "crm_close_date_history_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm_cold_lead_import_rejects" (
    "id" TEXT NOT NULL,
    "importBatchId" TEXT,
    "rowNumber" INTEGER NOT NULL,
    "rawJson" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_cold_lead_import_rejects_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm_pipelines" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'new-business',
    "defaultForKind" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_pipelines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm_custom_field_defs" (
    "id" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "definition" JSONB,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_custom_field_defs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm_quotas" (
    "id" TEXT NOT NULL,
    "repId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "amountEGP" DECIMAL(14,2) NOT NULL,
    "splitKind" TEXT NOT NULL DEFAULT 'all',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_quotas_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm_saved_views" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filtersJson" JSONB NOT NULL,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_saved_views_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm_customer_needs" (
    "id" TEXT NOT NULL,
    "labelEn" TEXT NOT NULL,
    "labelAr" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_customer_needs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm_meeting_type_configs" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "labelEn" TEXT NOT NULL,
    "labelAr" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "crm_meeting_type_configs_pkey" PRIMARY KEY ("id")
);

-- ============================================================
-- Indexes (all IF NOT EXISTS)
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS "crm_cold_leads_convertedOpportunityId_key" ON "crm_cold_leads"("convertedOpportunityId");
CREATE INDEX IF NOT EXISTS "crm_cold_leads_status_idx" ON "crm_cold_leads"("status");
CREATE INDEX IF NOT EXISTS "crm_cold_leads_assignedToId_idx" ON "crm_cold_leads"("assignedToId");
CREATE INDEX IF NOT EXISTS "crm_cold_leads_industry_idx" ON "crm_cold_leads"("industry");
CREATE INDEX IF NOT EXISTS "crm_cold_leads_category_idx" ON "crm_cold_leads"("category");
CREATE INDEX IF NOT EXISTS "crm_cold_leads_location_idx" ON "crm_cold_leads"("location");
CREATE INDEX IF NOT EXISTS "crm_cold_leads_importBatchId_idx" ON "crm_cold_leads"("importBatchId");
CREATE INDEX IF NOT EXISTS "crm_cold_leads_recycleEligibleAt_idx" ON "crm_cold_leads"("recycleEligibleAt");
CREATE INDEX IF NOT EXISTS "crm_cold_lead_imports_importedById_idx" ON "crm_cold_lead_imports"("importedById");
CREATE INDEX IF NOT EXISTS "crm_cold_lead_imports_createdAt_idx" ON "crm_cold_lead_imports"("createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "crm_lead_sla_policies_status_key" ON "crm_lead_sla_policies"("status");
CREATE INDEX IF NOT EXISTS "crm_cold_lead_dispositions_coldLeadId_idx" ON "crm_cold_lead_dispositions"("coldLeadId");
CREATE INDEX IF NOT EXISTS "crm_cold_lead_dispositions_repId_dispositionedAt_idx" ON "crm_cold_lead_dispositions"("repId", "dispositionedAt");
CREATE INDEX IF NOT EXISTS "crm_team_memberships_repId_idx" ON "crm_team_memberships"("repId");
CREATE UNIQUE INDEX IF NOT EXISTS "crm_team_memberships_managerId_repId_key" ON "crm_team_memberships"("managerId", "repId");
CREATE UNIQUE INDEX IF NOT EXISTS "crm_opportunity_meddpicc_opportunityId_key" ON "crm_opportunity_meddpicc"("opportunityId");
CREATE INDEX IF NOT EXISTS "crm_opportunity_contacts_opportunityId_idx" ON "crm_opportunity_contacts"("opportunityId");
CREATE INDEX IF NOT EXISTS "crm_opportunity_contacts_email_idx" ON "crm_opportunity_contacts"("email");
CREATE INDEX IF NOT EXISTS "crm_opportunity_contacts_phone_idx" ON "crm_opportunity_contacts"("phone");
CREATE UNIQUE INDEX IF NOT EXISTS "crm_rep_capacities_repId_key" ON "crm_rep_capacities"("repId");
CREATE UNIQUE INDEX IF NOT EXISTS "crm_lead_recycle_policies_status_key" ON "crm_lead_recycle_policies"("status");
CREATE UNIQUE INDEX IF NOT EXISTS "crm_close_plans_opportunityId_key" ON "crm_close_plans"("opportunityId");
CREATE UNIQUE INDEX IF NOT EXISTS "crm_close_plans_shareToken_key" ON "crm_close_plans"("shareToken");
CREATE INDEX IF NOT EXISTS "crm_close_plan_items_planId_idx" ON "crm_close_plan_items"("planId");
CREATE UNIQUE INDEX IF NOT EXISTS "crm_stage_playbooks_stage_key" ON "crm_stage_playbooks"("stage");
CREATE UNIQUE INDEX IF NOT EXISTS "crm_stage_activity_quotas_stage_activityType_key" ON "crm_stage_activity_quotas"("stage", "activityType");
CREATE UNIQUE INDEX IF NOT EXISTS "crm_competitors_name_key" ON "crm_competitors"("name");
CREATE INDEX IF NOT EXISTS "crm_opportunity_competitors_opportunityId_idx" ON "crm_opportunity_competitors"("opportunityId");
CREATE UNIQUE INDEX IF NOT EXISTS "crm_opportunity_competitors_opportunityId_competitorId_key" ON "crm_opportunity_competitors"("opportunityId", "competitorId");
CREATE INDEX IF NOT EXISTS "crm_opportunity_comments_opportunityId_createdAt_idx" ON "crm_opportunity_comments"("opportunityId", "createdAt");
CREATE INDEX IF NOT EXISTS "crm_opportunity_comments_authorId_idx" ON "crm_opportunity_comments"("authorId");
CREATE INDEX IF NOT EXISTS "crm_opportunity_comment_mentions_mentionedUserId_idx" ON "crm_opportunity_comment_mentions"("mentionedUserId");
CREATE UNIQUE INDEX IF NOT EXISTS "crm_opportunity_comment_mentions_commentId_mentionedUserId_key" ON "crm_opportunity_comment_mentions"("commentId", "mentionedUserId");
CREATE INDEX IF NOT EXISTS "crm_notifications_userId_isRead_idx" ON "crm_notifications"("userId", "isRead");
CREATE INDEX IF NOT EXISTS "crm_notifications_userId_createdAt_idx" ON "crm_notifications"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "crm_forecast_submissions_periodKey_idx" ON "crm_forecast_submissions"("periodKey");
CREATE UNIQUE INDEX IF NOT EXISTS "crm_forecast_submissions_managerId_periodKey_key" ON "crm_forecast_submissions"("managerId", "periodKey");
CREATE UNIQUE INDEX IF NOT EXISTS "crm_impersonation_sessions_adminUserId_key" ON "crm_impersonation_sessions"("adminUserId");
CREATE INDEX IF NOT EXISTS "crm_impersonation_audits_adminUserId_idx" ON "crm_impersonation_audits"("adminUserId");
CREATE INDEX IF NOT EXISTS "crm_impersonation_audits_targetUserId_idx" ON "crm_impersonation_audits"("targetUserId");
CREATE UNIQUE INDEX IF NOT EXISTS "crm_lead_status_transitions_fromStatus_toStatus_key" ON "crm_lead_status_transitions"("fromStatus", "toStatus");
CREATE INDEX IF NOT EXISTS "crm_workflows_triggerKind_idx" ON "crm_workflows"("triggerKind");
CREATE INDEX IF NOT EXISTS "crm_workflow_runs_workflowId_firedAt_idx" ON "crm_workflow_runs"("workflowId", "firedAt");
CREATE INDEX IF NOT EXISTS "crm_workflow_runs_entityId_idx" ON "crm_workflow_runs"("entityId");
CREATE INDEX IF NOT EXISTS "crm_dashboards_ownerId_idx" ON "crm_dashboards"("ownerId");
CREATE INDEX IF NOT EXISTS "crm_dashboards_visibility_idx" ON "crm_dashboards"("visibility");
CREATE UNIQUE INDEX IF NOT EXISTS "crm_dashboards_ownerId_name_key" ON "crm_dashboards"("ownerId", "name");
CREATE INDEX IF NOT EXISTS "crm_dashboard_shares_userId_idx" ON "crm_dashboard_shares"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "crm_dashboard_shares_dashboardId_userId_key" ON "crm_dashboard_shares"("dashboardId", "userId");
CREATE INDEX IF NOT EXISTS "crm_alert_rule_fires_ruleId_entityId_firedAt_idx" ON "crm_alert_rule_fires"("ruleId", "entityId", "firedAt");
CREATE INDEX IF NOT EXISTS "crm_close_date_history_opportunityId_idx" ON "crm_close_date_history"("opportunityId");
CREATE INDEX IF NOT EXISTS "crm_cold_lead_import_rejects_importBatchId_idx" ON "crm_cold_lead_import_rejects"("importBatchId");
CREATE UNIQUE INDEX IF NOT EXISTS "crm_pipelines_name_key" ON "crm_pipelines"("name");
CREATE INDEX IF NOT EXISTS "crm_custom_field_defs_objectType_idx" ON "crm_custom_field_defs"("objectType");
CREATE UNIQUE INDEX IF NOT EXISTS "crm_custom_field_defs_objectType_slug_key" ON "crm_custom_field_defs"("objectType", "slug");
CREATE INDEX IF NOT EXISTS "crm_quotas_repId_idx" ON "crm_quotas"("repId");
CREATE INDEX IF NOT EXISTS "crm_quotas_periodStart_idx" ON "crm_quotas"("periodStart");
CREATE UNIQUE INDEX IF NOT EXISTS "crm_quotas_repId_period_periodStart_splitKind_key" ON "crm_quotas"("repId", "period", "periodStart", "splitKind");
CREATE INDEX IF NOT EXISTS "crm_saved_views_scope_idx" ON "crm_saved_views"("scope");
CREATE INDEX IF NOT EXISTS "crm_saved_views_ownerId_idx" ON "crm_saved_views"("ownerId");
CREATE UNIQUE INDEX IF NOT EXISTS "crm_customer_needs_labelEn_key" ON "crm_customer_needs"("labelEn");
CREATE UNIQUE INDEX IF NOT EXISTS "crm_meeting_type_configs_code_key" ON "crm_meeting_type_configs"("code");
CREATE INDEX IF NOT EXISTS "hr_employees_deletedAt_idx" ON "hr_employees"("deletedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "crm_user_profiles_hrEmployeeId_key" ON "crm_user_profiles"("hrEmployeeId");
CREATE INDEX IF NOT EXISTS "crm_opportunities_stage_idx" ON "crm_opportunities"("stage");
CREATE INDEX IF NOT EXISTS "crm_opportunities_deletedAt_idx" ON "crm_opportunities"("deletedAt");
CREATE INDEX IF NOT EXISTS "crm_meetings_approvedById_idx" ON "crm_meetings"("approvedById");
CREATE UNIQUE INDEX IF NOT EXISTS "crm_stage_configs_entityId_stage_key" ON "crm_stage_configs"("entityId", "stage");
CREATE INDEX IF NOT EXISTS "partner_profiles_currentTierId_idx" ON "partner_profiles"("currentTierId");
CREATE INDEX IF NOT EXISTS "partner_leads_deletedAt_idx" ON "partner_leads"("deletedAt");
CREATE INDEX IF NOT EXISTS "partner_clients_deletedAt_idx" ON "partner_clients"("deletedAt");
CREATE INDEX IF NOT EXISTS "partner_deals_deletedAt_idx" ON "partner_deals"("deletedAt");

-- ============================================================
-- Foreign keys (drop-if-exists then add => idempotent)
-- ============================================================

ALTER TABLE "crm_cold_leads" DROP CONSTRAINT IF EXISTS "crm_cold_leads_assignedToId_fkey";
ALTER TABLE "crm_cold_leads" ADD CONSTRAINT "crm_cold_leads_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "crm_user_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_cold_leads" DROP CONSTRAINT IF EXISTS "crm_cold_leads_convertedOpportunityId_fkey";
ALTER TABLE "crm_cold_leads" ADD CONSTRAINT "crm_cold_leads_convertedOpportunityId_fkey" FOREIGN KEY ("convertedOpportunityId") REFERENCES "crm_opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_cold_leads" DROP CONSTRAINT IF EXISTS "crm_cold_leads_importBatchId_fkey";
ALTER TABLE "crm_cold_leads" ADD CONSTRAINT "crm_cold_leads_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "crm_cold_lead_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_cold_lead_imports" DROP CONSTRAINT IF EXISTS "crm_cold_lead_imports_importedById_fkey";
ALTER TABLE "crm_cold_lead_imports" ADD CONSTRAINT "crm_cold_lead_imports_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "crm_user_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_cold_lead_dispositions" DROP CONSTRAINT IF EXISTS "crm_cold_lead_dispositions_coldLeadId_fkey";
ALTER TABLE "crm_cold_lead_dispositions" ADD CONSTRAINT "crm_cold_lead_dispositions_coldLeadId_fkey" FOREIGN KEY ("coldLeadId") REFERENCES "crm_cold_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_cold_lead_dispositions" DROP CONSTRAINT IF EXISTS "crm_cold_lead_dispositions_repId_fkey";
ALTER TABLE "crm_cold_lead_dispositions" ADD CONSTRAINT "crm_cold_lead_dispositions_repId_fkey" FOREIGN KEY ("repId") REFERENCES "crm_user_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_user_profiles" DROP CONSTRAINT IF EXISTS "crm_user_profiles_managerId_fkey";
ALTER TABLE "crm_user_profiles" ADD CONSTRAINT "crm_user_profiles_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "crm_user_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_user_profiles" DROP CONSTRAINT IF EXISTS "crm_user_profiles_hrEmployeeId_fkey";
ALTER TABLE "crm_user_profiles" ADD CONSTRAINT "crm_user_profiles_hrEmployeeId_fkey" FOREIGN KEY ("hrEmployeeId") REFERENCES "hr_employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_team_memberships" DROP CONSTRAINT IF EXISTS "crm_team_memberships_managerId_fkey";
ALTER TABLE "crm_team_memberships" ADD CONSTRAINT "crm_team_memberships_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "crm_user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_team_memberships" DROP CONSTRAINT IF EXISTS "crm_team_memberships_repId_fkey";
ALTER TABLE "crm_team_memberships" ADD CONSTRAINT "crm_team_memberships_repId_fkey" FOREIGN KEY ("repId") REFERENCES "crm_user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_opportunities" DROP CONSTRAINT IF EXISTS "crm_opportunities_companyId_fkey";
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "crm_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_opportunities" DROP CONSTRAINT IF EXISTS "crm_opportunities_pipelineId_fkey";
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "crm_pipelines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_opportunity_meddpicc" DROP CONSTRAINT IF EXISTS "crm_opportunity_meddpicc_opportunityId_fkey";
ALTER TABLE "crm_opportunity_meddpicc" ADD CONSTRAINT "crm_opportunity_meddpicc_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "crm_opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_opportunity_contacts" DROP CONSTRAINT IF EXISTS "crm_opportunity_contacts_opportunityId_fkey";
ALTER TABLE "crm_opportunity_contacts" ADD CONSTRAINT "crm_opportunity_contacts_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "crm_opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_rep_capacities" DROP CONSTRAINT IF EXISTS "crm_rep_capacities_repId_fkey";
ALTER TABLE "crm_rep_capacities" ADD CONSTRAINT "crm_rep_capacities_repId_fkey" FOREIGN KEY ("repId") REFERENCES "crm_user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_close_plans" DROP CONSTRAINT IF EXISTS "crm_close_plans_opportunityId_fkey";
ALTER TABLE "crm_close_plans" ADD CONSTRAINT "crm_close_plans_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "crm_opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_close_plan_items" DROP CONSTRAINT IF EXISTS "crm_close_plan_items_planId_fkey";
ALTER TABLE "crm_close_plan_items" ADD CONSTRAINT "crm_close_plan_items_planId_fkey" FOREIGN KEY ("planId") REFERENCES "crm_close_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_opportunity_competitors" DROP CONSTRAINT IF EXISTS "crm_opportunity_competitors_opportunityId_fkey";
ALTER TABLE "crm_opportunity_competitors" ADD CONSTRAINT "crm_opportunity_competitors_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "crm_opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_opportunity_competitors" DROP CONSTRAINT IF EXISTS "crm_opportunity_competitors_competitorId_fkey";
ALTER TABLE "crm_opportunity_competitors" ADD CONSTRAINT "crm_opportunity_competitors_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "crm_competitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_opportunity_comments" DROP CONSTRAINT IF EXISTS "crm_opportunity_comments_opportunityId_fkey";
ALTER TABLE "crm_opportunity_comments" ADD CONSTRAINT "crm_opportunity_comments_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "crm_opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_opportunity_comments" DROP CONSTRAINT IF EXISTS "crm_opportunity_comments_authorId_fkey";
ALTER TABLE "crm_opportunity_comments" ADD CONSTRAINT "crm_opportunity_comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "crm_user_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_opportunity_comments" DROP CONSTRAINT IF EXISTS "crm_opportunity_comments_actingAdminId_fkey";
ALTER TABLE "crm_opportunity_comments" ADD CONSTRAINT "crm_opportunity_comments_actingAdminId_fkey" FOREIGN KEY ("actingAdminId") REFERENCES "crm_user_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_opportunity_comment_mentions" DROP CONSTRAINT IF EXISTS "crm_opportunity_comment_mentions_commentId_fkey";
ALTER TABLE "crm_opportunity_comment_mentions" ADD CONSTRAINT "crm_opportunity_comment_mentions_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "crm_opportunity_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_opportunity_comment_mentions" DROP CONSTRAINT IF EXISTS "crm_opportunity_comment_mentions_mentionedUserId_fkey";
ALTER TABLE "crm_opportunity_comment_mentions" ADD CONSTRAINT "crm_opportunity_comment_mentions_mentionedUserId_fkey" FOREIGN KEY ("mentionedUserId") REFERENCES "crm_user_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_forecast_submissions" DROP CONSTRAINT IF EXISTS "crm_forecast_submissions_managerId_fkey";
ALTER TABLE "crm_forecast_submissions" ADD CONSTRAINT "crm_forecast_submissions_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "crm_user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_meetings" DROP CONSTRAINT IF EXISTS "crm_meetings_approvedById_fkey";
ALTER TABLE "crm_meetings" ADD CONSTRAINT "crm_meetings_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "crm_user_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_activity_logs" DROP CONSTRAINT IF EXISTS "crm_activity_logs_actorId_fkey";
ALTER TABLE "crm_activity_logs" ADD CONSTRAINT "crm_activity_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "crm_user_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_stage_configs" DROP CONSTRAINT IF EXISTS "crm_stage_configs_pipelineId_fkey";
ALTER TABLE "crm_stage_configs" ADD CONSTRAINT "crm_stage_configs_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "crm_pipelines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_workflow_runs" DROP CONSTRAINT IF EXISTS "crm_workflow_runs_workflowId_fkey";
ALTER TABLE "crm_workflow_runs" ADD CONSTRAINT "crm_workflow_runs_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "crm_workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_dashboards" DROP CONSTRAINT IF EXISTS "crm_dashboards_ownerId_fkey";
ALTER TABLE "crm_dashboards" ADD CONSTRAINT "crm_dashboards_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "crm_user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_dashboard_shares" DROP CONSTRAINT IF EXISTS "crm_dashboard_shares_dashboardId_fkey";
ALTER TABLE "crm_dashboard_shares" ADD CONSTRAINT "crm_dashboard_shares_dashboardId_fkey" FOREIGN KEY ("dashboardId") REFERENCES "crm_dashboards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_dashboard_shares" DROP CONSTRAINT IF EXISTS "crm_dashboard_shares_userId_fkey";
ALTER TABLE "crm_dashboard_shares" ADD CONSTRAINT "crm_dashboard_shares_userId_fkey" FOREIGN KEY ("userId") REFERENCES "crm_user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_alert_rule_fires" DROP CONSTRAINT IF EXISTS "crm_alert_rule_fires_ruleId_fkey";
ALTER TABLE "crm_alert_rule_fires" ADD CONSTRAINT "crm_alert_rule_fires_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "crm_alert_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_close_date_history" DROP CONSTRAINT IF EXISTS "crm_close_date_history_opportunityId_fkey";
ALTER TABLE "crm_close_date_history" ADD CONSTRAINT "crm_close_date_history_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "crm_opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_quotas" DROP CONSTRAINT IF EXISTS "crm_quotas_repId_fkey";
ALTER TABLE "crm_quotas" ADD CONSTRAINT "crm_quotas_repId_fkey" FOREIGN KEY ("repId") REFERENCES "crm_user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_saved_views" DROP CONSTRAINT IF EXISTS "crm_saved_views_ownerId_fkey";
ALTER TABLE "crm_saved_views" ADD CONSTRAINT "crm_saved_views_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "crm_user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "partner_profiles" DROP CONSTRAINT IF EXISTS "partner_profiles_currentTierId_fkey";
ALTER TABLE "partner_profiles" ADD CONSTRAINT "partner_profiles_currentTierId_fkey" FOREIGN KEY ("currentTierId") REFERENCES "partner_tiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
