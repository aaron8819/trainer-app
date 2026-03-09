import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  assertAuditPreflight,
  captureAuditWarnings,
  loadAuditEnv,
  parseArgs,
  printAuditPreflight,
  printWarningSummary,
  runAuditPreflight,
} from "./audit-cli-support";
import type { WorkoutAuditRequest } from "@/lib/audit/workout-audit/types";
import type { SessionIntent } from "@/lib/engine/session-types";

function slug(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const env = loadAuditEnv(typeof args["env-file"] === "string" ? args["env-file"] : undefined);

  const [{ resolveWorkoutAuditIdentity, buildWorkoutAuditContext }, { prisma }, generationRunner, serializer] =
    await Promise.all([
      import("@/lib/audit/workout-audit/context-builder"),
      import("@/lib/db/prisma"),
      import("@/lib/audit/workout-audit/generation-runner"),
      import("@/lib/audit/workout-audit/serializer"),
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
  printAuditPreflight("workout-audit", preflight);
  assertAuditPreflight("workout-audit", preflight);

  const request: WorkoutAuditRequest = {
    mode:
      (args.mode as "next-session" | "intent-preview" | undefined) ?? "next-session",
    userId: typeof args["user-id"] === "string" ? args["user-id"] : undefined,
    ownerEmail: typeof args.owner === "string" ? args.owner : undefined,
    intent: typeof args.intent === "string" ? (args.intent as SessionIntent) : undefined,
    targetMuscles:
      typeof args["target-muscles"] === "string"
        ? args["target-muscles"]
            .split(",")
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0)
        : undefined,
    plannerDiagnosticsMode: args.debug === true ? ("debug" as const) : ("standard" as const),
    sanitizationLevel: args.sanitization === "pii-safe" ? ("pii-safe" as const) : ("none" as const),
  };

  const { result, warnings } = await captureAuditWarnings(
    async () => {
      const context = await buildWorkoutAuditContext(request);
      const run = await generationRunner.runWorkoutAuditGeneration(context);
      return { context, run };
    },
    { debug: args.debug === true }
  );

  const { context, run } = result;
  const artifact = serializer.buildWorkoutAuditArtifact(request, run);
  const serialized = serializer.serializeWorkoutAuditArtifact(artifact);

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
  console.log(`[workout-audit:conclusions] ${JSON.stringify(artifact.conclusions)}`);
  printWarningSummary("workout-audit", {
    blockingErrors: [...artifact.warningSummary.blockingErrors, ...warnings.blockingErrors],
    semanticWarnings: [...artifact.warningSummary.semanticWarnings, ...warnings.semanticWarnings],
    backgroundWarnings: warnings.backgroundWarnings,
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[workout-audit] ${message}`);
  process.exitCode = 1;
});
