/**
 * Real PostgreSQL coverage for Finisher management and migration behavior.
 * Run only through the explicitly confirmed disposable database harness.
 */
import { describe, it } from "vitest";
import { resolveDisposableDatabaseTestTarget } from "@/lib/operations/test-environment-preflight";

const databaseUrl = resolveDisposableDatabaseTestTarget(process.env);

if (databaseUrl) {
  const { registerFinisherLibraryServiceDatabaseTests } = await import(
    "./finisher-library-service.db-test-implementation"
  );
  registerFinisherLibraryServiceDatabaseTests(databaseUrl);
} else {
  describe.skip("Finisher library service (PostgreSQL)", () => {
    it("requires an explicitly confirmed disposable target", () => undefined);
  });
}
