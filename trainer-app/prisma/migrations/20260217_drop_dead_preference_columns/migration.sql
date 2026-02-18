-- Drop P3 unused preference fields
ALTER TABLE "UserPreference" DROP COLUMN IF EXISTS "rpeTargets";
ALTER TABLE "UserPreference" DROP COLUMN IF EXISTS "progressionStyle";
ALTER TABLE "UserPreference" DROP COLUMN IF EXISTS "optionalConditioning";
ALTER TABLE "UserPreference" DROP COLUMN IF EXISTS "benchFrequency";
ALTER TABLE "UserPreference" DROP COLUMN IF EXISTS "squatFrequency";
ALTER TABLE "UserPreference" DROP COLUMN IF EXISTS "deadliftFrequency";

-- Drop P4 legacy name-based exercise storage (ID-based fields are the active path)
ALTER TABLE "UserPreference" DROP COLUMN IF EXISTS "favoriteExercises";
ALTER TABLE "UserPreference" DROP COLUMN IF EXISTS "avoidExercises";
