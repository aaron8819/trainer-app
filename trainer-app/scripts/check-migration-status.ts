import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";
import {
  buildMigrationIntegrityReport,
  loadCheckedInMigrations,
  type CanonicalOperationalVerification,
  type LiveFinisherPrincipalVerification,
  type MigrationAuthorizationEvidence,
} from "@/lib/operations/migration-integrity";
import {
  FINISHER_PRINCIPAL_AUDIT_SCHEMA,
  FINISHER_PRINCIPAL_AUDIT_VERSION,
  FINISHER_RUNTIME_PASSWORD_VARIABLE,
  FINISHER_TARGET_MIGRATION,
  projectFingerprint,
  type FinisherPrincipalAuditRecord,
} from "@/lib/operations/finisher-principal-contract";
import {
  inspectFinisherPrincipals,
  verifyRuntimeCredentialReadOnly,
} from "@/lib/operations/finisher-principal-postgres";
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

function readArgument(argv: string[], name: string): string | undefined {
  const inline = argv.find((argument) => argument.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1) || undefined;
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

function requiredArgument(argv: string[], name: string): string {
  const value = readArgument(argv, name);
  if (!value) throw new Error(`Missing required ${name} <value>.`);
  return value;
}

function loadAuditInput(argv: string[]): MigrationAuthorizationEvidence {
  const evidencePath = readArgument(argv, "--evidence-file");
  const supplied = evidencePath
    ? (JSON.parse(
        readFileSync(resolve(evidencePath), "utf8"),
      ) as Partial<MigrationAuthorizationEvidence>)
    : {};
  if (supplied == null || typeof supplied !== "object" || Array.isArray(supplied)) {
    throw new Error("Migration audit input must be a JSON object.");
  }
  for (const forbidden of [
    "expectedPendingMigrations",
    "finisherPrincipals",
    "productionDeploymentCommit",
    "requiredApplicationCommit",
    "recoveryPoint",
    "writeBoundary",
    "deploymentVerifiedAt",
  ]) {
    if (!(forbidden in supplied)) continue;
    throw new Error(
      `Migration audit input cannot supply authoritative ${forbidden} state.`,
    );
  }
  const repositoryHead = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  return {
    ...supplied,
    repositoryHead,
    requiredApplicationCommit: requiredArgument(
      argv,
      "--required-application-commit",
    ),
    evaluatedAt: new Date().toISOString(),
  };
}

function loadPrincipalAuditRecord(
  argv: string[],
): FinisherPrincipalAuditRecord | undefined {
  if (readArgument(argv, "--principal-evidence-file")) {
    throw new Error(
      "--principal-evidence-file is no longer authoritative; use --principal-audit-file only for retained audit context.",
    );
  }
  const evidencePath = readArgument(argv, "--principal-audit-file");
  if (!evidencePath) return undefined;
  try {
    const value = JSON.parse(
      readFileSync(resolve(evidencePath), "utf8"),
    ) as FinisherPrincipalAuditRecord;
    if (
      value.schema !== FINISHER_PRINCIPAL_AUDIT_SCHEMA ||
      value.version !== FINISHER_PRINCIPAL_AUDIT_VERSION ||
      value.authority !== "sanitized_audit_record_only"
    ) {
      throw new Error("invalid audit record");
    }
    return value;
  } catch {
    throw new Error("Finisher principal audit record is malformed.");
  }
}

function operationalVerification(options: {
  targetClass: "disposable" | "remote";
  verifiedAt: string;
  repositoryHead: string;
  requiredApplicationCommit: string;
  targetFingerprint: string;
  projectFingerprint?: string;
  database: string;
}): CanonicalOperationalVerification {
  if (options.targetClass === "disposable") {
    return {
      source: "canonical_live_operational_verification",
      verifiedAt: options.verifiedAt,
      repositoryHead: options.repositoryHead,
      requiredApplicationCommit: options.requiredApplicationCommit,
      targetFingerprint: options.targetFingerprint,
      projectFingerprint: options.projectFingerprint,
      database: options.database,
      deployment: {
        verified: true,
        commit: options.repositoryHead,
        identity: "disposable-not-applicable",
        source: "disposable_not_applicable",
      },
      recoveryPoint: {
        verified: true,
        identity: "disposable-not-applicable",
        source: "disposable_not_applicable",
      },
      writePause: {
        verified: true,
        identity: "disposable-not-applicable",
        source: "disposable_not_applicable",
      },
      applicationCompatibilityState: "compatible_with_write_boundary",
    };
  }
  return {
    source: "canonical_live_operational_verification",
    verifiedAt: options.verifiedAt,
    repositoryHead: options.repositoryHead,
    requiredApplicationCommit: options.requiredApplicationCommit,
    targetFingerprint: options.targetFingerprint,
    projectFingerprint: options.projectFingerprint,
    database: options.database,
    deployment: {
      verified: false,
      commit: "",
      identity: "unavailable",
      source: "unavailable",
    },
    recoveryPoint: {
      verified: false,
      identity: "unavailable",
      source: "unavailable",
    },
    writePause: {
      verified: false,
      identity: "unavailable",
      source: "unavailable",
    },
    applicationCompatibilityState: "unverified",
  };
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
        throw new Error(
          "The explicitly named environment file must define DIRECT_URL.",
        );
      }
      const directTargetClass = classifyRolloutTarget(
        directUrl,
        argv.includes("--confirm-disposable"),
      );
      if (directTargetClass !== environment.targetClass) {
        throw new Error(
          "DATABASE_URL and DIRECT_URL resolve to different sanitized target classes.",
        );
      }
      if (directTargetClass === "local") {
        throw new Error(
          "Gate A migration integrity requires a remote target; disposable targets are allowed only with --confirm-disposable.",
        );
      }

      const directTarget = new URL(directUrl);
      const database = directTarget.pathname.replace(/^\//, "");
      const projectReference =
        /^db\.([a-z0-9]{20})\.supabase\.co$/i.exec(
          directTarget.hostname,
        )?.[1] ?? (directTargetClass === "disposable" ? "disposable" : "");
      const target = {
        classification: directTargetClass,
        fingerprint: fingerprint(directUrl),
        projectFingerprint: projectReference
          ? projectFingerprint(projectReference)
          : undefined,
        database,
      };
      const auditInput = loadAuditInput(argv);
      const principalAuditRecord = loadPrincipalAuditRecord(argv);
      const runtimePassword = process.env[FINISHER_RUNTIME_PASSWORD_VARIABLE];

      const client = new Client({
        connectionString: directUrl,
        connectionTimeoutMillis: 5_000,
        statement_timeout: 10_000,
      });
      try {
        await client.connect();
        const inspection = await inspectMigrationDatabase(client);
        const credentialVerified = runtimePassword
          ? await verifyRuntimeCredentialReadOnly({
              directUrl,
              expectedDatabase: database,
              password: runtimePassword,
            })
          : false;
        const targetMigrationApplied = inspection.ledgerRows.some(
          (row) =>
            row.migrationName === FINISHER_TARGET_MIGRATION &&
            row.finishedAt !== null &&
            row.rolledBackAt === null &&
            !row.logs?.trim(),
        );
        const finisherCatalogTablesPresent = [
          "FinisherRoutine",
          "FinisherRoutineVersion",
          "FinisherRoutineStep",
          "FinisherRoutineStepAlternative",
        ].every((table) => inspection.catalog.tables.includes(table));
        if (finisherCatalogTablesPresent && runtimePassword && credentialVerified) {
          const runtimeUrl = new URL(directUrl);
          runtimeUrl.username = "trainer_app_runtime";
          runtimeUrl.password = runtimePassword;
          const runtimeClient = new Client({
            connectionString: runtimeUrl.toString(),
            connectionTimeoutMillis: 5_000,
            statement_timeout: 10_000,
          });
          try {
            await runtimeClient.connect();
            await runtimeClient.query(
              "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
            );
            inspection.catalog.catalogRows =
              await readFinisherCatalogRows(runtimeClient);
            await runtimeClient.query("COMMIT");
            inspection.catalog.unableToVerify = (
              inspection.catalog.unableToVerify ?? []
            ).filter((label) => label !== "finisherCatalogRows");
          } finally {
            await runtimeClient.end().catch(() => undefined);
          }
        }
        const snapshot = await inspectFinisherPrincipals(client, {
          phase: targetMigrationApplied ? "terminal" : "migration_capable",
          runtimeCredentialVerified: credentialVerified,
        });
        const verifiedAt = new Date().toISOString();
        const livePrincipal: LiveFinisherPrincipalVerification = {
          source: "fresh_live_database_verification",
          verifiedAt,
          repositoryHead: auditInput.repositoryHead,
          requiredApplicationCommit: auditInput.requiredApplicationCommit ?? "",
          targetMigration: FINISHER_TARGET_MIGRATION,
          targetFingerprint: target.fingerprint,
          projectFingerprint: target.projectFingerprint,
          database,
          credentialProof: credentialVerified
            ? "bounded_runtime_authentication"
            : "unavailable",
          readOnlyTransaction: true,
          databaseWrites: 0,
          snapshot,
        };
        const report = buildMigrationIntegrityReport({
          target,
          checkedIn: loadCheckedInMigrations(),
          authorizationEvidence: auditInput,
          finisherPrincipalLiveVerification: livePrincipal,
          finisherPrincipalAuditRecord: principalAuditRecord,
          operationalVerification: operationalVerification({
            targetClass: directTargetClass,
            verifiedAt,
            repositoryHead: auditInput.repositoryHead,
            requiredApplicationCommit:
              auditInput.requiredApplicationCommit ?? "",
            targetFingerprint: target.fingerprint,
            projectFingerprint: target.projectFingerprint,
            database,
          }),
          ...inspection,
        });
        console.log(
          `Migration integrity: checkedIn=${report.chain.checkedIn}, applied=${report.chain.applied}, ` +
            `pending=${report.chain.pending}, incomplete=${report.ledger.incomplete.length}, ` +
            `orderViolations=${report.ledger.orderViolations.length}, checksumsMatched=${report.checksums.matched}, ` +
            `semanticDriftBlocking=${report.schemaIntegrity.semanticDriftBlocking}, ` +
            `representationWarnings=${report.schemaIntegrity.representationWarningCount}, ` +
            `technicalMigrationReady=${report.technicalMigrationReady}, ` +
            `migrationAuthorizationReady=${report.migrationAuthorizationReady}, ` +
            `executionAuthorized=${report.executionAuthorized}.`,
        );
        console.log(JSON.stringify(report, null, 2));
        if (
          (!report.migrationAuthorizationReady && report.chain.gateAApplicable) ||
          !report.migrationChecksumsValid ||
          !report.migrationOrderValid ||
          !report.schemaPreflightValid ||
          !report.dataPreflightValid
        ) {
          process.exitCode = 1;
        }
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
    message.startsWith("Gate A migration integrity") ||
    message.startsWith("Migration audit input") ||
    message.startsWith("Finisher principal") ||
    message.startsWith("--principal-evidence-file") ||
    message.startsWith("TRAINER_APP_RUNTIME_PASSWORD") ||
    message.startsWith("FINISHER_PRINCIPAL_") ||
    message.startsWith("Missing required")
      ? message
      : "Migration integrity inspection failed. Run ops:check-direct-db for the sanitized connection classification.";
  console.error(safeMessage);
  process.exitCode = 1;
});
