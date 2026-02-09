-- Phase 4 Schema Cleanup: drop movementPattern (V1), rename movementPatternsV2, drop isMainLift from Exercise

-- Drop V1 movementPattern from Exercise and WorkoutExercise
ALTER TABLE "Exercise" DROP COLUMN IF EXISTS "movementPattern";
ALTER TABLE "WorkoutExercise" DROP COLUMN IF EXISTS "movementPattern";

-- Rename movementPatternsV2 -> movementPatterns on both tables
ALTER TABLE "Exercise" RENAME COLUMN "movementPatternsV2" TO "movementPatterns";
ALTER TABLE "WorkoutExercise" RENAME COLUMN "movementPatternsV2" TO "movementPatterns";

-- Drop isMainLift from Exercise (keep on WorkoutExercise)
ALTER TABLE "Exercise" DROP COLUMN IF EXISTS "isMainLift";

-- Drop the V1 enum type
DROP TYPE IF EXISTS "MovementPattern";
