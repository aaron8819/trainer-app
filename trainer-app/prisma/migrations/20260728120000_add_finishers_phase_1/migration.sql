-- Phase 1 Finishers are an additive, owner-scoped post-workout execution seam.
BEGIN;

DO $$
DECLARE
  runtime_role pg_catalog.pg_roles%ROWTYPE;
  owner_role pg_catalog.pg_roles%ROWTYPE;
  cleanup_role pg_catalog.pg_roles%ROWTYPE;
  executor_role pg_catalog.pg_roles%ROWTYPE;
  protected_membership_count integer;
  automatic_membership_count integer;
  temporary_membership_count integer;
  default_privilege_count integer;
  preexisting_object_count integer;
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer < 160000
    OR pg_catalog.current_setting('server_version_num')::integer >= 170000
  THEN
    RAISE EXCEPTION 'Finisher migration requires PostgreSQL 16';
  END IF;

  IF current_user <> session_user THEN
    RAISE EXCEPTION 'Finisher migration requires current_user and session_user to be the same administrator';
  END IF;

  SELECT * INTO executor_role
  FROM pg_catalog.pg_roles
  WHERE rolname = session_user;
  IF executor_role.rolname IS NULL
    OR NOT executor_role.rolcanlogin
    OR executor_role.rolsuper
    OR NOT executor_role.rolcreaterole
    OR pg_catalog.current_setting('createrole_self_grant') <> ''
  THEN
    RAISE EXCEPTION 'Finisher migration executor must be a PostgreSQL 16 non-superuser LOGIN CREATEROLE administrator with empty createrole_self_grant';
  END IF;

  SELECT * INTO runtime_role
  FROM pg_catalog.pg_roles
  WHERE rolname = 'trainer_app_runtime';
  SELECT * INTO owner_role
  FROM pg_catalog.pg_roles
  WHERE rolname = 'trainer_finisher_owner';
  SELECT * INTO cleanup_role
  FROM pg_catalog.pg_roles
  WHERE rolname = 'trainer_finisher_cleanup';

  IF runtime_role.rolname IS NULL
    OR owner_role.rolname IS NULL
    OR cleanup_role.rolname IS NULL
  THEN
    RAISE EXCEPTION 'required finisher database roles are not provisioned';
  END IF;

  -- PostgreSQL masks role passwords from this non-superuser executor. Exact
  -- runtime credential equality is therefore established by Gate A's bounded
  -- login, not inferred from pg_roles inside this transaction.
  IF NOT runtime_role.rolcanlogin
    OR NOT runtime_role.rolinherit
    OR runtime_role.rolsuper
    OR runtime_role.rolcreaterole
    OR runtime_role.rolcreatedb
    OR runtime_role.rolreplication
    OR runtime_role.rolbypassrls
  THEN
    RAISE EXCEPTION 'trainer_app_runtime has unsafe role attributes';
  END IF;

  IF owner_role.rolcanlogin
    OR owner_role.rolsuper
    OR owner_role.rolcreaterole
    OR owner_role.rolcreatedb
    OR owner_role.rolreplication
    OR owner_role.rolbypassrls
    OR owner_role.rolinherit
    OR cleanup_role.rolcanlogin
    OR cleanup_role.rolsuper
    OR cleanup_role.rolcreaterole
    OR cleanup_role.rolcreatedb
    OR cleanup_role.rolreplication
    OR cleanup_role.rolbypassrls
    OR cleanup_role.rolinherit
  THEN
    RAISE EXCEPTION 'finisher owner or cleanup role has unsafe attributes';
  END IF;

  IF pg_catalog.has_schema_privilege('trainer_app_runtime', 'public', 'CREATE')
    OR NOT pg_catalog.has_schema_privilege('trainer_finisher_owner', 'public', 'CREATE')
    OR NOT pg_catalog.has_schema_privilege('trainer_finisher_cleanup', 'public', 'CREATE')
  THEN
    RAISE EXCEPTION 'Finisher migration-capable schema CREATE privileges are not exact';
  END IF;

  SELECT pg_catalog.count(*) INTO protected_membership_count
  FROM pg_catalog.pg_auth_members membership
  WHERE membership.roleid IN (runtime_role.oid, owner_role.oid, cleanup_role.oid)
     OR membership.member IN (runtime_role.oid, owner_role.oid, cleanup_role.oid);

  SELECT pg_catalog.count(*) INTO automatic_membership_count
  FROM pg_catalog.pg_auth_members membership
  JOIN pg_catalog.pg_roles grantor ON grantor.oid = membership.grantor
  WHERE membership.roleid IN (runtime_role.oid, owner_role.oid, cleanup_role.oid)
    AND membership.member = executor_role.oid
    AND grantor.oid = 10
    AND grantor.rolsuper
    AND membership.admin_option
    AND NOT membership.inherit_option
    AND NOT membership.set_option;

  SELECT pg_catalog.count(*) INTO temporary_membership_count
  FROM pg_catalog.pg_auth_members membership
  WHERE membership.roleid IN (owner_role.oid, cleanup_role.oid)
    AND membership.member = executor_role.oid
    AND membership.grantor = executor_role.oid
    AND NOT membership.admin_option
    AND NOT membership.inherit_option
    AND membership.set_option;

  IF protected_membership_count <> 5
    OR automatic_membership_count <> 3
    OR temporary_membership_count <> 2
  THEN
    RAISE EXCEPTION 'Finisher migration-capable role memberships or options are not exact';
  END IF;

  SELECT pg_catalog.count(*) INTO default_privilege_count
  FROM pg_catalog.pg_default_acl defaults
  CROSS JOIN LATERAL pg_catalog.aclexplode(defaults.defaclacl) privilege
  WHERE defaults.defaclrole IN (runtime_role.oid, owner_role.oid, cleanup_role.oid)
     OR privilege.grantee IN (runtime_role.oid, owner_role.oid, cleanup_role.oid);
  IF default_privilege_count <> 0 THEN
    RAISE EXCEPTION 'Finisher roles must not own or receive default privileges';
  END IF;

  SELECT pg_catalog.count(*) INTO preexisting_object_count
  FROM (
    SELECT class.oid
    FROM pg_catalog.pg_class class
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'public' AND class.relname LIKE 'Finisher%'
    UNION ALL
    SELECT procedure.oid
    FROM pg_catalog.pg_proc procedure
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname LIKE '%finisher%'
    UNION ALL
    SELECT type.oid
    FROM pg_catalog.pg_type type
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = type.typnamespace
    WHERE namespace.nspname = 'public'
      AND type.typname IN (
        'WorkoutPhasePlacement', 'WorkoutPhaseKind', 'WorkoutPhaseProtocol',
        'FinisherCategory', 'FinisherDifficulty', 'FinisherDemand',
        'FinisherPublicationState', 'FinisherExecutionState',
        'FinisherTimerSegment', 'FinisherStepStatus',
        'FinisherExecutionAction', 'FinisherDecisionAction'
      )
  ) existing;
  IF preexisting_object_count <> 0 THEN
    RAISE EXCEPTION 'Finisher migration-owned objects already exist before migration';
  END IF;
END;
$$;

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
CREATE TYPE "FinisherDecisionAction" AS ENUM ('SELECT', 'DECLINE');

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
    "ownerId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "offeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "declinedAt" TIMESTAMP(3),
    "declineDecisionId" TEXT,
    "recommendedRoutineVersionId" TEXT,
    "recommendationReason" TEXT,
    "recommendationUnavailableReason" TEXT,
    "recommendationContext" JSONB NOT NULL,
    "itemCount" INTEGER NOT NULL,
    "finalizedAt" TIMESTAMP(3),
    CONSTRAINT "FinisherOffer_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FinisherOffer_revision_positive" CHECK ("revision" > 0),
    CONSTRAINT "FinisherOffer_item_count_positive" CHECK ("itemCount" > 0),
    CONSTRAINT "FinisherOffer_decline_consistent" CHECK (
      ("declinedAt" IS NULL AND "declineDecisionId" IS NULL)
      OR
      ("declinedAt" IS NOT NULL AND "declineDecisionId" IS NOT NULL)
    ),
    CONSTRAINT "FinisherOffer_recommendation_consistent" CHECK (
      (
        "recommendedRoutineVersionId" IS NOT NULL
        AND "recommendationReason" IS NOT NULL
        AND "recommendationUnavailableReason" IS NULL
      )
      OR
      (
        "recommendedRoutineVersionId" IS NULL
        AND "recommendationReason" IS NULL
        AND "recommendationUnavailableReason" IS NOT NULL
      )
    )
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

CREATE TABLE "FinisherDecision" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "workoutId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "action" "FinisherDecisionAction" NOT NULL,
    "offerItemId" TEXT,
    "routineVersionId" TEXT,
    "expectedOfferRevision" INTEGER NOT NULL,
    "acknowledgeContraindication" BOOLEAN,
    "requestFingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FinisherDecision_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FinisherDecision_expected_offer_revision_positive" CHECK ("expectedOfferRevision" > 0),
    CONSTRAINT "FinisherDecision_fingerprint_shape" CHECK (
      "requestFingerprint" ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT "FinisherDecision_action_shape" CHECK (
      (
        "action" = 'SELECT'
        AND "offerItemId" IS NOT NULL
        AND "routineVersionId" IS NOT NULL
        AND "acknowledgeContraindication" IS NOT NULL
      )
      OR
      (
        "action" = 'DECLINE'
        AND "offerItemId" IS NULL
        AND "routineVersionId" IS NULL
        AND "acknowledgeContraindication" IS NULL
      )
    )
);

