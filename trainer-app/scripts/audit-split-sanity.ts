import {
  assertAuditPreflight,
  captureAuditWarnings,
  loadAuditEnv,
  parseArgs,
  printAuditPreflight,
  printWarningSummary,
  runAuditPreflight,
} from "./audit-cli-support";
import type { SplitSanityAuditRequest } from "@/lib/audit/workout-audit/bundle";
import type { SessionIntent } from "@/lib/engine/session-types";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const env = loadAuditEnv(typeof args["env-file"] === "string" ? args["env-file"] : undefined);

  const [{ resolveWorkoutAuditIdentity }, { prisma }, { writeSplitSanityAuditArtifacts }] =
    await Promise.all([
      import("@/lib/audit/workout-audit/context-builder"),
      import("@/lib/db/prisma"),
      import("@/lib/audit/workout-audit/bundle"),
    ]);

  const preflight = await runAuditPreflight({
    args,
    resolveIdentity: resolveWorkoutAuditIdentity,
    checkDb: async () => {
      await prisma.$queryRawUnsafe("SELECT 1");
    },
  });
  preflight.envFilePath = env.envFilePath;
  preflight.status.env_loaded = env.envLoaded;
  printAuditPreflight("split-sanity-audit", preflight);
  assertAuditPreflight("split-sanity-audit", preflight);

  const request: SplitSanityAuditRequest = {
    userId: typeof args["user-id"] === "string" ? args["user-id"] : undefined,
    ownerEmail: typeof args.owner === "string" ? args.owner : undefined,
    intents:
      typeof args.intents === "string"
        ? args.intents
            .split(",")
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0) as SessionIntent[]
        : undefined,
    plannerDiagnosticsMode: args.debug === true ? ("debug" as const) : ("standard" as const),
    sanitizationLevel: args.sanitization === "pii-safe" ? ("pii-safe" as const) : ("none" as const),
  };

  const { result, warnings } = await captureAuditWarnings(
    () =>
      writeSplitSanityAuditArtifacts({
        request,
        writeRichArtifacts: args["write-rich-artifacts"] === true,
      }),
    { debug: args.debug === true }
  );

  console.log(`[split-sanity-audit] wrote ${result.summaryPath}`);
  console.log(
    `[split-sanity-audit] verdict=${result.artifact.overallVerdict} failed=${result.artifact.failedChecks.join(",") || "none"} intents=${result.artifact.request.intents.join(",")}`
  );
  console.log(`[split-sanity-audit:conclusions] ${JSON.stringify(result.artifact.conclusions)}`);
  printWarningSummary("split-sanity-audit", {
    blockingErrors: [...result.artifact.warningSummary.blockingErrors, ...warnings.blockingErrors],
    semanticWarnings: [...result.artifact.warningSummary.semanticWarnings, ...warnings.semanticWarnings],
    backgroundWarnings: [...result.artifact.warningSummary.backgroundWarnings, ...warnings.backgroundWarnings],
  });

  const richArtifactCount = Object.keys(result.richArtifactPaths).length;
  if (richArtifactCount > 0) {
    console.log(`[split-sanity-audit] richArtifacts=${richArtifactCount}`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[split-sanity-audit] ${message}`);
  process.exitCode = 1;
});
