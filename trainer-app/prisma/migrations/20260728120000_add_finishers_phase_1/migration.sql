-- Phase 1 Finishers are an additive, owner-scoped post-workout execution seam.
CREATE TYPE "WorkoutPhasePlacement" AS ENUM ('POST_WORKOUT');
CREATE TYPE "WorkoutPhaseKind" AS ENUM ('FINISHER');
CREATE TYPE "WorkoutPhaseProtocol" AS ENUM ('TIMED_INTERVALS');
CREATE TYPE "FinisherCategory" AS ENUM ('CORE', 'CONDITIONING');
CREATE TYPE "FinisherDifficulty" AS ENUM ('EASY', 'MODERATE', 'CHALLENGING');
CREATE TYPE "FinisherDemand" AS ENUM ('LOW', 'MODERATE', 'HIGH');
CREATE TYPE "FinisherPublicationState" AS ENUM ('ACTIVE', 'RETIRED');
CREATE TYPE "FinisherExecutionState" AS ENUM ('SELECTED', 'IN_PROGRESS', 'COMPLETED', 'PARTIAL', 'DISMISSED');
CREATE TYPE "FinisherTimerSegment" AS ENUM ('PREPARATION', 'WORK', 'RECOVERY', 'FINISHED');
CREATE TYPE "FinisherStepStatus" AS ENUM ('PENDING', 'PARTIAL', 'COMPLETED', 'SKIPPED');

CREATE TABLE "FinisherRoutine" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "publicationState" "FinisherPublicationState" NOT NULL DEFAULT 'ACTIVE',
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FinisherRoutine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FinisherRoutineVersion" (
    "id" TEXT NOT NULL,
    "routineId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "FinisherCategory" NOT NULL,
    "placement" "WorkoutPhasePlacement" NOT NULL DEFAULT 'POST_WORKOUT',
    "kind" "WorkoutPhaseKind" NOT NULL DEFAULT 'FINISHER',
    "protocol" "WorkoutPhaseProtocol" NOT NULL DEFAULT 'TIMED_INTERVALS',
    "difficulty" "FinisherDifficulty" NOT NULL,
    "fatigueCost" "FinisherDemand" NOT NULL,
    "impactLevel" "FinisherDemand" NOT NULL,
    "preparationSeconds" INTEGER NOT NULL DEFAULT 10,
    "includesFinalRecovery" BOOLEAN NOT NULL DEFAULT false,
    "equipmentRequirements" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bodyRegions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "limitationTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FinisherRoutineVersion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FinisherRoutineVersion_positive_version" CHECK ("version" > 0),
    CONSTRAINT "FinisherRoutineVersion_preparation_range" CHECK ("preparationSeconds" BETWEEN 0 AND 60)
);

CREATE TABLE "FinisherRoutineStep" (
    "id" TEXT NOT NULL,
    "routineVersionId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "movementName" TEXT NOT NULL,
    "workSeconds" INTEGER NOT NULL,
    "recoverySeconds" INTEGER NOT NULL,
    "techniqueCues" TEXT[] DEFAULT ARRAY[]::TEXT[],
    CONSTRAINT "FinisherRoutineStep_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FinisherRoutineStep_order_nonnegative" CHECK ("orderIndex" >= 0),
    CONSTRAINT "FinisherRoutineStep_work_positive" CHECK ("workSeconds" > 0),
    CONSTRAINT "FinisherRoutineStep_recovery_nonnegative" CHECK ("recoverySeconds" >= 0)
);

CREATE TABLE "FinisherRoutineStepAlternative" (
    "id" TEXT NOT NULL,
    "routineStepId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "movementName" TEXT NOT NULL,
    CONSTRAINT "FinisherRoutineStepAlternative_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FinisherRoutineStepAlternative_order_nonnegative" CHECK ("orderIndex" >= 0)
);

CREATE TABLE "FinisherExecution" (
    "id" TEXT NOT NULL,
    "workoutId" TEXT NOT NULL,
    "routineVersionId" TEXT NOT NULL,
    "state" "FinisherExecutionState" NOT NULL DEFAULT 'SELECTED',
    "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "timerSegment" "FinisherTimerSegment",
    "currentStepIndex" INTEGER NOT NULL DEFAULT 0,
    "segmentStartedAt" TIMESTAMP(3),
    "segmentEndsAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "pausedRemainingMs" INTEGER,
    "preparationActiveMs" INTEGER NOT NULL DEFAULT 0,
    "recoveryActiveMs" INTEGER NOT NULL DEFAULT 0,
    "preparationPausedMs" INTEGER NOT NULL DEFAULT 0,
    "workPausedMs" INTEGER NOT NULL DEFAULT 0,
    "recoveryPausedMs" INTEGER NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "difficultyFeedback" INTEGER,
    CONSTRAINT "FinisherExecution_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FinisherExecution_step_nonnegative" CHECK ("currentStepIndex" >= 0),
    CONSTRAINT "FinisherExecution_pause_nonnegative" CHECK ("pausedRemainingMs" IS NULL OR "pausedRemainingMs" >= 0),
    CONSTRAINT "FinisherExecution_preparation_active_nonnegative" CHECK ("preparationActiveMs" >= 0),
    CONSTRAINT "FinisherExecution_recovery_active_nonnegative" CHECK ("recoveryActiveMs" >= 0),
    CONSTRAINT "FinisherExecution_preparation_pause_nonnegative" CHECK ("preparationPausedMs" >= 0),
    CONSTRAINT "FinisherExecution_work_pause_nonnegative" CHECK ("workPausedMs" >= 0),
    CONSTRAINT "FinisherExecution_recovery_pause_nonnegative" CHECK ("recoveryPausedMs" >= 0),
    CONSTRAINT "FinisherExecution_revision_positive" CHECK ("revision" > 0),
    CONSTRAINT "FinisherExecution_feedback_range" CHECK ("difficultyFeedback" IS NULL OR "difficultyFeedback" BETWEEN 1 AND 10)
);

