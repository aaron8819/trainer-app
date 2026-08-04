import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import {
  parseExactDisposableConfirmationArgs,
  sanitizeDatabaseTargetEnvironment,
  validateDisposableDatabaseTargets,
} from "../src/lib/operations/test-environment-preflight";

const containerName = `trainer-workout-occ-${process.pid}-${randomUUID().slice(0, 8)}`;

function run(
  executable: string,
  args: string[],
  env = process.env,
  quiet = false,
  cwd = process.cwd(),
): string {
  const result = spawnSync(executable, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: quiet ? "pipe" : "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${executable} ${args.join(" ")} failed with status ${result.status}`);
  }
  return (result.stdout ?? "").trim();
}

function waitForPostgres(): void {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = spawnSync(
      "docker",
      [
        "exec",
        "-i",
        containerName,
        "psql",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "trainer",
        "-d",
        "trainer",
        "-tAc",
        "SELECT 1",
      ],
      { stdio: "ignore" },
    );
    if (result.status === 0) return;
    const until = Date.now() + 500;
    while (Date.now() < until) {
      // Bounded polling for an isolated local test container.
    }
  }
  throw new Error("DISPOSABLE_POSTGRES_DID_NOT_BECOME_READY");
}

function psql(sql: string, database = "trainer"): void {
  const result = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      containerName,
      "psql",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "trainer",
      "-d",
      database,
    ],
    { input: sql, encoding: "utf8", stdio: ["pipe", "inherit", "inherit"] },
  );
  if (result.status !== 0) {
    throw new Error(`DISPOSABLE_FINISHER_SQL_FAILED:${result.status}`);
  }
}

function psqlValue(sql: string, database = "trainer"): string {
  return run(
    "docker",
    [
      "exec",
      "-i",
      containerName,
      "psql",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "trainer",
      "-d",
      database,
      "-tAc",
      sql,
    ],
    process.env,
    true,
  );
}

