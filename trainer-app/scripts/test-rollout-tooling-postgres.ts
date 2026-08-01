import { randomUUID } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  hashPreSessionReadinessIdentity,
  hashPreSessionReadinessTarget,
  hashPreSessionReadinessValue,
  type PreSessionReadinessIdentity,
} from "@/lib/api/pre-session-readiness-identity";
import type { PreSessionReadinessContract } from "@/lib/api/pre-session-readiness-contract";
import { checksumMigrationSql } from "@/lib/operations/migration-integrity";
import { parseExactDisposableConfirmationArgs } from "@/lib/operations/test-environment-preflight";

const containerName = `trainer-rollout-${process.pid}-${randomUUID().slice(0, 8)}`;
const envFile = join(tmpdir(), `${containerName}.env`);
const authorizationEvidenceFile = join(
  tmpdir(),
  `${containerName}-authorization-evidence.json`,
);
const principalProvisionEvidenceFile = join(
  tmpdir(),
  `${containerName}-principal-provision.json`,
);
const principalVerificationEvidenceFile = join(
  tmpdir(),
  `${containerName}-principal-verification.json`,
);
const principalRepeatEvidenceFile = join(
  tmpdir(),
  `${containerName}-principal-repeat.json`,
);
const principalPartialEvidenceFile = join(
  tmpdir(),
  `${containerName}-principal-partial.json`,
);
const principalWrongTargetEvidenceFile = join(
  tmpdir(),
  `${containerName}-principal-wrong-target.json`,
);
const principalWrongPasswordEvidenceFile = join(
  tmpdir(),
  `${containerName}-principal-wrong-password.json`,
);
const preMigrationCount = 10;
const currentProductionAppliedCount = 17;
const targetMigration = "20260728120000_add_finishers_phase_1";
const migrationAdministrator = "trainer_migration_admin";
const migrationAdministratorPassword = "trainer-migration-admin";
const runtimePassword = "trainer-app-runtime";
const wrongRuntimePassword = "trainer-app-runtime-wrong";
let repositoryHead = "";

type CommandResult = { status: number; stdout: string; stderr: string };

