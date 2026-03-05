-- Phase 5: Schema Improvements
-- 5A: Compound indexes
-- 5B: Baseline.exerciseId non-nullable + new unique constraint
-- 5C: Profile.trainingAge non-nullable
-- 5D: Drop SubstitutionRule.score

-- =============================================================
-- 5A: Add compound indexes for common query patterns
-- =============================================================

CREATE INDEX IF NOT EXISTS "Workout_userId_scheduledDate_idx"
  ON "Workout" ("userId", "scheduledDate");

CREATE INDEX IF NOT EXISTS "Injury_userId_isActive_idx"
  ON "Injury" ("userId", "isActive");

CREATE INDEX IF NOT EXISTS "SessionCheckIn_userId_date_idx"
  ON "SessionCheckIn" ("userId", "date");

-- =============================================================
-- 5B: Make Baseline.exerciseId non-nullable
-- =============================================================

-- Step 1: Backfill exerciseId from Exercise table by name match
UPDATE "Baseline" b
SET "exerciseId" = e.id
FROM "Exercise" e
WHERE b."exerciseName" = e."name"
  AND b."exerciseId" IS NULL;

-- Step 2: Delete orphan baselines that couldn't be matched
DELETE FROM "Baseline"
WHERE "exerciseId" IS NULL;

-- Step 3: Drop old unique constraint (userId, exerciseName, context)
ALTER TABLE "Baseline"
  DROP CONSTRAINT IF EXISTS "Baseline_userId_exerciseName_context_key";

-- Step 4: Make exerciseId non-nullable
ALTER TABLE "Baseline"
  ALTER COLUMN "exerciseId" SET NOT NULL;

-- Step 5: Add new unique constraint (userId, exerciseId, context)
ALTER TABLE "Baseline"
  ADD CONSTRAINT "Baseline_userId_exerciseId_context_key"
  UNIQUE ("userId", "exerciseId", "context");

-- =============================================================
-- 5C: Make Profile.trainingAge non-nullable with default
-- =============================================================

-- Backfill null values
UPDATE "Profile"
SET "trainingAge" = 'INTERMEDIATE'
WHERE "trainingAge" IS NULL;

-- Set default and make non-nullable
ALTER TABLE "Profile"
  ALTER COLUMN "trainingAge" SET DEFAULT 'INTERMEDIATE';

ALTER TABLE "Profile"
  ALTER COLUMN "trainingAge" SET NOT NULL;

-- =============================================================
-- 5D: Drop SubstitutionRule.score, make priority non-nullable
-- =============================================================

-- Backfill null priority from score (or default 50)
UPDATE "SubstitutionRule"
SET "priority" = COALESCE("score", 50)
WHERE "priority" IS NULL;

-- Make priority non-nullable with default
ALTER TABLE "SubstitutionRule"
  ALTER COLUMN "priority" SET DEFAULT 50;

ALTER TABLE "SubstitutionRule"
  ALTER COLUMN "priority" SET NOT NULL;

-- Drop legacy score column
ALTER TABLE "SubstitutionRule"
  DROP COLUMN IF EXISTS "score";
