DO $$
BEGIN
  ALTER TYPE "WorkoutSelectionMode" ADD VALUE 'INTENT';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TYPE "WorkoutSessionIntent" AS ENUM (
  'PUSH',
  'PULL',
  'LEGS',
  'UPPER',
  'LOWER',
  'FULL_BODY',
  'BODY_PART'
);

ALTER TABLE "Program"
  ADD COLUMN "weeklySchedule" "WorkoutSessionIntent"[] DEFAULT ARRAY[]::"WorkoutSessionIntent"[];

ALTER TABLE "Workout"
  ADD COLUMN "sessionIntent" "WorkoutSessionIntent",
  ADD COLUMN "selectionMetadata" JSONB;
