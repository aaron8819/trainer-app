import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  FINISHER_ROUTINE_SEEDS,
  stableFinisherCatalogId,
} from "../../../prisma/finisher-routine-seed-data";
import {
  FINISHER_TARGET_MIGRATION,
  principalSnapshotContractReasons,
  type FinisherPrincipalAuditRecord,
  type FinisherPrincipalSnapshot,
} from "./finisher-principal-contract";
import {
  assessFinisherProviderVerification,
  type FinisherProviderVerification,
  type ProviderVerificationExpectation,
} from "./finisher-provider-verification";

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
  operationalEvidenceMaxAgeMinutes: 30,
} as const;

export const EXPECTED_GATE_A_PENDING =
  MIGRATION_AUTHORIZATION_POLICY.expectedPendingMigrations;

export type ApplicationCompatibilityState =
  | "compatible_with_write_boundary"
  | "incompatible"
  | "unverified";

export type MigrationAuthorizationEvidence = {
  repositoryHead: string;
  requiredApplicationCommit?: string;
  evaluatedAt?: string;
};

export type LiveFinisherPrincipalVerification = {
  source: "fresh_live_database_verification";
  verifiedAt: string;
  repositoryHead: string;
  requiredApplicationCommit: string;
  targetMigration: typeof FINISHER_TARGET_MIGRATION;
  targetFingerprint: string;
  projectFingerprint?: string;
  database: string;
  credentialProof: "bounded_runtime_authentication" | "unavailable";
  readOnlyTransaction: true;
  databaseWrites: 0;
  snapshot: FinisherPrincipalSnapshot;
};

export type CanonicalOperationalVerification = FinisherProviderVerification;

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

export type EnumFact = {
  name: string;
  values: string[];
  owner?: string;
  privileges?: PrivilegeFact[];
};
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
  accessMethod?: string;
  includeColumns?: string[];
};
export type ConstraintFact = {
  table: string;
  name: string;
  type: string;
  definition: string;
  validated?: boolean;
  deferrable?: boolean;
  initiallyDeferred?: boolean;
};
export type TriggerFact = {
  table: string;
  name: string;
  definition: string;
  enabled?: string;
  functionName?: string;
  functionOwner?: string;
};
export type PrivilegeFact = {
  grantee: string;
  grantor: string;
  privilege: string;
  grantable: boolean;
};
export type FunctionFact = {
  name: string;
  definition: string;
  language?: string;
  arguments?: string;
  resultType?: string;
  volatility?: string;
  securityDefiner?: boolean;
  leakproof?: boolean;
  strict?: boolean;
  parallel?: string;
  body?: string;
  configuration?: string[] | null;
  publicExecute?: boolean;
  owner?: string;
  privileges?: PrivilegeFact[];
  referencedRelations?: string[];
  referencedFunctions?: string[];
  triggerTables?: string[];
  mutationCapability?: boolean;
};
export type TableSecurityFact = {
  table: string;
  owner: string;
  privileges: PrivilegeFact[];
  rowSecurity?: boolean;
  forceRowSecurity?: boolean;
};
export type ColumnPrivilegeFact = PrivilegeFact & {
  table: string;
  column: string;
};
export type RoleFact = {
  name: string;
  canLogin: boolean;
  inherit: boolean;
  superuser: boolean;
  createRole: boolean;
  createDb: boolean;
  replication: boolean;
  bypassRls: boolean;
  publicSchemaCreate: boolean;
};
export type RoleMembershipFact = {
  role: string;
  member: string;
  grantor: string;
  grantorIsBootstrapSuperuser: boolean;
  adminOption: boolean;
  inheritOption: boolean;
  setOption: boolean;
};
export type DefaultPrivilegeFact = PrivilegeFact & {
  owner: string;
  objectType: string;
  schema: string | null;
};
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
  tableSecurity?: TableSecurityFact[];
  columnPrivileges?: ColumnPrivilegeFact[];
  roles?: RoleFact[];
  roleMemberships?: RoleMembershipFact[];
  defaultPrivileges?: DefaultPrivilegeFact[];
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
  index?: Pick<IndexFact, "unique" | "columns" | "predicate"> & {
    accessMethod?: string;
    includeColumns?: string[];
    requireLiveEnforcement?: boolean;
  };
  constraint?: {
    type: string;
    definition?: string;
    validated?: boolean;
    deferrable?: boolean;
    initiallyDeferred?: boolean;
  };
  trigger?: {
    definition: string;
    enabled: string;
    functionName?: string;
    functionOwner?: string;
  };
  function?: {
    language: string;
    arguments: string;
    resultType: string;
    volatility: string;
    securityDefiner: boolean;
    leakproof: boolean;
    strict: boolean;
    parallel: string;
    body?: string;
    bodyIncludes?: string[];
    bodyExcludes?: string[];
    configuration?: string[] | null;
    publicExecute?: boolean;
    owner?: string;
  };
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
  index: {
    unique,
    columns,
    predicate,
    accessMethod: "btree",
    includeColumns: [],
    requireLiveEnforcement: true,
  },
});

const FINISHER_MIGRATION_SQL = readFileSync(
  join(
    process.cwd(),
    "prisma",
    "migrations",
    MIGRATION_AUTHORIZATION_POLICY.targetMigration,
    "migration.sql",
  ),
  "utf8",
);

function finisherFunction(name: string): ObjectExpectation {
  const match = FINISHER_MIGRATION_SQL.match(
    new RegExp(
      `CREATE FUNCTION ${name}\\(\\) RETURNS trigger\\s+LANGUAGE plpgsql AS \\$\\$([\\s\\S]*?)\\$\\$;`,
    ),
  );
  if (!match?.[1]) {
    throw new Error(`Missing canonical Finisher function definition: ${name}`);
  }
  return {
    kind: "function",
    name,
    function: {
      language: "plpgsql",
      arguments: "",
      resultType: "trigger",
      volatility: "v",
      securityDefiner: false,
      leakproof: false,
      strict: false,
      parallel: "u",
      body: match[1],
      owner: "trainer_finisher_owner",
      publicExecute: false,
    },
  };
}

function semanticFinisherFunction(
  name: string,
  bodyIncludes: string[],
  bodyExcludes: string[] = [],
  options: {
    arguments?: string;
    resultType?: string;
  } = {},
): ObjectExpectation {
  return {
    kind: "function",
    name,
    function: {
      language: "plpgsql",
      arguments: options.arguments ?? "",
      resultType: options.resultType ?? "trigger",
      volatility: "v",
      securityDefiner: false,
      leakproof: false,
      strict: false,
      parallel: "u",
      bodyIncludes,
      bodyExcludes,
      owner: "trainer_finisher_owner",
      publicExecute: false,
    },
  };
}

function finisherCleanupFunction(): ObjectExpectation {
  const name = "cleanup_expired_finisher_execution_commands";
  const match = FINISHER_MIGRATION_SQL.match(
    /CREATE FUNCTION cleanup_expired_finisher_execution_commands\(\s*p_batch_size INTEGER DEFAULT 100\s*\) RETURNS INTEGER\s+LANGUAGE plpgsql\s+SECURITY DEFINER\s+SET search_path = pg_catalog, pg_temp\s+AS \$\$([\s\S]*?)\$\$;/,
  );
  if (!match?.[1]) {
    throw new Error(`Missing canonical Finisher function definition: ${name}`);
  }
  return {
    kind: "function",
    name,
    function: {
      language: "plpgsql",
      arguments: "p_batch_size integer",
      resultType: "integer",
      volatility: "v",
      securityDefiner: true,
      leakproof: false,
      strict: false,
      parallel: "u",
      body: match[1],
      configuration: ["search_path=pg_catalog, pg_temp"],
      publicExecute: false,
      owner: "trainer_finisher_cleanup",
    },
  };
}

