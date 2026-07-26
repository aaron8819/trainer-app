/** PostgreSQL-only constraint/concurrency coverage. Run through test:db:multi-plan. */
import { resolveDisposableDatabaseTestTarget } from "@/lib/operations/test-environment-preflight";

const databaseUrl = resolveDisposableDatabaseTestTarget(process.env);

if (databaseUrl) {
  const { registerActivePlanContextDatabaseTests } = await import(
    "./active-plan-context.db-test-implementation"
  );
  registerActivePlanContextDatabaseTests(databaseUrl);
} else {
  throw new Error("DATABASE_TEST_TARGET_NOT_CONFIGURED");
}