CREATE TABLE "FinisherExecution" (
    "id" TEXT NOT NULL,
    "workoutId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "offerItemId" TEXT NOT NULL,
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
    CONSTRAINT "FinisherExecution_feedback_range" CHECK ("difficultyFeedback" IS NULL OR "difficultyFeedback" BETWEEN 1 AND 10),
    CONSTRAINT "FinisherExecution_lifecycle_consistent" CHECK (
      (
        "state" = 'SELECTED'
        AND "startedAt" IS NULL
        AND "completedAt" IS NULL
        AND "endedAt" IS NULL
        AND "dismissedAt" IS NULL
        AND ("timerSegment" IS NULL OR "timerSegment" = 'PREPARATION')
      )
      OR
      (
        "state" = 'IN_PROGRESS'
        AND "startedAt" IS NOT NULL
        AND "completedAt" IS NULL
        AND "endedAt" IS NULL
        AND "dismissedAt" IS NULL
        AND "timerSegment" IN ('WORK', 'RECOVERY')
      )
      OR
      (
        "state" = 'COMPLETED'
        AND "startedAt" IS NOT NULL
        AND "completedAt" IS NOT NULL
        AND "endedAt" = "completedAt"
        AND "dismissedAt" IS NULL
        AND "timerSegment" = 'FINISHED'
      )
      OR
      (
        "state" IN ('PARTIAL', 'SKIPPED')
        AND "startedAt" IS NOT NULL
        AND "completedAt" IS NULL
        AND "endedAt" IS NOT NULL
        AND "dismissedAt" IS NULL
        AND "timerSegment" = 'FINISHED'
      )
      OR
      (
        "state" = 'DISMISSED'
        AND "completedAt" IS NULL
        AND "endedAt" IS NOT NULL
        AND "dismissedAt" = "endedAt"
        AND (
          ("startedAt" IS NULL AND ("timerSegment" IS NULL OR "timerSegment" = 'FINISHED'))
          OR
          ("startedAt" IS NOT NULL AND "timerSegment" = 'FINISHED')
        )
      )
    ),
    CONSTRAINT "FinisherExecution_timer_consistent" CHECK (
      (
        "timerSegment" IS NULL
        AND "segmentStartedAt" IS NULL
        AND "segmentEndsAt" IS NULL
        AND "pausedAt" IS NULL
        AND "pausedRemainingMs" IS NULL
      )
      OR
      (
        "timerSegment" IN ('PREPARATION', 'WORK', 'RECOVERY')
        AND (
          (
            "pausedAt" IS NULL
            AND "pausedRemainingMs" IS NULL
            AND "segmentStartedAt" IS NOT NULL
            AND "segmentEndsAt" IS NOT NULL
            AND "segmentEndsAt" >= "segmentStartedAt"
          )
          OR
          (
            "pausedAt" IS NOT NULL
            AND "pausedRemainingMs" IS NOT NULL
            AND "segmentStartedAt" IS NULL
            AND "segmentEndsAt" IS NULL
          )
        )
      )
      OR
      (
        "timerSegment" = 'FINISHED'
        AND "pausedAt" IS NULL
        AND "pausedRemainingMs" IS NULL
        AND "segmentStartedAt" IS NOT NULL
        AND "segmentEndsAt" = "segmentStartedAt"
      )
    )
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
    "ownerId" TEXT NOT NULL,
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
    CONSTRAINT "FinisherExecutionCommand_result_revision_positive" CHECK ("resultRevision" > 0),
    CONSTRAINT "FinisherExecutionCommand_expiration_after_creation" CHECK (
      "expiresAt" = "createdAt" + INTERVAL '90 days'
    ),
    CONSTRAINT "FinisherExecutionCommand_cleanup_consistent" CHECK (
      ("response" IS NOT NULL AND "cleanedAt" IS NULL)
      OR
      ("response" IS NULL AND "cleanedAt" IS NOT NULL AND "cleanedAt" >= "expiresAt")
    )
);

CREATE UNIQUE INDEX "FinisherRoutine_code_key" ON "FinisherRoutine"("code");
CREATE UNIQUE INDEX "FinisherRoutineVersion_routineId_version_key" ON "FinisherRoutineVersion"("routineId", "version");
CREATE INDEX "FinisherRoutineVersion_category_createdAt_idx" ON "FinisherRoutineVersion"("category", "createdAt");
CREATE UNIQUE INDEX "FinisherRoutineStep_routineVersionId_orderIndex_key" ON "FinisherRoutineStep"("routineVersionId", "orderIndex");
CREATE UNIQUE INDEX "FinisherRoutineStep_id_routineVersionId_orderIndex_key" ON "FinisherRoutineStep"("id", "routineVersionId", "orderIndex");
CREATE UNIQUE INDEX "FinisherRoutineStepAlternative_routineStepId_orderIndex_key" ON "FinisherRoutineStepAlternative"("routineStepId", "orderIndex");
CREATE UNIQUE INDEX "FinisherRoutineStepAlternative_id_routineStepId_key" ON "FinisherRoutineStepAlternative"("id", "routineStepId");
CREATE UNIQUE INDEX "Workout_id_userId_key" ON "Workout"("id", "userId");
CREATE UNIQUE INDEX "FinisherOffer_workoutId_key" ON "FinisherOffer"("workoutId");
CREATE UNIQUE INDEX "FinisherOffer_workoutId_ownerId_key" ON "FinisherOffer"("workoutId", "ownerId");
CREATE UNIQUE INDEX "FinisherOffer_declineDecisionId_key" ON "FinisherOffer"("declineDecisionId");
CREATE UNIQUE INDEX "FinisherOffer_id_workoutId_ownerId_key" ON "FinisherOffer"("id", "workoutId", "ownerId");
CREATE UNIQUE INDEX "FinisherOffer_id_recommendedRoutineVersionId_key" ON "FinisherOffer"("id", "recommendedRoutineVersionId");
CREATE INDEX "FinisherOffer_recommendedRoutineVersionId_idx" ON "FinisherOffer"("recommendedRoutineVersionId");
CREATE UNIQUE INDEX "FinisherOfferItem_offerId_routineVersionId_key" ON "FinisherOfferItem"("offerId", "routineVersionId");
CREATE UNIQUE INDEX "FinisherOfferItem_offerId_position_key" ON "FinisherOfferItem"("offerId", "position");
CREATE UNIQUE INDEX "FinisherOfferItem_id_offerId_routineVersionId_key" ON "FinisherOfferItem"("id", "offerId", "routineVersionId");
CREATE INDEX "FinisherOfferItem_routineVersionId_idx" ON "FinisherOfferItem"("routineVersionId");
CREATE INDEX "FinisherDecision_offerId_createdAt_idx" ON "FinisherDecision"("offerId", "createdAt");
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
CREATE UNIQUE INDEX "FinisherExecution_id_workoutId_ownerId_key" ON "FinisherExecution"("id", "workoutId", "ownerId");
CREATE UNIQUE INDEX "FinisherExecution_id_routineVersionId_key" ON "FinisherExecution"("id", "routineVersionId");
CREATE UNIQUE INDEX "FinisherExecutionStep_executionId_routineStepId_key" ON "FinisherExecutionStep"("executionId", "routineStepId");
CREATE INDEX "FinisherExecutionStep_performedAlternativeId_idx" ON "FinisherExecutionStep"("performedAlternativeId");
CREATE INDEX "FinisherExecutionCommand_executionId_createdAt_idx" ON "FinisherExecutionCommand"("executionId", "createdAt");
CREATE INDEX "FinisherExecutionCommand_cleanedAt_expiresAt_id_idx" ON "FinisherExecutionCommand"("cleanedAt", "expiresAt", "id");

