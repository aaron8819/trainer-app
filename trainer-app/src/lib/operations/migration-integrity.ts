import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  FINISHER_ROUTINE_SEEDS,
  stableFinisherCatalogId,
} from "../../../prisma/finisher-routine-seed-data";

export const EXPECTED_MIGRATION_CHAIN = [
  "20260222_baseline",
  "20260223143249_add_weekly_schedule_to_constraints",
  "20260223155208_add_strength_hypertrophy_goal_options",
  "20260224145954_mesocycle_lifecycle_foundation",
  "20260307120000_add_mesocycle_week_close",
  "20260310120000_add_mesocycle_handoff_state",
  "20260317103000_add_mesocycle_slot_sequence_json",
  "20260319120000_add_mesocycle_slot_plan_seed_json",
  "20260602120000_add_pre_session_readiness_snapshot",
  "20260619120000_add_set_log_intent",
  "20260713180000_add_immutable_mesocycle_seed_revisions",
  "20260714120000_add_workout_exercise_stimulus_snapshot",
  "20260714120000_retire_exercise_exposure_projection",
  "20260714180000_add_post_session_review_snapshots",
  "20260714210000_make_pre_session_readiness_snapshots_atomic",
  "20260726120000_add_active_macrocycle_foundation",
  "20260727010000_add_plan_management_fields",
  "20260728120000_add_finishers_phase_1",
] as const;

export const MIGRATION_AUTHORIZATION_POLICY = {
  targetMigration: "20260728120000_add_finishers_phase_1",
  expectedPendingMigrations: [
    "20260728120000_add_finishers_phase_1",
  ],
  requiredApplicationCommit: "",
  compatibleProductionDeploymentCommits: [
    "24e9e62f70a5cf66cef21997157f7b79a411a00f",
  ],
  operationalEvidenceMaxAgeMinutes: 30,
} as const;

export const EXPECTED_GATE_A_PENDING =
  MIGRATION_AUTHORIZATION_POLICY.expectedPendingMigrations;

export type ApplicationCompatibilityState =
  | "compatible_with_write_boundary"
  | "incompatible"
  | "unverified";

export type VerificationEvidence = {
  valid: boolean;
  verifiedAt: string;
  repositoryHead?: string;
  targetFingerprint?: string;
};

export type RecoveryPointEvidence = {
  verified: boolean;
  providerProjectIdentity: string;
  databaseIdentity: string;
  recoveryTimestamp: string;
  retentionConfirmed: boolean;
  recoverabilityConfirmed: boolean;
  freshForExecution: boolean;
  operatorVerifiedAt: string;
};

export type WriteBoundaryEvidence = {
  ready: boolean;
  mechanism: "production-write-gate";
  verifiedAt: string;
};

export type MigrationAuthorizationEvidence = {
  repositoryHead: string;
  productionDeploymentCommit: string;
  requiredApplicationCommit?: string;
  expectedPendingMigrations?: string[];
  dataPreflight?: VerificationEvidence;
  disposablePostgres?: VerificationEvidence;
  recoveryPoint?: RecoveryPointEvidence;
  writeBoundary?: WriteBoundaryEvidence;
  applicationCompatibilityState?: ApplicationCompatibilityState;
  deploymentVerifiedAt?: string;
  evaluatedAt?: string;
};

export type LedgerRow = {
  id: string;
  migrationName: string;
  checksum: string | null;
  finishedAt: string | null;
  rolledBackAt: string | null;
  logs: string | null;
  appliedStepsCount: number;
};

export type ColumnFact = {
  table: string;
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
};

export type EnumFact = { name: string; values: string[] };
export type IndexFact = {
  table: string;
  name: string;
  unique: boolean;
  columns: string[];
  predicate: string | null;
  nullsNotDistinct?: boolean;
  valid?: boolean;
  ready?: boolean;
  live?: boolean;
  constraintName?: string | null;
  constraintType?: string | null;
};
export type ConstraintFact = { table: string; name: string; type: string; definition: string };
export type TriggerFact = { table: string; name: string; definition: string };
export type FunctionFact = { name: string; definition: string };
export type CatalogRowFact = {
  table: string;
  key: string;
  values: Record<string, unknown>;
};
export type CatalogSnapshot = {
  tables: string[];
  columns: ColumnFact[];
  enums: EnumFact[];
  indexes: IndexFact[];
  constraints: ConstraintFact[];
  triggers: TriggerFact[];
  functions: FunctionFact[];
  catalogRows: CatalogRowFact[];
  unableToVerify?: string[];
};

export type CheckedInMigration = {
  name: string;
  checksum: string;
  compatibleChecksums?: string[];
  sqlPath: string;
};

export type UniquenessRepresentation =
  | "standalone_unique_index"
  | "standalone_non_unique_index"
  | "unique_constraint_backed_index"
  | "missing"
  | "incompatible_constraint_backed_index";

export type BaselineUniquenessExpectation = {
  table: string;
  name: string;
  columns: string[];
  predicate: string | null;
  nullsNotDistinct: boolean;
  expectedRepresentation: "standalone_unique_index";
  pendingMigrationDependsOnRepresentation: boolean;
};

export const BASELINE_UNIQUENESS_EXPECTATIONS: readonly BaselineUniquenessExpectation[] = [
  {
    table: "ExerciseAlias",
    name: "ExerciseAlias_alias_key",
    columns: ["alias"],
    predicate: null,
    nullsNotDistinct: false,
    expectedRepresentation: "standalone_unique_index",
    pendingMigrationDependsOnRepresentation: false,
  },
  {
    table: "WorkoutTemplateExercise",
    name: "WorkoutTemplateExercise_templateId_orderIndex_key",
    columns: ["templateId", "orderIndex"],
    predicate: null,
    nullsNotDistinct: false,
    expectedRepresentation: "standalone_unique_index",
    pendingMigrationDependsOnRepresentation: false,
  },
] as const;

type ObjectKind =
  | "table"
  | "column"
  | "enum"
  | "index"
  | "constraint"
  | "trigger"
  | "function"
  | "catalogRow";
type ObjectExpectation = {
  kind: ObjectKind;
  name: string;
  table?: string;
  column?: Pick<ColumnFact, "type" | "nullable" | "default">;
  enum?: Pick<EnumFact, "values">;
  index?: Pick<IndexFact, "unique" | "columns" | "predicate">;
  constraint?: { type: string; definition?: string };
  row?: Record<string, unknown>;
  definitionIncludes?: string[];
};

export type PendingMigrationExpectation = {
  migration: string;
  effect: "objects" | "comments_only";
  retainedObjects?: string[];
  objects: ObjectExpectation[];
};

const finisherColumn = (
  table: string,
  name: string,
  type: string,
  nullable: boolean,
  defaultValue: string | null = null,
): ObjectExpectation => ({
  kind: "column",
  table,
  name,
  column: { type, nullable, default: defaultValue },
});

const finisherIndex = (
  table: string,
  name: string,
  unique: boolean,
  columns: string[],
  predicate: string | null = null,
): ObjectExpectation => ({
  kind: "index",
  table,
  name,
  index: { unique, columns, predicate },
});

const finisherConstraint = (
  table: string,
  name: string,
  type: string,
  definitionIncludes: string[],
): ObjectExpectation => ({
  kind: "constraint",
  table,
  name,
  constraint: { type },
  definitionIncludes,
});

const FINISHER_TABLE_COLUMNS: Record<
  string,
  Array<[string, string, boolean, (string | null)?]>
> = {
  FinisherRoutine: [
    ["id", "text", false],
    ["code", "text", false],
    [
      "publicationState",
      '"FinisherPublicationState"',
      false,
      "'ACTIVE'::\"FinisherPublicationState\"",
    ],
    ["retiredAt", "timestamp(3) without time zone", true],
    [
      "createdAt",
      "timestamp(3) without time zone",
      false,
      "CURRENT_TIMESTAMP",
    ],
  ],
  FinisherRoutineVersion: [
    ["id", "text", false],
    ["routineId", "text", false],
    ["version", "integer", false],
    ["name", "text", false],
    ["description", "text", false],
    ["category", '"FinisherCategory"', false],
    [
      "placement",
      '"WorkoutPhasePlacement"',
      false,
      "'POST_WORKOUT'::\"WorkoutPhasePlacement\"",
    ],
    [
      "kind",
      '"WorkoutPhaseKind"',
      false,
      "'FINISHER'::\"WorkoutPhaseKind\"",
    ],
    [
      "protocol",
      '"WorkoutPhaseProtocol"',
      false,
      "'TIMED_INTERVALS'::\"WorkoutPhaseProtocol\"",
    ],
    ["difficulty", '"FinisherDifficulty"', false],
    ["fatigueCost", '"FinisherDemand"', false],
    ["impactLevel", '"FinisherDemand"', false],
    ["preparationSeconds", "integer", false, "10"],
    ["includesFinalRecovery", "boolean", false, "false"],
    ["equipmentRequirements", "text[]", false, "ARRAY[]::text[]"],
    ["bodyRegions", "text[]", false, "ARRAY[]::text[]"],
    ["limitationTags", "text[]", false, "ARRAY[]::text[]"],
    [
      "createdAt",
      "timestamp(3) without time zone",
      false,
      "CURRENT_TIMESTAMP",
    ],
    ["sealedAt", "timestamp(3) without time zone", true],
  ],
  FinisherRoutineStep: [
    ["id", "text", false],
    ["routineVersionId", "text", false],
    ["orderIndex", "integer", false],
    ["movementName", "text", false],
    ["workSeconds", "integer", false],
    ["recoverySeconds", "integer", false],
    ["techniqueCues", "text[]", false, "ARRAY[]::text[]"],
  ],
  FinisherRoutineStepAlternative: [
    ["id", "text", false],
    ["routineStepId", "text", false],
    ["orderIndex", "integer", false],
    ["movementName", "text", false],
  ],
  FinisherOffer: [
    ["id", "text", false],
    ["workoutId", "text", false],
    ["revision", "integer", false, "1"],
    [
      "offeredAt",
      "timestamp(3) without time zone",
      false,
      "CURRENT_TIMESTAMP",
    ],
    ["declinedAt", "timestamp(3) without time zone", true],
    ["declineDecisionId", "text", true],
    ["recommendedRoutineVersionId", "text", true],
    ["recommendationReason", "text", true],
    ["recommendationUnavailableReason", "text", true],
    ["recommendationContext", "jsonb", false],
  ],
  FinisherOfferItem: [
    ["id", "text", false],
    ["offerId", "text", false],
    ["routineVersionId", "text", false],
    ["position", "integer", false],
    ["warnings", "text[]", false, "ARRAY[]::text[]"],
  ],
  FinisherExecution: [
    ["id", "text", false],
    ["workoutId", "text", false],
    ["offerId", "text", false],
    ["offerRevisionAtSelection", "integer", false],
    ["routineVersionId", "text", false],
    [
      "state",
      '"FinisherExecutionState"',
      false,
      "'SELECTED'::\"FinisherExecutionState\"",
    ],
    [
      "selectedAt",
      "timestamp(3) without time zone",
      false,
      "CURRENT_TIMESTAMP",
    ],
    ["startedAt", "timestamp(3) without time zone", true],
    ["completedAt", "timestamp(3) without time zone", true],
    ["endedAt", "timestamp(3) without time zone", true],
    ["dismissedAt", "timestamp(3) without time zone", true],
    ["timerSegment", '"FinisherTimerSegment"', true],
    ["currentStepIndex", "integer", false, "0"],
    ["segmentStartedAt", "timestamp(3) without time zone", true],
    ["segmentEndsAt", "timestamp(3) without time zone", true],
    ["pausedAt", "timestamp(3) without time zone", true],
    ["pausedRemainingMs", "integer", true],
    ["preparationActiveMs", "integer", false, "0"],
    ["recoveryActiveMs", "integer", false, "0"],
    ["preparationPausedMs", "integer", false, "0"],
    ["workPausedMs", "integer", false, "0"],
    ["recoveryPausedMs", "integer", false, "0"],
    ["revision", "integer", false, "1"],
    ["difficultyFeedback", "integer", true],
  ],
  FinisherExecutionStep: [
    ["id", "text", false],
    ["executionId", "text", false],
    ["routineStepId", "text", false],
    ["performedAlternativeId", "text", true],
    [
      "status",
      '"FinisherStepStatus"',
      false,
      "'PENDING'::\"FinisherStepStatus\"",
    ],
    ["startedAt", "timestamp(3) without time zone", true],
    ["resolvedAt", "timestamp(3) without time zone", true],
    ["actualWorkMs", "integer", false, "0"],
    ["note", "text", true],
  ],
  FinisherExecutionCommand: [
    ["id", "text", false],
    ["workoutId", "text", false],
    ["executionId", "text", false],
    ["action", '"FinisherExecutionAction"', false],
    ["requestHash", "text", false],
    ["expectedRevision", "integer", false],
    ["resultRevision", "integer", false],
    ["response", "jsonb", false],
    [
      "createdAt",
      "timestamp(3) without time zone",
      false,
      "CURRENT_TIMESTAMP",
    ],
    ["expiresAt", "timestamp(3) without time zone", false],
  ],
};

