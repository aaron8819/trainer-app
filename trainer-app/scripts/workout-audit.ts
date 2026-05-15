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
import {
  buildSerializedTopLevelSizeBreakdown,
  getSerializedJsonSizeBytes,
} from "@/lib/audit/workout-audit/artifact-serialization";
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
  if (
    projectedWeekVolume.fullWeekByMuscle.some(
      (row) => isHardTargetProjectionRow(row) && row.deltaToMev < 0
    )
  ) {
    recommendationReasons.push("below_mev");
  }
  if (
    projectedWeekVolume.fullWeekByMuscle.some(
      (row) => isHardTargetProjectionRow(row) && row.deltaToMav > 0
    )
  ) {
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

function isHardTargetProjectionRow(
  row: ProjectedWeekVolumeAuditPayload["fullWeekByMuscle"][number]
): boolean {
  if (row.warningSeverity) {
    return row.warningSeverity === "hard";
  }
  return row.targetKind !== "soft";
}

function formatCurrentWeekUnderTargetClusters(
  clusters: NonNullable<ProjectedWeekVolumeAuditPayload["currentWeekAudit"]>["underTargetClusters"],
  limit = 4
): string {
  if (clusters.length === 0) {
    return "none";
  }

  const visible = clusters
    .slice(0, limit)
    .map((cluster) => `${cluster.muscle} (-${cluster.deficit.toFixed(1)})`)
    .join(", ");
  const remaining = clusters.length - limit;
  return remaining > 0 ? `${visible}, +${remaining} more` : visible;
}

function formatCurrentWeekList(values: string[], limit = 4): string {
  if (values.length === 0) {
    return "none";
  }

  const visible = values.slice(0, limit).join(", ");
  const remaining = values.length - limit;
  return remaining > 0 ? `${visible}, +${remaining} more` : visible;
}

function formatBooleanFlag(value: boolean): string {
  return value ? "yes" : "no";
}

function formatAuditValue(value: string | number | boolean | null | undefined): string {
  if (value == null) {
    return "none";
  }
  if (typeof value === "boolean") {
    return formatBooleanFlag(value);
  }
  return String(value);
}

type PlanningRealityDiagnostic = NonNullable<
  NonNullable<WorkoutAuditArtifact["mesocycleExplain"]>["preview"]["projectionDiagnostics"]["planningReality"]
>;

type PartialPlanningRealityDiagnostic = Partial<PlanningRealityDiagnostic> & {
  summary?: Partial<PlanningRealityDiagnostic["summary"]>;
};

type PreselectionDemandDiagnostic = NonNullable<
  NonNullable<WorkoutAuditArtifact["mesocycleExplain"]>["preview"]["projectionDiagnostics"]["preselectionDemands"]
>[number];

type PlanningRealitySummaryArtifact = {
  mesocycleExplain?: {
    preview?: {
      projectionDiagnostics?: {
        planningReality?: PartialPlanningRealityDiagnostic | null;
        preselectionDemands?: PreselectionDemandDiagnostic[] | null;
      } | null;
    } | null;
  } | null;
};

type PlannerOnlyDryRunSummaryArtifact = {
  mesocycleExplain?: {
    plannerOnlyDryRun?:
      | NonNullable<NonNullable<WorkoutAuditArtifact["mesocycleExplain"]>["plannerOnlyDryRun"]>
      | null;
    plannerOnlyNoRepair?:
      | NonNullable<NonNullable<WorkoutAuditArtifact["mesocycleExplain"]>["plannerOnlyNoRepair"]>
      | null;
  } | null;
};

const PLANNING_REALITY_SIZE_BUDGET_APPROACH_RATIO = 0.9;
const PLANNING_REALITY_SIZE_BUDGET_SECTION_LIMIT = 8;

type AuditCliTimingSpan =
  | "argument_parsing"
  | "preflight"
  | "owner_context_resolution"
  | "context_build"
  | "audit_generation"
  | "artifact_serialization"
  | "artifact_write"
  | "sidecar_write"
  | "cli_summary_formatting"
  | "total_measured_work"
  | "teardown";

type AuditCliTimingRecord = {
  span: AuditCliTimingSpan;
  ms: number;
};

type AuditCliTiming = {
  start(span: AuditCliTimingSpan): () => void;
  record(span: AuditCliTimingSpan, ms: number): void;
  records(): AuditCliTimingRecord[];
};

type AuditCliTeardown = () => Promise<void>;

let activeAuditCliTeardown: AuditCliTeardown | null = null;
let shouldPrintTimingReadout = false;

const AUDIT_CLI_TIMING_LABELS: Record<AuditCliTimingSpan, string> = {
  argument_parsing: "argument_parsing_preflight",
  preflight: "preflight",
  owner_context_resolution: "owner_context_resolution",
  context_build: "context_build",
  audit_generation: "audit_generation",
  artifact_serialization: "artifact_serialization",
  artifact_write: "artifact_write",
  sidecar_write: "sidecar_write",
  cli_summary_formatting: "cli_summary_formatting",
  total_measured_work: "total_measured_work",
  teardown: "teardown",
};

export function shouldPrintAuditTimingReadout(args: Record<string, unknown>): boolean {
  return args["operator-debug"] === true || args.debug === true;
}

export function shouldSuppressAuditArtifactWrites(args: Record<string, unknown>): boolean {
  return args["no-artifact"] === true || args["stdout-only"] === true;
}

export function assertNoArtifactWriteCompatibility(args: Record<string, unknown>): void {
  if (!shouldSuppressAuditArtifactWrites(args)) {
    return;
  }

  const conflictingFlags = [
    ["write", "--write"],
    ["apply-bounded-reseed", "--apply-bounded-reseed"],
    ["accept-slot-plan-upgrade", "--accept-slot-plan-upgrade"],
    ["v2-debug-artifact", "--v2-debug-artifact"],
  ] as const;
  const conflict = conflictingFlags.find(([key]) => args[key] === true);
  if (conflict) {
    throw new Error(
      `--no-artifact/--stdout-only cannot be combined with ${conflict[1]}`
    );
  }
}

export function isWorkoutAuditHelpRequested(argv: readonly string[]): boolean {
  return argv.some((token) => token === "--help" || token === "-h");
}

export function buildWorkoutAuditHelpText(): string {
  return [
    "Usage: npm run audit:workout -- [options]",
    "",
    "Runs the Trainer workout audit CLI. Without --mode, the default audit mode is future-week.",
    "",
    "Options:",
    "  -h, --help                         Print this help and exit without preflight, DB access, audit execution, or artifact writes.",
    "  --env-file <path>                  Load environment variables from a specific file.",
    "  --mode <mode>                      Audit mode: future-week, projected-week-volume, current-week-audit, historical-week, weekly-retro, mesocycle-explain, deload, progression-anchor, active-mesocycle-slot-reseed, replace-empty-mesocycle-with-v2, v2-accepted-seed-prepare-compare.",
    "  --owner <email>                    Resolve the audit owner by email.",
    "  --user-id <id>                     Resolve the audit owner by user id.",
    "  --intent <intent>                  Session intent for generated-session modes.",
    "  --week <number>                    Target week for historical or retrospective audits.",
    "  --mesocycle-id <id>                Target mesocycle id when the selected mode requires one.",
    "  --no-artifact, --stdout-only       Run the audit without writing local artifact files.",
    "  --operator-debug, --debug          Print extra operator diagnostics.",
    "",
    "Safety:",
    "  Help exits before owner resolution, DB preflight, audit execution, artifact directory creation, and artifact writing.",
  ].join("\n");
}

export function createAuditCliTiming(input?: {
  now?: () => number;
}): AuditCliTiming {
  const now = input?.now ?? (() => performance.now());
  const timings: AuditCliTimingRecord[] = [];

  return {
    start(span) {
      const startedAt = now();
      return () => {
        timings.push({ span, ms: Math.max(0, now() - startedAt) });
      };
    },
    record(span, ms) {
      timings.push({ span, ms: Math.max(0, ms) });
    },
    records() {
      return [...timings];
    },
  };
}

export function buildAuditTimingSummaryLines(input: {
  enabled: boolean;
  records: AuditCliTimingRecord[];
}): string[] | null {
  if (!input.enabled) {
    return null;
  }

  return input.records.map((record) => {
    const label = AUDIT_CLI_TIMING_LABELS[record.span];
    return `[workout-audit:timing] ${label}_ms=${record.ms.toFixed(1)}`;
  });
}

export async function runAuditCliWithTeardown(input: {
  run: () => Promise<void>;
  teardown: () => Promise<void>;
  timing: AuditCliTiming;
  printTiming: () => boolean;
  logTimingLine?: (line: string) => void;
  logTeardownError?: (message: string) => void;
}): Promise<void> {
  let originalError: unknown;
  let teardownError: unknown;

  try {
    await input.run();
  } catch (error) {
    originalError = error;
  } finally {
    const endTeardown = input.timing.start("teardown");
    try {
      await input.teardown();
    } catch (error) {
      teardownError = error;
      const message = error instanceof Error ? error.message : String(error);
      input.logTeardownError?.(`[workout-audit] teardown failed: ${message}`);
    } finally {
      endTeardown();
    }

    const timingLines = buildAuditTimingSummaryLines({
      enabled: input.printTiming(),
      records: input.timing.records(),
    });
    if (timingLines) {
      const logTimingLine = input.logTimingLine ?? console.log;
      for (const line of timingLines) {
        logTimingLine(line);
      }
    }
  }

  if (originalError) {
    throw originalError;
  }
  if (teardownError) {
    throw teardownError;
  }
}

type AuditArtifactFileShard = {
  fileName: string;
  serialized: string;
};

type AuditArtifactSidecarOutput = {
  fileName: string;
  serialized: string;
  shards: AuditArtifactFileShard[];
};

export async function writeAuditArtifactFiles(input: {
  suppressWrites: boolean;
  outputDir: string;
  outputPath: string;
  serialized: string;
  v2DebugArtifact?: AuditArtifactSidecarOutput;
  timing: AuditCliTiming;
  ensureOutputDir?: (dir: string) => Promise<void>;
  writeTextFile?: (filePath: string, contents: string) => Promise<void>;
  joinPath?: (...parts: string[]) => string;
}): Promise<{
  artifactOutputPath: string | null;
  v2DebugOutputPath: string | null;
  sidecarFileCount: number;
}> {
  const ensureOutputDir =
    input.ensureOutputDir ?? ((dir) => mkdir(dir, { recursive: true }).then(() => undefined));
  const writeTextFile =
    input.writeTextFile ?? ((filePath, contents) => writeFile(filePath, contents, "utf8"));
  const joinPath = input.joinPath ?? path.join;

  const endArtifactWrite = input.timing.start("artifact_write");
  try {
    if (!input.suppressWrites) {
      await ensureOutputDir(input.outputDir);
      await writeTextFile(input.outputPath, input.serialized);
    }
  } finally {
    endArtifactWrite();
  }

  const v2DebugOutputPath =
    !input.suppressWrites && input.v2DebugArtifact
      ? joinPath(input.outputDir, input.v2DebugArtifact.fileName)
      : null;
  let sidecarFileCount = 0;
  const endSidecarWrite = input.timing.start("sidecar_write");
  try {
    if (!input.suppressWrites && input.v2DebugArtifact && v2DebugOutputPath) {
      await writeTextFile(v2DebugOutputPath, input.v2DebugArtifact.serialized);
      await Promise.all(
        input.v2DebugArtifact.shards.map((shard) =>
          writeTextFile(
            joinPath(input.outputDir, shard.fileName),
            shard.serialized,
          ),
        ),
      );
      sidecarFileCount = 1 + input.v2DebugArtifact.shards.length;
    }
  } finally {
    endSidecarWrite();
  }

  return {
    artifactOutputPath: input.suppressWrites ? null : input.outputPath,
    v2DebugOutputPath,
    sidecarFileCount,
  };
}

function asArray<T>(value: readonly T[] | null | undefined): T[] {
  return Array.isArray(value) ? [...value] : [];
}

function formatNameList(values: readonly string[] | null | undefined, limit = 12): string {
  const normalized = Array.from(
    new Set(
      asArray(values)
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    )
  ).sort((left, right) => left.localeCompare(right));

  if (normalized.length === 0) {
    return "none";
  }

  const visible = normalized.slice(0, limit).join(", ");
  const remaining = normalized.length - limit;
  return remaining > 0 ? `${visible}, +${remaining} more` : visible;
}

function formatPlanningRealityNumber(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "unknown";
}

function formatPlannerOnlyNullableBoolean(value: boolean | null | undefined): string {
  return typeof value === "boolean" ? formatBooleanFlag(value) : "unknown";
}

function isMaterialPlanningRealityRepair(input: {
  materiality?: string | null;
}): boolean {
  return input.materiality === "moderate" || input.materiality === "major";
}

function formatShadowRepairRow(
  row: PlanningRealityDiagnostic["repairMaterialityAfterShadowAllocation"][number]
): string {
  const slotId = row.slotId ?? "unknown_slot";
  const muscle = row.muscle ?? "unknown muscle";
  const exercise = row.exerciseName ?? row.exerciseId ?? "unknown exercise";
  return `${slotId} ${muscle} via ${exercise}`;
}

function formatShadowRepairList(
  rows: PlanningRealityDiagnostic["repairMaterialityAfterShadowAllocation"][number][],
  limit = 6
): string {
  if (rows.length === 0) {
    return "none";
  }
  const visible = rows.slice(0, limit).map(formatShadowRepairRow).join("; ");
  const remaining = rows.length - limit;
  return remaining > 0 ? `${visible}; +${remaining} more` : visible;
}

function countShadowRowsByMuscle(
  rows: Array<{ muscle?: string | null }>
): Record<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.muscle) {
      continue;
    }
    counts.set(row.muscle, (counts.get(row.muscle) ?? 0) + 1);
  }
  return Object.fromEntries(
    Array.from(counts.entries()).sort(
      ([leftMuscle, leftCount], [rightMuscle, rightCount]) =>
        rightCount - leftCount || leftMuscle.localeCompare(rightMuscle)
    )
  );
}

function deriveShadowRepairSummary(
  rows: PlanningRealityDiagnostic["repairMaterialityAfterShadowAllocation"]
): PlanningRealityDiagnostic["shadowRepairSummary"] {
  const materialRows = rows.filter(isMaterialPlanningRealityRepair);
  const majorRows = rows.filter((row) => row.materiality === "major");
  const likelyAvoidableMaterialRows = materialRows.filter(
    (row) => row.likelyAvoidableWithShadowAllocation
  );
  const remainingMaterialRows = materialRows.filter(
    (row) => !row.likelyAvoidableWithShadowAllocation
  );
  const likelyAvoidableMajorRows = majorRows.filter(
    (row) => row.likelyAvoidableWithShadowAllocation
  );

  return {
    materialRepairCount: materialRows.length,
    majorRepairCount: majorRows.length,
    likelyAvoidableMaterialRepairCount: likelyAvoidableMaterialRows.length,
    remainingMaterialRepairCount: remainingMaterialRows.length,
    likelyAvoidableMajorRepairCount: likelyAvoidableMajorRows.length,
    remainingMajorRepairCount: majorRows.length - likelyAvoidableMajorRows.length,
    likelyAvoidableByMuscle: countShadowRowsByMuscle(likelyAvoidableMaterialRows),
    remainingByMuscle: countShadowRowsByMuscle(remainingMaterialRows),
  };
}

function formatCountByMuscle(record: Record<string, number> | null | undefined): string[] {
  const entries = Object.entries(record ?? {}).sort(
    ([leftMuscle, leftCount], [rightMuscle, rightCount]) =>
      rightCount - leftCount || leftMuscle.localeCompare(rightMuscle)
  );
  return entries.length > 0
    ? entries.map(([muscle, count]) => `- ${muscle}: ${count}`)
    : ["- none"];
}

function formatSuspiciousRepairs(
  rows: PlanningRealityDiagnostic["suspiciousRepairsNotEligibleForPromotion"],
  limit = 8
): string[] {
  if (rows.length === 0) {
    return ["- none"];
  }
  const lines = rows
    .slice(0, limit)
    .map((row) => `- ${row.slotId}: ${row.muscle} via ${row.exerciseName ?? "unknown exercise"}`);
  const remaining = rows.length - limit;
  return remaining > 0 ? [...lines, `- +${remaining} more`] : lines;
}

