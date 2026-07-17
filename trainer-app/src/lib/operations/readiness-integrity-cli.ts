import type { ReadinessIntegrityReport } from "./readiness-integrity";

export function formatReadinessIntegritySummary(report: ReadinessIntegrityReport): string {
  return (
    `Readiness integrity: stage=${report.schemaStage}, total=${report.snapshots.total}, ` +
    `active=${report.snapshots.active}, legacyInvalid=${report.legacy.invalid}, ` +
    `legacyUnknown=${report.legacy.unknown}, exactFailures=${
      report.exact.identityHashFailures.length +
      report.exact.targetHashFailures.length +
      report.exact.payloadHashFailures.length +
      report.exact.identityContractFailures.length +
      report.exact.contractFailures.length
    }, migrationSafe=${report.migrationSafety.readinessMigrationSafe}, ` +
    `writes=${report.writes}, readinessIntegrityReady=${report.readinessIntegrityReady}.`
  );
}

export function sanitizeReadinessIntegrityError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.startsWith("Missing required --env-file") ||
    message.startsWith("The explicitly named environment file") ||
    message.startsWith("Unable to load the explicitly named environment file") ||
    message.startsWith("DATABASE_URL and DIRECT_URL") ||
    message.startsWith("Readiness integrity requires") ||
    message === "--write is not supported by this read-only command."
  ) {
    return message;
  }
  return "Readiness integrity inspection failed. Run ops:check-direct-db for the sanitized connection classification.";
}
