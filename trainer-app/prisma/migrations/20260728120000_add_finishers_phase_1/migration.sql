-- Phase 1 Finishers are an additive, owner-scoped post-workout execution seam.
BEGIN;

CREATE TYPE "WorkoutPhasePlacement" AS ENUM ('POST_WORKOUT');
CREATE TYPE "WorkoutPhaseKind" AS ENUM ('FINISHER');
CREATE TYPE "WorkoutPhaseProtocol" AS ENUM ('TIMED_INTERVALS');
CREATE TYPE "FinisherCategory" AS ENUM ('CORE', 'CONDITIONING');
CREATE TYPE "FinisherDifficulty" AS ENUM ('EASY', 'MODERATE', 'CHALLENGING');
CREATE TYPE "FinisherDemand" AS ENUM ('LOW', 'MODERATE', 'HIGH');
CREATE TYPE "FinisherPublicationState" AS ENUM ('ACTIVE', 'RETIRED');
CREATE TYPE "FinisherExecutionState" AS ENUM ('SELECTED', 'IN_PROGRESS', 'COMPLETED', 'PARTIAL', 'SKIPPED', 'DISMISSED');
CREATE TYPE "FinisherTimerSegment" AS ENUM ('PREPARATION', 'WORK', 'RECOVERY', 'FINISHED');
CREATE TYPE "FinisherStepStatus" AS ENUM ('PENDING', 'PARTIAL', 'COMPLETED', 'SKIPPED');
CREATE TYPE "FinisherExecutionAction" AS ENUM ('START', 'SYNC', 'PAUSE', 'RESUME', 'SKIP', 'SUBSTITUTE', 'END', 'FEEDBACK', 'DISMISS');

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
    "equipmentRequirements" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "bodyRegions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "limitationTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sealedAt" TIMESTAMP(3),
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
    "techniqueCues" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
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

CREATE TABLE "FinisherOffer" (
    "id" TEXT NOT NULL,
    "workoutId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "offeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "declinedAt" TIMESTAMP(3),
    "declineDecisionId" TEXT,
    "recommendedRoutineVersionId" TEXT,
    "recommendationReason" TEXT,
    "recommendationUnavailableReason" TEXT,
    "recommendationContext" JSONB NOT NULL,
    "finalizedAt" TIMESTAMP(3),
    CONSTRAINT "FinisherOffer_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FinisherOffer_revision_positive" CHECK ("revision" > 0)
);

CREATE TABLE "FinisherOfferItem" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "routineVersionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "warnings" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    CONSTRAINT "FinisherOfferItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FinisherOfferItem_position_nonnegative" CHECK ("position" >= 0)
);

CREATE TABLE "FinisherExecution" (
    "id" TEXT NOT NULL,
    "workoutId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "offerRevisionAtSelection" INTEGER NOT NULL,
    "routineVersionId" TEXT NOT NULL,
    "state" "FinisherExecutionState" NOT NULL DEFAULT 'SELECTED',
    "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
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
    CONSTRAINT "FinisherExecution_offer_revision_positive" CHECK ("offerRevisionAtSelection" > 0),
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
    "routineVersionId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "performedAlternativeId" TEXT,
    "status" "FinisherStepStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "actualWorkMs" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    CONSTRAINT "FinisherExecutionStep_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FinisherExecutionStep_actual_work_nonnegative" CHECK ("actualWorkMs" >= 0)
);

CREATE TABLE "FinisherExecutionCommand" (
    "id" TEXT NOT NULL,
    "workoutId" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "action" "FinisherExecutionAction" NOT NULL,
    "requestHash" TEXT NOT NULL,
    "expectedRevision" INTEGER NOT NULL,
    "resultRevision" INTEGER NOT NULL,
    "response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "cleanedAt" TIMESTAMP(3),
    CONSTRAINT "FinisherExecutionCommand_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FinisherExecutionCommand_expected_revision_positive" CHECK ("expectedRevision" > 0),
    CONSTRAINT "FinisherExecutionCommand_result_revision_positive" CHECK ("resultRevision" > 0)
);

CREATE UNIQUE INDEX "FinisherRoutine_code_key" ON "FinisherRoutine"("code");
CREATE UNIQUE INDEX "FinisherRoutineVersion_routineId_version_key" ON "FinisherRoutineVersion"("routineId", "version");
CREATE INDEX "FinisherRoutineVersion_category_createdAt_idx" ON "FinisherRoutineVersion"("category", "createdAt");
CREATE UNIQUE INDEX "FinisherRoutineStep_routineVersionId_orderIndex_key" ON "FinisherRoutineStep"("routineVersionId", "orderIndex");
CREATE UNIQUE INDEX "FinisherRoutineStep_id_routineVersionId_orderIndex_key" ON "FinisherRoutineStep"("id", "routineVersionId", "orderIndex");
CREATE UNIQUE INDEX "FinisherRoutineStepAlternative_routineStepId_orderIndex_key" ON "FinisherRoutineStepAlternative"("routineStepId", "orderIndex");
CREATE UNIQUE INDEX "FinisherRoutineStepAlternative_id_routineStepId_key" ON "FinisherRoutineStepAlternative"("id", "routineStepId");
CREATE UNIQUE INDEX "FinisherOffer_workoutId_key" ON "FinisherOffer"("workoutId");
CREATE UNIQUE INDEX "FinisherOffer_declineDecisionId_key" ON "FinisherOffer"("declineDecisionId");
CREATE INDEX "FinisherOffer_recommendedRoutineVersionId_idx" ON "FinisherOffer"("recommendedRoutineVersionId");
CREATE UNIQUE INDEX "FinisherOfferItem_offerId_routineVersionId_key" ON "FinisherOfferItem"("offerId", "routineVersionId");
CREATE UNIQUE INDEX "FinisherOfferItem_offerId_position_key" ON "FinisherOfferItem"("offerId", "position");
CREATE INDEX "FinisherOfferItem_routineVersionId_idx" ON "FinisherOfferItem"("routineVersionId");
CREATE UNIQUE INDEX "FinisherExecution_one_active_per_workout"
  ON "FinisherExecution"("workoutId")
  WHERE "state" IN ('SELECTED', 'IN_PROGRESS');
