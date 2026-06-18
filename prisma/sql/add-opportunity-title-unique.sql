-- Per-OWNER unique index on opportunity title (case-insensitive,
-- excluding soft-deleted rows).
--
-- bugfix 2026-06-19: this was previously a GLOBAL unique index on
-- LOWER(title). On a multi-rep team that blocked reps from creating
-- opportunities whenever a name was already used by ANY other rep
-- (the dedupe-opp-titles.sql migration shows collisions were common) —
-- reported as "a rep has a problem creating opportunities". We scope
-- uniqueness to the OWNER instead: each rep's own pipeline can't contain
-- two opps with the same name (so "what's the status of <name>?" is
-- unambiguous within a rep's book), but two different reps may reuse a
-- name for different customers.
--
-- Functional indexes aren't expressible in Prisma 7's schema DSL, so we
-- maintain it as a raw migration alongside the trigram search indexes.
--
-- Apply with:   npx prisma db execute --file prisma/sql/add-opportunity-title-unique.sql
-- Idempotent.

-- Drop the old global index if it exists (replaced by the per-owner one).
DROP INDEX IF EXISTS crm_opportunities_title_unique;

CREATE UNIQUE INDEX IF NOT EXISTS crm_opportunities_owner_title_unique
  ON crm_opportunities ("ownerId", LOWER("title"))
  WHERE "deletedAt" IS NULL;