const FINISHER_CATALOG_EXPECTATIONS: ObjectExpectation[] =
  FINISHER_ROUTINE_SEEDS.flatMap((definition) => {
    const routineId = stableFinisherCatalogId(`routine:${definition.code}`);
    const versionId = stableFinisherCatalogId(
      `version:${definition.code}:${definition.version}`,
    );
    return [
      {
        kind: "catalogRow",
        table: "FinisherRoutine",
        name: routineId,
        row: {
          id: routineId,
          code: definition.code,
          publicationState: "ACTIVE",
          retiredAt: null,
        },
      },
      {
        kind: "catalogRow",
        table: "FinisherRoutineVersion",
        name: versionId,
        row: {
          id: versionId,
          routineId,
          version: definition.version,
          name: definition.name,
          description: definition.description,
          category: definition.category,
          placement: "POST_WORKOUT",
          kind: "FINISHER",
          protocol: "TIMED_INTERVALS",
          difficulty: definition.difficulty,
          fatigueCost: definition.fatigueCost,
          impactLevel: definition.impactLevel,
          preparationSeconds: definition.preparationSeconds,
          includesFinalRecovery: definition.includesFinalRecovery,
          equipmentRequirements: definition.equipmentRequirements,
          bodyRegions: definition.bodyRegions,
          limitationTags: definition.limitationTags,
          sealed: true,
        },
      },
      ...definition.steps.flatMap((step, orderIndex) => {
        const stepId = stableFinisherCatalogId(
          `step:${definition.code}:${definition.version}:${orderIndex}`,
        );
        return [
          {
            kind: "catalogRow" as const,
            table: "FinisherRoutineStep",
            name: stepId,
            row: {
              id: stepId,
              routineVersionId: versionId,
              orderIndex,
              movementName: step.movementName,
              workSeconds: step.workSeconds,
              recoverySeconds: step.recoverySeconds,
              techniqueCues: step.techniqueCues,
            },
          },
          ...(step.alternatives ?? []).map(
            (movementName, alternativeIndex) => {
              const alternativeId = stableFinisherCatalogId(
                `alternative:${definition.code}:${definition.version}:${orderIndex}:${alternativeIndex}`,
              );
              return {
                kind: "catalogRow" as const,
                table: "FinisherRoutineStepAlternative",
                name: alternativeId,
                row: {
                  id: alternativeId,
                  routineStepId: stepId,
                  orderIndex: alternativeIndex,
                  movementName,
                },
              };
            },
          ),
        ];
      }),
    ] as ObjectExpectation[];
  });