CREATE UNIQUE INDEX "FinisherExecution_one_started_per_workout"
  ON "FinisherExecution"("workoutId")
  WHERE "startedAt" IS NOT NULL;
CREATE INDEX "FinisherExecution_workoutId_selectedAt_idx" ON "FinisherExecution"("workoutId", "selectedAt");
CREATE INDEX "FinisherExecution_offerId_selectedAt_idx" ON "FinisherExecution"("offerId", "selectedAt");
CREATE INDEX "FinisherExecution_routineVersionId_startedAt_idx" ON "FinisherExecution"("routineVersionId", "startedAt");
CREATE INDEX "FinisherExecution_state_segmentEndsAt_idx" ON "FinisherExecution"("state", "segmentEndsAt");
CREATE UNIQUE INDEX "FinisherExecution_id_workoutId_key" ON "FinisherExecution"("id", "workoutId");
CREATE UNIQUE INDEX "FinisherExecution_id_routineVersionId_key" ON "FinisherExecution"("id", "routineVersionId");
CREATE UNIQUE INDEX "FinisherExecutionStep_executionId_routineStepId_key" ON "FinisherExecutionStep"("executionId", "routineStepId");
CREATE INDEX "FinisherExecutionStep_performedAlternativeId_idx" ON "FinisherExecutionStep"("performedAlternativeId");
CREATE INDEX "FinisherExecutionCommand_executionId_createdAt_idx" ON "FinisherExecutionCommand"("executionId", "createdAt");
CREATE INDEX "FinisherExecutionCommand_cleanedAt_expiresAt_id_idx" ON "FinisherExecutionCommand"("cleanedAt", "expiresAt", "id");

