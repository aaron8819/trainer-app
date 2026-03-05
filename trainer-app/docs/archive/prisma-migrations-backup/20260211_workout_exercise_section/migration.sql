CREATE TYPE "WorkoutExerciseSection" AS ENUM ('WARMUP', 'MAIN', 'ACCESSORY');

ALTER TABLE "WorkoutExercise" ADD COLUMN "section" "WorkoutExerciseSection";
