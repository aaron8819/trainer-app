import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "./audit-cli-support";
import type { SessionIntent } from "@/lib/engine/session-types";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { analyzeSequencingScenario, buildScenarioConclusions } = await import(
    "@/lib/audit/workout-audit/scenario-audits"
  );

  const schedule =
    typeof args.schedule === "string"
      ? args.schedule
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0)
      : ["pull", "push", "legs"];

  const baseScenario = analyzeSequencingScenario({
    name: "off-order-performed",
    weeklySchedule: schedule as SessionIntent[],
    performed: [
      { intent: "pull", status: "COMPLETED", advancesSplit: true },
      { intent: "legs", status: "COMPLETED", advancesSplit: true },
    ],
  });
  const nonAdvancingScenario = analyzeSequencingScenario({
    name: "off-order-non-advancing-supplemental",
    weeklySchedule: schedule as SessionIntent[],
    performed: [
      { intent: "pull", status: "COMPLETED", advancesSplit: true },
      { intent: "legs", status: "COMPLETED", advancesSplit: false },
    ],
  });

  const artifact = {
    version: 1 as const,
    auditType: "sequencing-sensitivity" as const,
    generatedAt: new Date().toISOString(),
    conclusions: buildScenarioConclusions(),
    scenarios: [baseScenario, nonAdvancingScenario],
    warningSummary: {
      blockingErrors: [],
      semanticWarnings: [],
      backgroundWarnings: [],
    },
  };

  const outputDir = path.join(process.cwd(), "artifacts", "audits", "sequencing");
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(
    outputDir,
    `${artifact.generatedAt.replace(/[:.]/g, "-")}-sequencing-sensitivity.json`
  );
  await writeFile(outputPath, JSON.stringify(artifact, null, 2), "utf8");

  console.log(`[sequencing-audit] wrote ${outputPath}`);
  console.log(`[sequencing-audit:conclusions] ${JSON.stringify(artifact.conclusions)}`);
  console.log(
    `[sequencing-audit] next_unresolved=${baseScenario.nextUnresolvedIntent ?? "none"} non_advancing_next=${nonAdvancingScenario.nextUnresolvedIntent ?? "none"}`
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[sequencing-audit] ${message}`);
  process.exitCode = 1;
});
