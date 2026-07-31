import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";
import {
  buildMigrationIntegrityReport,
  loadCheckedInMigrations,
  type MigrationAuthorizationEvidence,
} from "@/lib/operations/migration-integrity";
import {
  FINISHER_PRINCIPAL_EVIDENCE_KEY_VARIABLE,
  parsePrincipalVerificationEvidence,
  projectFingerprint,
  type FinisherPrincipalVerificationEvidence,
} from "@/lib/operations/finisher-principal-contract";
import { inspectMigrationDatabase } from "@/lib/operations/migration-integrity-postgres";
import {
  classifyRolloutTarget,
  runWithRolloutEnvironment,
} from "@/lib/operations/rollout-environment";

function fingerprint(connectionString: string): string {
  const hostname = new URL(connectionString).hostname.toLowerCase();
  return createHash("sha256").update(hostname).digest("hex").slice(0, 12);
}

function loadAuthorizationEvidence(
  argv: string[],
): MigrationAuthorizationEvidence {
  const evidenceFlagIndex = argv.indexOf("--evidence-file");
  const evidencePath =
    evidenceFlagIndex >= 0 ? argv[evidenceFlagIndex + 1] : undefined;
  const supplied = evidencePath
    ? (JSON.parse(
        readFileSync(resolve(evidencePath), "utf8"),
      ) as Partial<MigrationAuthorizationEvidence>)
    : {};
  if (supplied == null || typeof supplied !== "object" || Array.isArray(supplied)) {
    throw new Error("Migration authorization evidence must be a JSON object.");
  }
  if ("expectedPendingMigrations" in supplied) {
    throw new Error(
      "Migration authorization evidence cannot define repository migration policy.",
    );
  }
  if ("finisherPrincipals" in supplied) {
    throw new Error(
      "Finisher principal claims must come from --principal-evidence-file.",
    );
  }
  const repositoryHead = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  return {
    productionDeploymentCommit: "",
    ...supplied,
    repositoryHead,
    evaluatedAt: new Date().toISOString(),
  };
}

function loadPrincipalEvidence(
  argv: string[],
): FinisherPrincipalVerificationEvidence | undefined {
  const flagIndex = argv.indexOf("--principal-evidence-file");
  const evidencePath = flagIndex >= 0 ? argv[flagIndex + 1] : undefined;
  if (!evidencePath) return undefined;
  try {
    return parsePrincipalVerificationEvidence(
      JSON.parse(readFileSync(resolve(evidencePath), "utf8")) as unknown,
    );
  } catch {
    throw new Error("Finisher principal evidence is malformed.");
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  await runWithRolloutEnvironment(
    {
      argv,
      allowWrite: false,
      requiredVariables: [
        "DATABASE_URL",
        "DIRECT_URL",
        FINISHER_PRINCIPAL_EVIDENCE_KEY_VARIABLE,
      ],
    },
    async (environment) => {
      const directUrl = process.env.DIRECT_URL;
      if (!directUrl) throw new Error("The explicitly named environment file must define DIRECT_URL.");
      const directTargetClass = classifyRolloutTarget(directUrl, argv.includes("--confirm-disposable"));
      if (directTargetClass !== environment.targetClass) {
        throw new Error("DATABASE_URL and DIRECT_URL resolve to different sanitized target classes.");
      }
      if (directTargetClass === "local") {
        throw new Error("Gate A migration integrity requires a remote target; disposable targets are allowed only with --confirm-disposable.");
      }

      const client = new Client({ connectionString: directUrl, connectionTimeoutMillis: 5_000 });
      try {
        await client.connect();
        const inspection = await inspectMigrationDatabase(client);
        const authorizationEvidence = loadAuthorizationEvidence(argv);
        const finisherPrincipalEvidence = loadPrincipalEvidence(argv);
        const directTarget = new URL(directUrl);
        const projectReference =
          /^db\.([a-z0-9]{20})\.supabase\.co$/i.exec(
            directTarget.hostname,
          )?.[1] ?? (directTargetClass === "disposable" ? "disposable" : "");
        const report = buildMigrationIntegrityReport({
          target: {
            classification: directTargetClass,
            fingerprint: fingerprint(directUrl),
            projectFingerprint: projectReference
              ? projectFingerprint(projectReference)
              : undefined,
            database: directTarget.pathname.replace(/^\//, ""),
          },
          checkedIn: loadCheckedInMigrations(),
          authorizationEvidence,
          finisherPrincipalEvidence,
          finisherPrincipalEvidenceKey:
            process.env[FINISHER_PRINCIPAL_EVIDENCE_KEY_VARIABLE],
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
    message.startsWith("Migration authorization evidence") ||
    message.startsWith("Finisher principal evidence") ||
    message.startsWith("Missing required --env-file")
      ? message
      : "Migration integrity inspection failed. Run ops:check-direct-db for the sanitized connection classification.";
  console.error(safeMessage);
  process.exitCode = 1;
});
