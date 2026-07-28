/**
 * Real PostgreSQL coverage for database-side Finisher invariants.
 * Run only through the explicitly confirmed disposable database harness.
 */
import { describe, it } from "vitest";
import { resolveDisposableDatabaseTestTarget } from "@/lib/operations/test-environment-preflight";

const databaseUrl = resolveDisposableDatabaseTestTarget(process.env);

if (databaseUrl) {
  const { registerFinisherServiceDatabaseTests } = await import(
    "./finisher-service.db-test-implementation"
  );
  registerFinisherServiceDatabaseTests(databaseUrl);
} else {
  describe.skip("Finisher service (PostgreSQL)", () => {
    it("requires an explicitly confirmed disposable target", () => undefined);
  });
}
