import { createHash } from "node:crypto";
import { Client } from "pg";
import { loadCheckedInMigrations } from "@/lib/operations/migration-integrity";
import { buildReadinessIntegrityReport } from "@/lib/operations/readiness-integrity";
import {
  formatReadinessIntegritySummary,
  sanitizeReadinessIntegrityError,
} from "@/lib/operations/readiness-integrity-cli";
import { inspectReadinessIntegrityDatabase } from "@/lib/operations/readiness-integrity-postgres";
import {
  classifyRolloutTarget,
  runWithRolloutEnvironment,
} from "@/lib/operations/rollout-environment";

function targetFingerprint(connectionString: string): string {
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
      const directTargetClass = classifyRolloutTarget(
        directUrl,
        argv.includes("--confirm-disposable"),
      );
      if (directTargetClass !== environment.targetClass) {
        throw new Error("DATABASE_URL and DIRECT_URL resolve to different sanitized target classes.");
      }
      if (directTargetClass === "local") {
        throw new Error(
          "Readiness integrity requires a remote target; disposable targets require --confirm-disposable.",
        );
      }

      const client = new Client({ connectionString: directUrl, connectionTimeoutMillis: 5_000 });
      try {
        await client.connect();
        const checkedIn = loadCheckedInMigrations();
        const inspection = await inspectReadinessIntegrityDatabase(client, checkedIn);
        const report = buildReadinessIntegrityReport({ ...inspection, checkedIn });
        const output = {
          target: {
            classification: directTargetClass,
            fingerprint: targetFingerprint(directUrl),
          },
          ...report,
        };
        console.log(formatReadinessIntegritySummary(report));
        console.log(JSON.stringify(output, null, 2));
        if (!report.readinessIntegrityReady) process.exitCode = 1;
      } finally {
        await client.end().catch(() => undefined);
      }
    },
  );
}

main().catch((error) => {
  console.error(sanitizeReadinessIntegrityError(error));
  process.exitCode = 1;
});