ALTER TABLE "FinisherRoutineVersion"
  ADD CONSTRAINT "FinisherRoutineVersion_routineId_fkey"
  FOREIGN KEY ("routineId") REFERENCES "FinisherRoutine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinisherRoutineStep"
  ADD CONSTRAINT "FinisherRoutineStep_routineVersionId_fkey"
  FOREIGN KEY ("routineVersionId") REFERENCES "FinisherRoutineVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinisherRoutineStepAlternative"
  ADD CONSTRAINT "FinisherRoutineStepAlternative_routineStepId_fkey"
  FOREIGN KEY ("routineStepId") REFERENCES "FinisherRoutineStep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinisherOffer"
  ADD CONSTRAINT "FinisherOffer_workoutId_fkey"
  FOREIGN KEY ("workoutId") REFERENCES "Workout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinisherOffer"
  ADD CONSTRAINT "FinisherOffer_recommendedRoutineVersionId_fkey"
  FOREIGN KEY ("recommendedRoutineVersionId") REFERENCES "FinisherRoutineVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinisherOfferItem"
  ADD CONSTRAINT "FinisherOfferItem_offerId_fkey"
  FOREIGN KEY ("offerId") REFERENCES "FinisherOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinisherOfferItem"
  ADD CONSTRAINT "FinisherOfferItem_routineVersionId_fkey"
  FOREIGN KEY ("routineVersionId") REFERENCES "FinisherRoutineVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinisherExecution"
  ADD CONSTRAINT "FinisherExecution_workoutId_fkey"
  FOREIGN KEY ("workoutId") REFERENCES "Workout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinisherExecution"
  ADD CONSTRAINT "FinisherExecution_offerId_fkey"
  FOREIGN KEY ("offerId") REFERENCES "FinisherOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
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
  ADD CONSTRAINT "FinisherExecutionStep_executionId_routineVersionId_fkey"
  FOREIGN KEY ("executionId", "routineVersionId") REFERENCES "FinisherExecution"("id", "routineVersionId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinisherExecutionStep"
  ADD CONSTRAINT "FinisherExecutionStep_routineStep_binding_fkey"
  FOREIGN KEY ("routineStepId", "routineVersionId", "orderIndex") REFERENCES "FinisherRoutineStep"("id", "routineVersionId", "orderIndex") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinisherExecutionStep"
  ADD CONSTRAINT "FinisherExecutionStep_performedAlternativeId_fkey"
  FOREIGN KEY ("performedAlternativeId") REFERENCES "FinisherRoutineStepAlternative"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinisherExecutionStep"
  ADD CONSTRAINT "FinisherExecutionStep_performedAlternative_binding_fkey"
  FOREIGN KEY ("performedAlternativeId", "routineStepId") REFERENCES "FinisherRoutineStepAlternative"("id", "routineStepId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinisherExecutionCommand"
  ADD CONSTRAINT "FinisherExecutionCommand_executionId_workoutId_fkey"
  FOREIGN KEY ("executionId", "workoutId") REFERENCES "FinisherExecution"("id", "workoutId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Routine identity is immutable. Only publication state may change.
CREATE FUNCTION guard_finisher_routine_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'finisher routines with version history cannot be deleted';
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."code" IS DISTINCT FROM OLD."code"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'finisher routine identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "FinisherRoutine_identity_immutable"
BEFORE UPDATE OR DELETE ON "FinisherRoutine"
FOR EACH ROW EXECUTE FUNCTION guard_finisher_routine_identity();

-- Version construction is atomic: children may be written only before sealing,
-- and every inserted version must be sealed before its transaction commits.
CREATE FUNCTION require_finisher_routine_version_sealed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "FinisherRoutineVersion"
    WHERE "id" = NEW."id" AND "sealedAt" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'finisher routine version must be sealed before commit';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "FinisherRoutineVersion_require_sealed"
AFTER INSERT ON "FinisherRoutineVersion"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_finisher_routine_version_sealed();

CREATE FUNCTION guard_finisher_routine_version_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'finisher routine versions are immutable';
  END IF;
  IF OLD."sealedAt" IS NULL
    AND NEW."sealedAt" IS NOT NULL
    AND NEW."id" IS NOT DISTINCT FROM OLD."id"
    AND NEW."routineId" IS NOT DISTINCT FROM OLD."routineId"
    AND NEW."version" IS NOT DISTINCT FROM OLD."version"
    AND NEW."name" IS NOT DISTINCT FROM OLD."name"
    AND NEW."description" IS NOT DISTINCT FROM OLD."description"
    AND NEW."category" IS NOT DISTINCT FROM OLD."category"
    AND NEW."placement" IS NOT DISTINCT FROM OLD."placement"
    AND NEW."kind" IS NOT DISTINCT FROM OLD."kind"
    AND NEW."protocol" IS NOT DISTINCT FROM OLD."protocol"
    AND NEW."difficulty" IS NOT DISTINCT FROM OLD."difficulty"
    AND NEW."fatigueCost" IS NOT DISTINCT FROM OLD."fatigueCost"
    AND NEW."impactLevel" IS NOT DISTINCT FROM OLD."impactLevel"
    AND NEW."preparationSeconds" IS NOT DISTINCT FROM OLD."preparationSeconds"
    AND NEW."includesFinalRecovery" IS NOT DISTINCT FROM OLD."includesFinalRecovery"
    AND NEW."equipmentRequirements" IS NOT DISTINCT FROM OLD."equipmentRequirements"
    AND NEW."bodyRegions" IS NOT DISTINCT FROM OLD."bodyRegions"
    AND NEW."limitationTags" IS NOT DISTINCT FROM OLD."limitationTags"
    AND NEW."createdAt" IS NOT DISTINCT FROM OLD."createdAt" THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'finisher routine versions are immutable';
END;
$$;

CREATE TRIGGER "FinisherRoutineVersion_immutable"
BEFORE UPDATE OR DELETE ON "FinisherRoutineVersion"
FOR EACH ROW EXECUTE FUNCTION guard_finisher_routine_version_mutation();

CREATE FUNCTION guard_finisher_routine_child_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  old_version_id TEXT;
  new_version_id TEXT;
BEGIN
  IF TG_TABLE_NAME = 'FinisherRoutineStep' THEN
    old_version_id := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD."routineVersionId" END;
    new_version_id := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW."routineVersionId" END;
  ELSE
    IF TG_OP <> 'INSERT' THEN
      SELECT "routineVersionId" INTO old_version_id
      FROM "FinisherRoutineStep" WHERE "id" = OLD."routineStepId";
    END IF;
    IF TG_OP <> 'DELETE' THEN
      SELECT "routineVersionId" INTO new_version_id
      FROM "FinisherRoutineStep" WHERE "id" = NEW."routineStepId";
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM "FinisherRoutineVersion"
    WHERE "id" IN (old_version_id, new_version_id) AND "sealedAt" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'sealed finisher routine version children are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "FinisherRoutineStep_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "FinisherRoutineStep"
FOR EACH ROW EXECUTE FUNCTION guard_finisher_routine_child_mutation();
CREATE TRIGGER "FinisherRoutineStepAlternative_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "FinisherRoutineStepAlternative"
FOR EACH ROW EXECUTE FUNCTION guard_finisher_routine_child_mutation();

-- Offers and executions are constructed transactionally and must be sealed with
-- their complete child sets before they can commit.
CREATE FUNCTION require_finisher_offer_finalized() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "FinisherOffer"
    WHERE "id" = NEW."id" AND "finalizedAt" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'finisher offer must be finalized before commit';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "FinisherOffer_require_finalized"
AFTER INSERT ON "FinisherOffer"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_finisher_offer_finalized();

CREATE FUNCTION require_finisher_execution_finalized() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "FinisherExecution"
    WHERE "id" = NEW."id" AND "finalizedAt" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'finisher execution must be finalized before commit';
  END IF;

  IF EXISTS (
    SELECT s."id", s."orderIndex"
    FROM "FinisherRoutineStep" s
    JOIN "FinisherExecution" e ON e."id" = NEW."id"
    WHERE s."routineVersionId" = e."routineVersionId"
    EXCEPT
    SELECT es."routineStepId", es."orderIndex"
    FROM "FinisherExecutionStep" es
    WHERE es."executionId" = NEW."id"
  ) OR EXISTS (
    SELECT es."routineStepId", es."orderIndex"
    FROM "FinisherExecutionStep" es
    WHERE es."executionId" = NEW."id"
    EXCEPT
    SELECT s."id", s."orderIndex"
    FROM "FinisherRoutineStep" s
    JOIN "FinisherExecution" e ON e."id" = NEW."id"
    WHERE s."routineVersionId" = e."routineVersionId"
  ) THEN
    RAISE EXCEPTION 'finisher execution prescribed step set is incomplete or inconsistent';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "FinisherExecution_require_finalized"
AFTER INSERT ON "FinisherExecution"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_finisher_execution_finalized();

CREATE FUNCTION guard_finisher_offer_item_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "FinisherOffer"
    WHERE "id" = NEW."offerId" AND "finalizedAt" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'finalized finisher offer items are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION guard_finisher_execution_step_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "FinisherExecution"
    WHERE "id" = NEW."executionId" AND "finalizedAt" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'finalized finisher execution step set is immutable';
  END IF;
  RETURN NEW;
END;
$$;

-- Lifecycle rows may advance, but their ownership and definition bindings do not.
CREATE FUNCTION guard_finisher_offer_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."workoutId" IS DISTINCT FROM OLD."workoutId"
    OR NEW."offeredAt" IS DISTINCT FROM OLD."offeredAt"
    OR NEW."recommendedRoutineVersionId" IS DISTINCT FROM OLD."recommendedRoutineVersionId"
    OR NEW."recommendationReason" IS DISTINCT FROM OLD."recommendationReason"
    OR NEW."recommendationUnavailableReason" IS DISTINCT FROM OLD."recommendationUnavailableReason"
    OR NEW."recommendationContext" IS DISTINCT FROM OLD."recommendationContext"
    OR NEW."finalizedAt" IS NULL
    OR (
      OLD."finalizedAt" IS NOT NULL
      AND NEW."finalizedAt" IS DISTINCT FROM OLD."finalizedAt"
    )
  THEN
    RAISE EXCEPTION 'finisher offer identity and definition binding are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION reject_finisher_offer_item_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'finisher offer items are immutable';
END;
$$;

CREATE FUNCTION guard_finisher_execution_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."workoutId" IS DISTINCT FROM OLD."workoutId"
    OR NEW."offerId" IS DISTINCT FROM OLD."offerId"
    OR NEW."offerRevisionAtSelection" IS DISTINCT FROM OLD."offerRevisionAtSelection"
    OR NEW."routineVersionId" IS DISTINCT FROM OLD."routineVersionId"
    OR NEW."selectedAt" IS DISTINCT FROM OLD."selectedAt"
    OR NEW."finalizedAt" IS NULL
    OR (
      OLD."finalizedAt" IS NOT NULL
      AND NEW."finalizedAt" IS DISTINCT FROM OLD."finalizedAt"
    )
  THEN
    RAISE EXCEPTION 'finisher execution identity and definition binding are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION guard_finisher_execution_step_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."executionId" IS DISTINCT FROM OLD."executionId"
    OR NEW."routineStepId" IS DISTINCT FROM OLD."routineStepId"
    OR NEW."routineVersionId" IS DISTINCT FROM OLD."routineVersionId"
    OR NEW."orderIndex" IS DISTINCT FROM OLD."orderIndex"
  THEN
    RAISE EXCEPTION 'finisher execution step identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "FinisherOffer_identity_immutable"
BEFORE UPDATE ON "FinisherOffer"
FOR EACH ROW EXECUTE FUNCTION guard_finisher_offer_identity();
CREATE TRIGGER "FinisherOfferItem_immutable"
BEFORE UPDATE ON "FinisherOfferItem"
FOR EACH ROW EXECUTE FUNCTION reject_finisher_offer_item_update();
CREATE TRIGGER "FinisherOfferItem_insert_before_finalization"
BEFORE INSERT ON "FinisherOfferItem"
FOR EACH ROW EXECUTE FUNCTION guard_finisher_offer_item_insert();
CREATE TRIGGER "FinisherExecution_identity_immutable"
BEFORE UPDATE ON "FinisherExecution"
FOR EACH ROW EXECUTE FUNCTION guard_finisher_execution_identity();
CREATE TRIGGER "FinisherExecutionStep_identity_immutable"
BEFORE UPDATE ON "FinisherExecutionStep"
FOR EACH ROW EXECUTE FUNCTION guard_finisher_execution_step_identity();
CREATE TRIGGER "FinisherExecutionStep_insert_before_finalization"
BEFORE INSERT ON "FinisherExecutionStep"
FOR EACH ROW EXECUTE FUNCTION guard_finisher_execution_step_insert();

-- Lifecycle evidence may transition, but it is never deleted or replaced.
CREATE FUNCTION reject_finisher_history_deletion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'finisher lifecycle history cannot be deleted';
END;
$$;

CREATE TRIGGER "FinisherOffer_no_delete"
BEFORE DELETE ON "FinisherOffer"
FOR EACH ROW EXECUTE FUNCTION reject_finisher_history_deletion();
CREATE TRIGGER "FinisherOfferItem_no_delete"
BEFORE DELETE ON "FinisherOfferItem"
FOR EACH ROW EXECUTE FUNCTION reject_finisher_history_deletion();
CREATE TRIGGER "FinisherExecution_no_delete"
BEFORE DELETE ON "FinisherExecution"
FOR EACH ROW EXECUTE FUNCTION reject_finisher_history_deletion();
CREATE TRIGGER "FinisherExecutionStep_no_delete"
BEFORE DELETE ON "FinisherExecutionStep"
FOR EACH ROW EXECUTE FUNCTION reject_finisher_history_deletion();

-- BEGIN GENERATED FINISHER CATALOG

INSERT INTO "FinisherRoutine" ("id", "code") VALUES ('823708ba-e570-53b2-8133-c3e3067250c5', 'core-stability-10');

INSERT INTO "FinisherRoutineVersion" (
  "id", "routineId", "version", "name", "description", "category",
  "placement", "kind", "protocol", "difficulty", "fatigueCost",
  "impactLevel", "preparationSeconds", "includesFinalRecovery",
  "equipmentRequirements", "bodyRegions", "limitationTags"
) VALUES (
  '3ccf6228-354a-5ef9-83a0-9152d36568f5', '823708ba-e570-53b2-8133-c3e3067250c5', 1,
  'Core Stability 10', 'Ten controlled core movements using steady 40-second work intervals.', 'CORE'::"FinisherCategory",
  'POST_WORKOUT', 'FINISHER', 'TIMED_INTERVALS', 'MODERATE'::"FinisherDifficulty",
  'MODERATE'::"FinisherDemand", 'LOW'::"FinisherDemand",
  10, true,
  ARRAY['BODYWEIGHT', 'CABLE', 'HANGING_BAR']::TEXT[],
  ARRAY['core', 'shoulders', 'hips']::TEXT[],
  ARRAY['shoulder', 'wrist', 'lower_back']::TEXT[]
);

INSERT INTO "FinisherRoutineStep" (
  "id", "routineVersionId", "orderIndex", "movementName",
  "workSeconds", "recoverySeconds", "techniqueCues"
) VALUES (
  'ace4ca35-8b81-59b5-8758-3870ddf6ee74', '3ccf6228-354a-5ef9-83a0-9152d36568f5', 0, 'Dead Bug',
  40, 20, ARRAY['Slow and controlled.', 'Keep the lower back pressed into the floor.']::TEXT[]
);

INSERT INTO "FinisherRoutineStep" (
  "id", "routineVersionId", "orderIndex", "movementName",
  "workSeconds", "recoverySeconds", "techniqueCues"
) VALUES (
  '59a4061c-8811-5f44-84e4-b83d3eea972d', '3ccf6228-354a-5ef9-83a0-9152d36568f5', 1, 'Front Plank',
  40, 20, ARRAY['Brace the abs and squeeze the glutes.', 'Do not let the hips sag.']::TEXT[]
);

INSERT INTO "FinisherRoutineStep" (
  "id", "routineVersionId", "orderIndex", "movementName",
  "workSeconds", "recoverySeconds", "techniqueCues"
) VALUES (
  'a9024bc0-5c38-5723-89c1-45a6c4f9e3fb', '3ccf6228-354a-5ef9-83a0-9152d36568f5', 2, 'Hanging Knee Raise',
  40, 20, ARRAY['Posteriorly tilt the pelvis at the top.', 'Avoid swinging.']::TEXT[]
);

INSERT INTO "FinisherRoutineStepAlternative" (
  "id", "routineStepId", "orderIndex", "movementName"
) VALUES (
  '465610f1-32d2-5807-8ec9-f1eabbb56b50',
  'a9024bc0-5c38-5723-89c1-45a6c4f9e3fb', 0, 'Captain''s Chair Knee Raise'
);

INSERT INTO "FinisherRoutineStep" (
  "id", "routineVersionId", "orderIndex", "movementName",
  "workSeconds", "recoverySeconds", "techniqueCues"
) VALUES (
  'febe7521-bb7e-5a95-8acc-0ffa8c1a1a2e', '3ccf6228-354a-5ef9-83a0-9152d36568f5', 3, 'Side Plank — Left',
  40, 20, ARRAY['Stack the shoulders and hips, brace the core, and keep the hips lifted.', 'Maintain a straight line without rotating.']::TEXT[]
);

INSERT INTO "FinisherRoutineStep" (
  "id", "routineVersionId", "orderIndex", "movementName",
  "workSeconds", "recoverySeconds", "techniqueCues"
) VALUES (
  '5aaa9640-739e-5a79-8f8d-96867e741057', '3ccf6228-354a-5ef9-83a0-9152d36568f5', 4, 'Side Plank — Right',
  40, 20, ARRAY['Stack the shoulders and hips, brace the core, and keep the hips lifted.', 'Maintain a straight line without rotating.']::TEXT[]
);

INSERT INTO "FinisherRoutineStep" (
  "id", "routineVersionId", "orderIndex", "movementName",
  "workSeconds", "recoverySeconds", "techniqueCues"
) VALUES (
  '5d1ae9c0-1e9c-5995-8f5d-8d694a9070aa', '3ccf6228-354a-5ef9-83a0-9152d36568f5', 5, 'Reverse Crunch',
  40, 20, ARRAY['Lift the hips off the floor.', 'Curl the pelvis upward instead of swinging the legs.']::TEXT[]
);

INSERT INTO "FinisherRoutineStep" (
  "id", "routineVersionId", "orderIndex", "movementName",
  "workSeconds", "recoverySeconds", "techniqueCues"
) VALUES (
  'd57f7384-34cc-551a-81fa-02a7bd14714f', '3ccf6228-354a-5ef9-83a0-9152d36568f5', 6, 'Cable Crunch',
  40, 20, ARRAY['Use controlled repetitions.', 'Exhale hard at the bottom.']::TEXT[]
);

INSERT INTO "FinisherRoutineStepAlternative" (
  "id", "routineStepId", "orderIndex", "movementName"
) VALUES (
  'efe8d454-cdea-5fdd-803e-1139f3021094',
  'd57f7384-34cc-551a-81fa-02a7bd14714f', 0, 'Weighted Crunch'
);

INSERT INTO "FinisherRoutineStep" (
  "id", "routineVersionId", "orderIndex", "movementName",
  "workSeconds", "recoverySeconds", "techniqueCues"
) VALUES (
  '5f1d4581-06f0-5765-87bf-ef8a0a7a1a0c', '3ccf6228-354a-5ef9-83a0-9152d36568f5', 7, 'Bird Dog',
  40, 20, ARRAY['Use slow, controlled reaches.', 'Resist torso rotation.']::TEXT[]
);

INSERT INTO "FinisherRoutineStep" (
  "id", "routineVersionId", "orderIndex", "movementName",
  "workSeconds", "recoverySeconds", "techniqueCues"
) VALUES (
  '89d519e8-b648-5490-8b53-b317857d43a3', '3ccf6228-354a-5ef9-83a0-9152d36568f5', 8, 'Hollow Body Hold',
  40, 20, ARRAY['Bend the knees if needed to keep the lower back flat.']::TEXT[]
);

INSERT INTO "FinisherRoutineStep" (
  "id", "routineVersionId", "orderIndex", "movementName",
  "workSeconds", "recoverySeconds", "techniqueCues"
) VALUES (
  '2147e0be-14fd-5873-8534-f68a72a58137', '3ccf6228-354a-5ef9-83a0-9152d36568f5', 9, 'Mountain Climbers',
  40, 20, ARRAY['Move quickly but under control.', 'Keep the hips level.']::TEXT[]
);

UPDATE "FinisherRoutineVersion" SET "sealedAt" = CURRENT_TIMESTAMP WHERE "id" = '3ccf6228-354a-5ef9-83a0-9152d36568f5';

INSERT INTO "FinisherRoutine" ("id", "code") VALUES ('1798edca-6f64-5378-8753-7014be6b9015', 'core-control-8');

INSERT INTO "FinisherRoutineVersion" (
  "id", "routineId", "version", "name", "description", "category",
  "placement", "kind", "protocol", "difficulty", "fatigueCost",
  "impactLevel", "preparationSeconds", "includesFinalRecovery",
  "equipmentRequirements", "bodyRegions", "limitationTags"
) VALUES (
  'fc2adf8c-3fd8-5796-81ff-1b949272f917', '1798edca-6f64-5378-8753-7014be6b9015', 1,
  'Core Control 8', 'An eight-minute low-impact sequence focused on bracing and resisting rotation.', 'CORE'::"FinisherCategory",
  'POST_WORKOUT', 'FINISHER', 'TIMED_INTERVALS', 'EASY'::"FinisherDifficulty",
  'LOW'::"FinisherDemand", 'LOW'::"FinisherDemand",
  10, true,
  ARRAY['BODYWEIGHT', 'BAND']::TEXT[],
  ARRAY['core', 'shoulders']::TEXT[],
  ARRAY['shoulder', 'wrist', 'lower_back']::TEXT[]
);

INSERT INTO "FinisherRoutineStep" (
  "id", "routineVersionId", "orderIndex", "movementName",
  "workSeconds", "recoverySeconds", "techniqueCues"
) VALUES (
  '252890c7-bf7c-547f-87c3-b1fcff8af811', 'fc2adf8c-3fd8-5796-81ff-1b949272f917', 0, 'Heel Tap Dead Bug',
  40, 20, ARRAY[]::TEXT[]
);

INSERT INTO "FinisherRoutineStep" (
  "id", "routineVersionId", "orderIndex", "movementName",
  "workSeconds", "recoverySeconds", "techniqueCues"
) VALUES (
  '07275427-0a47-5329-82f3-25fce4a89647', 'fc2adf8c-3fd8-5796-81ff-1b949272f917', 1, 'Bear Plank Hold',
  40, 20, ARRAY[]::TEXT[]
);

INSERT INTO "FinisherRoutineStepAlternative" (
  "id", "routineStepId", "orderIndex", "movementName"
) VALUES (
  'b78c3374-50c2-51e6-88ea-a45edd2fd6bd',
  '07275427-0a47-5329-82f3-25fce4a89647', 0, 'Forearm Plank Hold'
);

INSERT INTO "FinisherRoutineStep" (
  "id", "routineVersionId", "orderIndex", "movementName",
  "workSeconds", "recoverySeconds", "techniqueCues"
) VALUES (
  '52e2a588-de4d-56b3-87ee-1d71a99638d2', 'fc2adf8c-3fd8-5796-81ff-1b949272f917', 2, 'Bird Dog — Left Lead',
  40, 20, ARRAY[]::TEXT[]
);

INSERT INTO "FinisherRoutineStep" (
  "id", "routineVersionId", "orderIndex", "movementName",
  "workSeconds", "recoverySeconds", "techniqueCues"
) VALUES (
  '601b06c5-0d36-54fc-8798-d468a4386a8b', 'fc2adf8c-3fd8-5796-81ff-1b949272f917', 3, 'Bird Dog — Right Lead',
  40, 20, ARRAY[]::TEXT[]
);

INSERT INTO "FinisherRoutineStep" (
  "id", "routineVersionId", "orderIndex", "movementName",
  "workSeconds", "recoverySeconds", "techniqueCues"
) VALUES (
  '3c37c9b5-7952-5db0-8567-3957f3b40b5f', 'fc2adf8c-3fd8-5796-81ff-1b949272f917', 4, 'Side Plank from Knees — Left',
  40, 20, ARRAY[]::TEXT[]
);

INSERT INTO "FinisherRoutineStep" (
  "id", "routineVersionId", "orderIndex", "movementName",
  "workSeconds", "recoverySeconds", "techniqueCues"
) VALUES (
  'ddd92b10-a582-5da5-864c-216293729bea', 'fc2adf8c-3fd8-5796-81ff-1b949272f917', 5, 'Side Plank from Knees — Right',
  40, 20, ARRAY[]::TEXT[]
);

INSERT INTO "FinisherRoutineStep" (
  "id", "routineVersionId", "orderIndex", "movementName",
  "workSeconds", "recoverySeconds", "techniqueCues"
) VALUES (
  '4f0190cf-4879-5f98-89e9-b8ae7ef1cfad', 'fc2adf8c-3fd8-5796-81ff-1b949272f917', 6, 'Band Pallof Press — Left',
  40, 20, ARRAY[]::TEXT[]
);

INSERT INTO "FinisherRoutineStepAlternative" (
  "id", "routineStepId", "orderIndex", "movementName"
) VALUES (
  '08200d9f-f462-516c-8f63-907a60320778',
  '4f0190cf-4879-5f98-89e9-b8ae7ef1cfad', 0, 'Tall-Kneeling Brace Hold'
);

INSERT INTO "FinisherRoutineStep" (
  "id", "routineVersionId", "orderIndex", "movementName",
  "workSeconds", "recoverySeconds", "techniqueCues"
) VALUES (
  '280cb31b-ba1d-5c45-801b-21e20ece690a', 'fc2adf8c-3fd8-5796-81ff-1b949272f917', 7, 'Band Pallof Press — Right',
  40, 20, ARRAY[]::TEXT[]
);

INSERT INTO "FinisherRoutineStepAlternative" (
  "id", "routineStepId", "orderIndex", "movementName"
) VALUES (
  '530dffc6-d1d0-5eb9-8987-a5c511911260',
  '280cb31b-ba1d-5c45-801b-21e20ece690a', 0, 'Tall-Kneeling Brace Hold'
);

UPDATE "FinisherRoutineVersion" SET "sealedAt" = CURRENT_TIMESTAMP WHERE "id" = 'fc2adf8c-3fd8-5796-81ff-1b949272f917';

INSERT INTO "FinisherRoutine" ("id", "code") VALUES ('f57d635d-40ab-55ae-828d-0b8ab761e7bb', 'low-impact-conditioning-8');

INSERT INTO "FinisherRoutineVersion" (
  "id", "routineId", "version", "name", "description", "category",
  "placement", "kind", "protocol", "difficulty", "fatigueCost",
  "impactLevel", "preparationSeconds", "includesFinalRecovery",
  "equipmentRequirements", "bodyRegions", "limitationTags"
) VALUES (
  '63a46f35-f67d-5f85-8667-6c35bad911da', 'f57d635d-40ab-55ae-828d-0b8ab761e7bb', 1,
  'Low-Impact Conditioning 8', 'Eight minutes of continuous, joint-conscious bodyweight conditioning.', 'CONDITIONING'::"FinisherCategory",
  'POST_WORKOUT', 'FINISHER', 'TIMED_INTERVALS', 'EASY'::"FinisherDifficulty",
  'LOW'::"FinisherDemand", 'LOW'::"FinisherDemand",
  10, true,
  ARRAY['BODYWEIGHT']::TEXT[],
  ARRAY['full_body', 'legs']::TEXT[],
  ARRAY['knee', 'hip', 'ankle']::TEXT[]
);

INSERT INTO "FinisherRoutineStep" (
  "id", "routineVersionId", "orderIndex", "movementName",
  "workSeconds", "recoverySeconds", "techniqueCues"
) VALUES (
  'eaa9d7f0-d62d-54e6-8f83-848bc6e8899c', '63a46f35-f67d-5f85-8667-6c35bad911da', 0, 'Fast March in Place',
  40, 20, ARRAY[]::TEXT[]
);

INSERT INTO "FinisherRoutineStep" (
  "id", "routineVersionId", "orderIndex", "movementName",
  "workSeconds", "recoverySeconds", "techniqueCues"
) VALUES (
  '0666d768-a44d-561f-8d8e-eafc64ac022a', '63a46f35-f67d-5f85-8667-6c35bad911da', 1, 'Step Jack',
  40, 20, ARRAY[]::TEXT[]
);

INSERT INTO "FinisherRoutineStep" (
  "id", "routineVersionId", "orderIndex", "movementName",
  "workSeconds", "recoverySeconds", "techniqueCues"
) VALUES (
  'f149107f-496a-5b58-8b6f-87abf12b8bc8', '63a46f35-f67d-5f85-8667-6c35bad911da', 2, 'Alternating Knee Drive',
  40, 20, ARRAY[]::TEXT[]
);

INSERT INTO "FinisherRoutineStep" (
  "id", "routineVersionId", "orderIndex", "movementName",
  "workSeconds", "recoverySeconds", "techniqueCues"
) VALUES (
  '56acb113-3ae4-586c-8c80-37d8a37f86a4', '63a46f35-f67d-5f85-8667-6c35bad911da', 3, 'Lateral Step and Reach',
  40, 20, ARRAY[]::TEXT[]
);

INSERT INTO "FinisherRoutineStep" (
  "id", "routineVersionId", "orderIndex", "movementName",
  "workSeconds", "recoverySeconds", "techniqueCues"
) VALUES (
  '3650bbff-f4d6-5b84-896e-703c6bf57495', '63a46f35-f67d-5f85-8667-6c35bad911da', 4, 'Boxer Step',
  40, 20, ARRAY[]::TEXT[]
);

INSERT INTO "FinisherRoutineStep" (
  "id", "routineVersionId", "orderIndex", "movementName",
  "workSeconds", "recoverySeconds", "techniqueCues"
) VALUES (
  '84f0c49c-6ce9-5c0f-890f-232f501d0b03', '63a46f35-f67d-5f85-8667-6c35bad911da', 5, 'Alternating Reverse Step',
  40, 20, ARRAY[]::TEXT[]
);

INSERT INTO "FinisherRoutineStep" (
  "id", "routineVersionId", "orderIndex", "movementName",
  "workSeconds", "recoverySeconds", "techniqueCues"
) VALUES (
  '4c3f01f2-e04f-56e4-8099-207ed61384d4', '63a46f35-f67d-5f85-8667-6c35bad911da', 6, 'Standing Cross-Body Crunch',
  40, 20, ARRAY[]::TEXT[]
);

INSERT INTO "FinisherRoutineStep" (
  "id", "routineVersionId", "orderIndex", "movementName",
  "workSeconds", "recoverySeconds", "techniqueCues"
) VALUES (
  'b89c0158-9984-5b40-8d3f-39275ffa6f81', '63a46f35-f67d-5f85-8667-6c35bad911da', 7, 'Fast March with Arm Drive',
  40, 20, ARRAY[]::TEXT[]
);

UPDATE "FinisherRoutineVersion" SET "sealedAt" = CURRENT_TIMESTAMP WHERE "id" = '63a46f35-f67d-5f85-8667-6c35bad911da';

INSERT INTO "FinisherRoutine" ("id", "code") VALUES ('1817c460-1019-5048-8f57-f91fd6e8acb7', 'bodyweight-conditioning-6');

INSERT INTO "FinisherRoutineVersion" (
  "id", "routineId", "version", "name", "description", "category",
  "placement", "kind", "protocol", "difficulty", "fatigueCost",
  "impactLevel", "preparationSeconds", "includesFinalRecovery",
  "equipmentRequirements", "bodyRegions", "limitationTags"
) VALUES (
  '822af54d-ab7b-55fe-8946-794636b1eb22', '1817c460-1019-5048-8f57-f91fd6e8acb7', 1,
  'Bodyweight Conditioning 6', 'A short, higher-impact conditioning sequence for days with room for extra leg demand.', 'CONDITIONING'::"FinisherCategory",
  'POST_WORKOUT', 'FINISHER', 'TIMED_INTERVALS', 'CHALLENGING'::"FinisherDifficulty",
  'HIGH'::"FinisherDemand", 'HIGH'::"FinisherDemand",
  10, true,
  ARRAY['BODYWEIGHT']::TEXT[],
  ARRAY['full_body', 'legs']::TEXT[],
  ARRAY['knee', 'hip', 'ankle', 'shoulder', 'wrist']::TEXT[]
);

INSERT INTO "FinisherRoutineStep" (
  "id", "routineVersionId", "orderIndex", "movementName",
  "workSeconds", "recoverySeconds", "techniqueCues"
) VALUES (
  '12fc19a1-66ee-5fbc-8fa1-3694b89464d1', '822af54d-ab7b-55fe-8946-794636b1eb22', 0, 'Jumping Jack',
  40, 20, ARRAY[]::TEXT[]
);

INSERT INTO "FinisherRoutineStepAlternative" (
  "id", "routineStepId", "orderIndex", "movementName"
) VALUES (
  '0054ecde-d395-5419-885d-1c7750863ef0',
  '12fc19a1-66ee-5fbc-8fa1-3694b89464d1', 0, 'Step Jack'
);

INSERT INTO "FinisherRoutineStep" (
  "id", "routineVersionId", "orderIndex", "movementName",
  "workSeconds", "recoverySeconds", "techniqueCues"
) VALUES (
  '4dc22555-3e5b-546f-83c7-4085679bf8e8', '822af54d-ab7b-55fe-8946-794636b1eb22', 1, 'Squat Thrust',
  40, 20, ARRAY[]::TEXT[]
);

INSERT INTO "FinisherRoutineStepAlternative" (
  "id", "routineStepId", "orderIndex", "movementName"
) VALUES (
  'fc98d94a-541f-5f6d-8095-4956a6478d87',
  '4dc22555-3e5b-546f-83c7-4085679bf8e8', 0, 'Hands-Elevated Squat Thrust'
);

INSERT INTO "FinisherRoutineStep" (
  "id", "routineVersionId", "orderIndex", "movementName",
  "workSeconds", "recoverySeconds", "techniqueCues"
) VALUES (
  '0020cc61-d1ac-5ca2-8cea-e87d680ad48c', '822af54d-ab7b-55fe-8946-794636b1eb22', 2, 'Skater Step',
  40, 20, ARRAY[]::TEXT[]
);

INSERT INTO "FinisherRoutineStep" (
  "id", "routineVersionId", "orderIndex", "movementName",
  "workSeconds", "recoverySeconds", "techniqueCues"
) VALUES (
  '416f3b9d-8447-5576-84bc-b96fc2aa91e9', '822af54d-ab7b-55fe-8946-794636b1eb22', 3, 'High Knees',
  40, 20, ARRAY[]::TEXT[]
);

INSERT INTO "FinisherRoutineStepAlternative" (
  "id", "routineStepId", "orderIndex", "movementName"
) VALUES (
  '61a5cca2-c5e9-5c54-85b7-223fd69922d4',
  '416f3b9d-8447-5576-84bc-b96fc2aa91e9', 0, 'Fast March'
);

INSERT INTO "FinisherRoutineStep" (
  "id", "routineVersionId", "orderIndex", "movementName",
  "workSeconds", "recoverySeconds", "techniqueCues"
) VALUES (
  '0f2a2705-e2ec-5e4f-8592-b19ebaa70176', '822af54d-ab7b-55fe-8946-794636b1eb22', 4, 'Mountain Climbers',
  40, 20, ARRAY[]::TEXT[]
);

INSERT INTO "FinisherRoutineStepAlternative" (
  "id", "routineStepId", "orderIndex", "movementName"
) VALUES (
  '74d55505-79c4-5750-8fbc-87cb43d94870',
  '0f2a2705-e2ec-5e4f-8592-b19ebaa70176', 0, 'Incline Mountain Climbers'
);

INSERT INTO "FinisherRoutineStep" (
  "id", "routineVersionId", "orderIndex", "movementName",
  "workSeconds", "recoverySeconds", "techniqueCues"
) VALUES (
  '0f375e84-968a-5154-8a58-aa9f64c8b824', '822af54d-ab7b-55fe-8946-794636b1eb22', 5, 'Quick Feet',
  40, 20, ARRAY[]::TEXT[]
);

UPDATE "FinisherRoutineVersion" SET "sealedAt" = CURRENT_TIMESTAMP WHERE "id" = '822af54d-ab7b-55fe-8946-794636b1eb22';

-- END GENERATED FINISHER CATALOG

COMMIT;
