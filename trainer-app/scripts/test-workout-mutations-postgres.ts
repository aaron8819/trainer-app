import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
  sanitizeDatabaseTargetEnvironment,
  validateDisposableDatabaseTargets,
} from "../src/lib/operations/test-environment-preflight";

const containerName = `trainer-workout-occ-${process.pid}-${randomUUID().slice(0, 8)}`;

function run(executable: string, args: string[], env = process.env, quiet = false): string {
  const result = spawnSync(executable, args, {
    cwd: process.cwd(),
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

if (!process.argv.includes("--confirm-disposable")) {
  throw new Error("WORKOUT_MUTATION_DB_TEST_REQUIRES_CONFIRM_DISPOSABLE");
}

try {
  run("docker", [
    "run", "--rm", "-d", "--name", containerName,
    "-e", "POSTGRES_USER=trainer",
    "-e", "POSTGRES_PASSWORD=trainer-workout-occ",
    "-e", "POSTGRES_DB=trainer",
    "-p", "127.0.0.1::5432",
    "postgres:16-alpine",
  ]);
  waitForPostgres();
  const port = run("docker", ["port", containerName, "5432/tcp"], process.env, true)
    .split(":")
    .at(-1);
  if (!port) throw new Error("DISPOSABLE_POSTGRES_PORT_NOT_FOUND");
  const databaseUrl = `postgresql://trainer:trainer-workout-occ@127.0.0.1:${port}/trainer`;
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
    throw new Error(`DISPOSABLE_DATABASE_TARGET_INVALID:${targetValidation.reasons.join("|")}`);
  }
  run(process.execPath, [join(process.cwd(), "node_modules/prisma/build/index.js"), "migrate", "deploy"], env);
  run(process.execPath, [
    join(process.cwd(), "node_modules/prisma/build/index.js"),
    "generate",
  ], env);
  run(process.execPath, [
    join(process.cwd(), "node_modules/vitest/vitest.mjs"), "run",
    "src/lib/api/save-workout/persistence.db.test.ts",
    "src/lib/api/workout-mutation.db.test.ts",
  ], env);
  run(process.execPath, [
    join(process.cwd(), "node_modules/vitest/vitest.mjs"), "run",
    "src/lib/api/workout-mutation.db.test.ts",
    "-t", "runs the integrated workout lifecycle release gate",
  ], env);
} finally {
  spawnSync("docker", ["rm", "-f", containerName], { stdio: "ignore" });
}
