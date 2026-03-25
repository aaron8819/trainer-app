import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertAuditPreflight,
  buildResolvedAuditIdentityRequest,
  captureAuditWarnings,
  loadAuditEnv,
  parseArgs,
  printAuditPreflight,
  printWarningSummary,
  runAuditPreflight,
} from "./audit-cli-support";
import type { WorkoutAuditRequest } from "@/lib/audit/workout-audit/types";
import { WORKOUT_AUDIT_SIZE_LIMIT_BYTES } from "@/lib/audit/workout-audit/constants";
import type { SessionIntent } from "@/lib/engine/session-types";
import {
  parseSessionIntent,
  SESSION_INTENT_KEYS,
} from "@/lib/planning/session-opportunities";

function slug(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

export function normalizeAuditIntentArg(intent: string | undefined): SessionIntent | undefined {
  if (typeof intent !== "string") {
    return undefined;
  }

  const normalized = parseSessionIntent(intent);
  if (normalized) {
    return normalized;
  }

  throw new Error(
    `Invalid --intent value "${intent}". Expected one of: ${SESSION_INTENT_KEYS.join(", ")}.`
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const env = loadAuditEnv(typeof args["env-file"] === "string" ? args["env-file"] : undefined);
  const normalizedIntent = normalizeAuditIntentArg(
    typeof args.intent === "string" ? args.intent : undefined
  );

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
  const identityRequest = buildResolvedAuditIdentityRequest(args, preflight);

  const request: WorkoutAuditRequest = {
    mode:
      (args.mode as WorkoutAuditRequest["mode"] | undefined) ?? "future-week",
    ...identityRequest,
    intent: normalizedIntent,
    targetMuscles:
      typeof args["target-muscles"] === "string"
        ? args["target-muscles"]
            .split(",")
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0)
        : undefined,
    week:
      typeof args.week === "string" && Number.isFinite(Number(args.week))
        ? Number(args.week)
        : undefined,
    mesocycleId: typeof args["mesocycle-id"] === "string" ? args["mesocycle-id"] : undefined,
    workoutId: typeof args["workout-id"] === "string" ? args["workout-id"] : undefined,
    exerciseId: typeof args["exercise-id"] === "string" ? args["exercise-id"] : undefined,
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
  const output = serializer.createWorkoutAuditArtifactOutput(request, run, {
    capturedWarnings: warnings,
  });
  const { artifact, serialized, sizeBytes } = output;

  const timestamp = artifact.generatedAt.replace(/[:.]/g, "-");
  const intentSlug = context.generationInput?.intent ? `-${slug(context.generationInput.intent)}` : "";
  const fileName = `${timestamp}-${request.mode}${intentSlug}.json`;
  const outputDir = path.join(process.cwd(), "artifacts", "audits");
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, fileName);
  await writeFile(outputPath, serialized, "utf8");

  const summary = run.historicalWeek
    ? `week=${run.historicalWeek.week} sessions=${run.historicalWeek.summary.sessionCount}`
    : run.progressionAnchor
      ? `exercise=${run.progressionAnchor.exerciseId} action=${run.progressionAnchor.trace.outcome.action}`
      : !run.generationResult
        ? "no_generation"
        : "error" in run.generationResult
          ? `generation_error=${run.generationResult.error}`
          : `selected=${run.generationResult.selection.selectedExerciseIds.length}`;

  console.log(`[workout-audit] wrote ${outputPath}`);
  console.log(
    `[workout-audit] mode=${context.mode} diagnostics=${context.plannerDiagnosticsMode} ${summary}`
  );
  console.log(`[workout-audit] size_bytes=${sizeBytes}`);
  console.log(`[workout-audit:conclusions] ${JSON.stringify(artifact.conclusions)}`);
  printWarningSummary("workout-audit", artifact.warningSummary);
  if (sizeBytes > WORKOUT_AUDIT_SIZE_LIMIT_BYTES) {
    console.warn(
      `[workout-audit] artifact_size_exceeded size_bytes=${sizeBytes} limit_bytes=${WORKOUT_AUDIT_SIZE_LIMIT_BYTES}`
    );
  }
}

const isMainModule =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]!).href;

if (isMainModule) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[workout-audit] ${message}`);
    process.exitCode = 1;
  });
}