const FINISHER_SCHEMA_EXPECTATIONS: ObjectExpectation[] = [
  ...Object.entries(FINISHER_TABLE_COLUMNS).flatMap(([table, columns]) => [
    { kind: "table" as const, name: table },
    ...columns.map(([name, type, nullable, defaultValue]) =>
      finisherColumn(table, name, type, nullable, defaultValue ?? null),
    ),
  ]),
  ...[
    ["WorkoutPhasePlacement", ["POST_WORKOUT"]],
    ["WorkoutPhaseKind", ["FINISHER"]],
    ["WorkoutPhaseProtocol", ["TIMED_INTERVALS"]],
    ["FinisherCategory", ["CORE", "CONDITIONING"]],
    ["FinisherDifficulty", ["EASY", "MODERATE", "CHALLENGING"]],
    ["FinisherDemand", ["LOW", "MODERATE", "HIGH"]],
    ["FinisherPublicationState", ["ACTIVE", "RETIRED"]],
    [
      "FinisherExecutionState",
      [
        "SELECTED",
        "IN_PROGRESS",
        "COMPLETED",
        "PARTIAL",
        "SKIPPED",
        "DISMISSED",
      ],
    ],
    [
      "FinisherTimerSegment",
      ["PREPARATION", "WORK", "RECOVERY", "FINISHED"],
    ],
    [
      "FinisherStepStatus",
      ["PENDING", "PARTIAL", "COMPLETED", "SKIPPED"],
    ],
    [
      "FinisherExecutionAction",
      [
        "START",
        "SYNC",
        "PAUSE",
        "RESUME",
        "SKIP",
        "SUBSTITUTE",
        "END",
        "FEEDBACK",
        "DISMISS",
      ],
    ],
  ].map(([name, values]) => ({
    kind: "enum" as const,
    name: name as string,
    enum: { values: values as string[] },
  })),
  ...[
    ["FinisherRoutine", "FinisherRoutine_code_key", true, ["code"], null],
    [
      "FinisherRoutineVersion",
      "FinisherRoutineVersion_routineId_version_key",
      true,
      ["routineId", "version"],
      null,
    ],
    [
      "FinisherRoutineVersion",
      "FinisherRoutineVersion_category_createdAt_idx",
      false,
      ["category", "createdAt"],
      null,
    ],
    [
      "FinisherRoutineStep",
      "FinisherRoutineStep_routineVersionId_orderIndex_key",
      true,
      ["routineVersionId", "orderIndex"],
      null,
    ],
    [
      "FinisherRoutineStepAlternative",
      "FinisherRoutineStepAlternative_routineStepId_orderIndex_key",
      true,
      ["routineStepId", "orderIndex"],
      null,
    ],
    ["FinisherOffer", "FinisherOffer_workoutId_key", true, ["workoutId"], null],
    [
      "FinisherOffer",
      "FinisherOffer_declineDecisionId_key",
      true,
      ["declineDecisionId"],
      null,
    ],
    [
      "FinisherOffer",
      "FinisherOffer_recommendedRoutineVersionId_idx",
      false,
      ["recommendedRoutineVersionId"],
      null,
    ],
    [
      "FinisherOfferItem",
      "FinisherOfferItem_offerId_routineVersionId_key",
      true,
      ["offerId", "routineVersionId"],
      null,
    ],
    [
      "FinisherOfferItem",
      "FinisherOfferItem_offerId_position_key",
      true,
      ["offerId", "position"],
      null,
    ],
    [
      "FinisherOfferItem",
      "FinisherOfferItem_routineVersionId_idx",
      false,
      ["routineVersionId"],
      null,
    ],
    [
      "FinisherExecution",
      "FinisherExecution_one_active_per_workout",
      true,
      ["workoutId"],
      "state = ANY (ARRAY['SELECTED'::\"FinisherExecutionState\", 'IN_PROGRESS'::\"FinisherExecutionState\"])",
    ],
    [
      "FinisherExecution",
      "FinisherExecution_one_started_per_workout",
      true,
      ["workoutId"],
      '"startedAt" IS NOT NULL',
    ],
    [
      "FinisherExecution",
      "FinisherExecution_workoutId_selectedAt_idx",
      false,
      ["workoutId", "selectedAt"],
      null,
    ],
    [
      "FinisherExecution",
      "FinisherExecution_offerId_selectedAt_idx",
      false,
      ["offerId", "selectedAt"],
      null,
    ],
    [
      "FinisherExecution",
      "FinisherExecution_routineVersionId_startedAt_idx",
      false,
      ["routineVersionId", "startedAt"],
      null,
    ],
    [
      "FinisherExecution",
      "FinisherExecution_state_segmentEndsAt_idx",
      false,
      ["state", "segmentEndsAt"],
      null,
    ],
    [
      "FinisherExecution",
      "FinisherExecution_id_workoutId_key",
      true,
      ["id", "workoutId"],
      null,
    ],
    [
      "FinisherExecutionStep",
      "FinisherExecutionStep_executionId_routineStepId_key",
      true,
      ["executionId", "routineStepId"],
      null,
    ],
    [
      "FinisherExecutionStep",
      "FinisherExecutionStep_performedAlternativeId_idx",
      false,
      ["performedAlternativeId"],
      null,
    ],
    [
      "FinisherExecutionCommand",
      "FinisherExecutionCommand_executionId_createdAt_idx",
      false,
      ["executionId", "createdAt"],
      null,
    ],
    [
      "FinisherExecutionCommand",
      "FinisherExecutionCommand_expiresAt_idx",
      false,
      ["expiresAt"],
      null,
    ],
  ].map(([table, name, unique, columns, predicate]) =>
    finisherIndex(
      table as string,
      name as string,
      unique as boolean,
      columns as string[],
      predicate as string | null,
    ),
  ),
  ...Object.keys(FINISHER_TABLE_COLUMNS).map((table) =>
    finisherConstraint(table, `${table}_pkey`, "p", ["PRIMARY KEY", "(id)"]),
  ),
  ...[
    ["FinisherRoutineVersion", "FinisherRoutineVersion_positive_version", ["version", "> 0"]],
    ["FinisherRoutineVersion", "FinisherRoutineVersion_preparation_range", ["preparationSeconds", ">= 0", "<= 60"]],
    ["FinisherRoutineStep", "FinisherRoutineStep_order_nonnegative", ["orderIndex", ">= 0"]],
    ["FinisherRoutineStep", "FinisherRoutineStep_work_positive", ["workSeconds", "> 0"]],
    ["FinisherRoutineStep", "FinisherRoutineStep_recovery_nonnegative", ["recoverySeconds", ">= 0"]],
    ["FinisherRoutineStepAlternative", "FinisherRoutineStepAlternative_order_nonnegative", ["orderIndex", ">= 0"]],
    ["FinisherOffer", "FinisherOffer_revision_positive", ["revision", "> 0"]],
    ["FinisherOfferItem", "FinisherOfferItem_position_nonnegative", ["position", ">= 0"]],
    ["FinisherExecution", "FinisherExecution_offer_revision_positive", ["offerRevisionAtSelection", "> 0"]],
    ["FinisherExecution", "FinisherExecution_step_nonnegative", ["currentStepIndex", ">= 0"]],
    ["FinisherExecution", "FinisherExecution_pause_nonnegative", ["pausedRemainingMs", "IS NULL", ">= 0"]],
    ["FinisherExecution", "FinisherExecution_preparation_active_nonnegative", ["preparationActiveMs", ">= 0"]],
    ["FinisherExecution", "FinisherExecution_recovery_active_nonnegative", ["recoveryActiveMs", ">= 0"]],
    ["FinisherExecution", "FinisherExecution_preparation_pause_nonnegative", ["preparationPausedMs", ">= 0"]],
    ["FinisherExecution", "FinisherExecution_work_pause_nonnegative", ["workPausedMs", ">= 0"]],
    ["FinisherExecution", "FinisherExecution_recovery_pause_nonnegative", ["recoveryPausedMs", ">= 0"]],
    ["FinisherExecution", "FinisherExecution_revision_positive", ["revision", "> 0"]],
    ["FinisherExecution", "FinisherExecution_feedback_range", ["difficultyFeedback", ">= 1", "<= 10"]],
    ["FinisherExecutionStep", "FinisherExecutionStep_actual_work_nonnegative", ["actualWorkMs", ">= 0"]],
    ["FinisherExecutionCommand", "FinisherExecutionCommand_expected_revision_positive", ["expectedRevision", "> 0"]],
    ["FinisherExecutionCommand", "FinisherExecutionCommand_result_revision_positive", ["resultRevision", "> 0"]],
  ].map(([table, name, includes]) =>
    finisherConstraint(table as string, name as string, "c", includes as string[]),
  ),
  ...[
    ["FinisherRoutineVersion", "FinisherRoutineVersion_routineId_fkey", ["routineId", "FinisherRoutine", "ON UPDATE CASCADE", "ON DELETE RESTRICT"]],
    ["FinisherRoutineStep", "FinisherRoutineStep_routineVersionId_fkey", ["routineVersionId", "FinisherRoutineVersion", "ON UPDATE CASCADE", "ON DELETE RESTRICT"]],
    ["FinisherRoutineStepAlternative", "FinisherRoutineStepAlternative_routineStepId_fkey", ["routineStepId", "FinisherRoutineStep", "ON UPDATE CASCADE", "ON DELETE RESTRICT"]],
    ["FinisherOffer", "FinisherOffer_workoutId_fkey", ["workoutId", "Workout", "ON UPDATE CASCADE", "ON DELETE RESTRICT"]],
    ["FinisherOffer", "FinisherOffer_recommendedRoutineVersionId_fkey", ["recommendedRoutineVersionId", "FinisherRoutineVersion", "ON UPDATE CASCADE", "ON DELETE RESTRICT"]],
    ["FinisherOfferItem", "FinisherOfferItem_offerId_fkey", ["offerId", "FinisherOffer", "ON UPDATE CASCADE", "ON DELETE RESTRICT"]],
    ["FinisherOfferItem", "FinisherOfferItem_routineVersionId_fkey", ["routineVersionId", "FinisherRoutineVersion", "ON UPDATE CASCADE", "ON DELETE RESTRICT"]],
    ["FinisherExecution", "FinisherExecution_workoutId_fkey", ["workoutId", "Workout", "ON UPDATE CASCADE", "ON DELETE RESTRICT"]],
    ["FinisherExecution", "FinisherExecution_offerId_fkey", ["offerId", "FinisherOffer", "ON UPDATE CASCADE", "ON DELETE RESTRICT"]],
    ["FinisherExecution", "FinisherExecution_routineVersionId_fkey", ["routineVersionId", "FinisherRoutineVersion", "ON UPDATE CASCADE", "ON DELETE RESTRICT"]],
    ["FinisherExecutionStep", "FinisherExecutionStep_executionId_fkey", ["executionId", "FinisherExecution", "ON UPDATE CASCADE", "ON DELETE CASCADE"]],
    ["FinisherExecutionStep", "FinisherExecutionStep_routineStepId_fkey", ["routineStepId", "FinisherRoutineStep", "ON UPDATE CASCADE", "ON DELETE RESTRICT"]],
    ["FinisherExecutionStep", "FinisherExecutionStep_performedAlternativeId_fkey", ["performedAlternativeId", "FinisherRoutineStepAlternative", "ON UPDATE CASCADE", "ON DELETE RESTRICT"]],
    ["FinisherExecutionCommand", "FinisherExecutionCommand_executionId_workoutId_fkey", ["executionId", "workoutId", "FinisherExecution", "ON UPDATE CASCADE", "ON DELETE RESTRICT"]],
  ].map(([table, name, includes]) =>
    finisherConstraint(table as string, name as string, "f", includes as string[]),
  ),
  ...[
    ["guard_finisher_routine_identity", ["finisher routine identity is immutable"]],
    ["require_finisher_routine_version_sealed", ["must be sealed before commit"]],
    ["guard_finisher_routine_version_mutation", ["finisher routine versions are immutable"]],
    ["guard_finisher_routine_child_mutation", ["sealed finisher routine version children are immutable"]],
    ["guard_finisher_offer_identity", ["finisher offer identity and definition binding are immutable"]],
    ["reject_finisher_offer_item_update", ["finisher offer items are immutable"]],
    ["guard_finisher_execution_identity", ["finisher execution identity and definition binding are immutable"]],
    ["guard_finisher_execution_step_identity", ["finisher execution step identity is immutable"]],
    ["reject_finisher_history_deletion", ["finisher lifecycle history cannot be deleted"]],
  ].map(([name, definitionIncludes]) => ({
    kind: "function" as const,
    name: name as string,
    definitionIncludes: definitionIncludes as string[],
  })),
  ...[
    ["FinisherRoutine", "FinisherRoutine_identity_immutable", "guard_finisher_routine_identity"],
    ["FinisherRoutineVersion", "FinisherRoutineVersion_require_sealed", "require_finisher_routine_version_sealed"],
    ["FinisherRoutineVersion", "FinisherRoutineVersion_immutable", "guard_finisher_routine_version_mutation"],
    ["FinisherRoutineStep", "FinisherRoutineStep_immutable", "guard_finisher_routine_child_mutation"],
    ["FinisherRoutineStepAlternative", "FinisherRoutineStepAlternative_immutable", "guard_finisher_routine_child_mutation"],
    ["FinisherOffer", "FinisherOffer_identity_immutable", "guard_finisher_offer_identity"],
    ["FinisherOfferItem", "FinisherOfferItem_immutable", "reject_finisher_offer_item_update"],
    ["FinisherExecution", "FinisherExecution_identity_immutable", "guard_finisher_execution_identity"],
    ["FinisherExecutionStep", "FinisherExecutionStep_identity_immutable", "guard_finisher_execution_step_identity"],
    ["FinisherOffer", "FinisherOffer_no_delete", "reject_finisher_history_deletion"],
    ["FinisherOfferItem", "FinisherOfferItem_no_delete", "reject_finisher_history_deletion"],
    ["FinisherExecution", "FinisherExecution_no_delete", "reject_finisher_history_deletion"],
    ["FinisherExecutionStep", "FinisherExecutionStep_no_delete", "reject_finisher_history_deletion"],
  ].map(([table, name, owner]) => ({
    kind: "trigger" as const,
    table,
    name,
    definitionIncludes: [owner],
  })),
  ...FINISHER_CATALOG_EXPECTATIONS,
];