CREATE TABLE "FinisherExecutionStep" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "routineStepId" TEXT NOT NULL,
    "performedAlternativeId" TEXT,
    "status" "FinisherStepStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "actualWorkMs" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    CONSTRAINT "FinisherExecutionStep_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FinisherExecutionStep_actual_work_nonnegative" CHECK ("actualWorkMs" >= 0)
);

CREATE UNIQUE INDEX "FinisherRoutine_code_key" ON "FinisherRoutine"("code");
CREATE UNIQUE INDEX "FinisherRoutineVersion_routineId_version_key" ON "FinisherRoutineVersion"("routineId", "version");
CREATE INDEX "FinisherRoutineVersion_category_createdAt_idx" ON "FinisherRoutineVersion"("category", "createdAt");
CREATE UNIQUE INDEX "FinisherRoutineStep_routineVersionId_orderIndex_key" ON "FinisherRoutineStep"("routineVersionId", "orderIndex");
CREATE UNIQUE INDEX "FinisherRoutineStepAlternative_routineStepId_orderIndex_key" ON "FinisherRoutineStepAlternative"("routineStepId", "orderIndex");
CREATE UNIQUE INDEX "FinisherExecution_workoutId_key" ON "FinisherExecution"("workoutId");
CREATE INDEX "FinisherExecution_routineVersionId_startedAt_idx" ON "FinisherExecution"("routineVersionId", "startedAt");
CREATE INDEX "FinisherExecution_state_segmentEndsAt_idx" ON "FinisherExecution"("state", "segmentEndsAt");
CREATE UNIQUE INDEX "FinisherExecutionStep_executionId_routineStepId_key" ON "FinisherExecutionStep"("executionId", "routineStepId");
CREATE INDEX "FinisherExecutionStep_performedAlternativeId_idx" ON "FinisherExecutionStep"("performedAlternativeId");

ALTER TABLE "FinisherRoutineVersion"
  ADD CONSTRAINT "FinisherRoutineVersion_routineId_fkey"
  FOREIGN KEY ("routineId") REFERENCES "FinisherRoutine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinisherRoutineStep"
  ADD CONSTRAINT "FinisherRoutineStep_routineVersionId_fkey"
  FOREIGN KEY ("routineVersionId") REFERENCES "FinisherRoutineVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinisherRoutineStepAlternative"
  ADD CONSTRAINT "FinisherRoutineStepAlternative_routineStepId_fkey"
  FOREIGN KEY ("routineStepId") REFERENCES "FinisherRoutineStep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinisherExecution"
  ADD CONSTRAINT "FinisherExecution_workoutId_fkey"
  FOREIGN KEY ("workoutId") REFERENCES "Workout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinisherExecution"
  ADD CONSTRAINT "FinisherExecution_routineVersionId_fkey"
  FOREIGN KEY ("routineVersionId") REFERENCES "FinisherRoutineVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinisherExecutionStep"
  ADD CONSTRAINT "FinisherExecutionStep_executionId_fkey"
  FOREIGN KEY ("executionId") REFERENCES "FinisherExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FinisherExecutionStep"
  ADD CONSTRAINT "FinisherExecutionStep_routineStepId_fkey"
  FOREIGN KEY ("routineStepId") REFERENCES "FinisherRoutineStep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinisherExecutionStep"
  ADD CONSTRAINT "FinisherExecutionStep_performedAlternativeId_fkey"
  FOREIGN KEY ("performedAlternativeId") REFERENCES "FinisherRoutineStepAlternative"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Definition versions are immutable. Publication is changed only on the stable routine row.
CREATE FUNCTION reject_finisher_definition_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'finisher routine versions are immutable';
END;
$$;

CREATE TRIGGER "FinisherRoutineVersion_immutable"
BEFORE UPDATE OR DELETE ON "FinisherRoutineVersion"
FOR EACH ROW EXECUTE FUNCTION reject_finisher_definition_mutation();
CREATE TRIGGER "FinisherRoutineStep_immutable"
BEFORE UPDATE OR DELETE ON "FinisherRoutineStep"
FOR EACH ROW EXECUTE FUNCTION reject_finisher_definition_mutation();
CREATE TRIGGER "FinisherRoutineStepAlternative_immutable"
BEFORE UPDATE OR DELETE ON "FinisherRoutineStepAlternative"
FOR EACH ROW EXECUTE FUNCTION reject_finisher_definition_mutation();
