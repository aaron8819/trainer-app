import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "./audit-cli-support";

function parseBooleanFlag(value: string | boolean | undefined, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return fallback;
  }
  return value === "true" || value === "1";
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { analyzeAccountingClassification, buildScenarioConclusions } = await import(
    "@/lib/audit/workout-audit/scenario-audits"
  );

  const classification = {
    status: typeof args.status === "string" ? args.status : "COMPLETED",
    selectionMode:
      typeof args["selection-mode"] === "string"
        ? (args["selection-mode"] as "AUTO" | "INTENT" | "MANUAL")
        : ("MANUAL" as const),
    advancesSplit: parseBooleanFlag(args["advances-split"], false),
    optionalGapFill: parseBooleanFlag(args["optional-gap-fill"], true),
  };

  const result = analyzeAccountingClassification(classification);
  const artifact = {
    version: 1 as const,
    auditType: "accounting-semantics" as const,
    generatedAt: new Date().toISOString(),
    conclusions: buildScenarioConclusions(),
    result,
    warningSummary: {
      blockingErrors: [],
      semanticWarnings: [],
      backgroundWarnings: [],
    },
  };

  const outputDir = path.join(process.cwd(), "artifacts", "audits", "accounting");
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(
    outputDir,
    `${artifact.generatedAt.replace(/[:.]/g, "-")}-accounting-semantics.json`
  );
  await writeFile(outputPath, JSON.stringify(artifact, null, 2), "utf8");

  console.log(`[accounting-audit] wrote ${outputPath}`);
  console.log(`[accounting-audit:conclusions] ${JSON.stringify(artifact.conclusions)}`);
  console.log(
    `[accounting-audit] weekly_volume=${result.countsTowardWeeklyVolume} recovery=${result.countsTowardRecoveryRecentStimulus} progression=${result.countsTowardProgressionHistory} week_close=${result.countsTowardWeekCloseClosure} analytics_performed=${result.countsTowardAnalyticsPerformed} split_advancement=${result.countsTowardSplitAdvancement}`
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[accounting-audit] ${message}`);
  process.exitCode = 1;
});