export const PENDING_ARCHITECTURE_MANIFEST: readonly PendingMigrationExpectation[] = [
  {
    migration: "20260713180000_add_immutable_mesocycle_seed_revisions",
    effect: "objects",
    objects: [
      { kind: "table", name: "MesocycleSeedRevision" },
      ...[
        ["id", "text", false, null], ["mesocycleId", "text", false, null],
        ["revision", "integer", false, null], ["seedPayload", "jsonb", false, null],
        ["payloadHash", "text", true, null], ["hashAlgorithm", "text", true, null],
        ["provenanceStatus", "text", false, null], ["creationReason", "text", false, null],
        ["actorSource", "text", true, null], ["sourceRevisionId", "text", true, null],
        ["activatedAt", "timestamp(3) without time zone", false, "CURRENT_TIMESTAMP"],
        ["createdAt", "timestamp(3) without time zone", false, "CURRENT_TIMESTAMP"],
      ].map(([name, type, nullable, defaultValue]) => ({ kind: "column" as const, table: "MesocycleSeedRevision", name: name as string, column: { type: type as string, nullable: nullable as boolean, default: defaultValue as string | null } })),
      { kind: "column", table: "Mesocycle", name: "currentSeedRevisionId", column: { type: "text", nullable: true, default: null } },
      { kind: "column", table: "Workout", name: "seedRevisionId", column: { type: "text", nullable: true, default: null } },
      { kind: "column", table: "Workout", name: "seedRevisionNumber", column: { type: "integer", nullable: true, default: null } },
      { kind: "column", table: "Workout", name: "seedPayloadHash", column: { type: "text", nullable: true, default: null } },
      { kind: "constraint", table: "MesocycleSeedRevision", name: "MesocycleSeedRevision_pkey", constraint: { type: "p", definition: "PRIMARY KEY (id)" } },
      { kind: "index", table: "Mesocycle", name: "Mesocycle_currentSeedRevisionId_key", index: { unique: true, columns: ["currentSeedRevisionId"], predicate: null } },
      { kind: "index", table: "MesocycleSeedRevision", name: "MesocycleSeedRevision_mesocycleId_revision_key", index: { unique: true, columns: ["mesocycleId", "revision"], predicate: null } },
      { kind: "index", table: "MesocycleSeedRevision", name: "MesocycleSeedRevision_mesocycleId_payloadHash_key", index: { unique: true, columns: ["mesocycleId", "payloadHash"], predicate: null } },
      { kind: "index", table: "MesocycleSeedRevision", name: "MesocycleSeedRevision_sourceRevisionId_idx", index: { unique: false, columns: ["sourceRevisionId"], predicate: null } },
      { kind: "index", table: "MesocycleSeedRevision", name: "MesocycleSeedRevision_mesocycleId_activatedAt_idx", index: { unique: false, columns: ["mesocycleId", "activatedAt"], predicate: null } },
      { kind: "index", table: "Workout", name: "Workout_seedRevisionId_idx", index: { unique: false, columns: ["seedRevisionId"], predicate: null } },
      { kind: "constraint", table: "MesocycleSeedRevision", name: "MesocycleSeedRevision_mesocycleId_fkey", constraint: { type: "f", definition: "FOREIGN KEY (\"mesocycleId\") REFERENCES \"Mesocycle\"(id) ON UPDATE CASCADE ON DELETE RESTRICT" } },
      { kind: "constraint", table: "MesocycleSeedRevision", name: "MesocycleSeedRevision_sourceRevisionId_fkey", constraint: { type: "f", definition: "FOREIGN KEY (\"sourceRevisionId\") REFERENCES \"MesocycleSeedRevision\"(id) ON UPDATE CASCADE ON DELETE RESTRICT" } },
      { kind: "constraint", table: "Mesocycle", name: "Mesocycle_currentSeedRevisionId_fkey", constraint: { type: "f", definition: "FOREIGN KEY (\"currentSeedRevisionId\") REFERENCES \"MesocycleSeedRevision\"(id) ON UPDATE CASCADE ON DELETE RESTRICT" } },
      { kind: "constraint", table: "Workout", name: "Workout_seedRevisionId_fkey", constraint: { type: "f", definition: "FOREIGN KEY (\"seedRevisionId\") REFERENCES \"MesocycleSeedRevision\"(id) ON UPDATE CASCADE ON DELETE RESTRICT" } },
      { kind: "function", name: "prevent_mesocycle_seed_revision_mutation", definitionIncludes: ["MesocycleSeedRevision rows are immutable"] },
      { kind: "trigger", table: "MesocycleSeedRevision", name: "MesocycleSeedRevision_immutable_mutation", definitionIncludes: ["BEFORE DELETE OR UPDATE", "prevent_mesocycle_seed_revision_mutation"] },
    ],
  },
  {
    migration: "20260714120000_add_workout_exercise_stimulus_snapshot",
    effect: "objects",
    objects: [{ kind: "column", table: "WorkoutExercise", name: "stimulusAccountingSnapshot", column: { type: "jsonb", nullable: true, default: null } }],
  },
  {
    migration: "20260714120000_retire_exercise_exposure_projection",
    effect: "comments_only",
    retainedObjects: ["ExerciseExposure"],
    objects: [],
  },
  {
    migration: "20260714180000_add_post_session_review_snapshots",
    effect: "objects",
    objects: [
      { kind: "table", name: "PostSessionReviewSnapshot" },
      ...[
        ["id", "text", false, null], ["workoutId", "text", false, null],
        ["contractVersion", "integer", false, null], ["computationPolicyVersion", "integer", false, null],
        ["payload", "jsonb", false, null], ["payloadHash", "text", false, null],
        ["evidenceFingerprint", "text", false, null], ["provenance", "text", false, null],
        ["finalizedAt", "timestamp(3) without time zone", false, null],
        ["createdAt", "timestamp(3) without time zone", false, "CURRENT_TIMESTAMP"],
      ].map(([name, type, nullable, defaultValue]) => ({ kind: "column" as const, table: "PostSessionReviewSnapshot", name: name as string, column: { type: type as string, nullable: nullable as boolean, default: defaultValue as string | null } })),
      { kind: "constraint", table: "PostSessionReviewSnapshot", name: "PostSessionReviewSnapshot_pkey", constraint: { type: "p", definition: "PRIMARY KEY (id)" } },
      { kind: "constraint", table: "PostSessionReviewSnapshot", name: "PostSessionReviewSnapshot_provenance_check", definitionIncludes: ["provenance", "legacy_derived", "legacy_unknown"] },
      { kind: "index", table: "PostSessionReviewSnapshot", name: "PostSessionReviewSnapshot_workoutId_key", index: { unique: true, columns: ["workoutId"], predicate: null } },
      { kind: "index", table: "PostSessionReviewSnapshot", name: "PostSessionReviewSnapshot_provenance_finalizedAt_idx", index: { unique: false, columns: ["provenance", "finalizedAt"], predicate: null } },
      { kind: "index", table: "PostSessionReviewSnapshot", name: "PostSessionReviewSnapshot_contractVersion_computationPolicyVers", index: { unique: false, columns: ["contractVersion", "computationPolicyVersion"], predicate: null } },
      { kind: "constraint", table: "PostSessionReviewSnapshot", name: "PostSessionReviewSnapshot_workoutId_fkey", constraint: { type: "f", definition: "FOREIGN KEY (\"workoutId\") REFERENCES \"Workout\"(id) ON UPDATE CASCADE ON DELETE RESTRICT" } },
      { kind: "function", name: "prevent_post_session_review_snapshot_mutation", definitionIncludes: ["PostSessionReviewSnapshot rows are immutable"] },
      { kind: "trigger", table: "PostSessionReviewSnapshot", name: "PostSessionReviewSnapshot_immutable_mutation", definitionIncludes: ["BEFORE DELETE OR UPDATE", "prevent_post_session_review_snapshot_mutation"] },
    ],
  },
  {
    migration: "20260714210000_make_pre_session_readiness_snapshots_atomic",
    effect: "objects",
    objects: [
      ...[
        "identityStatus", "identityContractVersion", "identityJson", "identityHash", "targetHash",
        "payloadHash", "readinessEvidenceFingerprint", "projectionFingerprint", "seedRevisionId",
        "seedRevisionNumber", "seedPayloadHash", "prescriptionFingerprint",
      ].map((name) => ({ kind: "column" as const, table: "PreSessionReadinessSnapshot", name, column: {
        type: ["identityContractVersion", "seedRevisionNumber"].includes(name) ? "integer" : ["identityJson"].includes(name) ? "jsonb" : "text",
        nullable: name !== "identityStatus",
        default: name === "identityStatus" ? "'LEGACY_UNKNOWN'::text" : null,
      } })),
      { kind: "constraint", table: "PreSessionReadinessSnapshot", name: "psrs_identity_status_check", definitionIncludes: ["identityStatus", "LEGACY_UNKNOWN", "EXACT"] },
      { kind: "constraint", table: "PreSessionReadinessSnapshot", name: "psrs_exact_identity_complete_check", definitionIncludes: ["identityContractVersion", "readinessEvidenceFingerprint", "projectionFingerprint"] },
      { kind: "index", table: "PreSessionReadinessSnapshot", name: "psrs_exact_identity_lookup_idx", index: { unique: false, columns: ["userId", "identityHash"], predicate: null } },
      { kind: "index", table: "PreSessionReadinessSnapshot", name: "psrs_target_history_idx", index: { unique: false, columns: ["userId", "targetHash", "createdAt DESC"], predicate: null } },
      { kind: "index", table: "PreSessionReadinessSnapshot", name: "psrs_one_active_exact_identity_uidx", index: { unique: true, columns: ["userId", "identityHash"], predicate: "(\"invalidatedAt\" IS NULL) AND (\"identityStatus\" = 'EXACT'::text)" } },
      { kind: "index", table: "PreSessionReadinessSnapshot", name: "psrs_one_active_target_uidx", index: { unique: true, columns: ["userId", "targetHash"], predicate: "(\"invalidatedAt\" IS NULL) AND (\"identityStatus\" = 'EXACT'::text)" } },
    ],
  },
  {
    migration: "20260726120000_add_active_macrocycle_foundation",
    effect: "objects",
    objects: [
      {
        kind: "column",
        table: "User",
        name: "activeMacroCycleId",
        column: { type: "text", nullable: true, default: null },
      },
      {
        kind: "index",
        table: "User",
        name: "User_activeMacroCycleId_key",
        index: {
          unique: true,
          columns: ["activeMacroCycleId"],
          predicate: null,
        },
      },
      {
        kind: "index",
        table: "Mesocycle",
        name: "Mesocycle_one_active_per_macrocycle",
        index: {
          unique: true,
          columns: ["macroCycleId"],
          predicate: "(\"isActive\" = true)",
        },
      },
      {
        kind: "constraint",
        table: "User",
        name: "User_activeMacroCycleId_fkey",
        definitionIncludes: [
          "activeMacroCycleId",
          "MacroCycle",
          "ON DELETE RESTRICT",
        ],
      },
      {
        kind: "constraint",
        table: "Mesocycle",
        name: "Mesocycle_active_state_check",
        definitionIncludes: [
          "isActive",
          "COMPLETED",
          "AWAITING_HANDOFF",
        ],
      },
    ],
  },
  {
    migration: "20260727010000_add_plan_management_fields",
    effect: "objects",
    objects: [
      {
        kind: "column",
        table: "MacroCycle",
        name: "name",
        column: {
          type: "character varying(60)",
          nullable: false,
          default: "'Hypertrophy Plan'::character varying",
        },
      },
      {
        kind: "column",
        table: "MacroCycle",
        name: "archivedAt",
        column: {
          type: "timestamp(3) without time zone",
          nullable: true,
          default: null,
        },
      },
      {
        kind: "index",
        table: "MacroCycle",
        name: "MacroCycle_userId_archivedAt_updatedAt_idx",
        index: {
          unique: false,
          columns: ["userId", "archivedAt", "updatedAt"],
          predicate: null,
        },
      },
      {
        kind: "constraint",
        table: "MacroCycle",
        name: "MacroCycle_name_length_check",
        definitionIncludes: ["char_length", "name", "60"],
      },
    ],
  },
  {
    migration: "20260728120000_add_finishers_phase_1",
    effect: "objects",
    objects: FINISHER_SCHEMA_EXPECTATIONS,
  },
] as const;

type DefinitionExpectation =
  | ({ kind: "table"; name: string })
  | ({ kind: "column" } & ColumnFact)
  | ({ kind: "enum" } & EnumFact)
  | ({ kind: "index" } & IndexFact)
  | ({ kind: "constraint" } & ConstraintFact);

const column = (
  table: string,
  name: string,
  type: string,
  nullable: boolean,
  defaultValue: string | null = null,
): DefinitionExpectation => ({ kind: "column", table, name, type, nullable, default: defaultValue });

