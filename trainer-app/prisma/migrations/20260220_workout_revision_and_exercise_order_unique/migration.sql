-- Add optimistic revision support for workout rewrites
ALTER TABLE "Workout"
ADD COLUMN IF NOT EXISTS "revision" INTEGER NOT NULL DEFAULT 1;

-- Enforce deterministic exercise ordering per workout
CREATE UNIQUE INDEX IF NOT EXISTS "WorkoutExercise_workoutId_orderIndex_key"
ON "WorkoutExercise"("workoutId", "orderIndex");