function finisherTrigger(table: string, name: string): ObjectExpectation {
  const match = FINISHER_MIGRATION_SQL.match(
    new RegExp(
      `CREATE (?:CONSTRAINT )?TRIGGER "${name}"[\\s\\S]*?;`,
    ),
  );
  if (!match?.[0]) {
    throw new Error(`Missing canonical Finisher trigger definition: ${name}`);
  }
  const functionName = match[0].match(
    /EXECUTE FUNCTION ([a-zA-Z0-9_]+)\(/,
  )?.[1];
  return {
    kind: "trigger",
    table,
    name,
    trigger: {
      definition: match[0],
      enabled: "O",
      functionName,
      functionOwner: "trainer_finisher_owner",
    },
  };
}

function semanticFinisherTrigger(
  table: string,
  name: string,
  definition: string,
  functionName: string,
): ObjectExpectation {
  return {
    kind: "trigger",
    table,
    name,
    trigger: {
      definition,
      enabled: "O",
      functionName,
      functionOwner: "trainer_finisher_owner",
    },
  };
}

const finisherExactConstraint = (
  table: string,
  name: string,
  type: string,
  definition: string,
  options: {
    validated?: boolean;
    deferrable?: boolean;
    initiallyDeferred?: boolean;
  } = {},
): ObjectExpectation => ({
  kind: "constraint",
  table,
  name,
  constraint: {
    type,
    definition,
    validated: options.validated ?? true,
    deferrable: options.deferrable ?? false,
    initiallyDeferred: options.initiallyDeferred ?? false,
  },
});

const finisherSemanticConstraint = (
  table: string,
  name: string,
  definitionIncludes: string[],
): ObjectExpectation => ({
  kind: "constraint",
  table,
  name,
  constraint: {
    type: "c",
    validated: true,
    deferrable: false,
    initiallyDeferred: false,
  },
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
    ["ownerId", "text", false],
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
    ["itemCount", "integer", false],
    ["finalizedAt", "timestamp(3) without time zone", true],
  ],
  FinisherOfferItem: [
    ["id", "text", false],
    ["offerId", "text", false],
    ["routineVersionId", "text", false],
    ["position", "integer", false],
    ["warnings", "text[]", false, "ARRAY[]::text[]"],
  ],
  FinisherDecision: [
    ["id", "text", false],
    ["ownerId", "text", false],
    ["workoutId", "text", false],
    ["offerId", "text", false],
    ["action", '"FinisherDecisionAction"', false],
    ["offerItemId", "text", true],
    ["routineVersionId", "text", true],
    ["expectedOfferRevision", "integer", false],
    ["acknowledgeContraindication", "boolean", true],
    ["requestFingerprint", "text", false],
    [
      "createdAt",
      "timestamp(3) without time zone",
      false,
      "CURRENT_TIMESTAMP",
    ],
  ],
  FinisherExecution: [
    ["id", "text", false],
    ["workoutId", "text", false],
    ["ownerId", "text", false],
    ["offerId", "text", false],
    ["offerItemId", "text", false],
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
    ["finalizedAt", "timestamp(3) without time zone", true],
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
    ["routineVersionId", "text", false],
    ["orderIndex", "integer", false],
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
    ["ownerId", "text", false],
    ["executionId", "text", false],
    ["action", '"FinisherExecutionAction"', false],
    ["requestHash", "text", false],
    ["expectedRevision", "integer", false],
    ["resultRevision", "integer", false],
    ["response", "jsonb", true],
    [
      "createdAt",
      "timestamp(3) without time zone",
      false,
      "CURRENT_TIMESTAMP",
    ],
    ["expiresAt", "timestamp(3) without time zone", false],
    ["cleanedAt", "timestamp(3) without time zone", true],
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
    ["FinisherDecisionAction", ["SELECT", "DECLINE"]],
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
      "FinisherRoutineStep",
      "FinisherRoutineStep_id_routineVersionId_orderIndex_key",
      true,
      ["id", "routineVersionId", "orderIndex"],
      null,
    ],
    [
      "FinisherRoutineStepAlternative",
      "FinisherRoutineStepAlternative_routineStepId_orderIndex_key",
      true,
      ["routineStepId", "orderIndex"],
      null,
    ],
    [
      "FinisherRoutineStepAlternative",
      "FinisherRoutineStepAlternative_id_routineStepId_key",
      true,
      ["id", "routineStepId"],
      null,
    ],
    ["FinisherOffer", "FinisherOffer_workoutId_key", true, ["workoutId"], null],
    [
      "Workout",
      "Workout_id_userId_key",
      true,
      ["id", "userId"],
      null,
    ],
    [
      "FinisherOffer",
      "FinisherOffer_workoutId_ownerId_key",
      true,
      ["workoutId", "ownerId"],
      null,
    ],
    [
      "FinisherOffer",
      "FinisherOffer_id_workoutId_ownerId_key",
      true,
      ["id", "workoutId", "ownerId"],
      null,
    ],
    [
      "FinisherOffer",
      "FinisherOffer_id_recommendedRoutineVersionId_key",
      true,
      ["id", "recommendedRoutineVersionId"],
      null,
    ],
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
      "FinisherOfferItem_id_offerId_routineVersionId_key",
      true,
      ["id", "offerId", "routineVersionId"],
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
      "FinisherDecision",
      "FinisherDecision_offerId_createdAt_idx",
      false,
      ["offerId", "createdAt"],
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
      "FinisherExecution",
      "FinisherExecution_id_workoutId_ownerId_key",
      true,
      ["id", "workoutId", "ownerId"],
      null,
    ],
    [
      "FinisherExecution",
      "FinisherExecution_id_routineVersionId_key",
      true,
      ["id", "routineVersionId"],
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
      "FinisherExecutionCommand_cleanedAt_expiresAt_id_idx",
      false,
      ["cleanedAt", "expiresAt", "id"],
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
    finisherExactConstraint(table, `${table}_pkey`, "p", "PRIMARY KEY (id)"),
  ),
  ...[
    ["FinisherRoutineVersion", "FinisherRoutineVersion_positive_version", "CHECK (version > 0)"],
    ["FinisherRoutineVersion", "FinisherRoutineVersion_preparation_range", "CHECK (preparationSeconds >= 0 AND preparationSeconds <= 60)"],
    ["FinisherRoutineStep", "FinisherRoutineStep_order_nonnegative", "CHECK (orderIndex >= 0)"],
    ["FinisherRoutineStep", "FinisherRoutineStep_work_positive", "CHECK (workSeconds > 0)"],
    ["FinisherRoutineStep", "FinisherRoutineStep_recovery_nonnegative", "CHECK (recoverySeconds >= 0)"],
    ["FinisherRoutineStepAlternative", "FinisherRoutineStepAlternative_order_nonnegative", "CHECK (orderIndex >= 0)"],
    ["FinisherOffer", "FinisherOffer_revision_positive", "CHECK (revision > 0)"],
    ["FinisherOffer", "FinisherOffer_item_count_positive", "CHECK (itemCount > 0)"],
    ["FinisherOfferItem", "FinisherOfferItem_position_nonnegative", "CHECK (position >= 0)"],
    ["FinisherDecision", "FinisherDecision_expected_offer_revision_positive", "CHECK (expectedOfferRevision > 0)"],
    ["FinisherDecision", "FinisherDecision_fingerprint_shape", "CHECK (requestFingerprint ~ '^[0-9a-f]{64}$'::text)"],
    ["FinisherExecution", "FinisherExecution_offer_revision_positive", "CHECK (offerRevisionAtSelection > 0)"],
    ["FinisherExecution", "FinisherExecution_step_nonnegative", "CHECK (currentStepIndex >= 0)"],
    ["FinisherExecution", "FinisherExecution_pause_nonnegative", "CHECK (pausedRemainingMs IS NULL OR pausedRemainingMs >= 0)"],
    ["FinisherExecution", "FinisherExecution_preparation_active_nonnegative", "CHECK (preparationActiveMs >= 0)"],
    ["FinisherExecution", "FinisherExecution_recovery_active_nonnegative", "CHECK (recoveryActiveMs >= 0)"],
    ["FinisherExecution", "FinisherExecution_preparation_pause_nonnegative", "CHECK (preparationPausedMs >= 0)"],
    ["FinisherExecution", "FinisherExecution_work_pause_nonnegative", "CHECK (workPausedMs >= 0)"],
    ["FinisherExecution", "FinisherExecution_recovery_pause_nonnegative", "CHECK (recoveryPausedMs >= 0)"],
    ["FinisherExecution", "FinisherExecution_revision_positive", "CHECK (revision > 0)"],
    ["FinisherExecution", "FinisherExecution_feedback_range", "CHECK (difficultyFeedback IS NULL OR difficultyFeedback >= 1 AND difficultyFeedback <= 10)"],
    ["FinisherExecutionStep", "FinisherExecutionStep_actual_work_nonnegative", "CHECK (actualWorkMs >= 0)"],
    ["FinisherExecutionCommand", "FinisherExecutionCommand_expected_revision_positive", "CHECK (expectedRevision > 0)"],
    ["FinisherExecutionCommand", "FinisherExecutionCommand_result_revision_positive", "CHECK (resultRevision > 0)"],
    ["FinisherExecutionCommand", "FinisherExecutionCommand_expiration_after_creation", "CHECK (expiresAt = (createdAt + '90 days'::interval))"],
    ["FinisherExecutionCommand", "FinisherExecutionCommand_cleanup_consistent", "CHECK (response IS NOT NULL AND cleanedAt IS NULL OR response IS NULL AND cleanedAt IS NOT NULL AND cleanedAt >= expiresAt)"],
  ].map(([table, name, definition]) =>
    finisherExactConstraint(table, name, "c", definition),
  ),
  finisherSemanticConstraint(
    "FinisherOffer",
    "FinisherOffer_decline_consistent",
    ["declinedAt IS NULL", "declineDecisionId IS NULL", "declinedAt IS NOT NULL", "declineDecisionId IS NOT NULL"],
  ),
  finisherSemanticConstraint(
    "FinisherOffer",
    "FinisherOffer_recommendation_consistent",
    [
      "recommendedRoutineVersionId IS NOT NULL",
      "recommendationReason IS NOT NULL",
      "recommendationUnavailableReason IS NULL",
      "recommendedRoutineVersionId IS NULL",
      "recommendationReason IS NULL",
      "recommendationUnavailableReason IS NOT NULL",
    ],
  ),
  finisherSemanticConstraint(
    "FinisherDecision",
    "FinisherDecision_action_shape",
    [
      "action = 'SELECT'::FinisherDecisionAction",
      "offerItemId IS NOT NULL",
      "routineVersionId IS NOT NULL",
      "acknowledgeContraindication IS NOT NULL",
      "action = 'DECLINE'::FinisherDecisionAction",
      "offerItemId IS NULL",
      "routineVersionId IS NULL",
      "acknowledgeContraindication IS NULL",
    ],
  ),
  finisherSemanticConstraint(
    "FinisherExecution",
    "FinisherExecution_lifecycle_consistent",
    [
      "state = 'SELECTED'::FinisherExecutionState",
      "state = 'IN_PROGRESS'::FinisherExecutionState",
      "state = 'COMPLETED'::FinisherExecutionState",
      "state = ANY (ARRAY['PARTIAL'::FinisherExecutionState, 'SKIPPED'::FinisherExecutionState])",
      "state = 'DISMISSED'::FinisherExecutionState",
      "startedAt IS NULL",
      "startedAt IS NOT NULL",
      "completedAt IS NOT NULL",
      "dismissedAt = endedAt",
    ],
  ),
  finisherSemanticConstraint(
    "FinisherExecution",
    "FinisherExecution_timer_consistent",
    [
      "timerSegment IS NULL",
      "timerSegment = ANY (ARRAY['PREPARATION'::FinisherTimerSegment, 'WORK'::FinisherTimerSegment, 'RECOVERY'::FinisherTimerSegment])",
      "pausedAt IS NULL",
      "pausedAt IS NOT NULL",
      "pausedRemainingMs IS NOT NULL",
      "timerSegment = 'FINISHED'::FinisherTimerSegment",
      "segmentEndsAt = segmentStartedAt",
    ],
  ),
  ...[
    ["FinisherRoutineVersion", "FinisherRoutineVersion_routineId_fkey", "FOREIGN KEY (routineId) REFERENCES FinisherRoutine(id) ON UPDATE RESTRICT ON DELETE RESTRICT"],
    ["FinisherRoutineStep", "FinisherRoutineStep_routineVersionId_fkey", "FOREIGN KEY (routineVersionId) REFERENCES FinisherRoutineVersion(id) ON UPDATE RESTRICT ON DELETE RESTRICT"],
    ["FinisherRoutineStepAlternative", "FinisherRoutineStepAlternative_routineStepId_fkey", "FOREIGN KEY (routineStepId) REFERENCES FinisherRoutineStep(id) ON UPDATE RESTRICT ON DELETE RESTRICT"],
    ["FinisherOffer", "FinisherOffer_workoutId_fkey", "FOREIGN KEY (workoutId, ownerId) REFERENCES Workout(id, userId) ON UPDATE RESTRICT ON DELETE RESTRICT"],
    ["FinisherOffer", "FinisherOffer_recommendedRoutineVersionId_fkey", "FOREIGN KEY (recommendedRoutineVersionId) REFERENCES FinisherRoutineVersion(id) ON UPDATE RESTRICT ON DELETE RESTRICT"],
    ["FinisherOfferItem", "FinisherOfferItem_offerId_fkey", "FOREIGN KEY (offerId) REFERENCES FinisherOffer(id) ON UPDATE RESTRICT ON DELETE RESTRICT"],
    ["FinisherOfferItem", "FinisherOfferItem_routineVersionId_fkey", "FOREIGN KEY (routineVersionId) REFERENCES FinisherRoutineVersion(id) ON UPDATE RESTRICT ON DELETE RESTRICT"],
    ["FinisherDecision", "FinisherDecision_offerId_fkey", "FOREIGN KEY (offerId, workoutId, ownerId) REFERENCES FinisherOffer(id, workoutId, ownerId) ON UPDATE RESTRICT ON DELETE RESTRICT"],
    ["FinisherDecision", "FinisherDecision_offerItem_binding_fkey", "FOREIGN KEY (offerItemId, offerId, routineVersionId) REFERENCES FinisherOfferItem(id, offerId, routineVersionId) ON UPDATE RESTRICT ON DELETE RESTRICT"],
    ["FinisherOffer", "FinisherOffer_declineDecisionId_fkey", "FOREIGN KEY (declineDecisionId) REFERENCES FinisherDecision(id) ON UPDATE RESTRICT ON DELETE RESTRICT"],
    ["FinisherExecution", "FinisherExecution_workoutId_fkey", "FOREIGN KEY (workoutId, ownerId) REFERENCES Workout(id, userId) ON UPDATE RESTRICT ON DELETE RESTRICT"],
    ["FinisherExecution", "FinisherExecution_offerId_fkey", "FOREIGN KEY (offerId, workoutId, ownerId) REFERENCES FinisherOffer(id, workoutId, ownerId) ON UPDATE RESTRICT ON DELETE RESTRICT"],
    ["FinisherExecution", "FinisherExecution_offerItem_binding_fkey", "FOREIGN KEY (offerItemId, offerId, routineVersionId) REFERENCES FinisherOfferItem(id, offerId, routineVersionId) ON UPDATE RESTRICT ON DELETE RESTRICT"],
    ["FinisherExecution", "FinisherExecution_routineVersionId_fkey", "FOREIGN KEY (routineVersionId) REFERENCES FinisherRoutineVersion(id) ON UPDATE RESTRICT ON DELETE RESTRICT"],
    ["FinisherExecution", "FinisherExecution_decisionId_fkey", "FOREIGN KEY (id) REFERENCES FinisherDecision(id) ON UPDATE RESTRICT ON DELETE RESTRICT"],
    ["FinisherExecutionStep", "FinisherExecutionStep_executionId_fkey", "FOREIGN KEY (executionId) REFERENCES FinisherExecution(id) ON UPDATE RESTRICT ON DELETE RESTRICT"],
    ["FinisherExecutionStep", "FinisherExecutionStep_routineStepId_fkey", "FOREIGN KEY (routineStepId) REFERENCES FinisherRoutineStep(id) ON UPDATE RESTRICT ON DELETE RESTRICT"],
    ["FinisherExecutionStep", "FinisherExecutionStep_executionId_routineVersionId_fkey", "FOREIGN KEY (executionId, routineVersionId) REFERENCES FinisherExecution(id, routineVersionId) ON UPDATE RESTRICT ON DELETE RESTRICT"],
    ["FinisherExecutionStep", "FinisherExecutionStep_routineStep_binding_fkey", "FOREIGN KEY (routineStepId, routineVersionId, orderIndex) REFERENCES FinisherRoutineStep(id, routineVersionId, orderIndex) ON UPDATE RESTRICT ON DELETE RESTRICT"],
    ["FinisherExecutionStep", "FinisherExecutionStep_performedAlternativeId_fkey", "FOREIGN KEY (performedAlternativeId) REFERENCES FinisherRoutineStepAlternative(id) ON UPDATE RESTRICT ON DELETE RESTRICT"],
    ["FinisherExecutionStep", "FinisherExecutionStep_performedAlternative_binding_fkey", "FOREIGN KEY (performedAlternativeId, routineStepId) REFERENCES FinisherRoutineStepAlternative(id, routineStepId) ON UPDATE RESTRICT ON DELETE RESTRICT"],
    ["FinisherExecutionCommand", "FinisherExecutionCommand_executionId_workoutId_fkey", "FOREIGN KEY (executionId, workoutId, ownerId) REFERENCES FinisherExecution(id, workoutId, ownerId) ON UPDATE RESTRICT ON DELETE RESTRICT"],
  ].map(([table, name, definition]) =>
    finisherExactConstraint(table, name, "f", definition),
  ),
  finisherExactConstraint(
    "FinisherOffer",
    "FinisherOffer_recommended_item_fkey",
    "f",
    "FOREIGN KEY (id, recommendedRoutineVersionId) REFERENCES FinisherOfferItem(offerId, routineVersionId) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED",
    { deferrable: true, initiallyDeferred: true },
  ),
  ...[
    "guard_finisher_routine_identity",
    "require_finisher_routine_version_sealed",
    "guard_finisher_routine_version_mutation",
    "guard_finisher_routine_child_mutation",
    "guard_finisher_execution_identity",
    "guard_finisher_execution_step_identity",
    "guard_finisher_execution_step_evidence",
    "guard_finisher_execution_command_tombstone",
  ].map(finisherFunction),
  semanticFinisherFunction("require_finisher_offer_finalized", [
    'offer."finalizedAt"',
    'offer."itemCount"',
    'COUNT(*)::INTEGER',
    'MIN(item."position")',
    'MAX(item."position")',
    "actual_item_count = 0",
    "actual_item_count <> expected_item_count",
    "minimum_position <> 0",
    "maximum_position <> expected_item_count - 1",
    'item."offerId" = NEW."id"',
    'item."routineVersionId" = recommended_version_id',
  ]),
  semanticFinisherFunction("require_finisher_execution_finalized", [
    'decision."action" = \'SELECT\'',
    'decision."ownerId" = execution."ownerId"',
    'decision."workoutId" = execution."workoutId"',
    'decision."offerId" = execution."offerId"',
    'decision."offerItemId" = execution."offerItemId"',
    'decision."routineVersionId" = execution."routineVersionId"',
    'decision."expectedOfferRevision" = execution."offerRevisionAtSelection"',
  ]),
  semanticFinisherFunction(
    "validate_finisher_terminal_outcome",
    [
      'execution_row."state" NOT IN (\'COMPLETED\', \'PARTIAL\', \'SKIPPED\', \'DISMISSED\')',
      'step."status" = \'PENDING\'',
      'step."status" IN (\'COMPLETED\', \'PARTIAL\')',
      'step."status" = \'SKIPPED\'',
      'execution_row."state" = \'COMPLETED\'',
      "completed_step_count <> prescribed_step_count",
      "actual_work_ms <= 0",
      'execution_row."state" = \'PARTIAL\'',
      "completed_step_count + partial_step_count = 0",
      'execution_row."state" = \'SKIPPED\'',
      "skipped_step_count <> prescribed_step_count",
      'execution_row."startedAt" IS NULL',
      "pending_step_count <> prescribed_step_count",
      "performed_step_count = 0",
      'execution_row."currentStepIndex" <> maximum_order_index',
      'execution_row."recoveryActiveMs" <> 0',
      'execution_row."workPausedMs" <> 0',
    ],
    [],
    {
      arguments: "target_execution_id text",
      resultType: "void",
    },
  ),
  semanticFinisherFunction(
    "validate_finisher_terminal_outcome_from_execution",
    [
      'validate_finisher_terminal_outcome(COALESCE(NEW."id", OLD."id"))',
    ],
  ),
  semanticFinisherFunction(
    "validate_finisher_terminal_outcome_from_step",
    [
      "TG_OP = 'DELETE'",
      'OLD."executionId"',
      'NEW."executionId"',
      "validate_finisher_terminal_outcome",
    ],
  ),
  semanticFinisherFunction("guard_finisher_offer_item_insert", [
    'FROM "FinisherOffer"',
    'WHERE "id" = NEW."offerId"',
    "FOR UPDATE",
    "IF NOT FOUND",
    "finalized_at IS NOT NULL",
  ]),
  semanticFinisherFunction("guard_finisher_execution_step_insert", [
    'FROM "FinisherExecution"',
    'WHERE "id" = NEW."executionId"',
    "FOR UPDATE",
    "IF NOT FOUND",
    "finalized_at IS NOT NULL",
  ]),
  semanticFinisherFunction("guard_finisher_offer_identity", [
    'NEW."itemCount" IS DISTINCT FROM OLD."itemCount"',
    'NEW."revision" <> OLD."revision" + 1',
    'OLD."declineDecisionId" IS NOT NULL',
    'NEW."declineDecisionId" IS DISTINCT FROM OLD."declineDecisionId"',
    'decision."action" = \'DECLINE\'',
    'decision."ownerId" = NEW."ownerId"',
    'decision."workoutId" = NEW."workoutId"',
    'decision."offerId" = NEW."id"',
    'decision."expectedOfferRevision" = OLD."revision"',
  ]),
  semanticFinisherFunction("reject_finisher_offer_item_update", [
    "finisher offer items are immutable",
  ]),
  semanticFinisherFunction("guard_finisher_execution_lifecycle", [
    'OLD."finalizedAt" IS NULL',
    "to_jsonb(NEW) - 'finalizedAt'",
    'OLD."state" IN (\'COMPLETED\', \'PARTIAL\', \'SKIPPED\', \'DISMISSED\')',
    'NEW."revision" <> OLD."revision" + 1',
    'NEW."currentStepIndex" < OLD."currentStepIndex"',
    'NEW."preparationActiveMs" < OLD."preparationActiveMs"',
    'NEW."recoveryActiveMs" < OLD."recoveryActiveMs"',
    'NEW."preparationPausedMs" < OLD."preparationPausedMs"',
    'NEW."workPausedMs" < OLD."workPausedMs"',
    'NEW."recoveryPausedMs" < OLD."recoveryPausedMs"',
    'OLD."startedAt" IS NOT NULL',
    'NEW."startedAt" IS DISTINCT FROM OLD."startedAt"',
    'OLD."state" = \'SELECTED\' AND NEW."state" IN (\'SELECTED\', \'IN_PROGRESS\', \'COMPLETED\', \'DISMISSED\')',
    'OLD."state" = \'IN_PROGRESS\' AND NEW."state" IN (\'IN_PROGRESS\', \'COMPLETED\', \'PARTIAL\', \'SKIPPED\', \'DISMISSED\')',
  ]),
  semanticFinisherFunction("guard_finisher_decision_history", [
    "TG_OP = 'DELETE'",
    "to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD)",
  ]),
  semanticFinisherFunction("require_finisher_decision_applied", [
    'NEW."action" = \'SELECT\'',
    'execution."id" = NEW."id"',
    'execution."ownerId" = NEW."ownerId"',
    'execution."workoutId" = NEW."workoutId"',
    'execution."offerId" = NEW."offerId"',
    'execution."offerItemId" = NEW."offerItemId"',
    'execution."routineVersionId" = NEW."routineVersionId"',
    'execution."offerRevisionAtSelection" = NEW."expectedOfferRevision"',
    'NEW."action" = \'DECLINE\'',
    'offer."declineDecisionId" = NEW."id"',
  ]),
  semanticFinisherFunction("reject_finisher_history_deletion", [
    "finisher lifecycle history cannot be deleted",
  ]),
  finisherCleanupFunction(),
  ...[
    ["FinisherRoutine", "FinisherRoutine_identity_immutable", "guard_finisher_routine_identity"],
    ["FinisherRoutineVersion", "FinisherRoutineVersion_require_sealed", "require_finisher_routine_version_sealed"],
    ["FinisherRoutineVersion", "FinisherRoutineVersion_immutable", "guard_finisher_routine_version_mutation"],
    ["FinisherRoutineStep", "FinisherRoutineStep_immutable", "guard_finisher_routine_child_mutation"],
    ["FinisherRoutineStepAlternative", "FinisherRoutineStepAlternative_immutable", "guard_finisher_routine_child_mutation"],
    ["FinisherExecution", "FinisherExecution_identity_immutable", "guard_finisher_execution_identity"],
    ["FinisherExecutionStep", "FinisherExecutionStep_identity_immutable", "guard_finisher_execution_step_identity"],
    ["FinisherExecutionStep", "FinisherExecutionStep_evidence_immutable", "guard_finisher_execution_step_evidence"],
    ["FinisherExecutionCommand", "FinisherExecutionCommand_tombstone", "guard_finisher_execution_command_tombstone"],
    ["FinisherOffer", "FinisherOffer_no_delete", "reject_finisher_history_deletion"],
    ["FinisherOfferItem", "FinisherOfferItem_no_delete", "reject_finisher_history_deletion"],
    ["FinisherExecution", "FinisherExecution_no_delete", "reject_finisher_history_deletion"],
    ["FinisherExecutionStep", "FinisherExecutionStep_no_delete", "reject_finisher_history_deletion"],
    ["FinisherExecutionStep", "FinisherExecutionStep_insert_before_finalization"],
  ].map(([table, name]) => finisherTrigger(table, name)),
  semanticFinisherTrigger(
    "FinisherOffer",
    "FinisherOffer_identity_immutable",
    'CREATE TRIGGER "FinisherOffer_identity_immutable" BEFORE UPDATE ON "FinisherOffer" FOR EACH ROW EXECUTE FUNCTION guard_finisher_offer_identity()',
    "guard_finisher_offer_identity",
  ),
  semanticFinisherTrigger(
    "FinisherOfferItem",
    "FinisherOfferItem_immutable",
    'CREATE TRIGGER "FinisherOfferItem_immutable" BEFORE UPDATE ON "FinisherOfferItem" FOR EACH ROW EXECUTE FUNCTION reject_finisher_offer_item_update()',
    "reject_finisher_offer_item_update",
  ),
  semanticFinisherTrigger(
    "FinisherOfferItem",
    "FinisherOfferItem_insert_before_finalization",
    'CREATE TRIGGER "FinisherOfferItem_insert_before_finalization" BEFORE INSERT ON "FinisherOfferItem" FOR EACH ROW EXECUTE FUNCTION guard_finisher_offer_item_insert()',
    "guard_finisher_offer_item_insert",
  ),
  semanticFinisherTrigger(
    "FinisherOffer",
    "FinisherOffer_require_finalized",
    'CREATE CONSTRAINT TRIGGER "FinisherOffer_require_finalized" AFTER INSERT ON "FinisherOffer" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_finisher_offer_finalized()',
    "require_finisher_offer_finalized",
  ),
  semanticFinisherTrigger(
    "FinisherExecution",
    "FinisherExecution_lifecycle_guard",
    'CREATE TRIGGER "FinisherExecution_lifecycle_guard" BEFORE UPDATE ON "FinisherExecution" FOR EACH ROW EXECUTE FUNCTION guard_finisher_execution_lifecycle()',
    "guard_finisher_execution_lifecycle",
  ),
  semanticFinisherTrigger(
    "FinisherExecution",
    "FinisherExecution_require_finalized",
    'CREATE CONSTRAINT TRIGGER "FinisherExecution_require_finalized" AFTER INSERT ON "FinisherExecution" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_finisher_execution_finalized()',
    "require_finisher_execution_finalized",
  ),
  semanticFinisherTrigger(
    "FinisherExecution",
    "FinisherExecution_terminal_outcome_coherence",
    'CREATE CONSTRAINT TRIGGER "FinisherExecution_terminal_outcome_coherence" AFTER INSERT OR UPDATE ON "FinisherExecution" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_finisher_terminal_outcome_from_execution()',
    "validate_finisher_terminal_outcome_from_execution",
  ),
  semanticFinisherTrigger(
    "FinisherExecutionStep",
    "FinisherExecutionStep_terminal_outcome_coherence",
    'CREATE CONSTRAINT TRIGGER "FinisherExecutionStep_terminal_outcome_coherence" AFTER INSERT OR DELETE OR UPDATE ON "FinisherExecutionStep" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_finisher_terminal_outcome_from_step()',
    "validate_finisher_terminal_outcome_from_step",
  ),
  semanticFinisherTrigger(
    "FinisherDecision",
    "FinisherDecision_immutable",
    'CREATE TRIGGER "FinisherDecision_immutable" BEFORE UPDATE OR DELETE ON "FinisherDecision" FOR EACH ROW EXECUTE FUNCTION guard_finisher_decision_history()',
    "guard_finisher_decision_history",
  ),
  semanticFinisherTrigger(
    "FinisherDecision",
    "FinisherDecision_require_applied",
    'CREATE CONSTRAINT TRIGGER "FinisherDecision_require_applied" AFTER INSERT ON "FinisherDecision" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_finisher_decision_applied()',
    "require_finisher_decision_applied",
  ),
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

function normalizeCatalogDefinition(value: string | null): string | null {
  return normalize(value)
    ?.replace(/\bpublic\./gi, "")
    .replace(/"([^"]+)"/g, "$1")
    .replace(
      /\b(BEFORE|AFTER|INSTEAD OF) ((?:INSERT|UPDATE|DELETE|TRUNCATE)(?: OR (?:INSERT|UPDATE|DELETE|TRUNCATE))+) ON\b/gi,
      (_match, timing: string, events: string) =>
        `${timing.toUpperCase()} ${events
          .toUpperCase()
          .split(" OR ")
          .sort()
          .join(" OR ")} ON`,
    )
    .replace(/;$/, "") ?? null;
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
  if (object.kind === "function" && object.function?.arguments) {
    return `${object.kind}:${object.name}(${object.function.arguments})`;
  }
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
      normalizeIndexPart(actual.predicate) === normalizeIndexPart(object.index.predicate) &&
      (!object.index.requireLiveEnforcement ||
        (actual.valid === true &&
          actual.ready === true &&
          actual.live === true)) &&
      (object.index.accessMethod == null ||
        actual.accessMethod === object.index.accessMethod) &&
      (object.index.includeColumns == null ||
        JSON.stringify(actual.includeColumns ?? []) ===
          JSON.stringify(object.index.includeColumns)),
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
      normalizeCatalogDefinition(actual.definition) !==
        normalizeCatalogDefinition(object.constraint.definition)
    ) {
      return false;
    }
    if (
      object.constraint?.validated != null &&
      actual.validated !== object.constraint.validated
    ) {
      return false;
    }
    if (
      object.constraint?.deferrable != null &&
      actual.deferrable !== object.constraint.deferrable
    ) {
      return false;
    }
    if (
      object.constraint?.initiallyDeferred != null &&
      actual.initiallyDeferred !== object.constraint.initiallyDeferred
    ) {
      return false;
    }
    const normalizedDefinition =
      normalizeCatalogDefinition(actual.definition) ?? "";
    return (object.definitionIncludes ?? []).every((token) =>
      normalizedDefinition.includes(
        normalizeCatalogDefinition(token) ?? "",
      ),
    );
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
  if (object.kind === "trigger") {
    const actual = snapshot.triggers.find(
      (item) => item.table === object.table && item.name === object.name,
    );
    if (!actual) return false;
    if (object.trigger) {
      return (
        actual.enabled === object.trigger.enabled &&
        (object.trigger.functionName === undefined ||
          actual.functionName === object.trigger.functionName) &&
        (object.trigger.functionOwner === undefined ||
          actual.functionOwner === object.trigger.functionOwner) &&
        normalizeCatalogDefinition(actual.definition) ===
          normalizeCatalogDefinition(object.trigger.definition)
      );
    }
    return (object.definitionIncludes ?? []).every((token) =>
      actual.definition.includes(token),
    );
  }
  const actual = snapshot.functions.find(
    (item) =>
      item.name === object.name &&
      (!object.function || item.arguments === object.function.arguments),
  );
  if (!actual) return false;
  if (object.function) {
    const actualBody = normalize(actual.body ?? null) ?? "";
    const expectedBody = object.function.body;
    return (
      actual.language === object.function.language &&
      actual.arguments === object.function.arguments &&
      actual.resultType === object.function.resultType &&
      actual.volatility === object.function.volatility &&
      actual.securityDefiner === object.function.securityDefiner &&
      actual.leakproof === object.function.leakproof &&
      actual.strict === object.function.strict &&
      actual.parallel === object.function.parallel &&
      (object.function.configuration === undefined ||
        canonicalJson(actual.configuration ?? null) ===
          canonicalJson(object.function.configuration)) &&
      (object.function.publicExecute === undefined ||
        actual.publicExecute === object.function.publicExecute) &&
      (object.function.owner === undefined ||
        actual.owner === object.function.owner) &&
      (expectedBody === undefined ||
        actualBody === (normalize(expectedBody) ?? "")) &&
      (object.function.bodyIncludes ?? []).every((token) =>
        actualBody.includes(normalize(token) ?? ""),
      ) &&
      (object.function.bodyExcludes ?? []).every(
        (token) => !actualBody.includes(normalize(token) ?? ""),
      )
    );
  }
  return (object.definitionIncludes ?? []).every((token) =>
    actual.definition.includes(token),
  );
}

