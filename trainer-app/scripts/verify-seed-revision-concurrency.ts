import {
  DATABASE_TARGET_ENV_VARS,
  parseExactDisposableConfirmationArgs,
  validateDisposableDatabaseTargets,
  type DatabaseTargetEnvironment,
} from "@/lib/operations/test-environment-preflight";

async function main(): Promise<void> {
  const invocation = parseExactDisposableConfirmationArgs(process.argv.slice(2));
  if (!invocation.valid) {
    console.error(invocation.message);
    process.exitCode = 2;
    return;
  }

  const environment = Object.fromEntries(
    DATABASE_TARGET_ENV_VARS.map((name) => [name, process.env[name]])
  ) as DatabaseTargetEnvironment;
  const targetValidation = validateDisposableDatabaseTargets({
    environment,
    confirmed: true,
    requiredTargets: ["DATABASE_URL"],
    matchingTargetPairs: [],
  });
  if (!targetValidation.valid) {
    console.error(
      "SEED_REVISION_CONCURRENCY_REQUIRES_CONFIRMED_LOCAL_DISPOSABLE_DB"
    );
    process.exitCode = 1;
    return;
  }

  const {
    closeSeedRevisionConcurrencyVerification,
    runSeedRevisionConcurrencyVerification,
  } = await import("./verify-seed-revision-concurrency-implementation");
  try {
    await runSeedRevisionConcurrencyVerification();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await closeSeedRevisionConcurrencyVerification();
  }
}

void main();