function run(
  executable: string,
  args: string[],
  options: { input?: string; quiet?: boolean; env?: Record<string, string> } = {},
): CommandResult {
  const result = spawnSync(executable, args, {
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      NODE_ENV: "test",
      ...options.env,
    },
    encoding: "utf8",
    input: options.input,
    stdio: options.quiet ? "pipe" : ["pipe", "inherit", "inherit"],
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function requireSuccess(result: CommandResult, label: string): CommandResult {
  if (result.status !== 0) {
    throw new Error(`${label} failed status=${result.status}\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

function waitForPostgres(): void {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = run("docker", [
      "exec", "-i", containerName, "psql", "-U", "trainer", "-d", "trainer", "-tAc", "SELECT 1",
    ], { quiet: true });
    if (result.status === 0) return;
    const until = Date.now() + 500;
    while (Date.now() < until) {
      // Bounded polling for an isolated local PostgreSQL container.
    }
  }
  throw new Error("DISPOSABLE_ROLLOUT_POSTGRES_DID_NOT_BECOME_READY");
}

function psql(sql: string, tuplesOnly = false): string {
  const args = [
    "exec", "-i", containerName, "psql", "-v", "ON_ERROR_STOP=1", "-U", "trainer", "-d", "trainer",
  ];
  if (tuplesOnly) args.push("-tA");
  const result = requireSuccess(run("docker", args, { input: sql, quiet: true }), "psql");
  return result.stdout.trim();
}

function runPsqlAsMigrationAdministrator(
  sql: string,
  tuplesOnly = false,
): CommandResult {
  const args = [
    "exec",
    "-e",
    `PGPASSWORD=${migrationAdministratorPassword}`,
    "-i",
    containerName,
    "psql",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    migrationAdministrator,
    "-d",
    "trainer",
  ];
  if (tuplesOnly) args.push("-tA");
  return run("docker", args, { input: sql, quiet: true });
}

function psqlAsMigrationAdministrator(
  sql: string,
  tuplesOnly = false,
): string {
  const result = requireSuccess(
    runPsqlAsMigrationAdministrator(sql, tuplesOnly),
    "migration-administrator psql",
  );
  return result.stdout.trim();
}

function migrationDirectories(): string[] {
  const root = join(process.cwd(), "prisma", "migrations");
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function applyMigrations(names: string[]): void {
  for (const name of names) {
    const sql = readFileSync(join(process.cwd(), "prisma", "migrations", name, "migration.sql"), "utf8");
    psqlAsMigrationAdministrator(sql);
  }
}

function migrationChecksum(name: string): string {
  const bytes = readFileSync(join(process.cwd(), "prisma", "migrations", name, "migration.sql"));
  return checksumMigrationSql(bytes);
}

function recordMigration(name: string, index: number): void {
  psqlAsMigrationAdministrator(`
    INSERT INTO public._prisma_migrations (
      id, checksum, finished_at, migration_name, logs, rolled_back_at, applied_steps_count
    ) VALUES (
      'migration-${String(index).padStart(2, "0")}',
      '${migrationChecksum(name)}',
      CURRENT_TIMESTAMP,
      '${name}',
      NULL,
      NULL,
      1
    );
  `);
}

function recordMigrations(names: string[], offset = 0): void {
  names.forEach((name, index) => recordMigration(name, offset + index));
}

function prismaResolve(name: string, disposableUrl: string): CommandResult {
  return run(
    process.execPath,
    [join(process.cwd(), "node_modules", "prisma", "build", "index.js"), "migrate", "resolve", "--applied", name],
    {
      quiet: true,
      env: { DATABASE_URL: disposableUrl, DIRECT_URL: disposableUrl },
    },
  );
}

function requireResolvedLedgerShape(name: string): void {
  const shape = psql(`
    SELECT
      (finished_at IS NOT NULL)::text,
      (coalesce(logs, '') = '')::text,
      (rolled_back_at IS NULL)::text,
      applied_steps_count::text,
      count(*) OVER ()::text
    FROM public._prisma_migrations
    WHERE migration_name = '${name}';
  `, true);
  if (shape !== "true|true|true|0|1") {
    throw new Error(`Prisma resolve produced an unexpected ledger shape for ${name}: ${shape}`);
  }
}

function convertBaselineUniqueIndexesToConstraints(): void {
  psql(`
    ALTER TABLE "ExerciseAlias"
      ADD CONSTRAINT "ExerciseAlias_alias_key" UNIQUE USING INDEX "ExerciseAlias_alias_key";
    ALTER TABLE "WorkoutTemplateExercise"
      ADD CONSTRAINT "WorkoutTemplateExercise_templateId_orderIndex_key"
      UNIQUE USING INDEX "WorkoutTemplateExercise_templateId_orderIndex_key";
  `);
}

function parseLastJson(stdout: string): Record<string, unknown> {
  for (let index = stdout.lastIndexOf("{"); index >= 0; index = stdout.lastIndexOf("{", index - 1)) {
    try {
      return JSON.parse(stdout.slice(index).trim()) as Record<string, unknown>;
    } catch {
      // Continue until the outermost final JSON object is found.
    }
  }
  throw new Error(`No JSON report found in output:\n${stdout}`);
}

function cli(script: string, args: string[]): Record<string, unknown> {
  const evidenceArgs =
    script === "scripts/check-migration-status.ts"
      ? [
          "--evidence-file",
          authorizationEvidenceFile,
          "--principal-audit-file",
          principalVerificationEvidenceFile,
          "--required-application-commit",
          repositoryHead,
        ]
      : [];
  const result = requireSuccess(
    run(process.execPath, [join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"), script, "--env-file", envFile, "--confirm-disposable", ...evidenceArgs, ...args], {
      quiet: true,
      env: { TRAINER_APP_RUNTIME_PASSWORD: runtimePassword },
    }),
    `${script} ${args.join(" ")}`,
  );
  if (result.stdout.includes("configured-remote.invalid")) {
    throw new Error("Configured parent DATABASE_URL leaked into disposable rollout tooling");
  }
  return parseLastJson(result.stdout);
}

function cliWithExpectedStatus(script: string, args: string[], expectedStatus: number): Record<string, unknown> {
  const evidenceArgs =
    script === "scripts/check-migration-status.ts"
      ? [
          "--evidence-file",
          authorizationEvidenceFile,
          "--principal-audit-file",
          principalVerificationEvidenceFile,
          "--required-application-commit",
          repositoryHead,
        ]
      : [];
  const result = run(
    process.execPath,
    [join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"), script, "--env-file", envFile, "--confirm-disposable", ...evidenceArgs, ...args],
    {
      quiet: true,
      env: { TRAINER_APP_RUNTIME_PASSWORD: runtimePassword },
    },
  );
  if (result.status !== expectedStatus) {
    throw new Error(`Unexpected ${script} status=${result.status}; expected=${expectedStatus}\n${result.stdout}\n${result.stderr}`);
  }
  if (`${result.stdout}\n${result.stderr}`.includes("trainer-rollout")) {
    throw new Error("Disposable connection credential or container identifier leaked into migration output");
  }
  if (!result.stdout.trim()) {
    throw new Error(`No migration report was emitted:\n${result.stderr}`);
  }
  return parseLastJson(result.stdout);
}

function databaseStateFingerprint(): string {
  return psql(`
    SELECT md5(string_agg(value, E'\\n' ORDER BY value))
    FROM (
      SELECT 'table:' || c.relname AS value
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      UNION ALL
      SELECT 'column:' || c.relname || ':' || a.attname || ':' ||
        format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':' ||
        coalesce(pg_get_expr(d.adbin, d.adrelid), '')
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped
      UNION ALL
      SELECT 'index:' || pg_get_indexdef(i.indexrelid)
      FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
      UNION ALL
      SELECT 'constraint:' || con.conname || ':' || pg_get_constraintdef(con.oid, true)
      FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
      UNION ALL
      SELECT 'trigger:' || t.tgname || ':' || pg_get_triggerdef(t.oid, true)
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND NOT t.tgisinternal
      UNION ALL
      SELECT 'function:' || p.proname || ':' || pg_get_functiondef(p.oid)
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.prokind = 'f'
      UNION ALL
      SELECT 'ledger:' || id || ':' || checksum || ':' || coalesce(finished_at::text, '') || ':' ||
        migration_name || ':' || coalesce(logs, '') || ':' || coalesce(rolled_back_at::text, '') || ':' || applied_steps_count::text
      FROM public._prisma_migrations
    ) facts;
  `, true);
}

function principalStateFingerprint(): string {
  return psql(`
    WITH protected_roles AS (
      SELECT oid, rolname, rolcanlogin, rolinherit, rolsuper, rolcreatedb,
        rolcreaterole, rolreplication, rolbypassrls, rolpassword
      FROM pg_catalog.pg_authid
      WHERE rolname IN (
        'trainer_app_runtime',
        'trainer_finisher_owner',
        'trainer_finisher_cleanup'
      )
    ), facts AS (
      SELECT 'role:' || row_to_json(role)::text AS value
      FROM protected_roles role
      UNION ALL
      SELECT 'membership:' || row_to_json(membership)::text
      FROM pg_catalog.pg_auth_members membership
      WHERE membership.roleid IN (SELECT oid FROM protected_roles)
         OR membership.member IN (SELECT oid FROM protected_roles)
      UNION ALL
      SELECT 'schema:' || role.rolname || ':' ||
        pg_catalog.has_schema_privilege(role.rolname, 'public', 'CREATE')::text
      FROM protected_roles role
    )
    SELECT md5(string_agg(value, E'\\n' ORDER BY value)) FROM facts;
  `, true);
}

function cliMustFail(script: string, args: string[], expected: RegExp): void {
  const result = run(
    process.execPath,
    [join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"), script, "--env-file", envFile, "--confirm-disposable", ...args],
    { quiet: true },
  );
  if (result.status === 0 || !expected.test(`${result.stdout}\n${result.stderr}`)) {
    throw new Error(`Expected clear failure from ${script}; status=${result.status}\n${result.stdout}\n${result.stderr}`);
  }
}

function numberField(value: Record<string, unknown>, name: string): number {
  const field = value[name];
  if (typeof field !== "number") throw new Error(`Expected numeric ${name}`);
  return field;
}

function objectField(value: Record<string, unknown>, name: string): Record<string, unknown> {
  const field = value[name];
  if (!field || typeof field !== "object" || Array.isArray(field)) {
    throw new Error(`Expected object ${name}`);
  }
  return field as Record<string, unknown>;
}

function arrayField(value: Record<string, unknown>, name: string): unknown[] {
  const field = value[name];
  if (!Array.isArray(field)) throw new Error(`Expected array ${name}`);
  return field;
}

function objectArrayItem(value: Record<string, unknown>, name: string, objectName: string): Record<string, unknown> {
  const item = arrayField(value, name).find((candidate) => (
    Boolean(candidate) && typeof candidate === "object" && !Array.isArray(candidate) &&
    (candidate as Record<string, unknown>).objectName === objectName
  ));
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new Error(`Expected ${objectName} in ${name}`);
  }
  return item as Record<string, unknown>;
}

function requireUniquenessAssessment(
  report: Record<string, unknown>,
  objectName: string,
  expected: { semantic: boolean; representation: boolean; blocks: boolean },
): void {
  const assessment = objectArrayItem(objectField(report, "schemaIntegrity"), "uniquenessAssessments", objectName);
  if (
    assessment.semanticEquivalent !== expected.semantic ||
    assessment.catalogRepresentationEquivalent !== expected.representation ||
    assessment.migrationBlocking !== expected.blocks
  ) {
    throw new Error(`Unexpected uniqueness assessment for ${objectName}: ${JSON.stringify(assessment)}`);
  }
}

function requireFinisherGateAFailure(
  label: string,
  expectedDifference: string,
): void {
  psql(
    `DELETE FROM public._prisma_migrations WHERE migration_name = '${targetMigration}';`,
  );
  try {
    const report = cliWithExpectedStatus(
      "scripts/check-migration-status.ts",
      [],
      1,
    );
    const chain = objectField(report, "chain");
    const differences = JSON.stringify(report);
    if (
      chain.gateAApplicable !== true ||
      numberField(chain, "pending") !== 1 ||
      report.schemaPreflightValid !== false ||
      report.technicalMigrationReady !== false ||
      report.migrationAuthorizationReady !== false ||
      !differences.includes(expectedDifference)
    ) {
      throw new Error(
        `${label} did not fail Gate A with the expected exact-integrity difference: ${JSON.stringify(report)}`,
      );
    }
  } finally {
    recordMigration(targetMigration, currentProductionAppliedCount);
  }
}

function requireFinisherAppliedSchemaFailure(
  label: string,
  expectedDifference: string,
): void {
  const report = cliWithExpectedStatus(
    "scripts/check-migration-status.ts",
    [],
    1,
  );
  const chain = objectField(report, "chain");
  const differences = JSON.stringify({
    blocking: objectField(report, "schemaIntegrity").blockingDifferences,
    definitions: objectField(report, "definitions"),
  });
  if (
    chain.gateAApplicable !== false ||
    numberField(chain, "pending") !== 0 ||
    report.schemaPreflightValid !== false ||
    report.technicalMigrationReady !== false ||
    report.migrationAuthorizationReady !== false ||
    !differences.includes(expectedDifference)
  ) {
    throw new Error(
      `${label} did not fail applied-schema integrity with the expected difference: ${JSON.stringify(report)}`,
    );
  }
}

function insertHistoricalFixture(): void {
  psql(`
    INSERT INTO "User" ("id", "email") VALUES ('rollout-user', 'rollout-fixture@test.invalid');
    INSERT INTO "MacroCycle" (
      "id", "userId", "startDate", "endDate", "durationWeeks", "trainingAge", "primaryGoal", "updatedAt"
    ) VALUES (
      'rollout-macro', 'rollout-user', '2026-01-01', '2026-04-01', 12, 'INTERMEDIATE', 'HYPERTROPHY', CURRENT_TIMESTAMP
    );
    INSERT INTO "Mesocycle" (
      "id", "macroCycleId", "mesoNumber", "startWeek", "durationWeeks", "focus",
      "volumeTarget", "intensityBias", "state", "isActive", "closedAt", "slotPlanSeedJson"
    ) VALUES
      (
        'rollout-valid-meso', 'rollout-macro', 1, 0, 4, 'Fixture valid',
        'MODERATE', 'HYPERTROPHY', 'ACTIVE_ACCUMULATION', true, NULL,
        '{"version":1,"slots":[{"slotId":"upper_a","exercises":[{"exerciseId":"rollout-exercise","role":"CORE_COMPOUND","setCount":3}]}]}'::jsonb
      ),
      (
        'rollout-valid-meso-2', 'rollout-macro', 2, 4, 4, 'Fixture valid 2',
        'MODERATE', 'HYPERTROPHY', 'COMPLETED', false, '2026-02-01',
        '{"version":1,"slots":[{"slotId":"upper_b","exercises":[{"exerciseId":"rollout-exercise","role":"ACCESSORY","setCount":4}]}]}'::jsonb
      ),
      (
        'rollout-valid-meso-3', 'rollout-macro', 3, 8, 4, 'Fixture valid 3',
        'MODERATE', 'HYPERTROPHY', 'COMPLETED', false, '2026-03-01',
        '{"version":1,"slots":[{"slotId":"lower_a","exercises":[{"exerciseId":"rollout-exercise","role":"CORE_COMPOUND","setCount":5}]}]}'::jsonb
      ),
      (
        '12079700-5333-4ffc-9cbd-bb303588f288', 'rollout-macro', 4, 12, 4, 'Fixture legacy exception',
        'MODERATE', 'HYPERTROPHY', 'COMPLETED', false, '2026-02-01',
        '{"version":1,"slots":[{"slotId":"upper_a","exercises":[{"exerciseId":"rollout-exercise","role":"CORE_COMPOUND"}]}]}'::jsonb
      );
    INSERT INTO "Muscle" ("id", "name", "mv", "mev", "mav", "mrv", "sraHours")
      VALUES ('rollout-muscle', 'Chest', 4, 8, 12, 18, 48);
    INSERT INTO "Exercise" (
      "id", "name", "movementPatterns", "splitTags", "jointStress", "isMainLiftEligible",
      "isCompound", "fatigueCost", "stimulusBias", "timePerSetSec", "sfrScore",
      "lengthPositionScore", "difficulty", "isUnilateral", "repRangeMin", "repRangeMax"
    ) VALUES (
      'rollout-exercise', 'Fixture Press', ARRAY['HORIZONTAL_PUSH']::"MovementPatternV2"[],
      ARRAY['PUSH']::"SplitTag"[], 'LOW', true, true, 3, ARRAY['MECHANICAL']::"StimulusBias"[],
      120, 3, 3, 'BEGINNER', false, 5, 12
    );
    INSERT INTO "ExerciseMuscle" ("exerciseId", "muscleId", "role")
      VALUES ('rollout-exercise', 'rollout-muscle', 'PRIMARY');
    INSERT INTO "Workout" (
      "id", "userId", "scheduledDate", "completedAt", "status", "selectionMode", "sessionIntent",
      "revision", "advancesSplit", "mesocycleId", "mesocyclePhaseSnapshot",
      "mesocycleWeekSnapshot", "mesoSessionSnapshot"
    ) VALUES (
      'rollout-workout', 'rollout-user', '2026-01-10', '2026-01-10 12:00:00', 'COMPLETED',
      'INTENT', 'UPPER', 1, true, 'rollout-valid-meso', 'ACCUMULATION', 1, 1
    );
    INSERT INTO "WorkoutExercise" (
      "id", "workoutId", "exerciseId", "orderIndex", "section", "isMainLift", "movementPatterns"
    ) VALUES (
      'rollout-workout-exercise', 'rollout-workout', 'rollout-exercise', 0, 'MAIN', true,
      ARRAY['HORIZONTAL_PUSH']::"MovementPatternV2"[]
    );
    INSERT INTO "WorkoutSet" (
      "id", "workoutExerciseId", "setIndex", "targetReps", "targetRepMin", "targetRepMax", "targetRpe", "targetLoad"
    ) VALUES ('rollout-set', 'rollout-workout-exercise', 0, 8, 8, 10, 8, 100);
    INSERT INTO "SetLog" (
      "id", "workoutSetId", "setIntent", "actualReps", "actualRpe", "actualLoad", "completedAt", "wasSkipped"
    ) VALUES ('rollout-log', 'rollout-set', 'WORK', 8, 8, 100, '2026-01-10 12:00:00', false);
  `);
}

function readinessContract(input: {
  slotId: string;
  sessionInWeek: number;
  existingWorkoutId?: string | null;
}): PreSessionReadinessContract {
  return {
    contractVersion: 1,
    scope: {
      mode: "pre-session-readiness",
      ownerSeam: "api/pre-session-readiness-contract",
      source: {
        producerMode: "persisted_snapshot",
        producer: "pre_session_readiness_snapshot",
        provenance: "app_read_model",
      },
      readOnly: true,
      affectsScoringOrGeneration: false,
    },
    nextSessionIdentity: {
      userId: "rollout-user",
      activeMesocycleId: "rollout-valid-meso",
      activeState: "ACTIVE_ACCUMULATION",
      currentWeek: 1,
      currentSession: input.sessionInWeek,
      nextSlotId: input.slotId,
      nextIntent: "upper",
      existingWorkoutId: input.existingWorkoutId ?? null,
      incompleteWorkoutStatus: null,
      incompleteWorkoutReadiness: "none",
      existingWorkoutAction: "none",
      generationPath: "standard_generation",
      generator: "generateSessionFromIntent",
    },
    startability: {
      status: "startable",
      safeToTrain: true,
      normalStartCoachingAllowed: true,
      action: "run_seed_as_prescribed",
      reasons: [],
      blockerSummary: "none",
    },
    seedRuntimeProof: {
      status: "valid",
      compositionSource: "persisted_slot_plan_seed",
      receiptMesocycleId: "rollout-valid-meso",
      seedSource: "handoff_slot_plan_projection",
      seedExecutableShape: "set_aware",
      seedOrderSetCountsRespected: true,
      readOnlyEvidenceOnly: true,
      seedRuntimeChanged: false,
      proofLines: [],
    },
    projectedWeekStatus: {
      status: "no_further_action",
      currentWeek: 1,
      phase: "accumulation",
      belowMev: [],
      overMav: [],
      fatigueRisks: [],
      projectionNotes: [],
      doseGuidanceRows: [],
    },
    doseClosure: {
      heading: "Dose Closure Guidance",
      priority: [],
      optional: [],
      monitor: [],
      suppress: [],
      guardrails: [],
      recommendations: [],
    },
    sessionLocalCoaching: {
      defaultInstruction: "Run seed as prescribed.",
      floorBufferOpportunities: [],
      prescriptionConfidenceWatches: [],
      fatigueCautions: [],
      safeOptionalAddOns: [],
      suppressAvoid: [],
      addOnState: { status: "none", reason: "No optional add-ons." },
    },
    calibrationWatches: { prescriptionConfidence: [], recoveryCaveats: [], fatigue: [] },
    consistencyChecks: [],
    boundaries: {
      readOnly: true,
      affectsScoringOrGeneration: false,
      wouldWriteTransaction: false,
      dbMutation: false,
      workoutLogSessionCreated: false,
      seedRuntimeChanged: false,
      plannerMaterializerChanged: false,
      notes: [],
    },
  };
}

function sqlJson(value: unknown): string {
  return JSON.stringify(value).replaceAll("'", "''");
}

function insertLegacyReadiness(input: {
  id: string;
  slotId: string;
  sessionInWeek: number;
  active: boolean;
  plannedWorkout?: boolean;
}): void {
  const workoutId = input.plannedWorkout ? "rollout-workout" : null;
  const contract = readinessContract({
    slotId: input.slotId,
    sessionInWeek: input.sessionInWeek,
    existingWorkoutId: workoutId,
  });
  psql(`
    INSERT INTO "PreSessionReadinessSnapshot" (
      "id", "userId", "activeMesocycleId", "mesocycleState", "weekInMeso",
      "sessionInWeek", "slotId", "slotIntent", "plannedWorkoutId",
      "plannedWorkoutRevision", "contractVersion", "contractJson", "sourceStateHash",
      "slotPlanSeedHash", "slotSequenceHash", "invalidatedAt", "invalidatedReason"
    ) VALUES (
      '${input.id}', 'rollout-user', 'rollout-valid-meso', 'ACTIVE_ACCUMULATION', 1,
      ${input.sessionInWeek}, '${input.slotId}', 'upper',
      ${workoutId ? `'${workoutId}'` : "NULL"}, ${workoutId ? "1" : "NULL"},
      1, '${sqlJson(contract)}'::jsonb, 'legacy-source-${input.id}',
      'legacy-seed', 'legacy-sequence',
      ${input.active ? "NULL" : "CURRENT_TIMESTAMP"},
      ${input.active ? "NULL" : "'fixture_invalidated'"}
    );
  `);
}

function insertExactReadiness(input: {
  id: string;
  slotId: string;
  persistedIdentityHash?: string;
  persistedTargetHash?: string;
  persistedPayloadHash?: string;
}): void {
  const contract = readinessContract({ slotId: input.slotId, sessionInWeek: 1 });
  const identity: PreSessionReadinessIdentity = {
    identityContractVersion: 1,
    ownerId: "rollout-user",
    activeMesocycleId: "rollout-valid-meso",
    mesocycleState: "ACTIVE_ACCUMULATION",
    weekInMeso: 1,
    sessionInWeek: 1,
    target: {
      kind: "future_slot",
      mesocycleId: "rollout-valid-meso",
      weekInMeso: 1,
      sessionInWeek: 1,
      slotId: input.slotId,
      slotIntent: "upper",
      seedRevision: {
        status: "exact_revision",
        revisionId: "rollout-exact-seed",
        revision: 2,
        payloadHash: "rollout-seed-hash",
      },
      slotSequenceHash: "rollout-sequence-hash",
    },
    readinessEvidenceFingerprint: "rollout-readiness-hash",
    projectionFingerprint: "rollout-projection-hash",
  };
  const identityHash = input.persistedIdentityHash ?? hashPreSessionReadinessIdentity(identity);
  const targetHash = input.persistedTargetHash ?? hashPreSessionReadinessTarget(identity);
  const payloadHash = input.persistedPayloadHash ?? hashPreSessionReadinessValue(contract);
  psql(`
    INSERT INTO "PreSessionReadinessSnapshot" (
      "id", "userId", "activeMesocycleId", "mesocycleState", "weekInMeso",
      "sessionInWeek", "slotId", "slotIntent", "contractVersion", "contractJson",
      "identityStatus", "identityContractVersion", "identityJson", "identityHash",
      "targetHash", "payloadHash", "readinessEvidenceFingerprint", "projectionFingerprint",
      "seedRevisionId", "seedRevisionNumber", "seedPayloadHash", "sourceStateHash",
      "slotPlanSeedHash", "slotSequenceHash"
    ) VALUES (
      '${input.id}', 'rollout-user', 'rollout-valid-meso', 'ACTIVE_ACCUMULATION', 1,
      1, '${input.slotId}', 'upper', 1, '${sqlJson(contract)}'::jsonb,
      'EXACT', 1, '${sqlJson(identity)}'::jsonb, '${identityHash}',
      '${targetHash}', '${payloadHash}', 'rollout-readiness-hash', 'rollout-projection-hash',
      'rollout-exact-seed', 2, 'rollout-seed-hash', '${identityHash}',
      'rollout-seed-hash', 'rollout-sequence-hash'
    );
  `);
}

const invocation = parseExactDisposableConfirmationArgs(
  process.argv.slice(2),
  "npm run test:db:rollout-tooling -- --confirm-disposable",
);
if (!invocation.valid) {
  console.error(invocation.message);
  process.exit(2);
}

try {
  requireSuccess(run("docker", [
    "run", "--rm", "-d", "--name", containerName,
    "-e", "POSTGRES_USER=trainer",
    "-e", "POSTGRES_PASSWORD=trainer-rollout",
    "-e", "POSTGRES_DB=trainer",
    "-p", "127.0.0.1::5432",
    "postgres:16-alpine",
  ], { quiet: true }), "docker run");
  waitForPostgres();
  psql(`
    CREATE ROLE ${migrationAdministrator}
      LOGIN NOINHERIT NOSUPERUSER NOCREATEDB CREATEROLE
      NOREPLICATION NOBYPASSRLS
      PASSWORD '${migrationAdministratorPassword}';
    ALTER DATABASE trainer OWNER TO ${migrationAdministrator};
    ALTER SCHEMA public OWNER TO ${migrationAdministrator};
  `);
  const port = requireSuccess(run("docker", ["port", containerName, "5432/tcp"], { quiet: true }), "docker port")
    .stdout.trim().split(":").at(-1);
  if (!port) throw new Error("DISPOSABLE_ROLLOUT_POSTGRES_PORT_NOT_FOUND");
  const disposableUrl =
    `postgresql://${migrationAdministrator}:${migrationAdministratorPassword}` +
    `@127.0.0.1:${port}/trainer`;
  writeFileSync(
    envFile,
    `DATABASE_URL=${disposableUrl}\nDIRECT_URL=${disposableUrl}\n`,
  );
  repositoryHead = requireSuccess(
    run("git", ["rev-parse", "HEAD"], { quiet: true }),
    "git rev-parse HEAD",
  ).stdout.trim();
  const principalCommand = join(
    process.cwd(),
    "node_modules",
    "tsx",
    "dist",
    "cli.mjs",
  );
  const principalCommonArgs = [
    "--env-file",
    envFile,
    "--environment",
    "disposable",
    "--expected-project-reference",
    "disposable",
    "--expected-database",
    "trainer",
    "--required-application-commit",
    repositoryHead,
    "--confirm-disposable",
  ];
  requireSuccess(
    run(
      process.execPath,
      [
        principalCommand,
        ...principalCommonArgs,
        "--mode",
        "provision",
        "--write",
        "--confirm-principal-provisioning",
        "trainer-principals:disposable",
        "--evidence-file",
        principalProvisionEvidenceFile,
      ],
      {
        quiet: true,
        env: { TRAINER_APP_RUNTIME_PASSWORD: runtimePassword },
      },
    ),
    "canonical principal provisioning",
  );
  const cleanProvisionEvidence = JSON.parse(
    readFileSync(principalProvisionEvidenceFile, "utf8"),
  ) as Record<string, unknown>;
  if (
    cleanProvisionEvidence.databaseWrites !== 8 ||
    cleanProvisionEvidence.credentialConfigured !== true ||
    arrayField(cleanProvisionEvidence, "createdPrincipals").length !== 3
  ) {
    throw new Error(
      `Clean principal provisioning was incomplete: ${JSON.stringify(cleanProvisionEvidence)}`,
    );
  }
  psql(`
    REVOKE CREATE ON SCHEMA public
      FROM trainer_finisher_owner, trainer_finisher_cleanup;
    DROP ROLE trainer_finisher_cleanup;
    DROP ROLE trainer_finisher_owner;
    DROP ROLE trainer_app_runtime;
  `);
  psqlAsMigrationAdministrator(`
    CREATE ROLE trainer_app_runtime
      LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOREPLICATION NOBYPASSRLS PASSWORD '${runtimePassword}';
  `);
  requireSuccess(
    run(
      process.execPath,
      [
        principalCommand,
        ...principalCommonArgs,
        "--mode",
        "provision",
        "--write",
        "--confirm-principal-provisioning",
        "trainer-principals:disposable",
        "--evidence-file",
        principalPartialEvidenceFile,
      ],
      {
        quiet: true,
        env: { TRAINER_APP_RUNTIME_PASSWORD: runtimePassword },
      },
    ),
    "partial principal provisioning",
  );
  const partialEvidence = JSON.parse(
    readFileSync(principalPartialEvidenceFile, "utf8"),
  ) as Record<string, unknown>;
  if (
    partialEvidence.databaseWrites !== 6 ||
    partialEvidence.credentialConfigured !== false ||
    arrayField(partialEvidence, "createdPrincipals").length !== 2
  ) {
    throw new Error(
      `Partial principal provisioning was not exact: ${JSON.stringify(partialEvidence)}`,
    );
  }
  const beforeWrongPasswordProvision = principalStateFingerprint();
  const wrongPasswordProvision = run(
    process.execPath,
    [
      principalCommand,
      ...principalCommonArgs,
      "--mode",
      "provision",
      "--write",
      "--confirm-principal-provisioning",
      "trainer-principals:disposable",
      "--evidence-file",
      principalWrongPasswordEvidenceFile,
    ],
    {
      quiet: true,
      env: { TRAINER_APP_RUNTIME_PASSWORD: wrongRuntimePassword },
    },
  );
  const wrongPasswordOutput =
    `${wrongPasswordProvision.stdout}\n${wrongPasswordProvision.stderr}`;
  if (
    wrongPasswordProvision.status === 0 ||
    principalStateFingerprint() !== beforeWrongPasswordProvision ||
    wrongPasswordOutput.includes(wrongRuntimePassword) ||
    wrongPasswordOutput.includes(runtimePassword) ||
    existsSync(principalWrongPasswordEvidenceFile)
  ) {
    throw new Error(
      "Existing runtime credential mismatch did not fail without rotation, evidence, or secret output.",
    );
  }
  rmSync(principalWrongPasswordEvidenceFile, { force: true });
  requireSuccess(
    run(
      process.execPath,
      [
        principalCommand,
        ...principalCommonArgs,
        "--mode",
        "provision",
        "--write",
        "--confirm-principal-provisioning",
        "trainer-principals:disposable",
        "--evidence-file",
        principalRepeatEvidenceFile,
      ],
      {
        quiet: true,
        env: { TRAINER_APP_RUNTIME_PASSWORD: runtimePassword },
      },
    ),
    "idempotent principal provisioning",
  );
  const repeatEvidence = JSON.parse(
    readFileSync(principalRepeatEvidenceFile, "utf8"),
  ) as Record<string, unknown>;
  if (
    repeatEvidence.databaseWrites !== 0 ||
    repeatEvidence.credentialConfigured !== false ||
    arrayField(repeatEvidence, "createdPrincipals").length !== 0
  ) {
    throw new Error(
      `Repeated principal provisioning was not idempotent: ${JSON.stringify(repeatEvidence)}`,
    );
  }
  requireSuccess(
    run(
      process.execPath,
      [
        principalCommand,
        ...principalCommonArgs,
        "--mode",
        "verify",
        "--evidence-file",
        principalVerificationEvidenceFile,
      ],
      {
        quiet: true,
        env: { TRAINER_APP_RUNTIME_PASSWORD: runtimePassword },
      },
    ),
    "read-only principal verification",
  );
  const principalVerification = JSON.parse(
    readFileSync(principalVerificationEvidenceFile, "utf8"),
  ) as Record<string, unknown>;
  if (
    principalVerification.databaseWrites !== 0 ||
    principalVerification.readOnlyTransaction !== true ||
    arrayField(objectField(principalVerification, "liveState"), "roles")
      .length !== 3
  ) {
    throw new Error(
      `Principal verification evidence was not read-only and complete: ${JSON.stringify(principalVerification)}`,
    );
  }
  const preMigrationFinisherObjects = psql(
    `SELECT count(*) FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname LIKE 'Finisher%';`,
    true,
  );
  if (preMigrationFinisherObjects !== "0") {
    throw new Error(
      "Principal provisioning created migration-owned Finisher schema objects.",
    );
  }
  const preMigrationPrincipalObjectCapabilities = psql(
    `
      WITH protected_roles AS (
        SELECT oid
        FROM pg_catalog.pg_roles
        WHERE rolname IN (
          'trainer_app_runtime',
          'trainer_finisher_owner',
          'trainer_finisher_cleanup'
        )
      ),
      capabilities AS (
        SELECT c.oid
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relowner IN (SELECT oid FROM protected_roles)
        UNION ALL
        SELECT p.oid
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proowner IN (SELECT oid FROM protected_roles)
        UNION ALL
        SELECT c.oid
        FROM pg_catalog.pg_class c
        CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) privilege
        WHERE privilege.grantee IN (SELECT oid FROM protected_roles)
        UNION ALL
        SELECT p.oid
        FROM pg_catalog.pg_proc p
        CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) privilege
        WHERE privilege.grantee IN (SELECT oid FROM protected_roles)
      )
      SELECT count(*) FROM capabilities;
    `,
    true,
  );
  if (preMigrationPrincipalObjectCapabilities !== "0") {
    throw new Error(
      "Principal provisioning created object ownership or explicit object grants.",
    );
  }
  const temporarySchemaCapabilities = psql(`
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_roles role
    WHERE role.rolname IN (
      'trainer_finisher_owner',
      'trainer_finisher_cleanup'
    )
      AND pg_catalog.has_schema_privilege(role.rolname, 'public', 'CREATE');
  `, true);
  if (temporarySchemaCapabilities !== "2") {
    throw new Error(
      "Principal provisioning did not install the two exact temporary schema CREATE capabilities.",
    );
  }
  const wrongTarget = run(
    process.execPath,
    [
      principalCommand,
      ...principalCommonArgs,
      "--expected-database=wrong_database",
      "--mode",
      "verify",
      "--evidence-file",
      principalWrongTargetEvidenceFile,
    ],
    {
      quiet: true,
      env: { TRAINER_APP_RUNTIME_PASSWORD: runtimePassword },
    },
  );
  if (
    wrongTarget.status === 0 ||
    `${wrongTarget.stdout}\n${wrongTarget.stderr}`.includes(disposableUrl) ||
    `${wrongTarget.stdout}\n${wrongTarget.stderr}`.includes(
      "trainer-app-runtime",
    )
  ) {
    throw new Error("Wrong-target principal verification did not fail safely.");
  }
  writeFileSync(authorizationEvidenceFile, "{}");

  const migrations = migrationDirectories();
  if (migrations.length !== 18) throw new Error(`Expected 18 migrations, found ${migrations.length}`);
  const baselineMigration = migrations[0];
  const setIntentMigration = migrations[9];

  applyMigrations([baselineMigration]);
  convertBaselineUniqueIndexesToConstraints();
  requireSuccess(prismaResolve(baselineMigration, disposableUrl), "Prisma baseline resolve --applied");
  requireResolvedLedgerShape(baselineMigration);

  const baselineState = cliWithExpectedStatus("scripts/check-migration-status.ts", [], 1);
  if (
    numberField(objectField(baselineState, "chain"), "applied") !== 1 ||
    !arrayField(objectField(baselineState, "ledger"), "resolvedApplied").includes(baselineMigration)
  ) {
    throw new Error(`Resolved baseline was not classified as applied: ${JSON.stringify(baselineState)}`);
  }

  const beforeRepeatedBaselineResolve = databaseStateFingerprint();
  const repeatedBaselineResolve = prismaResolve(baselineMigration, disposableUrl);
  const afterRepeatedBaselineResolve = databaseStateFingerprint();
  if (repeatedBaselineResolve.status === 0 || !/P3008/.test(`${repeatedBaselineResolve.stdout}\n${repeatedBaselineResolve.stderr}`)) {
    throw new Error(`Repeated baseline resolution did not return P3008: ${repeatedBaselineResolve.stdout}\n${repeatedBaselineResolve.stderr}`);
  }
  if (beforeRepeatedBaselineResolve !== afterRepeatedBaselineResolve) {
    throw new Error("Repeated baseline resolution changed schema or ledger state");
  }

  applyMigrations(migrations.slice(1, 9));
  recordMigrations(migrations.slice(1, 9), 1);
  applyMigrations([setIntentMigration]);
  requireSuccess(prismaResolve(setIntentMigration, disposableUrl), "Prisma set-intent resolve --applied");
  requireResolvedLedgerShape(setIntentMigration);

  const beforeRepeatedSetIntentResolve = databaseStateFingerprint();
  const repeatedSetIntentResolve = prismaResolve(setIntentMigration, disposableUrl);
  const afterRepeatedSetIntentResolve = databaseStateFingerprint();
  if (repeatedSetIntentResolve.status === 0 || !/P3008/.test(`${repeatedSetIntentResolve.stdout}\n${repeatedSetIntentResolve.stderr}`)) {
    throw new Error(`Repeated set-intent resolution did not return P3008: ${repeatedSetIntentResolve.stdout}\n${repeatedSetIntentResolve.stderr}`);
  }
  if (beforeRepeatedSetIntentResolve !== afterRepeatedSetIntentResolve) {
    throw new Error("Repeated set-intent resolution changed schema or ledger state");
  }

  insertHistoricalFixture();
  const legacyExceptionSeedBefore = psql(`
    SELECT "slotPlanSeedJson"::text
    FROM "Mesocycle"
    WHERE "id" = '12079700-5333-4ffc-9cbd-bb303588f288';
  `, true);
  const workoutEvidenceBefore = psql(`
    SELECT jsonb_build_object(
      'workouts', (SELECT jsonb_agg(jsonb_build_object(
        'id', "id", 'status', "status", 'completedAt', "completedAt", 'revision', "revision",
        'mesocycleId', "mesocycleId", 'week', "mesocycleWeekSnapshot", 'session', "mesoSessionSnapshot"
      ) ORDER BY "id") FROM "Workout"),
      'exercises', (SELECT jsonb_agg(jsonb_build_object(
        'id', "id", 'workoutId', "workoutId", 'exerciseId', "exerciseId",
        'orderIndex', "orderIndex", 'section', "section", 'isMainLift', "isMainLift"
      ) ORDER BY "id") FROM "WorkoutExercise"),
      'sets', (SELECT jsonb_agg(jsonb_build_object(
        'id', "id", 'workoutExerciseId', "workoutExerciseId", 'setIndex', "setIndex",
        'targetReps', "targetReps", 'targetRpe', "targetRpe", 'targetLoad', "targetLoad"
      ) ORDER BY "id") FROM "WorkoutSet"),
      'logs', (SELECT jsonb_agg(jsonb_build_object(
        'id', "id", 'workoutSetId', "workoutSetId", 'setIntent', "setIntent",
        'actualReps', "actualReps", 'actualRpe', "actualRpe", 'actualLoad', "actualLoad",
        'completedAt', "completedAt", 'wasSkipped', "wasSkipped"
      ) ORDER BY "id") FROM "SetLog")
    )::text;
  `, true);

  insertLegacyReadiness({
    id: "readiness-state-a-workout",
    slotId: "state_a_workout",
    sessionInWeek: 1,
    active: true,
    plannedWorkout: true,
  });
  insertLegacyReadiness({
    id: "readiness-state-a-future",
    slotId: "state_a_future",
    sessionInWeek: 2,
    active: false,
  });
  const readinessStateA = cliWithExpectedStatus("scripts/audit-readiness-integrity.ts", [], 0);
  if (
    readinessStateA.schemaStage !== "pre_architecture_migration" ||
    numberField(objectField(readinessStateA, "snapshots"), "total") !== 2 ||
    numberField(objectField(readinessStateA, "snapshots"), "active") !== 1 ||
    numberField(objectField(readinessStateA, "legacy"), "valid") !== 2 ||
    readinessStateA.readinessIntegrityReady !== true ||
    readinessStateA.writes !== 0
  ) {
    throw new Error(`Readiness State A failed: ${JSON.stringify(readinessStateA)}`);
  }
  psql(`DELETE FROM "PreSessionReadinessSnapshot";`);

  for (let index = 0; index < 10; index += 1) {
    insertLegacyReadiness({
      id: `readiness-production-like-${index}`,
      slotId: `production_like_slot_${index}`,
      sessionInWeek: index + 1,
      active: index < 8,
    });
  }
  const readinessStateF = cliWithExpectedStatus("scripts/audit-readiness-integrity.ts", [], 0);
  if (
    readinessStateF.schemaStage !== "pre_architecture_migration" ||
    numberField(objectField(readinessStateF, "snapshots"), "total") !== 10 ||
    numberField(objectField(readinessStateF, "snapshots"), "active") !== 8 ||
    numberField(objectField(readinessStateF, "legacy"), "valid") !== 10 ||
    readinessStateF.readinessIntegrityReady !== true ||
    objectField(readinessStateF, "migrationSafety").readinessMigrationSafe !== true
  ) {
    throw new Error(`Readiness State F failed: ${JSON.stringify(readinessStateF)}`);
  }

  insertLegacyReadiness({
    id: "readiness-state-b-duplicate",
    slotId: "production_like_slot_0",
    sessionInWeek: 1,
    active: true,
  });
  const readinessStateB = cliWithExpectedStatus("scripts/audit-readiness-integrity.ts", [], 1);
  if (
    readinessStateB.readinessIntegrityReady !== false ||
    objectField(readinessStateB, "migrationSafety").readinessMigrationSafe !== false ||
    arrayField(objectField(readinessStateB, "migrationSafety"), "definiteUniqueConflicts").length !== 1 ||
    readinessStateB.writes !== 0
  ) {
    throw new Error(`Readiness State B failed: ${JSON.stringify(readinessStateB)}`);
  }
  psql(`DELETE FROM "PreSessionReadinessSnapshot" WHERE id = 'readiness-state-b-duplicate';`);

  psql(`ALTER TABLE "PreSessionReadinessSnapshot" ADD COLUMN "identityStatus" TEXT;`);
  const readinessStateC = cliWithExpectedStatus("scripts/audit-readiness-integrity.ts", [], 1);
  if (
    readinessStateC.schemaStage !== "partial_or_incompatible" ||
    readinessStateC.readinessIntegrityReady !== false ||
    readinessStateC.writes !== 0
  ) {
    throw new Error(`Readiness State C failed: ${JSON.stringify(readinessStateC)}`);
  }
  psql(`ALTER TABLE "PreSessionReadinessSnapshot" DROP COLUMN "identityStatus";`);

  const directCheck = cli("scripts/check-direct-db.ts", []);
  if (directCheck.classification !== "successful_direct_connection") {
    throw new Error("Direct endpoint diagnostic did not classify the disposable connection successfully");
  }

  const beforeStateA = databaseStateFingerprint();
  const migrationStateA = cliWithExpectedStatus("scripts/check-migration-status.ts", [], 1);
  const afterStateA = databaseStateFingerprint();
  if (beforeStateA !== afterStateA) throw new Error("State A migration integrity inspection changed disposable database state");
  const stateALedger = objectField(migrationStateA, "ledger");
  const stateASchema = objectField(migrationStateA, "schemaIntegrity");
  const stateAChain = objectField(migrationStateA, "chain");
  if (
    numberField(stateAChain, "applied") !== 10 ||
    numberField(stateAChain, "pending") !== 8 ||
    stateAChain.targetMigration !== targetMigration ||
    stateAChain.exactExpectedPending !== false ||
    JSON.stringify(arrayField(stateAChain, "expectedPendingMigrations")) !==
      JSON.stringify([targetMigration]) ||
    arrayField(migrationStateA, "unexpectedMigrations").length !== 7 ||
    !arrayField(migrationStateA, "blockingReasons").includes(
      "pending_migration_sequence_mismatch",
    ) ||
    numberField(objectField(migrationStateA, "checksums"), "matched") !== 10 ||
    arrayField(stateALedger, "incomplete").length !== 0 ||
    arrayField(stateALedger, "orderViolations").length !== 0 ||
    !arrayField(stateALedger, "resolvedApplied").includes(baselineMigration) ||
    !arrayField(stateALedger, "resolvedApplied").includes(setIntentMigration) ||
    numberField(stateASchema, "semanticDriftBlocking") !== 0 ||
    numberField(stateASchema, "representationWarningCount") !== 2 ||
    migrationStateA.migrationAuthorizationReady !== false
  ) {
    throw new Error(`State A did not reject the stale rollout shape: ${JSON.stringify(migrationStateA)}`);
  }

  requireUniquenessAssessment(migrationStateA, "ExerciseAlias_alias_key", {
    semantic: true,
    representation: false,
    blocks: false,
  });
  requireUniquenessAssessment(migrationStateA, "WorkoutTemplateExercise_templateId_orderIndex_key", {
    semantic: true,
    representation: false,
    blocks: false,
  });

  psql(`
    ALTER TABLE "ExerciseAlias" DROP CONSTRAINT "ExerciseAlias_alias_key";
    ALTER TABLE "WorkoutTemplateExercise"
      DROP CONSTRAINT "WorkoutTemplateExercise_templateId_orderIndex_key";
    CREATE UNIQUE INDEX "ExerciseAlias_alias_key" ON "ExerciseAlias"("alias");
    CREATE UNIQUE INDEX "WorkoutTemplateExercise_templateId_orderIndex_key"
      ON "WorkoutTemplateExercise"("templateId", "orderIndex");
  `);
  const standaloneRepresentation = cliWithExpectedStatus("scripts/check-migration-status.ts", [], 1);
  requireUniquenessAssessment(standaloneRepresentation, "ExerciseAlias_alias_key", {
    semantic: true,
    representation: true,
    blocks: false,
  });

  psql(`DROP INDEX "ExerciseAlias_alias_key";`);
  const missingUniqueness = cliWithExpectedStatus("scripts/check-migration-status.ts", [], 1);
  requireUniquenessAssessment(missingUniqueness, "ExerciseAlias_alias_key", {
    semantic: false,
    representation: false,
    blocks: true,
  });
  psql(`CREATE UNIQUE INDEX "ExerciseAlias_alias_key" ON "ExerciseAlias"("alias");`);

  psql(`
    DROP INDEX "WorkoutTemplateExercise_templateId_orderIndex_key";
    CREATE UNIQUE INDEX "WorkoutTemplateExercise_templateId_orderIndex_key"
      ON "WorkoutTemplateExercise"("orderIndex", "templateId");
  `);
  const wrongColumnOrder = cliWithExpectedStatus("scripts/check-migration-status.ts", [], 1);
  requireUniquenessAssessment(wrongColumnOrder, "WorkoutTemplateExercise_templateId_orderIndex_key", {
    semantic: false,
    representation: false,
    blocks: true,
  });
  psql(`
    DROP INDEX "WorkoutTemplateExercise_templateId_orderIndex_key";
    CREATE UNIQUE INDEX "WorkoutTemplateExercise_templateId_orderIndex_key"
      ON "WorkoutTemplateExercise"("templateId", "orderIndex");
  `);

  psql(`
    DROP INDEX "ExerciseAlias_alias_key";
    CREATE INDEX "ExerciseAlias_alias_key" ON "ExerciseAlias"("alias");
  `);
  const nonUniqueIndex = cliWithExpectedStatus("scripts/check-migration-status.ts", [], 1);
  requireUniquenessAssessment(nonUniqueIndex, "ExerciseAlias_alias_key", {
    semantic: false,
    representation: false,
    blocks: true,
  });
  psql(`
    DROP INDEX "ExerciseAlias_alias_key";
    CREATE UNIQUE INDEX "ExerciseAlias_alias_key" ON "ExerciseAlias"("alias");
  `);

  psql(`
    DROP INDEX "ExerciseAlias_alias_key";
    CREATE UNIQUE INDEX "ExerciseAlias_alias_key" ON "ExerciseAlias"("alias") WHERE "alias" IS NOT NULL;
  `);
  const differentPredicate = cliWithExpectedStatus("scripts/check-migration-status.ts", [], 1);
  requireUniquenessAssessment(differentPredicate, "ExerciseAlias_alias_key", {
    semantic: false,
    representation: false,
    blocks: true,
  });
  psql(`
    DROP INDEX "ExerciseAlias_alias_key";
    CREATE UNIQUE INDEX "ExerciseAlias_alias_key" ON "ExerciseAlias"("alias");
  `);
  convertBaselineUniqueIndexesToConstraints();

  psql(`ALTER TABLE "WorkoutExercise" ADD COLUMN "stimulusAccountingSnapshot" JSONB;`);
  const migrationStateB = cliWithExpectedStatus("scripts/check-migration-status.ts", [], 1);
  if (migrationStateB.migrationAuthorizationReady !== false) {
    throw new Error("State B partial object did not block migration authorization");
  }
  const stateBPartial = objectField(migrationStateB, "partialObjects").unexpectedPresent;
  if (!Array.isArray(stateBPartial) || stateBPartial.length === 0) {
    throw new Error("State B partial object was not reported");
  }
  psql(`ALTER TABLE "WorkoutExercise" DROP COLUMN "stimulusAccountingSnapshot";`);

  const firstApplied = migrations[0];
  psql(`UPDATE public._prisma_migrations SET checksum = '${"0".repeat(64)}' WHERE migration_name = '${firstApplied}';`);
  const migrationStateC = cliWithExpectedStatus("scripts/check-migration-status.ts", [], 1);
  if (migrationStateC.migrationAuthorizationReady !== false) {
    throw new Error("State C checksum mismatch did not block migration authorization");
  }
  psql(`UPDATE public._prisma_migrations SET checksum = '${migrationChecksum(firstApplied)}' WHERE migration_name = '${firstApplied}';`);

  const firstPending = migrations[preMigrationCount];
  psql(`
    INSERT INTO public._prisma_migrations (
      id, checksum, finished_at, migration_name, logs, rolled_back_at, applied_steps_count
    ) VALUES (
      'failed-ledger-row', '${migrationChecksum(firstPending)}', NULL,
      '${firstPending}', 'fixture failure', NULL, 0
    );
  `);
  const migrationStateD = cliWithExpectedStatus("scripts/check-migration-status.ts", [], 1);
  if (migrationStateD.migrationAuthorizationReady !== false) {
    throw new Error("State D failed ledger row did not block migration authorization");
  }
  psql(`UPDATE public._prisma_migrations SET logs = NULL, rolled_back_at = CURRENT_TIMESTAMP WHERE id = 'failed-ledger-row';`);
  const rolledBackStateD = cliWithExpectedStatus("scripts/check-migration-status.ts", [], 1);
  const rolledBackRows = objectField(rolledBackStateD, "ledger").rolledBack;
  if (!Array.isArray(rolledBackRows) || rolledBackRows.length !== 1) {
    throw new Error("State D rolled-back ledger row was not reported");
  }
  psql(`DELETE FROM public._prisma_migrations WHERE id = 'failed-ledger-row';`);

  psql(`
    INSERT INTO public._prisma_migrations (
      id, checksum, finished_at, migration_name, logs, rolled_back_at, applied_steps_count
    ) VALUES (
      'unfinished-ledger-row', '${migrationChecksum(firstPending)}', NULL,
      '${firstPending}', NULL, NULL, 0
    );
  `);
  const unfinishedState = cliWithExpectedStatus("scripts/check-migration-status.ts", [], 1);
  if (
    !arrayField(objectField(unfinishedState, "ledger"), "incomplete").includes(firstPending) ||
    unfinishedState.migrationAuthorizationReady !== false
  ) {
    throw new Error("A truly unfinished ledger row was not blocked as incomplete");
  }
  psql(`DELETE FROM public._prisma_migrations WHERE id = 'unfinished-ledger-row';`);

  const preSeed = cli("scripts/backfill-immutable-seed-revisions.ts", []);
  const preSeedSummary = objectField(preSeed, "summary");
  if (
    numberField(preSeedSummary, "legacyBaselineOnly") !== 3 ||
    numberField(preSeedSummary, "legacyExceptions") !== 1 ||
    numberField(preSeedSummary, "invalid") !== 0
  ) {
    throw new Error("Pre-migration seed inventory did not report three valid rows and one explicit exception");
  }
  const preStimulus = cli("scripts/backfill-workout-exercise-stimulus-accounting.ts", ["--inventory-only"]);
  const preReview = cli("scripts/backfill-post-session-reviews.ts", ["--inventory-only"]);
  if (numberField(preStimulus, "expectedWriteCountAfterMigration") !== 1) {
    throw new Error("Unexpected pre-migration stimulus projected write count");
  }
  if (numberField(preReview, "expectedLegacyDerived") !== 1) {
    throw new Error("Unexpected pre-migration review projected write count");
  }
  cliMustFail("scripts/backfill-workout-exercise-stimulus-accounting.ts", [], /stimulusAccountingSnapshot|column .* does not exist/i);
  cliMustFail("scripts/backfill-post-session-reviews.ts", [], /PostSessionReviewSnapshot|does not exist/i);

  applyMigrations(
    migrations.slice(preMigrationCount, currentProductionAppliedCount),
  );
  recordMigrations(
    migrations.slice(preMigrationCount, currentProductionAppliedCount),
    preMigrationCount,
  );

  const migratedSeedState = psql(`
    SELECT concat_ws('|',
      (SELECT COUNT(*) FROM "MesocycleSeedRevision"),
      (SELECT COUNT(*) FROM "Mesocycle" WHERE "currentSeedRevisionId" IS NOT NULL),
      (SELECT COUNT(*) FROM "MesocycleSeedRevision"
        WHERE "revision" <> 1
           OR "id" <> 'legacy-baseline:' || "mesocycleId"
           OR "payloadHash" IS NOT NULL
           OR "hashAlgorithm" IS NOT NULL),
      (SELECT COUNT(*) FROM "MesocycleSeedRevision"
        WHERE "mesocycleId" = '12079700-5333-4ffc-9cbd-bb303588f288'),
      (SELECT COUNT(*) FROM "Mesocycle"
        WHERE "id" = '12079700-5333-4ffc-9cbd-bb303588f288'
          AND "currentSeedRevisionId" IS NULL)
    );
  `, true);
  if (migratedSeedState !== "3|3|0|0|1") {
    throw new Error(`Unexpected Migration 011 seed state: ${migratedSeedState}`);
  }
  const legacyExceptionSeedAfter = psql(`
    SELECT "slotPlanSeedJson"::text
    FROM "Mesocycle"
    WHERE "id" = '12079700-5333-4ffc-9cbd-bb303588f288';
  `, true);
  if (legacyExceptionSeedAfter !== legacyExceptionSeedBefore) {
    throw new Error("Migration 011 changed the explicit legacy exception seed JSON");
  }
  const workoutEvidenceAfter = psql(`
    SELECT jsonb_build_object(
      'workouts', (SELECT jsonb_agg(jsonb_build_object(
        'id', "id", 'status', "status", 'completedAt', "completedAt", 'revision', "revision",
        'mesocycleId', "mesocycleId", 'week', "mesocycleWeekSnapshot", 'session', "mesoSessionSnapshot"
      ) ORDER BY "id") FROM "Workout"),
      'exercises', (SELECT jsonb_agg(jsonb_build_object(
        'id', "id", 'workoutId', "workoutId", 'exerciseId', "exerciseId",
        'orderIndex', "orderIndex", 'section', "section", 'isMainLift', "isMainLift"
      ) ORDER BY "id") FROM "WorkoutExercise"),
      'sets', (SELECT jsonb_agg(jsonb_build_object(
        'id', "id", 'workoutExerciseId', "workoutExerciseId", 'setIndex', "setIndex",
        'targetReps', "targetReps", 'targetRpe', "targetRpe", 'targetLoad', "targetLoad"
      ) ORDER BY "id") FROM "WorkoutSet"),
      'logs', (SELECT jsonb_agg(jsonb_build_object(
        'id', "id", 'workoutSetId', "workoutSetId", 'setIntent', "setIntent",
        'actualReps', "actualReps", 'actualRpe', "actualRpe", 'actualLoad', "actualLoad",
        'completedAt', "completedAt", 'wasSkipped', "wasSkipped"
      ) ORDER BY "id") FROM "SetLog")
    )::text;
  `, true);
  if (workoutEvidenceAfter !== workoutEvidenceBefore) {
    throw new Error("Migrations 011-017 changed existing workout, exercise, set, or log evidence");
  }

  const currentProductionState = cliWithExpectedStatus(
    "scripts/check-migration-status.ts",
    [],
    1,
  );
  if (
    numberField(objectField(currentProductionState, "chain"), "applied") !==
      currentProductionAppliedCount ||
    numberField(objectField(currentProductionState, "chain"), "pending") !== 1 ||
    currentProductionState.technicalMigrationReady !== false ||
    currentProductionState.migrationAuthorizationReady !== false ||
    currentProductionState.executionAuthorized !== false
  ) {
    throw new Error(
      `Current production-shape simulation failed: ${JSON.stringify(currentProductionState)}`,
    );
  }

  const trustedEvidence = JSON.parse(
    readFileSync(authorizationEvidenceFile, "utf8"),
  ) as Record<string, unknown>;
  writeFileSync(
    authorizationEvidenceFile,
    JSON.stringify({
      ...trustedEvidence,
      dataPreflight: { valid: true },
      disposablePostgres: { valid: true, repositoryHead },
      expectedPendingMigrations: [
        targetMigration,
        "20990101000000_forged_operator_policy",
      ],
    }),
  );
  const forgedPolicyResult = run(
    process.execPath,
    [
      join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"),
      "scripts/check-migration-status.ts",
      "--env-file",
      envFile,
      "--confirm-disposable",
      "--evidence-file",
      authorizationEvidenceFile,
      "--principal-audit-file",
      principalVerificationEvidenceFile,
      "--required-application-commit",
      repositoryHead,
    ],
    {
      quiet: true,
      env: { TRAINER_APP_RUNTIME_PASSWORD: runtimePassword },
    },
  );
  if (
    forgedPolicyResult.status !== 1 ||
    !`${forgedPolicyResult.stdout}\n${forgedPolicyResult.stderr}`.includes(
      "Migration audit input is non-authoritative and cannot supply dataPreflight, disposablePostgres, expectedPendingMigrations.",
    )
  ) {
    throw new Error(
      `Forged operator pending-migration policy was not rejected: ${forgedPolicyResult.stdout}\n${forgedPolicyResult.stderr}`,
    );
  }
  writeFileSync(authorizationEvidenceFile, JSON.stringify(trustedEvidence));

  psqlAsMigrationAdministrator(
    "REVOKE CREATE ON SCHEMA public FROM trainer_finisher_cleanup;",
  );
  const beforePrerequisiteDriftMigration = `${databaseStateFingerprint()}|${principalStateFingerprint()}`;
  const prerequisiteDriftMigration = runPsqlAsMigrationAdministrator(
    readFileSync(
      join(
        process.cwd(),
        "prisma",
        "migrations",
        targetMigration,
        "migration.sql",
      ),
      "utf8",
    ),
  );
  const afterPrerequisiteDriftMigration = `${databaseStateFingerprint()}|${principalStateFingerprint()}`;
  if (
    prerequisiteDriftMigration.status === 0 ||
    beforePrerequisiteDriftMigration !== afterPrerequisiteDriftMigration ||
    psql(
      `SELECT count(*) FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname LIKE 'Finisher%';`,
      true,
    ) !== "0"
  ) {
    throw new Error(
      "Migration did not fail atomically when a principal prerequisite drifted after Gate A.",
    );
  }
  psqlAsMigrationAdministrator(
    "GRANT CREATE ON SCHEMA public TO trainer_finisher_cleanup;",
  );
  const refreshedGateA = cliWithExpectedStatus(
    "scripts/check-migration-status.ts",
    [],
    1,
  );
  if (refreshedGateA.migrationAuthorizationReady !== false) {
    throw new Error(
      "Disposable Gate A did not remain fail closed without canonical provider evidence.",
    );
  }

  const canonicalFinisherMigration = readFileSync(
    join(
      process.cwd(),
      "prisma",
      "migrations",
      targetMigration,
      "migration.sql",
    ),
    "utf8",
  );
  const ownerInjectionMarker = "\nSET CONSTRAINTS ALL IMMEDIATE;";
  const ownerInjectionOffset = canonicalFinisherMigration.indexOf(
    ownerInjectionMarker,
  );
  if (ownerInjectionOffset < 0) {
    throw new Error("Finisher migration owner-phase verification marker was not found.");
  }
  for (const [label, injectedSql, expectedError] of [
    [
      "missing table",
      'DROP TABLE "FinisherExecutionCommand" CASCADE;\n',
      "Finisher terminal table ownership or RLS state is not exact",
    ],
    [
      "unexpected table",
      'CREATE TABLE "FinisherUnexpected" ("id" TEXT NOT NULL);\n',
      "Finisher terminal table ownership or RLS state is not exact",
    ],
    [
      "missing column",
      'ALTER TABLE "FinisherRoutine" DROP COLUMN "retiredAt";\n',
      "Finisher terminal column structure is not exact",
    ],
    [
      "column drift",
      'ALTER TABLE "FinisherOffer" ADD COLUMN "terminalGuardProbe" TEXT;\n',
      "Finisher terminal column structure is not exact",
    ],
    [
      "column nullability drift",
      'ALTER TABLE "FinisherRoutine" ALTER COLUMN "createdAt" DROP NOT NULL;\n',
      "Finisher terminal column structure is not exact",
    ],
    [
      "column identity drift",
      'ALTER TABLE "FinisherOffer" ALTER COLUMN "itemCount" ADD GENERATED BY DEFAULT AS IDENTITY;\n',
      "Finisher terminal column structure is not exact",
    ],
    [
      "missing index",
      'DROP INDEX "FinisherRoutine_code_key";\n',
      "Finisher terminal index inventory, definition, or owning-relation ownership is not exact",
    ],
    [
      "index column order drift",
      'DROP INDEX "FinisherExecutionCommand_cleanedAt_expiresAt_id_idx";\n' +
        'CREATE INDEX "FinisherExecutionCommand_cleanedAt_expiresAt_id_idx" ' +
        'ON "FinisherExecutionCommand"("expiresAt", "cleanedAt", "id");\n',
      "Finisher terminal index inventory, definition, or owning-relation ownership is not exact",
    ],
    [
      "index uniqueness drift",
      'DROP INDEX "FinisherOffer_recommendedRoutineVersionId_idx";\n' +
        'CREATE UNIQUE INDEX "FinisherOffer_recommendedRoutineVersionId_idx" ' +
        'ON "FinisherOffer"("recommendedRoutineVersionId");\n',
      "Finisher terminal index inventory, definition, or owning-relation ownership is not exact",
    ],
    [
      "index predicate drift",
      'DROP INDEX "FinisherExecution_one_active_per_workout";\n' +
        'CREATE UNIQUE INDEX "FinisherExecution_one_active_per_workout" ' +
        'ON "FinisherExecution"("workoutId") WHERE "state" = \'SELECTED\';\n',
      "Finisher terminal index inventory, definition, or owning-relation ownership is not exact",
    ],
    [
      "owning relation drift",
      'RESET ROLE;\n' +
        'GRANT trainer_finisher_cleanup TO trainer_finisher_owner;\n' +
        'SET LOCAL ROLE trainer_finisher_owner;\n' +
        'ALTER TABLE "FinisherRoutine" OWNER TO trainer_finisher_cleanup;\n' +
        'RESET ROLE;\n' +
        'REVOKE trainer_finisher_cleanup FROM trainer_finisher_owner;\n' +
        'SET LOCAL ROLE trainer_finisher_owner;\n',
      "Finisher terminal table ownership or RLS state is not exact",
    ],
  ] as const) {
    const beforeTerminalGuardFailure = `${databaseStateFingerprint()}|${principalStateFingerprint()}`;
    const injectedMigration =
      canonicalFinisherMigration.slice(0, ownerInjectionOffset) +
      `\n${injectedSql}` +
      canonicalFinisherMigration.slice(ownerInjectionOffset);
    const result = runPsqlAsMigrationAdministrator(injectedMigration);
    const output = `${result.stdout}\n${result.stderr}`;
    const afterTerminalGuardFailure = `${databaseStateFingerprint()}|${principalStateFingerprint()}`;
    if (
      result.status === 0 ||
      !output.includes(expectedError) ||
      beforeTerminalGuardFailure !== afterTerminalGuardFailure ||
      psql(
        `SELECT count(*) FROM pg_catalog.pg_class c
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relname LIKE 'Finisher%';`,
        true,
      ) !== "0"
    ) {
      throw new Error(
        `Migration terminal ${label} guard did not fail and roll back atomically: ${output}`,
      );
    }
  }

  applyMigrations(migrations.slice(currentProductionAppliedCount));
  recordMigrations(
    migrations.slice(currentProductionAppliedCount),
    currentProductionAppliedCount,
  );

  const beforeStateE = databaseStateFingerprint();
  const migrationStateE = cliWithExpectedStatus("scripts/check-migration-status.ts", [], 0);
  const afterStateE = databaseStateFingerprint();
  if (beforeStateE !== afterStateE) throw new Error("State E migration integrity inspection changed disposable database state");
  if (
    numberField(objectField(migrationStateE, "chain"), "applied") !== 18 ||
    numberField(objectField(migrationStateE, "chain"), "pending") !== 0 ||
    objectField(migrationStateE, "chain").gateAApplicable !== false ||
    migrationStateE.schemaPreflightValid !== true ||
    numberField(objectField(migrationStateE, "schemaIntegrity"), "semanticDriftBlocking") !== 0 ||
    migrationStateE.migrationAuthorizationReady !== false
  ) {
    throw new Error(`State E did not report a clean fully migrated non-Gate-A state: ${JSON.stringify(migrationStateE)}`);
  }

  psql(
    `ALTER TABLE "FinisherOfferItem" DISABLE TRIGGER "FinisherOfferItem_immutable";`,
  );
  requireFinisherGateAFailure(
    "Disabled Finisher protection trigger",
    "FinisherOfferItem_immutable",
  );
  psql(
    `ALTER TABLE "FinisherOfferItem" ENABLE TRIGGER "FinisherOfferItem_immutable";`,
  );
  psql(
    `ALTER TABLE "FinisherOfferItem" ENABLE REPLICA TRIGGER "FinisherOfferItem_immutable";`,
  );
  requireFinisherGateAFailure(
    "Replica-only Finisher protection trigger",
    "FinisherOfferItem_immutable",
  );
  psql(
    `ALTER TABLE "FinisherOfferItem" ENABLE TRIGGER "FinisherOfferItem_immutable";`,
  );

  const createCanonicalOfferItemTrigger = `
    CREATE TRIGGER "FinisherOfferItem_immutable"
    BEFORE UPDATE ON "FinisherOfferItem"
    FOR EACH ROW EXECUTE FUNCTION reject_finisher_offer_item_update();
  `;
  psql(`DROP TRIGGER "FinisherOfferItem_immutable" ON "FinisherOfferItem";`);
  requireFinisherAppliedSchemaFailure(
    "Missing Finisher protection trigger",
    "FinisherOfferItem_immutable",
  );
  psql(createCanonicalOfferItemTrigger);
  for (const [label, replacement, cleanup] of [
    [
      "altered-event",
      `CREATE TRIGGER "FinisherOfferItem_immutable"
       BEFORE UPDATE OR DELETE ON "FinisherOfferItem"
       FOR EACH ROW EXECUTE FUNCTION reject_finisher_offer_item_update();`,
      `DROP TRIGGER "FinisherOfferItem_immutable" ON "FinisherOfferItem";`,
    ],
    [
      "altered-timing",
      `CREATE TRIGGER "FinisherOfferItem_immutable"
       AFTER UPDATE ON "FinisherOfferItem"
       FOR EACH ROW EXECUTE FUNCTION reject_finisher_offer_item_update();`,
      `DROP TRIGGER "FinisherOfferItem_immutable" ON "FinisherOfferItem";`,
    ],
    [
      "altered-table",
      `CREATE TRIGGER "FinisherOfferItem_immutable"
       BEFORE UPDATE ON "FinisherOffer"
       FOR EACH ROW EXECUTE FUNCTION reject_finisher_offer_item_update();`,
      `DROP TRIGGER "FinisherOfferItem_immutable" ON "FinisherOffer";`,
    ],
  ] as const) {
    psql(`
      DROP TRIGGER "FinisherOfferItem_immutable" ON "FinisherOfferItem";
      ${replacement}
    `);
    requireFinisherGateAFailure(
      `${label} Finisher protection trigger`,
      "FinisherOfferItem_immutable",
    );
    psql(`
      ${cleanup}
      ${createCanonicalOfferItemTrigger}
    `);
  }

  psql(
    `ALTER TABLE "FinisherExecutionStep" DISABLE TRIGGER "FinisherExecutionStep_evidence_immutable";`,
  );
  requireFinisherGateAFailure(
    "Disabled terminal step evidence trigger",
    "FinisherExecutionStep_evidence_immutable",
  );
  psql(
    `ALTER TABLE "FinisherExecutionStep" ENABLE TRIGGER "FinisherExecutionStep_evidence_immutable";`,
  );
  for (const [table, trigger, label] of [
    [
      "FinisherExecution",
      "FinisherExecution_terminal_outcome_coherence",
      "Disabled terminal coherence parent path",
    ],
    [
      "FinisherExecutionStep",
      "FinisherExecutionStep_terminal_outcome_coherence",
      "Disabled terminal coherence child path",
    ],
  ] as const) {
    psql(`ALTER TABLE "${table}" DISABLE TRIGGER "${trigger}";`);
    requireFinisherGateAFailure(label, trigger);
    psql(`ALTER TABLE "${table}" ENABLE TRIGGER "${trigger}";`);
  }

  psql(`
    DROP TRIGGER "FinisherExecution_terminal_outcome_coherence"
      ON "FinisherExecution";
    CREATE TRIGGER "FinisherExecution_terminal_outcome_coherence"
      AFTER INSERT OR UPDATE ON "FinisherExecution"
      FOR EACH ROW EXECUTE FUNCTION
        validate_finisher_terminal_outcome_from_execution();
  `);
  requireFinisherGateAFailure(
    "Terminal parent validation is no longer deferred",
    "FinisherExecution_terminal_outcome_coherence",
  );
  psql(`
    DROP TRIGGER "FinisherExecution_terminal_outcome_coherence"
      ON "FinisherExecution";
    CREATE CONSTRAINT TRIGGER "FinisherExecution_terminal_outcome_coherence"
      AFTER INSERT OR UPDATE ON "FinisherExecution"
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION
        validate_finisher_terminal_outcome_from_execution();
  `);

  const canonicalTerminalOutcomeFunction = psql(
    `
      SELECT pg_get_functiondef(p.oid)
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'validate_finisher_terminal_outcome'
        AND pg_get_function_identity_arguments(p.oid) =
          'target_execution_id text';
    `,
    true,
  );
  psql(`
    CREATE OR REPLACE FUNCTION
      validate_finisher_terminal_outcome(target_execution_id TEXT)
    RETURNS void
    LANGUAGE plpgsql AS $$
    BEGIN
      RETURN;
    END;
    $$;
  `);
  requireFinisherGateAFailure(
    "Terminal outcome matrix permits contradictory commits",
    "validate_finisher_terminal_outcome",
  );
  psql(`${canonicalTerminalOutcomeFunction};`);
  for (const [label, canonicalClause] of [
    [
      "Completed outcome permits pending prescribed steps",
      "completed_step_count <> prescribed_step_count",
    ],
    [
      "Partial outcome permits no performed step evidence",
      "completed_step_count + partial_step_count = 0",
    ],
    [
      "Skipped outcome permits contradictory step evidence",
      "skipped_step_count <> prescribed_step_count",
    ],
    [
      "Never-started dismissal permits touched child evidence",
      "pending_step_count <> prescribed_step_count",
    ],
    [
      "Performed dismissal permits cleared child evidence",
      "performed_step_count = 0",
    ],
  ] as const) {
    const weakened = canonicalTerminalOutcomeFunction.replace(
      canonicalClause,
      "FALSE",
    );
    if (weakened === canonicalTerminalOutcomeFunction) {
      throw new Error(
        `Canonical terminal outcome function omitted expected clause: ${canonicalClause}`,
      );
    }
    psql(`${weakened};`);
    requireFinisherGateAFailure(label, "validate_finisher_terminal_outcome");
    psql(`${canonicalTerminalOutcomeFunction};`);
  }

  psql(
    `ALTER TABLE "FinisherExecutionCommand" ENABLE REPLICA TRIGGER "FinisherExecutionCommand_tombstone";`,
  );
  requireFinisherGateAFailure(
    "Replica-only command tombstone trigger",
    "FinisherExecutionCommand_tombstone",
  );
  psql(
    `ALTER TABLE "FinisherExecutionCommand" ENABLE TRIGGER "FinisherExecutionCommand_tombstone";`,
  );

  const createCanonicalCommandTombstoneTrigger = `
    CREATE TRIGGER "FinisherExecutionCommand_tombstone"
    BEFORE UPDATE OR DELETE ON "FinisherExecutionCommand"
    FOR EACH ROW EXECUTE FUNCTION guard_finisher_execution_command_tombstone();
  `;
  psql(
    `DROP TRIGGER "FinisherExecutionCommand_tombstone" ON "FinisherExecutionCommand";`,
  );
  requireFinisherAppliedSchemaFailure(
    "Missing command tombstone trigger",
    "FinisherExecutionCommand_tombstone",
  );
  psql(createCanonicalCommandTombstoneTrigger);
  psql(`
    DROP TRIGGER "FinisherExecutionCommand_tombstone" ON "FinisherExecutionCommand";
    CREATE TRIGGER "FinisherExecutionCommand_tombstone"
    BEFORE UPDATE ON "FinisherExecutionCommand"
    FOR EACH ROW EXECUTE FUNCTION guard_finisher_execution_command_tombstone();
  `);
  requireFinisherGateAFailure(
    "Command tombstone trigger permits deletion",
    "FinisherExecutionCommand_tombstone",
  );
  psql(`
    DROP TRIGGER "FinisherExecutionCommand_tombstone" ON "FinisherExecutionCommand";
    ${createCanonicalCommandTombstoneTrigger}
  `);

  for (const [functionName, label, weakenedBody] of [
    [
      "guard_finisher_execution_lifecycle",
      "Weakened execution lifecycle condition",
      `BEGIN RETURN NEW; END;`,
    ],
    [
      "require_finisher_offer_finalized",
      "Weakened finalized-offer completeness",
      `BEGIN RETURN NULL; END;`,
    ],
    [
      "require_finisher_execution_finalized",
      "Omitted selection decision binding",
      `BEGIN RETURN NULL; END;`,
    ],
    [
      "guard_finisher_offer_identity",
      "Omitted decline decision revision binding",
      `BEGIN RETURN NEW; END;`,
    ],
    [
      "require_finisher_decision_applied",
      "Weakened durable decision application",
      `BEGIN RETURN NULL; END;`,
    ],
    [
      "guard_finisher_execution_step_evidence",
      "Omitted protected terminal step field",
      `BEGIN RETURN NEW; END;`,
    ],
    [
      "guard_finisher_execution_command_tombstone",
      "Permitted command receipt identity rewriting",
      `BEGIN RETURN COALESCE(NEW, OLD); END;`,
    ],
  ] as const) {
    const canonicalFunction = psql(
      `
        SELECT pg_get_functiondef(p.oid)
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = '${functionName}'
          AND pg_get_function_identity_arguments(p.oid) = '';
      `,
      true,
    );
    psql(`
      CREATE OR REPLACE FUNCTION ${functionName}() RETURNS trigger
      LANGUAGE plpgsql AS $$
      ${weakenedBody}
      $$;
    `);
    requireFinisherGateAFailure(label, functionName);
    psql(`${canonicalFunction};`);
  }

  const canonicalCleanupFunction = psql(
    `
      SELECT pg_get_functiondef(p.oid)
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'cleanup_expired_finisher_execution_commands'
        AND pg_get_function_identity_arguments(p.oid) = 'p_batch_size integer';
    `,
    true,
  );
  psql(`
    CREATE OR REPLACE FUNCTION cleanup_expired_finisher_execution_commands(
      p_batch_size INTEGER DEFAULT 100
    ) RETURNS INTEGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
    BEGIN
      RETURN 0;
    END;
    $$;
  `);
  requireFinisherGateAFailure(
    "Cleanup permitted before expiration or skipped immutable enforcement",
    "cleanup_expired_finisher_execution_commands",
  );
  psql(`${canonicalCleanupFunction};`);
  psql(
    `GRANT EXECUTE ON FUNCTION cleanup_expired_finisher_execution_commands(INTEGER) TO PUBLIC;`,
  );
  requireFinisherGateAFailure(
    "Cleanup function exposed to public execution",
    "cleanup_expired_finisher_execution_commands",
  );
  psql(
    `REVOKE ALL ON FUNCTION cleanup_expired_finisher_execution_commands(INTEGER) FROM PUBLIC;`,
  );

  psql(
    `ALTER FUNCTION cleanup_expired_finisher_execution_commands(INTEGER)
     OWNER TO trainer_finisher_owner;`,
  );
  requireFinisherGateAFailure(
    "Cleanup function owner changed",
    "function-owner:cleanup_expired_finisher_execution_commands",
  );
  psql(
    `ALTER FUNCTION cleanup_expired_finisher_execution_commands(INTEGER)
     OWNER TO trainer_finisher_cleanup;`,
  );

  psql(`
    CREATE ROLE trainer_unexpected_grantee
      NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOREPLICATION NOBYPASSRLS;
    GRANT EXECUTE ON FUNCTION
      cleanup_expired_finisher_execution_commands(INTEGER)
    TO trainer_unexpected_grantee;
  `);
  requireFinisherGateAFailure(
    "Unexpected role can execute cleanup",
    "function-privileges:cleanup_expired_finisher_execution_commands",
  );
  psql(`
    REVOKE ALL ON FUNCTION
      cleanup_expired_finisher_execution_commands(INTEGER)
    FROM trainer_unexpected_grantee;
    DROP ROLE trainer_unexpected_grantee;
  `);

  psql(
    `GRANT UPDATE ON TABLE "FinisherExecutionCommand"
     TO trainer_app_runtime;`,
  );
  requireFinisherGateAFailure(
    "Runtime received direct command mutation privilege",
    "table-privileges:FinisherExecutionCommand",
  );
  psql(
    `REVOKE UPDATE ON TABLE "FinisherExecutionCommand"
     FROM trainer_app_runtime;`,
  );

  psql(`GRANT trainer_finisher_cleanup TO trainer_app_runtime;`);
  requireFinisherGateAFailure(
    "Runtime can assume the cleanup role",
    "finisher_principal_live_contract_membership_mismatch",
  );
  psql(`REVOKE trainer_finisher_cleanup FROM trainer_app_runtime;`);

  psql(
    `ALTER FUNCTION cleanup_expired_finisher_execution_commands(INTEGER)
     SECURITY INVOKER;`,
  );
  requireFinisherGateAFailure(
    "Cleanup function security mode weakened",
    "cleanup_expired_finisher_execution_commands",
  );
  psql(
    `ALTER FUNCTION cleanup_expired_finisher_execution_commands(INTEGER)
     SECURITY DEFINER;`,
  );
  psql(
    `ALTER FUNCTION cleanup_expired_finisher_execution_commands(INTEGER)
     SET search_path TO pg_catalog, public;`,
  );
  requireFinisherGateAFailure(
    "Cleanup function search path weakened",
    "cleanup_expired_finisher_execution_commands",
  );
  psql(
    `ALTER FUNCTION cleanup_expired_finisher_execution_commands(INTEGER)
     SET search_path TO pg_catalog, pg_temp;`,
  );

  psql(`
    CREATE FUNCTION command_cleanup_bypass() RETURNS void
    LANGUAGE plpgsql AS $$
    BEGIN
      UPDATE public."FinisherExecutionCommand"
      SET "response" = NULL
      WHERE FALSE;
      RETURN;
    END;
    $$;
    REVOKE ALL ON FUNCTION command_cleanup_bypass() FROM PUBLIC;
  `);
  requireFinisherGateAFailure(
    "Neutrally named static SQL cleanup bypass",
    "function-mutation-path:command_cleanup_bypass",
  );
  psql(`DROP FUNCTION command_cleanup_bypass();`);

  psql(`
    CREATE FUNCTION command_tombstone_passthrough() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      RETURN NEW;
    END;
    $$;
    REVOKE ALL ON FUNCTION command_tombstone_passthrough() FROM PUBLIC;
    CREATE TRIGGER "Command_tombstone_passthrough"
    BEFORE UPDATE ON "FinisherExecutionCommand"
    FOR EACH ROW EXECUTE FUNCTION command_tombstone_passthrough();
  `);
  requireFinisherGateAFailure(
    "Unexpected trigger provides a Finisher mutation path",
    "function-mutation-path:command_tombstone_passthrough",
  );
  psql(`
    DROP TRIGGER "Command_tombstone_passthrough"
      ON "FinisherExecutionCommand";
    DROP FUNCTION command_tombstone_passthrough();
  `);

  psql(
    `REVOKE EXECUTE ON FUNCTION
      cleanup_expired_finisher_execution_commands(INTEGER)
     FROM trainer_app_runtime;`,
  );
  requireFinisherGateAFailure(
    "Canonical runtime cleanup grant removed",
    "function-privileges:cleanup_expired_finisher_execution_commands",
  );
  psql(
    `GRANT EXECUTE ON FUNCTION
      cleanup_expired_finisher_execution_commands(INTEGER)
     TO trainer_app_runtime;`,
  );

  const canonicalCommandTombstoneFunction = psql(
    `
      SELECT pg_get_functiondef(p.oid)
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'guard_finisher_execution_command_tombstone'
        AND pg_get_function_identity_arguments(p.oid) = '';
    `,
    true,
  );
  psql(`
    CREATE OR REPLACE FUNCTION
      guard_finisher_execution_command_tombstone()
    RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF current_setting(
        'trainer.finisher_command_cleanup',
        TRUE
      ) = 'enabled' THEN
        RETURN NEW;
      END IF;
      RETURN COALESCE(NEW, OLD);
    END;
    $$;
  `);
  requireFinisherGateAFailure(
    "Caller-controlled cleanup setting reintroduced",
    "function-caller-setting-bypass:guard_finisher_execution_command_tombstone",
  );
  psql(`${canonicalCommandTombstoneFunction};`);

  for (const [column, label] of [
    ["indisvalid", "invalid"],
    ["indisready", "unready"],
    ["indislive", "non-live"],
  ] as const) {
    psql(`
      SET allow_system_table_mods = on;
      UPDATE pg_catalog.pg_index
      SET ${column} = false
      WHERE indexrelid = '"FinisherExecution_one_active_per_workout"'::regclass;
    `);
    requireFinisherGateAFailure(
      `${label} Finisher partial unique index`,
      "FinisherExecution_one_active_per_workout",
    );
    psql(`
      SET allow_system_table_mods = on;
      UPDATE pg_catalog.pg_index
      SET ${column} = true
      WHERE indexrelid = '"FinisherExecution_one_active_per_workout"'::regclass;
    `);
  }

  const createCanonicalActiveExecutionIndex = `
    CREATE UNIQUE INDEX "FinisherExecution_one_active_per_workout"
      ON "FinisherExecution"("workoutId")
      WHERE "state" IN ('SELECTED', 'IN_PROGRESS');
  `;
  psql(`DROP INDEX "FinisherExecution_one_active_per_workout";`);
  requireFinisherAppliedSchemaFailure(
    "Missing Finisher partial unique index",
    "FinisherExecution_one_active_per_workout",
  );
  psql(createCanonicalActiveExecutionIndex);

  for (const [label, replacement] of [
    [
      "altered-predicate",
      `CREATE UNIQUE INDEX "FinisherExecution_one_active_per_workout"
         ON "FinisherExecution"("workoutId")
         WHERE "state" = 'SELECTED';`,
    ],
    [
      "altered-column",
      `CREATE UNIQUE INDEX "FinisherExecution_one_active_per_workout"
         ON "FinisherExecution"("offerId")
         WHERE "state" IN ('SELECTED', 'IN_PROGRESS');`,
    ],
    [
      "non-unique",
      `CREATE INDEX "FinisherExecution_one_active_per_workout"
         ON "FinisherExecution"("workoutId")
         WHERE "state" IN ('SELECTED', 'IN_PROGRESS');`,
    ],
  ] as const) {
    psql(`
      DROP INDEX "FinisherExecution_one_active_per_workout";
      ${replacement}
    `);
    requireFinisherGateAFailure(
      `${label} Finisher partial unique index`,
      "FinisherExecution_one_active_per_workout",
    );
    psql(`
      DROP INDEX "FinisherExecution_one_active_per_workout";
      ${createCanonicalActiveExecutionIndex}
    `);
  }

  const createCanonicalPerformedExecutionIndex = `
    CREATE UNIQUE INDEX "FinisherExecution_one_started_per_workout"
      ON "FinisherExecution"("workoutId")
      WHERE "startedAt" IS NOT NULL;
  `;
  psql(`DROP INDEX "FinisherExecution_one_started_per_workout";`);
  requireFinisherAppliedSchemaFailure(
    "Missing permanent performed-history uniqueness",
    "FinisherExecution_one_started_per_workout",
  );
  psql(createCanonicalPerformedExecutionIndex);
  psql(`
    DROP INDEX "FinisherExecution_one_started_per_workout";
    CREATE UNIQUE INDEX "FinisherExecution_one_started_per_workout"
      ON "FinisherExecution"("workoutId")
      WHERE "state" = 'IN_PROGRESS';
  `);
  requireFinisherAppliedSchemaFailure(
    "Weakened permanent performed-history uniqueness",
    "FinisherExecution_one_started_per_workout",
  );
  psql(`
    DROP INDEX "FinisherExecution_one_started_per_workout";
    ${createCanonicalPerformedExecutionIndex}
  `);

  const canonicalOfferItemInsertFunction = psql(
    `
      SELECT pg_get_functiondef(p.oid)
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'guard_finisher_offer_item_insert'
        AND pg_get_function_identity_arguments(p.oid) = '';
    `,
    true,
  );
  psql(`
    CREATE OR REPLACE FUNCTION guard_finisher_offer_item_insert() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      RETURN NEW;
    END;
    $$;
  `);
  requireFinisherGateAFailure(
    "Weakened Finisher protection function",
    "guard_finisher_offer_item_insert",
  );
  psql(`${canonicalOfferItemInsertFunction};`);
  psql(
    `ALTER FUNCTION guard_finisher_offer_item_insert() SECURITY DEFINER;`,
  );
  requireFinisherGateAFailure(
    "Altered Finisher function security",
    "guard_finisher_offer_item_insert",
  );
  psql(
    `ALTER FUNCTION guard_finisher_offer_item_insert() SECURITY INVOKER;`,
  );

  const canonicalFeedbackConstraint = `
    ALTER TABLE "FinisherExecution"
    ADD CONSTRAINT "FinisherExecution_feedback_range"
    CHECK (
      "difficultyFeedback" IS NULL
      OR "difficultyFeedback" BETWEEN 1 AND 10
    );
  `;
  psql(`
    ALTER TABLE "FinisherExecution"
      DROP CONSTRAINT "FinisherExecution_feedback_range";
    ALTER TABLE "FinisherExecution"
      ADD CONSTRAINT "FinisherExecution_feedback_range"
      CHECK ("difficultyFeedback" IS NULL OR "difficultyFeedback" >= 1);
  `);
  requireFinisherGateAFailure(
    "Weakened Finisher Boolean constraint",
    "FinisherExecution_feedback_range",
  );
  psql(`
    ALTER TABLE "FinisherExecution"
      DROP CONSTRAINT "FinisherExecution_feedback_range";
    ${canonicalFeedbackConstraint}
  `);
  psql(`
    ALTER TABLE "FinisherExecution"
      DROP CONSTRAINT "FinisherExecution_feedback_range";
    ALTER TABLE "FinisherExecution"
      ADD CONSTRAINT "FinisherExecution_feedback_range"
      CHECK (
        "difficultyFeedback" IS NULL
        OR "difficultyFeedback" BETWEEN 1 AND 10
      ) NOT VALID;
  `);
  requireFinisherGateAFailure(
    "Unvalidated Finisher constraint",
    "FinisherExecution_feedback_range",
  );
  psql(`
    ALTER TABLE "FinisherExecution"
      VALIDATE CONSTRAINT "FinisherExecution_feedback_range";
  `);

  psql(`
    ALTER TABLE "FinisherDecision"
      ALTER COLUMN "expectedOfferRevision" DROP NOT NULL;
  `);
  requireFinisherGateAFailure(
    "Nullable decision expected revision",
    "FinisherDecision.expectedOfferRevision",
  );
  psql(`
    ALTER TABLE "FinisherDecision"
      ALTER COLUMN "expectedOfferRevision" SET NOT NULL;
  `);
  psql(`
    ALTER TABLE "FinisherDecision"
      DROP CONSTRAINT "FinisherDecision_fingerprint_shape";
  `);
  requireFinisherAppliedSchemaFailure(
    "Missing durable decision fingerprint constraint",
    "FinisherDecision_fingerprint_shape",
  );
  psql(`
    ALTER TABLE "FinisherDecision"
      ADD CONSTRAINT "FinisherDecision_fingerprint_shape"
      CHECK ("requestFingerprint" ~ '^[0-9a-f]{64}$');
  `);

  psql(`
    ALTER TABLE "FinisherOfferItem"
      DROP CONSTRAINT "FinisherOfferItem_offerId_fkey";
    ALTER TABLE "FinisherOfferItem"
      ADD CONSTRAINT "FinisherOfferItem_offerId_fkey"
      FOREIGN KEY ("offerId") REFERENCES "FinisherOffer"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  `);
  requireFinisherGateAFailure(
    "Altered Finisher foreign-key action",
    "FinisherOfferItem_offerId_fkey",
  );
  psql(`
    ALTER TABLE "FinisherOfferItem"
      DROP CONSTRAINT "FinisherOfferItem_offerId_fkey";
    ALTER TABLE "FinisherOfferItem"
      ADD CONSTRAINT "FinisherOfferItem_offerId_fkey"
      FOREIGN KEY ("offerId") REFERENCES "FinisherOffer"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT;
  `);

  psql(`
    ALTER TABLE "FinisherExecutionStep"
      DROP CONSTRAINT
        "FinisherExecutionStep_executionId_routineVersionId_fkey";
  `);
  requireFinisherAppliedSchemaFailure(
    "Missing execution-to-routine-version binding",
    "FinisherExecutionStep_executionId_routineVersionId_fkey",
  );
  psql(`
    ALTER TABLE "FinisherExecutionStep"
      ADD CONSTRAINT
        "FinisherExecutionStep_executionId_routineVersionId_fkey"
      FOREIGN KEY ("executionId", "routineVersionId")
      REFERENCES "FinisherExecution"("id", "routineVersionId")
      ON DELETE RESTRICT ON UPDATE RESTRICT;
  `);

  psql(`
    ALTER TABLE "FinisherExecutionStep"
      DROP CONSTRAINT "FinisherExecutionStep_routineStep_binding_fkey";
    ALTER TABLE "FinisherExecutionStep"
      ADD CONSTRAINT "FinisherExecutionStep_routineStep_binding_fkey"
      FOREIGN KEY ("routineStepId", "routineVersionId", "orderIndex")
      REFERENCES "FinisherRoutineStep"(
        "id", "routineVersionId", "orderIndex"
      )
      ON DELETE RESTRICT ON UPDATE CASCADE;
  `);
  requireFinisherGateAFailure(
    "Protected step/version/order update action became cascading",
    "FinisherExecutionStep_routineStep_binding_fkey",
  );
  psql(`
    ALTER TABLE "FinisherExecutionStep"
      DROP CONSTRAINT "FinisherExecutionStep_routineStep_binding_fkey";
    ALTER TABLE "FinisherExecutionStep"
      ADD CONSTRAINT "FinisherExecutionStep_routineStep_binding_fkey"
      FOREIGN KEY ("routineStepId", "routineVersionId", "orderIndex")
      REFERENCES "FinisherRoutineStep"(
        "id", "routineVersionId", "orderIndex"
      )
      ON DELETE RESTRICT ON UPDATE RESTRICT;
  `);

  psql(`
    ALTER TABLE "FinisherExecutionStep"
      DROP CONSTRAINT
        "FinisherExecutionStep_performedAlternative_binding_fkey";
  `);
  requireFinisherAppliedSchemaFailure(
    "Missing performed-alternative-to-prescribed-step binding",
    "FinisherExecutionStep_performedAlternative_binding_fkey",
  );
  psql(`
    ALTER TABLE "FinisherExecutionStep"
      ADD CONSTRAINT
        "FinisherExecutionStep_performedAlternative_binding_fkey"
      FOREIGN KEY ("performedAlternativeId", "routineStepId")
      REFERENCES "FinisherRoutineStepAlternative"("id", "routineStepId")
      ON DELETE RESTRICT ON UPDATE RESTRICT;
  `);

  psql(`
    ALTER TABLE "FinisherExecutionStep"
      DROP CONSTRAINT
        "FinisherExecutionStep_performedAlternative_binding_fkey";
    DROP INDEX
      "FinisherRoutineStepAlternative_id_routineStepId_key";
  `);
  requireFinisherAppliedSchemaFailure(
    "Missing supporting performed-alternative binding uniqueness",
    "FinisherRoutineStepAlternative_id_routineStepId_key",
  );
  psql(`
    CREATE UNIQUE INDEX
      "FinisherRoutineStepAlternative_id_routineStepId_key"
      ON "FinisherRoutineStepAlternative"("id", "routineStepId");
    ALTER TABLE "FinisherExecutionStep"
      ADD CONSTRAINT
        "FinisherExecutionStep_performedAlternative_binding_fkey"
      FOREIGN KEY ("performedAlternativeId", "routineStepId")
      REFERENCES "FinisherRoutineStepAlternative"("id", "routineStepId")
      ON DELETE RESTRICT ON UPDATE RESTRICT;
  `);

  psql(`
    INSERT INTO "FinisherRoutine" ("id", "code", "publicationState")
    VALUES (
      '00000000-0000-4000-8000-000000000099',
      'unexpected-active-rollout-fixture',
      'ACTIVE'
    );
  `);
  requireFinisherGateAFailure(
    "Unexpected active Finisher catalog row",
    "00000000-0000-4000-8000-000000000099",
  );
  psql(`
    ALTER TABLE "FinisherRoutine" DISABLE TRIGGER "FinisherRoutine_identity_immutable";
    DELETE FROM "FinisherRoutine"
    WHERE "id" = '00000000-0000-4000-8000-000000000099';
    ALTER TABLE "FinisherRoutine" ENABLE TRIGGER "FinisherRoutine_identity_immutable";
  `);

  const fullSeedA = cli("scripts/backfill-immutable-seed-revisions.ts", []);
  const fullSeedB = cli("scripts/backfill-immutable-seed-revisions.ts", []);
  if (JSON.stringify(fullSeedA) !== JSON.stringify(fullSeedB)) {
    throw new Error("Seed invalid-row inventory is not deterministic");
  }
  const fullSeedSummary = objectField(fullSeedA, "summary");
  if (
    numberField(fullSeedSummary, "normalizable") !== 3 ||
    numberField(fullSeedSummary, "legacyExceptions") !== 1 ||
    numberField(fullSeedSummary, "invalid") !== 0 ||
    numberField(fullSeedSummary, "expectedInserts") !== 3 ||
    numberField(fullSeedSummary, "expectedPointerUpdates") !== 3
  ) {
    throw new Error("Fully migrated seed inventory did not preserve three candidates and one explicit exception");
  }

  const fullStimulusInventory = cli("scripts/backfill-workout-exercise-stimulus-accounting.ts", ["--inventory-only"]);
  const fullStimulusDryRun = cli("scripts/backfill-workout-exercise-stimulus-accounting.ts", []);
  if (
    numberField(fullStimulusInventory, "expectedWriteCountAfterMigration") !==
    numberField(fullStimulusDryRun, "eligibleNullRows")
  ) {
    throw new Error("Stimulus projected and post-migration dry-run counts disagree");
  }

  const fullReviewInventory = cli("scripts/backfill-post-session-reviews.ts", ["--inventory-only"]);
  const fullReviewDryRun = cli("scripts/backfill-post-session-reviews.ts", []);
  if (
    numberField(fullReviewInventory, "expectedLegacyDerived") !==
    numberField(fullReviewDryRun, "legacyDerivedCandidate")
  ) {
    throw new Error("Review projected and post-migration dry-run counts disagree");
  }

  const persisted = psql(`
    SELECT
      (SELECT COUNT(*) FROM "WorkoutExercise" WHERE "stimulusAccountingSnapshot" IS NOT NULL),
      (SELECT COUNT(*) FROM "PostSessionReviewSnapshot"),
      (SELECT COUNT(*) FROM "MesocycleSeedRevision" WHERE "provenanceStatus" = 'exact'),
      (SELECT COUNT(*) FROM "MesocycleSeedRevision");
  `, true);
  if (persisted !== "0|0|0|3") {
    throw new Error(`Disposable dry-run unexpectedly mutated persisted state: ${persisted}`);
  }

  const readinessStateD = cliWithExpectedStatus("scripts/audit-readiness-integrity.ts", [], 0);
  if (
    readinessStateD.schemaStage !== "fully_migrated" ||
    objectField(readinessStateD, "exact").applicability !== "verified_fully_migrated" ||
    numberField(objectField(readinessStateD, "exact"), "legacyRows") !== 10 ||
    readinessStateD.readinessIntegrityReady !== true ||
    readinessStateD.writes !== 0
  ) {
    throw new Error(`Readiness State D failed: ${JSON.stringify(readinessStateD)}`);
  }

  psql(`
    INSERT INTO "MesocycleSeedRevision" (
      "id", "mesocycleId", "revision", "seedPayload", "payloadHash", "hashAlgorithm",
      "provenanceStatus", "creationReason", "actorSource"
    ) VALUES (
      'rollout-exact-seed', 'rollout-valid-meso', 2,
      '{"version":1,"slots":[]}'::jsonb, 'rollout-seed-hash', 'sha256',
      'exact', 'readiness_integrity_fixture', 'disposable_harness'
    );
    UPDATE "Mesocycle"
    SET "currentSeedRevisionId" = 'rollout-exact-seed'
    WHERE id = 'rollout-valid-meso';
  `);
  insertExactReadiness({ id: "readiness-clean-exact", slotId: "clean_exact_slot" });
  const readinessCleanExact = cliWithExpectedStatus("scripts/audit-readiness-integrity.ts", [], 0);
  if (
    numberField(objectField(readinessCleanExact, "exact"), "exactRows") !== 1 ||
    readinessCleanExact.readinessIntegrityReady !== true
  ) {
    throw new Error(`Readiness clean exact fixture failed: ${JSON.stringify(readinessCleanExact)}`);
  }

  insertExactReadiness({
    id: "readiness-corrupt-exact-a",
    slotId: "corrupt_exact_slot",
    persistedIdentityHash: "corrupt-identity-a",
    persistedTargetHash: "corrupt-target-a",
    persistedPayloadHash: "corrupt-payload-a",
  });
  insertExactReadiness({
    id: "readiness-corrupt-exact-b",
    slotId: "corrupt_exact_slot",
    persistedIdentityHash: "corrupt-identity-b",
    persistedTargetHash: "corrupt-target-b",
  });
  const readinessStateE = cliWithExpectedStatus("scripts/audit-readiness-integrity.ts", [], 1);
  if (
    readinessStateE.schemaStage !== "fully_migrated" ||
    readinessStateE.readinessIntegrityReady !== false ||
    arrayField(objectField(readinessStateE, "exact"), "identityHashFailures").length !== 2 ||
    arrayField(objectField(readinessStateE, "exact"), "payloadHashFailures").length !== 1 ||
    arrayField(objectField(readinessStateE, "exact"), "duplicateActiveIdentity").length !== 1 ||
    arrayField(objectField(readinessStateE, "exact"), "duplicateActiveTarget").length !== 1 ||
    readinessStateE.writes !== 0
  ) {
    throw new Error(`Readiness State E failed: ${JSON.stringify(readinessStateE)}`);
  }

  console.log(JSON.stringify({
    result: "passed",
    postgres: 16,
    preMigration: {
      migrations: preMigrationCount,
      seedLegacyBaselineOnly: 3,
      seedLegacyExceptions: 1,
      seedInvalid: 0,
      stimulusProjectedWrites: numberField(preStimulus, "expectedWriteCountAfterMigration"),
      reviewProjectedWrites: numberField(preReview, "expectedLegacyDerived"),
    },
    fullyMigrated: {
      migrations: migrations.length,
      seedNormalizable: 3,
      seedLegacyExceptions: 1,
      seedInvalid: 0,
      stimulusDryRunCandidates: numberField(fullStimulusDryRun, "eligibleNullRows"),
      reviewDryRunCandidates: numberField(fullReviewDryRun, "legacyDerivedCandidate"),
    },
    writes: 0,
    principalWorkflow: {
      cleanCreation: "three_principals_and_runtime_scram_credential",
      partialCreation: "two_missing_principals_only",
      idempotentRepeat: "zero_database_writes",
      verification: "repeatable_read_read_only_zero_writes",
      evidence: "sanitized_audit_only_live_verification_authoritative",
      preMigrationFinisherObjects: 0,
      preMigrationObjectOwnershipOrGrants: 0,
      wrongExistingCredential: "rejected_without_rotation_or_evidence",
      wrongTarget: "rejected_without_secret_output",
    },
    directEndpointDiagnostic: "successful_direct_connection",
    configuredEnvironmentLeak: false,
    migrationIntegrity: {
      resolvedBaseline: "prisma_cli_zero_step_applied",
      resolvedSetIntent: "prisma_cli_zero_step_applied",
      repeatedResolve: "P3008_state_unchanged",
      stateA: "legacy_10_applied_8_pending_rejected",
      stateB: "partial_object_blocked",
      stateC: "checksum_mismatch_blocked",
      stateD: "failed_rolled_back_and_unfinished_ledger_blocked",
      currentProductionState: "17_applied_1_pending_provider_evidence_required_execution_not_authorized",
      forgedOperatorPendingPolicy: "rejected_before_integrity_evaluation",
      stateE: "fully_migrated_gate_a_not_applicable",
      baselineUniquenessVariants: "standalone_constraint_missing_wrong_order_non_unique_partial_predicate",
      finisherExactIntegrityNegatives:
        "disabled_replica_only_missing_altered_event_altered_timing_altered_table_trigger_command_delete_event_removed_invalid_unready_nonlive_missing_altered_predicate_altered_column_nonunique_partial_index_weakened_terminal_parent_child_matrix_step_command_and_security_changed_function_cleanup_body_owner_grant_role_membership_search_path_public_execute_runtime_mutation_removed_grant_guc_neutral_helper_unexpected_trigger_drift_weakened_unvalidated_and_fk_action_composite_binding_uniqueness_changed_constraint_unexpected_active_catalog_row",
      readOnlyFingerprintsStable: true,
    },
    readinessIntegrity: {
      stateA: "pre_migration_representative_clean",
      stateB: "pre_migration_duplicate_blocked_without_repair",
      stateC: "partial_schema_blocked",
      stateD: "fully_migrated_clean_legacy_inventory",
      stateE: "fully_migrated_corrupt_and_computed_duplicates_blocked",
      stateF: "production_like_10_total_8_active_clean",
      preMigrationQueryAvoidedFutureColumns: true,
      readOnlyFingerprintsStable: true,
      writes: 0,
    },
  }, null, 2));
} finally {
  rmSync(envFile, { force: true });
  rmSync(authorizationEvidenceFile, { force: true });
  rmSync(principalProvisionEvidenceFile, { force: true });
  rmSync(principalVerificationEvidenceFile, { force: true });
  rmSync(principalRepeatEvidenceFile, { force: true });
  rmSync(principalPartialEvidenceFile, { force: true });
  rmSync(principalWrongTargetEvidenceFile, { force: true });
  rmSync(principalWrongPasswordEvidenceFile, { force: true });
  spawnSync("docker", ["rm", "-f", containerName], { stdio: "ignore" });
}
