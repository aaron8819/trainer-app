ALTER TABLE "MacroCycle"
ADD COLUMN "name" VARCHAR(60),
ADD COLUMN "archivedAt" TIMESTAMP(3);

WITH ranked_plans AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "userId"
      ORDER BY "createdAt" ASC, "id" ASC
    ) AS plan_number
  FROM "MacroCycle"
)
UPDATE "MacroCycle" AS plan
SET "name" = concat('Hypertrophy Plan ', ranked_plans.plan_number)
FROM ranked_plans
WHERE plan."id" = ranked_plans."id"
  AND plan."name" IS NULL;

ALTER TABLE "MacroCycle"
ALTER COLUMN "name" SET DEFAULT 'Hypertrophy Plan',
ALTER COLUMN "name" SET NOT NULL;

ALTER TABLE "MacroCycle"
ADD CONSTRAINT "MacroCycle_name_length_check"
CHECK (char_length("name") BETWEEN 1 AND 60);

CREATE INDEX "MacroCycle_userId_archivedAt_updatedAt_idx"
ON "MacroCycle"("userId", "archivedAt", "updatedAt");
