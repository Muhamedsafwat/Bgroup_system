-- Prevent the same sales rep from being double-booked for two
-- meetings whose time ranges overlap. Uses a GiST exclusion
-- constraint on a `tstzrange(startAt, endAt)` so concurrent inserts
-- can't both pass the application-level "no conflict" check.
--
-- Cancelled / denied meetings are intentionally excluded from the
-- constraint — those slots are reusable.
--
-- Apply with: npx prisma db execute --file prisma/sql/add-meeting-overlap-exclusion.sql
-- Idempotent.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Drop pre-existing constraint of the same name if a previous attempt
-- partially applied. Postgres' IF NOT EXISTS on ADD CONSTRAINT only
-- landed in v17; we keep the DO block for compatibility with older
-- managed Postgres targets.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'crm_meetings_no_overlap_per_rep'
  ) THEN
    ALTER TABLE crm_meetings
      ADD CONSTRAINT crm_meetings_no_overlap_per_rep
      EXCLUDE USING gist (
        "scheduledById" WITH =,
        int8range(
          (EXTRACT(EPOCH FROM "startAt") * 1000)::bigint,
          (EXTRACT(EPOCH FROM "endAt") * 1000)::bigint
        ) WITH &&
      )
      WHERE (status NOT IN ('CANCELLED', 'DENIED'));
  END IF;
END $$;
