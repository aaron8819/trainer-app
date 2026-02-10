-- CreateEnum
CREATE TYPE "Difficulty" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED');

-- AlterEnum: add new MovementPatternV2 values
ALTER TYPE "MovementPatternV2" ADD VALUE 'ABDUCTION';
ALTER TYPE "MovementPatternV2" ADD VALUE 'ADDUCTION';
ALTER TYPE "MovementPatternV2" ADD VALUE 'ISOLATION';

-- AlterEnum: add new EquipmentType values
ALTER TYPE "EquipmentType" ADD VALUE 'EZ_BAR';
ALTER TYPE "EquipmentType" ADD VALUE 'TRAP_BAR';

-- AlterTable: add new Exercise fields
ALTER TABLE "Exercise" ADD COLUMN "difficulty" "Difficulty" NOT NULL DEFAULT 'BEGINNER';
ALTER TABLE "Exercise" ADD COLUMN "isUnilateral" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Exercise" ADD COLUMN "repRangeMin" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Exercise" ADD COLUMN "repRangeMax" INTEGER NOT NULL DEFAULT 20;
