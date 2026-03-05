-- Engine refactor schema additions

-- New enums
DO $$ BEGIN
  CREATE TYPE "MovementPatternV2" AS ENUM (
    'HORIZONTAL_PUSH',
    'VERTICAL_PUSH',
    'HORIZONTAL_PULL',
    'VERTICAL_PULL',
    'SQUAT',
    'HINGE',
    'LUNGE',
    'CARRY',
    'ROTATION',
    'ANTI_ROTATION',
    'FLEXION',
    'EXTENSION'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SplitTag" AS ENUM (
    'PUSH',
    'PULL',
    'LEGS',
    'CORE',
    'MOBILITY',
    'PREHAB',
    'CONDITIONING'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "StimulusBias" AS ENUM (
    'MECHANICAL',
    'METABOLIC',
    'STRETCH',
    'STABILITY'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "VariationType" AS ENUM (
    'TEMPO',
    'PAUSED',
    'SINGLE_ARM',
    'SINGLE_LEG',
    'GRIP',
    'ANGLE',
    'RANGE_OF_MOTION',
    'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Constraints: available equipment
ALTER TABLE "Constraints" ADD COLUMN IF NOT EXISTS "availableEquipment" "EquipmentType"[] DEFAULT ARRAY[]::"EquipmentType"[];

-- Exercise: new fields for tags/patterns/metadata
ALTER TABLE "Exercise" ADD COLUMN IF NOT EXISTS "movementPatternsV2" "MovementPatternV2"[] DEFAULT ARRAY[]::"MovementPatternV2"[];
ALTER TABLE "Exercise" ADD COLUMN IF NOT EXISTS "splitTags" "SplitTag"[] DEFAULT ARRAY[]::"SplitTag"[];
ALTER TABLE "Exercise" ADD COLUMN IF NOT EXISTS "isMainLiftEligible" boolean NOT NULL DEFAULT false;
ALTER TABLE "Exercise" ADD COLUMN IF NOT EXISTS "isCompound" boolean NOT NULL DEFAULT false;
ALTER TABLE "Exercise" ADD COLUMN IF NOT EXISTS "fatigueCost" integer NOT NULL DEFAULT 3;
ALTER TABLE "Exercise" ADD COLUMN IF NOT EXISTS "stimulusBias" "StimulusBias"[] DEFAULT ARRAY[]::"StimulusBias"[];
ALTER TABLE "Exercise" ADD COLUMN IF NOT EXISTS "contraindications" jsonb;
ALTER TABLE "Exercise" ADD COLUMN IF NOT EXISTS "timePerSetSec" integer NOT NULL DEFAULT 120;

-- ExerciseVariation: add variation type + metadata
ALTER TABLE "ExerciseVariation" ADD COLUMN IF NOT EXISTS "variationType" "VariationType";
ALTER TABLE "ExerciseVariation" ADD COLUMN IF NOT EXISTS "metadata" jsonb;

-- ExerciseAlias table
CREATE TABLE IF NOT EXISTS "ExerciseAlias" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "exerciseId" text NOT NULL,
  "alias" text NOT NULL UNIQUE,
  CONSTRAINT "ExerciseAlias_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE
);

-- SubstitutionRule enhancements
ALTER TABLE "SubstitutionRule" ADD COLUMN IF NOT EXISTS "priority" integer;
ALTER TABLE "SubstitutionRule" ADD COLUMN IF NOT EXISTS "constraints" jsonb;
ALTER TABLE "SubstitutionRule" ADD COLUMN IF NOT EXISTS "preserves" jsonb;

-- SessionCheckIn model
CREATE TABLE IF NOT EXISTS "SessionCheckIn" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userId" text NOT NULL,
  "workoutId" text,
  "date" timestamp NOT NULL,
  "readiness" integer NOT NULL,
  "painFlags" jsonb,
  "notes" text,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "SessionCheckIn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "SessionCheckIn_workoutId_fkey" FOREIGN KEY ("workoutId") REFERENCES "Workout"("id") ON DELETE SET NULL
);

-- Backfill availableEquipment to all types for existing constraints if empty
UPDATE "Constraints"
SET "availableEquipment" = ARRAY[
  'BARBELL','DUMBBELL','MACHINE','CABLE','BODYWEIGHT','KETTLEBELL','BAND','CARDIO','SLED','BENCH','RACK','OTHER'
]::"EquipmentType"[]
WHERE "availableEquipment" = ARRAY[]::"EquipmentType"[] OR "availableEquipment" IS NULL;
