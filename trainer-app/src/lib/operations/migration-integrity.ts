import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

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
] as const;

export const EXPECTED_GATE_A_PENDING = EXPECTED_MIGRATION_CHAIN.slice(10);

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
export type CatalogSnapshot = {
  tables: string[];
  columns: ColumnFact[];
  enums: EnumFact[];
  indexes: IndexFact[];
  constraints: ConstraintFact[];
  triggers: TriggerFact[];
  functions: FunctionFact[];
  unableToVerify?: string[];
};

export type CheckedInMigration = { name: string; checksum: string; sqlPath: string };

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

type ObjectKind = "table" | "column" | "index" | "constraint" | "trigger" | "function";
type ObjectExpectation = {
  kind: ObjectKind;
  name: string;
  table?: string;
  column?: Pick<ColumnFact, "type" | "nullable" | "default">;
  index?: Pick<IndexFact, "unique" | "columns" | "predicate">;
  constraint?: Pick<ConstraintFact, "type" | "definition">;
  definitionIncludes?: string[];
};

export type PendingMigrationExpectation = {
  migration: string;
  effect: "objects" | "comments_only";
  retainedObjects?: string[];
  objects: ObjectExpectation[];
};

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
      { kind: "index", table: "PostSessionReviewSnapshot", name: "PostSessionReviewSnapshot_contractVersion_computationPolicyVersion_idx", index: { unique: false, columns: ["contractVersion", "computationPolicyVersion"], predicate: null } },
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

export function loadCheckedInMigrations(root = join(process.cwd(), "prisma", "migrations")): CheckedInMigration[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const sqlPath = join(root, entry.name, "migration.sql");
      return { name: entry.name, checksum: checksumMigrationSql(readFileSync(sqlPath)), sqlPath };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function normalize(value: string | null): string | null {
  return value?.replace(/\s+/g, " ").trim() ?? null;
}

function normalizeIndexPart(value: string | null): string | null {
  return normalize(value)
    ?.replace(/"([^"]+)"/g, "$1")
    .replace(/ DESC NULLS FIRST$/i, " DESC")
    .replace(/ ASC NULLS LAST$/i, " ASC") ?? null;
}

function objectKey(object: ObjectExpectation): string {
  return `${object.kind}:${object.table ? `${object.table}.` : ""}${object.name}`;
}

function objectExists(snapshot: CatalogSnapshot, object: ObjectExpectation): boolean {
  if (object.kind === "table") return snapshot.tables.includes(object.name);
  if (object.kind === "column") return snapshot.columns.some((item) => item.table === object.table && item.name === object.name);
  if (object.kind === "index") return snapshot.indexes.some((item) => item.table === object.table && item.name === object.name);
  if (object.kind === "constraint") return snapshot.constraints.some((item) => item.table === object.table && item.name === object.name);
  if (object.kind === "trigger") return snapshot.triggers.some((item) => item.table === object.table && item.name === object.name);
  return snapshot.functions.some((item) => item.name === object.name);
}

function pendingObjectCompatible(snapshot: CatalogSnapshot, object: ObjectExpectation): boolean {
  if (object.kind === "table") return true;
  if (object.kind === "column") {
    const actual = snapshot.columns.find((item) => item.table === object.table && item.name === object.name);
    return Boolean(actual && object.column && actual.type === object.column.type && actual.nullable === object.column.nullable && normalize(actual.default) === normalize(object.column.default));
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
    if (object.constraint) return actual.type === object.constraint.type && normalize(actual.definition) === normalize(object.constraint.definition);
    return (object.definitionIncludes ?? []).every((token) => actual.definition.includes(token));
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

export function buildMigrationIntegrityReport(input: {
  target: { classification: "local" | "disposable" | "remote"; fingerprint: string };
  checkedIn: CheckedInMigration[];
  ledgerRows: LedgerRow[];
  catalog: CatalogSnapshot;
  writes?: number;
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
  const missingCheckedIn: string[] = [];
  const missingLedgerChecksum = input.ledgerRows
    .filter((row) => row.finishedAt && !row.rolledBackAt && !row.logs?.trim() && !row.checksum?.trim())
    .map((row) => row.migrationName);
  let matched = 0;
  for (const row of successfulRows) {
    const migration = checkedInByName.get(row.migrationName);
    if (!migration) {
      missingCheckedIn.push(row.migrationName);
    } else if (row.checksum !== migration.checksum) {
      mismatched.push(row.migrationName);
    } else {
      matched += 1;
    }
  }

  const unexpectedPresent: string[] = [];
  const partiallyPresent: string[] = [];
  const incompatible: string[] = [];
  const commentsOnly: string[] = [];
  for (const migration of PENDING_ARCHITECTURE_MANIFEST) {
    if (appliedNames.has(migration.migration)) continue;
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
    ...uniquenessBlockingDifferences.map((difference) => ({ category: "baseline_uniqueness" as const, ...difference })),
  ];

  const appliedSchemaVerified = definitionIssues.length === 0 && uniquenessBlockingDifferences.length === 0;
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
      checkedInMigration?.checksum === row.checksum &&
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
  const exactPending = JSON.stringify(pendingNames) === JSON.stringify(EXPECTED_GATE_A_PENDING);
  const ledgerClean = failed.length + rolledBack.length + incomplete.length + duplicates.length + unknown.length + orderViolations.length === 0;
  const checksumsClean = mismatched.length + missingCheckedIn.length + missingLedgerChecksum.length === 0 && matched === 10;
  const schemaClean = blockingDifferences.length === 0;
  const gateAApplicable = pendingNames.length > 0;
  const migrationAuthorizationReady =
    input.target.classification !== "local" && exactChain && exactPending && ledgerClean && checksumsClean && schemaClean && writes === 0;

  return {
    target: input.target,
    chain: {
      checkedIn: checkedInNames.length,
      applied: appliedNames.size,
      pending: pendingNames.length,
      pendingNames,
      exactExpectedChain: exactChain,
      exactExpectedPending: exactPending,
      gateAApplicable,
    },
    checksums: { matched, mismatched: mismatched.sort(), missingCheckedIn: missingCheckedIn.sort(), missingLedgerChecksum: missingLedgerChecksum.sort() },
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
    definitions: { checked: APPLIED_SCHEMA_EXPECTATIONS.length, missing: missingDefinitions, incompatible },
    schemaIntegrity: {
      semanticDriftBlocking: semanticBlockingDifferences.length,
      representationWarningCount: representationWarnings.length,
      blockingDifferences,
      representationWarnings,
      uniquenessAssessments,
    },
    writes,
    migrationAuthorizationReady,
  };
}
