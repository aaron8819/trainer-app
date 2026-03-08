import "dotenv/config";

import { writeSplitSanityAuditArtifacts } from "@/lib/audit/workout-audit/bundle";
import type { SplitSanityAuditRequest } from "@/lib/audit/workout-audit/bundle";
import type { SessionIntent } from "@/lib/engine/session-types";

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const output: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      output[key] = true;
      continue;
    }
    output[key] = value;
    i += 1;
  }
  return output;
}

function parseRequestFromArgs(argv: string[]): SplitSanityAuditRequest {
  const args = parseArgs(argv);
  const intents =
    typeof args.intents === "string"
      ? args.intents
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0) as SessionIntent[]
      : undefined;

  return {
    userId: typeof args["user-id"] === "string" ? args["user-id"] : undefined,
    ownerEmail: typeof args.owner === "string" ? args.owner : undefined,
    intents,
    plannerDiagnosticsMode: args.debug === true ? "debug" : "standard",
    sanitizationLevel: args.sanitization === "pii-safe" ? "pii-safe" : "none",
  };
}

async function main(): Promise<void> {
  const request = parseRequestFromArgs(process.argv.slice(2));
  const result = await writeSplitSanityAuditArtifacts({
    request,
    writeRichArtifacts: process.argv.includes("--write-rich-artifacts"),
  });

  console.log(`[split-sanity-audit] wrote ${result.summaryPath}`);
  console.log(
    `[split-sanity-audit] verdict=${result.artifact.overallVerdict} failed=${result.artifact.failedChecks.join(",") || "none"} intents=${result.artifact.request.intents.join(",")}`
  );

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