ALTER TABLE "FinisherRoutineVersion"
  ADD CONSTRAINT "FinisherRoutineVersion_routineId_fkey"
  FOREIGN KEY ("routineId") REFERENCES "FinisherRoutine"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "FinisherRoutineStep"
  ADD CONSTRAINT "FinisherRoutineStep_routineVersionId_fkey"
  FOREIGN KEY ("routineVersionId") REFERENCES "FinisherRoutineVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "FinisherRoutineStepAlternative"
  ADD CONSTRAINT "FinisherRoutineStepAlternative_routineStepId_fkey"
  FOREIGN KEY ("routineStepId") REFERENCES "FinisherRoutineStep"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "FinisherOffer"
  ADD CONSTRAINT "FinisherOffer_workoutId_fkey"
  FOREIGN KEY ("workoutId", "ownerId") REFERENCES "Workout"("id", "userId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "FinisherOffer"
  ADD CONSTRAINT "FinisherOffer_recommendedRoutineVersionId_fkey"
  FOREIGN KEY ("recommendedRoutineVersionId") REFERENCES "FinisherRoutineVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "FinisherOfferItem"
  ADD CONSTRAINT "FinisherOfferItem_offerId_fkey"
  FOREIGN KEY ("offerId") REFERENCES "FinisherOffer"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "FinisherOfferItem"
  ADD CONSTRAINT "FinisherOfferItem_routineVersionId_fkey"
  FOREIGN KEY ("routineVersionId") REFERENCES "FinisherRoutineVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "FinisherOffer"
  ADD CONSTRAINT "FinisherOffer_recommended_item_fkey"
  FOREIGN KEY ("id", "recommendedRoutineVersionId") REFERENCES "FinisherOfferItem"("offerId", "routineVersionId") ON DELETE RESTRICT ON UPDATE RESTRICT
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "FinisherDecision"
  ADD CONSTRAINT "FinisherDecision_offerId_fkey"
  FOREIGN KEY ("offerId", "workoutId", "ownerId") REFERENCES "FinisherOffer"("id", "workoutId", "ownerId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "FinisherDecision"
  ADD CONSTRAINT "FinisherDecision_offerItem_binding_fkey"
  FOREIGN KEY ("offerItemId", "offerId", "routineVersionId") REFERENCES "FinisherOfferItem"("id", "offerId", "routineVersionId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "FinisherOffer"
  ADD CONSTRAINT "FinisherOffer_declineDecisionId_fkey"
  FOREIGN KEY ("declineDecisionId") REFERENCES "FinisherDecision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "FinisherExecution"
  ADD CONSTRAINT "FinisherExecution_workoutId_fkey"
  FOREIGN KEY ("workoutId", "ownerId") REFERENCES "Workout"("id", "userId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "FinisherExecution"
  ADD CONSTRAINT "FinisherExecution_offerId_fkey"
  FOREIGN KEY ("offerId", "workoutId", "ownerId") REFERENCES "FinisherOffer"("id", "workoutId", "ownerId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "FinisherExecution"
  ADD CONSTRAINT "FinisherExecution_offerItem_binding_fkey"
  FOREIGN KEY ("offerItemId", "offerId", "routineVersionId") REFERENCES "FinisherOfferItem"("id", "offerId", "routineVersionId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "FinisherExecution"
  ADD CONSTRAINT "FinisherExecution_routineVersionId_fkey"
  FOREIGN KEY ("routineVersionId") REFERENCES "FinisherRoutineVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "FinisherExecution"
  ADD CONSTRAINT "FinisherExecution_decisionId_fkey"
  FOREIGN KEY ("id") REFERENCES "FinisherDecision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "FinisherExecutionStep"
  ADD CONSTRAINT "FinisherExecutionStep_executionId_fkey"
  FOREIGN KEY ("executionId") REFERENCES "FinisherExecution"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "FinisherExecutionStep"
  ADD CONSTRAINT "FinisherExecutionStep_routineStepId_fkey"
  FOREIGN KEY ("routineStepId") REFERENCES "FinisherRoutineStep"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "FinisherExecutionStep"
  ADD CONSTRAINT "FinisherExecutionStep_executionId_routineVersionId_fkey"
  FOREIGN KEY ("executionId", "routineVersionId") REFERENCES "FinisherExecution"("id", "routineVersionId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "FinisherExecutionStep"
  ADD CONSTRAINT "FinisherExecutionStep_routineStep_binding_fkey"
  FOREIGN KEY ("routineStepId", "routineVersionId", "orderIndex") REFERENCES "FinisherRoutineStep"("id", "routineVersionId", "orderIndex") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "FinisherExecutionStep"
  ADD CONSTRAINT "FinisherExecutionStep_performedAlternativeId_fkey"
  FOREIGN KEY ("performedAlternativeId") REFERENCES "FinisherRoutineStepAlternative"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "FinisherExecutionStep"
  ADD CONSTRAINT "FinisherExecutionStep_performedAlternative_binding_fkey"
  FOREIGN KEY ("performedAlternativeId", "routineStepId") REFERENCES "FinisherRoutineStepAlternative"("id", "routineStepId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "FinisherExecutionCommand"
  ADD CONSTRAINT "FinisherExecutionCommand_executionId_workoutId_fkey"
  FOREIGN KEY ("executionId", "workoutId", "ownerId") REFERENCES "FinisherExecution"("id", "workoutId", "ownerId") ON DELETE RESTRICT ON UPDATE RESTRICT;

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
DECLARE
  finalized_at TIMESTAMP(3);
  expected_item_count INTEGER;
  actual_item_count INTEGER;
  minimum_position INTEGER;
  maximum_position INTEGER;
  recommended_version_id TEXT;
BEGIN
  SELECT
    offer."finalizedAt",
    offer."itemCount",
    offer."recommendedRoutineVersionId"
  INTO finalized_at, expected_item_count, recommended_version_id
  FROM "FinisherOffer" offer
  WHERE offer."id" = NEW."id";

  IF finalized_at IS NULL THEN
    RAISE EXCEPTION 'finisher offer must be finalized before commit';
  END IF;

  SELECT COUNT(*)::INTEGER, MIN(item."position"), MAX(item."position")
  INTO actual_item_count, minimum_position, maximum_position
  FROM "FinisherOfferItem" item
  WHERE item."offerId" = NEW."id";

  IF actual_item_count = 0
    OR actual_item_count <> expected_item_count
    OR minimum_position <> 0
    OR maximum_position <> expected_item_count - 1
  THEN
    RAISE EXCEPTION 'finalized finisher offer item set must be nonempty, complete, and contiguous';
  END IF;

  IF recommended_version_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM "FinisherOfferItem" item
      WHERE item."offerId" = NEW."id"
        AND item."routineVersionId" = recommended_version_id
    )
  THEN
    RAISE EXCEPTION 'finalized finisher offer recommendation must identify an exact offered item';
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

  IF NOT EXISTS (
    SELECT 1
    FROM "FinisherDecision" decision
    JOIN "FinisherExecution" execution ON execution."id" = NEW."id"
    WHERE decision."id" = execution."id"
      AND decision."action" = 'SELECT'
      AND decision."ownerId" = execution."ownerId"
      AND decision."workoutId" = execution."workoutId"
      AND decision."offerId" = execution."offerId"
      AND decision."offerItemId" = execution."offerItemId"
      AND decision."routineVersionId" = execution."routineVersionId"
      AND decision."expectedOfferRevision" = execution."offerRevisionAtSelection"
  ) THEN
    RAISE EXCEPTION 'finisher execution must match its complete immutable selection decision';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "FinisherExecution_require_finalized"
AFTER INSERT ON "FinisherExecution"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_finisher_execution_finalized();

-- Terminal outcome meaning is owned by one deferred parent/child validator.
-- Immediate lifecycle triggers preserve monotonic history while these constraint
-- triggers judge only the final state of the surrounding transaction.
CREATE FUNCTION validate_finisher_terminal_outcome(target_execution_id TEXT) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  execution_row "FinisherExecution"%ROWTYPE;
  prescribed_step_count INTEGER;
  pending_step_count INTEGER;
  partial_step_count INTEGER;
  completed_step_count INTEGER;
  skipped_step_count INTEGER;
  started_step_count INTEGER;
  resolved_step_count INTEGER;
  performed_step_count INTEGER;
  actual_work_ms BIGINT;
  minimum_order_index INTEGER;
  maximum_order_index INTEGER;
BEGIN
  SELECT *
  INTO execution_row
  FROM "FinisherExecution"
  WHERE "id" = target_execution_id
  FOR UPDATE;

  IF NOT FOUND
    OR execution_row."state" NOT IN ('COMPLETED', 'PARTIAL', 'SKIPPED', 'DISMISSED')
  THEN
    RETURN;
  END IF;

  SELECT
    COUNT(*)::INTEGER,
    COUNT(*) FILTER (WHERE step."status" = 'PENDING')::INTEGER,
    COUNT(*) FILTER (WHERE step."status" = 'PARTIAL')::INTEGER,
    COUNT(*) FILTER (WHERE step."status" = 'COMPLETED')::INTEGER,
    COUNT(*) FILTER (WHERE step."status" = 'SKIPPED')::INTEGER,
    COUNT(*) FILTER (WHERE step."startedAt" IS NOT NULL)::INTEGER,
    COUNT(*) FILTER (WHERE step."resolvedAt" IS NOT NULL)::INTEGER,
    COUNT(*) FILTER (
      WHERE step."startedAt" IS NOT NULL
        OR step."resolvedAt" IS NOT NULL
        OR step."actualWorkMs" > 0
    )::INTEGER,
    COALESCE(SUM(step."actualWorkMs"), 0),
    MIN(step."orderIndex"),
    MAX(step."orderIndex")
  INTO
    prescribed_step_count,
    pending_step_count,
    partial_step_count,
    completed_step_count,
    skipped_step_count,
    started_step_count,
    resolved_step_count,
    performed_step_count,
    actual_work_ms,
    minimum_order_index,
    maximum_order_index
  FROM "FinisherExecutionStep" step
  WHERE step."executionId" = target_execution_id;

  IF prescribed_step_count = 0
    OR minimum_order_index <> 0
    OR execution_row."currentStepIndex" < minimum_order_index
    OR execution_row."currentStepIndex" > maximum_order_index
  THEN
    RAISE EXCEPTION 'terminal finisher outcome requires a valid active prescribed step';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "FinisherExecutionStep" step
    WHERE step."executionId" = target_execution_id
      AND (
        (
          step."status" = 'PENDING'
          AND (step."resolvedAt" IS NOT NULL OR step."actualWorkMs" <> 0)
        )
        OR
        (
          step."status" <> 'PENDING'
          AND (
            step."startedAt" IS NULL
            OR step."resolvedAt" IS NULL
            OR step."resolvedAt" < step."startedAt"
          )
        )
        OR
        (
          step."status" IN ('COMPLETED', 'PARTIAL')
          AND step."actualWorkMs" <= 0
        )
        OR
        (
          step."status" = 'SKIPPED'
          AND step."actualWorkMs" <> 0
        )
        OR
        (
          execution_row."startedAt" IS NOT NULL
          AND step."startedAt" IS NOT NULL
          AND step."startedAt" < execution_row."startedAt"
        )
        OR
        (
          step."resolvedAt" IS NOT NULL
          AND step."resolvedAt" > execution_row."endedAt"
        )
      )
  ) THEN
    RAISE EXCEPTION 'terminal finisher outcome contradicts prescribed step evidence';
  END IF;

  IF execution_row."state" = 'COMPLETED' THEN
    IF completed_step_count <> prescribed_step_count
      OR pending_step_count <> 0
      OR partial_step_count <> 0
      OR skipped_step_count <> 0
      OR resolved_step_count <> prescribed_step_count
      OR actual_work_ms <= 0
      OR execution_row."currentStepIndex" <> maximum_order_index
    THEN
      RAISE EXCEPTION 'completed finisher outcome requires every prescribed step to contain completed work';
    END IF;
  ELSIF execution_row."state" = 'PARTIAL' THEN
    IF actual_work_ms <= 0
      OR completed_step_count + partial_step_count = 0
    THEN
      RAISE EXCEPTION 'partial finisher outcome requires genuine performed step evidence';
    END IF;
  ELSIF execution_row."state" = 'SKIPPED' THEN
    IF skipped_step_count <> prescribed_step_count
      OR pending_step_count <> 0
      OR partial_step_count <> 0
      OR completed_step_count <> 0
      OR resolved_step_count <> prescribed_step_count
      OR actual_work_ms <> 0
      OR execution_row."recoveryActiveMs" <> 0
      OR execution_row."currentStepIndex" <> maximum_order_index
    THEN
      RAISE EXCEPTION 'skipped finisher outcome requires every prescribed step to contain zero-work skip evidence';
    END IF;
  ELSIF execution_row."startedAt" IS NULL THEN
    IF pending_step_count <> prescribed_step_count
      OR started_step_count <> 0
      OR resolved_step_count <> 0
      OR actual_work_ms <> 0
      OR execution_row."recoveryActiveMs" <> 0
      OR execution_row."workPausedMs" <> 0
      OR execution_row."recoveryPausedMs" <> 0
    THEN
      RAISE EXCEPTION 'never-started dismissed finisher must retain untouched prescribed step evidence';
    END IF;
  ELSIF performed_step_count = 0 THEN
    RAISE EXCEPTION 'performed dismissed finisher must retain started or resolved prescribed step evidence';
  END IF;
END;
$$;

CREATE FUNCTION validate_finisher_terminal_outcome_from_execution() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM validate_finisher_terminal_outcome(COALESCE(NEW."id", OLD."id"));
  RETURN NULL;
END;
$$;

CREATE FUNCTION validate_finisher_terminal_outcome_from_step() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM validate_finisher_terminal_outcome(
    CASE WHEN TG_OP = 'DELETE' THEN OLD."executionId" ELSE NEW."executionId" END
  );
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "FinisherExecution_terminal_outcome_coherence"
AFTER INSERT OR UPDATE ON "FinisherExecution"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_finisher_terminal_outcome_from_execution();

CREATE CONSTRAINT TRIGGER "FinisherExecutionStep_terminal_outcome_coherence"
AFTER INSERT OR UPDATE OR DELETE ON "FinisherExecutionStep"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_finisher_terminal_outcome_from_step();

CREATE FUNCTION guard_finisher_offer_item_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  finalized_at TIMESTAMP(3);
BEGIN
  SELECT "finalizedAt"
  INTO finalized_at
  FROM "FinisherOffer"
  WHERE "id" = NEW."offerId"
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'finisher offer item parent must be visible in the constructing transaction';
  END IF;

  IF finalized_at IS NOT NULL THEN
    RAISE EXCEPTION 'finalized finisher offer items are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION guard_finisher_execution_step_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  finalized_at TIMESTAMP(3);
BEGIN
  SELECT "finalizedAt"
  INTO finalized_at
  FROM "FinisherExecution"
  WHERE "id" = NEW."executionId"
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'finisher execution step parent must be visible in the constructing transaction';
  END IF;

  IF finalized_at IS NOT NULL THEN
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
    OR NEW."ownerId" IS DISTINCT FROM OLD."ownerId"
    OR NEW."offeredAt" IS DISTINCT FROM OLD."offeredAt"
    OR NEW."recommendedRoutineVersionId" IS DISTINCT FROM OLD."recommendedRoutineVersionId"
    OR NEW."recommendationReason" IS DISTINCT FROM OLD."recommendationReason"
    OR NEW."recommendationUnavailableReason" IS DISTINCT FROM OLD."recommendationUnavailableReason"
    OR NEW."recommendationContext" IS DISTINCT FROM OLD."recommendationContext"
    OR NEW."itemCount" IS DISTINCT FROM OLD."itemCount"
    OR NEW."finalizedAt" IS NULL
    OR (
      OLD."finalizedAt" IS NOT NULL
      AND NEW."finalizedAt" IS DISTINCT FROM OLD."finalizedAt"
    )
  THEN
    RAISE EXCEPTION 'finisher offer identity and definition binding are immutable';
  END IF;

  IF OLD."finalizedAt" IS NULL THEN
    IF NEW."finalizedAt" IS NULL
      OR NEW."revision" <> OLD."revision"
      OR NEW."declinedAt" IS DISTINCT FROM OLD."declinedAt"
      OR NEW."declineDecisionId" IS DISTINCT FROM OLD."declineDecisionId"
    THEN
      RAISE EXCEPTION 'finisher offer finalization must preserve construction evidence';
    END IF;
    RETURN NEW;
  END IF;

  IF to_jsonb(NEW) = to_jsonb(OLD) THEN
    RETURN NEW;
  END IF;

  IF NEW."revision" <> OLD."revision" + 1 THEN
    RAISE EXCEPTION 'finisher offer revision must advance exactly once';
  END IF;

  IF OLD."declineDecisionId" IS NOT NULL THEN
    IF NEW."declineDecisionId" IS DISTINCT FROM OLD."declineDecisionId"
      OR NEW."declinedAt" IS DISTINCT FROM OLD."declinedAt"
    THEN
      RAISE EXCEPTION 'finisher decline evidence is immutable';
    END IF;
  ELSIF NEW."declineDecisionId" IS NOT NULL THEN
    IF NEW."declinedAt" IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM "FinisherDecision" decision
        WHERE decision."id" = NEW."declineDecisionId"
          AND decision."action" = 'DECLINE'
          AND decision."ownerId" = NEW."ownerId"
          AND decision."workoutId" = NEW."workoutId"
          AND decision."offerId" = NEW."id"
          AND decision."expectedOfferRevision" = OLD."revision"
      )
    THEN
      RAISE EXCEPTION 'finisher decline must match its complete immutable decision';
    END IF;
  ELSIF NEW."declinedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'finisher decline timestamp requires a durable decision';
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
    OR NEW."ownerId" IS DISTINCT FROM OLD."ownerId"
    OR NEW."offerId" IS DISTINCT FROM OLD."offerId"
    OR NEW."offerItemId" IS DISTINCT FROM OLD."offerItemId"
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

-- A terminal execution freezes every performed fact. The existing optional
-- feedback lifecycle may change only difficultyFeedback and the OCC revision.
CREATE FUNCTION guard_finisher_execution_lifecycle() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."finalizedAt" IS NULL THEN
    IF NEW."finalizedAt" IS NULL
      OR (
        to_jsonb(NEW) - 'finalizedAt'
      ) IS DISTINCT FROM (
        to_jsonb(OLD) - 'finalizedAt'
      )
    THEN
      RAISE EXCEPTION 'finisher execution finalization must preserve construction evidence';
    END IF;
    RETURN NEW;
  END IF;

  IF to_jsonb(NEW) = to_jsonb(OLD) THEN
    RETURN NEW;
  END IF;

  IF OLD."state" IN ('COMPLETED', 'PARTIAL', 'SKIPPED', 'DISMISSED') THEN
    IF OLD."state" IN ('COMPLETED', 'PARTIAL')
      AND NEW."state" = OLD."state"
      AND NEW."difficultyFeedback" IS DISTINCT FROM OLD."difficultyFeedback"
      AND NEW."revision" = OLD."revision" + 1
      AND (
        to_jsonb(NEW) - ARRAY['difficultyFeedback', 'revision']::text[]
      ) = (
        to_jsonb(OLD) - ARRAY['difficultyFeedback', 'revision']::text[]
      )
    THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'terminal finisher execution evidence is immutable';
  END IF;

  IF NEW."revision" <> OLD."revision" + 1
    OR NEW."currentStepIndex" < OLD."currentStepIndex"
    OR NEW."preparationActiveMs" < OLD."preparationActiveMs"
    OR NEW."recoveryActiveMs" < OLD."recoveryActiveMs"
    OR NEW."preparationPausedMs" < OLD."preparationPausedMs"
    OR NEW."workPausedMs" < OLD."workPausedMs"
    OR NEW."recoveryPausedMs" < OLD."recoveryPausedMs"
    OR (
      OLD."startedAt" IS NOT NULL
      AND NEW."startedAt" IS DISTINCT FROM OLD."startedAt"
    )
    OR (
      OLD."completedAt" IS NOT NULL
      AND NEW."completedAt" IS DISTINCT FROM OLD."completedAt"
    )
    OR (
      OLD."endedAt" IS NOT NULL
      AND NEW."endedAt" IS DISTINCT FROM OLD."endedAt"
    )
    OR (
      OLD."dismissedAt" IS NOT NULL
      AND NEW."dismissedAt" IS DISTINCT FROM OLD."dismissedAt"
    )
  THEN
    RAISE EXCEPTION 'finisher execution lifecycle or timestamp evidence cannot regress';
  END IF;

  IF NOT (
    (OLD."state" = 'SELECTED' AND NEW."state" IN ('SELECTED', 'IN_PROGRESS', 'COMPLETED', 'DISMISSED'))
    OR
    (OLD."state" = 'IN_PROGRESS' AND NEW."state" IN ('IN_PROGRESS', 'COMPLETED', 'PARTIAL', 'SKIPPED', 'DISMISSED'))
  ) THEN
    RAISE EXCEPTION 'invalid finisher execution lifecycle transition';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION guard_finisher_decision_history() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'finisher decisions cannot be deleted';
  END IF;
  IF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
    RAISE EXCEPTION 'finisher decisions are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION require_finisher_decision_applied() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."action" = 'SELECT' AND NOT EXISTS (
    SELECT 1
    FROM "FinisherExecution" execution
    WHERE execution."id" = NEW."id"
      AND execution."ownerId" = NEW."ownerId"
      AND execution."workoutId" = NEW."workoutId"
      AND execution."offerId" = NEW."offerId"
      AND execution."offerItemId" = NEW."offerItemId"
      AND execution."routineVersionId" = NEW."routineVersionId"
      AND execution."offerRevisionAtSelection" = NEW."expectedOfferRevision"
  ) THEN
    RAISE EXCEPTION 'selection decision must resolve to its exact durable execution';
  END IF;

  IF NEW."action" = 'DECLINE' AND NOT EXISTS (
    SELECT 1
    FROM "FinisherOffer" offer
    WHERE offer."id" = NEW."offerId"
      AND offer."workoutId" = NEW."workoutId"
      AND offer."ownerId" = NEW."ownerId"
      AND offer."declineDecisionId" = NEW."id"
      AND offer."declinedAt" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'decline decision must resolve to its exact durable offer outcome';
  END IF;

  RETURN NULL;
END;
$$;

-- Resolved steps never regress. Parent locking makes the final child updates
-- and parent terminal transition atomic with respect to concurrent rewrites.
CREATE FUNCTION guard_finisher_execution_step_evidence() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_state "FinisherExecutionState";
BEGIN
  SELECT "state"
  INTO parent_state
  FROM "FinisherExecution"
  WHERE "id" = OLD."executionId"
  FOR UPDATE;

  IF parent_state IS NULL THEN
    RAISE EXCEPTION 'finisher execution step parent is missing';
  END IF;

  IF parent_state IN ('COMPLETED', 'PARTIAL', 'SKIPPED', 'DISMISSED')
    OR OLD."status" <> 'PENDING'
  THEN
    IF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
      RAISE EXCEPTION 'resolved finisher execution step evidence is immutable';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."actualWorkMs" < OLD."actualWorkMs"
    OR (
      OLD."startedAt" IS NOT NULL
      AND NEW."startedAt" IS DISTINCT FROM OLD."startedAt"
    )
    OR (
      OLD."resolvedAt" IS NOT NULL
      AND NEW."resolvedAt" IS DISTINCT FROM OLD."resolvedAt"
    )
    OR (NEW."status" = 'PENDING' AND NEW."resolvedAt" IS NOT NULL)
    OR (NEW."status" <> 'PENDING' AND NEW."resolvedAt" IS NULL)
  THEN
    RAISE EXCEPTION 'finisher execution step lifecycle evidence cannot regress';
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
CREATE TRIGGER "FinisherExecution_lifecycle_guard"
BEFORE UPDATE ON "FinisherExecution"
FOR EACH ROW EXECUTE FUNCTION guard_finisher_execution_lifecycle();
CREATE TRIGGER "FinisherDecision_immutable"
BEFORE UPDATE OR DELETE ON "FinisherDecision"
FOR EACH ROW EXECUTE FUNCTION guard_finisher_decision_history();
CREATE CONSTRAINT TRIGGER "FinisherDecision_require_applied"
AFTER INSERT ON "FinisherDecision"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_finisher_decision_applied();
CREATE TRIGGER "FinisherExecutionStep_identity_immutable"
BEFORE UPDATE ON "FinisherExecutionStep"
FOR EACH ROW EXECUTE FUNCTION guard_finisher_execution_step_identity();
CREATE TRIGGER "FinisherExecutionStep_evidence_immutable"
BEFORE UPDATE ON "FinisherExecutionStep"
FOR EACH ROW EXECUTE FUNCTION guard_finisher_execution_step_evidence();
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

-- Command rows are permanent tombstones. Cleanup is the sole update path and
-- may clear only an expired response payload while preserving every binding.
CREATE FUNCTION guard_finisher_execution_command_tombstone() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'finisher execution command tombstones cannot be deleted';
  END IF;

  IF current_user = 'trainer_finisher_cleanup'
    AND OLD."response" IS NOT NULL
    AND NEW."response" IS NULL
    AND OLD."cleanedAt" IS NULL
    AND NEW."cleanedAt" IS NOT NULL
    AND NEW."cleanedAt" >= OLD."expiresAt"
    AND NEW."id" = OLD."id"
    AND NEW."workoutId" = OLD."workoutId"
    AND NEW."ownerId" = OLD."ownerId"
    AND NEW."executionId" = OLD."executionId"
    AND NEW."action" = OLD."action"
    AND NEW."requestHash" = OLD."requestHash"
    AND NEW."expectedRevision" = OLD."expectedRevision"
    AND NEW."resultRevision" = OLD."resultRevision"
    AND NEW."createdAt" = OLD."createdAt"
    AND NEW."expiresAt" = OLD."expiresAt"
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'finisher execution command tombstones are immutable';
END;
$$;

CREATE TRIGGER "FinisherExecutionCommand_tombstone"
BEFORE UPDATE OR DELETE ON "FinisherExecutionCommand"
FOR EACH ROW EXECUTE FUNCTION guard_finisher_execution_command_tombstone();

CREATE FUNCTION cleanup_expired_finisher_execution_commands(
  p_batch_size INTEGER DEFAULT 100
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  cleaned_count INTEGER;
  cleanup_time TIMESTAMP(3) := clock_timestamp();
BEGIN
  IF p_batch_size IS NULL OR p_batch_size < 1 OR p_batch_size > 100 THEN
    RAISE EXCEPTION 'finisher command cleanup batch size must be between 1 and 100';
  END IF;

  WITH expired AS MATERIALIZED (
    SELECT command."id"
    FROM public."FinisherExecutionCommand" command
    WHERE command."response" IS NOT NULL
      AND command."cleanedAt" IS NULL
      AND command."expiresAt" <= cleanup_time
    ORDER BY command."expiresAt" ASC, command."id" ASC
    FOR UPDATE SKIP LOCKED
    LIMIT p_batch_size
  ),
  cleaned AS (
    UPDATE public."FinisherExecutionCommand" command
    SET
      "response" = NULL,
      "cleanedAt" = cleanup_time
    FROM expired
    WHERE command."id" = expired."id"
    RETURNING command."id"
  )
  SELECT COUNT(*)::INTEGER INTO cleaned_count FROM cleaned;

  RETURN cleaned_count;
END;
$$;

REVOKE ALL ON FUNCTION cleanup_expired_finisher_execution_commands(INTEGER)
FROM PUBLIC;

ALTER TABLE "FinisherRoutine" OWNER TO trainer_finisher_owner;
ALTER TABLE "FinisherRoutineVersion" OWNER TO trainer_finisher_owner;
ALTER TABLE "FinisherRoutineStep" OWNER TO trainer_finisher_owner;
ALTER TABLE "FinisherRoutineStepAlternative" OWNER TO trainer_finisher_owner;
ALTER TABLE "FinisherOffer" OWNER TO trainer_finisher_owner;
ALTER TABLE "FinisherOfferItem" OWNER TO trainer_finisher_owner;
ALTER TABLE "FinisherDecision" OWNER TO trainer_finisher_owner;
ALTER TABLE "FinisherExecution" OWNER TO trainer_finisher_owner;
ALTER TABLE "FinisherExecutionStep" OWNER TO trainer_finisher_owner;
ALTER TABLE "FinisherExecutionCommand" OWNER TO trainer_finisher_owner;

ALTER TYPE "WorkoutPhasePlacement" OWNER TO trainer_finisher_owner;
ALTER TYPE "WorkoutPhaseKind" OWNER TO trainer_finisher_owner;
ALTER TYPE "WorkoutPhaseProtocol" OWNER TO trainer_finisher_owner;
ALTER TYPE "FinisherCategory" OWNER TO trainer_finisher_owner;
ALTER TYPE "FinisherDifficulty" OWNER TO trainer_finisher_owner;
ALTER TYPE "FinisherDemand" OWNER TO trainer_finisher_owner;
ALTER TYPE "FinisherPublicationState" OWNER TO trainer_finisher_owner;
ALTER TYPE "FinisherExecutionState" OWNER TO trainer_finisher_owner;
ALTER TYPE "FinisherTimerSegment" OWNER TO trainer_finisher_owner;
ALTER TYPE "FinisherStepStatus" OWNER TO trainer_finisher_owner;
ALTER TYPE "FinisherExecutionAction" OWNER TO trainer_finisher_owner;
ALTER TYPE "FinisherDecisionAction" OWNER TO trainer_finisher_owner;

ALTER FUNCTION guard_finisher_routine_identity() OWNER TO trainer_finisher_owner;
ALTER FUNCTION require_finisher_routine_version_sealed() OWNER TO trainer_finisher_owner;
ALTER FUNCTION guard_finisher_routine_version_mutation() OWNER TO trainer_finisher_owner;
ALTER FUNCTION guard_finisher_routine_child_mutation() OWNER TO trainer_finisher_owner;
ALTER FUNCTION require_finisher_offer_finalized() OWNER TO trainer_finisher_owner;
ALTER FUNCTION require_finisher_execution_finalized() OWNER TO trainer_finisher_owner;
ALTER FUNCTION validate_finisher_terminal_outcome(TEXT) OWNER TO trainer_finisher_owner;
ALTER FUNCTION validate_finisher_terminal_outcome_from_execution() OWNER TO trainer_finisher_owner;
ALTER FUNCTION validate_finisher_terminal_outcome_from_step() OWNER TO trainer_finisher_owner;
ALTER FUNCTION guard_finisher_offer_item_insert() OWNER TO trainer_finisher_owner;
ALTER FUNCTION guard_finisher_execution_step_insert() OWNER TO trainer_finisher_owner;
ALTER FUNCTION guard_finisher_offer_identity() OWNER TO trainer_finisher_owner;
ALTER FUNCTION reject_finisher_offer_item_update() OWNER TO trainer_finisher_owner;
ALTER FUNCTION guard_finisher_execution_identity() OWNER TO trainer_finisher_owner;
ALTER FUNCTION guard_finisher_execution_step_identity() OWNER TO trainer_finisher_owner;
ALTER FUNCTION guard_finisher_execution_lifecycle() OWNER TO trainer_finisher_owner;
ALTER FUNCTION guard_finisher_decision_history() OWNER TO trainer_finisher_owner;
ALTER FUNCTION require_finisher_decision_applied() OWNER TO trainer_finisher_owner;
ALTER FUNCTION guard_finisher_execution_step_evidence() OWNER TO trainer_finisher_owner;
ALTER FUNCTION reject_finisher_history_deletion() OWNER TO trainer_finisher_owner;
ALTER FUNCTION guard_finisher_execution_command_tombstone() OWNER TO trainer_finisher_owner;
ALTER FUNCTION cleanup_expired_finisher_execution_commands(INTEGER) OWNER TO trainer_finisher_cleanup;

-- The executor owns the schema, while the dedicated owner roles own the new
-- objects. Grant schema visibility before assuming the object owner role.
GRANT USAGE ON SCHEMA public TO trainer_app_runtime, trainer_finisher_cleanup;
SET LOCAL ROLE trainer_finisher_owner;

REVOKE ALL ON TYPE
  "WorkoutPhasePlacement", "WorkoutPhaseKind", "WorkoutPhaseProtocol",
  "FinisherCategory", "FinisherDifficulty", "FinisherDemand",
  "FinisherPublicationState", "FinisherExecutionState",
  "FinisherTimerSegment", "FinisherStepStatus",
  "FinisherExecutionAction", "FinisherDecisionAction"
FROM PUBLIC, trainer_app_runtime, trainer_finisher_cleanup;
GRANT USAGE ON TYPE
  "WorkoutPhasePlacement", "WorkoutPhaseKind", "WorkoutPhaseProtocol",
  "FinisherCategory", "FinisherDifficulty", "FinisherDemand",
  "FinisherPublicationState", "FinisherExecutionState",
  "FinisherTimerSegment", "FinisherStepStatus",
  "FinisherExecutionAction", "FinisherDecisionAction"
TO trainer_app_runtime;

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

REVOKE ALL ON TABLE
  "FinisherRoutine",
  "FinisherRoutineVersion",
  "FinisherRoutineStep",
  "FinisherRoutineStepAlternative",
  "FinisherOffer",
  "FinisherOfferItem",
  "FinisherDecision",
  "FinisherExecution",
  "FinisherExecutionStep",
  "FinisherExecutionCommand"
FROM PUBLIC, trainer_app_runtime, trainer_finisher_cleanup;

GRANT SELECT ON TABLE
  "FinisherRoutine",
  "FinisherRoutineVersion",
  "FinisherRoutineStep",
  "FinisherRoutineStepAlternative"
TO trainer_app_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE "FinisherOffer" TO trainer_app_runtime;
GRANT SELECT, INSERT ON TABLE "FinisherOfferItem" TO trainer_app_runtime;
GRANT SELECT, INSERT ON TABLE "FinisherDecision" TO trainer_app_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE "FinisherExecution" TO trainer_app_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE "FinisherExecutionStep" TO trainer_app_runtime;
GRANT SELECT, INSERT ON TABLE "FinisherExecutionCommand" TO trainer_app_runtime;

GRANT SELECT ON TABLE "FinisherExecutionCommand" TO trainer_finisher_cleanup;
GRANT UPDATE ("response", "cleanedAt")
ON TABLE "FinisherExecutionCommand"
TO trainer_finisher_cleanup;

REVOKE ALL ON FUNCTION
  guard_finisher_routine_identity(),
  require_finisher_routine_version_sealed(),
  guard_finisher_routine_version_mutation(),
  guard_finisher_routine_child_mutation(),
  require_finisher_offer_finalized(),
  require_finisher_execution_finalized(),
  validate_finisher_terminal_outcome(TEXT),
  validate_finisher_terminal_outcome_from_execution(),
  validate_finisher_terminal_outcome_from_step(),
  guard_finisher_offer_item_insert(),
  guard_finisher_execution_step_insert(),
  guard_finisher_offer_identity(),
  reject_finisher_offer_item_update(),
  guard_finisher_execution_identity(),
  guard_finisher_execution_step_identity(),
  guard_finisher_execution_lifecycle(),
  guard_finisher_decision_history(),
  require_finisher_decision_applied(),
  guard_finisher_execution_step_evidence(),
  reject_finisher_history_deletion(),
  guard_finisher_execution_command_tombstone()
FROM PUBLIC, trainer_app_runtime, trainer_finisher_cleanup;
-- Run deferred catalog integrity triggers while the transaction is still
-- executing as the object owner. No deferred owner access may survive the
-- terminal removal of the executor's temporary SET membership.
SET CONSTRAINTS ALL IMMEDIATE;
RESET ROLE;
SET LOCAL ROLE trainer_finisher_cleanup;
REVOKE ALL ON FUNCTION cleanup_expired_finisher_execution_commands(INTEGER)
FROM PUBLIC, trainer_finisher_owner;
GRANT EXECUTE ON FUNCTION cleanup_expired_finisher_execution_commands(INTEGER)
TO trainer_app_runtime;
RESET ROLE;
SET LOCAL ROLE trainer_finisher_owner;
GRANT EXECUTE ON FUNCTION validate_finisher_terminal_outcome(TEXT)
TO trainer_app_runtime;
RESET ROLE;

-- Remove only migration-temporary capabilities. PostgreSQL 16's creator-admin
-- memberships (bootstrap-superuser grantor, ADMIN true, INHERIT/SET false) are
-- unavoidable for a non-superuser CREATEROLE administrator and remain intact.
REVOKE CREATE ON SCHEMA public
FROM trainer_finisher_owner, trainer_finisher_cleanup;
REVOKE trainer_finisher_owner FROM SESSION_USER GRANTED BY SESSION_USER;
REVOKE trainer_finisher_cleanup FROM SESSION_USER GRANTED BY SESSION_USER;

DO $$
DECLARE
  runtime_role pg_catalog.pg_roles%ROWTYPE;
  owner_role pg_catalog.pg_roles%ROWTYPE;
  cleanup_role pg_catalog.pg_roles%ROWTYPE;
  executor_role pg_catalog.pg_roles%ROWTYPE;
  protected_membership_count integer;
  automatic_membership_count integer;
  default_privilege_count integer;
  terminal_mismatch_count integer;
BEGIN
  SELECT * INTO runtime_role FROM pg_catalog.pg_roles
  WHERE rolname = 'trainer_app_runtime';
  SELECT * INTO owner_role FROM pg_catalog.pg_roles
  WHERE rolname = 'trainer_finisher_owner';
  SELECT * INTO cleanup_role FROM pg_catalog.pg_roles
  WHERE rolname = 'trainer_finisher_cleanup';
  SELECT * INTO executor_role FROM pg_catalog.pg_roles
  WHERE rolname = session_user;

  IF runtime_role.rolname IS NULL
    OR owner_role.rolname IS NULL
    OR cleanup_role.rolname IS NULL
    OR executor_role.rolname IS NULL
    OR current_user <> session_user
    OR executor_role.rolsuper
    OR NOT executor_role.rolcreaterole
    OR NOT runtime_role.rolcanlogin
    OR NOT runtime_role.rolinherit
    OR runtime_role.rolsuper
    OR runtime_role.rolcreaterole
    OR runtime_role.rolcreatedb
    OR runtime_role.rolreplication
    OR runtime_role.rolbypassrls
    OR owner_role.rolcanlogin
    OR owner_role.rolinherit
    OR owner_role.rolsuper
    OR owner_role.rolcreaterole
    OR owner_role.rolcreatedb
    OR owner_role.rolreplication
    OR owner_role.rolbypassrls
    OR cleanup_role.rolcanlogin
    OR cleanup_role.rolinherit
    OR cleanup_role.rolsuper
    OR cleanup_role.rolcreaterole
    OR cleanup_role.rolcreatedb
    OR cleanup_role.rolreplication
    OR cleanup_role.rolbypassrls
  THEN
    RAISE EXCEPTION 'Finisher terminal role attributes are not exact';
  END IF;

  IF pg_catalog.has_schema_privilege('trainer_app_runtime', 'public', 'CREATE')
    OR pg_catalog.has_schema_privilege('trainer_finisher_owner', 'public', 'CREATE')
    OR pg_catalog.has_schema_privilege('trainer_finisher_cleanup', 'public', 'CREATE')
  THEN
    RAISE EXCEPTION 'Finisher terminal roles retain temporary schema CREATE';
  END IF;

  SELECT pg_catalog.count(*) INTO protected_membership_count
  FROM pg_catalog.pg_auth_members membership
  WHERE membership.roleid IN (runtime_role.oid, owner_role.oid, cleanup_role.oid)
     OR membership.member IN (runtime_role.oid, owner_role.oid, cleanup_role.oid);

  SELECT pg_catalog.count(*) INTO automatic_membership_count
  FROM pg_catalog.pg_auth_members membership
  JOIN pg_catalog.pg_roles grantor ON grantor.oid = membership.grantor
  WHERE membership.roleid IN (runtime_role.oid, owner_role.oid, cleanup_role.oid)
    AND membership.member = executor_role.oid
    AND grantor.oid = 10
    AND grantor.rolsuper
    AND membership.admin_option
    AND NOT membership.inherit_option
    AND NOT membership.set_option;

  IF protected_membership_count <> 3 OR automatic_membership_count <> 3 THEN
    RAISE EXCEPTION 'Finisher terminal memberships are not the exact safe PostgreSQL-created set';
  END IF;

  SELECT pg_catalog.count(*) INTO default_privilege_count
  FROM pg_catalog.pg_default_acl defaults
  CROSS JOIN LATERAL pg_catalog.aclexplode(defaults.defaclacl) privilege
  WHERE defaults.defaclrole IN (runtime_role.oid, owner_role.oid, cleanup_role.oid)
     OR privilege.grantee IN (runtime_role.oid, owner_role.oid, cleanup_role.oid);
  IF default_privilege_count <> 0 THEN
    RAISE EXCEPTION 'Finisher terminal roles own or receive default privileges';
  END IF;

  WITH expected(table_name, relation_kind, owner_oid, row_security, force_row_security) AS (
    SELECT name, 'r'::"char", owner_role.oid, false, false
    FROM unnest(ARRAY[
      'FinisherRoutine', 'FinisherRoutineVersion', 'FinisherRoutineStep',
      'FinisherRoutineStepAlternative', 'FinisherOffer', 'FinisherOfferItem',
      'FinisherDecision', 'FinisherExecution', 'FinisherExecutionStep',
      'FinisherExecutionCommand'
    ]) expected_names(name)
  ), actual AS (
    SELECT class.relname, class.relkind, class.relowner,
      class.relrowsecurity, class.relforcerowsecurity
    FROM pg_catalog.pg_class class
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'public'
      AND (
        (class.relkind IN ('r', 'p') AND class.relowner = owner_role.oid)
        OR
        (class.relkind IN ('r', 'p', 'v', 'm', 'f') AND class.relname LIKE 'Finisher%')
      )
  ), differences AS (
    (SELECT * FROM expected EXCEPT SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  )
  SELECT pg_catalog.count(*) INTO terminal_mismatch_count FROM differences;
  IF terminal_mismatch_count <> 0 THEN
    RAISE EXCEPTION 'Finisher terminal table ownership or RLS state is not exact';
  END IF;

  WITH expected(table_name, column_signature) AS (
    VALUES
      ('FinisherRoutine', 'id:text:not-null:<none>|code:text:not-null:<none>|publicationState:"FinisherPublicationState":not-null:''ACTIVE''::"FinisherPublicationState"|retiredAt:timestamp(3) without time zone:nullable:<none>|createdAt:timestamp(3) without time zone:not-null:CURRENT_TIMESTAMP'),
      ('FinisherRoutineVersion', 'id:text:not-null:<none>|routineId:text:not-null:<none>|version:integer:not-null:<none>|name:text:not-null:<none>|description:text:not-null:<none>|category:"FinisherCategory":not-null:<none>|placement:"WorkoutPhasePlacement":not-null:''POST_WORKOUT''::"WorkoutPhasePlacement"|kind:"WorkoutPhaseKind":not-null:''FINISHER''::"WorkoutPhaseKind"|protocol:"WorkoutPhaseProtocol":not-null:''TIMED_INTERVALS''::"WorkoutPhaseProtocol"|difficulty:"FinisherDifficulty":not-null:<none>|fatigueCost:"FinisherDemand":not-null:<none>|impactLevel:"FinisherDemand":not-null:<none>|preparationSeconds:integer:not-null:10|includesFinalRecovery:boolean:not-null:false|equipmentRequirements:text[]:not-null:ARRAY[]::text[]|bodyRegions:text[]:not-null:ARRAY[]::text[]|limitationTags:text[]:not-null:ARRAY[]::text[]|createdAt:timestamp(3) without time zone:not-null:CURRENT_TIMESTAMP|sealedAt:timestamp(3) without time zone:nullable:<none>'),
      ('FinisherRoutineStep', 'id:text:not-null:<none>|routineVersionId:text:not-null:<none>|orderIndex:integer:not-null:<none>|movementName:text:not-null:<none>|workSeconds:integer:not-null:<none>|recoverySeconds:integer:not-null:<none>|techniqueCues:text[]:not-null:ARRAY[]::text[]'),
      ('FinisherRoutineStepAlternative', 'id:text:not-null:<none>|routineStepId:text:not-null:<none>|orderIndex:integer:not-null:<none>|movementName:text:not-null:<none>'),
      ('FinisherOffer', 'id:text:not-null:<none>|workoutId:text:not-null:<none>|ownerId:text:not-null:<none>|revision:integer:not-null:1|offeredAt:timestamp(3) without time zone:not-null:CURRENT_TIMESTAMP|declinedAt:timestamp(3) without time zone:nullable:<none>|declineDecisionId:text:nullable:<none>|recommendedRoutineVersionId:text:nullable:<none>|recommendationReason:text:nullable:<none>|recommendationUnavailableReason:text:nullable:<none>|recommendationContext:jsonb:not-null:<none>|itemCount:integer:not-null:<none>|finalizedAt:timestamp(3) without time zone:nullable:<none>'),
      ('FinisherOfferItem', 'id:text:not-null:<none>|offerId:text:not-null:<none>|routineVersionId:text:not-null:<none>|position:integer:not-null:<none>|warnings:text[]:not-null:ARRAY[]::text[]'),
      ('FinisherDecision', 'id:text:not-null:<none>|ownerId:text:not-null:<none>|workoutId:text:not-null:<none>|offerId:text:not-null:<none>|action:"FinisherDecisionAction":not-null:<none>|offerItemId:text:nullable:<none>|routineVersionId:text:nullable:<none>|expectedOfferRevision:integer:not-null:<none>|acknowledgeContraindication:boolean:nullable:<none>|requestFingerprint:text:not-null:<none>|createdAt:timestamp(3) without time zone:not-null:CURRENT_TIMESTAMP'),
      ('FinisherExecution', 'id:text:not-null:<none>|workoutId:text:not-null:<none>|ownerId:text:not-null:<none>|offerId:text:not-null:<none>|offerItemId:text:not-null:<none>|offerRevisionAtSelection:integer:not-null:<none>|routineVersionId:text:not-null:<none>|state:"FinisherExecutionState":not-null:''SELECTED''::"FinisherExecutionState"|selectedAt:timestamp(3) without time zone:not-null:CURRENT_TIMESTAMP|finalizedAt:timestamp(3) without time zone:nullable:<none>|startedAt:timestamp(3) without time zone:nullable:<none>|completedAt:timestamp(3) without time zone:nullable:<none>|endedAt:timestamp(3) without time zone:nullable:<none>|dismissedAt:timestamp(3) without time zone:nullable:<none>|timerSegment:"FinisherTimerSegment":nullable:<none>|currentStepIndex:integer:not-null:0|segmentStartedAt:timestamp(3) without time zone:nullable:<none>|segmentEndsAt:timestamp(3) without time zone:nullable:<none>|pausedAt:timestamp(3) without time zone:nullable:<none>|pausedRemainingMs:integer:nullable:<none>|preparationActiveMs:integer:not-null:0|recoveryActiveMs:integer:not-null:0|preparationPausedMs:integer:not-null:0|workPausedMs:integer:not-null:0|recoveryPausedMs:integer:not-null:0|revision:integer:not-null:1|difficultyFeedback:integer:nullable:<none>'),
      ('FinisherExecutionStep', 'id:text:not-null:<none>|executionId:text:not-null:<none>|routineStepId:text:not-null:<none>|routineVersionId:text:not-null:<none>|orderIndex:integer:not-null:<none>|performedAlternativeId:text:nullable:<none>|status:"FinisherStepStatus":not-null:''PENDING''::"FinisherStepStatus"|startedAt:timestamp(3) without time zone:nullable:<none>|resolvedAt:timestamp(3) without time zone:nullable:<none>|actualWorkMs:integer:not-null:0|note:text:nullable:<none>'),
      ('FinisherExecutionCommand', 'id:text:not-null:<none>|workoutId:text:not-null:<none>|ownerId:text:not-null:<none>|executionId:text:not-null:<none>|action:"FinisherExecutionAction":not-null:<none>|requestHash:text:not-null:<none>|expectedRevision:integer:not-null:<none>|resultRevision:integer:not-null:<none>|response:jsonb:nullable:<none>|createdAt:timestamp(3) without time zone:not-null:CURRENT_TIMESTAMP|expiresAt:timestamp(3) without time zone:not-null:<none>|cleanedAt:timestamp(3) without time zone:nullable:<none>')
  ), actual AS (
    SELECT table_class.relname AS table_name,
      pg_catalog.string_agg(
        attribute.attname || ':' ||
        pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) || ':' ||
        CASE WHEN attribute.attnotnull THEN 'not-null' ELSE 'nullable' END || ':' ||
        COALESCE(
          pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid),
          '<none>'
        ) ||
        CASE attribute.attidentity
          WHEN '' THEN ''
          ELSE ':identity=' || attribute.attidentity::text
        END ||
        CASE attribute.attgenerated
          WHEN '' THEN ''
          ELSE ':generated=' || attribute.attgenerated::text
        END,
        '|' ORDER BY attribute.attnum
      ) AS column_signature
    FROM pg_catalog.pg_attribute attribute
    JOIN pg_catalog.pg_class table_class ON table_class.oid = attribute.attrelid
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = table_class.relnamespace
    LEFT JOIN pg_catalog.pg_attrdef default_value
      ON default_value.adrelid = attribute.attrelid
      AND default_value.adnum = attribute.attnum
    WHERE namespace.nspname = 'public'
      AND table_class.relname IN (SELECT table_name FROM expected)
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
    GROUP BY table_class.relname
  ), differences AS (
    (SELECT * FROM expected EXCEPT SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  )
  SELECT pg_catalog.count(*) INTO terminal_mismatch_count FROM differences;
  IF terminal_mismatch_count <> 0 THEN
    RAISE EXCEPTION 'Finisher terminal column structure is not exact';
  END IF;

  WITH expected(
    table_name,
    index_name,
    is_unique,
    is_primary,
    key_columns,
    predicate
  ) AS (
    VALUES
      ('FinisherRoutine', 'FinisherRoutine_pkey', true, true, ARRAY['id'], NULL),
      ('FinisherRoutine', 'FinisherRoutine_code_key', true, false, ARRAY['code'], NULL),
      ('FinisherRoutineVersion', 'FinisherRoutineVersion_pkey', true, true, ARRAY['id'], NULL),
      ('FinisherRoutineVersion', 'FinisherRoutineVersion_routineId_version_key', true, false, ARRAY['routineId', 'version'], NULL),
      ('FinisherRoutineVersion', 'FinisherRoutineVersion_category_createdAt_idx', false, false, ARRAY['category', 'createdAt'], NULL),
      ('FinisherRoutineStep', 'FinisherRoutineStep_pkey', true, true, ARRAY['id'], NULL),
      ('FinisherRoutineStep', 'FinisherRoutineStep_routineVersionId_orderIndex_key', true, false, ARRAY['routineVersionId', 'orderIndex'], NULL),
      ('FinisherRoutineStep', 'FinisherRoutineStep_id_routineVersionId_orderIndex_key', true, false, ARRAY['id', 'routineVersionId', 'orderIndex'], NULL),
      ('FinisherRoutineStepAlternative', 'FinisherRoutineStepAlternative_pkey', true, true, ARRAY['id'], NULL),
      ('FinisherRoutineStepAlternative', 'FinisherRoutineStepAlternative_routineStepId_orderIndex_key', true, false, ARRAY['routineStepId', 'orderIndex'], NULL),
      ('FinisherRoutineStepAlternative', 'FinisherRoutineStepAlternative_id_routineStepId_key', true, false, ARRAY['id', 'routineStepId'], NULL),
      ('FinisherOffer', 'FinisherOffer_pkey', true, true, ARRAY['id'], NULL),
      ('FinisherOffer', 'FinisherOffer_workoutId_key', true, false, ARRAY['workoutId'], NULL),
      ('FinisherOffer', 'FinisherOffer_workoutId_ownerId_key', true, false, ARRAY['workoutId', 'ownerId'], NULL),
      ('FinisherOffer', 'FinisherOffer_declineDecisionId_key', true, false, ARRAY['declineDecisionId'], NULL),
      ('FinisherOffer', 'FinisherOffer_id_workoutId_ownerId_key', true, false, ARRAY['id', 'workoutId', 'ownerId'], NULL),
      ('FinisherOffer', 'FinisherOffer_id_recommendedRoutineVersionId_key', true, false, ARRAY['id', 'recommendedRoutineVersionId'], NULL),
      ('FinisherOffer', 'FinisherOffer_recommendedRoutineVersionId_idx', false, false, ARRAY['recommendedRoutineVersionId'], NULL),
      ('FinisherOfferItem', 'FinisherOfferItem_pkey', true, true, ARRAY['id'], NULL),
      ('FinisherOfferItem', 'FinisherOfferItem_offerId_routineVersionId_key', true, false, ARRAY['offerId', 'routineVersionId'], NULL),
      ('FinisherOfferItem', 'FinisherOfferItem_offerId_position_key', true, false, ARRAY['offerId', 'position'], NULL),
      ('FinisherOfferItem', 'FinisherOfferItem_id_offerId_routineVersionId_key', true, false, ARRAY['id', 'offerId', 'routineVersionId'], NULL),
      ('FinisherOfferItem', 'FinisherOfferItem_routineVersionId_idx', false, false, ARRAY['routineVersionId'], NULL),
      ('FinisherDecision', 'FinisherDecision_pkey', true, true, ARRAY['id'], NULL),
      ('FinisherDecision', 'FinisherDecision_offerId_createdAt_idx', false, false, ARRAY['offerId', 'createdAt'], NULL),
      ('FinisherExecution', 'FinisherExecution_pkey', true, true, ARRAY['id'], NULL),
      ('FinisherExecution', 'FinisherExecution_one_active_per_workout', true, false, ARRAY['workoutId'], '(state = ANY (ARRAY[''SELECTED''::"FinisherExecutionState", ''IN_PROGRESS''::"FinisherExecutionState"]))'),
      ('FinisherExecution', 'FinisherExecution_one_started_per_workout', true, false, ARRAY['workoutId'], '("startedAt" IS NOT NULL)'),
      ('FinisherExecution', 'FinisherExecution_workoutId_selectedAt_idx', false, false, ARRAY['workoutId', 'selectedAt'], NULL),
      ('FinisherExecution', 'FinisherExecution_offerId_selectedAt_idx', false, false, ARRAY['offerId', 'selectedAt'], NULL),
      ('FinisherExecution', 'FinisherExecution_routineVersionId_startedAt_idx', false, false, ARRAY['routineVersionId', 'startedAt'], NULL),
      ('FinisherExecution', 'FinisherExecution_state_segmentEndsAt_idx', false, false, ARRAY['state', 'segmentEndsAt'], NULL),
      ('FinisherExecution', 'FinisherExecution_id_workoutId_key', true, false, ARRAY['id', 'workoutId'], NULL),
      ('FinisherExecution', 'FinisherExecution_id_workoutId_ownerId_key', true, false, ARRAY['id', 'workoutId', 'ownerId'], NULL),
      ('FinisherExecution', 'FinisherExecution_id_routineVersionId_key', true, false, ARRAY['id', 'routineVersionId'], NULL),
      ('FinisherExecutionStep', 'FinisherExecutionStep_pkey', true, true, ARRAY['id'], NULL),
      ('FinisherExecutionStep', 'FinisherExecutionStep_executionId_routineStepId_key', true, false, ARRAY['executionId', 'routineStepId'], NULL),
      ('FinisherExecutionStep', 'FinisherExecutionStep_performedAlternativeId_idx', false, false, ARRAY['performedAlternativeId'], NULL),
      ('FinisherExecutionCommand', 'FinisherExecutionCommand_pkey', true, true, ARRAY['id'], NULL),
      ('FinisherExecutionCommand', 'FinisherExecutionCommand_executionId_createdAt_idx', false, false, ARRAY['executionId', 'createdAt'], NULL),
      ('FinisherExecutionCommand', 'FinisherExecutionCommand_cleanedAt_expiresAt_id_idx', false, false, ARRAY['cleanedAt', 'expiresAt', 'id'], NULL)
  ), expected_contract AS (
    SELECT table_name, index_name, is_unique, is_primary, 'btree'::name AS access_method,
      key_columns,
      ARRAY(
        SELECT pg_catalog.quote_ident(key_column)
        FROM unnest(key_columns) WITH ORDINALITY ordered_key(key_column, position)
        ORDER BY position
      ) AS key_definitions,
      predicate,
      true AS is_valid,
      true AS is_ready,
      true AS is_live,
      true AS is_immediate,
      false AS is_exclusion,
      false AS nulls_not_distinct,
      false AS has_included_columns,
      false AS has_expressions,
      false AS has_index_options,
      false AS has_relation_options,
      true AS uses_default_tablespace,
      true AS uses_permanent_persistence,
      owner_role.oid AS owning_relation_owner
    FROM expected
  ), actual AS (
    SELECT table_class.relname AS table_name,
      index_class.relname AS index_name,
      index_metadata.indisunique,
      index_metadata.indisprimary,
      access_method.amname,
      ARRAY(
        SELECT attribute.attname
        FROM unnest(index_metadata.indkey) WITH ORDINALITY index_key(attribute_number, position)
        LEFT JOIN pg_catalog.pg_attribute attribute
          ON attribute.attrelid = table_class.oid
          AND attribute.attnum = index_key.attribute_number
        WHERE position <= index_metadata.indnkeyatts
        ORDER BY position
      ),
      ARRAY(
        SELECT pg_catalog.pg_get_indexdef(index_metadata.indexrelid, position, false)
        FROM pg_catalog.generate_series(1, index_metadata.indnkeyatts) position
        ORDER BY position
      ),
      pg_catalog.pg_get_expr(index_metadata.indpred, index_metadata.indrelid),
      index_metadata.indisvalid,
      index_metadata.indisready,
      index_metadata.indislive,
      index_metadata.indimmediate,
      index_metadata.indisexclusion,
      index_metadata.indnullsnotdistinct,
      index_metadata.indnatts <> index_metadata.indnkeyatts,
      index_metadata.indexprs IS NOT NULL,
      EXISTS (
        SELECT 1 FROM unnest(index_metadata.indoption) option_value
        WHERE option_value <> 0
      ),
      index_class.reloptions IS NOT NULL,
      index_class.reltablespace = 0,
      index_class.relpersistence = 'p',
      table_class.relowner
    FROM pg_catalog.pg_index index_metadata
    JOIN pg_catalog.pg_class table_class
      ON table_class.oid = index_metadata.indrelid
    JOIN pg_catalog.pg_class index_class
      ON index_class.oid = index_metadata.indexrelid
    JOIN pg_catalog.pg_namespace table_namespace
      ON table_namespace.oid = table_class.relnamespace
    JOIN pg_catalog.pg_namespace index_namespace
      ON index_namespace.oid = index_class.relnamespace
    JOIN pg_catalog.pg_am access_method
      ON access_method.oid = index_class.relam
    WHERE table_namespace.nspname = 'public'
      AND index_namespace.nspname = 'public'
      AND table_class.relname IN (
        'FinisherRoutine', 'FinisherRoutineVersion', 'FinisherRoutineStep',
        'FinisherRoutineStepAlternative', 'FinisherOffer', 'FinisherOfferItem',
        'FinisherDecision', 'FinisherExecution', 'FinisherExecutionStep',
        'FinisherExecutionCommand'
      )
  ), differences AS (
    (SELECT * FROM expected_contract EXCEPT SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT SELECT * FROM expected_contract)
  )
  SELECT pg_catalog.count(*) INTO terminal_mismatch_count FROM differences;
  IF terminal_mismatch_count <> 0 THEN
    RAISE EXCEPTION 'Finisher terminal index inventory, definition, or owning-relation ownership is not exact';
  END IF;

  SELECT pg_catalog.count(*) INTO terminal_mismatch_count
  FROM (
    SELECT expected.name
    FROM unnest(ARRAY[
      'WorkoutPhasePlacement', 'WorkoutPhaseKind', 'WorkoutPhaseProtocol',
      'FinisherCategory', 'FinisherDifficulty', 'FinisherDemand',
      'FinisherPublicationState', 'FinisherExecutionState',
      'FinisherTimerSegment', 'FinisherStepStatus',
      'FinisherExecutionAction', 'FinisherDecisionAction'
    ]) expected(name)
    LEFT JOIN pg_catalog.pg_type type ON type.typname = expected.name
    LEFT JOIN pg_catalog.pg_namespace namespace
      ON namespace.oid = type.typnamespace AND namespace.nspname = 'public'
    WHERE namespace.oid IS NULL OR type.typowner <> owner_role.oid
  ) mismatches;
  IF terminal_mismatch_count <> 0 THEN
    RAISE EXCEPTION 'Finisher terminal enum ownership is not exact';
  END IF;

  WITH expected(table_name, grantee_name, privilege_type, grantor_name, is_grantable) AS (
    VALUES
      ('FinisherRoutine', 'trainer_app_runtime', 'SELECT', 'trainer_finisher_owner', false),
      ('FinisherRoutineVersion', 'trainer_app_runtime', 'SELECT', 'trainer_finisher_owner', false),
      ('FinisherRoutineStep', 'trainer_app_runtime', 'SELECT', 'trainer_finisher_owner', false),
      ('FinisherRoutineStepAlternative', 'trainer_app_runtime', 'SELECT', 'trainer_finisher_owner', false),
      ('FinisherOffer', 'trainer_app_runtime', 'SELECT', 'trainer_finisher_owner', false),
      ('FinisherOffer', 'trainer_app_runtime', 'INSERT', 'trainer_finisher_owner', false),
      ('FinisherOffer', 'trainer_app_runtime', 'UPDATE', 'trainer_finisher_owner', false),
      ('FinisherOfferItem', 'trainer_app_runtime', 'SELECT', 'trainer_finisher_owner', false),
      ('FinisherOfferItem', 'trainer_app_runtime', 'INSERT', 'trainer_finisher_owner', false),
      ('FinisherDecision', 'trainer_app_runtime', 'SELECT', 'trainer_finisher_owner', false),
      ('FinisherDecision', 'trainer_app_runtime', 'INSERT', 'trainer_finisher_owner', false),
      ('FinisherExecution', 'trainer_app_runtime', 'SELECT', 'trainer_finisher_owner', false),
      ('FinisherExecution', 'trainer_app_runtime', 'INSERT', 'trainer_finisher_owner', false),
      ('FinisherExecution', 'trainer_app_runtime', 'UPDATE', 'trainer_finisher_owner', false),
      ('FinisherExecutionStep', 'trainer_app_runtime', 'SELECT', 'trainer_finisher_owner', false),
      ('FinisherExecutionStep', 'trainer_app_runtime', 'INSERT', 'trainer_finisher_owner', false),
      ('FinisherExecutionStep', 'trainer_app_runtime', 'UPDATE', 'trainer_finisher_owner', false),
      ('FinisherExecutionCommand', 'trainer_app_runtime', 'SELECT', 'trainer_finisher_owner', false),
      ('FinisherExecutionCommand', 'trainer_app_runtime', 'INSERT', 'trainer_finisher_owner', false),
      ('FinisherExecutionCommand', 'trainer_finisher_cleanup', 'SELECT', 'trainer_finisher_owner', false)
  ), actual AS (
    SELECT class.relname, grantee.rolname, privilege.privilege_type,
      grantor.rolname, privilege.is_grantable
    FROM pg_catalog.pg_class class
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = class.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(class.relacl) privilege
    JOIN pg_catalog.pg_roles grantee ON grantee.oid = privilege.grantee
    JOIN pg_catalog.pg_roles grantor ON grantor.oid = privilege.grantor
    WHERE namespace.nspname = 'public'
      AND class.relname IN (SELECT table_name FROM expected)
      AND privilege.grantee <> owner_role.oid
  ), differences AS (
    (SELECT * FROM expected EXCEPT SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  )
  SELECT pg_catalog.count(*) INTO terminal_mismatch_count FROM differences;
  IF terminal_mismatch_count <> 0 THEN
    RAISE EXCEPTION 'Finisher terminal table grants are not exact';
  END IF;

  WITH expected(type_name, grantee_name, privilege_type, grantor_name, is_grantable) AS (
    SELECT name, 'trainer_app_runtime', 'USAGE', 'trainer_finisher_owner', false
    FROM unnest(ARRAY[
      'WorkoutPhasePlacement', 'WorkoutPhaseKind', 'WorkoutPhaseProtocol',
      'FinisherCategory', 'FinisherDifficulty', 'FinisherDemand',
      'FinisherPublicationState', 'FinisherExecutionState',
      'FinisherTimerSegment', 'FinisherStepStatus',
      'FinisherExecutionAction', 'FinisherDecisionAction'
    ]) names(name)
  ), actual AS (
    SELECT type.typname, COALESCE(grantee.rolname, 'PUBLIC'),
      privilege.privilege_type, grantor.rolname, privilege.is_grantable
    FROM pg_catalog.pg_type type
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = type.typnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(type.typacl) privilege
    LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid = privilege.grantee
    JOIN pg_catalog.pg_roles grantor ON grantor.oid = privilege.grantor
    WHERE namespace.nspname = 'public'
      AND type.typname IN (SELECT type_name FROM expected)
      AND privilege.grantee <> owner_role.oid
  ), differences AS (
    (SELECT * FROM expected EXCEPT SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  )
  SELECT pg_catalog.count(*) INTO terminal_mismatch_count FROM differences;
  IF terminal_mismatch_count <> 0 THEN
    RAISE EXCEPTION 'Finisher terminal enum grants are not exact';
  END IF;

  WITH expected(function_name, owner_name) AS (
    SELECT name, 'trainer_finisher_owner'
    FROM unnest(ARRAY[
      'guard_finisher_routine_identity',
      'require_finisher_routine_version_sealed',
      'guard_finisher_routine_version_mutation',
      'guard_finisher_routine_child_mutation',
      'require_finisher_offer_finalized',
      'require_finisher_execution_finalized',
      'validate_finisher_terminal_outcome',
      'validate_finisher_terminal_outcome_from_execution',
      'validate_finisher_terminal_outcome_from_step',
      'guard_finisher_offer_item_insert',
      'guard_finisher_execution_step_insert',
      'guard_finisher_offer_identity',
      'reject_finisher_offer_item_update',
      'guard_finisher_execution_identity',
      'guard_finisher_execution_step_identity',
      'guard_finisher_execution_lifecycle',
      'guard_finisher_decision_history',
      'require_finisher_decision_applied',
      'guard_finisher_execution_step_evidence',
      'reject_finisher_history_deletion',
      'guard_finisher_execution_command_tombstone'
    ]) names(name)
    UNION ALL
    SELECT 'cleanup_expired_finisher_execution_commands', 'trainer_finisher_cleanup'
  ), actual AS (
    SELECT procedure.proname, owner.rolname
    FROM pg_catalog.pg_proc procedure
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = procedure.pronamespace
    JOIN pg_catalog.pg_roles owner ON owner.oid = procedure.proowner
    WHERE namespace.nspname = 'public'
      AND procedure.proname IN (SELECT function_name FROM expected)
  ), differences AS (
    (SELECT * FROM expected EXCEPT SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  )
  SELECT pg_catalog.count(*) INTO terminal_mismatch_count FROM differences;
  IF terminal_mismatch_count <> 0 THEN
    RAISE EXCEPTION 'Finisher terminal function ownership is not exact';
  END IF;

  WITH expected(function_name, grantee_name, privilege_type, grantor_name, is_grantable) AS (
    VALUES
      ('validate_finisher_terminal_outcome', 'trainer_app_runtime', 'EXECUTE', 'trainer_finisher_owner', false),
      ('cleanup_expired_finisher_execution_commands', 'trainer_app_runtime', 'EXECUTE', 'trainer_finisher_cleanup', false)
  ), actual AS (
    SELECT procedure.proname, COALESCE(grantee.rolname, 'PUBLIC'),
      privilege.privilege_type, grantor.rolname, privilege.is_grantable
    FROM pg_catalog.pg_proc procedure
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = procedure.pronamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
    ) privilege
    LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid = privilege.grantee
    JOIN pg_catalog.pg_roles grantor ON grantor.oid = privilege.grantor
    WHERE namespace.nspname = 'public'
      AND procedure.proname IN (
        SELECT function_name FROM expected
        UNION
        SELECT name FROM unnest(ARRAY[
          'guard_finisher_routine_identity',
          'require_finisher_routine_version_sealed',
          'guard_finisher_routine_version_mutation',
          'guard_finisher_routine_child_mutation',
          'require_finisher_offer_finalized',
          'require_finisher_execution_finalized',
          'validate_finisher_terminal_outcome_from_execution',
          'validate_finisher_terminal_outcome_from_step',
          'guard_finisher_offer_item_insert',
          'guard_finisher_execution_step_insert',
          'guard_finisher_offer_identity',
          'reject_finisher_offer_item_update',
          'guard_finisher_execution_identity',
          'guard_finisher_execution_step_identity',
          'guard_finisher_execution_lifecycle',
          'guard_finisher_decision_history',
          'require_finisher_decision_applied',
          'guard_finisher_execution_step_evidence',
          'reject_finisher_history_deletion',
          'guard_finisher_execution_command_tombstone'
        ]) names(name)
      )
      AND privilege.grantee <> procedure.proowner
  ), differences AS (
    (SELECT * FROM expected EXCEPT SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  )
  SELECT pg_catalog.count(*) INTO terminal_mismatch_count FROM differences;
  IF terminal_mismatch_count <> 0 THEN
    RAISE EXCEPTION 'Finisher terminal function grants are not exact';
  END IF;

  WITH expected(table_name, column_name, grantee_name, privilege_type, grantor_name, is_grantable) AS (
    VALUES
      ('FinisherExecutionCommand', 'response', 'trainer_finisher_cleanup', 'UPDATE', 'trainer_finisher_owner', false),
      ('FinisherExecutionCommand', 'cleanedAt', 'trainer_finisher_cleanup', 'UPDATE', 'trainer_finisher_owner', false)
  ), actual AS (
    SELECT class.relname, attribute.attname, grantee.rolname,
      privilege.privilege_type, grantor.rolname, privilege.is_grantable
    FROM pg_catalog.pg_attribute attribute
    JOIN pg_catalog.pg_class class ON class.oid = attribute.attrelid
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = class.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) privilege
    JOIN pg_catalog.pg_roles grantee ON grantee.oid = privilege.grantee
    JOIN pg_catalog.pg_roles grantor ON grantor.oid = privilege.grantor
    WHERE namespace.nspname = 'public'
      AND class.relname LIKE 'Finisher%'
  ), differences AS (
    (SELECT * FROM expected EXCEPT SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  )
  SELECT pg_catalog.count(*) INTO terminal_mismatch_count FROM differences;
  IF terminal_mismatch_count <> 0 THEN
    RAISE EXCEPTION 'Finisher terminal column grants are not exact';
  END IF;
END;
$$;

COMMIT;
