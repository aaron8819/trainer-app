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
import type {
  ProjectedWeekVolumeAuditPayload,
  WorkoutAuditArtifact,
  WorkoutAuditRequest,
} from "@/lib/audit/workout-audit/types";
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

function formatSignedSetDelta(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  const fixed = rounded.toFixed(1);
  return rounded > 0 ? `+${fixed}` : fixed;
}

function selectMuscleRows(
  rows: ProjectedWeekVolumeAuditPayload["fullWeekByMuscle"],
  predicate: (row: ProjectedWeekVolumeAuditPayload["fullWeekByMuscle"][number]) => boolean,
  deltaSelector: (
    row: ProjectedWeekVolumeAuditPayload["fullWeekByMuscle"][number]
  ) => number,
  sortOrder: "ascending" | "descending"
): ProjectedWeekVolumeAuditPayload["fullWeekByMuscle"] {
  return rows
    .filter(predicate)
    .sort((left, right) => {
      const leftDelta = deltaSelector(left);
      const rightDelta = deltaSelector(right);
      return sortOrder === "ascending" ? leftDelta - rightDelta : rightDelta - leftDelta;
    });
}

function formatMuscleBucket(
  rows: ProjectedWeekVolumeAuditPayload["fullWeekByMuscle"],
  predicate: (row: ProjectedWeekVolumeAuditPayload["fullWeekByMuscle"][number]) => boolean,
  deltaSelector: (
    row: ProjectedWeekVolumeAuditPayload["fullWeekByMuscle"][number]
  ) => number,
  sortOrder: "ascending" | "descending",
  limit = 4
): string {
  const selected = selectMuscleRows(rows, predicate, deltaSelector, sortOrder);

  if (selected.length === 0) {
    return "none";
  }

  const visible = selected
    .slice(0, limit)
    .map((row) => `${row.muscle} (${formatSignedSetDelta(deltaSelector(row))})`)
    .join(", ");
  const remaining = selected.length - limit;
  return remaining > 0 ? `${visible}, +${remaining} more` : visible;
}

function collectProjectedWeekRecommendationReasons(
  artifact: Pick<WorkoutAuditArtifact, "projectedWeekVolume" | "warningSummary">
): string[] {
  const projectedWeekVolume = artifact.projectedWeekVolume;
  if (!projectedWeekVolume) {
    return [];
  }

  const recommendationReasons: string[] = [];
  if (artifact.warningSummary.counts.blockingErrors > 0) {
    recommendationReasons.push("blocking_errors");
  }
  if (artifact.warningSummary.counts.semanticWarnings > 0) {
    recommendationReasons.push("semantic_warnings");
  }
  if (projectedWeekVolume.projectionNotes.length > 0) {
    recommendationReasons.push("projection_notes");
  }
  if (projectedWeekVolume.fullWeekByMuscle.some((row) => row.deltaToMev < 0)) {
    recommendationReasons.push("below_mev");
  }
  if (projectedWeekVolume.fullWeekByMuscle.some((row) => row.deltaToMav > 0)) {
    recommendationReasons.push("over_mav");
  }

  return recommendationReasons;
}

function formatProjectedWeekSessionLabel(
  session: ProjectedWeekVolumeAuditPayload["projectedSessions"][number]
): string {
  const slot = session.slotId ?? "unknown";
  return `${session.intent}@${slot}`;
}

function formatTopSessionContributors(
  contributionByMuscle: Record<string, number>,
  limit = 3
): string {
  const contributors = Object.entries(contributionByMuscle)
    .filter(([, value]) => value > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([muscle, value]) => `${muscle}:${formatSignedSetDelta(value)}`);

  return contributors.length > 0 ? contributors.join(", ") : "none";
}

function formatMuscleContributorSessions(input: {
  muscle: string;
  projectedSessions: ProjectedWeekVolumeAuditPayload["projectedSessions"];
}): string {
  const contributors = input.projectedSessions
    .map((session) => ({
      label: formatProjectedWeekSessionLabel(session),
      value: session.projectedContributionByMuscle[input.muscle] ?? 0,
    }))
    .filter((entry) => entry.value > 0)
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label))
    .map((entry) => `${entry.label}:${formatSignedSetDelta(entry.value)}`);

  return contributors.length > 0 ? contributors.join(", ") : "none";
}

