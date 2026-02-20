-- Add index on ExerciseMuscle(muscleId) for reverse "muscle → exercises" lookups
-- (every workout generation queries exercises by muscle group)
CREATE INDEX IF NOT EXISTS "ExerciseMuscle_muscleId_idx" ON "ExerciseMuscle"("muscleId");

-- Add indexes on SubstitutionRule for forward and reverse substitution lookups
CREATE INDEX IF NOT EXISTS "SubstitutionRule_fromExerciseId_idx" ON "SubstitutionRule"("fromExerciseId");
CREATE INDEX IF NOT EXISTS "SubstitutionRule_toExerciseId_idx" ON "SubstitutionRule"("toExerciseId");

-- Remove CARDIO from EquipmentType enum (no exercises use it; dead value)
ALTER TYPE "EquipmentType" RENAME TO "EquipmentType_old";
CREATE TYPE "EquipmentType" AS ENUM (
  'BARBELL', 'DUMBBELL', 'MACHINE', 'CABLE', 'BODYWEIGHT',
  'KETTLEBELL', 'BAND', 'SLED', 'BENCH', 'RACK', 'EZ_BAR', 'TRAP_BAR', 'OTHER'
);
ALTER TABLE "Equipment" ALTER COLUMN "type" TYPE "EquipmentType" USING "type"::text::"EquipmentType";
DROP TYPE "EquipmentType_old";
