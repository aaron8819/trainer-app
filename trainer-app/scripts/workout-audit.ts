import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildWorkoutAuditContext } from "@/lib/audit/workout-audit/context-builder";
import { runWorkoutAuditGeneration } from "@/lib/audit/workout-audit/generation-runner";
import {
  buildWorkoutAuditArtifact,
  serializeWorkoutAuditArtifact,
} from "@/lib/audit/workout-audit/serializer";
import type { WorkoutAuditRequest } from "@/lib/audit/workout-audit/types";
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

function parseRequestFromArgs(argv: string[]): WorkoutAuditRequest {
  const args = parseArgs(argv);
  const mode = (args.mode as WorkoutAuditRequest["mode"] | undefined) ?? "next-session";
  const intent = args.intent as SessionIntent | undefined;
  const targetMuscles =
    typeof args["target-muscles"] === "string"
      ? args["target-muscles"]
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0)
      : undefined;

  return {
    mode,
    userId: typeof args["user-id"] === "string" ? args["user-id"] : undefined,
    ownerEmail: typeof args.owner === "string" ? args.owner : undefined,
    intent,
    targetMuscles,
    plannerDiagnosticsMode: args.debug === true ? "debug" : "standard",
  };
}

function slug(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

async function main(): Promise<void> {
  const request = parseRequestFromArgs(process.argv.slice(2));
  const context = await buildWorkoutAuditContext(request);
  const run = await runWorkoutAuditGeneration(context);
  const artifact = buildWorkoutAuditArtifact(request, run);
  const serialized = serializeWorkoutAuditArtifact(artifact);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const intentSlug = context.generationInput.intent ? `-${slug(context.generationInput.intent)}` : "";
  const fileName = `${timestamp}-${request.mode}${intentSlug}.json`;
  const outputDir = path.join(process.cwd(), "artifacts", "audits");
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, fileName);
  await writeFile(outputPath, serialized, "utf8");

  const summary =
    "error" in run.generationResult
      ? `generation_error=${run.generationResult.error}`
      : `selected=${run.generationResult.selection.selectedExerciseIds.length}`;
  console.log(`[workout-audit] wrote ${outputPath}`);
  console.log(
    `[workout-audit] mode=${request.mode} intent=${context.generationInput.intent} diagnostics=${context.plannerDiagnosticsMode} ${summary}`
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[workout-audit] ${message}`);
  process.exitCode = 1;
});