export const APPLIED_SCHEMA_EXPECTATIONS: readonly DefinitionExpectation[] = [
  { kind: "table", name: "ExerciseExposure" },
  column("Constraints", "weeklySchedule", '"WorkoutSessionIntent"[]', true, "ARRAY[]::\"WorkoutSessionIntent\"[]"),
  { kind: "enum", name: "PrimaryGoal", values: ["HYPERTROPHY", "STRENGTH", "FAT_LOSS", "ATHLETICISM", "GENERAL_HEALTH", "STRENGTH_HYPERTROPHY"] },
  { kind: "enum", name: "SecondaryGoal", values: ["POSTURE", "CONDITIONING", "INJURY_PREVENTION", "NONE", "STRENGTH"] },
  { kind: "enum", name: "MesocycleState", values: ["ACTIVE_ACCUMULATION", "ACTIVE_DELOAD", "COMPLETED", "AWAITING_HANDOFF"] },
  { kind: "enum", name: "MesocyclePhase", values: ["ACCUMULATION", "DELOAD"] },
  { kind: "enum", name: "MesocycleExerciseRoleType", values: ["CORE_COMPOUND", "ACCESSORY"] },
  { kind: "enum", name: "MesocycleWeekCloseStatus", values: ["PENDING_OPTIONAL_GAP_FILL", "RESOLVED"] },
  { kind: "enum", name: "MesocycleWeekCloseResolution", values: ["NO_GAP_FILL_NEEDED", "GAP_FILL_COMPLETED", "GAP_FILL_DISMISSED", "AUTO_DISMISSED"] },
  { kind: "enum", name: "SetIntent", values: ["WORK", "WARMUP"] },
  ...[
    ["accumulationSessionsCompleted", "integer", false, "0"],
    ["daysPerWeek", "integer", false, "3"],
    ["deloadSessionsCompleted", "integer", false, "0"],
    ["rirBandConfig", "jsonb", true, null],
    ["sessionsPerWeek", "integer", false, "3"],
    ["splitType", '"SplitType"', false, "'PPL'::\"SplitType\""],
    ["state", '"MesocycleState"', false, "'ACTIVE_ACCUMULATION'::\"MesocycleState\""],
    ["volumeRampConfig", "jsonb", true, null],
    ["closedAt", "timestamp(3) without time zone", true, null],
    ["handoffSummaryJson", "jsonb", true, null],
    ["nextSeedDraftJson", "jsonb", true, null],
    ["slotSequenceJson", "jsonb", true, null],
    ["slotPlanSeedJson", "jsonb", true, null],
  ].map(([name, type, nullable, defaultValue]) => column("Mesocycle", name as string, type as string, nullable as boolean, defaultValue as string | null)),
  ...[
    ["mesoSessionSnapshot", "integer"], ["mesocycleId", "text"],
    ["mesocyclePhaseSnapshot", '"MesocyclePhase"'], ["mesocycleWeekSnapshot", "integer"],
  ].map(([name, type]) => column("Workout", name, type, true)),
  column("SetLog", "setIntent", '"SetIntent"', false, "'WORK'::\"SetIntent\""),
  { kind: "table", name: "MesocycleExerciseRole" },
  ...[
    ["id", "text", false, null], ["mesocycleId", "text", false, null],
    ["exerciseId", "text", false, null], ["sessionIntent", '"WorkoutSessionIntent"', false, null],
    ["role", '"MesocycleExerciseRoleType"', false, null], ["addedInWeek", "integer", false, null],
    ["createdAt", "timestamp(3) without time zone", false, "CURRENT_TIMESTAMP"],
    ["updatedAt", "timestamp(3) without time zone", false, null],
  ].map(([name, type, nullable, defaultValue]) => column("MesocycleExerciseRole", name as string, type as string, nullable as boolean, defaultValue as string | null)),
  { kind: "table", name: "MesocycleWeekClose" },
  ...[
    ["id", "text", false, null], ["mesocycleId", "text", false, null],
    ["targetWeek", "integer", false, null], ["targetPhase", '"MesocyclePhase"', false, null],
    ["status", '"MesocycleWeekCloseStatus"', false, null], ["resolution", '"MesocycleWeekCloseResolution"', true, null],
    ["optionalWorkoutId", "text", true, null], ["deficitSnapshotJson", "jsonb", true, null],
    ["triggeredAt", "timestamp(3) without time zone", false, "CURRENT_TIMESTAMP"],
    ["resolvedAt", "timestamp(3) without time zone", true, null],
    ["createdAt", "timestamp(3) without time zone", false, "CURRENT_TIMESTAMP"],
    ["updatedAt", "timestamp(3) without time zone", false, null],
  ].map(([name, type, nullable, defaultValue]) => column("MesocycleWeekClose", name as string, type as string, nullable as boolean, defaultValue as string | null)),
  { kind: "table", name: "PreSessionReadinessSnapshot" },
  ...[
    ["id", "text", false, null], ["userId", "text", false, null],
    ["activeMesocycleId", "text", false, null], ["mesocycleState", '"MesocycleState"', false, null],
    ["weekInMeso", "integer", false, null], ["sessionInWeek", "integer", false, null],
    ["slotId", "text", false, null], ["slotIntent", "text", false, null],
    ["plannedWorkoutId", "text", true, null], ["plannedWorkoutRevision", "integer", true, null],
    ["contractVersion", "integer", false, null], ["contractJson", "jsonb", false, null],
    ["sourceStateHash", "text", true, null], ["slotPlanSeedHash", "text", true, null],
    ["slotSequenceHash", "text", true, null], ["createdAt", "timestamp(3) without time zone", false, "CURRENT_TIMESTAMP"],
    ["expiresAt", "timestamp(3) without time zone", true, null], ["invalidatedAt", "timestamp(3) without time zone", true, null],
    ["invalidatedReason", "text", true, null],
  ].map(([name, type, nullable, defaultValue]) => column("PreSessionReadinessSnapshot", name as string, type as string, nullable as boolean, defaultValue as string | null)),
  { kind: "constraint", table: "MesocycleExerciseRole", name: "MesocycleExerciseRole_pkey", type: "p", definition: "PRIMARY KEY (id)" },
  { kind: "index", table: "MesocycleExerciseRole", name: "MesocycleExerciseRole_mesocycleId_sessionIntent_idx", unique: false, columns: ["mesocycleId", "sessionIntent"], predicate: null },
  { kind: "index", table: "MesocycleExerciseRole", name: "MesocycleExerciseRole_exerciseId_idx", unique: false, columns: ["exerciseId"], predicate: null },
  { kind: "index", table: "MesocycleExerciseRole", name: "MesocycleExerciseRole_mesocycleId_exerciseId_sessionIntent_key", unique: true, columns: ["mesocycleId", "exerciseId", "sessionIntent"], predicate: null },
  { kind: "constraint", table: "MesocycleExerciseRole", name: "MesocycleExerciseRole_mesocycleId_fkey", type: "f", definition: "FOREIGN KEY (\"mesocycleId\") REFERENCES \"Mesocycle\"(id) ON UPDATE CASCADE ON DELETE CASCADE" },
  { kind: "constraint", table: "MesocycleExerciseRole", name: "MesocycleExerciseRole_exerciseId_fkey", type: "f", definition: "FOREIGN KEY (\"exerciseId\") REFERENCES \"Exercise\"(id) ON UPDATE CASCADE ON DELETE RESTRICT" },
  { kind: "constraint", table: "MesocycleWeekClose", name: "MesocycleWeekClose_pkey", type: "p", definition: "PRIMARY KEY (id)" },
  { kind: "index", table: "MesocycleWeekClose", name: "MesocycleWeekClose_optionalWorkoutId_key", unique: true, columns: ["optionalWorkoutId"], predicate: null },
  { kind: "index", table: "MesocycleWeekClose", name: "MesocycleWeekClose_mesocycleId_status_idx", unique: false, columns: ["mesocycleId", "status"], predicate: null },
  { kind: "index", table: "MesocycleWeekClose", name: "MesocycleWeekClose_mesocycleId_targetWeek_key", unique: true, columns: ["mesocycleId", "targetWeek"], predicate: null },
  { kind: "constraint", table: "MesocycleWeekClose", name: "MesocycleWeekClose_mesocycleId_fkey", type: "f", definition: "FOREIGN KEY (\"mesocycleId\") REFERENCES \"Mesocycle\"(id) ON UPDATE CASCADE ON DELETE CASCADE" },
  { kind: "constraint", table: "MesocycleWeekClose", name: "MesocycleWeekClose_optionalWorkoutId_fkey", type: "f", definition: "FOREIGN KEY (\"optionalWorkoutId\") REFERENCES \"Workout\"(id) ON UPDATE CASCADE ON DELETE SET NULL" },
  { kind: "constraint", table: "PreSessionReadinessSnapshot", name: "PreSessionReadinessSnapshot_pkey", type: "p", definition: "PRIMARY KEY (id)" },
  { kind: "constraint", table: "PreSessionReadinessSnapshot", name: "PreSessionReadinessSnapshot_userId_fkey", type: "f", definition: "FOREIGN KEY (\"userId\") REFERENCES \"User\"(id) ON UPDATE CASCADE ON DELETE CASCADE" },
  { kind: "constraint", table: "PreSessionReadinessSnapshot", name: "PreSessionReadinessSnapshot_activeMesocycleId_fkey", type: "f", definition: "FOREIGN KEY (\"activeMesocycleId\") REFERENCES \"Mesocycle\"(id) ON UPDATE CASCADE ON DELETE CASCADE" },
  { kind: "constraint", table: "PreSessionReadinessSnapshot", name: "PreSessionReadinessSnapshot_plannedWorkoutId_fkey", type: "f", definition: "FOREIGN KEY (\"plannedWorkoutId\") REFERENCES \"Workout\"(id) ON UPDATE CASCADE ON DELETE SET NULL" },
  { kind: "index", table: "Mesocycle", name: "Mesocycle_macroCycleId_isActive_state_idx", unique: false, columns: ["macroCycleId", "isActive", "state"], predicate: null },
  { kind: "index", table: "Mesocycle", name: "Mesocycle_macroCycleId_state_idx", unique: false, columns: ["macroCycleId", "state"], predicate: null },
  { kind: "index", table: "Workout", name: "Workout_mesocycleId_idx", unique: false, columns: ["mesocycleId"], predicate: null },
  { kind: "constraint", table: "Workout", name: "Workout_mesocycleId_fkey", type: "f", definition: "FOREIGN KEY (\"mesocycleId\") REFERENCES \"Mesocycle\"(id) ON UPDATE CASCADE ON DELETE SET NULL" },
  ...[
    ["psrs_user_created_idx", ["userId", "createdAt DESC"]],
    ["psrs_identity_lookup_idx", ["userId", "activeMesocycleId", "weekInMeso", "sessionInWeek", "slotId", "contractVersion"]],
    ["psrs_planned_workout_idx", ["plannedWorkoutId"]],
    ["psrs_freshness_idx", ["userId", "invalidatedAt", "expiresAt", "createdAt DESC"]],
  ].map(([name, columns]) => ({ kind: "index" as const, table: "PreSessionReadinessSnapshot", name: name as string, unique: false, columns: columns as string[], predicate: null })),
];

