import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

export const FINISHER_MIGRATION_NAME =
  "20260728120000_add_finishers_phase_1" as const;
export const FINISHER_MIGRATION_PATH =
  "trainer-app/prisma/migrations/20260728120000_add_finishers_phase_1/migration.sql" as const;
export const FINISHER_MIGRATION_GIT_BLOB =
  "55985a32851d9de042b43db3880b5cb857373313" as const;
export const FINISHER_MIGRATION_SHA256 =
  "491bd022e0f5478cf80f805c64b0cf46c03d301ae4c34779c09f9f111823eb43" as const;
export const FINISHER_PRODUCTION_APPLICATION_COMMIT =
  "014b6dce5f1872b1b4d66af508a03e23f6a540e0" as const;

export type FinisherMigrationIdentity = {
  applicationCommit: string;
  gitBlob: string;
  sha256: string;
};

export function inspectFinisherMigrationIdentity(
  repositoryRoot: string,
): FinisherMigrationIdentity {
  const gitBlob = execFileSync(
    "git",
    ["rev-parse", `HEAD:${FINISHER_MIGRATION_PATH}`],
    { cwd: repositoryRoot, encoding: "utf8" },
  ).trim();
  const migrationBytes = execFileSync("git", ["cat-file", "blob", gitBlob], {
    cwd: repositoryRoot,
    encoding: null,
  });
  return {
    applicationCommit: FINISHER_PRODUCTION_APPLICATION_COMMIT,
    gitBlob,
    sha256: createHash("sha256").update(migrationBytes).digest("hex"),
  };
}

export function finisherMigrationIdentityMatches(
  identity: FinisherMigrationIdentity,
): boolean {
  return (
    identity.applicationCommit === FINISHER_PRODUCTION_APPLICATION_COMMIT &&
    identity.gitBlob === FINISHER_MIGRATION_GIT_BLOB &&
    identity.sha256 === FINISHER_MIGRATION_SHA256
  );
}

export type FinisherMigrationReadinessInput = {
  migrationIdentity: FinisherMigrationIdentity;
  migrationIntegrityPassed: boolean;
  disposableVerificationPassed: boolean;
  backupPitrConfirmed: boolean;
  immediatePreflightPassed: boolean;
  finishersEnabled: boolean;
  writes: number;
};

export function buildFinisherMigrationReadiness(
  input: FinisherMigrationReadinessInput,
) {
  const blockingReasons: string[] = [];
  if (!finisherMigrationIdentityMatches(input.migrationIdentity)) {
    blockingReasons.push("reviewed_migration_identity_mismatch");
  }
  if (!input.migrationIntegrityPassed) {
    blockingReasons.push("migration_integrity_failed");
  }
  if (!input.disposableVerificationPassed) {
    blockingReasons.push("disposable_verification_missing_or_failed");
  }
  if (!input.backupPitrConfirmed) {
    blockingReasons.push("backup_pitr_confirmation_missing");
  }
  if (!input.immediatePreflightPassed) {
    blockingReasons.push("immediate_preflight_failed");
  }
  if (input.finishersEnabled) {
    blockingReasons.push("finishers_must_remain_disabled");
  }
  if (input.writes !== 0) {
    blockingReasons.push("readiness_writes_detected");
  }

  return {
    migrationReady: blockingReasons.length === 0,
    executionAuthorized: false as const,
    blockingReasons,
    migration: {
      name: FINISHER_MIGRATION_NAME,
      path: FINISHER_MIGRATION_PATH,
      applicationCommit: input.migrationIdentity.applicationCommit,
      gitBlob: input.migrationIdentity.gitBlob,
      sha256: input.migrationIdentity.sha256,
    },
    safeguards: {
      migrationIntegrityPassed: input.migrationIntegrityPassed,
      disposableVerificationPassed: input.disposableVerificationPassed,
      backupPitrConfirmed: input.backupPitrConfirmed,
      immediatePreflightPassed: input.immediatePreflightPassed,
      finishersDisabled: !input.finishersEnabled,
      readOnly: input.writes === 0,
    },
    writes: input.writes,
  };
}

export function finisherMigrationRetryAllowed(input: {
  resultWasAmbiguous: boolean;
  migrationHistoryReconciled: boolean;
  schemaReconciled: boolean;
  migrationAlreadyApplied: boolean;
}): boolean {
  if (!input.resultWasAmbiguous) return true;
  return (
    input.migrationHistoryReconciled &&
    input.schemaReconciled &&
    !input.migrationAlreadyApplied
  );
}