export function buildProjectedWeekOperatorSummary(input: {
  artifact: Pick<WorkoutAuditArtifact, "projectedWeekVolume" | "warningSummary">;
  outputPath: string;
}): string[] | null {
  const projectedWeekVolume = input.artifact.projectedWeekVolume;
  if (!projectedWeekVolume) {
    return null;
  }

  const belowMev = formatMuscleBucket(
    projectedWeekVolume.fullWeekByMuscle,
    (row) => row.deltaToMev < 0,
    (row) => row.deltaToMev,
    "ascending"
  );
  const belowTargetOnly = formatMuscleBucket(
    projectedWeekVolume.fullWeekByMuscle,
    (row) => row.deltaToTarget < 0 && row.deltaToMev >= 0,
    (row) => row.deltaToTarget,
    "ascending"
  );
  const overMav = formatMuscleBucket(
    projectedWeekVolume.fullWeekByMuscle,
    (row) => row.deltaToMav > 0,
    (row) => row.deltaToMav,
    "descending"
  );
  const overTargetOnly = formatMuscleBucket(
    projectedWeekVolume.fullWeekByMuscle,
    (row) => row.deltaToTarget > 0 && row.deltaToMav <= 0,
    (row) => row.deltaToTarget,
    "descending"
  );

  const recommendationReasons = collectProjectedWeekRecommendationReasons(input.artifact);
  const recommendation =
    recommendationReasons.length > 0 ? "inspect_full_artifact" : "no_further_action";

  return [
    `[workout-audit:week] current_week=${projectedWeekVolume.currentWeek.week} phase=${projectedWeekVolume.currentWeek.phase} block=${projectedWeekVolume.currentWeek.blockType ?? "n/a"}`,
    `[workout-audit:week] below_mev=${belowMev}`,
    `[workout-audit:week] below_target_only=${belowTargetOnly}`,
    `[workout-audit:week] over_mav=${overMav}`,
    `[workout-audit:week] over_target_only=${overTargetOnly}`,
    `[workout-audit:week] projected_sessions=${projectedWeekVolume.projectedSessions.length} projection_notes=${projectedWeekVolume.projectionNotes.length} warnings=blocking:${input.artifact.warningSummary.counts.blockingErrors},semantic:${input.artifact.warningSummary.counts.semanticWarnings},background:${input.artifact.warningSummary.counts.backgroundWarnings}`,
    `[workout-audit:week] artifact=${input.outputPath}`,
    `[workout-audit:week] recommendation=${recommendation} reasons=${recommendationReasons.join(",") || "none"}`,
  ];
}

export function buildProjectedWeekDebugSummary(input: {
  artifact: Pick<WorkoutAuditArtifact, "projectedWeekVolume" | "warningSummary">;
}): string[] | null {
  const projectedWeekVolume = input.artifact.projectedWeekVolume;
  if (!projectedWeekVolume) {
    return null;
  }

  const lines: string[] = [];
  const belowMevRows = selectMuscleRows(
    projectedWeekVolume.fullWeekByMuscle,
    (row) => row.deltaToMev < 0,
    (row) => row.deltaToMev,
    "ascending"
  );
  const belowTargetOnlyRows = selectMuscleRows(
    projectedWeekVolume.fullWeekByMuscle,
    (row) => row.deltaToTarget < 0 && row.deltaToMev >= 0,
    (row) => row.deltaToTarget,
    "ascending"
  );
  const recommendationReasons = collectProjectedWeekRecommendationReasons(input.artifact);

  lines.push(
    `[workout-audit:week:debug] recommendation_reasons=${recommendationReasons.join(",") || "none"}`
  );
  lines.push(
    `[workout-audit:week:debug] projected_session_order=${projectedWeekVolume.projectedSessions.map((session) => formatProjectedWeekSessionLabel(session)).join(" -> ") || "none"}`
  );

  if (belowMevRows.length === 0) {
    lines.push("[workout-audit:week:debug] below_mev_detail=none");
  } else {
    for (const row of belowMevRows) {
      lines.push(
        `[workout-audit:week:debug] below_mev muscle=${row.muscle} full=${row.projectedFullWeekEffectiveSets.toFixed(1)} mev=${row.mev.toFixed(1)} target=${row.weeklyTarget.toFixed(1)} delta_to_mev=${formatSignedSetDelta(row.deltaToMev)} next=${row.projectedNextSessionEffectiveSets.toFixed(1)} remaining=${row.projectedRemainingWeekEffectiveSets.toFixed(1)} contributors=${formatMuscleContributorSessions({ muscle: row.muscle, projectedSessions: projectedWeekVolume.projectedSessions })}`
      );
    }
  }

  if (belowTargetOnlyRows.length === 0) {
    lines.push("[workout-audit:week:debug] below_target_only_detail=none");
  } else {
    for (const row of belowTargetOnlyRows) {
      lines.push(
        `[workout-audit:week:debug] below_target_only muscle=${row.muscle} full=${row.projectedFullWeekEffectiveSets.toFixed(1)} target=${row.weeklyTarget.toFixed(1)} delta_to_target=${formatSignedSetDelta(row.deltaToTarget)} mev=${row.mev.toFixed(1)} contributors=${formatMuscleContributorSessions({ muscle: row.muscle, projectedSessions: projectedWeekVolume.projectedSessions })}`
      );
    }
  }

  if (projectedWeekVolume.projectionNotes.length === 0) {
    lines.push("[workout-audit:week:debug] projection_note=none");
  } else {
    for (const [index, note] of projectedWeekVolume.projectionNotes.entries()) {
      lines.push(`[workout-audit:week:debug] projection_note[${index + 1}]=${note}`);
    }
  }

  const warningGroups: Array<{
    label: "blocking" | "semantic" | "background";
    entries: string[];
  }> = [
    { label: "blocking", entries: input.artifact.warningSummary.blockingErrors },
    { label: "semantic", entries: input.artifact.warningSummary.semanticWarnings },
    { label: "background", entries: input.artifact.warningSummary.backgroundWarnings },
  ];

  for (const group of warningGroups) {
    if (group.entries.length === 0) {
      lines.push(`[workout-audit:week:debug] ${group.label}_warning=none`);
      continue;
    }
    for (const [index, entry] of group.entries.entries()) {
      lines.push(`[workout-audit:week:debug] ${group.label}_warning[${index + 1}]=${entry}`);
    }
  }

  for (const [index, session] of projectedWeekVolume.projectedSessions.entries()) {
    lines.push(
      `[workout-audit:week:debug] projected_session[${index + 1}] label=${formatProjectedWeekSessionLabel(session)} is_next=${session.isNext} exercises=${session.exerciseCount} total_sets=${session.totalSets} top_contributors=${formatTopSessionContributors(session.projectedContributionByMuscle)}`
    );
  }

  return lines;
}

