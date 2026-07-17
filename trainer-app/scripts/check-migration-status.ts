import { createHash } from "node:crypto";
import { Client } from "pg";
import {
  buildMigrationIntegrityReport,
  loadCheckedInMigrations,
} from "@/lib/operations/migration-integrity";
import { inspectMigrationDatabase } from "@/lib/operations/migration-integrity-postgres";
import {
  classifyRolloutTarget,
  runWithRolloutEnvironment,
} from "@/lib/operations/rollout-environment";

function fingerprint(connectionString: string): string {
  const hostname = new URL(connectionString).hostname.toLowerCase();
  return createHash("sha256").update(hostname).digest("hex").slice(0, 12);
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
        const report = buildMigrationIntegrityReport({
          target: { classification: directTargetClass, fingerprint: fingerprint(directUrl) },
          checkedIn: loadCheckedInMigrations(),
          ...inspection,
        });
        console.log(
          `Migration integrity: checkedIn=${report.chain.checkedIn}, applied=${report.chain.applied}, ` +
          `pending=${report.chain.pending}, incomplete=${report.ledger.incomplete.length}, ` +
          `orderViolations=${report.ledger.orderViolations.length}, checksumsMatched=${report.checksums.matched}, ` +
          `semanticDriftBlocking=${report.schemaIntegrity.semanticDriftBlocking}, ` +
          `representationWarnings=${report.schemaIntegrity.representationWarningCount}, ` +
          `migrationAuthorizationReady=${report.migrationAuthorizationReady}.`,
        );
        console.log(JSON.stringify(report, null, 2));
        if (!report.migrationAuthorizationReady && report.chain.gateAApplicable) process.exitCode = 1;
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
    message.startsWith("Missing required --env-file")
      ? message
      : "Migration integrity inspection failed. Run ops:check-direct-db for the sanitized connection classification.";
  console.error(safeMessage);
  process.exitCode = 1;
});
