-- Phase 1 multi-plan foundation.
--
-- This migration intentionally fails before changing behavior when legacy
-- active-mesocycle state is ambiguous. Run the read-only multi-plan integrity
-- preflight first for identifier-level diagnostics.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Mesocycle" AS mesocycle
    JOIN "MacroCycle" AS macrocycle ON macrocycle."id" = mesocycle."macroCycleId"
    WHERE mesocycle."isActive" = TRUE
    GROUP BY macrocycle."userId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'MULTI_PLAN_PREFLIGHT_REQUIRED: user has multiple legacy active mesocycles';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Mesocycle"
    WHERE "isActive" = TRUE
    GROUP BY "macroCycleId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'MULTI_PLAN_PREFLIGHT_REQUIRED: macrocycle has multiple active mesocycles';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Mesocycle"
    WHERE "isActive" = TRUE
      AND "state" IN ('COMPLETED', 'AWAITING_HANDOFF')
  ) THEN
    RAISE EXCEPTION 'MULTI_PLAN_PREFLIGHT_REQUIRED: active mesocycle has a contradictory lifecycle state';
  END IF;
END $$;

ALTER TABLE "User"
ADD COLUMN "activeMacroCycleId" TEXT;

-- Deterministic legacy inference: select a plan only when the owner has exactly
-- one active mesocycle. Owners with none remain explicitly unselected.
UPDATE "User" AS owner
SET "activeMacroCycleId" = candidate."macroCycleId"
FROM (
  SELECT DISTINCT
    macrocycle."userId",
    mesocycle."macroCycleId"
  FROM "Mesocycle" AS mesocycle
  JOIN "MacroCycle" AS macrocycle ON macrocycle."id" = mesocycle."macroCycleId"
  WHERE mesocycle."isActive" = TRUE
    AND NOT EXISTS (
      SELECT 1
      FROM "Mesocycle" AS other_mesocycle
      JOIN "MacroCycle" AS other_macrocycle
        ON other_macrocycle."id" = other_mesocycle."macroCycleId"
      WHERE other_mesocycle."isActive" = TRUE
        AND other_macrocycle."userId" = macrocycle."userId"
        AND other_mesocycle."id" <> mesocycle."id"
    )
) AS candidate
WHERE owner."id" = candidate."userId";

ALTER TABLE "User"
ADD CONSTRAINT "User_activeMacroCycleId_key" UNIQUE ("activeMacroCycleId");

ALTER TABLE "User"
ADD CONSTRAINT "User_activeMacroCycleId_fkey"
FOREIGN KEY ("activeMacroCycleId")
REFERENCES "MacroCycle" ("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Mesocycle_one_active_per_macrocycle"
ON "Mesocycle" ("macroCycleId")
WHERE "isActive" = TRUE;

ALTER TABLE "Mesocycle"
ADD CONSTRAINT "Mesocycle_active_state_check"
CHECK (
  "isActive" = FALSE
  OR "state" NOT IN ('COMPLETED', 'AWAITING_HANDOFF')
);

COMMIT;
