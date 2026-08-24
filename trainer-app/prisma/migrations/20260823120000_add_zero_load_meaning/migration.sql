CREATE TYPE "ZeroLoadMeaning" AS ENUM (
  'BODYWEIGHT_NO_ADDED_LOAD',
  'MACHINE_DEFAULT_NO_ADDED_LOAD'
);

ALTER TABLE "Exercise"
ADD COLUMN "zeroLoadMeaning" "ZeroLoadMeaning";

ALTER TABLE "WorkoutExercise"
ADD COLUMN "zeroLoadMeaning" "ZeroLoadMeaning";
