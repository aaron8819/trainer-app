import {
  DATABASE_TARGET_ENV_VARS,
  parseExactDisposableConfirmationArgs,
  validateDisposableDatabaseTargets,
  type DatabaseTargetEnvironment,
} from "../src/lib/operations/test-environment-preflight";

async function main(): Promise<void> {
  const invocation = parseExactDisposableConfirmationArgs(process.argv.slice(2));
  if (!invocation.valid) {
    console.error(
      `${invocation.message} Run: npm run test:db:readiness-snapshots -- --confirm-disposable`
    );
    process.exitCode = 2;
    return;
  }

  const environment = Object.fromEntries(
    DATABASE_TARGET_ENV_VARS.map((name) => [name, process.env[name]])
  ) as DatabaseTargetEnvironment;
  const targetValidation = validateDisposableDatabaseTargets({
    environment,
    confirmed: true,
    requiredTargets: [],
  });
  if (!targetValidation.valid) {
    console.error("READINESS_DB_TEST_TARGET_INVALID");
    process.exitCode = 1;
    return;
  }

  try {
    const { runReadinessSnapshotPostgresVerification } = await import(
      "./test-readiness-snapshot-postgres-implementation"
    );
    await runReadinessSnapshotPostgresVerification();
  } catch {
    console.error("READINESS_SNAPSHOT_POSTGRES_FAILED");
    process.exitCode = 1;
  }
}

void main();