export function checksumMigrationSql(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function prismaCompatibleMigrationSqlChecksums(
  bytes: Uint8Array,
): string[] {
  const script = Buffer.from(bytes).toString("utf8");
  return Array.from(
    new Set(
      [
        script,
        script.replaceAll("\r\n", "\n"),
        script.replaceAll("\n", "\r\n"),
      ].map((candidate) =>
        checksumMigrationSql(Buffer.from(candidate, "utf8")),
      ),
    ),
  );
}

export function migrationChecksumMatches(
  migration: CheckedInMigration,
  ledgerChecksum: string | null,
): boolean {
  return (
    ledgerChecksum != null &&
    (migration.compatibleChecksums ?? [migration.checksum]).includes(
      ledgerChecksum,
    )
  );
}

export function loadCheckedInMigrations(root = join(process.cwd(), "prisma", "migrations")): CheckedInMigration[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const sqlPath = join(root, entry.name, "migration.sql");
      const bytes = readFileSync(sqlPath);
      const compatibleChecksums = prismaCompatibleMigrationSqlChecksums(bytes);
      return {
        name: entry.name,
        checksum: compatibleChecksums[0],
        compatibleChecksums,
        sqlPath,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function normalize(value: string | null): string | null {
  return value?.replace(/\s+/g, " ").trim() ?? null;
}

function stripRedundantOuterParentheses(value: string): string {
  let result = value;
  while (result.startsWith("(") && result.endsWith(")")) {
    let depth = 0;
    let enclosesWholeExpression = true;
    for (let index = 0; index < result.length; index += 1) {
      if (result[index] === "(") depth += 1;
      if (result[index] === ")") depth -= 1;
      if (depth === 0 && index < result.length - 1) {
        enclosesWholeExpression = false;
        break;
      }
    }
    if (!enclosesWholeExpression || depth !== 0) break;
    result = result.slice(1, -1).trim();
  }
  return result;
}

function normalizeIndexPart(value: string | null): string | null {
  const normalized = normalize(value)
    ?.replace(/"([^"]+)"/g, "$1")
    .replace(/ DESC NULLS FIRST$/i, " DESC")
    .replace(/ ASC NULLS LAST$/i, " ASC") ?? null;
  return normalized ? stripRedundantOuterParentheses(normalized) : null;
}

function objectKey(object: ObjectExpectation): string {
  return `${object.kind}:${object.table ? `${object.table}.` : ""}${object.name}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function objectExists(snapshot: CatalogSnapshot, object: ObjectExpectation): boolean {
  if (object.kind === "table") return snapshot.tables.includes(object.name);
  if (object.kind === "column") return snapshot.columns.some((item) => item.table === object.table && item.name === object.name);
  if (object.kind === "enum") return snapshot.enums.some((item) => item.name === object.name);
  if (object.kind === "index") return snapshot.indexes.some((item) => item.table === object.table && item.name === object.name);
  if (object.kind === "constraint") return snapshot.constraints.some((item) => item.table === object.table && item.name === object.name);
  if (object.kind === "trigger") return snapshot.triggers.some((item) => item.table === object.table && item.name === object.name);
  if (object.kind === "catalogRow") {
    return snapshot.catalogRows.some(
      (item) => item.table === object.table && item.key === object.name,
    );
  }
  return snapshot.functions.some((item) => item.name === object.name);
}

function pendingObjectCompatible(snapshot: CatalogSnapshot, object: ObjectExpectation): boolean {
  if (object.kind === "table") return true;
  if (object.kind === "column") {
    const actual = snapshot.columns.find((item) => item.table === object.table && item.name === object.name);
    return Boolean(actual && object.column && actual.type === object.column.type && actual.nullable === object.column.nullable && normalize(actual.default) === normalize(object.column.default));
  }
  if (object.kind === "enum") {
    const actual = snapshot.enums.find((item) => item.name === object.name);
    return Boolean(
      actual &&
        object.enum &&
        JSON.stringify(actual.values) === JSON.stringify(object.enum.values),
    );
  }
  if (object.kind === "index") {
    const actual = snapshot.indexes.find((item) => item.table === object.table && item.name === object.name);
    return Boolean(
      actual && object.index && actual.unique === object.index.unique &&
      JSON.stringify(actual.columns.map((part) => normalizeIndexPart(part))) === JSON.stringify(object.index.columns.map((part) => normalizeIndexPart(part))) &&
      normalizeIndexPart(actual.predicate) === normalizeIndexPart(object.index.predicate),
    );
  }
  if (object.kind === "constraint") {
    const actual = snapshot.constraints.find((item) => item.table === object.table && item.name === object.name);
    if (!actual) return false;
    if (object.constraint?.type && actual.type !== object.constraint.type) {
      return false;
    }
    if (
      object.constraint?.definition &&
      normalize(actual.definition) !== normalize(object.constraint.definition)
    ) {
      return false;
    }
    return (object.definitionIncludes ?? []).every((token) => actual.definition.includes(token));
  }
  if (object.kind === "catalogRow") {
    const actual = snapshot.catalogRows.find(
      (item) => item.table === object.table && item.key === object.name,
    );
    return Boolean(
      actual &&
        object.row &&
        canonicalJson(actual.values) === canonicalJson(object.row),
    );
  }
  const definition = object.kind === "trigger"
    ? snapshot.triggers.find((item) => item.table === object.table && item.name === object.name)?.definition
    : snapshot.functions.find((item) => item.name === object.name)?.definition;
  return Boolean(definition && (object.definitionIncludes ?? []).every((token) => definition.includes(token)));
}

function definitionIssue(snapshot: CatalogSnapshot, expected: DefinitionExpectation): string | null {
  if (expected.kind === "table") return snapshot.tables.includes(expected.name) ? null : `table:${expected.name}:missing`;
  if (expected.kind === "column") {
    const actual = snapshot.columns.find((item) => item.table === expected.table && item.name === expected.name);
    if (!actual) return `column:${expected.table}.${expected.name}:missing`;
    const compatible = actual.type === expected.type && actual.nullable === expected.nullable && normalize(actual.default) === normalize(expected.default);
    return compatible ? null : `column:${expected.table}.${expected.name}:incompatible`;
  }
  if (expected.kind === "enum") {
    const actual = snapshot.enums.find((item) => item.name === expected.name);
    if (!actual) return `enum:${expected.name}:missing`;
    return JSON.stringify(actual.values) === JSON.stringify(expected.values) ? null : `enum:${expected.name}:incompatible`;
  }
  if (expected.kind === "index") {
    const actual = snapshot.indexes.find((item) => item.table === expected.table && item.name === expected.name);
    if (!actual) return `index:${expected.table}.${expected.name}:missing`;
    const compatible =
      actual.unique === expected.unique &&
      JSON.stringify(actual.columns.map((column) => normalizeIndexPart(column))) ===
        JSON.stringify(expected.columns.map((column) => normalizeIndexPart(column))) &&
      normalizeIndexPart(actual.predicate) === normalizeIndexPart(expected.predicate);
    return compatible
      ? null
      : `index:${expected.table}.${expected.name}:incompatible:expected=${JSON.stringify(expected.columns)}:actual=${JSON.stringify(actual.columns)}`;
  }
  const actual = snapshot.constraints.find((item) => item.table === expected.table && item.name === expected.name);
  if (!actual) return `constraint:${expected.table}.${expected.name}:missing`;
  return actual.type === expected.type && normalize(actual.definition) === normalize(expected.definition)
    ? null
    : `constraint:${expected.table}.${expected.name}:incompatible`;
}

type LedgerRowState = "successful" | "failed" | "rolled_back" | "incomplete";

function classifyLedgerRow(row: LedgerRow): LedgerRowState {
  const requiredFieldsPresent = Boolean(row.id.trim() && row.migrationName.trim() && row.checksum?.trim());
  const stepCountValid = Number.isInteger(row.appliedStepsCount) && row.appliedStepsCount >= 0;
  if (!requiredFieldsPresent || !stepCountValid) return "incomplete";
  if (row.finishedAt && row.rolledBackAt) return "incomplete";
  if (row.rolledBackAt) return row.finishedAt ? "incomplete" : "rolled_back";
  if (row.logs?.trim()) return "failed";
  if (row.finishedAt) return "successful";
  return "incomplete";
}

function uniquenessRepresentation(index: IndexFact | undefined): UniquenessRepresentation {
  if (!index) return "missing";
  if (!index.unique && !index.constraintName) return "standalone_non_unique_index";
  if (!index.constraintName) return "standalone_unique_index";
  return index.constraintType === "u"
    ? "unique_constraint_backed_index"
    : "incompatible_constraint_backed_index";
}

function assessBaselineUniqueness(snapshot: CatalogSnapshot, expected: BaselineUniquenessExpectation) {
  const actual = snapshot.indexes.find((index) => index.table === expected.table && index.name === expected.name);
  const sameNamedConstraint = snapshot.constraints.find((constraint) => constraint.table === expected.table && constraint.name === expected.name);
  const actualRepresentation = uniquenessRepresentation(actual);
  const semanticDifferences: string[] = [];
  if (!actual) {
    semanticDifferences.push("missing uniqueness object");
  } else {
    if (!actual.unique) semanticDifferences.push("object is not unique");
    if (actual.valid === false || actual.ready === false || actual.live === false) {
      semanticDifferences.push("unique enforcement is not valid, ready, and live");
    }
    if (
      JSON.stringify(actual.columns.map((part) => normalizeIndexPart(part))) !==
      JSON.stringify(expected.columns.map((part) => normalizeIndexPart(part)))
    ) {
      semanticDifferences.push("ordered columns differ");
    }
    if (normalizeIndexPart(actual.predicate) !== normalizeIndexPart(expected.predicate)) {
      semanticDifferences.push("predicate differs");
    }
    if ((actual.nullsNotDistinct ?? false) !== expected.nullsNotDistinct) {
      semanticDifferences.push("null semantics differ");
    }
    if (actualRepresentation === "incompatible_constraint_backed_index") {
      semanticDifferences.push("same-name object has an incompatible constraint linkage");
    }
    if (actualRepresentation === "standalone_unique_index" && sameNamedConstraint) {
      semanticDifferences.push("same-name constraint conflicts with the standalone index representation");
    }
  }

  const semanticEquivalent = semanticDifferences.length === 0;
  const catalogRepresentationEquivalent = semanticEquivalent && actualRepresentation === expected.expectedRepresentation;
  const nonBlockingRepresentationDifference =
    semanticEquivalent &&
    actualRepresentation === "unique_constraint_backed_index" &&
    !expected.pendingMigrationDependsOnRepresentation;
  const migrationBlocking = !semanticEquivalent || (!catalogRepresentationEquivalent && !nonBlockingRepresentationDifference);
  const diagnosticWarning = semanticEquivalent && !catalogRepresentationEquivalent && !migrationBlocking;
  const whyItDoesNotBlock = diagnosticWarning
    ? "The named unique constraint is backed by the same valid unique index, with identical ordered columns, predicate, null semantics, and enforcement; no pending migration depends on the object kind."
    : null;

  return {
    objectName: expected.name,
    table: expected.table,
    expectedRepresentation: expected.expectedRepresentation,
    actualRepresentation,
    semanticEquivalent,
    catalogRepresentationEquivalent,
    migrationBlocking,
    diagnosticWarning,
    semanticDifferences,
    whyItDoesNotBlock,
    pendingMigrationDependsOnDistinction: expected.pendingMigrationDependsOnRepresentation,
  };
}

function migrationSchemaEffectsVerified(input: {
  migrationName: string;
  catalog: CatalogSnapshot;
  definitionIssues: string[];
  uniquenessAssessments: ReturnType<typeof assessBaselineUniqueness>[];
  allAppliedSchemaVerified: boolean;
}): boolean {
  if (input.migrationName === EXPECTED_MIGRATION_CHAIN[0]) {
    return (
      input.catalog.tables.includes("ExerciseAlias") &&
      input.catalog.tables.includes("WorkoutTemplateExercise") &&
      input.uniquenessAssessments.every((assessment) => assessment.semanticEquivalent)
    );
  }
  if (input.migrationName === EXPECTED_MIGRATION_CHAIN[9]) {
    return !input.definitionIssues.some((issue) => issue.startsWith("enum:SetIntent:") || issue.startsWith("column:SetLog.setIntent:"));
  }
  return input.allAppliedSchemaVerified;
}

function isFullCommitSha(value: string): boolean {
  return /^[0-9a-f]{40}$/i.test(value);
}

function isFreshEvidenceTimestamp(
  value: string | undefined,
  evaluatedAt: string,
): boolean {
  if (!value) return false;
  const observed = Date.parse(value);
  const evaluated = Date.parse(evaluatedAt);
  if (!Number.isFinite(observed) || !Number.isFinite(evaluated)) return false;
  const ageMs = evaluated - observed;
  return (
    ageMs >= 0 &&
    ageMs <=
      MIGRATION_AUTHORIZATION_POLICY.operationalEvidenceMaxAgeMinutes *
        60 *
        1_000
  );
}

function expectedPendingSequenceValid(
  checkedInNames: string[],
  expectedPendingMigrations: string[],
): boolean {
  if (expectedPendingMigrations.length === 0) return false;
  if (new Set(expectedPendingMigrations).size !== expectedPendingMigrations.length) {
    return false;
  }
  const targetIndex = checkedInNames.indexOf(
    MIGRATION_AUTHORIZATION_POLICY.targetMigration,
  );
  const firstExpectedIndex = checkedInNames.indexOf(expectedPendingMigrations[0]);
  if (targetIndex < 0 || firstExpectedIndex < 0) return false;
  return (
    expectedPendingMigrations.at(-1) ===
      MIGRATION_AUTHORIZATION_POLICY.targetMigration &&
    JSON.stringify(expectedPendingMigrations) ===
      JSON.stringify(checkedInNames.slice(firstExpectedIndex, targetIndex + 1))
  );
}

export function buildMigrationIntegrityReport(input: {
  target: { classification: "local" | "disposable" | "remote"; fingerprint: string };
  checkedIn: CheckedInMigration[];
  ledgerRows: LedgerRow[];
  catalog: CatalogSnapshot;
  writes?: number;
  authorizationEvidence?: MigrationAuthorizationEvidence;
}) {
  const checkedInNames = input.checkedIn.map((migration) => migration.name);
  const checkedInByName = new Map(input.checkedIn.map((migration) => [migration.name, migration]));
  const rowsByName = new Map<string, LedgerRow[]>();
  for (const row of input.ledgerRows) rowsByName.set(row.migrationName, [...(rowsByName.get(row.migrationName) ?? []), row]);

  const successfulRows: LedgerRow[] = [];
  const failed: string[] = [];
  const rolledBack: string[] = [];
  const rolledBackHistory: string[] = [];
  const incomplete: string[] = [];
  const duplicates: string[] = [];
  for (const [migrationName, rows] of rowsByName) {
    const rowsByState = new Map<LedgerRowState, LedgerRow[]>([
      ["successful", []],
      ["failed", []],
      ["rolled_back", []],
      ["incomplete", []],
    ]);
    for (const row of rows) rowsByState.get(classifyLedgerRow(row))!.push(row);
    const cleanSuccessful = rowsByState.get("successful")!;
    const failedRows = rowsByState.get("failed")!;
    const rolledBackRows = rowsByState.get("rolled_back")!;
    const incompleteRows = rowsByState.get("incomplete")!;
    const cleanReplacement = cleanSuccessful.length === 1 && failedRows.length === 0 && incompleteRows.length === 0;

    if (cleanReplacement) {
      successfulRows.push(cleanSuccessful[0]);
      if (rolledBackRows.length > 0) rolledBackHistory.push(migrationName);
      continue;
    }
    if (rows.length > 1) duplicates.push(migrationName);
    if (failedRows.length > 0) failed.push(migrationName);
    if (incompleteRows.length > 0 || cleanSuccessful.length > 0) incomplete.push(migrationName);
    if (cleanSuccessful.length === 0 && failedRows.length === 0 && incompleteRows.length === 0 && rolledBackRows.length > 0) {
      rolledBack.push(migrationName);
    }
  }

  failed.sort();
  rolledBack.sort();
  rolledBackHistory.sort();
  incomplete.sort();
  duplicates.sort();
  const unknown = [...rowsByName.keys()].filter((name) => !checkedInByName.has(name)).sort();
  const appliedNames = new Set(successfulRows.map((row) => row.migrationName));
  const pendingNames = checkedInNames.filter((name) => !appliedNames.has(name));
  const orderViolations = checkedInNames.filter((name, index) => appliedNames.has(name) && checkedInNames.slice(0, index).some((predecessor) => !appliedNames.has(predecessor)));

  const mismatched: string[] = [];
  const mismatchContext: Array<{
    migrationName: string;
    ledgerChecksum: string | null;
    repositoryChecksum: string;
    compatibleRepositoryChecksums: string[];
  }> = [];
  const missingCheckedIn: string[] = [];
  const missingLedgerChecksum = input.ledgerRows
    .filter((row) => row.finishedAt && !row.rolledBackAt && !row.logs?.trim() && !row.checksum?.trim())
    .map((row) => row.migrationName);
  let matched = 0;
  for (const row of successfulRows) {
    const migration = checkedInByName.get(row.migrationName);
    if (!migration) {
      missingCheckedIn.push(row.migrationName);
    } else if (!migrationChecksumMatches(migration, row.checksum)) {
      mismatched.push(row.migrationName);
      mismatchContext.push({
        migrationName: row.migrationName,
        ledgerChecksum: row.checksum,
        repositoryChecksum: migration.checksum,
        compatibleRepositoryChecksums:
          migration.compatibleChecksums ?? [migration.checksum],
      });
    } else {
      matched += 1;
    }
  }

  const unexpectedPresent: string[] = [];
  const partiallyPresent: string[] = [];
  const incompatible: string[] = [];
  const appliedManifestMissing: string[] = [];
  const appliedManifestIncompatible: string[] = [];
  const commentsOnly: string[] = [];
  for (const migration of PENDING_ARCHITECTURE_MANIFEST) {
    if (appliedNames.has(migration.migration)) {
      if (migration.effect === "comments_only") continue;
      for (const object of migration.objects) {
        if (!objectExists(input.catalog, object)) {
          appliedManifestMissing.push(
            `${migration.migration}:${objectKey(object)}:missing`,
          );
        } else if (!pendingObjectCompatible(input.catalog, object)) {
          appliedManifestIncompatible.push(
            `${migration.migration}:${objectKey(object)}:incompatible`,
          );
        }
      }
      continue;
    }
    if (migration.effect === "comments_only") {
      commentsOnly.push(`${migration.migration}:retains:${migration.retainedObjects?.join(",") ?? "none"}`);
      continue;
    }
    const present = migration.objects.filter((object) => objectExists(input.catalog, object));
    const incompatiblePresent = present.filter((object) => !pendingObjectCompatible(input.catalog, object));
    if (incompatiblePresent.length > 0) {
      incompatible.push(...incompatiblePresent.map((object) => `${migration.migration}:${objectKey(object)}:incompatible`));
    } else if (present.length === migration.objects.length && present.length > 0) {
      unexpectedPresent.push(`${migration.migration}:fully_present_without_ledger`);
    } else if (present.length > 0) {
      partiallyPresent.push(...present.map((object) => `${migration.migration}:${objectKey(object)}`));
    }
  }

  const definitionIssues = APPLIED_SCHEMA_EXPECTATIONS.map((expected) => definitionIssue(input.catalog, expected)).filter((issue): issue is string => Boolean(issue));
  incompatible.push(...definitionIssues.filter((issue) => issue.includes(":incompatible")));
  const missingDefinitions = definitionIssues.filter((issue) => issue.endsWith(":missing"));
  const uniquenessAssessments = BASELINE_UNIQUENESS_EXPECTATIONS.map((expected) => assessBaselineUniqueness(input.catalog, expected));
  const uniquenessBlockingDifferences = uniquenessAssessments
    .filter((assessment) => assessment.migrationBlocking)
    .map((assessment) => ({
      objectName: assessment.objectName,
      table: assessment.table,
      semanticEquivalent: assessment.semanticEquivalent,
      catalogRepresentationEquivalent: assessment.catalogRepresentationEquivalent,
      expectedRepresentation: assessment.expectedRepresentation,
      actualRepresentation: assessment.actualRepresentation,
      reasons: assessment.semanticDifferences,
      pendingMigrationDependsOnDistinction: assessment.pendingMigrationDependsOnDistinction,
    }));
  const representationWarnings = uniquenessAssessments
    .filter((assessment) => assessment.diagnosticWarning)
    .map((assessment) => ({
      objectName: assessment.objectName,
      table: assessment.table,
      expectedRepresentation: assessment.expectedRepresentation,
      actualRepresentation: assessment.actualRepresentation,
      semanticEquivalent: assessment.semanticEquivalent,
      whyItDoesNotBlock: assessment.whyItDoesNotBlock,
      pendingMigrationDependsOnDistinction: assessment.pendingMigrationDependsOnDistinction,
    }));
  const semanticBlockingDifferences = [
    ...incompatible.map((difference) => ({ category: "incompatible_definition" as const, difference })),
    ...missingDefinitions.map((difference) => ({ category: "missing_definition" as const, difference })),
    ...appliedManifestMissing.map((difference) => ({
      category: "applied_migration_object_missing" as const,
      difference,
    })),
    ...appliedManifestIncompatible.map((difference) => ({
      category: "applied_migration_object_incompatible" as const,
      difference,
    })),
    ...uniquenessBlockingDifferences.map((difference) => ({ category: "baseline_uniqueness" as const, ...difference })),
  ];

  const appliedSchemaVerified =
    definitionIssues.length === 0 &&
    uniquenessBlockingDifferences.length === 0 &&
    appliedManifestMissing.length === 0 &&
    appliedManifestIncompatible.length === 0;
  const executed: string[] = [];
  const resolvedApplied: string[] = [];
  const unknownSuccessful: string[] = [];
  for (const row of successfulRows) {
    if (row.appliedStepsCount > 0) {
      executed.push(row.migrationName);
      continue;
    }
    const checkedInMigration = checkedInByName.get(row.migrationName);
    if (
      row.appliedStepsCount === 0 &&
      checkedInMigration != null &&
      migrationChecksumMatches(checkedInMigration, row.checksum) &&
      migrationSchemaEffectsVerified({
        migrationName: row.migrationName,
        catalog: input.catalog,
        definitionIssues,
        uniquenessAssessments,
        allAppliedSchemaVerified: appliedSchemaVerified,
      })
    ) {
      resolvedApplied.push(row.migrationName);
    } else {
      unknownSuccessful.push(row.migrationName);
    }
  }
  executed.sort();
  resolvedApplied.sort();
  unknownSuccessful.sort();
  const successfulDetails = successfulRows
    .map((row) => ({
      migrationName: row.migrationName,
      appliedMode: executed.includes(row.migrationName)
        ? "executed" as const
        : resolvedApplied.includes(row.migrationName)
          ? "resolved_applied" as const
          : "unknown_successful" as const,
      appliedStepsCount: row.appliedStepsCount,
    }))
    .sort((left, right) => left.migrationName.localeCompare(right.migrationName));

  const unableToVerify = [...(input.catalog.unableToVerify ?? [])].sort();
  const blockingDifferences = [
    ...semanticBlockingDifferences,
    ...unexpectedPresent.map((difference) => ({ category: "pending_object_fully_present" as const, difference })),
    ...partiallyPresent.map((difference) => ({ category: "pending_object_partially_present" as const, difference })),
    ...unableToVerify.map((difference) => ({ category: "unable_to_verify" as const, difference })),
  ];
  const writes = input.writes ?? 0;
  const exactChain = JSON.stringify(checkedInNames) === JSON.stringify(EXPECTED_MIGRATION_CHAIN);
  const evidence = input.authorizationEvidence;
  const evaluatedAt = evidence?.evaluatedAt ?? new Date().toISOString();
  const expectedPendingMigrations = evidence?.expectedPendingMigrations
    ? [...evidence.expectedPendingMigrations]
    : [...MIGRATION_AUTHORIZATION_POLICY.expectedPendingMigrations];
  const pendingSequenceConfigured = expectedPendingSequenceValid(
    checkedInNames,
    expectedPendingMigrations,
  );
  const exactPending =
    pendingSequenceConfigured &&
    JSON.stringify(pendingNames) === JSON.stringify(expectedPendingMigrations);
  const ledgerClean = failed.length + rolledBack.length + incomplete.length + duplicates.length + unknown.length + orderViolations.length === 0;
  const checksumsClean =
    mismatched.length +
      missingCheckedIn.length +
      missingLedgerChecksum.length ===
      0 && matched === successfulRows.length;
  const schemaClean = blockingDifferences.length === 0;
  const gateAApplicable = pendingNames.length > 0;
  const repositoryHead = evidence?.repositoryHead ?? "";
  const productionDeploymentCommit =
    evidence?.productionDeploymentCommit ?? "";
  const requiredApplicationCommit =
    evidence?.requiredApplicationCommit ??
    MIGRATION_AUTHORIZATION_POLICY.requiredApplicationCommit;
  const repositoryHeadIdentified = isFullCommitSha(repositoryHead);
  const requiredApplicationCommitIdentified = isFullCommitSha(
    requiredApplicationCommit,
  );
  const migrationTargetIdentified =
    exactChain &&
    pendingSequenceConfigured &&
    checkedInNames.includes(MIGRATION_AUTHORIZATION_POLICY.targetMigration);
  const dataPreflightValid = Boolean(
    evidence?.dataPreflight?.valid &&
      evidence.dataPreflight.targetFingerprint === input.target.fingerprint &&
      isFreshEvidenceTimestamp(
        evidence.dataPreflight.verifiedAt,
        evaluatedAt,
      ),
  );
  const disposablePostgresVerified = Boolean(
    evidence?.disposablePostgres?.valid &&
      evidence.disposablePostgres.repositoryHead === repositoryHead,
  );
  const recovery = evidence?.recoveryPoint;
  const recoveryPointVerified = Boolean(
    recovery?.verified &&
      recovery.providerProjectIdentity.trim() &&
      recovery.databaseIdentity.trim() &&
      Date.parse(recovery.recoveryTimestamp) <= Date.parse(evaluatedAt) &&
      recovery.retentionConfirmed &&
      recovery.recoverabilityConfirmed &&
      recovery.freshForExecution &&
      isFreshEvidenceTimestamp(recovery.operatorVerifiedAt, evaluatedAt),
  );
  const writeBoundaryReady = Boolean(
    evidence?.writeBoundary?.ready &&
      evidence.writeBoundary.mechanism === "production-write-gate" &&
      isFreshEvidenceTimestamp(
        evidence.writeBoundary.verifiedAt,
        evaluatedAt,
      ),
  );
  const applicationCompatibilityState =
    evidence?.applicationCompatibilityState ?? "unverified";
  const compatibleProductionDeployment =
    isFullCommitSha(productionDeploymentCommit) &&
    MIGRATION_AUTHORIZATION_POLICY.compatibleProductionDeploymentCommits.includes(
      productionDeploymentCommit as
        (typeof MIGRATION_AUTHORIZATION_POLICY.compatibleProductionDeploymentCommits)[number],
    );
  const productionDeploymentVerified =
    compatibleProductionDeployment &&
    isFreshEvidenceTimestamp(evidence?.deploymentVerifiedAt, evaluatedAt);
  const migrationOrderValid =
    orderViolations.length === 0 && pendingSequenceConfigured;
  const migrationChecksumsValid = checksumsClean;
  const schemaPreflightValid = schemaClean;
  const technicalMigrationReady =
    input.target.classification !== "local" &&
    gateAApplicable &&
    exactChain &&
    exactPending &&
    ledgerClean &&
    migrationOrderValid &&
    migrationChecksumsValid &&
    schemaPreflightValid &&
    dataPreflightValid &&
    disposablePostgresVerified &&
    writes === 0;
  const migrationAuthorizationReady =
    technicalMigrationReady &&
    repositoryHeadIdentified &&
    requiredApplicationCommitIdentified &&
    migrationTargetIdentified &&
    recoveryPointVerified &&
    writeBoundaryReady &&
    productionDeploymentVerified &&
    applicationCompatibilityState === "compatible_with_write_boundary";
  const executionAuthorized = false;
  const unexpectedMigrations = Array.from(
    new Set([
      ...unknown,
      ...pendingNames.filter(
        (migration) => !expectedPendingMigrations.includes(migration),
      ),
    ]),
  ).sort();
  const blockingReasons: string[] = [];
  if (input.target.classification === "local") blockingReasons.push("remote_or_disposable_target_required");
  if (!gateAApplicable) blockingReasons.push("no_pending_migration");
  if (!exactChain) blockingReasons.push("repository_migration_chain_mismatch");
  if (!migrationTargetIdentified) blockingReasons.push("migration_target_not_identified");
  if (!exactPending) blockingReasons.push("pending_migration_sequence_mismatch");
  if (!ledgerClean) blockingReasons.push("migration_ledger_not_clean");
  if (!migrationOrderValid) blockingReasons.push("migration_order_invalid");
  if (!migrationChecksumsValid) blockingReasons.push("migration_checksum_drift");
  if (!schemaPreflightValid) blockingReasons.push("schema_preflight_invalid");
  if (!dataPreflightValid) blockingReasons.push("data_preflight_invalid_or_stale");
  if (!disposablePostgresVerified) blockingReasons.push("disposable_postgres_verification_missing");
  if (writes !== 0) blockingReasons.push("inspection_writes_detected");
  if (!repositoryHeadIdentified) blockingReasons.push("repository_head_not_identified");
  if (!requiredApplicationCommitIdentified) blockingReasons.push("required_application_commit_not_identified");
  if (!compatibleProductionDeployment) blockingReasons.push("production_deployment_commit_incompatible");
  if (!productionDeploymentVerified) blockingReasons.push("production_deployment_evidence_invalid_or_stale");
  if (!recoveryPointVerified) blockingReasons.push("recovery_point_unverified_or_stale");
  if (!writeBoundaryReady) blockingReasons.push("write_boundary_not_ready_or_stale");
  if (applicationCompatibilityState !== "compatible_with_write_boundary") {
    blockingReasons.push("application_compatibility_unverified");
  }
  const lineEndingCompatibilityUsed = successfulRows
    .filter((row) => {
      const migration = checkedInByName.get(row.migrationName);
      return (
        migration != null &&
        row.checksum !== migration.checksum &&
        migrationChecksumMatches(migration, row.checksum)
      );
    })
    .map((row) => row.migrationName)
    .sort();
  const warnings = [
    ...representationWarnings.map(
      (warning) =>
        `catalog_representation_diff:${warning.table}.${warning.objectName}`,
    ),
    ...rolledBackHistory.map(
      (migration) => `rolled_back_history_replaced:${migration}`,
    ),
    ...lineEndingCompatibilityUsed.map(
      (migration) => `line_ending_compatible_checksum:${migration}`,
    ),
  ].sort();

  return {
    repositoryHead,
    productionDeploymentCommit,
    requiredApplicationCommit,
    appliedMigrations: checkedInNames.filter((name) => appliedNames.has(name)),
    pendingMigrations: pendingNames,
    unexpectedMigrations,
    failedMigrations: failed,
    migrationOrderValid,
    migrationChecksumsValid,
    schemaPreflightValid,
    dataPreflightValid,
    recoveryPointVerified,
    writeBoundaryReady,
    applicationCompatibilityState,
    technicalMigrationReady,
    migrationAuthorizationReady,
    executionAuthorized,
    blockingReasons,
    warnings,
    target: input.target,
    chain: {
      checkedIn: checkedInNames.length,
      applied: appliedNames.size,
      pending: pendingNames.length,
      pendingNames,
      exactExpectedChain: exactChain,
      exactExpectedPending: exactPending,
      expectedPendingMigrations,
      targetMigration: MIGRATION_AUTHORIZATION_POLICY.targetMigration,
      gateAApplicable,
    },
    checksums: {
      matched,
      mismatched: mismatched.sort(),
      mismatchContext: mismatchContext.sort((left, right) =>
        left.migrationName.localeCompare(right.migrationName),
      ),
      missingCheckedIn: missingCheckedIn.sort(),
      missingLedgerChecksum: missingLedgerChecksum.sort(),
      lineEndingCompatibilityUsed,
    },
    ledger: {
      successful: [...appliedNames].sort(),
      successfulDetails,
      executed,
      resolvedApplied,
      unknownSuccessful,
      failed,
      rolledBack,
      rolledBackHistory,
      incomplete,
      duplicates,
      unknown,
      orderViolations,
    },
    partialObjects: { unexpectedPresent, partiallyPresent, incompatible, unableToVerify, commentsOnly },
    definitions: {
      checked: APPLIED_SCHEMA_EXPECTATIONS.length,
      missing: missingDefinitions,
      incompatible,
      appliedManifestMissing,
      appliedManifestIncompatible,
    },
    schemaIntegrity: {
      semanticDriftBlocking: semanticBlockingDifferences.length,
      representationWarningCount: representationWarnings.length,
      blockingDifferences,
      representationWarnings,
      uniquenessAssessments,
    },
    writes,
    evidence: {
      evaluatedAt,
      disposablePostgresVerified,
      productionDeploymentVerified,
      migrationTargetIdentified,
      repositoryHeadIdentified,
      requiredApplicationCommitIdentified,
    },
  };
}