function formatPromotionCandidates(
  rows: PlanningRealityDiagnostic["promotionCandidates"],
  limit = 8
): string[] {
  if (rows.length === 0) {
    return ["- none"];
  }
  const lines = rows
    .slice(0, limit)
    .map(
      (row) =>
        `- ${row.slotId}: ${row.muscle} (${row.role}, ${row.targetStatus}) -> ${row.suggestedPromotion}`
    );
  const remaining = rows.length - limit;
  return remaining > 0 ? [...lines, `- +${remaining} more`] : lines;
}

function formatUniqueEvidenceRows(values: string[], limit = 8): string[] {
  const rows = Array.from(new Set(values))
    .filter((value) => value.trim().length > 0)
    .sort((left, right) => left.localeCompare(right));
  if (rows.length === 0) {
    return ["- none"];
  }
  const lines = rows.slice(0, limit).map((row) => `- ${row}`);
  const remaining = rows.length - limit;
  return remaining > 0 ? [...lines, `- +${remaining} more`] : lines;
}

function buildSetDistributionSummaryLines(
  intents: PlanningRealityDiagnostic["setDistributionIntents"] | null | undefined,
  guardActions?: PlanningRealityDiagnostic["distributionGuardActions"] | null
): string[] | null {
  const rows = asArray(intents);
  const actions = asArray(guardActions);
  if (rows.length === 0 && actions.length === 0) {
    return null;
  }
  const concentrationRows = rows.flatMap((intent) =>
    asArray(intent.evidence?.concentrationRows)
  );
  const capCleanupRows = rows.flatMap((intent) =>
    asArray(intent.evidence?.capCleanupRows)
  );
  const unresolvedPolicyCount = rows.flatMap((intent) =>
    asArray(intent.musclePolicies)
  ).filter((policy) => policy.whenAtLimit === "leave_unresolved").length;
  const likelyPolicyRows = [
    ...(concentrationRows.length > 0
      ? ["avoid set-bumping concentrated exercises"]
      : []),
    ...(capCleanupRows.length > 0
      ? ["prefer clean alternative before cap cleanup"]
      : []),
    ...(unresolvedPolicyCount > 0
      ? ["leave collateral or no-clean-path demand unresolved"]
      : []),
  ];

  return [
    "Set Distribution Intent",
    "-----------------------",
    "High concentration:",
    ...formatUniqueEvidenceRows(concentrationRows, 6),
    "",
    "Cap cleanup:",
    ...formatUniqueEvidenceRows(capCleanupRows, 6),
    "",
    "Distribution guard actions:",
    ...formatUniqueEvidenceRows(
      actions.map((action) => {
        const alternative = action.alternativeExerciseName
          ? ` -> ${action.alternativeExerciseName}`
          : "";
        return `${action.slotId}:${action.exerciseName}:${action.muscle}:${action.decision}${alternative}`;
      }),
      6
    ),
    "",
    "Likely next policy:",
    ...formatUniqueEvidenceRows(likelyPolicyRows, 6),
  ];
}

function formatPreselectionCandidate(
  candidate: string | null | undefined
): string {
  switch (candidate) {
    case "chest_upper_slot_distinct_exercise_distribution":
      return "Chest upper-slot distinct exercise distribution";
    case "hamstrings_weekly_overdelivery_control":
      return "Hamstrings weekly overdelivery control";
    case "side_delt_second_slot_support":
      return "Side Delt second-slot support";
    case "duplicate_main_lift_suppression":
      return "Duplicate main-lift suppression";
    case "calf_duplicate_suppression":
      return "Calf duplicate suppression";
    default:
      return "none";
  }
}

function buildPreselectionDistributionPolicySummaryLines(
  policy:
    | PlanningRealityDiagnostic["preselectionDistributionPolicyByWeek"]
    | null
    | undefined
): string[] | null {
  if (!policy) {
    return null;
  }

  const weeks = asArray(policy.weeks);
  const weekOne = weeks.find((week) => week.week === 1);
  const accumulationUnprojected = weeks.filter(
    (week) =>
      week.week >= 2 &&
      week.phase !== "deload" &&
      week.projectionStatus !== "projected_from_current_week_evidence"
  );
  const deload = weeks.find((week) => week.phase === "deload");
  const bestFutureBehavior = asArray(policy.candidateBehaviorSlices).find(
    (slice) => slice.recommendation === "best_future_behavior"
  );

  return [
    "Preselection Distribution Policy",
    "--------------------------------",
    `Week 1: ${
      weekOne?.projectionStatus === "projected_from_current_week_evidence"
        ? "projected from current evidence"
        : "not projected"
    }`,
    `Weeks 2-4: ${
      accumulationUnprojected.length > 0
        ? "not projected - missing weekly demand curve / accumulation policy"
        : "not listed"
    }`,
    `Deload: ${
      deload && deload.projectionStatus !== "projected_from_current_week_evidence"
        ? "not projected - missing deload preservation policy"
        : "not listed"
    }`,
    "",
    `Best future behavior: ${formatPreselectionCandidate(bestFutureBehavior?.candidate)}`,
    "Blocked from behavior now: no week-by-week projection yet",
  ];
}

function buildWeeklyDemandCurveSummaryLines(
  curve:
    | PlanningRealityDiagnostic["weeklyDemandCurve"]
    | null
    | undefined
): string[] | null {
  if (!curve) {
    return null;
  }

  const weeks = asArray(curve.weeks);
  const weekOne = weeks.find((week) => week.week === 1);
  const accumulationWeeks = weeks.filter(
    (week) => week.week >= 2 && week.week <= 4 && week.phase !== "deload"
  );
  const deload = weeks.find((week) => week.phase === "deload");
  const warnings = asArray(curve.crossWeekWarnings);
  const hasWarning = (
    code: string,
    muscle?: string,
  ): boolean =>
    warnings.some(
      (warning) =>
        warning.code === code && (!muscle || warning.muscle === muscle)
    );
  const accumulationLimited =
    accumulationWeeks.length > 0 &&
    accumulationWeeks.some(
      (week) => week.projectionStatus !== "projected_from_policy"
    );
  const risks: string[] = [];
  if (hasWarning("PRIMARY_UNDER_TARGET_ACROSS_ACCUMULATION", "Chest")) {
    risks.push("Chest under target across accumulation");
  }
  if (hasWarning("MUSCLE_OVERDELIVERED_ACROSS_ACCUMULATION", "Hamstrings")) {
    risks.push("Hamstrings overdelivered if repeated");
  }
  if (hasWarning("SUPPORT_UNDER_TARGET_ACROSS_ACCUMULATION", "Side Delts")) {
    risks.push("Side Delts under target");
  }

  return [
    "Weekly Demand Curve",
    "-------------------",
    `Week 1: ${
      weekOne
        ? "projected from current evidence"
        : "not listed"
    }`,
    `Weeks 2-4: ${
      accumulationLimited
        ? "limited / missing accumulation policy"
        : accumulationWeeks.length > 0
          ? "projected from policy"
          : "not listed"
    }`,
    `Week ${deload?.week ?? 5} deload: ${
      deload && deload.projectionStatus === "projected_from_policy"
        ? "projected from policy"
        : "limited / missing deload demand projection"
    }`,
    "",
    "Risks:",
    ...(risks.length > 0 ? risks.map((risk) => `- ${risk}`) : ["- none"]),
    `Candidate gate: ${
      curve.candidateBehaviorGate?.likelyBestFutureBehavior
        ? formatPreselectionCandidate(
            curve.candidateBehaviorGate.likelyBestFutureBehavior
          )
        : "none"
    } blocked until weekly curve answers cross-week questions`,
  ];
}

function buildSlotDemandAllocationByWeekSummaryLines(
  allocation:
    | PlanningRealityDiagnostic["slotDemandAllocationByWeek"]
    | null
    | undefined
): string[] | null {
  if (!allocation) {
    return null;
  }

  const weeks = asArray(allocation.weeks);
  const weekOne = weeks.find((week) => week.week === 1);
  const accumulationWeeks = weeks.filter(
    (week) => week.week >= 2 && week.week <= 4 && week.phase !== "deload"
  );
  const deload = weeks.find((week) => week.phase === "deload");
  const weekOneMuscles = asArray(weekOne?.slots).flatMap((slot) =>
    asArray(slot.allocatedMuscles).map((muscle) => ({
      slotId: slot.slotId,
      ...muscle,
    }))
  );
  const warnings = asArray(allocation.crossWeekAllocationWarnings);
  const hasAllocationWarning = (code: string, muscle?: string): boolean =>
    warnings.some(
      (warning) =>
        warning.code === code && (!muscle || warning.muscle === muscle)
    );
  const hasWeekOneLimitation = (muscle: string, limitation: string): boolean =>
    weekOneMuscles.some(
      (row) => row.muscle === muscle && asArray(row.limitations).includes(limitation)
    );

  const gaps: string[] = [];
  if (
    hasWeekOneLimitation("Chest", "week_1_under_preferred_target") ||
    hasAllocationWarning("MUSCLE_UNDER_ALLOCATED_ACROSS_ACCUMULATION", "Chest")
  ) {
    const slots = formatNameList(
      weekOneMuscles
        .filter((row) => row.muscle === "Chest")
        .map((row) => row.slotId),
      4
    );
    gaps.push(`Chest owned by ${slots} but under-delivered`);
  }
  if (
    hasWeekOneLimitation("Hamstrings", "week_1_over_preferred_target") ||
    hasAllocationWarning("MUSCLE_OVER_ALLOCATED_ACROSS_ACCUMULATION", "Hamstrings")
  ) {
    const slots = formatNameList(
      weekOneMuscles
        .filter((row) => row.muscle === "Hamstrings")
        .map((row) => row.slotId),
      4
    );
    gaps.push(`Hamstrings owned by ${slots} but over-delivered`);
  }
  if (
    hasWeekOneLimitation("Side Delts", "week_1_under_preferred_target") ||
    hasAllocationWarning("MUSCLE_UNDER_ALLOCATED_ACROSS_ACCUMULATION", "Side Delts")
  ) {
    const slots = formatNameList(
      weekOneMuscles
        .filter((row) => row.muscle === "Side Delts")
        .map((row) => row.slotId),
      4
    );
    gaps.push(`Side Delts support gap remains in ${slots}`);
  }
  if (hasWeekOneLimitation("Calves", "duplicate_exercise_variant_pressure_visible")) {
    gaps.push("Calves target met but duplicate lower-slot variant pressure exists");
  }

  const accumulationMissing = accumulationWeeks.some(
    (week) =>
      week.projectionStatus === "not_allocated_missing_weekly_projection"
  );

  return [
    "Slot Demand Allocation By Week",
    "------------------------------",
    `Week 1: ${
      weekOne?.projectionStatus === "allocated_from_current_week_evidence"
        ? "allocated from current evidence"
        : "not allocated"
    }`,
    `Weeks 2-4: ${
      accumulationMissing
        ? "not allocated - missing weekly projection"
        : accumulationWeeks.length > 0
          ? "partially allocated from weekly demand curve"
          : "not listed"
    }`,
    `Deload: ${
      deload?.projectionStatus === "not_allocated_missing_deload_policy"
        ? "not allocated - missing deload policy"
        : deload
          ? "partially allocated"
          : "not listed"
    }`,
    "",
    "Key Week 1 ownership gaps:",
    ...(gaps.length > 0 ? gaps.map((gap) => `- ${gap}`) : ["- none"]),
  ];
}

function buildExerciseClassDistributionSummaryLines(
  distributions:
    | PlanningRealityDiagnostic["exerciseClassDistributionBySlot"]
    | null
    | undefined
): string[] | null {
  const rows = asArray(distributions);
  if (rows.length === 0) {
    return null;
  }

  const weekOneRows = rows.filter(
    (row) => row.week === 1 && row.projectionStatus === "projected_from_current_evidence"
  );
  const allDemands = weekOneRows.flatMap((slot) =>
    asArray(slot.muscleDemands).map((demand) => ({
      slotId: slot.slotId,
      ...demand,
    }))
  );
  const hasDemand = (muscle: string, slotId?: string): boolean =>
    allDemands.some(
      (demand) => demand.muscle === muscle && (!slotId || demand.slotId === slotId)
    );
  const hasEvidence = (needle: string): boolean =>
    allDemands.some(
      (demand) =>
        asArray(demand.inventoryEvidence).some((row) => row.includes(needle)) ||
        asArray(demand.limitations).some((row) => row.includes(needle))
    );

  const lines = [
    "Exercise Class Distribution",
    "---------------------------",
  ];
  if (hasDemand("Chest")) {
    lines.push(
      "- Chest: upper slots need distinct class intent; duplicate Incline requires justification"
    );
  }
  if (hasDemand("Hamstrings", "lower_b")) {
    lines.push(
      "- Hamstrings lower_b: hinge anchor + knee-flexion curl; Back Extension not clean closure"
    );
  }
  if (hasDemand("Side Delts")) {
    lines.push(
      "- Side Delts: lateral raise / vertical press overlap, avoid OHP concentration"
    );
  }
  if (hasDemand("Rear Delts") || hasDemand("Triceps")) {
    lines.push(
      "- Rear Delts / Triceps: collateral and target-met cautions stay diagnostic"
    );
  }
  if (hasDemand("Calves")) {
    lines.push(
      "- Calves: one isolation per lower slot; avoid same-session duplicate variants"
    );
  }
  if (
    ["Incline DB Bench", "Lat Pulldown", "SLDL", "Barbell Back Squat"].some(
      hasEvidence
    )
  ) {
    lines.push(
      "- Duplicates: Incline DB Bench, Lat Pulldown, SLDL, Back Squat require justification"
    );
  }

  return lines.length > 2 ? lines : null;
}

function buildExerciseClassAlignmentSummaryLines(
  alignment:
    | PlanningRealityDiagnostic["exerciseClassAlignment"]
    | null
    | undefined
): string[] | null {
  if (!alignment) {
    return null;
  }

  const allAlignments = asArray(alignment.slots).flatMap((slot) =>
    asArray(slot.muscleAlignments).map((row) => ({
      slotId: slot.slotId,
      ...row,
    }))
  );
  const hasEvidence = (muscle: string, needle: string): boolean =>
    allAlignments.some(
      (row) =>
        row.muscle === muscle &&
        asArray(row.evidence).some((evidence) => evidence.includes(needle))
    );
  const hasFinalStatus = (
    muscle: string,
    status: string,
    slotId?: string
  ): boolean =>
    allAlignments.some(
      (row) =>
        row.muscle === muscle &&
        row.finalAlignment === status &&
        (!slotId || row.slotId === slotId)
    );

  const notable: string[] = [];
  if (hasEvidence("Chest", "Incline")) {
    notable.push("Chest: duplicate Incline / distinct class unresolved");
  }
  if (hasFinalStatus("Hamstrings", "satisfied", "lower_b")) {
    notable.push("lower_b Hamstrings: hinge + curl satisfied");
  }
  if (hasEvidence("Calves", "same_session_duplicate_class")) {
    notable.push("Calves: duplicate isolation class warning");
  }

  return [
    "Exercise Class Alignment",
    "------------------------",
    `Initial satisfied: ${alignment.summary.initiallySatisfied}`,
    `Final satisfied: ${alignment.summary.finallySatisfied}`,
    `Improved by repair: ${alignment.summary.improvedByRepair}`,
    `Identity churn: ${alignment.summary.identityChurnCount}`,
    `Unresolved class intents: ${alignment.summary.unresolvedClassIntentCount}`,
    "",
    "Notable:",
    ...(notable.length > 0 ? notable.map((line) => `- ${line}`) : ["- none"]),
  ];
}

function formatExerciseClassCauseLabel(cause: string): string {
  return cause.replace(/_/g, " ");
}