export function buildWeeklyRetroOperatorSummary(input: {
  artifact: Pick<WorkoutAuditArtifact, "weeklyRetro">;
}): string[] | null {
  const weeklyRetro = input.artifact.weeklyRetro;
  if (!weeklyRetro) {
    return null;
  }

  const underTargetRows = weeklyRetro.volumeTargeting.muscles
    .filter(
      (row) => row.status === "below_mev" || row.status === "under_target_only"
    )
    .sort((left, right) => left.deltaToTarget - right.deltaToTarget)
    .slice(0, 4)
    .map((row) => `${row.muscle} (${formatSignedSetDelta(row.deltaToTarget)})`)
    .join(", ");
  const interventions =
    weeklyRetro.interventions
      .slice(0, 3)
      .map((entry) => entry.kind)
      .join(", ") || "none";
  const recommendation = weeklyRetro.recommendedPriorities[0] ?? "no_further_action";

  return [
    `[workout-audit:retro] load_calibration=${weeklyRetro.loadCalibration.status} comparable_sessions=${weeklyRetro.loadCalibration.comparableSessionCount} drift_sessions=${weeklyRetro.loadCalibration.driftSessionCount} legacy_limited=${weeklyRetro.loadCalibration.legacyLimitedSessionCount}`,
    `[workout-audit:retro] under_target=${underTargetRows || "none"}`,
    `[workout-audit:retro] interventions=${interventions}`,
    `[workout-audit:retro] recommendation=${recommendation}`,
  ];
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
    : run.weeklyRetro
      ? `week=${run.weeklyRetro.week} recommendations=${run.weeklyRetro.recommendedPriorities.length}`
    : run.projectedWeekVolume
      ? `week=${run.projectedWeekVolume.currentWeek.week} projected_sessions=${run.projectedWeekVolume.projectedSessions.length}`
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
  const projectedWeekSummary = buildProjectedWeekOperatorSummary({
    artifact,
    outputPath,
  });
  if (projectedWeekSummary) {
    for (const line of projectedWeekSummary) {
      console.log(line);
    }
  }
  const weeklyRetroSummary = buildWeeklyRetroOperatorSummary({
    artifact,
  });
  if (weeklyRetroSummary) {
    for (const line of weeklyRetroSummary) {
      console.log(line);
    }
  }
  if (args["operator-debug"] === true) {
    const projectedWeekDebugSummary = buildProjectedWeekDebugSummary({
      artifact,
    });
    if (projectedWeekDebugSummary) {
      for (const line of projectedWeekDebugSummary) {
        console.log(line);
      }
    }
  }
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
