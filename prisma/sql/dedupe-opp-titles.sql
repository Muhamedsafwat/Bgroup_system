-- One-shot data cleanup: append the opp code to any duplicate
-- title so the partial unique index can be applied. We keep the
-- oldest opp in each duplicate group with its original title; all
-- newer collisions get " (OPP-XXXX)" appended. Suffix is the opp's
-- own code so users can still recognise the deal in lists.
--
-- Run once with: npx prisma db execute --file prisma/sql/dedupe-opp-titles.sql
-- Then apply prisma/sql/add-opportunity-title-unique.sql.

WITH ranked AS (
  SELECT id, code, title,
         ROW_NUMBER() OVER (
           PARTITION BY LOWER(title)
           ORDER BY "createdAt" ASC
         ) AS rn
  FROM crm_opportunities
  WHERE "deletedAt" IS NULL
)
UPDATE crm_opportunities o
SET title = r.title || ' (' || r.code || ')'
FROM ranked r
WHERE o.id = r.id
  AND r.rn > 1;