function buildExerciseClassUnresolvedCauseSummaryLines(
  alignment:
    | PlanningRealityDiagnostic["exerciseClassAlignment"]
    | null
    | undefined,
  unresolvedCauses:
    | PlanningRealityDiagnostic["exerciseClassUnresolvedCauses"]
    | null
    | undefined
): string[] | null {
  const rows = asArray(unresolvedCauses);
  if (rows.length === 0) {
    return null;
  }

  const countCause = (cause: string): number =>
    rows.filter((row) => row.owningCause === cause).length;
  const notable: string[] = [];
  const hasCause = (muscle: string, cause: string): boolean =>
    rows.some((row) => row.muscle === muscle && row.owningCause === cause);
  const hasSatisfied = (muscle: string, slotId?: string): boolean =>
    asArray(alignment?.slots).some((slot) =>
      (!slotId || slot.slotId === slotId) &&
      asArray(slot.muscleAlignments).some(
        (row) => row.muscle === muscle && row.finalAlignment === "satisfied"
      )
    );

  if (hasCause("Chest", "duplicate_continuity_conflict")) {
    notable.push("Chest: duplicate continuity conflict");
  } else if (hasCause("Chest", "selection_blind_spot")) {
    notable.push("Chest: selection blind spot");
  } else if (hasCause("Chest", "repair_identity_churn")) {
    notable.push("Chest: repair identity churn");
  }
  if (hasSatisfied("Hamstrings", "lower_b")) {
    notable.push("lower_b Hamstrings: class satisfied; duplicate risk separate");
  }
  if (hasCause("Calves", "duplicate_continuity_conflict")) {
    notable.push("Calves: duplicate isolation policy");
  }

  return [
    "Exercise Class Unresolved Causes",
    "--------------------------------",
    `selection blind spots: ${countCause("selection_blind_spot")}`,
    `duplicate/continuity conflicts: ${countCause("duplicate_continuity_conflict")}`,
    `support-floor late repairs: ${countCause("support_floor_late_repair")}`,
    `repair identity churn: ${countCause("repair_identity_churn")}`,
    `diagnostic-only: ${countCause("diagnostic_only_not_actionable")}`,
    "",
    "Notable:",
    ...(notable.length > 0
      ? notable.map((line) => `- ${line}`)
      : rows
          .slice(0, 5)
          .map(
            (row) =>
              `- ${row.muscle}: ${formatExerciseClassCauseLabel(row.owningCause)}`
          )),
  ];
}

function buildDuplicateContinuityJustificationSummaryLines(
  diagnostic:
    | PlanningRealityDiagnostic["duplicateContinuityJustification"]
    | null
    | undefined
): string[] | null {
  if (!diagnostic) {
    return null;
  }

  const duplicates = asArray(diagnostic.duplicates);
  const summary = diagnostic.summary ?? {
    totalDuplicates: duplicates.length,
    unjustifiedOrUnknown: duplicates.filter(
      (row) => row.justification === "unjustified" || row.justification === "unknown"
    ).length,
    cleanAlternativeAvailable: duplicates.filter(
      (row) => row.compatibleAlternativeExists === true
    ).length,
    highRiskDuplicates: duplicates.filter((row) => row.risk === "high").length,
  };
  const findDuplicate = (needle: string) =>
    duplicates.find((row) =>
      String(row.exerciseName ?? "").toLowerCase().includes(needle)
    );
  const notable: string[] = [];
  const incline = findDuplicate("incline");
  if (incline) {
    notable.push(
      `Incline DB Bench: duplicate, Chest hard primary, ${incline.compatibleAlternativeExists ? "clean alternative visible" : "clean alternative needed"}`
    );
  }
  const pulldown = findDuplicate("lat pulldown");
  if (pulldown) {
    notable.push("Lat Pulldown: duplicate, Lats adequate, discourage");
  }
  const sldl = findDuplicate("sldl") ?? findDuplicate("stiff-legged");
  if (sldl) {
    notable.push("SLDL: duplicate, Hamstrings high, planner decision needed");
  }
  const calves = duplicates.find(
    (row) =>
      row.duplicateType === "same_session_variant" &&
      asArray(row.primaryMuscles).includes("Calves")
  );
  if (calves) {
    notable.push("Calves: same-session variant, discourage unless specialization");
  }

  return [
    "Duplicate / Continuity Justification",
    "------------------------------------",
    `Total duplicates: ${summary.totalDuplicates}`,
    `Unknown/unjustified: ${summary.unjustifiedOrUnknown}`,
    `Clean alternatives visible: ${summary.cleanAlternativeAvailable}`,
    `High risk: ${summary.highRiskDuplicates}`,
    "",
    "Notable:",
    ...(notable.length > 0
      ? notable.map((line) => `- ${line}`)
      : duplicates.slice(0, 5).map(
          (row) =>
            `- ${row.exerciseName}: ${row.duplicateType}, ${row.policyRecommendation}`
        )),
  ];
}

function buildAccumulationWeekProjectionSummaryLines(
  projection:
    | PlanningRealityDiagnostic["accumulationWeekProjection"]
    | null
    | undefined
): string[] | null {
  if (!projection) {
    return null;
  }

  const warnings = asArray(projection.crossWeekWarnings);
  const hasWarning = (code: string): boolean =>
    warnings.some((warning) => warning.code === code);
  const risks: string[] = [];
  if (hasWarning("CHEST_UNDER_TARGET_ACROSS_ACCUMULATION")) {
    risks.push("Chest under target across accumulation");
  }
  if (hasWarning("HAMSTRINGS_OVERDELIVERED_ACROSS_ACCUMULATION")) {
    risks.push("Hamstrings overdelivered across accumulation");
  }
  if (hasWarning("SIDE_DELTS_UNDER_TARGET_ACROSS_ACCUMULATION")) {
    risks.push("Side Delts under target across accumulation");
  }
  if (hasWarning("DUPLICATE_MAIN_LIFT_REUSE_ACROSS_ACCUMULATION")) {
    risks.push("Duplicate main-lift reuse");
  }
  if (hasWarning("COLLATERAL_FATIGUE_RISK_ACROSS_ACCUMULATION")) {
    risks.push("Collateral fatigue risk");
  }
  const bestCandidate = asArray(projection.candidateBehaviorReadiness).find(
    (candidate) => candidate.readiness === "ready_for_bounded_trial"
  );

  return [
    "Accumulation Week Projection",
    "----------------------------",
    `Basis: ${
      projection.projectionBasis.method === "repeat_week_1_final_shape"
        ? "repeat Week 1 final shape"
        : projection.projectionBasis.method
    } / limited`,
    "Risks:",
    ...(risks.length > 0 ? risks.map((risk) => `- ${risk}`) : ["- none"]),
    `Best bounded candidate: ${formatPreselectionCandidate(bestCandidate?.candidate)}`,
  ];
}

function buildCleanPreselectionFeasibilitySummaryLines(
  rows: PlanningRealityDiagnostic["preselectionFeasibility"] | null | undefined
): string[] | null {
  const feasibilityRows = asArray(rows);
  if (feasibilityRows.length === 0) {
    return null;
  }

  const lines = [
    "Clean Preselection Feasibility",
    "--------------------------------",
  ];
  for (const row of feasibilityRows.slice(0, 6)) {
    const dirtySignals = asArray(row.dirtyClosureSignals).map(
      (signal) => signal.signal
    );
    const preferredPath = asArray(row.preferredCleanPath)
      .filter((path) => path.available)
      .map((path) => path.exerciseClass);
    lines.push(
      `${row.slotId} ${row.muscle}: ${row.recommendation} (${row.candidateStatus})`
    );
    lines.push(
      `Reason: ${formatNameList(dirtySignals.length > 0 ? dirtySignals : row.reasons, 6)}.`
    );
    lines.push(
      `Preferred clean path: ${preferredPath.length > 0 ? preferredPath.join(" or ") : "none proven"}.`
    );
    lines.push(
      `Collateral estimate: Glutes ${formatSignedSetDelta(row.collateralEstimate?.glutesDelta ?? 0)}, Lower Back ${formatSignedSetDelta(row.collateralEstimate?.lowerBackDelta ?? 0)}.`
    );
    const inventory = asArray(row.candidateInventory);
    if (inventory.length > 0) {
      lines.push("Candidate inventory:");
      for (const candidate of inventory.slice(0, 8)) {
        const selectedSlots = asArray(candidate.alreadySelectedSlotIds);
        const selectedText =
          selectedSlots.length > 0
            ? `already selected in ${selectedSlots.join(", ")}`
            : "not selected";
        lines.push(
          `- ${candidate.exerciseName}: ${candidate.candidateClass}, ${candidate.availability}, ` +
            `lower_b=${formatBooleanFlag(candidate.lowerBCompatible)}, ${selectedText}`
        );
      }
      const hidden = inventory.length - 8;
      if (hidden > 0) {
        lines.push(`- +${hidden} more`);
      }
    }
  }
  const remaining = feasibilityRows.length - 6;
  if (remaining > 0) {
    lines.push(`+${remaining} more`);
  }
  return lines;
}

function buildCleanupCandidateFeasibilitySummaryLines(
  rows:
    | PlanningRealityDiagnostic["cleanupCandidateFeasibility"]
    | null
    | undefined
): string[] | null {
  const feasibilityRows = asArray(rows);
  if (feasibilityRows.length === 0) {
    return null;
  }

  const lines = [
    "Cleanup Candidate Feasibility",
    "-----------------------------",
  ];
  for (const row of feasibilityRows.slice(0, 6)) {
    const label =
      row.candidate === "lower_b_calf_duplicate_cleanup"
        ? "lower_b Calves duplicate cleanup"
        : row.candidate;
    const status =
      row.feasibility === "feasible"
        ? "feasible"
        : row.feasibility === "not_feasible_under_current_caps"
          ? "not feasible"
          : "ambiguous";
    const currentSets = asArray(row.currentShape).reduce(
      (sum, exercise) => sum + (exercise.setCount ?? 0),
      0
    );
    const currentEffectiveSets = asArray(row.currentShape).reduce(
      (sum, exercise) => sum + (exercise.effectiveSets ?? 0),
      0
    );
    const currentShape = asArray(row.currentShape)
      .map((exercise) => `${exercise.exerciseName} ${exercise.setCount}`)
      .join(" + ");
    const proposedShape = asArray(row.proposedCleanerShape)
      .map(
        (exercise) =>
          `${exercise.exerciseName} ${exercise.proposedSetCount} sets -> ${formatPlanningRealityNumber(exercise.projectedEffectiveSets)} effective`
      )
      .join("; ");
    const target =
      row.target.minEffectiveSets ?? row.target.preferredEffectiveSets;
    lines.push(`${label}: ${status}`);
    lines.push(
      `Current: ${currentShape || "none"} = ${formatPlanningRealityNumber(currentEffectiveSets)} ${row.slotId} ${row.muscle} effective sets (${currentSets} raw sets).`
    );
    lines.push(
      `Target floor: ${formatPlanningRealityNumber(target)} (${row.target.targetStatus}).`
    );
    lines.push(
      `Caps: maxSetsPerExercise=${formatPlanningRealityNumber(row.caps.maxSetsPerExercise)}, maxDirectExercises=${formatPlanningRealityNumber(row.caps.maxDirectExercises)}, maxTotalSlotSets=${formatPlanningRealityNumber(row.caps.maxTotalSlotSets)}.`
    );
    lines.push(`Proposed cleaner shape: ${proposedShape || "none"}.`);
    lines.push(`Blocking: ${formatNameList(row.blockingReasons, 8)}.`);
    lines.push(`Recommendation: ${row.recommendation}.`);
  }
  const remaining = feasibilityRows.length - 6;
  if (remaining > 0) {
    lines.push(`+${remaining} more`);
  }
  return lines;
}

function formatPlanningRealityArchitectureImplication(
  planningShape: string | null | undefined,
  shadowRepairSignal?: {
    likelyAvoidableCount: number;
    remainingMaterialRepairCount: number | null;
    suspiciousCount: number;
    cleanupCount: number;
  }
): string {
  if (shadowRepairSignal?.suspiciousCount) {
    return "Suspicious downstream repairs block promotion. Resolve ownership smells first, then promote only bounded slot-owned demand.";
  }
  if (shadowRepairSignal?.likelyAvoidableCount) {
    return "Promote only bounded, slot-owned, non-suspicious demand into pre-selection planning before tuning repair.";
  }
  if (
    shadowRepairSignal &&
    shadowRepairSignal.cleanupCount > 0 &&
    shadowRepairSignal.remainingMaterialRepairCount === shadowRepairSignal.cleanupCount
  ) {
    return "Remaining material repairs look like repair/cap cleanup. Focus set distribution and concentration policy, not demand allocation.";
  }
  switch (planningShape) {
    case "mostly_repair_shaped":
      return "The plan is mostly repair-shaped. Next move should be upstream WeeklyMuscleDemand -> SlotDemandAllocation ownership before selection.";
    case "mixed_upstream_plus_repair_shaped":
      return "The plan is mixed upstream plus repair-shaped. Next move should promote repaired muscles and local-only slots into upstream demand allocation.";
    case "mostly_upstream_planned":
      return "The plan is mostly upstream-planned. Next move should focus on validators, set distribution quality, and concentration guardrails.";
    case "unclear_due_to_missing_instrumentation":
      return "Planning shape is unclear. Next move should improve planningReality instrumentation before making architecture conclusions.";
    default:
      return "Planning shape is unavailable. Next move should inspect the full artifact before making architecture conclusions.";
  }
}

function formatSlotAllocationStatus(input: {
  slot: PlanningRealityDiagnostic["slotDemandAllocation"][number];
  finalDelta?: PlanningRealityDiagnostic["allocationVsFinalDelta"][number];
}): string {
  const explicitObligations = asArray(input.slot.expectedMuscleObligations).filter(
    (entry) => entry.explicitUpstream
  );
  if (explicitObligations.length === 0) {
    return "no explicit weekly demand allocation";
  }

  const underAllocated = asArray(input.finalDelta?.underAllocatedMuscles).filter((entry) =>
    explicitObligations.some((obligation) => obligation.muscle === entry.muscle)
  );
  if (underAllocated.length === 0 && input.slot.satisfiesKnownWeeklyDemand) {
    return "explicit demand satisfied";
  }

  const servedMuscles = new Set(asArray(input.slot.meaningfullyServedMuscles));
  const servedExplicitCount = explicitObligations.filter((entry) =>
    servedMuscles.has(entry.muscle)
  ).length;
  if (servedExplicitCount > 0 && servedExplicitCount < explicitObligations.length) {
    return "explicit demand partially satisfied";
  }

  return "explicit demand not fully satisfied locally";
}

function buildTopDownMesocyclePlanSummaryLines(
  plan: PartialPlanningRealityDiagnostic["topDownMesocyclePlan"] | null | undefined
): string[] | null {
  if (!plan) {
    return null;
  }
  const summary = plan.summary;
  const blockedMigrations = asArray(plan.migrationReadiness).filter((row) =>
    row.readiness?.startsWith("blocked_by_")
  );
  const lines = [
    "Top-Down Mesocycle Plan",
    "-----------------------",
    `Status: ${plan.planStatus ?? "unknown"}`,
    `Matched lanes: ${formatPlanningRealityNumber(summary?.matchedTargetLanes)}`,
    `Partial lanes: ${formatPlanningRealityNumber(summary?.partialTargetLanes)}`,
    `Missing lanes: ${formatPlanningRealityNumber(summary?.missingTargetLanes)}`,
    `Repair-shaped lanes: ${formatPlanningRealityNumber(summary?.repairShapedTargetLanes)}`,
    "",
    "Blocked migrations:",
  ];

  if (blockedMigrations.length === 0) {
    lines.push("- none");
  } else {
    for (const row of blockedMigrations.slice(0, 5)) {
      lines.push(`- ${row.candidate}: ${row.readiness}`);
    }
    const remaining = blockedMigrations.length - 5;
    if (remaining > 0) {
      lines.push(`- +${remaining} more`);
    }
  }

  return lines;
}

export function computePlanningRealitySizeBudget(input: {
  planningReality: PartialPlanningRealityDiagnostic | null | undefined;
  largestSectionLimit?: number;
}): {
  totalBytes: number;
  largestSections: Array<{ field: string; bytes: number }>;
} | null {
  if (!input.planningReality) {
    return null;
  }

  const largestSectionLimit =
    input.largestSectionLimit ?? PLANNING_REALITY_SIZE_BUDGET_SECTION_LIMIT;
  const sectionSizes = buildSerializedTopLevelSizeBreakdown(
    input.planningReality
  );

  return {
    totalBytes: getSerializedJsonSizeBytes(input.planningReality),
    largestSections: sectionSizes.slice(0, largestSectionLimit),
  };
}

export function buildPlanningRealitySizeBudgetSummary(input: {
  artifact: PlanningRealitySummaryArtifact;
  sizeBytes: number;
  thresholdBytes?: number;
  operatorDebug?: boolean;
  largestSectionLimit?: number;
}): string[] | null {
  const planningReality =
    input.artifact.mesocycleExplain?.preview?.projectionDiagnostics?.planningReality ?? undefined;
  if (!planningReality) {
    return null;
  }

  const thresholdBytes =
    input.thresholdBytes ?? WORKOUT_AUDIT_SIZE_LIMIT_BYTES;
  const approachThresholdBytes = Math.floor(
    thresholdBytes * PLANNING_REALITY_SIZE_BUDGET_APPROACH_RATIO
  );
  const exceeded = input.sizeBytes > thresholdBytes;
  const approaching = input.sizeBytes >= approachThresholdBytes;
  if (!exceeded && !approaching && input.operatorDebug !== true) {
    return null;
  }

  const budget = computePlanningRealitySizeBudget({
    planningReality,
    largestSectionLimit: input.largestSectionLimit,
  });
  if (!budget) {
    return null;
  }

  const status = exceeded
    ? "exceeded"
    : approaching
      ? "approaching"
      : "operator_debug";
  const lines = [
    "planningReality size breakdown",
    "-------------------------------",
    `artifact bytes: ${input.sizeBytes}`,
    `artifact limit bytes: ${thresholdBytes}`,
    `artifact budget status: ${status}`,
    `total planningReality bytes: ${budget.totalBytes}`,
    "largest sections:",
  ];

  if (budget.largestSections.length === 0) {
    lines.push("- none");
  } else {
    for (const section of budget.largestSections) {
      lines.push(`- ${section.field}: ${section.bytes}`);
    }
  }

  return lines;
}