function applyPreFinisherMigrations(env: NodeJS.ProcessEnv): void {
  const temporaryRoot = mkdtempSync(
    join(process.cwd(), ".trainer-pre-finisher-"),
  );
  const temporaryPrisma = join(temporaryRoot, "prisma");
  try {
    cpSync(join(process.cwd(), "prisma"), temporaryPrisma, { recursive: true });
    cpSync(
      join(process.cwd(), "prisma.config.ts"),
      join(temporaryRoot, "prisma.config.ts"),
    );
    rmSync(
      join(
        temporaryPrisma,
        "migrations",
        "20260728120000_add_finishers_phase_1",
      ),
      { recursive: true },
    );
    rmSync(
      join(
        temporaryPrisma,
        "migrations",
        "20260803120000_add_finisher_management",
      ),
      { recursive: true },
    );
    run(
      process.execPath,
      [
        join(process.cwd(), "node_modules/prisma/build/index.js"),
        "migrate",
        "deploy",
      ],
      env,
      false,
      temporaryRoot,
    );
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function clonePreFinisherDatabase(database: string): void {
  run("docker", [
    "exec",
    "-i",
    containerName,
    "createdb",
    "-U",
    "trainer",
    "--template",
    "trainer",
    database,
  ]);
}

function verifyAtomicFinisherMigrationFailure(): void {
  clonePreFinisherDatabase("finisher_failure_probe");
  const migration = readFileSync(
    join(
      process.cwd(),
      "prisma/migrations/20260728120000_add_finishers_phase_1/migration.sql"
    ),
    "utf8"
  );
  const injected = migration.replace(
    /\nCOMMIT;\s*$/,
    '\nSELECT * FROM "intentional_finisher_migration_failure";\n\nCOMMIT;\n'
  );
  const failed = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      containerName,
      "psql",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "trainer",
      "-d",
      "finisher_failure_probe",
    ],
    { input: injected, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
  );
  if (failed.status === 0) {
    throw new Error("INJECTED_FINISHER_MIGRATION_FAILURE_DID_NOT_FAIL");
  }
  const relation = run(
    "docker",
    [
      "exec",
      "-i",
      containerName,
      "psql",
      "-U",
      "trainer",
      "-d",
      "finisher_failure_probe",
      "-tAc",
      `SELECT COALESCE(to_regclass('"FinisherRoutine"')::text, 'none')`,
    ],
    process.env,
    true
  );
  const enumCount = run(
    "docker",
    [
      "exec",
      "-i",
      containerName,
      "psql",
      "-U",
      "trainer",
      "-d",
      "finisher_failure_probe",
      "-tAc",
      "SELECT count(*) FROM pg_type WHERE typname IN ('FinisherCategory', 'FinisherExecutionState')",
    ],
    process.env,
    true
  );
  if (relation !== "none" || enumCount !== "0") {
    throw new Error(
      `FINISHER_MIGRATION_LEFT_PARTIAL_STATE:${relation}:${enumCount}`
    );
  }
  console.log(
    "Injected Finisher migration failure rolled back all target objects and catalog rows."
  );
}

function verifyConflictingFinisherSchemaRejected(): void {
  clonePreFinisherDatabase("finisher_conflict_probe");
  psql(
    'CREATE TABLE "FinisherPartialConflict" ("id" INTEGER PRIMARY KEY);',
    "finisher_conflict_probe",
  );
  const migration = readFileSync(
    join(
      process.cwd(),
      "prisma/migrations/20260728120000_add_finishers_phase_1/migration.sql",
    ),
    "utf8",
  );
  const failed = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      containerName,
      "psql",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "trainer",
      "-d",
      "finisher_conflict_probe",
    ],
    { input: migration, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  );
  const output = `${failed.stdout ?? ""}\n${failed.stderr ?? ""}`;
  if (
    failed.status === 0 ||
    !output.includes("Finisher schema objects already exist")
  ) {
    throw new Error("CONFLICTING_FINISHER_SCHEMA_WAS_NOT_REJECTED");
  }
  if (
    psqlValue(
      `SELECT
         to_regclass('"FinisherPartialConflict"') IS NOT NULL
         AND to_regclass('"FinisherRoutine"') IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM pg_catalog.pg_type
           WHERE typname = 'FinisherCategory'
         )`,
      "finisher_conflict_probe",
    ) !== "t"
  ) {
    throw new Error("CONFLICTING_FINISHER_SCHEMA_FAILURE_WAS_NOT_ATOMIC");
  }
  console.log(
    "Conflicting partial Finisher schema failed clearly without applying target objects.",
  );
}

