/**
 * Real PostgreSQL coverage for the save-workout compare-and-swap boundary.
 * Run only through the explicitly confirmed disposable database harness.
 */
import { describe, it } from "vitest";
import { resolveDisposableDatabaseTestTarget } from "@/lib/operations/test-environment-preflight";

const databaseUrl = resolveDisposableDatabaseTestTarget(process.env);

if (databaseUrl) {
  const { registerPersistenceDatabaseTests } = await import(
    "./persistence.db-test-implementation"
  );
  registerPersistenceDatabaseTests(databaseUrl);
} else {
  describe.skip("save-workout persistence CAS (PostgreSQL)", () => {
    it("requires an explicitly confirmed disposable target", () => undefined);
  });
}