export function buildPlanningRealitySummary(input: {
  artifact: PlanningRealitySummaryArtifact;
  outputPath?: string;
}): string[] | null {
  const planningReality =
    input.artifact.mesocycleExplain?.preview?.projectionDiagnostics?.planningReality ?? undefined;
  if (!planningReality) {
    return null;
  }

  const weeklyDemand = asArray(planningReality.weeklyMuscleDemand);
  const repairMateriality = asArray(planningReality.repairMateriality);
  const warnings = asArray(planningReality.warnings);
  const exerciseConcentration = asArray(planningReality.exerciseConcentration);
  const slotDemandAllocation = asArray(planningReality.slotDemandAllocation);
  const finalDeltas = asArray(planningReality.allocationVsFinalDelta);
  const shadowRepairMateriality = asArray(
    planningReality.repairMaterialityAfterShadowAllocation
  );
  const shadowRepairSummary =
    planningReality.shadowRepairSummary ?? deriveShadowRepairSummary(shadowRepairMateriality);
  const promotionCandidates = asArray(planningReality.promotionCandidates);
  const preselectionDemands = asArray(
    input.artifact.mesocycleExplain?.preview?.projectionDiagnostics?.preselectionDemands
  );
  const weakPreselectionConsumption = asArray(
    planningReality.weakPreselectionConsumption
  );

  const explicitMuscles = weeklyDemand
    .filter((row) => row.explicitUpstream)
    .map((row) => row.muscle);
  const inferredMuscles = weeklyDemand
    .filter((row) => row.inferredDownstream)
    .map((row) => row.muscle);
  const addedExerciseIdentityByKey = new Map<
    string,
    PlanningRealityDiagnostic["repairMateriality"][number]
  >();
  for (const row of repairMateriality) {
    if (!row.changedExerciseIdentity || row.action !== "added") {
      continue;
    }
    const key = `${row.slotId ?? "unknown_slot"}:${row.exerciseId ?? row.exerciseName ?? "unknown"}`;
    if (!addedExerciseIdentityByKey.has(key)) {
      addedExerciseIdentityByKey.set(key, row);
    }
  }
  const addedExerciseIdentities = Array.from(addedExerciseIdentityByKey.values()).sort(
    (left, right) =>
      (left.slotId ?? "").localeCompare(right.slotId ?? "") ||
      (left.exerciseName ?? "").localeCompare(right.exerciseName ?? "") ||
      (left.muscle ?? "").localeCompare(right.muscle ?? "")
  );
  const materialWarnings = warnings
    .filter((warning) => asArray(warning.evidence).length > 0)
    .sort((left, right) => left.code.localeCompare(right.code));
  const concentratedExercises = exerciseConcentration
    .filter((row) =>
      asArray(row.flags).some(
        (flag) =>
          flag === "COMPOUND_GT_5_SETS" ||
          flag === "ISOLATION_GT_5_SETS" ||
          flag.includes("EXERCISE_SUPPLIES_OVER")
      )
    )
    .sort(
      (left, right) =>
        left.slotId.localeCompare(right.slotId) ||
        left.exerciseName.localeCompare(right.exerciseName)
    );
  const finalDeltaBySlot = new Map(finalDeltas.map((delta) => [delta.slotId, delta]));
  const materialShadowRepairs = shadowRepairMateriality.filter(isMaterialPlanningRealityRepair);
  const likelyAvoidableRepairs = materialShadowRepairs
    .filter((row) => row.likelyAvoidableWithShadowAllocation)
    .sort(
      (left, right) =>
        (left.slotId ?? "").localeCompare(right.slotId ?? "") ||
        (left.muscle ?? "").localeCompare(right.muscle ?? "") ||
        (left.exerciseName ?? "").localeCompare(right.exerciseName ?? "")
    );
  const fallbackSuspiciousRepairRows = materialShadowRepairs
    .filter(
      (row) =>
        !row.likelyAvoidableWithShadowAllocation &&
        row.shadowAllocationBasis === "weekly_demand_owned_elsewhere"
    )
    .sort(
      (left, right) =>
        (left.slotId ?? "").localeCompare(right.slotId ?? "") ||
        (left.muscle ?? "").localeCompare(right.muscle ?? "") ||
        (left.exerciseName ?? "").localeCompare(right.exerciseName ?? "")
    );
  const suspiciousRepairsNotEligibleForPromotion = asArray(
    planningReality.suspiciousRepairsNotEligibleForPromotion
  );
  const suspiciousRepairsForOutput =
    suspiciousRepairsNotEligibleForPromotion.length > 0
      ? suspiciousRepairsNotEligibleForPromotion
      : fallbackSuspiciousRepairRows.map((row) => ({
          slotId: row.slotId ?? "unknown_slot",
          muscle: row.muscle ?? "unknown muscle",
          exerciseName: row.exerciseName ?? row.exerciseId ?? null,
          repairMechanism: row.repairMechanism,
          reason: "shadow allocation marks this muscle as weekly_demand_owned_elsewhere",
          recommendation:
            "Do not promote this repair upstream; inspect slot ownership, compatibility, or cleanup cause first.",
        }));
  const remainingRepairCleanupRows = materialShadowRepairs
    .filter(
      (row) =>
        !row.likelyAvoidableWithShadowAllocation &&
        row.shadowAllocationBasis !== "weekly_demand_owned_elsewhere"
    )
    .sort(
      (left, right) =>
        (left.slotId ?? "").localeCompare(right.slotId ?? "") ||
        (left.muscle ?? "").localeCompare(right.muscle ?? "") ||
        (left.exerciseName ?? "").localeCompare(right.exerciseName ?? "")
    );
  const materialRepairCount =
    typeof shadowRepairSummary.materialRepairCount === "number"
      ? shadowRepairSummary.materialRepairCount
      : typeof planningReality.summary?.materialRepairCount === "number"
        ? planningReality.summary.materialRepairCount
        : materialShadowRepairs.length;
  const remainingMaterialRepairCount = shadowRepairSummary.remainingMaterialRepairCount;
  const shadowRepairSignal = {
    likelyAvoidableCount: shadowRepairSummary.likelyAvoidableMaterialRepairCount,
    remainingMaterialRepairCount,
    suspiciousCount: suspiciousRepairsForOutput.length,
    cleanupCount: remainingRepairCleanupRows.length,
  };

  const lines = ["Planning Reality Summary", "------------------------"];
  if (input.outputPath) {
    lines.push(`Artifact: ${input.outputPath}`);
  }

  const planningShape = planningReality.summary?.planningShape;
  const architectureImplication = formatPlanningRealityArchitectureImplication(
    planningShape,
    shadowRepairSignal
  );
  lines.push(`Planning shape: ${planningShape ?? "unknown"}`, "");
  lines.push("Architecture Signal:");
  lines.push(`- planningShape: ${planningShape ?? "unknown"}`);
  lines.push(`- materialRepairCount: ${formatPlanningRealityNumber(materialRepairCount)}`);
  lines.push(
    `- majorRepairCount: ${formatPlanningRealityNumber(planningReality.summary?.majorRepairCount)}`
  );
  lines.push(
    `- likelyUpstreamAvoidableMaterialRepairs: ${shadowRepairSummary.likelyAvoidableMaterialRepairCount}`
  );
  lines.push(
    `- remainingMaterialRepairs: ${formatPlanningRealityNumber(remainingMaterialRepairCount)}`
  );
  lines.push(
    `- suspiciousRepairsNotEligibleForPromotion: ${suspiciousRepairsForOutput.length}`
  );
  const promotionCandidateSignal =
    promotionCandidates.length > 0
      ? promotionCandidates
          .map((row) => `${row.slotId} ${row.muscle} -> ${row.suggestedPromotion}`)
          .slice(0, 6)
          .join("; ")
      : formatShadowRepairList(likelyAvoidableRepairs);
  lines.push(
    `- promotionCandidates: ${promotionCandidateSignal || "none"}`
  );
  lines.push(`- highest-leverage next move: ${architectureImplication}`, "");
  lines.push("Demand:");
  lines.push(`- Explicit upstream muscles: ${formatNameList(explicitMuscles)}`);
  lines.push(`- Inferred downstream muscles: ${formatNameList(inferredMuscles)}`, "");
  lines.push("Repair:");
  lines.push(
    `- Material repairs: ${formatPlanningRealityNumber(materialRepairCount)}`
  );
  lines.push(
    `- Major repairs: ${formatPlanningRealityNumber(planningReality.summary?.majorRepairCount)}`
  );
  lines.push("- Added exercise identities:");
  if (addedExerciseIdentities.length === 0) {
    lines.push("  - none");
  } else {
    for (const row of addedExerciseIdentities.slice(0, 8)) {
      lines.push(
        `  - ${row.slotId ?? "unknown_slot"}: ${row.exerciseName ?? row.exerciseId ?? "unknown exercise"}`
      );
    }
    const remaining = addedExerciseIdentities.length - 8;
    if (remaining > 0) {
      lines.push(`  - +${remaining} more`);
    }
  }

  lines.push("", "Shadow Repair Summary");
  lines.push("---------------------");
  lines.push(`Material repairs: ${formatPlanningRealityNumber(shadowRepairSummary.materialRepairCount)}`);
  lines.push(`Major repairs: ${formatPlanningRealityNumber(shadowRepairSummary.majorRepairCount)}`);
  lines.push(
    `Likely upstream-avoidable: ${formatPlanningRealityNumber(shadowRepairSummary.likelyAvoidableMaterialRepairCount)}`
  );
  lines.push(`Remaining: ${formatPlanningRealityNumber(shadowRepairSummary.remainingMaterialRepairCount)}`);
  lines.push(
    `Likely upstream-avoidable major: ${formatPlanningRealityNumber(shadowRepairSummary.likelyAvoidableMajorRepairCount)}`
  );
  lines.push(`Remaining major: ${formatPlanningRealityNumber(shadowRepairSummary.remainingMajorRepairCount)}`);
  lines.push("", "Likely avoidable by muscle:");
  lines.push(...formatCountByMuscle(shadowRepairSummary.likelyAvoidableByMuscle));
  lines.push("", "Remaining by muscle:");
  lines.push(...formatCountByMuscle(shadowRepairSummary.remainingByMuscle));
  lines.push("", "Remaining repair/cap cleanup:");
  lines.push(...formatShadowRepairList(remainingRepairCleanupRows).split("; ").map((row) => `- ${row}`));
  lines.push("", "Suspicious repairs not eligible for promotion:");
  lines.push(...formatSuspiciousRepairs(suspiciousRepairsForOutput));
  lines.push("", "Promotion candidates:");
  if (promotionCandidates.length > 0) {
    lines.push(...formatPromotionCandidates(promotionCandidates));
  } else {
    lines.push(...formatShadowRepairList(likelyAvoidableRepairs).split("; ").map((row) => `- ${row}`));
  }
  lines.push("", "Pre-selection demand consumed:");
  if (preselectionDemands.length === 0) {
    lines.push("- none");
  } else {
    for (const row of preselectionDemands.slice(0, 10)) {
      lines.push(
        `- ${row.slotId}: ${row.muscle} (${row.role}, ${row.targetStatus}, ${row.source}) ` +
          `selected ${formatPlanningRealityNumber(row.selectedEffectiveSets)} effective sets; ` +
          `consumed=${formatBooleanFlag(row.consumedBySelection)} targetMet=${formatBooleanFlag(row.targetMet)}`
      );
    }
    const remaining = preselectionDemands.length - 10;
    if (remaining > 0) {
      lines.push(`- +${remaining} more`);
    }
  }
  if (weakPreselectionConsumption.length > 0) {
    lines.push("", "Weak pre-selection consumption:");
    for (const row of weakPreselectionConsumption.slice(0, 10)) {
      const target = row.minEffectiveSets ?? row.preferredEffectiveSets;
      lines.push(
        `- ${row.slotId}: ${row.muscle} selected ` +
          `${formatPlanningRealityNumber(row.selectedEffectiveSets)} / target ` +
          `${formatPlanningRealityNumber(target)}, targetMet=${formatBooleanFlag(row.targetMet)}`
      );
    }
    const remaining = weakPreselectionConsumption.length - 10;
    if (remaining > 0) {
      lines.push(`- +${remaining} more`);
    }
  }
  const cleanFeasibilitySummary = buildCleanPreselectionFeasibilitySummaryLines(
    planningReality.preselectionFeasibility
  );
  if (cleanFeasibilitySummary) {
    lines.push("", ...cleanFeasibilitySummary);
  }
  const cleanupFeasibilitySummary =
    buildCleanupCandidateFeasibilitySummaryLines(
      planningReality.cleanupCandidateFeasibility
    );
  if (cleanupFeasibilitySummary) {
    lines.push("", ...cleanupFeasibilitySummary);
  }
  if (planningReality.rearDeltCollateralSummary) {
    const rearDelt = planningReality.rearDeltCollateralSummary;
    lines.push("", "Rear Delts collateral guard:");
    lines.push(`- verdict: ${rearDelt.verdict}`);
    lines.push(
      `- directRearDeltStimulus: ${formatPlanningRealityNumber(rearDelt.directRearDeltStimulusBefore)} -> ${formatPlanningRealityNumber(rearDelt.directRearDeltStimulusAfter)}`
    );
    lines.push(
      `- rearDeltPreselectionConsumed: ${formatBooleanFlag(rearDelt.rearDeltPreselectionConsumed)}`
    );
    lines.push(
      `- upperBackCollateralDelta: ${formatPlanningRealityNumber(rearDelt.upperBackCollateralDelta)}`
    );
    lines.push(
      `- pullPatternConcentrationDelta: ${formatPlanningRealityNumber(rearDelt.pullPatternConcentrationDelta)}`
    );
    lines.push(
      `- suspiciousRepairDelta: ${formatPlanningRealityNumber(rearDelt.suspiciousRepairDelta)}`
    );
    lines.push(
      `- capTrimOrRemovalDelta: ${formatPlanningRealityNumber(rearDelt.capTrimOrRemovalDelta)}`
    );
    lines.push(`- reasons: ${formatNameList(rearDelt.reasons)}`);
  }

  lines.push("", "Warnings:");
  if (materialWarnings.length === 0) {
    lines.push("- none");
  } else {
    for (const warning of materialWarnings) {
      lines.push(`- ${warning.code}: ${formatNameList(warning.evidence, 6)}`);
    }
  }

  lines.push("", "Exercise concentration:");
  if (concentratedExercises.length === 0) {
    lines.push("- none");
  } else {
    for (const row of concentratedExercises.slice(0, 6)) {
      const flags = asArray(row.flags).join(",") || "flagged";
      lines.push(
        `- ${row.slotId} ${row.exerciseName}: ${row.setCount} sets (${flags})`
      );
    }
    const remaining = concentratedExercises.length - 6;
    if (remaining > 0) {
      lines.push(`- +${remaining} more`);
    }
  }

  const setDistributionSummary = buildSetDistributionSummaryLines(
    planningReality.setDistributionIntents,
    planningReality.distributionGuardActions
  );
  if (setDistributionSummary) {
    lines.push("", ...setDistributionSummary);
  }

  const preselectionDistributionPolicySummary =
    buildPreselectionDistributionPolicySummaryLines(
      planningReality.preselectionDistributionPolicyByWeek
    );
  if (preselectionDistributionPolicySummary) {
    lines.push("", ...preselectionDistributionPolicySummary);
  }

  const weeklyDemandCurveSummary = buildWeeklyDemandCurveSummaryLines(
    planningReality.weeklyDemandCurve
  );
  if (weeklyDemandCurveSummary) {
    lines.push("", ...weeklyDemandCurveSummary);
  }

  const slotDemandAllocationByWeekSummary =
    buildSlotDemandAllocationByWeekSummaryLines(
      planningReality.slotDemandAllocationByWeek
    );
  if (slotDemandAllocationByWeekSummary) {
    lines.push("", ...slotDemandAllocationByWeekSummary);
  }

  const exerciseClassDistributionSummary =
    buildExerciseClassDistributionSummaryLines(
      planningReality.exerciseClassDistributionBySlot
    );
  if (exerciseClassDistributionSummary) {
    lines.push("", ...exerciseClassDistributionSummary);
  }

  const exerciseClassAlignmentSummary =
    buildExerciseClassAlignmentSummaryLines(
      planningReality.exerciseClassAlignment
    );
  if (exerciseClassAlignmentSummary) {
    lines.push("", ...exerciseClassAlignmentSummary);
  }
  const exerciseClassUnresolvedCauseSummary =
    buildExerciseClassUnresolvedCauseSummaryLines(
      planningReality.exerciseClassAlignment,
      planningReality.exerciseClassUnresolvedCauses
    );
  if (exerciseClassUnresolvedCauseSummary) {
    lines.push("", ...exerciseClassUnresolvedCauseSummary);
  }

  const duplicateContinuityJustificationSummary =
    buildDuplicateContinuityJustificationSummaryLines(
      planningReality.duplicateContinuityJustification
    );
  if (duplicateContinuityJustificationSummary) {
    lines.push("", ...duplicateContinuityJustificationSummary);
  }

  const accumulationWeekProjectionSummary =
    buildAccumulationWeekProjectionSummaryLines(
      planningReality.accumulationWeekProjection
    );
  if (accumulationWeekProjectionSummary) {
    lines.push("", ...accumulationWeekProjectionSummary);
  }

  const topDownMesocyclePlanSummary = buildTopDownMesocyclePlanSummaryLines(
    planningReality.topDownMesocyclePlan
  );
  if (topDownMesocyclePlanSummary) {
    lines.push("", ...topDownMesocyclePlanSummary);
  }

  lines.push("", "Slot allocation:");
  if (slotDemandAllocation.length === 0) {
    lines.push("- none");
  } else {
    for (const slot of slotDemandAllocation.sort(
      (left, right) => left.slotId.localeCompare(right.slotId)
    )) {
      lines.push(
        `- ${slot.slotId}: ${formatSlotAllocationStatus({
          slot,
          finalDelta: finalDeltaBySlot.get(slot.slotId),
        })}`
      );
    }
  }

  lines.push("", "Architecture implication:");
  lines.push(architectureImplication);

  return lines;
}