function verifyFinisherSeedOrderDrift(
  env: NodeJS.ProcessEnv,
): void {
  const seedCommand = [
    join(process.cwd(), "node_modules/tsx/dist/cli.mjs"),
    "prisma/seed.ts",
  ];
  run(process.execPath, seedCommand, env);

  const scenarios = [
    {
      label: "step",
      table: "FinisherRoutineStep",
      trigger: "FinisherRoutineStep_immutable",
      mutate: `
        UPDATE "FinisherRoutineStep" s
        SET "orderIndex" = s."orderIndex" + 100
        FROM "FinisherRoutineVersion" v
        JOIN "FinisherRoutine" r ON r."id" = v."routineId"
        WHERE s."routineVersionId" = v."id"
          AND r."code" = 'core-stability-10';
      `,
      observed: `
        SELECT min(s."orderIndex")::text || '|' || max(s."orderIndex")::text
        FROM "FinisherRoutineStep" s
        JOIN "FinisherRoutineVersion" v ON v."id" = s."routineVersionId"
        JOIN "FinisherRoutine" r ON r."id" = v."routineId"
        WHERE r."code" = 'core-stability-10';
      `,
      expectedObserved: "100|109",
      restore: `
        UPDATE "FinisherRoutineStep" s
        SET "orderIndex" = s."orderIndex" - 100
        FROM "FinisherRoutineVersion" v
        JOIN "FinisherRoutine" r ON r."id" = v."routineId"
        WHERE s."routineVersionId" = v."id"
          AND r."code" = 'core-stability-10';
      `,
    },
    {
      label: "alternative",
      table: "FinisherRoutineStepAlternative",
      trigger: "FinisherRoutineStepAlternative_immutable",
      mutate: `
        UPDATE "FinisherRoutineStepAlternative"
        SET "orderIndex" = "orderIndex" + 100
        WHERE "id" = (
          SELECT a."id"
          FROM "FinisherRoutineStepAlternative" a
          ORDER BY a."id"
          LIMIT 1
        );
      `,
      observed: `
        SELECT max("orderIndex")::text
        FROM "FinisherRoutineStepAlternative";
      `,
      expectedObserved: "100",
      restore: `
        UPDATE "FinisherRoutineStepAlternative"
        SET "orderIndex" = "orderIndex" - 100
        WHERE "orderIndex" >= 100;
      `,
    },
  ];

  for (const scenario of scenarios) {
    const mutateSql = `
      ALTER TABLE "${scenario.table}" DISABLE TRIGGER "${scenario.trigger}";
      ${scenario.mutate}
      ALTER TABLE "${scenario.table}" ENABLE TRIGGER "${scenario.trigger}";
    `;
    const mutation = spawnSync(
      "docker",
      [
        "exec",
        "-i",
        containerName,
        "psql",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "trainer",
        "-d",
        "trainer",
      ],
      { input: mutateSql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );
    if (mutation.status !== 0) {
      throw new Error(`FINISHER_${scenario.label.toUpperCase()}_ORDER_DRIFT_SETUP_FAILED`);
    }
    const failed = spawnSync(process.execPath, seedCommand, {
      cwd: process.cwd(),
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output = `${failed.stdout ?? ""}\n${failed.stderr ?? ""}`;
    if (
      failed.status === 0 ||
      !output.includes("Immutable finisher routine drift detected")
    ) {
      throw new Error(
        `FINISHER_${scenario.label.toUpperCase()}_ORDER_DRIFT_NOT_REJECTED`,
      );
    }
    const observed = run(
      "docker",
      [
        "exec",
        "-i",
        containerName,
        "psql",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "trainer",
        "-d",
        "trainer",
        "-tAc",
        scenario.observed,
      ],
      process.env,
      true,
    );
    if (observed !== scenario.expectedObserved) {
      throw new Error(
        `FINISHER_${scenario.label.toUpperCase()}_ORDER_DRIFT_WAS_REWRITTEN:${observed}`,
      );
    }
    const restoreSql = `
      ALTER TABLE "${scenario.table}" DISABLE TRIGGER "${scenario.trigger}";
      ${scenario.restore}
      ALTER TABLE "${scenario.table}" ENABLE TRIGGER "${scenario.trigger}";
    `;
    const restore = spawnSync(
      "docker",
      [
        "exec",
        "-i",
        containerName,
        "psql",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "trainer",
        "-d",
        "trainer",
      ],
      { input: restoreSql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );
    if (restore.status !== 0) {
      throw new Error(`FINISHER_${scenario.label.toUpperCase()}_ORDER_DRIFT_RESTORE_FAILED`);
    }
  }
  console.log(
    "Ordinary seed execution rejected step and alternative numeric order drift without rewriting immutable rows.",
  );
}

const invocation = parseExactDisposableConfirmationArgs(process.argv.slice(2));
if (!invocation.valid) {
  console.error(invocation.message);
  process.exit(2);
}

try {
  run("docker", [
    "run", "--rm", "-d", "--name", containerName,
    "-e", "POSTGRES_USER=trainer",
    "-e", "POSTGRES_PASSWORD=trainer-workout-occ",
    "-e", "POSTGRES_DB=trainer",
    "-p", "127.0.0.1::5432",
    "postgres:17-alpine",
  ]);
  waitForPostgres();
  const port = run("docker", ["port", containerName, "5432/tcp"], process.env, true)
    .split(":")
    .at(-1);
  if (!port) throw new Error("DISPOSABLE_POSTGRES_PORT_NOT_FOUND");
  const databaseUrl = `postgresql://trainer:trainer-workout-occ@127.0.0.1:${port}/trainer`;
  const migrationEnv = {
    ...sanitizeDatabaseTargetEnvironment(process.env),
    DATABASE_URL: databaseUrl,
    TEST_DATABASE_URL: databaseUrl,
    DIRECT_URL: databaseUrl,
    TRAINER_DISPOSABLE_DB_CONFIRMED: "1",
  };
  const targetValidation = validateDisposableDatabaseTargets({
    environment: migrationEnv,
    confirmed: true,
  });
  if (!targetValidation.valid) {
    throw new Error(`DISPOSABLE_DATABASE_TARGET_INVALID:${targetValidation.reasons.join("|")}`);
  }
  applyPreFinisherMigrations(migrationEnv);
  psql(`
    INSERT INTO "User" ("id", "email", "createdAt")
    VALUES (
      '00000000-0000-4000-8000-000000000001',
      'pre-finisher@example.test',
      TIMESTAMP '2026-07-27 12:00:00'
    );
    INSERT INTO "Workout" ("id", "userId", "scheduledDate")
    VALUES (
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000001',
      TIMESTAMP '2026-07-27 13:00:00'
    );
  `);
  verifyAtomicFinisherMigrationFailure();
  verifyConflictingFinisherSchemaRejected();
  run(process.execPath, [join(process.cwd(), "node_modules/prisma/build/index.js"), "migrate", "deploy"], migrationEnv);
  run(process.execPath, [join(process.cwd(), "node_modules/prisma/build/index.js"), "migrate", "deploy"], migrationEnv);
  const postMigrationFacts = psqlValue(`
    SELECT concat_ws(
      '|',
      current_setting('server_version_num')::integer / 10000,
      current_user,
      (
        SELECT count(*) FROM pg_catalog.pg_roles
        WHERE rolname IN (
          'trainer_app_runtime',
          'trainer_finisher_owner',
          'trainer_finisher_cleanup'
        )
      ),
      (
        SELECT count(*) FROM "User"
        WHERE "id" = '00000000-0000-4000-8000-000000000001'
          AND "email" = 'pre-finisher@example.test'
      ),
      (
        SELECT count(*) FROM "Workout"
        WHERE "id" = '00000000-0000-4000-8000-000000000002'
          AND "userId" = '00000000-0000-4000-8000-000000000001'
      ),
      (
        SELECT count(*) FROM "_prisma_migrations"
        WHERE migration_name = '20260728120000_add_finishers_phase_1'
          AND finished_at IS NOT NULL
          AND rolled_back_at IS NULL
      )
    )
  `);
  if (postMigrationFacts !== "17|trainer|0|1|1|1") {
    throw new Error(`FINISHER_POST_MIGRATION_FACTS_INVALID:${postMigrationFacts}`);
  }
  console.log(
    "PostgreSQL 17 applied the final migration once, preserved representative data, recorded history, and used the normal application identity without custom roles.",
  );
  run(process.execPath, [
    join(process.cwd(), "node_modules/prisma/build/index.js"),
    "generate",
  ], migrationEnv);
  run(process.execPath, [
    join(process.cwd(), "node_modules/tsx/dist/cli.mjs"),
    "scripts/check-finisher-schema-drift.ts",
  ], migrationEnv);
  const testEnv = {
    ...migrationEnv,
    DATABASE_URL: databaseUrl,
    TEST_DATABASE_URL: databaseUrl,
  };
  run(process.execPath, [
    join(process.cwd(), "node_modules/vitest/vitest.mjs"), "run",
    "src/lib/api/save-workout/persistence.db.test.ts",
    "src/lib/api/finisher-service.db.test.ts",
    "src/lib/api/workout-mutation.db.test.ts",
  ], testEnv);
  run(process.execPath, [
    join(process.cwd(), "node_modules/vitest/vitest.mjs"), "run",
    "src/lib/api/finisher-library-service.db.test.ts",
  ], testEnv);
  run(process.execPath, [
    join(process.cwd(), "node_modules/vitest/vitest.mjs"), "run",
    "src/lib/api/workout-mutation.db.test.ts",
    "-t", "runs the integrated workout lifecycle release gate",
  ], testEnv);
  verifyFinisherSeedOrderDrift(migrationEnv);
} finally {
  spawnSync("docker", ["rm", "-f", containerName], { stdio: "ignore" });
}
