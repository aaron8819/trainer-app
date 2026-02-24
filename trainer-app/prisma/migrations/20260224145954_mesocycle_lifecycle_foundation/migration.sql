-- CreateEnum
CREATE TYPE "MesocycleState" AS ENUM ('ACTIVE_ACCUMULATION', 'ACTIVE_DELOAD', 'COMPLETED');

-- CreateEnum
CREATE TYPE "MesocyclePhase" AS ENUM ('ACCUMULATION', 'DELOAD');

-- CreateEnum
CREATE TYPE "MesocycleExerciseRoleType" AS ENUM ('CORE_COMPOUND', 'ACCESSORY');

-- AlterTable
ALTER TABLE "Mesocycle" ADD COLUMN     "accumulationSessionsCompleted" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "daysPerWeek" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "deloadSessionsCompleted" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rirBandConfig" JSONB,
ADD COLUMN     "sessionsPerWeek" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "splitType" "SplitType" NOT NULL DEFAULT 'PPL',
ADD COLUMN     "state" "MesocycleState" NOT NULL DEFAULT 'ACTIVE_ACCUMULATION',
ADD COLUMN     "volumeRampConfig" JSONB;

-- AlterTable
ALTER TABLE "Workout" ADD COLUMN     "mesoSessionSnapshot" INTEGER,
ADD COLUMN     "mesocycleId" TEXT,
ADD COLUMN     "mesocyclePhaseSnapshot" "MesocyclePhase",
ADD COLUMN     "mesocycleWeekSnapshot" INTEGER;

-- CreateTable
CREATE TABLE "MesocycleExerciseRole" (
    "id" TEXT NOT NULL,
    "mesocycleId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "sessionIntent" "WorkoutSessionIntent" NOT NULL,
    "role" "MesocycleExerciseRoleType" NOT NULL,
    "addedInWeek" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MesocycleExerciseRole_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MesocycleExerciseRole_mesocycleId_sessionIntent_idx" ON "MesocycleExerciseRole"("mesocycleId", "sessionIntent");

-- CreateIndex
CREATE INDEX "MesocycleExerciseRole_exerciseId_idx" ON "MesocycleExerciseRole"("exerciseId");

-- CreateIndex
CREATE UNIQUE INDEX "MesocycleExerciseRole_mesocycleId_exerciseId_sessionIntent_key" ON "MesocycleExerciseRole"("mesocycleId", "exerciseId", "sessionIntent");

-- CreateIndex
CREATE INDEX "Mesocycle_macroCycleId_isActive_state_idx" ON "Mesocycle"("macroCycleId", "isActive", "state");

-- CreateIndex
CREATE INDEX "Workout_mesocycleId_idx" ON "Workout"("mesocycleId");

-- AddForeignKey
ALTER TABLE "Workout" ADD CONSTRAINT "Workout_mesocycleId_fkey" FOREIGN KEY ("mesocycleId") REFERENCES "Mesocycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MesocycleExerciseRole" ADD CONSTRAINT "MesocycleExerciseRole_mesocycleId_fkey" FOREIGN KEY ("mesocycleId") REFERENCES "Mesocycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MesocycleExerciseRole" ADD CONSTRAINT "MesocycleExerciseRole_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
