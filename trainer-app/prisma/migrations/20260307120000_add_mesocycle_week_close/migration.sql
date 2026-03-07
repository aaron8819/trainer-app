-- CreateEnum
CREATE TYPE "MesocycleWeekCloseStatus" AS ENUM ('PENDING_OPTIONAL_GAP_FILL', 'RESOLVED');

-- CreateEnum
CREATE TYPE "MesocycleWeekCloseResolution" AS ENUM ('NO_GAP_FILL_NEEDED', 'GAP_FILL_COMPLETED', 'GAP_FILL_DISMISSED', 'AUTO_DISMISSED');

-- CreateTable
CREATE TABLE "MesocycleWeekClose" (
    "id" TEXT NOT NULL,
    "mesocycleId" TEXT NOT NULL,
    "targetWeek" INTEGER NOT NULL,
    "targetPhase" "MesocyclePhase" NOT NULL,
    "status" "MesocycleWeekCloseStatus" NOT NULL,
    "resolution" "MesocycleWeekCloseResolution",
    "optionalWorkoutId" TEXT,
    "deficitSnapshotJson" JSONB,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MesocycleWeekClose_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MesocycleWeekClose_optionalWorkoutId_key" ON "MesocycleWeekClose"("optionalWorkoutId");

-- CreateIndex
CREATE INDEX "MesocycleWeekClose_mesocycleId_status_idx" ON "MesocycleWeekClose"("mesocycleId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MesocycleWeekClose_mesocycleId_targetWeek_key" ON "MesocycleWeekClose"("mesocycleId", "targetWeek");

-- AddForeignKey
ALTER TABLE "MesocycleWeekClose" ADD CONSTRAINT "MesocycleWeekClose_mesocycleId_fkey" FOREIGN KEY ("mesocycleId") REFERENCES "Mesocycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MesocycleWeekClose" ADD CONSTRAINT "MesocycleWeekClose_optionalWorkoutId_fkey" FOREIGN KEY ("optionalWorkoutId") REFERENCES "Workout"("id") ON DELETE SET NULL ON UPDATE CASCADE;
