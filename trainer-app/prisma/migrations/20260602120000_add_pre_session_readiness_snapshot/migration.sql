-- CreateTable
CREATE TABLE "PreSessionReadinessSnapshot" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "activeMesocycleId" TEXT NOT NULL,
  "mesocycleState" "MesocycleState" NOT NULL,
  "weekInMeso" INTEGER NOT NULL,
  "sessionInWeek" INTEGER NOT NULL,
  "slotId" TEXT NOT NULL,
  "slotIntent" TEXT NOT NULL,
  "plannedWorkoutId" TEXT,
  "plannedWorkoutRevision" INTEGER,
  "contractVersion" INTEGER NOT NULL,
  "contractJson" JSONB NOT NULL,
  "sourceStateHash" TEXT,
  "slotPlanSeedHash" TEXT,
  "slotSequenceHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "invalidatedAt" TIMESTAMP(3),
  "invalidatedReason" TEXT,

  CONSTRAINT "PreSessionReadinessSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "psrs_user_created_idx" ON "PreSessionReadinessSnapshot"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "psrs_identity_lookup_idx" ON "PreSessionReadinessSnapshot"("userId", "activeMesocycleId", "weekInMeso", "sessionInWeek", "slotId", "contractVersion");

-- CreateIndex
CREATE INDEX "psrs_planned_workout_idx" ON "PreSessionReadinessSnapshot"("plannedWorkoutId");

-- CreateIndex
CREATE INDEX "psrs_freshness_idx" ON "PreSessionReadinessSnapshot"("userId", "invalidatedAt", "expiresAt", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "PreSessionReadinessSnapshot" ADD CONSTRAINT "PreSessionReadinessSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreSessionReadinessSnapshot" ADD CONSTRAINT "PreSessionReadinessSnapshot_activeMesocycleId_fkey" FOREIGN KEY ("activeMesocycleId") REFERENCES "Mesocycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreSessionReadinessSnapshot" ADD CONSTRAINT "PreSessionReadinessSnapshot_plannedWorkoutId_fkey" FOREIGN KEY ("plannedWorkoutId") REFERENCES "Workout"("id") ON DELETE SET NULL ON UPDATE CASCADE;
