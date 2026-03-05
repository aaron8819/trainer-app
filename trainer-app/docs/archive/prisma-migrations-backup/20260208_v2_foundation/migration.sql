-- Phase 1 Foundation: Add volume landmarks, SFR/length scores, template models

-- Exercise: add sfrScore and lengthPositionScore
ALTER TABLE "Exercise" ADD COLUMN IF NOT EXISTS "sfrScore" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "Exercise" ADD COLUMN IF NOT EXISTS "lengthPositionScore" INTEGER NOT NULL DEFAULT 3;

-- Exercise: make movementPattern and isMainLift nullable (deprecating)
ALTER TABLE "Exercise" ALTER COLUMN "movementPattern" DROP NOT NULL;
ALTER TABLE "Exercise" ALTER COLUMN "isMainLift" DROP NOT NULL;

-- Muscle: add volume landmark fields
ALTER TABLE "Muscle" ADD COLUMN IF NOT EXISTS "mv" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Muscle" ADD COLUMN IF NOT EXISTS "mev" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Muscle" ADD COLUMN IF NOT EXISTS "mav" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Muscle" ADD COLUMN IF NOT EXISTS "mrv" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Muscle" ADD COLUMN IF NOT EXISTS "sraHours" INTEGER NOT NULL DEFAULT 48;

-- Workout: add templateId
ALTER TABLE "Workout" ADD COLUMN IF NOT EXISTS "templateId" TEXT;

-- WorkoutTemplate model
CREATE TABLE IF NOT EXISTS "WorkoutTemplate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "targetMuscles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isStrict" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkoutTemplate_pkey" PRIMARY KEY ("id")
);

-- WorkoutTemplateExercise model
CREATE TABLE IF NOT EXISTS "WorkoutTemplateExercise" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,

    CONSTRAINT "WorkoutTemplateExercise_pkey" PRIMARY KEY ("id")
);

-- Unique constraint on template exercise ordering
DO $$ BEGIN
  ALTER TABLE "WorkoutTemplateExercise"
    ADD CONSTRAINT "WorkoutTemplateExercise_templateId_orderIndex_key"
    UNIQUE ("templateId", "orderIndex");
EXCEPTION WHEN duplicate_table THEN NULL;
         WHEN duplicate_object THEN NULL;
END $$;

-- Foreign keys
DO $$ BEGIN
  ALTER TABLE "Workout"
    ADD CONSTRAINT "Workout_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "WorkoutTemplate"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "WorkoutTemplate"
    ADD CONSTRAINT "WorkoutTemplate_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "WorkoutTemplateExercise"
    ADD CONSTRAINT "WorkoutTemplateExercise_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "WorkoutTemplate"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "WorkoutTemplateExercise"
    ADD CONSTRAINT "WorkoutTemplateExercise_exerciseId_fkey"
    FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
