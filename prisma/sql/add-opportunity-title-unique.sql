-- Partial unique index on opportunity title (case-insensitive,
-- excluding soft-deleted rows). Reps and admins create opps with
-- free-text titles; without this constraint two opps can share a
-- name and confuse every "what's the status of <name>?" lookup.
--
-- Functional indexes aren't expressible in Prisma 7's schema DSL
-- (only column-level @unique is), and we need:
--   1. Case-insensitivity — "Acme Q3" and "acme q3" must collide.
--   2. Soft-delete exclusion — a deleted opp's name should be
--      reusable.
-- so we maintain it as a raw migration alongside the trigram
-- search indexes.
--
-- Apply with:   npx prisma db execute --file prisma/sql/add-opportunity-title-unique.sql
-- Idempotent (uses IF NOT EXISTS).

CREATE UNIQUE INDEX IF NOT EXISTS crm_opportunities_title_unique
  ON crm_opportunities (LOWER("title"))
  WHERE "deletedAt" IS NULL;