const FINISHER_OWNER_ROLE = "trainer_finisher_owner";
const FINISHER_CLEANUP_ROLE = "trainer_finisher_cleanup";
const FINISHER_RUNTIME_ROLE = "trainer_app_runtime";

function privilegeKeys(
  privileges: PrivilegeFact[],
  excludedGrantee?: string,
): string[] {
  return privileges
    .filter((item) => item.grantee !== excludedGrantee)
    .map(
      (item) =>
        `${item.grantee}:${item.privilege}:${item.grantable ? "grantable" : "plain"}`,
    )
    .sort();
}

function finisherSecurityIssues(
  snapshot: CatalogSnapshot,
  expectedTables: Set<string>,
  expectedFunctions: Set<string>,
  requireTerminalMemberships: boolean,
): string[] {
  const finisherObjectsPresent = [...expectedTables].every((table) =>
    snapshot.tables.includes(table),
  );
  const issues: string[] = [];
  const expectedEnums = new Set(
    FINISHER_SCHEMA_EXPECTATIONS.filter((item) => item.kind === "enum").map(
      (item) => item.name,
    ),
  );
  const expectedTableGrants: Record<string, string[]> = {
    FinisherRoutine: [`${FINISHER_RUNTIME_ROLE}:SELECT:plain`],
    FinisherRoutineVersion: [`${FINISHER_RUNTIME_ROLE}:SELECT:plain`],
    FinisherRoutineStep: [`${FINISHER_RUNTIME_ROLE}:SELECT:plain`],
    FinisherRoutineStepAlternative: [`${FINISHER_RUNTIME_ROLE}:SELECT:plain`],
    FinisherOffer: [
      `${FINISHER_RUNTIME_ROLE}:INSERT:plain`,
      `${FINISHER_RUNTIME_ROLE}:SELECT:plain`,
      `${FINISHER_RUNTIME_ROLE}:UPDATE:plain`,
    ],
    FinisherOfferItem: [
      `${FINISHER_RUNTIME_ROLE}:INSERT:plain`,
      `${FINISHER_RUNTIME_ROLE}:SELECT:plain`,
    ],
    FinisherDecision: [
      `${FINISHER_RUNTIME_ROLE}:INSERT:plain`,
      `${FINISHER_RUNTIME_ROLE}:SELECT:plain`,
    ],
    FinisherExecution: [
      `${FINISHER_RUNTIME_ROLE}:INSERT:plain`,
      `${FINISHER_RUNTIME_ROLE}:SELECT:plain`,
      `${FINISHER_RUNTIME_ROLE}:UPDATE:plain`,
    ],
    FinisherExecutionStep: [
      `${FINISHER_RUNTIME_ROLE}:INSERT:plain`,
      `${FINISHER_RUNTIME_ROLE}:SELECT:plain`,
      `${FINISHER_RUNTIME_ROLE}:UPDATE:plain`,
    ],
    FinisherExecutionCommand: [
      `${FINISHER_CLEANUP_ROLE}:SELECT:plain`,
      `${FINISHER_RUNTIME_ROLE}:INSERT:plain`,
      `${FINISHER_RUNTIME_ROLE}:SELECT:plain`,
    ],
  };

  for (const table of finisherObjectsPresent ? expectedTables : []) {
    const security = snapshot.tableSecurity?.find(
      (item) => item.table === table,
    );
    if (!security) {
      issues.push(`table-security:${table}:unverifiable`);
      continue;
    }
    if (security.owner !== FINISHER_OWNER_ROLE) {
      issues.push(`table-owner:${table}:${security.owner}`);
    }
    if (security.rowSecurity !== false || security.forceRowSecurity !== false) {
      issues.push(
        `table-rls:${table}:${String(security.rowSecurity)}:${String(security.forceRowSecurity)}`,
      );
    }
    const actual = privilegeKeys(security.privileges, FINISHER_OWNER_ROLE);
    const expected = [...(expectedTableGrants[table] ?? [])].sort();
    if (canonicalJson(actual) !== canonicalJson(expected)) {
      issues.push(`table-privileges:${table}:${actual.join(",")}`);
    }
  }

  if (finisherObjectsPresent) {
    const protectedColumnGrants = (snapshot.columnPrivileges ?? [])
      .filter((item) => expectedTables.has(item.table))
      .map(
        (item) =>
          `${item.table}.${item.column}:${item.grantee}:${item.privilege}:${
            item.grantable ? "grantable" : "plain"
          }`,
      )
      .sort();
    const expectedColumnGrants = [
      `FinisherExecutionCommand.cleanedAt:${FINISHER_CLEANUP_ROLE}:UPDATE:plain`,
      `FinisherExecutionCommand.response:${FINISHER_CLEANUP_ROLE}:UPDATE:plain`,
    ].sort();
    if (
      canonicalJson(protectedColumnGrants) !==
      canonicalJson(expectedColumnGrants)
    ) {
      issues.push(
        `column-privileges:${protectedColumnGrants.join(",") || "missing"}`,
      );
    }
  }

  if (finisherObjectsPresent) {
    for (const enumName of expectedEnums) {
      const enumFact = snapshot.enums.find((item) => item.name === enumName);
      if (!enumFact || enumFact.owner == null || enumFact.privileges == null) {
        issues.push(`enum-security:${enumName}:unverifiable`);
        continue;
      }
      if (enumFact.owner !== FINISHER_OWNER_ROLE) {
        issues.push(`enum-owner:${enumName}:${enumFact.owner}`);
      }
      const actual = privilegeKeys(enumFact.privileges, FINISHER_OWNER_ROLE);
      const expected = [`${FINISHER_RUNTIME_ROLE}:USAGE:plain`];
      if (canonicalJson(actual) !== canonicalJson(expected)) {
        issues.push(`enum-privileges:${enumName}:${actual.join(",")}`);
      }
    }
  }

  for (const fn of snapshot.functions) {
    const key =
      fn.arguments && fn.arguments.length > 0
        ? `function:${fn.name}(${fn.arguments})`
        : `function:${fn.name}`;
    if (!expectedFunctions.has(key)) continue;
    const cleanup =
      fn.name === "cleanup_expired_finisher_execution_commands";
    const expectedOwner = cleanup
      ? FINISHER_CLEANUP_ROLE
      : FINISHER_OWNER_ROLE;
    if (fn.owner !== expectedOwner) {
      issues.push(`function-owner:${fn.name}:${fn.owner ?? "unverifiable"}`);
    }
    const actual = privilegeKeys(fn.privileges ?? [], expectedOwner);
    const runtimeCallable =
      cleanup || fn.name === "validate_finisher_terminal_outcome";
    const expected = runtimeCallable
      ? [`${FINISHER_RUNTIME_ROLE}:EXECUTE:plain`]
      : [];
    if (canonicalJson(actual) !== canonicalJson(expected)) {
      issues.push(`function-privileges:${fn.name}:${actual.join(",")}`);
    }
    if (fn.body && /\b(?:current_setting|set_config)\s*\(/i.test(fn.body)) {
      issues.push(`function-caller-setting-bypass:${fn.name}`);
    }
  }

  const expectedRoleAttributes: Record<
    string,
    Pick<
      RoleFact,
      | "canLogin"
      | "inherit"
      | "superuser"
      | "createRole"
      | "createDb"
      | "replication"
      | "bypassRls"
      | "publicSchemaCreate"
    >
  > = {
    [FINISHER_RUNTIME_ROLE]: {
      canLogin: true,
      inherit: true,
      superuser: false,
      createRole: false,
      createDb: false,
      replication: false,
      bypassRls: false,
      publicSchemaCreate: false,
    },
    [FINISHER_OWNER_ROLE]: {
      canLogin: false,
      inherit: false,
      superuser: false,
      createRole: false,
      createDb: false,
      replication: false,
      bypassRls: false,
      publicSchemaCreate: !requireTerminalMemberships,
    },
    [FINISHER_CLEANUP_ROLE]: {
      canLogin: false,
      inherit: false,
      superuser: false,
      createRole: false,
      createDb: false,
      replication: false,
      bypassRls: false,
      publicSchemaCreate: !requireTerminalMemberships,
    },
  };
  for (const [name, expected] of Object.entries(expectedRoleAttributes)) {
    const actual = snapshot.roles?.find((role) => role.name === name);
    if (!actual) {
      issues.push(`role:${name}:unverifiable`);
      continue;
    }
    const actualAttributes = {
      canLogin: actual.canLogin,
      inherit: actual.inherit,
      superuser: actual.superuser,
      createRole: actual.createRole,
      createDb: actual.createDb,
      replication: actual.replication,
      bypassRls: actual.bypassRls,
      publicSchemaCreate: actual.publicSchemaCreate,
    };
    if (canonicalJson(actualAttributes) !== canonicalJson(expected)) {
      issues.push(`role:${name}:unsafe-attributes`);
    }
  }

  const protectedRoles = new Set(Object.keys(expectedRoleAttributes));
  const protectedMemberships = (snapshot.roleMemberships ?? []).filter(
    (membership) =>
      protectedRoles.has(membership.role) ||
      protectedRoles.has(membership.member),
  );
  const expectedAutomaticRoles = [...protectedRoles].sort();
  const observedAutomaticRoles = protectedMemberships
    .map((membership) => membership.role)
    .sort();
  const administratorMembers = new Set(
    protectedMemberships.map((membership) => membership.member),
  );
  if (
    requireTerminalMemberships &&
    (
    canonicalJson(observedAutomaticRoles) !==
      canonicalJson(expectedAutomaticRoles) ||
    administratorMembers.size !== 1)
  ) {
    issues.push("role-membership:terminal-automatic-set");
  }
  for (const membership of requireTerminalMemberships ? protectedMemberships : []) {
    const exactAutomaticMembership =
      protectedRoles.has(membership.role) &&
      !protectedRoles.has(membership.member) &&
      membership.grantorIsBootstrapSuperuser &&
      membership.adminOption &&
      !membership.inheritOption &&
      !membership.setOption;
    if (!exactAutomaticMembership) {
      issues.push(
        `role-membership:${membership.member}->${membership.role}`,
      );
    }
  }
  for (const privilege of snapshot.defaultPrivileges ?? []) {
    if (
      protectedRoles.has(privilege.owner) ||
      protectedRoles.has(privilege.grantee)
    ) {
      issues.push(
        `default-privilege:${privilege.owner}:${privilege.objectType}:${
          privilege.grantee
        }:${privilege.privilege}`,
      );
    }
  }

  const finisherRelations = new Set(
    [...expectedTables].map((table) => `public.${table}`),
  );
  const finisherFunctionNames = new Set(
    [...expectedFunctions].map((key) =>
      key.slice("function:".length).replace(/\(.*$/, ""),
    ),
  );
  for (const fn of snapshot.functions) {
    const key =
      fn.arguments && fn.arguments.length > 0
        ? `function:${fn.name}(${fn.arguments})`
        : `function:${fn.name}`;
    const touchesFinisher =
      (fn.referencedRelations ?? []).some((relation) =>
        finisherRelations.has(relation),
      ) ||
      (fn.triggerTables ?? []).some((table) => expectedTables.has(table)) ||
      (fn.referencedFunctions ?? []).some((name) =>
        finisherFunctionNames.has(name.replace(/\(.*$/, "")),
      );
    if (touchesFinisher && !expectedFunctions.has(key)) {
      issues.push(
        `function-mutation-path:${fn.name}:${
          fn.mutationCapability ? "mutation" : "access"
        }`,
      );
    }
  }

  return issues.sort();
}

function unexpectedFinisherOwnedObjects(
  snapshot: CatalogSnapshot,
  requireTerminalMemberships: boolean,
): string[] {
  const expectedTables = new Set(Object.keys(FINISHER_TABLE_COLUMNS));
  const expectedColumns = new Set(
    FINISHER_SCHEMA_EXPECTATIONS.filter((item) => item.kind === "column").map(
      objectKey,
    ),
  );
  const expectedEnums = new Set(
    FINISHER_SCHEMA_EXPECTATIONS.filter((item) => item.kind === "enum").map(
      objectKey,
    ),
  );
  const expectedIndexes = new Set(
    FINISHER_SCHEMA_EXPECTATIONS.filter((item) => item.kind === "index").map(
      objectKey,
    ),
  );
  for (const table of expectedTables) {
    expectedIndexes.add(`index:${table}.${table}_pkey`);
  }
  const expectedConstraints = new Set(
    FINISHER_SCHEMA_EXPECTATIONS.filter(
      (item) => item.kind === "constraint",
    ).map(objectKey),
  );
  const expectedTriggers = new Set(
    FINISHER_SCHEMA_EXPECTATIONS.filter((item) => item.kind === "trigger").map(
      objectKey,
    ),
  );
  const expectedFunctions = new Set(
    FINISHER_SCHEMA_EXPECTATIONS.filter((item) => item.kind === "function").map(
      objectKey,
    ),
  );
  const expectedRows = new Set(
    FINISHER_SCHEMA_EXPECTATIONS.filter(
      (item) => item.kind === "catalogRow",
    ).map(objectKey),
  );
  const unexpected: string[] = [];

  for (const table of snapshot.tables.filter((name) =>
    name.startsWith("Finisher"),
  )) {
    if (!expectedTables.has(table)) unexpected.push(`table:${table}`);
  }
  for (const column of snapshot.columns.filter((item) =>
    expectedTables.has(item.table),
  )) {
    const key = `column:${column.table}.${column.name}`;
    if (!expectedColumns.has(key)) unexpected.push(key);
  }
  for (const entry of snapshot.enums.filter(
    (item) =>
      item.name.startsWith("Finisher") ||
      item.name.startsWith("WorkoutPhase"),
  )) {
    const key = `enum:${entry.name}`;
    if (!expectedEnums.has(key)) unexpected.push(key);
  }
  for (const index of snapshot.indexes.filter((item) =>
    expectedTables.has(item.table),
  )) {
    const key = `index:${index.table}.${index.name}`;
    if (!expectedIndexes.has(key)) unexpected.push(key);
  }
  for (const constraint of snapshot.constraints.filter((item) =>
    expectedTables.has(item.table),
  )) {
    const key = `constraint:${constraint.table}.${constraint.name}`;
    const matchingConstraintTrigger =
      constraint.type === "t" &&
      expectedTriggers.has(`trigger:${constraint.table}.${constraint.name}`);
    if (!expectedConstraints.has(key) && !matchingConstraintTrigger) {
      unexpected.push(key);
    }
  }
  for (const trigger of snapshot.triggers.filter((item) =>
    expectedTables.has(item.table),
  )) {
    const key = `trigger:${trigger.table}.${trigger.name}`;
    if (!expectedTriggers.has(key)) unexpected.push(key);
  }
  for (const fn of snapshot.functions.filter((item) =>
    item.name.includes("finisher"),
  )) {
    const key =
      fn.arguments && fn.arguments.length > 0
        ? `function:${fn.name}(${fn.arguments})`
        : `function:${fn.name}`;
    if (!expectedFunctions.has(key)) unexpected.push(key);
  }
  for (const row of snapshot.catalogRows) {
    const key = `catalogRow:${row.table}.${row.key}`;
    if (!expectedRows.has(key)) unexpected.push(key);
  }
  unexpected.push(
    ...finisherSecurityIssues(
      snapshot,
      expectedTables,
      expectedFunctions,
      requireTerminalMemberships,
    ),
  );
  return unexpected.sort();
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
  return /^[0-9a-f]{40}$/.test(value);
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
  target: {
    classification: "local" | "disposable" | "remote";
    fingerprint: string;
    projectFingerprint?: string;
    database?: string;
  };
  checkedIn: CheckedInMigration[];
  ledgerRows: LedgerRow[];
  catalog: CatalogSnapshot;
  writes?: number;
  authorizationEvidence?: MigrationAuthorizationEvidence;
  finisherPrincipalLiveVerification?: LiveFinisherPrincipalVerification;
  finisherPrincipalAuditRecord?: FinisherPrincipalAuditRecord;
  operationalVerification?: CanonicalOperationalVerification;
  providerVerificationExpectation?: ProviderVerificationExpectation;
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
  const unexpectedOwnedObjects = unexpectedFinisherOwnedObjects(
    input.catalog,
    appliedNames.has(MIGRATION_AUTHORIZATION_POLICY.targetMigration),
  );
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
    ...unexpectedOwnedObjects.map((difference) => ({
      category: "unexpected_finisher_owned_object" as const,
      difference,
    })),
    ...uniquenessBlockingDifferences.map((difference) => ({ category: "baseline_uniqueness" as const, ...difference })),
  ];

  const appliedSchemaVerified =
    definitionIssues.length === 0 &&
    uniquenessBlockingDifferences.length === 0 &&
    appliedManifestMissing.length === 0 &&
    appliedManifestIncompatible.length === 0 &&
    unexpectedOwnedObjects.length === 0;
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
  const evaluatedAt =
    evidence?.evaluatedAt ??
    input.finisherPrincipalLiveVerification?.verifiedAt ??
    new Date().toISOString();
  const expectedPendingMigrations: string[] = [
    ...MIGRATION_AUTHORIZATION_POLICY.expectedPendingMigrations,
  ];
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
  const operational = input.operationalVerification;
  const providerAssessment =
    operational && input.providerVerificationExpectation
      ? assessFinisherProviderVerification(
          operational,
          input.providerVerificationExpectation,
        )
      : null;
  const providerEvidence = providerAssessment?.evidence;
  const providerBindingValid = Boolean(
    providerEvidence &&
      providerAssessment?.reasons.every(
        (reason) =>
          reason === "provider_recovery_point_unverified" ||
          reason === "provider_recovery_point_creation_capability_unavailable" ||
          reason === "provider_recovery_point_incomplete" ||
          reason === "provider_write_pause_initiation_capability_unavailable" ||
          reason === "provider_write_pause_initiation_unverified" ||
          reason === "provider_evidence_operational_order_invalid",
      ),
  );
  const productionDeploymentCommit =
    providerEvidence?.deployment.sourceCommit ?? "";
  const requiredApplicationCommit =
    evidence?.requiredApplicationCommit ?? "";
  const repositoryHeadIdentified = isFullCommitSha(repositoryHead);
  const productionDeploymentCommitIdentified = isFullCommitSha(
    productionDeploymentCommit,
  );
  const requiredApplicationCommitIdentified = isFullCommitSha(
    requiredApplicationCommit,
  );
  const requiredApplicationCommitMatchesRepositoryHead =
    requiredApplicationCommitIdentified &&
    repositoryHeadIdentified &&
    requiredApplicationCommit === repositoryHead;
  const requiredApplicationCommitMatchesProductionDeployment =
    requiredApplicationCommitIdentified &&
    productionDeploymentCommitIdentified &&
    requiredApplicationCommit === productionDeploymentCommit;
  const repositoryHeadMatchesProductionDeployment =
    repositoryHeadIdentified &&
    productionDeploymentCommitIdentified &&
    repositoryHead === productionDeploymentCommit;
  const applicationCommitBindingVerified =
    requiredApplicationCommitMatchesRepositoryHead &&
    requiredApplicationCommitMatchesProductionDeployment &&
    repositoryHeadMatchesProductionDeployment;
  const migrationTargetIdentified =
    exactChain &&
    pendingSequenceConfigured &&
    checkedInNames.includes(MIGRATION_AUTHORIZATION_POLICY.targetMigration);
  // This migration is additive and does not rewrite pre-existing rows. Its data
  // preflight is therefore the freshly inspected clean schema/pending state,
  // never a caller-provided assertion.
  const dataPreflightValid = schemaClean && writes === 0;
  const disposablePostgresVerified = Boolean(
    providerBindingValid &&
      providerEvidence?.disposable.authenticated &&
      providerEvidence.disposable.terminalState.migrationApplied &&
      providerEvidence.disposable.terminalState.exactSchemaVerified &&
      providerEvidence.disposable.terminalState.exactCatalogVerified &&
      providerEvidence.disposable.terminalState.restrictedAdministratorWorkflowVerified &&
      providerEvidence.disposable.terminalState.principalTerminalStateVerified &&
      providerEvidence.disposable.terminalState.productionWritePathCoverageVerified,
  );
  const recoveryPointVerified = Boolean(
    providerBindingValid &&
      providerEvidence?.recoveryPoint.verified &&
      providerEvidence.recoveryPoint.creationCapability === "provider_operation" &&
      providerEvidence.recoveryPoint.state === "COMPLETED" &&
      providerEvidence.recoveryPoint.operationId &&
      providerEvidence.recoveryPoint.resourceId,
  );
  const writeBoundaryReady = Boolean(
    providerBindingValid &&
      providerEvidence?.writePause.verified &&
      providerEvidence.writePause.initiationCapability === "provider_operation" &&
      providerEvidence.writePause.initiationAuthorizedAt &&
      providerEvidence.writePause.initiationOperationId &&
      providerEvidence.writePause.runtimeStatus === "PAUSED" &&
      providerEvidence.writePause.mutationCoverageVerified &&
      providerEvidence.writePause.bypassPaths.length === 0,
  );
  const applicationCompatibilityState =
    providerEvidence?.applicationCompatibilityState ?? "unverified";
  const productionDeploymentVerified =
    applicationCommitBindingVerified &&
    providerBindingValid &&
    providerEvidence?.deployment.authenticated === true &&
    providerEvidence.deployment.state === "READY" &&
    providerEvidence.deployment.environment === "production" &&
    isFreshEvidenceTimestamp(providerEvidence.deployment.verifiedAt, evaluatedAt);
  const principalLive = input.finisherPrincipalLiveVerification;
  const principalReasons: string[] = [];
  if (!principalLive) {
    principalReasons.push("missing_live_verification");
  } else {
    if (
      principalLive.source !== "fresh_live_database_verification" ||
      principalLive.repositoryHead !== repositoryHead ||
      principalLive.requiredApplicationCommit !== requiredApplicationCommit ||
      principalLive.targetMigration !== FINISHER_TARGET_MIGRATION
    ) {
      principalReasons.push("commit_or_migration_binding_mismatch");
    }
    if (
      principalLive.targetFingerprint !== input.target.fingerprint ||
      (input.target.projectFingerprint != null &&
        principalLive.projectFingerprint !== input.target.projectFingerprint) ||
      principalLive.database !== input.target.database
    ) {
      principalReasons.push("target_mismatch");
    }
    if (
      !isFreshEvidenceTimestamp(principalLive.verifiedAt, evaluatedAt)
    ) {
      principalReasons.push("stale_or_invalid_timestamp");
    }
    if (
      principalLive.credentialProof !== "bounded_runtime_authentication"
    ) {
      principalReasons.push("runtime_credential_not_verified");
    }
    if (
      principalLive.readOnlyTransaction !== true ||
      principalLive.databaseWrites !== 0
    ) {
      principalReasons.push("writes_reported");
    }
    principalReasons.push(
      ...principalSnapshotContractReasons(principalLive.snapshot).map(
        (reason) => `contract_${reason}`,
      ),
    );
  }
  const principalVerificationValid = principalReasons.length === 0;
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
    input.target.classification === "remote" &&
    principalVerificationValid &&
    repositoryHeadIdentified &&
    productionDeploymentCommitIdentified &&
    requiredApplicationCommitIdentified &&
    applicationCommitBindingVerified &&
    migrationTargetIdentified &&
    recoveryPointVerified &&
    writeBoundaryReady &&
    productionDeploymentVerified &&
    providerAssessment?.valid === true &&
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
  if (gateAApplicable && !exactPending) blockingReasons.push("pending_migration_sequence_mismatch");
  if (!ledgerClean) blockingReasons.push("migration_ledger_not_clean");
  if (!migrationOrderValid) blockingReasons.push("migration_order_invalid");
  if (!migrationChecksumsValid) blockingReasons.push("migration_checksum_drift");
  if (!schemaPreflightValid) blockingReasons.push("schema_preflight_invalid");
  if (gateAApplicable && !dataPreflightValid) blockingReasons.push("data_preflight_invalid_or_stale");
  if (!disposablePostgresVerified) blockingReasons.push("disposable_postgres_verification_missing");
  if (!providerAssessment) {
    blockingReasons.push("canonical_provider_verification_missing");
  } else if (!providerAssessment.valid) {
    blockingReasons.push(...providerAssessment.reasons);
  }
  if (!principalVerificationValid) {
    blockingReasons.push(
      ...principalReasons.map(
        (reason) => `finisher_principal_live_${reason}`,
      ),
    );
  }
  if (writes !== 0) blockingReasons.push("inspection_writes_detected");
  if (!repositoryHeadIdentified) blockingReasons.push("repository_head_not_identified");
  if (!productionDeploymentCommitIdentified) {
    blockingReasons.push("production_deployment_commit_not_identified");
  }
  if (!requiredApplicationCommitIdentified) blockingReasons.push("required_application_commit_not_identified");
  if (
    requiredApplicationCommitIdentified &&
    repositoryHeadIdentified &&
    !requiredApplicationCommitMatchesRepositoryHead
  ) {
    blockingReasons.push("required_application_commit_repository_head_mismatch");
  }
  if (
    requiredApplicationCommitIdentified &&
    productionDeploymentCommitIdentified &&
    !requiredApplicationCommitMatchesProductionDeployment
  ) {
    blockingReasons.push(
      "required_application_commit_production_deployment_mismatch",
    );
  }
  if (
    repositoryHeadIdentified &&
    productionDeploymentCommitIdentified &&
    !repositoryHeadMatchesProductionDeployment
  ) {
    blockingReasons.push("repository_head_production_deployment_mismatch");
  }
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
    principalPrerequisites: {
      verified: principalVerificationValid,
      reasons: principalReasons,
      verifier:
        principalLive?.source ??
        "missing",
      verifiedAt:
        principalLive?.verifiedAt ?? null,
      verificationWrites:
        principalLive?.databaseWrites ?? null,
      credentialProof: principalLive?.credentialProof ?? null,
      auditRecordAuthority:
        input.finisherPrincipalAuditRecord?.authority ?? null,
      auditRecordUsedForAuthorization: false,
    },
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
    partialObjects: {
      unexpectedPresent,
      partiallyPresent,
      incompatible,
      unexpectedOwnedObjects,
      unableToVerify,
      commentsOnly,
    },
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
      productionDeploymentCommitIdentified,
      requiredApplicationCommitIdentified,
      requiredApplicationCommitMatchesRepositoryHead,
      requiredApplicationCommitMatchesProductionDeployment,
      repositoryHeadMatchesProductionDeployment,
      applicationCommitBindingVerified,
      providerVerificationValid: providerAssessment?.valid ?? false,
      providerVerificationReasons:
        providerAssessment?.reasons ?? ["canonical_provider_verification_missing"],
    },
  };
}
