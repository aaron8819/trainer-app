import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  parseExactDisposableConfirmationArgs,
  sanitizeDatabaseTargetEnvironment,
  validateDisposableDatabaseTargets,
} from "../src/lib/operations/test-environment-preflight";

const containerName = `trainer-multi-plan-${process.pid}-${randomUUID().slice(0, 8)}`;
const successDatabase = "trainer_success";
const ambiguousDatabase = "trainer_ambiguous";
const targetMigration = "20260726120000_add_active_macrocycle_foundation";

type CommandResult = {
  status: number;
  stdout: string;
  stderr: string;
};

function command(
  executable: string,
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    input?: string;
    quiet?: boolean;
  } = {},
): CommandResult {
  const result = spawnSync(executable, args, {
    cwd: process.cwd(),
    env: options.env ?? process.env,
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

function requireSuccess(result: CommandResult, label: string): string {
  if (result.status !== 0) {
    throw new Error(
      `${label} failed status=${result.status}\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result.stdout.trim();
}

function run(
  executable: string,
  args: string[],
  env = process.env,
  quiet = false,
): string {
  return requireSuccess(
    command(executable, args, { env, quiet }),
    `${executable} ${args.join(" ")}`,
  );
}

function waitForPostgres(): void {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = command(
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
      { quiet: true },
    );
    if (result.status === 0) return;
    const until = Date.now() + 500;
    while (Date.now() < until) {
      // Bounded polling for an isolated local test container.
    }
  }
  throw new Error("DISPOSABLE_POSTGRES_DID_NOT_BECOME_READY");
}

function psql(
  database: string,
  sql: string,
  options: { expectFailure?: boolean; tuplesOnly?: boolean } = {},
): string {
  const args = [
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
  ];
  if (options.tuplesOnly) args.push("-tA");
  const result = command("docker", args, { input: sql, quiet: true });
  if (options.expectFailure) {
    if (result.status === 0) {
      throw new Error("Expected disposable PostgreSQL statement to fail");
    }
    return `${result.stdout}\n${result.stderr}`;
  }
  return requireSuccess(result, `psql ${database}`);
}

function migrationNames(): string[] {
  return readdirSync(join(process.cwd(), "prisma", "migrations"), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function applyMigrations(database: string, names: string[]): void {
  for (const name of names) {
    psql(
      database,
      readFileSync(
        join(process.cwd(), "prisma", "migrations", name, "migration.sql"),
        "utf8",
      ),
    );
  }
}

function insertOwner(
  database: string,
  input: {
    ownerId: string;
    email: string;
    macros: Array<{ macroId: string; mesocycleId: string; active: boolean }>;
  },
): void {
  psql(
    database,
    `
      INSERT INTO "User" ("id", "email")
      VALUES ('${input.ownerId}', '${input.email}');

      ${input.macros
        .map(
          (entry, index) => `
            INSERT INTO "MacroCycle" (
              "id", "userId", "startDate", "endDate", "durationWeeks",
              "trainingAge", "primaryGoal", "updatedAt"
            ) VALUES (
              '${entry.macroId}', '${input.ownerId}', '2026-01-01',
              '2026-12-31', 52, 'INTERMEDIATE', 'HYPERTROPHY', CURRENT_TIMESTAMP
            );
            INSERT INTO "Mesocycle" (
              "id", "macroCycleId", "mesoNumber", "startWeek",
              "durationWeeks", "focus", "volumeTarget", "intensityBias",
              "isActive"
            ) VALUES (
              '${entry.mesocycleId}', '${entry.macroId}', ${index + 1}, 0,
              6, 'Disposable fixture', 'MODERATE', 'HYPERTROPHY',
              ${entry.active ? "TRUE" : "FALSE"}
            );
          `,
        )
        .join("\n")}
    `,
  );
}

const invocation = parseExactDisposableConfirmationArgs(process.argv.slice(2));
if (!invocation.valid) {
  console.error(invocation.message);
  process.exit(2);
}

try {
  run(
    "docker",
    [
      "run",
      "--rm",
      "-d",
      "--name",
      containerName,
      "-e",
      "POSTGRES_USER=trainer",
      "-e",
      "POSTGRES_PASSWORD=trainer-multi-plan",
      "-e",
      "POSTGRES_DB=trainer",
      "-p",
      "127.0.0.1::5432",
      "postgres:16-alpine",
    ],
    process.env,
    true,
  );
  waitForPostgres();
  const port = run(
    "docker",
    ["port", containerName, "5432/tcp"],
    process.env,
    true,
  )
    .split(":")
    .at(-1);
  if (!port) throw new Error("DISPOSABLE_POSTGRES_PORT_NOT_FOUND");

  psql("trainer", `CREATE DATABASE ${successDatabase};`);
  psql("trainer", `CREATE DATABASE ${ambiguousDatabase};`);
  const migrations = migrationNames();
  const targetIndex = migrations.indexOf(targetMigration);
  if (targetIndex !== migrations.length - 1 || targetIndex < 1) {
    throw new Error("MULTI_PLAN_TARGET_MIGRATION_ORDER_INVALID");
  }
  const priorMigrations = migrations.slice(0, targetIndex);
  applyMigrations(successDatabase, priorMigrations);
  applyMigrations(ambiguousDatabase, priorMigrations);

  insertOwner(successDatabase, {
    ownerId: "owner-one",
    email: "one@example.test",
    macros: [
      {
        macroId: "macro-one",
        mesocycleId: "mesocycle-one",
        active: true,
      },
    ],
  });
  insertOwner(successDatabase, {
    ownerId: "owner-zero",
    email: "zero@example.test",
    macros: [],
  });
  applyMigrations(successDatabase, [targetMigration]);

  const successShape = psql(
    successDatabase,
    `
      SELECT concat_ws('|',
        (SELECT "activeMacroCycleId" FROM "User" WHERE "id" = 'owner-one'),
        (SELECT ("activeMacroCycleId" IS NULL)::text FROM "User" WHERE "id" = 'owner-zero'),
        (SELECT count(*) FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = 'Mesocycle_one_active_per_macrocycle'
            AND indexdef LIKE '%UNIQUE%'
            AND indexdef LIKE '%WHERE ("isActive" = true)%'),
        (SELECT count(*) FROM pg_constraint
          WHERE conname = 'User_activeMacroCycleId_key' AND contype = 'u'),
        (SELECT count(*) FROM pg_constraint
          WHERE conname = 'User_activeMacroCycleId_fkey' AND contype = 'f'),
        (SELECT count(*) FROM pg_constraint
          WHERE conname = 'Mesocycle_active_state_check' AND contype = 'c')
      );
    `,
    { tuplesOnly: true },
  ).trim();
  if (successShape !== "macro-one|true|1|1|1|1") {
    throw new Error(`MULTI_PLAN_SUCCESS_SHAPE_INVALID:${successShape}`);
  }

  const oldHandoffOrderingFailure = psql(
    successDatabase,
    `
      INSERT INTO "Mesocycle" (
        "id", "macroCycleId", "mesoNumber", "startWeek", "durationWeeks",
        "focus", "volumeTarget", "intensityBias", "isActive"
      ) VALUES (
        'old-app-successor', 'macro-one', 2, 6, 6, 'Old app successor',
        'MODERATE', 'HYPERTROPHY', TRUE
      );
    `,
    { expectFailure: true },
  );
  if (!/Mesocycle_one_active_per_macrocycle/i.test(oldHandoffOrderingFailure)) {
    throw new Error("OLD_APP_HANDOFF_ORDERING_RISK_NOT_PROVEN");
  }
  psql(
    successDatabase,
    `
      UPDATE "Mesocycle"
      SET "state" = 'AWAITING_HANDOFF', "isActive" = FALSE
      WHERE "id" = 'mesocycle-one';
    `,
  );

  insertOwner(ambiguousDatabase, {
    ownerId: "owner-ambiguous",
    email: "ambiguous@example.test",
    macros: [
      {
        macroId: "macro-ambiguous-a",
        mesocycleId: "mesocycle-ambiguous-a",
        active: true,
      },
      {
        macroId: "macro-ambiguous-b",
        mesocycleId: "mesocycle-ambiguous-b",
        active: true,
      },
    ],
  });
  const ambiguityFailure = psql(
    ambiguousDatabase,
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
    { expectFailure: true },
  );
  if (!/MULTI_PLAN_PREFLIGHT_REQUIRED/i.test(ambiguityFailure)) {
    throw new Error("MULTI_PLAN_AMBIGUITY_DID_NOT_ABORT");
  }
  const columnAfterAbort = psql(
    ambiguousDatabase,
    `
      SELECT count(*)
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'User'
        AND column_name = 'activeMacroCycleId';
    `,
    { tuplesOnly: true },
  ).trim();
  if (columnAfterAbort !== "0") {
    throw new Error("MULTI_PLAN_AMBIGUITY_DID_NOT_ROLL_BACK");
  }

  const databaseUrl = `postgresql://trainer:trainer-multi-plan@127.0.0.1:${port}/${successDatabase}`;
  const env = {
    ...sanitizeDatabaseTargetEnvironment(process.env),
    DATABASE_URL: databaseUrl,
    TEST_DATABASE_URL: databaseUrl,
    DIRECT_URL: databaseUrl,
    TRAINER_DISPOSABLE_DB_CONFIRMED: "1",
  };
  const targetValidation = validateDisposableDatabaseTargets({
    environment: env,
    confirmed: true,
  });
  if (!targetValidation.valid) {
    throw new Error(
      `DISPOSABLE_DATABASE_TARGET_INVALID:${targetValidation.reasons.join("|")}`,
    );
  }
  run(
    process.execPath,
    [join(process.cwd(), "node_modules/prisma/build/index.js"), "generate"],
    env,
  );
  run(
    process.execPath,
    [
      join(process.cwd(), "node_modules/vitest/vitest.mjs"),
      "run",
      "src/lib/api/active-plan-context.db.test.ts",
    ],
    env,
  );
  console.log(
    JSON.stringify({
      result: "passed",
      postgres: 16,
      priorMigrationCount: priorMigrations.length,
      targetMigration,
      exactCandidateBackfill: "passed",
      zeroCandidateRemainsNull: "passed",
      ambiguityRollback: "passed",
      targetSchemaObjects: "passed",
      oldApplicationCompatibility: {
        ordinaryLifecycleUpdate: "passed",
        handoffSuccessorCreateBeforeDeactivate: "blocked_by_partial_unique_index",
        safeOnlyWithWriteBoundary: true,
      },
      cleanup: "container removal scheduled",
    }),
  );
} finally {
  spawnSync("docker", ["rm", "-f", containerName], { stdio: "ignore" });
}