export function buildPlannerOnlyDryRunSummary(input: {
  artifact: PlannerOnlyDryRunSummaryArtifact;
}): string[] | null {
  const dryRun = input.artifact.mesocycleExplain?.plannerOnlyDryRun;
  if (!dryRun?.enabled) {
    return null;
  }

  const failedChecks = dryRun.acceptanceChecks
    .filter((check) => check.status === "fail")
    .slice(0, 5)
    .map((check) => `- ${check.check}: ${check.evidence.slice(0, 3).join("; ") || "no evidence"}`);
  const unresolvedSlots = dryRun.slotComparisons
    .filter((slot) => slot.unresolvedDemand.length > 0)
    .slice(0, 5)
    .map((slot) => `- ${slot.slotId}: ${slot.unresolvedDemand.slice(0, 3).join("; ")}`);
  const activeDependencies = dryRun.repairDependencies
    .filter((dependency) => dependency.wouldHaveActed)
    .slice(0, 8)
    .map(
      (dependency) =>
        `- ${dependency.path}: ${dependency.consequenceWithoutRepair}`
    );
  const calvesCandidate = dryRun.calvesFourFourCandidate;
  const policyOverride = dryRun.policyOverride;
  const calvesCandidateLines = calvesCandidate
    ? [
        "",
        "Calves 4+4 Candidate",
        "--------------------",
        `Status: ${calvesCandidate.status}`,
        `Lower A projected calf sets: ${formatPlanningRealityNumber(calvesCandidate.lowerAProjectedCalfSets)}`,
        `Lower B projected calf sets: ${formatPlanningRealityNumber(calvesCandidate.lowerBProjectedCalfSets)}`,
        `Weekly projected calf sets: ${formatPlanningRealityNumber(calvesCandidate.weeklyProjectedCalfEffectiveSets)}`,
        `Would remove lower_b duplicate: ${formatPlannerOnlyNullableBoolean(calvesCandidate.wouldRemoveLowerBSameSessionCalfDuplicate)}`,
        `Lower A safety: ${calvesCandidate.lowerASafety?.status ?? "unknown"}`,
        `Materiality estimate: ${calvesCandidate.materialityEstimate?.status ?? "unknown"}`,
        `Expected deltas: material ${formatPlanningRealityNumber(calvesCandidate.materialityEstimate?.expectedMaterialRepairDelta ?? null)}, major ${formatPlanningRealityNumber(calvesCandidate.materialityEstimate?.expectedMajorRepairDelta ?? null)}, suspicious ${formatPlanningRealityNumber(calvesCandidate.materialityEstimate?.expectedSuspiciousRepairDelta ?? null)}`,
        `Recommendation: ${calvesCandidate.recommendation}`,
        `Remaining blockers: ${calvesCandidate.policyReadiness?.remainingBlockers?.join(", ") || "none"}`,
      ]
    : [];

  return [
    "Planner-Only Dry Run",
    "--------------------",
    `Planner-only dry run: ${dryRun.summary.status}`,
    ...(policyOverride
      ? [
          `Policy override plumbing: ${policyOverride.id} (${policyOverride.status})`,
        ]
      : []),
    "Current repaired projection: pass",
    `Can replace repaired projection today: ${dryRun.canReplaceRepairedProjection ? "yes" : "no"}`,
    `Acceptance: passed=${dryRun.summary.acceptancePassed} failed=${dryRun.summary.acceptanceFailed}`,
    `Unresolved demand count: ${dryRun.summary.unresolvedDemandCount}`,
    `Disabled repair dependency count: ${dryRun.summary.disabledRepairDependencyCount}`,
    "",
    "Failed acceptance checks:",
    ...(failedChecks.length > 0 ? failedChecks : ["- none"]),
    "",
    "Top unresolved demand:",
    ...(unresolvedSlots.length > 0 ? unresolvedSlots : ["- none"]),
    "",
    "Repair dependencies still required:",
    ...(activeDependencies.length > 0 ? activeDependencies : ["- none"]),
    ...calvesCandidateLines,
  ];
}

export function buildActiveMesocycleSlotReseedSummary(input: {
  artifact: Pick<WorkoutAuditArtifact, "activeMesocycleSlotReseed">;
  outputPath: string;
}): string[] | null {
  const payload = input.artifact.activeMesocycleSlotReseed;
  if (!payload) {
    return null;
  }

  const chestDelta =
    payload.aggregateMuscleDiff.find((row) => row.muscle === "Chest")?.delta ?? 0;
  const tricepsDelta =
    payload.aggregateMuscleDiff.find((row) => row.muscle === "Triceps")?.delta ?? 0;
  const sideDeltDelta =
    payload.aggregateMuscleDiff.find((row) => row.muscle === "Side Delts")?.delta ?? 0;
  const changedSlots =
    payload.slotDiffs
      .filter((slot) => slot.exerciseDiff.added.length > 0 || slot.exerciseDiff.removed.length > 0)
      .map((slot) => slot.slotId)
      .join(", ") || "none";

  return [
    `[workout-audit:reseed] mesocycle=${payload.activeMesocycle.mesocycleId} week=${payload.activeMesocycle.week} verdict=${payload.recommendation.verdict}`,
    `[workout-audit:reseed] slots=${payload.activeMesocycle.targetSlotIds.join(", ")} changed_slots=${changedSlots}`,
    `[workout-audit:reseed] push_delta=Chest:${formatSignedSetDelta(chestDelta)}, Triceps:${formatSignedSetDelta(tricepsDelta)}, Side Delts:${formatSignedSetDelta(sideDeltDelta)}`,
    `[workout-audit:reseed] guards=slot_identity:${formatBooleanFlag(payload.flags.preservesSlotIdentity)} row_vertical_pull:${formatBooleanFlag(payload.flags.preservesRowAndVerticalPullWhereAppropriate)} overshoot_clear:${formatBooleanFlag(payload.flags.avoidsNewObviousOvershoot)}`,
    `[workout-audit:reseed] artifact=${input.outputPath}`,
  ];
}

export function buildActiveMesocycleSlotReseedApplySummary(input: {
  result:
    | {
        mesocycleId: string;
        targetSlotIds: string[];
        changedSlotIds: string[];
        applied: boolean;
      }
    | null;
}): string[] | null {
  if (!input.result) {
    return null;
  }

  return [
    `[workout-audit:reseed:apply] mesocycle=${input.result.mesocycleId} applied=${input.result.applied ? "yes" : "no"} changed_slots=${input.result.changedSlotIds.join(", ") || "none"}`,
    `[workout-audit:reseed:apply] targeted_slots=${input.result.targetSlotIds.join(", ")}`,
  ];
}

export function buildReplaceEmptyMesocycleWithV2Summary(input: {
  artifact: Pick<WorkoutAuditArtifact, "replaceEmptyMesocycleWithV2">;
  outputPath: string;
}): string[] | null {
  const payload = input.artifact.replaceEmptyMesocycleWithV2;
  if (!payload) {
    return null;
  }

  const safetyBlockers = payload.candidateSafety.blockers.join(",") || "none";
  const v2Blockers = payload.v2Preparation.blockers.join(",") || "none";
  const changedSlots = payload.seedComparison.changedSlotIds.join(", ") || "none";

  return [
    `[workout-audit:replace-empty-v2] mesocycle=${payload.targetMesocycleId} dry_run=${formatBooleanFlag(payload.dryRun)} write_eligible=${formatBooleanFlag(payload.write.eligible)}`,
    `[workout-audit:replace-empty-v2] safety_allowed=${formatBooleanFlag(payload.candidateSafety.allowed)} safety_blockers=${safetyBlockers}`,
    `[workout-audit:replace-empty-v2] v2_status=${payload.v2Preparation.status} base=${payload.v2Preparation.basePlanValidation.status} materializer=${payload.v2Preparation.materializerStatus} promotion=${payload.v2Preparation.promotionReadinessStatus} seed_shape=${formatBooleanFlag(payload.v2Preparation.seedShapeCompatibility.compatible)} blockers=${v2Blockers}`,
    `[workout-audit:replace-empty-v2] seed_sets=${formatAuditValue(payload.seedComparison.totalSetCount.current)}->${formatAuditValue(payload.seedComparison.totalSetCount.v2)} changed_slots=${changedSlots}`,
    `[workout-audit:replace-empty-v2] boundary serializer=${payload.seedRuntimeBoundary.serializer} runtime_replay_unchanged=${formatBooleanFlag(payload.seedRuntimeBoundary.runtimeReplayUnchanged)} db_write=${formatBooleanFlag(payload.provenance.dbWriteOccurred)} transaction=${payload.provenance.transactionStatus}`,
    `[workout-audit:replace-empty-v2] artifact=${input.outputPath}`,
  ];
}

