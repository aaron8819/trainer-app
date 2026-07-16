import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const containerName = `trainer-rollout-${process.pid}-${randomUUID().slice(0, 8)}`;
const envFile = join(tmpdir(), `${containerName}.env`);
const preMigrationCount = 10;

type CommandResult = { status: number; stdout: string; stderr: string };

function run(executable: string, args: string[], options: { input?: string; quiet?: boolean } = {}): CommandResult {
  const result = spawnSync(executable, args, {
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      NODE_ENV: "test",
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
    psql(sql);
  }
}

function migrationChecksum(name: string): string {
  const bytes = readFileSync(join(process.cwd(), "prisma", "migrations", name, "migration.sql"));
  return createHash("sha256").update(bytes).digest("hex");
}

function createMigrationLedger(): void {
  psql(`
    CREATE TABLE public._prisma_migrations (
      id VARCHAR(36) PRIMARY KEY,
      checksum VARCHAR(64) NOT NULL,
      finished_at TIMESTAMPTZ,
      migration_name VARCHAR(255) NOT NULL,
      logs TEXT,
      rolled_back_at TIMESTAMPTZ,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      applied_steps_count INTEGER NOT NULL DEFAULT 0
    );
  `);
}

function recordMigration(name: string, index: number): void {
  psql(`
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
  const result = requireSuccess(
    run(process.execPath, [join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"), script, "--env-file", envFile, "--confirm-disposable", ...args], { quiet: true }),
    `${script} ${args.join(" ")}`,
  );
  if (result.stdout.includes("configured-remote.invalid")) {
    throw new Error("Configured parent DATABASE_URL leaked into disposable rollout tooling");
  }
  return parseLastJson(result.stdout);
}

function cliWithExpectedStatus(script: string, args: string[], expectedStatus: number): Record<string, unknown> {
  const result = run(
    process.execPath,
    [join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"), script, "--env-file", envFile, "--confirm-disposable", ...args],
    { quiet: true },
  );
  if (result.status !== expectedStatus) {
    throw new Error(`Unexpected ${script} status=${result.status}; expected=${expectedStatus}\n${result.stdout}\n${result.stderr}`);
  }
  if (`${result.stdout}\n${result.stderr}`.includes("trainer-rollout")) {
    throw new Error("Disposable connection credential or container identifier leaked into migration output");
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
        'rollout-invalid-meso', 'rollout-macro', 2, 4, 4, 'Fixture invalid',
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

if (!process.argv.includes("--confirm-disposable")) {
  throw new Error("ROLLOUT_TOOLING_DB_TEST_REQUIRES_CONFIRM_DISPOSABLE");
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
  const port = requireSuccess(run("docker", ["port", containerName, "5432/tcp"], { quiet: true }), "docker port")
    .stdout.trim().split(":").at(-1);
  if (!port) throw new Error("DISPOSABLE_ROLLOUT_POSTGRES_PORT_NOT_FOUND");
  const disposableUrl = `postgresql://trainer:trainer-rollout@127.0.0.1:${port}/trainer`;
  writeFileSync(envFile, `DATABASE_URL=${disposableUrl}\nDIRECT_URL=${disposableUrl}\n`);

  const migrations = migrationDirectories();
  if (migrations.length !== 15) throw new Error(`Expected 15 migrations, found ${migrations.length}`);
  applyMigrations(migrations.slice(0, preMigrationCount));
  createMigrationLedger();
  recordMigrations(migrations.slice(0, preMigrationCount));
  insertHistoricalFixture();

  const directCheck = cli("scripts/check-direct-db.ts", []);
  if (directCheck.classification !== "successful_direct_connection") {
    throw new Error("Direct endpoint diagnostic did not classify the disposable connection successfully");
  }

  const beforeStateA = databaseStateFingerprint();
  const migrationStateA = cliWithExpectedStatus("scripts/check-migration-status.ts", [], 0);
  const afterStateA = databaseStateFingerprint();
  if (beforeStateA !== afterStateA) throw new Error("State A migration integrity inspection changed disposable database state");
  if (
    numberField(objectField(migrationStateA, "chain"), "applied") !== 10 ||
    numberField(objectField(migrationStateA, "chain"), "pending") !== 5 ||
    migrationStateA.migrationAuthorizationReady !== true
  ) {
    throw new Error(`State A did not authorize the clean pre-migration state: ${JSON.stringify(migrationStateA)}`);
  }

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

  const preSeed = cli("scripts/backfill-immutable-seed-revisions.ts", []);
  const preSeedSummary = objectField(preSeed, "summary");
  if (numberField(preSeedSummary, "legacyBaselineOnly") !== 1 || numberField(preSeedSummary, "invalid") !== 1) {
    throw new Error("Pre-migration seed inventory did not report valid and invalid rows independently");
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

  applyMigrations(migrations.slice(preMigrationCount));
  recordMigrations(migrations.slice(preMigrationCount), preMigrationCount);

  const beforeStateE = databaseStateFingerprint();
  const migrationStateE = cliWithExpectedStatus("scripts/check-migration-status.ts", [], 0);
  const afterStateE = databaseStateFingerprint();
  if (beforeStateE !== afterStateE) throw new Error("State E migration integrity inspection changed disposable database state");
  if (
    numberField(objectField(migrationStateE, "chain"), "applied") !== 15 ||
    numberField(objectField(migrationStateE, "chain"), "pending") !== 0 ||
    objectField(migrationStateE, "chain").gateAApplicable !== false ||
    migrationStateE.migrationAuthorizationReady !== false
  ) {
    throw new Error(`State E did not report a clean fully migrated non-Gate-A state: ${JSON.stringify(migrationStateE)}`);
  }

  const fullSeedA = cli("scripts/backfill-immutable-seed-revisions.ts", []);
  const fullSeedB = cli("scripts/backfill-immutable-seed-revisions.ts", []);
  if (JSON.stringify(fullSeedA) !== JSON.stringify(fullSeedB)) {
    throw new Error("Seed invalid-row inventory is not deterministic");
  }
  const fullSeedSummary = objectField(fullSeedA, "summary");
  if (numberField(fullSeedSummary, "normalizable") !== 1 || numberField(fullSeedSummary, "invalid") !== 1) {
    throw new Error("Fully migrated seed inventory did not preserve valid/invalid classification");
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
  if (persisted !== "0|0|0|2") {
    throw new Error(`Disposable dry-run unexpectedly mutated persisted state: ${persisted}`);
  }

  console.log(JSON.stringify({
    result: "passed",
    postgres: 16,
    preMigration: {
      migrations: preMigrationCount,
      seedLegacyBaselineOnly: 1,
      seedInvalid: 1,
      stimulusProjectedWrites: numberField(preStimulus, "expectedWriteCountAfterMigration"),
      reviewProjectedWrites: numberField(preReview, "expectedLegacyDerived"),
    },
    fullyMigrated: {
      migrations: migrations.length,
      seedNormalizable: 1,
      seedInvalid: 1,
      stimulusDryRunCandidates: numberField(fullStimulusDryRun, "eligibleNullRows"),
      reviewDryRunCandidates: numberField(fullReviewDryRun, "legacyDerivedCandidate"),
    },
    writes: 0,
    directEndpointDiagnostic: "successful_direct_connection",
    configuredEnvironmentLeak: false,
    migrationIntegrity: {
      stateA: "authorization_ready",
      stateB: "partial_object_blocked",
      stateC: "checksum_mismatch_blocked",
      stateD: "failed_and_rolled_back_ledger_blocked",
      stateE: "fully_migrated_gate_a_not_applicable",
      readOnlyFingerprintsStable: true,
    },
  }, null, 2));
} finally {
  rmSync(envFile, { force: true });
  spawnSync("docker", ["rm", "-f", containerName], { stdio: "ignore" });
}
