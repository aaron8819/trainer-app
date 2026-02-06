-- Phase 6: Schema Cleanup
-- 6A: Remove unused ReadinessLog and FatigueLog tables
-- 6B: Remove unused ProgressionRule table
-- 6C: Migrate WorkoutExercise.movementPattern to V2

-- =============================================================
-- 6A: Drop ReadinessLog and FatigueLog
-- =============================================================

DROP TABLE IF EXISTS "ReadinessLog";
DROP TABLE IF EXISTS "FatigueLog";

-- =============================================================
-- 6B: Drop ProgressionRule
-- =============================================================

DROP TABLE IF EXISTS "ProgressionRule";

-- =============================================================
-- 6C: Add movementPatternsV2 to WorkoutExercise, make legacy optional
-- =============================================================

-- Step 1: Add movementPatternsV2 column (enum array, default empty)
ALTER TABLE "WorkoutExercise"
  ADD COLUMN IF NOT EXISTS "movementPatternsV2" "MovementPatternV2"[] DEFAULT '{}';

-- Step 2: Backfill from Exercise table
UPDATE "WorkoutExercise" we
SET "movementPatternsV2" = e."movementPatternsV2"
FROM "Exercise" e
WHERE we."exerciseId" = e."id"
  AND (we."movementPatternsV2" IS NULL OR we."movementPatternsV2" = '{}');

-- Step 3: Make legacy movementPattern optional
ALTER TABLE "WorkoutExercise"
  ALTER COLUMN "movementPattern" DROP NOT NULL;