export function buildV2AcceptedSeedPrepareCompareSummary(input: {
  artifact: Pick<WorkoutAuditArtifact, "v2AcceptedSeedPrepareCompare">;
  outputPath: string;
  sizeBytes: number;
}): string[] | null {
  const payload = input.artifact.v2AcceptedSeedPrepareCompare;
  if (!payload) {
    return null;
  }

  const identity = payload.identityCoverageComparison.identitySummary;
  const seedShape = payload.seedShapeComparison;
  const slotOrder =
    seedShape.slotIdsInOrder.legacy.length > 0 ||
    seedShape.slotIdsInOrder.v2.length > 0
      ? `${seedShape.slotIdsInOrder.legacy.join(">") || "none"} -> ${seedShape.slotIdsInOrder.v2.join(">") || "none"}`
      : "none";
  const productionGateMissing =
    payload.provenance.productionGates.missing.join(",") || "none";

  return [
    `[workout-audit:v2-seed-compare] handoff_candidate=${formatBooleanFlag(payload.handoffCandidate.found)} mesocycle=${formatAuditValue(payload.handoffCandidate.mesocycleId)} status=${payload.compareStatus}`,
    `[workout-audit:v2-seed-compare] boundary read_only=${formatBooleanFlag(payload.boundaryFacts.readOnly)} no_write=${formatBooleanFlag(payload.boundaryFacts.noWrite)} consumed_by_production=${formatBooleanFlag(payload.boundaryFacts.consumedByProduction)} serializer=${payload.boundaryFacts.seedSerializer}`,
    `[workout-audit:v2-seed-compare] availability legacy=${formatBooleanFlag(payload.availability.legacyPreparationAvailable)} v2_preview=${formatBooleanFlag(payload.availability.v2PreparationPreviewAvailable)} production_write_eligible=${formatBooleanFlag(payload.boundaryFacts.v2ProductionWriteEligible)} fail_closed=${formatBooleanFlag(payload.availability.v2BlockedFailClosed)}`,
    `[workout-audit:v2-seed-compare] v2_path legacy_projection_called=${formatBooleanFlag(payload.boundaryFacts.legacyProjectionCalledByV2Path)} repair_called=${formatBooleanFlag(payload.boundaryFacts.repairCalledByV2Path)} transaction=${payload.boundaryFacts.transactionStatus}`,
    `[workout-audit:v2-seed-compare] seed_shape classification=${seedShape.classification} slots=${slotOrder} total_sets=${formatAuditValue(seedShape.totalSetCount.legacy)}->${formatAuditValue(seedShape.totalSetCount.v2)} executable_shape=${seedShape.executableFieldShape.classification}`,
    `[workout-audit:v2-seed-compare] identity same=${identity.sameExercise} added=${identity.v2Added} removed=${identity.v2Removed} clean_alt=${identity.cleanAlternative} class_equiv=${identity.classEquivalentDifference} unclear=${identity.unclear} not_comparable=${identity.notComparable}`,
    `[workout-audit:v2-seed-compare] gates base=${payload.provenance.baseValidationStatus} materializer=${payload.provenance.materializerStatus} seed_shape=${formatBooleanFlag(payload.provenance.seedShapeCompatibility.compatible)} promotion=${payload.provenance.promotionReadinessStatus} production_gates_missing=${productionGateMissing}`,
    `[workout-audit:v2-seed-compare] artifact=${input.outputPath} size_bytes=${input.sizeBytes}`,
  ];
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
    (row) => isHardTargetProjectionRow(row) && row.deltaToMev < 0,
    (row) => row.deltaToMev,
    "ascending"
  );
  const belowTargetOnly = formatMuscleBucket(
    projectedWeekVolume.fullWeekByMuscle,
    (row) => isHardTargetProjectionRow(row) && row.deltaToTarget < 0 && row.deltaToMev >= 0,
    (row) => row.deltaToTarget,
    "ascending"
  );
  const overMav = formatMuscleBucket(
    projectedWeekVolume.fullWeekByMuscle,
    (row) => isHardTargetProjectionRow(row) && row.deltaToMav > 0,
    (row) => row.deltaToMav,
    "descending"
  );
  const overTargetOnly = formatMuscleBucket(
    projectedWeekVolume.fullWeekByMuscle,
    (row) => isHardTargetProjectionRow(row) && row.deltaToTarget > 0 && row.deltaToMav <= 0,
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
    (row) => isHardTargetProjectionRow(row) && row.deltaToMev < 0,
    (row) => row.deltaToMev,
    "ascending"
  );
  const belowTargetOnlyRows = selectMuscleRows(
    projectedWeekVolume.fullWeekByMuscle,
    (row) => isHardTargetProjectionRow(row) && row.deltaToTarget < 0 && row.deltaToMev >= 0,
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

export function buildPlannerOnlyNoRepairSummary(input: {
  artifact: PlannerOnlyDryRunSummaryArtifact;
}): string[] | null {
  const noRepair = input.artifact.mesocycleExplain?.plannerOnlyNoRepair;
  if (!noRepair) {
    return null;
  }

  const classification = noRepair.acceptanceClassification;
  const formatStatus = (status: string): string =>
    status.replaceAll("_", "-");
  const migrationStatus = classification.migrationScoreboard
    .canReplaceRepairedProjection
    ? "ready"
    : "not-ready";
  const formatFindings = (
    findings: typeof classification.hardBlockers
  ): string =>
    findings.length > 0
      ? findings
          .slice(0, 6)
          .map(
            (finding) =>
              `${finding.code}: ${finding.evidence.slice(0, 3).join("; ")}`
          )
          .join(" | ")
      : "none";

  const v2Plan = noRepair.v2MesocyclePlan;
  const baseLines = [
    "Planner-Only No-Repair Acceptance",
    "---------------------------------",
    `Basic shape: ${formatStatus(classification.basicMesocycleShapeStatus)}`,
    `Replacement readiness: ${formatStatus(classification.replacementReadinessStatus)}`,
    `Hard blockers: ${classification.hardBlockers.length}`,
    `Hard blocker details: ${formatFindings(classification.hardBlockers)}`,
    `Quality warnings: ${classification.qualityWarnings.length}`,
    `Quality warning details: ${formatFindings(classification.qualityWarnings)}`,
    `Diagnostic rows: ${classification.diagnosticOnly.length}`,
    `Session-shaping rows: ${classification.sessionShaping.length}`,
    `Migration scoreboard: ${migrationStatus}`,
  ];
  if (!v2Plan) {
    return baseLines;
  }
  const strategy = noRepair.v2MesocycleStrategyDiagnostic;
  const strategySourceCounts =
    strategy?.strategyInputSummary.historicalSourcePlannerCounts;
  const strategyResponse = strategy?.responseEvidenceSummary;
  const strategyImplications = strategyResponse?.strategyImplicationCounts;
  const exerciseSignals = strategyResponse?.exerciseSignalsByType;
  const responseConfidence = strategyResponse?.confidenceDistribution;
  const continuityEvidence = strategy?.continuityVariationEvidence;
  const volumeFatigueEvidence = strategy?.volumeFatigueStrategyEvidence;
  const strategyRecommendation = strategy?.strategyRecommendation;
  const recommendationHypotheses = strategyRecommendation?.hypotheses ?? [];
  const strategyPromotionReadiness =
    strategy?.strategyHypothesisPromotionReadiness;
  const strategyPromotionDiff = strategy?.strategyHypothesisPromotionDiff;
  const promotionReadinessRows =
    strategyPromotionReadiness?.hypothesisReadiness ?? [];
  const recommendationPriorityCounts = recommendationHypotheses.reduce<
    Record<"P0" | "P1" | "P2", number>
  >(
    (counts, hypothesis) => {
      counts[hypothesis.priority] += 1;
      return counts;
    },
    { P0: 0, P1: 0, P2: 0 },
  );
  const countPromotionRowsBy = (
    field: "readiness" | "proposedOwner" | "nextSafeAction",
  ): Record<string, number> =>
    promotionReadinessRows.reduce<Record<string, number>>((counts, row) => {
      const key = row[field];
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {});
  const promotionReadinessCounts = countPromotionRowsBy("readiness");
  const promotionOwnerCounts = countPromotionRowsBy("proposedOwner");
  const promotionActionCounts = countPromotionRowsBy("nextSafeAction");
  const promotionTopMissingEvidence = Array.from(
    new Set(promotionReadinessRows.flatMap((row) => row.missingEvidence)),
  ).slice(0, 6);
  const promotionDiffGateValues = Object.values(
    strategyPromotionDiff?.nonRegressionGates ?? {},
  ).filter((entry): entry is boolean => typeof entry === "boolean");
  const promotionDiffReportedGateCount = promotionDiffGateValues.filter(
    Boolean,
  ).length;
  const promotionDiffTargetTierExamples =
    strategyPromotionDiff?.protectLaggingMusclesEarlier
      .recurringUnderHitMuscles.length
      ? strategyPromotionDiff.protectLaggingMusclesEarlier
          .recurringUnderHitMuscles
      : (strategyPromotionDiff?.protectLaggingMusclesEarlier
          .targetTierMuscles ?? []);
  const promotionDiffSkippedEvidence =
    strategyPromotionDiff?.capLateBlockVolume.skippedSetEvidence;
  const promotionProjectionDiff = strategyPromotionDiff?.projectionDiff;
  const promotionProjectionPreference =
    promotionProjectionDiff?.candidateStrategy.redistributionPreference;
  const donorSurplusEvidence = strategyPromotionDiff?.donorSurplusEvidence;
  const donorSurplusSummary = donorSurplusEvidence?.summary;
  const promotionProjectionGateValues = Object.values(
    promotionProjectionDiff?.computedNonRegressionGates ?? {},
  );
  const promotionProjectionGateCounts = {
    pass: promotionProjectionGateValues.filter((entry) => entry === "pass")
      .length,
    fail: promotionProjectionGateValues.filter((entry) => entry === "fail")
      .length,
    unknown: promotionProjectionGateValues.filter(
      (entry) => entry === "unknown",
    ).length,
  };
  const promotionProjectionConflictAware =
    promotionProjectionDiff?.conflictAwareRefinement;
  const promotionProjectionConflictCounts =
    promotionProjectionConflictAware?.conflictCountsByType ?? {};
  const promotionProjectionConflictCount =
    promotionProjectionConflictAware?.conflicts.length ??
    Object.values(promotionProjectionConflictCounts).reduce(
      (sum, value) => sum + (typeof value === "number" ? value : 0),
      0,
    );
  const promotionProjectionPreShadow =
    promotionProjectionDiff?.preShadowCandidateFilter;
  const promotionProjectionPreShadowOverride =
    promotionProjectionPreShadow?.overrideConstruction;
  const promotionProjectionPreShadowEligibleDonors =
    promotionProjectionPreShadow?.donorEligibility.filter((row) => row.eligible)
      .length ?? 0;
  const promotionProjectionPreShadowExcludedDonors =
    promotionProjectionPreShadowOverride?.excludedDonors.length ?? 0;
  const promotionProjectionPreShadowRetainedProtected =
    promotionProjectionPreShadowOverride?.retainedProtectedMuscles.length ?? 0;
  const promotionProjectionPreShadowExcludedProtected =
    promotionProjectionPreShadowOverride?.excludedProtectedMuscles.length ?? 0;
  const slotOwnedDemandAdjustmentPlan =
    strategyPromotionDiff?.slotOwnedDemandAdjustmentPlan;
  const slotOwnedDemandFeasibility =
    slotOwnedDemandAdjustmentPlan?.feasibility;
  const slotOwnedDemandEligibleDonors =
    slotOwnedDemandAdjustmentPlan?.donorDemand.filter((row) => row.eligible)
      .length ?? 0;
  const strategyLines = strategy
    ? [
        "V2 Mesocycle Strategy Diagnostic",
        "---------------------------------",
        `Status: ${formatStatus(strategy.status)}`,
        `Phase: ${formatStatus(strategy.phaseStrategy.proposedPhase)} (${strategy.phaseStrategy.confidence} confidence)`,
        `Demand source: ${formatStatus(strategy.demandDerivationPlan.currentDemandSource)} -> ${formatStatus(strategy.demandDerivationPlan.targetDemandSource)}`,
        `Missing profile inputs: ${strategy.userTrainingProfileInputs.missing.length}`,
        `Strategy input groups: present=${strategy.strategyInputSummary.presentGroups.join(",") || "none"} missing=${strategy.strategyInputSummary.missingGroups.join(",") || "none"}`,
        `Strategy historical mesocycles: ${strategy.strategyInputSummary.historicalMesocycleCount}`,
        `Strategy source planners: legacy_projection=${strategySourceCounts?.legacy_projection ?? 0} v2=${strategySourceCounts?.v2 ?? 0} unknown=${strategySourceCounts?.unknown ?? 0}`,
        `Strategy evidence categories: ${strategy.strategyInputSummary.evidenceCategoriesAvailable.join(",") || "none"}`,
        `Block response signals: ${strategyResponse?.blockResponseSignalCount ?? 0}`,
        `Strategy implications: protect=${strategyImplications?.protect_lagging_muscles_earlier ?? 0} capLate=${strategyImplications?.cap_late_block_volume ?? 0} reduceFatigue=${strategyImplications?.reduce_axial_or_overlap_fatigue ?? 0} preserveProgression=${strategyImplications?.preserve_successful_progression ?? 0} deload=${strategyImplications?.improve_deload_execution ?? 0} unknown=${strategyImplications?.unknown ?? 0}`,
        `Recurring under-hit examples: ${formatNameList(strategyResponse?.recurringUnderHitMuscleExamples ?? [], 5)}`,
        `Recurring over-concentration examples: ${formatNameList(strategyResponse?.recurringOverConcentrationExamples ?? [], 5)}`,
        `Exercise response signals: ${strategyResponse?.exerciseResponseSignalCount ?? 0}`,
        `Exercise signals: progressed=${exerciseSignals?.progressed ?? 0} stalled=${exerciseSignals?.stalled ?? 0} regressed=${exerciseSignals?.regressed ?? 0} skipped=${exerciseSignals?.skipped_often ?? 0} swapped=${exerciseSignals?.swapped_out ?? 0} pain=${exerciseSignals?.pain_or_tolerance_issue ?? 0} fatigue=${exerciseSignals?.high_fatigue_cost ?? 0} low=${exerciseSignals?.low_confidence ?? 0} unknown=${exerciseSignals?.unknown ?? 0}`,
        `Response confidence: low=${responseConfidence?.low ?? 0} medium=${responseConfidence?.medium ?? 0} high=${responseConfidence?.high ?? 0}`,
        `Evidence limitations: ${strategyResponse?.evidenceLimitations.length ?? 0}`,
        `Continuity/variation evidence: ${formatStatus(continuityEvidence?.status ?? "not_available")} keep=${continuityEvidence?.keepCandidateCount ?? 0} rotate=${continuityEvidence?.rotateCandidateCount ?? 0} avoid=${continuityEvidence?.avoidCandidateCount ?? 0} low=${continuityEvidence?.lowConfidenceCount ?? 0}`,
        `Materializer ranking evidence usable: ${strategyResponse?.usableForFutureMaterializerRanking ? "yes" : "no"}`,
        `Volume/fatigue evidence: ${formatStatus(volumeFatigueEvidence?.status ?? "not_available")} protect=${volumeFatigueEvidence?.protectLaggingMuscleSignals.length ?? 0} over=${volumeFatigueEvidence?.overConcentrationSignals.length ?? 0} late=${volumeFatigueEvidence?.lateBlockFatigueSignals.length ?? 0} deload=${volumeFatigueEvidence?.deloadExecutionSignals.length ?? 0}`,
        `Strategy recommendation: ${formatStatus(strategyRecommendation?.status ?? "not_available")} phase=${formatStatus(strategyRecommendation?.recommendedPhase ?? "unknown")} confidence=${strategyRecommendation?.confidence ?? "low"} hypotheses=${recommendationHypotheses.length}`,
        `Recommendation hypotheses: ${formatNameList(recommendationHypotheses.map((hypothesis) => hypothesis.id), 8)}`,
        `Recommendation priorities: P0=${recommendationPriorityCounts.P0} P1=${recommendationPriorityCounts.P1} P2=${recommendationPriorityCounts.P2}`,
        `Recommendation evidence examples: ${formatNameList(recommendationHypotheses.flatMap((hypothesis) => hypothesis.evidence).slice(0, 6), 6)}`,
        `Recommendation promotion blockers: ${formatNameList(recommendationHypotheses.flatMap((hypothesis) => hypothesis.promotionBlockers).slice(0, 6), 6)}`,
        "Recommendations consumed by demand/materializer: no",
        `Promotion readiness: ${formatStatus(strategyPromotionReadiness?.status ?? "not_ready")} hypotheses=${promotionReadinessRows.length}`,
        `Promotion readiness counts: not_ready=${promotionReadinessCounts.not_ready ?? 0} needs_more_evidence=${promotionReadinessCounts.needs_more_evidence ?? 0} needs_owner=${promotionReadinessCounts.needs_owner ?? 0} needs_non_regression_gates=${promotionReadinessCounts.needs_non_regression_gates ?? 0} ready_for_read_only_diff=${promotionReadinessCounts.ready_for_read_only_diff ?? 0} ready_for_bounded_trial=${promotionReadinessCounts.ready_for_bounded_trial ?? 0}`,
        `Promotion owner counts: MesocycleDemand=${promotionOwnerCounts.MesocycleDemand ?? 0} WeeklyDemandCurve=${promotionOwnerCounts.WeeklyDemandCurve ?? 0} SlotDemandAllocation=${promotionOwnerCounts.SlotDemandAllocation ?? 0} ExerciseSelectionStrategy=${promotionOwnerCounts.ExerciseSelectionStrategy ?? 0} MaterializerRanking=${promotionOwnerCounts.MaterializerRanking ?? 0} DeloadPlan=${promotionOwnerCounts.DeloadPlan ?? 0} RuntimeUX=${promotionOwnerCounts.RuntimeUX ?? 0} unknown=${promotionOwnerCounts.unknown ?? 0}`,
        `Promotion next actions: collect=${promotionActionCounts.collect_more_evidence ?? 0} read_only_diff=${promotionActionCounts.add_read_only_diff ?? 0} audit_gate=${promotionActionCounts.add_audit_gate ?? 0} bounded_trial=${promotionActionCounts.run_bounded_trial ?? 0} do_not_promote=${promotionActionCounts.do_not_promote ?? 0}`,
        `Promotion missing evidence: ${formatNameList(promotionTopMissingEvidence, 6)}`,
        `Promotion global blockers: ${formatNameList(strategyPromotionReadiness?.globalBlockers ?? [], 6)}`,
        "Promotion readiness consumed by demand/materializer: no",
        `Promotion diff gate: ${formatStatus(strategyPromotionDiff?.status ?? "not_available")} evaluated=${strategyPromotionDiff?.evaluatedHypotheses.length ?? 0} next=${formatStatus(strategyPromotionDiff?.nextSafeAction ?? "do_not_promote")}`,
        `Promotion diff hypotheses: ${formatNameList(strategyPromotionDiff?.evaluatedHypotheses ?? [], 4)}`,
        `Promotion diff target-tier under-hit: ${formatNameList(promotionDiffTargetTierExamples, 6)}`,
        `Promotion diff hard-week skipped-set signal: ${promotionDiffSkippedEvidence?.hardWeekSkippedSetSignal ? "yes" : "no"} examples=${formatNameList(promotionDiffSkippedEvidence?.examples ?? [], 5)}`,
        `Promotion diff interaction risk: ${formatStatus(strategyPromotionDiff?.interactionRisk.status ?? "not_evaluated")} ${formatNameList(strategyPromotionDiff?.interactionRisk.risks ?? [], 3)}`,
        `Promotion diff non-regression gates: reported=${promotionDiffReportedGateCount}/${promotionDiffGateValues.length} enforced=no`,
        `Promotion projection diff: ${formatStatus(promotionProjectionDiff?.status ?? "not_available")} mode=${formatStatus(promotionProjectionDiff?.projectionMode ?? "not_projected")} readiness=${formatStatus(promotionProjectionDiff?.readiness ?? "not_ready")}`,
        `Promotion projection candidates: protected=${promotionProjectionPreference?.candidateProtectedMuscles.length ?? 0} donors=${promotionProjectionPreference?.candidateDonorMuscles.length ?? 0}`,
        `Promotion donor surplus evidence: ${formatStatus(donorSurplusEvidence?.status ?? "not_available")} candidates=${donorSurplusSummary?.candidateCount ?? 0} measuredMargin=${donorSurplusSummary?.measuredMarginCount ?? 0} eligible=${donorSurplusSummary?.eligibleCount ?? 0} ineligible=${donorSurplusSummary?.ineligibleCount ?? 0} unknownMargin=${donorSurplusSummary?.unknownMarginCount ?? 0} protectedOverlap=${donorSurplusSummary?.protectedOverlapCount ?? 0} slotIncompatible=${donorSurplusSummary?.slotIncompatibleCount ?? 0}`,
        `Promotion projection pre-shadow filter: ${formatStatus(promotionProjectionPreShadow?.status ?? "not_available")} eligibleDonors=${promotionProjectionPreShadowEligibleDonors} excludedDonors=${promotionProjectionPreShadowExcludedDonors} retainedProtected=${promotionProjectionPreShadowRetainedProtected} excludedProtected=${promotionProjectionPreShadowExcludedProtected}`,
        `Promotion projection gates: pass=${promotionProjectionGateCounts.pass} fail=${promotionProjectionGateCounts.fail} unknown=${promotionProjectionGateCounts.unknown}`,
        `Promotion projection conflict-aware: ${formatStatus(promotionProjectionConflictAware?.status ?? "not_available")} conflicts=${promotionProjectionConflictCount} protected-donor=${promotionProjectionConflictCounts.protected_donor_overlap ?? 0} floor=${promotionProjectionConflictCounts.floor_preservation_conflict ?? 0} slot-owner=${promotionProjectionConflictCounts.slot_owner_missing ?? 0} session-size=${promotionProjectionConflictCounts.session_size_cap_conflict ?? 0} net-new=${promotionProjectionConflictCounts.net_new_volume_blocked ?? 0}`,
        `Promotion projection limitations: ${formatNameList(promotionProjectionDiff?.limitations ?? [], 5)}`,
        `Promotion slot-owned demand adjustment: ${formatStatus(slotOwnedDemandAdjustmentPlan?.status ?? "not_available")} feasibility=${formatStatus(slotOwnedDemandFeasibility?.status ?? "unknown")} protected=${slotOwnedDemandAdjustmentPlan?.protectedDemand.length ?? 0} donors=${slotOwnedDemandAdjustmentPlan?.donorDemand.length ?? 0} eligibleDonors=${slotOwnedDemandEligibleDonors} blocking=${slotOwnedDemandFeasibility?.blockingReasons.length ?? 0} unresolved=${slotOwnedDemandFeasibility?.unresolvedInputs.length ?? 0} next=${formatStatus(slotOwnedDemandAdjustmentPlan?.nextSafeAction ?? "do_not_promote")}`,
        `Promotion projection consumedByDemandOrMaterializer: ${Boolean(promotionProjectionDiff?.consumedByDemandOrMaterializer) ? "true" : "false"}`,
        `Promotion diff consumedByDemandOrMaterializer: ${Boolean(strategyPromotionDiff?.consumedByDemandOrMaterializer) ? "true" : "false"}`,
        `Performed history loaded: ${strategy.strategyInputSummary.performedHistoryEvidenceLoaded ? "yes" : "no"}`,
        `Old prescribed plan shape excluded: ${strategy.strategyInputSummary.prescribedPlanShapeExcludedFromStrategyPolicy ? "yes" : "no"}`,
        `North-star gaps: ${strategy.currentStateVsNorthStarGaps.length}`,
      ]
    : [];
  const repairScoreboard = noRepair.repairPromotionScoreboard;
  const basePlanCompare = noRepair.v2BasePlanCompare;
  const shadowConsumption = noRepair.v2BasePlanShadowConsumptionTrial;
  const basePlanCompareLines = basePlanCompare
    ? [
        "V2 Base Plan Compare",
        "--------------------",
        `Status: ${formatStatus(basePlanCompare.status)}`,
        `Compared plans: v2=${basePlanCompare.comparedPlans.v2BasePlanAvailable ? "yes" : "no"} noRepair=${basePlanCompare.comparedPlans.plannerOnlyNoRepairAvailable ? "yes" : "no"} repaired=${basePlanCompare.comparedPlans.repairedPlanAvailable ? "yes" : "no"}`,
        `Set totals: v2=${basePlanCompare.summary.v2TotalSets ?? "n/a"} noRepair=${basePlanCompare.summary.noRepairTotalSets ?? "n/a"} repaired=${basePlanCompare.summary.repairedTotalSets ?? "n/a"}`,
        `Repair dependencies: ${basePlanCompare.summary.repairDependencyCount ?? 0}`,
        `V2 compare classifications: improves=${basePlanCompare.summary.v2ImprovementCount} regresses=${basePlanCompare.summary.v2RegressionCount} unclear=${basePlanCompare.summary.unclearCount}`,
        `Next safe action: ${formatStatus(basePlanCompare.nextSafeAction)}`,
        `Read-only/no generation impact: ${basePlanCompare.readOnly && !basePlanCompare.affectsScoringOrGeneration ? "yes" : "no"}`,
      ]
    : [];
  const shadowConsumptionLines = shadowConsumption
    ? [
        "V2 Base Plan Shadow Consumption",
        "--------------------------------",
        `Status: ${formatStatus(shadowConsumption.status)}`,
        `Compared plans: v2=${shadowConsumption.comparedPlans.v2BasePlanAvailable ? "yes" : "no"} shadow=${shadowConsumption.comparedPlans.shadowConsumedPlanAvailable ? "yes" : "no"} noRepair=${shadowConsumption.comparedPlans.plannerOnlyNoRepairAvailable ? "yes" : "no"} repaired=${shadowConsumption.comparedPlans.repairedPlanAvailable ? "yes" : "no"}`,
        `Set totals: shadow=${shadowConsumption.summary.shadowTotalSets ?? "n/a"} v2=${shadowConsumption.summary.v2BaseTotalSets ?? "n/a"} noRepair=${shadowConsumption.summary.noRepairTotalSets ?? "n/a"} repaired=${shadowConsumption.summary.repairedTotalSets ?? "n/a"}`,
        `Repair dependency delta: ${shadowConsumption.summary.repairDependencyDelta ?? "n/a"} remaining=${shadowConsumption.summary.shadowRemainingRepairDependencyCount ?? "n/a"} current=${shadowConsumption.summary.currentRepairDependencyCount ?? "n/a"}`,
        `Shadow classifications: improves=${shadowConsumption.summary.improvementCount} preserves=${shadowConsumption.summary.preservationCount} regresses=${shadowConsumption.summary.regressionCount} unclear=${shadowConsumption.summary.unclearCount} notComparable=${shadowConsumption.summary.notComparableCount}`,
        `Identity differences categorized: ${shadowConsumption.summary.categorizedIdentityDifferenceCount}`,
        `Consumed by production: ${shadowConsumption.consumedByProduction ? "yes" : "no"}`,
        `Next safe action: ${formatStatus(shadowConsumption.nextSafeAction)}`,
        `Read-only/no generation impact: ${shadowConsumption.readOnly && !shadowConsumption.affectsScoringOrGeneration ? "yes" : "no"}`,
      ]
    : [];
  const materializationShardLines = basePlanCompare || shadowConsumption
    ? [
        "V2 base-plan compare/shadow detail: v2-materialization shard when --v2-debug-artifact is enabled",
      ]
    : [];
  const repairScoreboardLines = repairScoreboard
    ? [
        "V2 Repair Promotion Scoreboard",
        "------------------------------",
        `Raw repair evidence: material=${repairScoreboard.rawRepairEvidence.materialRepairCount} major=${repairScoreboard.rawRepairEvidence.majorRepairCount} likely-avoidable=${repairScoreboard.rawRepairEvidence.likelyAvoidableMaterialRepairCount} remaining=${repairScoreboard.rawRepairEvidence.remainingMaterialRepairCount} suspicious=${repairScoreboard.rawRepairEvidence.suspiciousRepairCount}`,
        `Promotion candidates: ${repairScoreboard.summary.promotionCandidateCount}`,
        `Safety/do-not-promote: ${repairScoreboard.summary.safetyNetCount}`,
        `Collateral/diagnostic: ${repairScoreboard.summary.collateralDiagnosticCount + repairScoreboard.summary.diagnosticOnlyCount}`,
        `Candidate rows: ${
          repairScoreboard.promotionCandidates.length > 0
            ? repairScoreboard.promotionCandidates
                .slice(0, 9)
                .map(
                  (row) =>
                    `${row.slotId} ${row.muscle} via ${row.exerciseName ?? "unknown"} -> ${row.correctOwner}`
                )
                .join("; ")
            : "none"
        }`,
      ]
    : [];
  const diff = noRepair.v2TargetVsNoRepairDiff;
  const diffLines = diff
    ? [
        "V2 Target vs No-Repair Diff",
        "----------------------------",
        `Lane status: satisfied=${diff.summary.satisfiedLaneCount} partial=${diff.summary.partialLaneCount} missing=${diff.summary.missingLaneCount} blocked=${diff.summary.blockedLaneCount} repair-dependent=${diff.summary.repairDependentLaneCount}`,
        `Migration candidates: ${diff.summary.migrationCandidateCount}`,
        `Suspicious or blocked: ${diff.summary.suspiciousOrBlockedCount}`,
        `Next migration slice: ${diff.replacementReadinessImpact.nextBestMigrationSlice ?? "none"}`,
      ]
    : [];

  return [
    ...baseLines,
    ...strategyLines,
    "V2 Mesocycle Plan",
    "-----------------",
    `Status: ${formatStatus(v2Plan.planStatus)}`,
    "Skeleton: upper/lower 4x",
    `Week 1: ${formatStatus(classification.basicMesocycleShapeStatus)}`,
    "Weeks 2-4: derived progression model, limited projection",
    v2Plan.deloadTransform.projectionStatus === "partially_modeled"
      ? "Deload: transform defined, not production-projected"
      : `Deload: ${formatStatus(v2Plan.deloadTransform.projectionStatus)}`,
    `Replacement readiness: ${formatStatus(classification.replacementReadinessStatus)}`,
    ...basePlanCompareLines,
    ...shadowConsumptionLines,
    ...materializationShardLines,
    ...repairScoreboardLines,
    ...diffLines,
  ];
}

export function buildV2DebugArtifactSummary(input: {
  filePath: string;
  sizeBytes: number;
  sha256: string;
  shards?: Array<{
    id: string;
    filePath: string;
    detailLevel: string;
    sizeBytes: number;
    sha256: string;
  }>;
}): string[] {
  return [
    `[workout-audit:v2-debug] index=${input.filePath}`,
    `[workout-audit:v2-debug] index_size_bytes=${input.sizeBytes} sha256=${input.sha256}`,
    ...(
      input.shards?.map(
        (shard) =>
          `[workout-audit:v2-debug] shard=${shard.id} detail=${shard.detailLevel} artifact=${shard.filePath} size_bytes=${shard.sizeBytes} sha256=${shard.sha256}`,
      ) ?? []
    ),
  ];
}

export function buildCurrentWeekAuditOperatorSummary(input: {
  artifact: Pick<WorkoutAuditArtifact, "projectedWeekVolume">;
}): string[] | null {
  const projectedWeekVolume = input.artifact.projectedWeekVolume;
  const currentWeekAudit = projectedWeekVolume?.currentWeekAudit;
  if (!projectedWeekVolume || !currentWeekAudit) {
    return null;
  }

  const interventionHints =
    projectedWeekVolume.interventionHints
      ?.map((hint) => `${hint.muscle}:${hint.suggestedSets} sets (${hint.reason})`)
      .join("; ") || "none";
  const sessionRisks =
    projectedWeekVolume.sessionRisks
      ?.map((risk) => `${risk.slotId}: ${risk.issue}`)
      .join("; ") || "none";

  return [
    `[workout-audit:current-week] below_mev=${formatCurrentWeekList(currentWeekAudit.belowMEV)} under_target_clusters=${formatCurrentWeekUnderTargetClusters(currentWeekAudit.underTargetClusters)} over_mav=${formatCurrentWeekList(currentWeekAudit.overMAV)}`,
    `[workout-audit:current-week] fatigue_risks=${formatCurrentWeekList(currentWeekAudit.fatigueRisks, 3)}`,
    `[workout-audit:current-week] intervention_hints=${interventionHints}`,
    `[workout-audit:current-week] session_risks=${sessionRisks}`,
  ];
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
  const projectionDrift = weeklyRetro.projectionDeliveryDrift;
  const planAdherence = weeklyRetro.planAdherence;
  const explainedByIntent = Object.entries(planAdherence.explainedAdditions.byIntent)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([intent, sets]) => `${intent}:${formatSignedSetDelta(sets ?? 0)}`)
    .join(", ") || "none";

  const lines = [
    `[workout-audit:retro] load_calibration=${weeklyRetro.loadCalibration.status} comparable_sessions=${weeklyRetro.loadCalibration.comparableSessionCount} drift_sessions=${weeklyRetro.loadCalibration.driftSessionCount} legacy_limited=${weeklyRetro.loadCalibration.legacyLimitedSessionCount}`,
    `[workout-audit:retro] plan_adherence planned_completed=${planAdherence.plannedWorkCompletedPercent}% (${planAdherence.plannedWorkCompletedSets}/${planAdherence.plannedWorkTotalSets} sets) missed=${planAdherence.plannedWorkMissedSets} explained_additions=${formatSignedSetDelta(planAdherence.explainedAdditions.totalSets)} substitutions=${planAdherence.substitutions} unclassified=${planAdherence.unclassifiedDrift} engine_confidence=${planAdherence.engineConfidenceImpact}`,
    `[workout-audit:retro] explained_additions_by_intent=${explainedByIntent}`,
    `[workout-audit:retro] under_target=${underTargetRows || "none"}`,
    `[workout-audit:retro] interventions=${interventions}`,
    `[workout-audit:retro] recommendation=${recommendation}`,
  ];

  if (projectionDrift) {
    lines.push(
      `[workout-audit:retro] projection_delivery_drift=${projectionDrift.status} direction=${projectionDrift.summary.direction} under=${projectionDrift.summary.materialUnderdeliveryCount} over=${projectionDrift.summary.materialOverdeliveryCount} net=${formatSignedSetDelta(projectionDrift.summary.netEffectiveSetDelta)}`
    );
  }

  return lines;
}

export async function main(input?: {
  argv?: string[];
  timing?: AuditCliTiming;
}): Promise<void> {
  const timing = input?.timing ?? createAuditCliTiming();
  const endTotal = timing.start("total_measured_work");
  activeAuditCliTeardown = null;
  shouldPrintTimingReadout = false;

  try {
  const endArgumentParsing = timing.start("argument_parsing");
  let args!: ReturnType<typeof parseArgs>;
  let shouldApplyBoundedReseed!: boolean;
  let shouldAcceptSlotPlanUpgrade!: boolean;
  let shouldWriteEmptyMesocycleV2Replacement!: boolean;
  let shouldConfirmEmptyMesocycleV2Replacement!: boolean;
  let shouldDryRunOnly!: boolean;
  let hasExplicitEmptyMesocycleV2ReplacementFlag!: boolean;
  let shouldRunPlannerOnlyDryRun!: boolean;
  let shouldRunPlannerOnlyNoRepair!: boolean;
  let shouldWriteV2DebugArtifact!: boolean;
  let shouldCompareRepaired!: boolean;
  let shouldSuppressArtifactWrites!: boolean;
  let requestedMode!: WorkoutAuditRequest["mode"];
  let env!: ReturnType<typeof loadAuditEnv>;
  let normalizedIntent: SessionIntent | undefined;
  try {
    const argv = input?.argv ?? process.argv.slice(2);
    if (isWorkoutAuditHelpRequested(argv)) {
      console.log(buildWorkoutAuditHelpText());
      return;
    }

    args = parseArgs(argv);
    shouldPrintTimingReadout = shouldPrintAuditTimingReadout(args);
    shouldApplyBoundedReseed = args["apply-bounded-reseed"] === true;
    shouldAcceptSlotPlanUpgrade = args["accept-slot-plan-upgrade"] === true;
    shouldWriteEmptyMesocycleV2Replacement = args.write === true;
    shouldConfirmEmptyMesocycleV2Replacement =
      args["confirm-empty-mesocycle-replacement"] === true;
    shouldDryRunOnly = args["dry-run"] === true;
    hasExplicitEmptyMesocycleV2ReplacementFlag =
      args["replace-empty-active-mesocycle-with-v2"] === true;
    shouldRunPlannerOnlyDryRun = args["planner-only-dry-run"] === true;
    shouldRunPlannerOnlyNoRepair = args["planner-only-no-repair"] === true;
    shouldWriteV2DebugArtifact = args["v2-debug-artifact"] === true;
    shouldCompareRepaired = args["compare-repaired"] === true;
    shouldSuppressArtifactWrites = shouldSuppressAuditArtifactWrites(args);
    assertNoArtifactWriteCompatibility(args);
    requestedMode =
      (args.mode as WorkoutAuditRequest["mode"] | undefined) ?? "future-week";
    if (shouldRunPlannerOnlyDryRun && !shouldCompareRepaired) {
      throw new Error("--planner-only-dry-run currently requires --compare-repaired");
    }
    if (shouldWriteV2DebugArtifact && requestedMode !== "mesocycle-explain") {
      throw new Error("--v2-debug-artifact requires --mode mesocycle-explain");
    }
    if (shouldWriteV2DebugArtifact && !shouldRunPlannerOnlyNoRepair) {
      throw new Error("--v2-debug-artifact requires --planner-only-no-repair");
    }
    if (requestedMode === "replace-empty-mesocycle-with-v2") {
      if (!hasExplicitEmptyMesocycleV2ReplacementFlag) {
        throw new Error(
          "--replace-empty-active-mesocycle-with-v2 is required for --mode replace-empty-mesocycle-with-v2"
        );
      }
      if (typeof args.owner !== "string" || args.owner.trim().length === 0) {
        throw new Error("replace-empty-mesocycle-with-v2 requires explicit --owner");
      }
      if (typeof args["mesocycle-id"] !== "string" || args["mesocycle-id"].trim().length === 0) {
        throw new Error("replace-empty-mesocycle-with-v2 requires explicit --mesocycle-id");
      }
      if (shouldDryRunOnly && shouldWriteEmptyMesocycleV2Replacement) {
        throw new Error("Use only one replacement execution flag: --dry-run or --write");
      }
      if (
        shouldWriteEmptyMesocycleV2Replacement &&
        !shouldConfirmEmptyMesocycleV2Replacement
      ) {
        throw new Error(
          "--write requires --confirm-empty-mesocycle-replacement for replace-empty-mesocycle-with-v2"
        );
      }
    } else if (
      shouldWriteEmptyMesocycleV2Replacement ||
      shouldConfirmEmptyMesocycleV2Replacement ||
      hasExplicitEmptyMesocycleV2ReplacementFlag
    ) {
      throw new Error(
        "empty mesocycle V2 replacement flags require --mode replace-empty-mesocycle-with-v2"
      );
    }
    env = loadAuditEnv(typeof args["env-file"] === "string" ? args["env-file"] : undefined);
    normalizedIntent = normalizeAuditIntentArg(
      typeof args.intent === "string" ? args.intent : undefined
    );
  } finally {
    endArgumentParsing();
  }

  const [
    { resolveWorkoutAuditIdentity, buildWorkoutAuditContext },
    { prisma, closePrismaResourcesForAuditCli },
    generationRunner,
    serializer,
  ] =
    await Promise.all([
      import("@/lib/audit/workout-audit/context-builder"),
      import("@/lib/db/prisma"),
      import("@/lib/audit/workout-audit/generation-runner"),
      import("@/lib/audit/workout-audit/serializer"),
    ]);
  activeAuditCliTeardown = closePrismaResourcesForAuditCli;

  const endPreflight = timing.start("preflight");
  let preflight!: Awaited<ReturnType<typeof runAuditPreflight>>;
  try {
    preflight = await runAuditPreflight({
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
  } finally {
    endPreflight();
  }

  const endOwnerContextResolution = timing.start("owner_context_resolution");
  let request!: WorkoutAuditRequest;
  try {
    const identityRequest = buildResolvedAuditIdentityRequest(args, preflight);

    request = {
      mode: requestedMode,
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
      sourceMesocycleId:
        typeof args["source-mesocycle-id"] === "string"
          ? args["source-mesocycle-id"]
          : undefined,
      retrospectiveMesocycleId:
        typeof args["retrospective-mesocycle-id"] === "string"
          ? args["retrospective-mesocycle-id"]
          : undefined,
      workoutId: typeof args["workout-id"] === "string" ? args["workout-id"] : undefined,
      exerciseId: typeof args["exercise-id"] === "string" ? args["exercise-id"] : undefined,
      projectionArtifactPath:
        typeof args["projection-artifact"] === "string"
          ? args["projection-artifact"]
          : undefined,
      plannerDiagnosticsMode: args.debug === true ? ("debug" as const) : ("standard" as const),
      plannerOnlyDryRun: shouldRunPlannerOnlyDryRun ? true : undefined,
      plannerOnlyNoRepair: shouldRunPlannerOnlyNoRepair ? true : undefined,
      v2DebugArtifact: shouldWriteV2DebugArtifact ? true : undefined,
      compareRepaired: shouldCompareRepaired ? true : undefined,
      sanitizationLevel: args.sanitization === "pii-safe" ? ("pii-safe" as const) : ("none" as const),
    };
    if (shouldApplyBoundedReseed && request.mode !== "active-mesocycle-slot-reseed") {
      throw new Error("--apply-bounded-reseed requires --mode active-mesocycle-slot-reseed");
    }
    if (shouldAcceptSlotPlanUpgrade && request.mode !== "active-mesocycle-slot-reseed") {
      throw new Error("--accept-slot-plan-upgrade requires --mode active-mesocycle-slot-reseed");
    }
    if (shouldApplyBoundedReseed && shouldAcceptSlotPlanUpgrade) {
      throw new Error("Use only one reseed apply flag: --apply-bounded-reseed or --accept-slot-plan-upgrade");
    }
  } finally {
    endOwnerContextResolution();
  }

  const { result, warnings } = await captureAuditWarnings(
    async () => {
      const endContextBuild = timing.start("context_build");
      let context!: Awaited<ReturnType<typeof buildWorkoutAuditContext>>;
      try {
        context = await buildWorkoutAuditContext(request);
      } finally {
        endContextBuild();
      }

      const endAuditGeneration = timing.start("audit_generation");
      let run!: Awaited<ReturnType<typeof generationRunner.runWorkoutAuditGeneration>>;
      try {
        run = await generationRunner.runWorkoutAuditGeneration(context);
      } finally {
        endAuditGeneration();
      }
      return { context, run };
    },
    { debug: args.debug === true }
  );

  const { context, run } = result;
  const timestamp = run.generatedAt.replace(/[:.]/g, "-");
  const intentSlug = context.generationInput?.intent ? `-${slug(context.generationInput.intent)}` : "";
  const fileName = `${timestamp}-${request.mode}${intentSlug}.json`;
  const outputDir = path.join(process.cwd(), "artifacts", "audits");
  const relativePath = ["artifacts", "audits", fileName].join("/");
  const v2DebugFileName = `${timestamp}-${request.mode}${intentSlug}-v2-debug-index.json`;
  const v2DebugRelativePath = ["artifacts", "audits", v2DebugFileName].join("/");
  const endArtifactSerialization = timing.start("artifact_serialization");
  let output!: ReturnType<typeof serializer.createWorkoutAuditArtifactOutput>;
  try {
    output = serializer.createWorkoutAuditArtifactOutput(request, run, {
      capturedWarnings: warnings,
      artifactFileName: fileName,
      artifactRelativePath: relativePath,
      v2DebugArtifactFileName: v2DebugFileName,
      v2DebugArtifactRelativePath: v2DebugRelativePath,
    });
  } finally {
    endArtifactSerialization();
  }
  const { artifact, serializedArtifact, serialized, sizeBytes, v2DebugArtifact } = output;

  const outputPath = path.join(outputDir, fileName);
  const artifactWriteResult = await writeAuditArtifactFiles({
    suppressWrites: shouldSuppressArtifactWrites,
    outputDir,
    outputPath,
    serialized,
    v2DebugArtifact,
    timing,
  });
  const outputPathForSummary =
    artifactWriteResult.artifactOutputPath ?? "not_written (--no-artifact)";
  const v2DebugOutputPath = artifactWriteResult.v2DebugOutputPath;

  const endCliSummaryFormatting = timing.start("cli_summary_formatting");
  try {
  const summary = run.historicalWeek
    ? `week=${run.historicalWeek.week} sessions=${run.historicalWeek.summary.sessionCount}`
    : run.weeklyRetro
      ? `week=${run.weeklyRetro.week} recommendations=${run.weeklyRetro.recommendedPriorities.length}`
    : run.projectedWeekVolume
      ? `week=${run.projectedWeekVolume.currentWeek.week} projected_sessions=${run.projectedWeekVolume.projectedSessions.length}`
    : run.activeMesocycleSlotReseed
      ? `week=${run.activeMesocycleSlotReseed.activeMesocycle.week} verdict=${run.activeMesocycleSlotReseed.recommendation.verdict}`
      : run.replaceEmptyMesocycleWithV2
        ? `mesocycle=${run.replaceEmptyMesocycleWithV2.targetMesocycleId} safety=${run.replaceEmptyMesocycleWithV2.candidateSafety.allowed ? "allowed" : "blocked"} v2=${run.replaceEmptyMesocycleWithV2.v2Preparation.status}`
      : run.v2AcceptedSeedPrepareCompare
        ? `handoff_candidate=${run.v2AcceptedSeedPrepareCompare.handoffCandidate.found ? "yes" : "no"} compare_status=${run.v2AcceptedSeedPrepareCompare.compareStatus}`
      : run.mesocycleExplain
        ? `source=${run.mesocycleExplain.sourceMesocycleId} retrospective=${run.mesocycleExplain.retrospectiveMesocycleId} preview_slots=${run.mesocycleExplain.preview.slotPlans.length}`
      : run.progressionAnchor
        ? `exercise=${run.progressionAnchor.exerciseId} action=${run.progressionAnchor.trace.outcome.action}`
        : !run.generationResult
        ? "no_generation"
        : "error" in run.generationResult
          ? `generation_error=${run.generationResult.error}`
          : `selected=${run.generationResult.selection.selectedExerciseIds.length}`;

  if (artifactWriteResult.artifactOutputPath) {
    console.log(`[workout-audit] wrote ${artifactWriteResult.artifactOutputPath}`);
  } else {
    console.log("[workout-audit] artifact_write=skipped reason=no-artifact");
    console.log("[workout-audit:read-only] db_mutation=no artifact_write=no workout_log_session_creation=no");
    console.log("[workout-audit:read-only] note=read_only_db_audit_and_local_artifact_writes_are_separate_guarantees");
  }
  console.log(
    `[workout-audit] mode=${context.mode} diagnostics=${context.plannerDiagnosticsMode} ${summary}`
  );
  const projectedWeekSummary = buildProjectedWeekOperatorSummary({
    artifact,
    outputPath: outputPathForSummary,
  });
  if (projectedWeekSummary) {
    for (const line of projectedWeekSummary) {
      console.log(line);
    }
  }
  const currentWeekAuditSummary = buildCurrentWeekAuditOperatorSummary({
    artifact,
  });
  if (currentWeekAuditSummary) {
    for (const line of currentWeekAuditSummary) {
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
  const planningRealitySummary = buildPlanningRealitySummary({
    artifact,
    outputPath: outputPathForSummary,
  });
  if (planningRealitySummary) {
    for (const line of planningRealitySummary) {
      console.log(line);
    }
  }
  const plannerOnlyDryRunSummary = buildPlannerOnlyDryRunSummary({
    artifact,
  });
  if (plannerOnlyDryRunSummary) {
    for (const line of plannerOnlyDryRunSummary) {
      console.log(line);
    }
  }
  const plannerOnlyNoRepairSummary = buildPlannerOnlyNoRepairSummary({
    artifact,
  });
  if (plannerOnlyNoRepairSummary) {
    for (const line of plannerOnlyNoRepairSummary) {
      console.log(line);
    }
  }
  if (v2DebugArtifact && v2DebugOutputPath) {
    for (const line of buildV2DebugArtifactSummary({
      filePath: v2DebugOutputPath,
      sizeBytes: v2DebugArtifact.sizeBytes,
      sha256: v2DebugArtifact.sha256,
      shards: v2DebugArtifact.shards.map((shard) => ({
        id: shard.artifact.id,
        filePath: path.join(outputDir, shard.fileName),
        detailLevel: shard.artifact.detailLevel,
        sizeBytes: shard.sizeBytes,
        sha256: shard.sha256,
      })),
    })) {
      console.log(line);
    }
  }
  const activeMesocycleSlotReseedSummary = buildActiveMesocycleSlotReseedSummary({
    artifact,
    outputPath: outputPathForSummary,
  });
  if (activeMesocycleSlotReseedSummary) {
    for (const line of activeMesocycleSlotReseedSummary) {
      console.log(line);
    }
  }
  const replaceEmptyMesocycleWithV2Summary = buildReplaceEmptyMesocycleWithV2Summary({
    artifact,
    outputPath: outputPathForSummary,
  });
  if (replaceEmptyMesocycleWithV2Summary) {
    for (const line of replaceEmptyMesocycleWithV2Summary) {
      console.log(line);
    }
  }
  const v2AcceptedSeedPrepareCompareSummary =
    buildV2AcceptedSeedPrepareCompareSummary({
      artifact,
      outputPath: outputPathForSummary,
      sizeBytes,
    });
  if (v2AcceptedSeedPrepareCompareSummary) {
    for (const line of v2AcceptedSeedPrepareCompareSummary) {
      console.log(line);
    }
  }
  let replaceEmptyMesocycleWithV2WriteSummary: string[] | null = null;
  if (shouldWriteEmptyMesocycleV2Replacement) {
    const { replaceEmptyMesocycleWithV2 } = await import(
      "@/lib/api/replace-empty-mesocycle-with-v2"
    );
    const writeResult = await replaceEmptyMesocycleWithV2({
      userId: context.userId,
      ownerEmail: context.ownerEmail ?? "",
      mesocycleId: request.mesocycleId!,
      replaceEmptyActiveMesocycleWithV2: true,
      write: true,
      confirmEmptyMesocycleReplacement:
        shouldConfirmEmptyMesocycleV2Replacement,
    });
    replaceEmptyMesocycleWithV2WriteSummary = [
      `[workout-audit:replace-empty-v2:write] mesocycle=${writeResult.targetMesocycleId} eligible=${formatBooleanFlag(writeResult.write.eligible)} db_write=${formatBooleanFlag(writeResult.write.dbWriteOccurred)} transaction=${writeResult.write.transactionStatus}`,
      `[workout-audit:replace-empty-v2:write] safety_allowed=${formatBooleanFlag(writeResult.candidateSafety.allowed)} v2_status=${writeResult.v2Preparation.status}`,
    ];
  }
  if (replaceEmptyMesocycleWithV2WriteSummary) {
    for (const line of replaceEmptyMesocycleWithV2WriteSummary) {
      console.log(line);
    }
  }
  let activeMesocycleSlotReseedApplySummary: string[] | null = null;
  if (shouldApplyBoundedReseed || shouldAcceptSlotPlanUpgrade) {
    const [
      { evaluateActiveMesocycleSlotReseed },
      {
        acceptActiveMesocycleSlotPlanSeedUpgrade,
        applyActiveMesocycleBoundedUpperSlotReseed,
      },
    ] = await Promise.all([
      import("@/lib/audit/workout-audit/active-mesocycle-slot-reseed"),
      import("@/lib/api/active-mesocycle-slot-reseed-apply"),
    ]);
    const evaluation = await evaluateActiveMesocycleSlotReseed({
      userId: context.userId,
      plannerDiagnosticsMode: context.plannerDiagnosticsMode,
    });
    const applyResult = shouldAcceptSlotPlanUpgrade
      ? await acceptActiveMesocycleSlotPlanSeedUpgrade({
          userId: context.userId,
          activeMesocycleId: evaluation.activeMesocycleId,
          candidateSlotPlanSeedJson: evaluation.candidateSlotPlanSeed,
          dryRunVerdict: evaluation.auditPayload.recommendation.verdict,
        })
      : await applyActiveMesocycleBoundedUpperSlotReseed({
          userId: context.userId,
          activeMesocycleId: evaluation.activeMesocycleId,
          candidateSlotPlanSeedJson: evaluation.candidateSlotPlanSeed,
          targetSlotIds: ["upper_a", "upper_b"],
          dryRunVerdict:
            evaluation.auditPayload.recommendation.verdict === "safe_to_accept_upgrade"
              ? "safe_to_apply_bounded_reseed"
              : evaluation.auditPayload.recommendation.verdict,
        });
    activeMesocycleSlotReseedApplySummary = buildActiveMesocycleSlotReseedApplySummary({
      result: applyResult,
    });
  }
  if (activeMesocycleSlotReseedApplySummary) {
    for (const line of activeMesocycleSlotReseedApplySummary) {
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
  const planningRealitySizeBudgetSummary = buildPlanningRealitySizeBudgetSummary({
    artifact: serializedArtifact,
    sizeBytes,
    thresholdBytes: WORKOUT_AUDIT_SIZE_LIMIT_BYTES,
    operatorDebug: args["operator-debug"] === true,
  });
  if (planningRealitySizeBudgetSummary) {
    for (const line of planningRealitySizeBudgetSummary) {
      console.log(line);
    }
  }
  console.log(`[workout-audit:conclusions] ${JSON.stringify(artifact.conclusions)}`);
  printWarningSummary("workout-audit", artifact.warningSummary);
  if (sizeBytes > WORKOUT_AUDIT_SIZE_LIMIT_BYTES) {
    console.warn(
      `[workout-audit] artifact_size_exceeded size_bytes=${sizeBytes} limit_bytes=${WORKOUT_AUDIT_SIZE_LIMIT_BYTES}`
    );
  }
  } finally {
    endCliSummaryFormatting();
  }
  } finally {
    endTotal();
  }
}

const isMainModule =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]!).href;

if (isMainModule) {
  const timing = createAuditCliTiming();
  runAuditCliWithTeardown({
    run: () => main({ timing }),
    teardown: async () => {
      if (activeAuditCliTeardown) {
        await activeAuditCliTeardown();
      }
    },
    timing,
    printTiming: () => shouldPrintTimingReadout,
    logTeardownError: (message) => {
      console.error(message);
    },
  }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[workout-audit] ${message}`);
    process.exitCode = 1;
  });
}
