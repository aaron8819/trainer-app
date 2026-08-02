import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { Client } from "pg";
import {
  buildFinisherMigrationReadiness,
  FINISHER_MIGRATION_NAME,
  FINISHER_PRODUCTION_APPLICATION_COMMIT,
  inspectFinisherMigrationIdentity,
} from "@/lib/operations/finisher-migration-readiness";
import {
  buildMigrationIntegrityReport,
  loadCheckedInMigrations,
} from "@/lib/operations/migration-integrity";
import {
  inspectMigrationDatabase,
  readFinisherCatalogRows,
} from "@/lib/operations/migration-integrity-postgres";
import {
  classifyRolloutTarget,
  runWithRolloutEnvironment,
} from "@/lib/operations/rollout-environment";

function fingerprint(connectionString: string): string {
  const hostname = new URL(connectionString).hostname.toLowerCase();
  return createHash("sha256").update(hostname).digest("hex").slice(0, 12);
}

function flag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

function noAmbiguousLedgerState(report: ReturnType<typeof buildMigrationIntegrityReport>): boolean {
  return (
    report.ledger.failed.length === 0 &&
    report.ledger.rolledBack.length === 0 &&
    report.ledger.incomplete.length === 0 &&
    report.ledger.duplicates.length === 0 &&
    report.ledger.unknown.length === 0 &&
    report.ledger.orderViolations.length === 0
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  await runWithRolloutEnvironment(
    {
      argv,
      allowWrite: false,
      requiredVariables: ["DATABASE_URL", "DIRECT_URL"],
    },
    async (environment) => {
      const directUrl = process.env.DIRECT_URL;
      if (!directUrl) {
        throw new Error("The explicitly named environment file must define DIRECT_URL.");
      }
      const targetClass = classifyRolloutTarget(
        directUrl,
        flag(argv, "--confirm-disposable"),
      );
      if (targetClass !== environment.targetClass) {
        throw new Error(
          "DATABASE_URL and DIRECT_URL resolve to different sanitized target classes.",
        );
      }
      if (targetClass === "local") {
        throw new Error(
          "Migration readiness requires a remote target; disposable targets require --confirm-disposable.",
        );
      }

      const targetUrl = new URL(directUrl);
      const target = {
        classification: targetClass,
        fingerprint: fingerprint(directUrl),
        database: targetUrl.pathname.replace(/^\//, ""),
      };
      const checkedIn = loadCheckedInMigrations();
      const migrationIdentity = inspectFinisherMigrationIdentity(
        resolve(process.cwd(), ".."),
      );
      const client = new Client({
        connectionString: directUrl,
        connectionTimeoutMillis: 5_000,
        statement_timeout: 10_000,
      });

      try {
        await client.connect();
        const inspection = await inspectMigrationDatabase(client);
        const finisherCatalogPresent = [
          "FinisherRoutine",
          "FinisherRoutineVersion",
          "FinisherRoutineStep",
          "FinisherRoutineStepAlternative",
        ].every((table) => inspection.catalog.tables.includes(table));
        if (finisherCatalogPresent) {
          await client.query(
            "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
          );
          try {
            inspection.catalog.catalogRows = await readFinisherCatalogRows(client);
            await client.query("COMMIT");
            inspection.catalog.unableToVerify = (
              inspection.catalog.unableToVerify ?? []
            ).filter((label) => label !== "finisherCatalogRows");
          } catch (error) {
            await client.query("ROLLBACK").catch(() => undefined);
            throw error;
          }
        }

        const integrity = buildMigrationIntegrityReport({
          target,
          checkedIn,
          authorizationEvidence: {
            repositoryHead: FINISHER_PRODUCTION_APPLICATION_COMMIT,
            requiredApplicationCommit: FINISHER_PRODUCTION_APPLICATION_COMMIT,
          },
          ...inspection,
        });
        const migrationIntegrityPassed =
          integrity.chain.exactExpectedChain &&
          integrity.migrationChecksumsValid &&
          integrity.migrationOrderValid &&
          integrity.schemaPreflightValid &&
          integrity.dataPreflightValid &&
          integrity.writes === 0;
        const immediatePreflightPassed =
          migrationIntegrityPassed &&
          integrity.chain.exactExpectedPending &&
          integrity.chain.pendingNames.length === 1 &&
          integrity.chain.pendingNames[0] === FINISHER_MIGRATION_NAME &&
          noAmbiguousLedgerState(integrity);
        const postMigrationVerified =
          migrationIntegrityPassed &&
          integrity.chain.applied === integrity.chain.checkedIn &&
          integrity.chain.pending === 0 &&
          finisherCatalogPresent &&
          noAmbiguousLedgerState(integrity);
        if (flag(argv, "--post-migration")) {
          const result = {
            postMigrationVerified,
            executionAuthorized: false as const,
            checkedIn: integrity.chain.checkedIn,
            applied: integrity.chain.applied,
            pending: integrity.chain.pending,
            migrationChecksumsValid: integrity.migrationChecksumsValid,
            migrationOrderValid: integrity.migrationOrderValid,
            schemaPreflightValid: integrity.schemaPreflightValid,
            dataPreflightValid: integrity.dataPreflightValid,
            schemaIntegrity: integrity.schemaIntegrity,
            ledger: integrity.ledger,
            writes: integrity.writes,
          };
          console.log(
            `Finisher post-migration verification: postMigrationVerified=${postMigrationVerified}, ` +
              `executionAuthorized=false, writes=${integrity.writes}.`,
          );
          console.log(JSON.stringify(result, null, 2));
          if (!postMigrationVerified) process.exitCode = 1;
          return;
        }
        const readiness = buildFinisherMigrationReadiness({
          migrationIdentity,
          migrationIntegrityPassed,
          disposableVerificationPassed: flag(
            argv,
            "--confirm-disposable-verification-passed",
          ),
          backupPitrConfirmed: flag(argv, "--confirm-backup-pitr-available"),
          immediatePreflightPassed,
          finishersEnabled: !flag(argv, "--confirm-finishers-disabled"),
          writes: inspection.writes,
        });

        console.log(
          `Finisher migration readiness: migrationReady=${readiness.migrationReady}, ` +
            `executionAuthorized=${readiness.executionAuthorized}, writes=${readiness.writes}.`,
        );
        console.log(
          JSON.stringify(
            {
              readiness,
              preflight: {
                target,
                checkedIn: integrity.chain.checkedIn,
                applied: integrity.chain.applied,
                pending: integrity.chain.pending,
                pendingNames: integrity.chain.pendingNames,
                migrationChecksumsValid: integrity.migrationChecksumsValid,
                migrationOrderValid: integrity.migrationOrderValid,
                schemaPreflightValid: integrity.schemaPreflightValid,
                dataPreflightValid: integrity.dataPreflightValid,
                ledger: integrity.ledger,
                schemaIntegrity: integrity.schemaIntegrity,
              },
            },
            null,
            2,
          ),
        );
        if (!readiness.migrationReady) process.exitCode = 1;
      } finally {
        await client.end().catch(() => undefined);
      }
    },
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  const safeMessage =
    message.startsWith("The explicitly named environment file") ||
    message.startsWith("DATABASE_URL and DIRECT_URL") ||
    message.startsWith("Migration readiness")
      ? message
      : "Migration readiness inspection failed. Run ops:check-direct-db for the sanitized connection classification.";
  console.error(safeMessage);
  process.exitCode = 1;
});
