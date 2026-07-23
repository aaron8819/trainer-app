/** PostgreSQL-only concurrency coverage. Run through test:db:workout-mutations. */
import { resolveDisposableDatabaseTestTarget } from "@/lib/operations/test-environment-preflight";

const databaseUrl = resolveDisposableDatabaseTestTarget(process.env);

if (databaseUrl) {
  const { registerWorkoutMutationDatabaseTests } = await import(
    "./workout-mutation.db-test-implementation"
  );
  registerWorkoutMutationDatabaseTests(databaseUrl);
} else {
  throw new Error("DATABASE_TEST_TARGET_NOT_CONFIGURED");
}
