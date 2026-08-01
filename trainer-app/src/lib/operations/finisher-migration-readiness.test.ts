import { describe, expect, it } from "vitest";
import {
  buildFinisherMigrationReadiness,
  FINISHER_MIGRATION_GIT_BLOB,
  FINISHER_MIGRATION_SHA256,
  FINISHER_PRODUCTION_APPLICATION_COMMIT,
  finisherMigrationRetryAllowed,
  type FinisherMigrationReadinessInput,
} from "./finisher-migration-readiness";

function validInput(): FinisherMigrationReadinessInput {
  return {
    migrationIdentity: {
      applicationCommit: FINISHER_PRODUCTION_APPLICATION_COMMIT,
      gitBlob: FINISHER_MIGRATION_GIT_BLOB,
      sha256: FINISHER_MIGRATION_SHA256,
    },
    migrationIntegrityPassed: true,
    disposableVerificationPassed: true,
    backupPitrConfirmed: true,
    immediatePreflightPassed: true,
    finishersEnabled: false,
    writes: 0,
  };
}

describe("Finisher migration readiness", () => {
  it("recognizes the exact reviewed migration and passes a complete fixture", () => {
    const result = buildFinisherMigrationReadiness(validInput());

    expect(result.migrationReady).toBe(true);
    expect(result.blockingReasons).toEqual([]);
    expect(result.executionAuthorized).toBe(false);
    expect(result.writes).toBe(0);
  });

  it("fails closed when the reviewed migration bytes change", () => {
    const input = validInput();
    input.migrationIdentity.sha256 = "0".repeat(64);

    expect(buildFinisherMigrationReadiness(input).blockingReasons).toContain(
      "reviewed_migration_identity_mismatch",
    );
  });

  it.each([
    ["disposableVerificationPassed", "disposable_verification_missing_or_failed"],
    ["backupPitrConfirmed", "backup_pitr_confirmation_missing"],
    ["immediatePreflightPassed", "immediate_preflight_failed"],
  ] as const)("blocks when %s is false", (field, reason) => {
    const input = validInput();
    input[field] = false;

    const result = buildFinisherMigrationReadiness(input);
    expect(result.migrationReady).toBe(false);
    expect(result.blockingReasons).toContain(reason);
  });

  it("blocks while Finishers are enabled", () => {
    const input = validInput();
    input.finishersEnabled = true;

    expect(buildFinisherMigrationReadiness(input).blockingReasons).toContain(
      "finishers_must_remain_disabled",
    );
  });

  it("is read-only and never authorizes execution", () => {
    const input = validInput();
    input.writes = 1;

    const result = buildFinisherMigrationReadiness(input);
    expect(result.migrationReady).toBe(false);
    expect(result.executionAuthorized).toBe(false);
    expect(result.blockingReasons).toContain("readiness_writes_detected");
  });
});

describe("ambiguous Finisher migration execution", () => {
  it("requires history and schema reconciliation before retry", () => {
    expect(
      finisherMigrationRetryAllowed({
        resultWasAmbiguous: true,
        migrationHistoryReconciled: false,
        schemaReconciled: true,
        migrationAlreadyApplied: false,
      }),
    ).toBe(false);
    expect(
      finisherMigrationRetryAllowed({
        resultWasAmbiguous: true,
        migrationHistoryReconciled: true,
        schemaReconciled: false,
        migrationAlreadyApplied: false,
      }),
    ).toBe(false);
    expect(
      finisherMigrationRetryAllowed({
        resultWasAmbiguous: true,
        migrationHistoryReconciled: true,
        schemaReconciled: true,
        migrationAlreadyApplied: true,
      }),
    ).toBe(false);
    expect(
      finisherMigrationRetryAllowed({
        resultWasAmbiguous: true,
        migrationHistoryReconciled: true,
        schemaReconciled: true,
        migrationAlreadyApplied: false,
      }),
    ).toBe(true);
  });
});
