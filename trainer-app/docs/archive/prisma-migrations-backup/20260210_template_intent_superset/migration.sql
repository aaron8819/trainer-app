CREATE TYPE "TemplateIntent" AS ENUM ('FULL_BODY', 'UPPER_LOWER', 'PUSH_PULL_LEGS', 'BODY_PART', 'CUSTOM');

ALTER TABLE "WorkoutTemplate"
ADD COLUMN "intent" "TemplateIntent" NOT NULL DEFAULT 'CUSTOM';

ALTER TABLE "WorkoutTemplateExercise"
ADD COLUMN "supersetGroup" INTEGER;
