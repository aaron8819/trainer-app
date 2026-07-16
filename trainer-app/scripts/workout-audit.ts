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
import type { PreSessionReadinessContract } from "@/lib/api/pre-session-readiness-contract";
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

function formatAuditDecimal(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "n/a";
  }
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

function formatAuditMaybeNumber(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? formatAuditDecimal(value)
    : "unknown";
}

function formatRepTarget(
  set:
    | {
        targetRepRange?: { min: number; max: number };
        targetReps?: number;
      }
    | undefined
): string {
  if (!set) {
    return "n/a";
  }
  if (set.targetRepRange) {
    return `${formatAuditDecimal(set.targetRepRange.min)}-${formatAuditDecimal(set.targetRepRange.max)}`;
  }
  return formatAuditDecimal(set.targetReps);
}

function formatCalibrationRepTarget(
  range: { min: number; max: number } | undefined
): string {
  if (!range) {
    return "unknown";
  }
  if (range.min === range.max) {
    return formatAuditDecimal(range.min);
  }
  return `${formatAuditDecimal(range.min)}-${formatAuditDecimal(range.max)}`;
}

function formatCalibrationPrescription(input: {
  load?: number;
  repRange?: { min: number; max: number };
  reps?: number;
  rpe?: number;
}): string {
  const load = formatAuditMaybeNumber(input.load);
  const reps =
    typeof input.reps === "number"
      ? formatAuditDecimal(input.reps)
      : formatCalibrationRepTarget(input.repRange);
  const rpe = formatAuditMaybeNumber(input.rpe);
  return `${load} x ${reps} @${rpe}`;
}

function formatIncompleteWorkoutReadiness(
  nextSession: Pick<
    NonNullable<WorkoutAuditArtifact["nextSession"]>,
    "selectedIncompleteReadiness" | "existingWorkoutId" | "selectedIncompleteStatus"
  > | undefined
): string {
  if (!nextSession?.existingWorkoutId) {
    return "none";
  }

  const readiness = nextSession.selectedIncompleteReadiness;
  if (!readiness) {
    return `unclassified (${nextSession.selectedIncompleteStatus ?? "unknown"})`;
  }

  return `${readiness.classification} (${readiness.action})`;
}

function buildFutureWeekSafeToTrain(input: {
  artifact: Pick<
    WorkoutAuditArtifact,
    "generation" | "nextSession" | "sessionSnapshot" | "warningSummary"
  >;
}): { safe: boolean; blocker: string } {
  const blockers: string[] = [];
  if (input.artifact.warningSummary.counts.blockingErrors > 0) {
    blockers.push(
      input.artifact.warningSummary.blockingErrors[0] ??
        "blocking audit errors are present"
    );
  }
  if (input.artifact.generation && "error" in input.artifact.generation) {
    blockers.push(input.artifact.generation.error);
  }
  if (!input.artifact.sessionSnapshot?.generated && !input.artifact.generation) {
    blockers.push("missing generated session preview");
  }
  if (
    input.artifact.nextSession?.source === "existing_incomplete" &&
    input.artifact.nextSession.selectedIncompleteReadiness?.safeToTrain !== true
  ) {
    blockers.push(
      `incomplete workout blocker: ${input.artifact.nextSession.existingWorkoutId ?? "unknown"} (${input.artifact.nextSession.selectedIncompleteStatus ?? "unknown"})`
    );
  }
  if (input.artifact.nextSession?.source === "final_week_close_pending") {
    blockers.push(
      input.artifact.nextSession.lifecycleBlocker?.message ??
        "final accumulation closeout is pending"
    );
  }

  return {
    safe: blockers.length === 0,
    blocker: blockers.length > 0 ? Array.from(new Set(blockers)).join("; ") : "none",
  };
}

function inferFutureWeekState(input: {
  artifact: Pick<WorkoutAuditArtifact, "generationPath" | "sessionSnapshot">;
}): string {
  const path = input.artifact.generationPath?.executionMode;
  if (path === "active_deload_reroute" || path === "explicit_deload_preview") {
    return "ACTIVE_DELOAD";
  }
  if (path === "standard_generation" || path === "blocked_closeout_required") {
    return "ACTIVE_ACCUMULATION";
  }
  if (input.artifact.sessionSnapshot?.generated?.semantics.isDeload) {
    return "ACTIVE_DELOAD";
  }
  return "unknown";
}

export function buildFutureWeekOperatorDebugSummary(input: {
  artifact: Pick<
    WorkoutAuditArtifact,
    | "mode"
    | "requestedMode"
    | "nextSession"
    | "generation"
    | "sessionSnapshot"
    | "generationPath"
    | "generationProvenance"
    | "warningSummary"
  >;
  operatorDebug?: boolean;
}): string[] | null {
  if (
    input.operatorDebug !== true ||
    (input.artifact.mode !== "future-week" &&
      input.artifact.requestedMode !== "future-week")
  ) {
    return null;
  }

  const generated = input.artifact.sessionSnapshot?.generated;
  const generationPath = input.artifact.generationPath;
  const receiptProvenance = input.artifact.generationProvenance?.receiptProvenance;
  const safeToTrain = buildFutureWeekSafeToTrain({ artifact: input.artifact });
  const exercises = [...(generated?.exercises ?? [])].sort(
    (left, right) => left.orderIndex - right.orderIndex
  );
  const path = generationPath?.executionMode ?? "unknown";
  const isBlocked = path === "blocked_closeout_required" || !safeToTrain.safe;
  const note =
    generated?.semantics.isDeload || path === "active_deload_reroute"
      ? "deload"
      : "standard";

  const lines = [
    "",
    "Generation Summary",
    "State | Week | Session | Slot | Path | Generator | Composition Source | Safe To Train",
    [
      inferFutureWeekState({ artifact: input.artifact }),
      formatAuditMaybeNumber(
        input.artifact.nextSession?.weekInMeso ??
          generated?.cycleContext?.weekInMeso
      ),
      formatAuditMaybeNumber(input.artifact.nextSession?.sessionInWeek),
      input.artifact.nextSession?.slotId ?? "unknown",
      path,
      generationPath?.generator ?? "unknown",
      receiptProvenance?.compositionSource ?? "unknown",
      safeToTrain.safe ? "yes" : "no",
    ].join(" | "),
    `Blocker: ${safeToTrain.blocker}`,
  ];

  if (isBlocked) {
    lines.push(`Generated Preview: unavailable (${path})`);
    return lines;
  }

  lines.push(
    "",
    "Generated Preview",
    "Order | Exercise | Sets | Load | Rep target/range | RPE | Note"
  );
  if (exercises.length === 0) {
    lines.push("none | no generated exercises available | n/a | n/a | n/a | n/a | n/a");
    return lines;
  }

  for (const [index, exercise] of exercises.entries()) {
    const firstSet = exercise.prescribedSets[0];
    lines.push(
      `${index + 1} | ${exercise.exerciseName} | ${exercise.prescribedSetCount} | ${formatAuditDecimal(firstSet?.targetLoad)} | ${formatRepTarget(firstSet)} | ${formatAuditDecimal(firstSet?.targetRpe)} | ${note}`
    );
  }

  return lines;
}

function formatDoseAction(
  action: NonNullable<ProjectedWeekVolumeAuditPayload["runtimeDoseAdjustmentDiagnostics"]>[number]["recommendedAction"],
  diagnostic?: NonNullable<ProjectedWeekVolumeAuditPayload["runtimeDoseAdjustmentDiagnostics"]>[number]
): string {
  if (action.kind === "hold_seed") {
    if (
      diagnostic?.targetStatus === "below_preferred" ||
      diagnostic?.targetStatus === "stretch_miss"
    ) {
      return "monitor, no default add-on";
    }
    if (diagnostic?.targetStatus === "near_mav") {
      return "hold seed; near MAV cap";
    }
    if (diagnostic?.targetStatus === "over_mav") {
      return "hold seed; over MAV caution";
    }
    if (diagnostic?.reasonCode === "no_candidate_hold_seed") {
      return "hold seed; no viable add-on";
    }
    return "hold seed";
  }
  if (action.kind === "optional_add_set") {
    return `optional +1 ${action.exerciseName ?? "set"}`;
  }
  if (action.kind === "add_set") {
    return `consider +1 ${action.exerciseName ?? "set"}`;
  }
  if (action.kind === "reduce_set_if_fatigue_meaningful") {
    return `reduce -1 ${action.exerciseName ?? "set"} if fatigue meaningful`;
  }
  if (action.kind === "avoid_default_reduction") {
    return "avoid default reduction";
  }
  return action.kind;
}

function formatDoseStatus(
  diagnostic: NonNullable<ProjectedWeekVolumeAuditPayload["runtimeDoseAdjustmentDiagnostics"]>[number]
): string {
  const end = diagnostic.projectedEndOfWeekVolume;
  return `${formatAuditDecimal(end.effectiveSets)} vs MEV ${formatAuditDecimal(end.mev)} / target ${formatAuditDecimal(end.weeklyTarget)} / MAV ${formatAuditDecimal(end.mav)}`;
}

type PreSessionDoseDiagnostic =
  NonNullable<ProjectedWeekVolumeAuditPayload["runtimeDoseAdjustmentDiagnostics"]>[number];
type ProjectedWeekMuscleRow = ProjectedWeekVolumeAuditPayload["fullWeekByMuscle"][number];
type ProjectedWeekSession = ProjectedWeekVolumeAuditPayload["projectedSessions"][number];
type DoseClosureRecommendation = {
  kind: "priority" | "optional" | "floor_buffer";
  muscle: string;
  line: string;
  addonLine: string;
};
type DoseClosurePlan = {
  lines: string[];
  recommendations: DoseClosureRecommendation[];
};

const UPPER_BODY_MUSCLES = new Set([
  "Chest",
  "Lats",
  "Upper Back",
  "Side Delts",
  "Rear Delts",
  "Biceps",
  "Triceps",
]);
const LOWER_BODY_MUSCLES = new Set([
  "Quads",
  "Hamstrings",
  "Glutes",
  "Calves",
  "Adductors",
  "Abductors",
  "Lower Back",
]);
const TARGET_TIER_MEANINGFUL = new Set(["A_PRIMARY", "B_SUPPORT"]);
const MAX_BOUNDED_TOP_UP_RAW_SETS = 5;
const FLOOR_BUFFER_MARGIN_SETS = 1;
const ALREADY_COVERED_NEXT_SESSION_SETS = 4;
const DELOAD_DO_NOT_CHASE_VOLUME_MESSAGE =
  "Deload is intentionally reduced volume; do not chase MEV/target deficits.";

function getMuscleRegion(muscle: string): "upper" | "lower" | null {
  if (UPPER_BODY_MUSCLES.has(muscle)) {
    return "upper";
  }
  if (LOWER_BODY_MUSCLES.has(muscle)) {
    return "lower";
  }
  return null;
}

function sessionMatchesRegion(
  session: ProjectedWeekSession | undefined,
  region: "upper" | "lower"
): boolean {
  if (!session) {
    return false;
  }
  const label = `${session.slotId ?? ""} ${session.intent ?? ""}`.toLowerCase();
  if (label.includes("full_body")) {
    return true;
  }
  if (region === "upper") {
    return (
      label.includes("upper") ||
      label.includes("push") ||
      label.includes("pull")
    );
  }
  return label.includes("lower") || label.includes("legs");
}

function isFinalPracticalOpportunity(input: {
  muscle: string;
  nextSession: ProjectedWeekSession | undefined;
  projectedSessions: ProjectedWeekVolumeAuditPayload["projectedSessions"];
}): boolean {
  const region = getMuscleRegion(input.muscle);
  if (!region || !sessionMatchesRegion(input.nextSession, region)) {
    return false;
  }

  const nextIndex = input.projectedSessions.findIndex(
    (session) => session === input.nextSession
  );
  const remainingSessions =
    nextIndex >= 0
      ? input.projectedSessions.slice(nextIndex + 1)
      : input.projectedSessions.slice(1);
  return !remainingSessions.some((session) => sessionMatchesRegion(session, region));
}

function getLowFatigueIsolationLabel(input: {
  muscle: string;
  exerciseName?: string;
}): string {
  const exerciseName = input.exerciseName;
  if (input.muscle === "Chest") {
    const normalized = exerciseName?.toLowerCase();
    if (
      normalized?.includes("fly") ||
      normalized?.includes("crossover") ||
      normalized?.includes("pec deck")
    ) {
      return `${exerciseName} or Pec Deck`;
    }
    return "Cable Fly or Pec Deck";
  }
  if (input.muscle === "Triceps") {
    return exerciseName?.toLowerCase().includes("pushdown")
      ? exerciseName
      : "Pushdown";
  }
  if (input.muscle === "Biceps") {
    return exerciseName?.toLowerCase().includes("curl") ? exerciseName : "Curl";
  }
  if (input.muscle === "Side Delts") {
    const normalized = exerciseName?.toLowerCase();
    return normalized?.includes("lateral raise") ||
      normalized?.includes("side raise")
      ? exerciseName ?? "Lateral Raise"
      : "Lateral Raise";
  }
  if (input.muscle === "Rear Delts") {
    return exerciseName?.toLowerCase().includes("rear delt")
      ? exerciseName
      : "Rear Delt Fly";
  }
  if (input.muscle === "Calves") {
    const normalized = exerciseName?.toLowerCase();
    if (normalized?.includes("seated calf")) {
      return `${exerciseName} or equivalent Standing Calf Raise`;
    }
    if (normalized?.includes("standing calf")) {
      return `${exerciseName} or equivalent Seated Calf Raise`;
    }
    return exerciseName?.toLowerCase().includes("calf")
      ? `${exerciseName} or equivalent Calf Raise`
      : "Calf Raise";
  }
  return exerciseName ?? "low-fatigue isolation";
}

function findLowFatigueIsolationExercise(input: {
  muscle: string;
  nextSession: ProjectedWeekSession | undefined;
}): string | undefined {
  const exercises = input.nextSession?.exercises ?? [];
  const matches = (tokens: string[]) =>
    exercises.find((exercise) => {
      const normalized = exercise.name.toLowerCase();
      return tokens.some((token) => normalized.includes(token));
    })?.name;

  if (input.muscle === "Chest") {
    return matches(["crossover", "fly", "pec deck"]);
  }
  if (input.muscle === "Triceps") {
    return matches(["pushdown", "extension"]);
  }
  if (input.muscle === "Biceps") {
    return matches(["curl"]);
  }
  if (input.muscle === "Side Delts") {
    return matches(["lateral raise", "side raise"]);
  }
  if (input.muscle === "Rear Delts") {
    return matches(["rear delt", "reverse pec", "face pull"]);
  }
  if (input.muscle === "Calves") {
    return matches(["calf"]);
  }
  return undefined;
}

function getDoseClosureAddonCaveat(muscle: string): string {
  if (muscle === "Calves") {
    return "if calves/Achilles/feet feel good";
  }
  if (muscle === "Triceps") {
    return "if readiness/time/elbows are good";
  }
  return "if readiness/time allow";
}

function getSuppressionAction(muscle: string): string {
  if (muscle === "Biceps") {
    return "no extra curls";
  }
  if (muscle === "Side Delts") {
    return "no extra lateral raises";
  }
  if (muscle === "Rear Delts") {
    return "no extra rear-delt work";
  }
  if (muscle === "Lats") {
    return "no extra pulldowns";
  }
  if (muscle === "Upper Back") {
    return "no extra rows";
  }
  return "seed only";
}

function formatMevProjection(input: {
  effectiveSets: number;
  mev: number;
}): string {
  return `projected ${formatAuditDecimal(input.effectiveSets)} / MEV ${formatAuditDecimal(input.mev)}`;
}

function formatWeightedSetGap(value: number): string {
  return `${formatAuditDecimal(Math.max(0, value))} weighted sets`;
}

function formatRawSetCount(value: number): string {
  return `${value} raw ${value === 1 ? "set" : "sets"}`;
}

function getCandidateContributionEstimate(input: {
  muscle: string;
  diagnostic: PreSessionDoseDiagnostic | undefined;
  nextSession: ProjectedWeekSession | undefined;
}): { exerciseName: string; weightedSetsPerRawSet: number } | null {
  const exerciseName = input.diagnostic?.recommendedAction.exerciseName;
  if (!exerciseName || !input.nextSession?.exercises?.length) {
    return null;
  }

  const normalizedExerciseName = exerciseName.toLowerCase();
  const exercise = input.nextSession.exercises.find(
    (candidate) => candidate.name.toLowerCase() === normalizedExerciseName
  );
  if (!exercise || exercise.setCount <= 0) {
    return null;
  }

  const weightedSets = exercise.effectiveStimulusByMuscle?.[input.muscle];
  if (typeof weightedSets !== "number" || !Number.isFinite(weightedSets) || weightedSets <= 0) {
    return null;
  }

  return {
    exerciseName: exercise.name,
    weightedSetsPerRawSet: Math.round((weightedSets / exercise.setCount) * 10) / 10,
  };
}

function formatContributionEstimate(input: {
  muscle: string;
  estimate: { exerciseName: string; weightedSetsPerRawSet: number } | null;
}): string {
  if (!input.estimate) {
    return "Estimated contribution unavailable; raw set recommendation may reduce but not guarantee MEV closure.";
  }
  return `Estimated contribution: ~${formatAuditDecimal(input.estimate.weightedSetsPerRawSet)} weighted ${input.muscle} sets per raw ${input.estimate.exerciseName} set.`;
}

function buildPriorityDoseClosureRecommendation(input: {
  row: ProjectedWeekMuscleRow;
  diagnostic: PreSessionDoseDiagnostic | undefined;
  nextSession: ProjectedWeekSession | undefined;
  isolation: string;
}): DoseClosureRecommendation {
  const weightedGap = Math.max(0, input.row.mev - input.row.projectedFullWeekEffectiveSets);
  const projection = formatMevProjection({
    effectiveSets: input.row.projectedFullWeekEffectiveSets,
    mev: input.row.mev,
  });
  const estimate = getCandidateContributionEstimate({
    muscle: input.row.muscle,
    diagnostic: input.diagnostic,
    nextSession: input.nextSession,
  });
  const base = `- ${input.row.muscle}: ${projection}; gap ${formatWeightedSetGap(weightedGap)}. Candidate: ${input.isolation}. ${formatContributionEstimate({ muscle: input.row.muscle, estimate })}`;

  if (!estimate) {
    return {
      kind: "priority",
      muscle: input.row.muscle,
      line: `${base} Recommended: +1-2 raw low-fatigue ${input.row.muscle} isolation sets if readiness/time allow. Expected outcome: reduce deficit but may still miss MEV. Guardrail: accept the miss if full closure would require too much volume today; do not chase full target or add pressing.`,
      addonLine: `- Add +1-2 raw low-fatigue ${input.row.muscle} isolation sets ${getDoseClosureAddonCaveat(input.row.muscle)}.`,
    };
  }

  const rawSetsNeeded = Math.ceil(weightedGap / estimate.weightedSetsPerRawSet);
  const oneToTwoRawSetsLikelyCloses =
    estimate.weightedSetsPerRawSet * 2 >= weightedGap;
  const oneToTwoNote = oneToTwoRawSetsLikelyCloses
    ? ""
    : " A +1-2 raw add-on is expected to reduce the deficit, not fully close MEV.";

  if (rawSetsNeeded > MAX_BOUNDED_TOP_UP_RAW_SETS) {
    return {
      kind: "priority",
      muscle: input.row.muscle,
      line: `${base} Closing would require about ${formatRawSetCount(rawSetsNeeded)}, above the bounded top-up cap. Recommended: +2-${MAX_BOUNDED_TOP_UP_RAW_SETS} raw low-fatigue isolation sets only if readiness/time allow. Expected outcome: reduce deficit but may still miss MEV; accept the miss rather than chase volume today. Guardrail: do not chase full target or add pressing.`,
      addonLine: `- Add +2-${MAX_BOUNDED_TOP_UP_RAW_SETS} raw sets of ${input.isolation} ${getDoseClosureAddonCaveat(input.row.muscle)}; accept the miss rather than chase more volume today.`,
    };
  }

  return {
    kind: "priority",
    muscle: input.row.muscle,
    line: `${base} Recommended: +${rawSetsNeeded} raw low-fatigue isolation ${rawSetsNeeded === 1 ? "set" : "sets"} if readiness/time allow. Expected outcome: likely closes MEV floor.${oneToTwoNote} Guardrail: do not chase full target or add pressing.`,
    addonLine: `- Add +${rawSetsNeeded} raw ${rawSetsNeeded === 1 ? "set" : "sets"} of ${input.isolation} ${getDoseClosureAddonCaveat(input.row.muscle)}.`,
  };
}

function buildOptionalDoseClosureRecommendation(input: {
  row: ProjectedWeekMuscleRow;
  isolation: string;
}): DoseClosureRecommendation {
  const weightedGap = Math.max(0, input.row.mev - input.row.projectedFullWeekEffectiveSets);
  const projection = formatMevProjection({
    effectiveSets: input.row.projectedFullWeekEffectiveSets,
    mev: input.row.mev,
  });
  return {
    kind: "optional",
    muscle: input.row.muscle,
    line: `- ${input.row.muscle}: ${projection}; gap ${formatWeightedSetGap(weightedGap)}. Optional +1 ${input.isolation} ${getDoseClosureAddonCaveat(input.row.muscle)}. Expected outcome: close or reduce tiny MEV gap; low-fatigue isolation only.`,
    addonLine: `- Add +1 ${input.isolation} ${getDoseClosureAddonCaveat(input.row.muscle)}.`,
  };
}

function buildFloorBufferRecommendation(input: {
  row: ProjectedWeekMuscleRow;
  isolation: string;
}): DoseClosureRecommendation {
  const projection = formatMevProjection({
    effectiveSets: input.row.projectedFullWeekEffectiveSets,
    mev: input.row.mev,
  });
  const margin = Math.max(
    0,
    input.row.projectedFullWeekEffectiveSets - input.row.mev
  );
  return {
    kind: "floor_buffer",
    muscle: input.row.muscle,
    line: `- ${input.row.muscle}: ${projection}; floor margin ${formatWeightedSetGap(margin)}. Optional +1 ${input.isolation} ${getDoseClosureAddonCaveat(input.row.muscle)} as a session-local buffer only. Expected outcome: add a thin MEV cushion without changing the accepted seed; low-fatigue isolation only.`,
    addonLine: `- Optional session-local +1 ${input.isolation} ${getDoseClosureAddonCaveat(input.row.muscle)} for floor buffer only.`,
  };
}

function isMeaningfulFatigueOrReadinessLimited(
  diagnostic: PreSessionDoseDiagnostic | undefined
): boolean {
  return (
    diagnostic?.fatigueDensityConcern.level === "meaningful" ||
    diagnostic?.fatigueDensityConcern.level === "high" ||
    diagnostic?.recoveryReadinessCaveat.status === "local_soreness" ||
    diagnostic?.recoveryReadinessCaveat.status === "low_overall_readiness" ||
    diagnostic?.recoveryReadinessCaveat.status === "pain_or_fatigue_flag"
  );
}

function shouldOfferFloorBuffer(input: {
  row: ProjectedWeekMuscleRow;
  diagnostic: PreSessionDoseDiagnostic | undefined;
  nextSession: ProjectedWeekSession | undefined;
  projectedSessions: ProjectedWeekVolumeAuditPayload["projectedSessions"];
}): boolean {
  const margin = input.row.projectedFullWeekEffectiveSets - input.row.mev;
  const nextContribution =
    input.nextSession?.projectedContributionByMuscle[input.row.muscle] ?? 0;
  const finalOpportunity = isFinalPracticalOpportunity({
    muscle: input.row.muscle,
    nextSession: input.nextSession,
    projectedSessions: input.projectedSessions,
  });

  return (
    input.row.mev > 0 &&
    margin >= 0 &&
    margin <= FLOOR_BUFFER_MARGIN_SETS &&
    finalOpportunity &&
    nextContribution > 0 &&
    nextContribution <= ALREADY_COVERED_NEXT_SESSION_SETS &&
    input.row.deltaToMav < -FLOOR_BUFFER_MARGIN_SETS &&
    !isMeaningfulFatigueOrReadinessLimited(input.diagnostic)
  );
}

function buildDoseClosurePlan(input: {
  diagnostics: PreSessionDoseDiagnostic[];
  fullWeekRows: ProjectedWeekVolumeAuditPayload["fullWeekByMuscle"];
  projectedSessions: ProjectedWeekVolumeAuditPayload["projectedSessions"];
  nextSession: ProjectedWeekSession | undefined;
}): DoseClosurePlan {
  const lines = ["", "Dose Closure Guidance"];
  const diagnosticByMuscle = new Map(
    input.diagnostics.map((diagnostic) => [diagnostic.muscle, diagnostic])
  );
  const relevantRows = input.fullWeekRows
    .filter((row) => TARGET_TIER_MEANINGFUL.has(row.targetTier ?? ""))
    .filter((row) => {
      const region = getMuscleRegion(row.muscle);
      return Boolean(region && sessionMatchesRegion(input.nextSession, region));
    })
    .sort((left, right) => {
      const leftGap = left.mev - left.projectedFullWeekEffectiveSets;
      const rightGap = right.mev - right.projectedFullWeekEffectiveSets;
      return rightGap - leftGap || left.muscle.localeCompare(right.muscle);
    });
  const priority: string[] = [];
  const optional: string[] = [];
  const recommendations: DoseClosureRecommendation[] = [];
  const suppress: string[] = [];
  const monitor: string[] = [];

  for (const row of relevantRows) {
    const diagnostic = diagnosticByMuscle.get(row.muscle);
    const mevGap = row.mev - row.projectedFullWeekEffectiveSets;
    const finalOpportunity = isFinalPracticalOpportunity({
      muscle: row.muscle,
      nextSession: input.nextSession,
      projectedSessions: input.projectedSessions,
    });
    const projection = formatMevProjection({
      effectiveSets: row.projectedFullWeekEffectiveSets,
      mev: row.mev,
    });

    if (mevGap > 0) {
      if (!finalOpportunity) {
        const region = getMuscleRegion(row.muscle);
        monitor.push(
          `- ${row.muscle}: ${projection}. Below MEV, but another practical ${region ?? "training"} opportunity remains; monitor after the seed.`
        );
        continue;
      }

      const isolation = getLowFatigueIsolationLabel({
        muscle: row.muscle,
        exerciseName: diagnostic?.recommendedAction.exerciseName,
      });
      if (mevGap <= 1.25) {
        const recommendation = buildOptionalDoseClosureRecommendation({
          row,
          isolation,
        });
        optional.push(recommendation.line);
        recommendations.push(recommendation);
      } else {
        const recommendation = buildPriorityDoseClosureRecommendation({
          row,
          diagnostic,
          nextSession: input.nextSession,
          isolation,
        });
        priority.push(recommendation.line);
        recommendations.push(recommendation);
      }
      continue;
    }

    if (
      shouldOfferFloorBuffer({
        row,
        diagnostic,
        nextSession: input.nextSession,
        projectedSessions: input.projectedSessions,
      })
    ) {
      const isolation = getLowFatigueIsolationLabel({
        muscle: row.muscle,
        exerciseName:
          findLowFatigueIsolationExercise({
            muscle: row.muscle,
            nextSession: input.nextSession,
          }) ?? diagnostic?.recommendedAction.exerciseName,
      });
      const recommendation = buildFloorBufferRecommendation({ row, isolation });
      optional.push(recommendation.line);
      recommendations.push(recommendation);
      continue;
    }

    const relation = row.projectedFullWeekEffectiveSets === row.mev
      ? "at MEV after seed"
      : "projected above MEV after seed";
    suppress.push(`- ${row.muscle}: ${relation}; ${getSuppressionAction(row.muscle)}.`);
  }

  lines.push("Priority:");
  lines.push(...(priority.length > 0 ? priority : ["- none"]));
  lines.push("Optional:");
  lines.push(...(optional.length > 0 ? optional : ["- none"]));
  if (monitor.length > 0) {
    lines.push("Monitor / defer:");
    lines.push(...monitor);
  }
  lines.push("Suppress:");
  lines.push(...(suppress.length > 0 ? suppress.slice(0, 8) : ["- none"]));
  lines.push("Guardrails:");
  lines.push("- session-local only; no seed/runtime/save/progression mutation");
  lines.push("- do not add extra pressing");
  lines.push("- do not add extra rows/pulldowns");
  lines.push("- do not chase full target deficit");
  lines.push("- avoid exceeding MAV/MRV; accept the miss if closure requires excessive raw volume");

  return { lines, recommendations };
}

function buildDeloadDoseClosurePlan(): DoseClosurePlan {
  return {
    lines: [
      "",
      "Dose Closure Guidance (Deload Context)",
      DELOAD_DO_NOT_CHASE_VOLUME_MESSAGE,
      "Priority:",
      "- none - deload volume deficits are expected/non-actionable.",
      "Optional:",
      "- none",
      "Suppress:",
      "- all hypertrophy add-set / MEV closure top-ups during ACTIVE_DELOAD.",
      "Guardrails:",
      "- run the deload prescription as generated unless a real blocker appears",
      "- no hypertrophy add-ons or MEV closure work during deload",
      "- no seed/runtime/save/progression mutation",
    ],
    recommendations: [],
  };
}

function selectPreSessionDoseDiagnostics(input: {
  diagnostics: NonNullable<ProjectedWeekVolumeAuditPayload["runtimeDoseAdjustmentDiagnostics"]>;
  nextSession: ProjectedWeekVolumeAuditPayload["projectedSessions"][number] | undefined;
  operatorDebug: boolean;
}): NonNullable<ProjectedWeekVolumeAuditPayload["runtimeDoseAdjustmentDiagnostics"]> {
  if (input.operatorDebug) {
    return [...input.diagnostics].sort((left, right) =>
      left.muscle.localeCompare(right.muscle)
    );
  }
  const nextMuscles = new Set(
    Object.entries(input.nextSession?.projectedContributionByMuscle ?? {})
      .filter(([, value]) => value > 0)
      .map(([muscle]) => muscle)
  );
  return input.diagnostics
    .filter(
      (diagnostic) =>
        nextMuscles.has(diagnostic.muscle) ||
        diagnostic.recommendedAction.setDelta !== 0 ||
        diagnostic.fatigueDensityConcern.level !== "none" ||
        diagnostic.recoveryReadinessCaveat.status !== "none"
    )
    .sort((left, right) => {
      const leftAction = Math.abs(left.recommendedAction.setDelta);
      const rightAction = Math.abs(right.recommendedAction.setDelta);
      return (
        rightAction - leftAction ||
        left.targetStatus.localeCompare(right.targetStatus) ||
        left.muscle.localeCompare(right.muscle)
      );
    })
    .slice(0, 8);
}

function buildPreSessionAvoidList(input: {
  diagnostics: NonNullable<ProjectedWeekVolumeAuditPayload["runtimeDoseAdjustmentDiagnostics"]>;
  sessionRisks: NonNullable<ProjectedWeekVolumeAuditPayload["sessionRisks"]>;
  nextSession: ProjectedWeekSession | undefined;
  doseClosureRecommendations: DoseClosureRecommendation[];
}): string[] {
  const avoid = new Set<string>();

  if (
    input.diagnostics.some(
      (diagnostic) =>
        diagnostic.muscle === "Chest" &&
        diagnostic.recommendedAction.setDelta > 0
    ) ||
    input.doseClosureRecommendations.some(
      (recommendation) => recommendation.muscle === "Chest"
    )
  ) {
    avoid.add("extra pressing");
  }
  if (
    input.diagnostics.some(
      (diagnostic) =>
        diagnostic.muscle === "Triceps" &&
        diagnostic.recommendedAction.setDelta > 0
    )
  ) {
    avoid.add("extra pressing for triceps");
  }
  if (
    input.diagnostics.some(
      (diagnostic) =>
        diagnostic.muscle === "Side Delts" &&
        diagnostic.recommendedAction.setDelta > 0
    )
  ) {
    avoid.add("extra lateral raise");
  }

  for (const diagnostic of input.diagnostics) {
    if (
      diagnostic.targetStatus === "near_mav" ||
      diagnostic.targetStatus === "over_mav" ||
      diagnostic.fatigueDensityConcern.level === "meaningful" ||
      diagnostic.fatigueDensityConcern.level === "high"
    ) {
      avoid.add(`extra ${diagnostic.muscle}`);
    }
  }
  for (const risk of input.sessionRisks) {
    avoid.add(`${risk.slotId}: ${risk.issue}`);
  }
  const region = getMuscleRegion(input.doseClosureRecommendations[0]?.muscle ?? "");
  if (
    region === "lower" ||
    (input.doseClosureRecommendations.length > 0 &&
      sessionMatchesRegion(input.nextSession, "lower"))
  ) {
    avoid.add("upper-body work");
    avoid.add("extra hinge");
  }

  return Array.from(avoid);
}

function buildSessionLocalCoachingReadout(input: {
  isActiveDeload: boolean;
  generated: NonNullable<WorkoutAuditArtifact["sessionSnapshot"]>["generated"] | undefined;
  exercises: Array<
    NonNullable<
      NonNullable<WorkoutAuditArtifact["sessionSnapshot"]>["generated"]
    >["exercises"][number]
  >;
  diagnostics: PreSessionDoseDiagnostic[];
  doseClosureRecommendations: DoseClosureRecommendation[];
  fatigueRows: string[];
  sessionRisks: NonNullable<ProjectedWeekVolumeAuditPayload["sessionRisks"]>;
  avoid: string[];
}): string[] {
  const lines = [
    "",
    "Session-Local Coaching Readout",
    "Default: run seed as prescribed. All suggestions are optional, session-local, and do not mutate the accepted seed.",
    "Floor-buffer opportunities:",
  ];

  if (input.isActiveDeload) {
    lines.push("- none - deload context suppresses hypertrophy top-ups");
  } else {
    const floorBuffers = input.doseClosureRecommendations.filter(
      (recommendation) => recommendation.kind === "floor_buffer"
    );
    lines.push(
      ...(floorBuffers.length > 0
        ? floorBuffers.map((recommendation) => recommendation.line)
        : ["- none"])
    );
  }

  lines.push("Prescription confidence watches:");
  const confidenceWatches = input.exercises.flatMap((exercise) => {
    const trace = input.generated?.traces.progression[exercise.exerciseId];
    if (!trace) {
      return [`- ${exercise.exerciseName}: progression trace unavailable; verify load by feel and keep prescribed RPE cap`];
    }
    const confidence = trace.confidence.combinedScale;
    const reasons = trace.confidence.reasons.slice(0, 2).join(",") || "standard";
    if (
      confidence < 0.75 ||
      trace.outcome.action === "decrease" ||
      reasons.includes("estimate") ||
      reasons.includes("low")
    ) {
      return [
        `- ${exercise.exerciseName}: action=${trace.outcome.action} confidence=${formatAuditDecimal(confidence)} reasons=${reasons}`,
      ];
    }
    return [];
  });
  lines.push(...(confidenceWatches.length > 0 ? confidenceWatches : ["- none"]));

  lines.push("Fatigue cautions:");
  const diagnosticFatigue = input.diagnostics.flatMap((diagnostic) => {
    if (diagnostic.fatigueDensityConcern.level === "none") {
      return [];
    }
    const drivers = diagnostic.fatigueDensityConcern.drivers
      .slice(0, 2)
      .map((driver) => driver.exerciseName)
      .join(", ") || "projected session";
    return [
      `- ${diagnostic.muscle}: ${diagnostic.fatigueDensityConcern.level} fatigue watch via ${drivers}`,
    ];
  });
  const fatigueCautions = Array.from(
    new Set([
      ...input.fatigueRows.map((row) => `- ${row}`),
      ...input.sessionRisks.map((risk) => `- ${risk.slotId}: ${risk.issue}`),
      ...diagnosticFatigue,
    ])
  );
  lines.push(...(fatigueCautions.length > 0 ? fatigueCautions.slice(0, 6) : ["- none"]));

  lines.push("Safe optional add-ons:");
  if (input.isActiveDeload || input.doseClosureRecommendations.length === 0) {
    lines.push("- none");
  } else {
    lines.push(
      ...input.doseClosureRecommendations
        .slice(0, 4)
        .map((recommendation) => recommendation.addonLine)
    );
  }

  lines.push("Suppress / avoid:");
  if (input.isActiveDeload) {
    lines.push("- all hypertrophy add-ons / MEV closure top-ups during ACTIVE_DELOAD");
  } else {
    lines.push(...(input.avoid.length > 0 ? input.avoid.slice(0, 6).map((item) => `- ${item}`) : ["- no extra work beyond session-local readiness judgment"]));
  }

  return lines;
}

function buildSafeToTrain(input: {
  artifact: Pick<
    WorkoutAuditArtifact,
    | "generation"
    | "nextSession"
    | "sessionSnapshot"
    | "warningSummary"
    | "preSessionReadiness"
    | "projectedWeekVolume"
  >;
}): { safe: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (input.artifact.warningSummary.counts.blockingErrors > 0) {
    reasons.push("blocking audit errors are present");
  }
  if (input.artifact.generation && "error" in input.artifact.generation) {
    reasons.push(`generation failed: ${input.artifact.generation.error}`);
  }
  if (!input.artifact.sessionSnapshot?.generated && !input.artifact.generation) {
    reasons.push("missing generated session preview");
  }
  if (
    input.artifact.nextSession?.source === "existing_incomplete" &&
    input.artifact.nextSession.selectedIncompleteReadiness?.safeToTrain !== true
  ) {
    reasons.push(
      `incomplete workout blocker: ${input.artifact.nextSession.existingWorkoutId ?? "unknown"} (${input.artifact.nextSession.selectedIncompleteStatus ?? "unknown"})`
    );
  }
  if (input.artifact.nextSession?.source === "final_week_close_pending") {
    reasons.push(
      input.artifact.nextSession.lifecycleBlocker?.message ??
        "final accumulation closeout is pending"
    );
  }
  if (
    input.artifact.preSessionReadiness?.activeMesocycle
      .mesocycleIdMatchesRequest === false
  ) {
    reasons.push("requested mesocycle id does not match the active mesocycle");
  }
  if (!input.artifact.projectedWeekVolume) {
    reasons.push("missing current-week projection and dose guidance");
  }

  return {
    safe: reasons.length === 0,
    reasons: reasons.length > 0 ? reasons : ["no blocking audit, state, or generation blockers detected"],
  };
}

function buildPreSessionReadinessSummaryFromContract(input: {
  artifact: Pick<
    WorkoutAuditArtifact,
    | "sessionSnapshot"
    | "weeklyRetro"
    | "preSessionReadiness"
  >;
  contract: PreSessionReadinessContract;
}): string[] {
  const contract = input.contract;
  const generated = input.artifact.sessionSnapshot?.generated;
  const active = input.artifact.preSessionReadiness?.activeMesocycle;
  const exercises = [...(generated?.exercises ?? [])].sort(
    (left, right) => left.orderIndex - right.orderIndex
  );
  const isActiveDeload = contract.nextSessionIdentity.activeState === "ACTIVE_DELOAD";
  const lines = [
    "Pre-Session Readiness",
    "---------------------",
    `Current app state: owner=${contract.nextSessionIdentity.ownerEmail ?? contract.nextSessionIdentity.userId} active_mesocycle=${contract.nextSessionIdentity.activeMesocycleId ?? "unknown"} state=${contract.nextSessionIdentity.activeState ?? "unknown"} completed_accumulation_sessions=${formatAuditValue(active?.completedAccumulationSessions)} current_week=${formatAuditValue(contract.nextSessionIdentity.currentWeek)} current_session=${formatAuditValue(contract.nextSessionIdentity.currentSession)} next_slot=${contract.nextSessionIdentity.nextSlotId ?? "unknown"} incomplete_workout_blocker=${contract.startability.safeToTrain ? "none" : contract.nextSessionIdentity.existingWorkoutId ?? "none"} incomplete_workout_readiness=${contract.nextSessionIdentity.incompleteWorkoutReadiness}`,
    `Existing workout action: ${contract.nextSessionIdentity.existingWorkoutAction}`,
    isActiveDeload
      ? `Deload sessions completed: ${formatAuditValue(active?.deloadSessionsCompleted)}`
      : "Deload sessions completed: n/a",
    isActiveDeload
      ? `Deload session position: ${
          active?.deloadSessionPosition
            ? `${active.deloadSessionPosition.current} of ${active.deloadSessionPosition.total}`
            : "n/a"
        }`
      : "Deload session position: n/a",
    `Lifecycle blocker: ${
      contract.nextSessionIdentity.generationPath === "blocked_closeout_required"
        ? contract.startability.blockerSummary
        : "none"
    }`,
    `Generation: path=${contract.nextSessionIdentity.generationPath} generator=${contract.nextSessionIdentity.generator} composition_source=${contract.seedRuntimeProof.compositionSource ?? "unknown"} receipt_mesocycle=${contract.seedRuntimeProof.receiptMesocycleId ?? "unknown"} seed_source=${contract.seedRuntimeProof.seedSource ?? "unknown"} seed_shape=${contract.seedRuntimeProof.seedExecutableShape ?? "unknown"} seed_or_slot_hash=not_available`,
    ...contract.seedRuntimeProof.proofLines,
    "",
    "Generated Preview",
    "Order | Exercise | Sets | Load | Rep target/range | RPE",
  ];

  if (exercises.length === 0) {
    lines.push("none | no generated exercises available | n/a | n/a | n/a | n/a");
  } else {
    for (const exercise of exercises) {
      const firstSet = exercise.prescribedSets[0];
      lines.push(
        `${exercise.orderIndex + 1} | ${exercise.exerciseName} | ${exercise.prescribedSetCount} | ${formatAuditDecimal(firstSet?.targetLoad)} | ${formatRepTarget(firstSet)} | ${formatAuditDecimal(firstSet?.targetRpe)}`
      );
    }
  }

  lines.push("", "Prescription Confidence / Cautions");
  lines.push(
    ...(contract.sessionLocalCoaching.prescriptionConfidenceWatches.length > 0
      ? contract.sessionLocalCoaching.prescriptionConfidenceWatches.map((line) =>
          line.startsWith("- ") ? line.slice(2) : line
        )
      : ["none"])
  );

  lines.push(
    "",
    isActiveDeload
      ? "Current-Week Dose Guidance (Deload Context)"
      : "Current-Week Dose Guidance"
  );
  if (isActiveDeload) {
    lines.push(DELOAD_DO_NOT_CHASE_VOLUME_MESSAGE);
  }
  lines.push("Muscle | projected vs MEV/target/MAV | status | recommended action | confidence");
  if (contract.projectedWeekStatus.doseGuidanceRows.length === 0) {
    lines.push(
      isActiveDeload
        ? "none | deload-context volume deficits are non-actionable | n/a | run deload prescription; no MEV/top-up work | n/a"
        : "none | no relevant dose diagnostics | n/a | hold seed | n/a"
    );
  } else {
    lines.push(...contract.projectedWeekStatus.doseGuidanceRows.map((row) => row.line));
  }

  lines.push("", contract.doseClosure.heading);
  if (isActiveDeload) {
    lines.push(DELOAD_DO_NOT_CHASE_VOLUME_MESSAGE);
  }
  lines.push("Priority:");
  lines.push(...contract.doseClosure.priority);
  lines.push("Optional:");
  lines.push(...contract.doseClosure.optional);
  if (contract.doseClosure.monitor.length > 0) {
    lines.push("Monitor / defer:");
    lines.push(...contract.doseClosure.monitor);
  }
  lines.push("Suppress:");
  lines.push(...contract.doseClosure.suppress);
  lines.push("Guardrails:");
  lines.push(...contract.doseClosure.guardrails);

  const retro = input.artifact.weeklyRetro;
  lines.push("", "Prior-Week / Fatigue Context");
  lines.push(
    retro
      ? `prior_week=${retro.week} planned_completed=${retro.planAdherence.plannedWorkCompletedSets}/${retro.planAdherence.plannedWorkTotalSets} performed_planned_sets missed=${retro.planAdherence.plannedWorkMissedSets} added_sets=${formatSignedSetDelta(retro.planAdherence.explainedAdditions.totalSets)} confidence_impact=${retro.planAdherence.engineConfidenceImpact}`
      : "prior_week=not_available"
  );
  lines.push(
    `fatigue_notes=${
      contract.calibrationWatches.fatigue.length > 0
        ? contract.calibrationWatches.fatigue
            .map((line) => line.replace(/^- /, ""))
            .slice(0, 6)
            .join("; ")
        : "none"
    }`
  );
  lines.push(
    `recovery_caveats=${
      contract.calibrationWatches.recoveryCaveats.length > 0
        ? contract.calibrationWatches.recoveryCaveats.join("; ")
        : "none"
    }`
  );

  lines.push("", "Session-Local Coaching Readout");
  lines.push(contract.sessionLocalCoaching.defaultInstruction);
  lines.push("Floor-buffer opportunities:");
  lines.push(
    ...(contract.sessionLocalCoaching.floorBufferOpportunities.length > 0
      ? contract.sessionLocalCoaching.floorBufferOpportunities
      : ["- none"])
  );
  lines.push("Prescription confidence watches:");
  lines.push(...contract.sessionLocalCoaching.prescriptionConfidenceWatches);
  lines.push("Fatigue cautions:");
  lines.push(...contract.sessionLocalCoaching.fatigueCautions);
  lines.push("Safe optional add-ons:");
  lines.push(...contract.sessionLocalCoaching.safeOptionalAddOns);
  lines.push("Suppress / avoid:");
  lines.push(...contract.sessionLocalCoaching.suppressAvoid);

  lines.push("", "Session-Local Add-On Recommendation");
  if (contract.startability.safeToTrain) {
    lines.push(
      contract.startability.action === "run_deload_seed_as_prescribed"
        ? "Run deload seed as prescribed."
        : "Run seed as prescribed."
    );
    lines.push(
      isActiveDeload
        ? DELOAD_DO_NOT_CHASE_VOLUME_MESSAGE
        : contract.sessionLocalCoaching.addOnState.status === "available"
          ? "Use Dose Closure Guidance for MEV-floor top-ups; session-local only."
          : contract.sessionLocalCoaching.addOnState.reason
    );
  } else {
    lines.push("Resolve blocker before starting.");
    lines.push(contract.startability.blockerSummary);
  }
  lines.push("Optional add-ons:");
  lines.push(...contract.sessionLocalCoaching.safeOptionalAddOns);
  lines.push("Avoid:");
  lines.push(...contract.sessionLocalCoaching.suppressAvoid);
  lines.push(
    "Boundary: recommendations only; no workout/session/log/seed/progression mutation."
  );

  const checkWarnings = contract.consistencyChecks.filter(
    (check) => check.status !== "pass"
  );
  if (checkWarnings.length > 0) {
    lines.push("", "Consistency Checks");
    for (const check of checkWarnings) {
      lines.push(
        `${check.status}: ${check.id} - ${check.message}${
          check.evidence.length > 0 ? ` Evidence: ${check.evidence.join(", ")}` : ""
        }`
      );
    }
  }

  lines.push("", `Safe to train: ${contract.startability.safeToTrain ? "yes" : "no"}`);
  lines.push(`Reason: ${contract.startability.reasons.join("; ")}`);

  return lines;
}

export function buildWorkoutAuditModeLine(input: {
  mode: string;
  plannerDiagnosticsMode: string;
  summary: string;
  preSessionReadiness?: Pick<
    NonNullable<WorkoutAuditArtifact["preSessionReadiness"]>,
    "activeMesocycle"
  >;
  projectedWeekVolume?: Pick<
    NonNullable<WorkoutAuditArtifact["projectedWeekVolume"]>,
    "currentWeek"
  >;
  weeklyRetro?: Pick<NonNullable<WorkoutAuditArtifact["weeklyRetro"]>, "week">;
}): string {
  const active = input.preSessionReadiness?.activeMesocycle;
  if (active?.state === "ACTIVE_DELOAD") {
    const deloadWeek = active.currentWeek ?? input.projectedWeekVolume?.currentWeek.week;
    const projectedWeek = input.projectedWeekVolume?.currentWeek.week;
    const referenceWeek =
      input.weeklyRetro?.week != null && input.weeklyRetro.week !== deloadWeek
        ? input.weeklyRetro.week
        : projectedWeek != null && projectedWeek !== deloadWeek
          ? projectedWeek
          : null;
    const accumulationReference =
      referenceWeek != null
        ? ` accumulation_reference_week=${referenceWeek}`
        : "";
    const summary = input.summary.replace(/^week=[^\s]+\s*/, "");
    return `[workout-audit] mode=${input.mode} diagnostics=deload planner_diagnostics=${input.plannerDiagnosticsMode} deload_week=${formatAuditValue(deloadWeek)}${accumulationReference}${summary ? ` ${summary}` : ""}`;
  }

  return `[workout-audit] mode=${input.mode} diagnostics=${input.plannerDiagnosticsMode} ${input.summary}`;
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
    plannerOnlyNoRepair?: {
      repairPromotionScoreboard?:
        | NonNullable<
            NonNullable<
              NonNullable<WorkoutAuditArtifact["mesocycleExplain"]>["plannerOnlyNoRepair"]
            >["repairPromotionScoreboard"]
          >
        | null;
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
    "  --mode <mode>                      Audit mode: future-week, pre-session-readiness, projected-week-volume, current-week-audit, historical-week, weekly-retro, mesocycle-explain, deload, progression-anchor, active-mesocycle-slot-reseed, replace-empty-mesocycle-with-v2, replace-empty-successor-from-accepted-seed-draft, v2-accepted-seed-prepare-compare, next-mesocycle-handoff-dry-run, next-mesocycle-acceptance-gate, next-mesocycle-post-accept-verification.",
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

function formatCountRecord(
  counts: Readonly<Record<string, number>> | null | undefined,
  limit = 5
): string {
  const entries = Object.entries(counts ?? {})
    .filter(([, value]) => typeof value === "number" && value > 0)
    .sort(
      ([leftKey, leftValue], [rightKey, rightValue]) =>
        rightValue - leftValue || leftKey.localeCompare(rightKey)
    );
  if (entries.length === 0) {
    return "none";
  }
  const visible = entries
    .slice(0, limit)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  const remaining = entries.length - limit;
  return remaining > 0 ? `${visible} +${remaining} more` : visible;
}

function formatPromotionProofGates(
  gates:
    | ReadonlyArray<{
        gate: string;
        status: string;
        ownerSeam: string;
      }>
    | null
    | undefined
): string {
  const rows = asArray(gates);
  if (rows.length === 0) {
    return "not_available";
  }
  return rows
    .map((row) => `${row.gate}:${row.status}@${row.ownerSeam}`)
    .join("; ");
}

function formatGapInventory(
  rows:
    | ReadonlyArray<{
        rank: number;
        gapId: string;
        likelyOwnerSeam: string;
        evidenceQuality: string;
        trainingImportance: string;
        gapCount: number;
        status: string;
        measurableNextStep: string;
      }>
    | null
    | undefined
): string {
  const inventory = asArray(rows);
  if (inventory.length === 0) {
    return "not_available";
  }
  return inventory
    .slice(0, 5)
    .map(
      (row) =>
        `#${row.rank} ${row.gapId}@${row.likelyOwnerSeam} count=${row.gapCount} importance=${row.trainingImportance} evidence=${row.evidenceQuality} status=${row.status} next=${row.measurableNextStep}`
    )
    .join("; ");
}

function formatTaxonomyMismatchInventory(
  inventory:
    | {
        summary?: {
          mismatchRowCount?: number;
          selectedIdentityAffectedCount?: number;
          cleanAlternativeAvailableCount?: number;
          ownerCounts?: Record<string, number>;
          selectedMismatchId?: string | null;
        };
      }
    | null
    | undefined
): string {
  if (!inventory?.summary) {
    return "not_available";
  }
  return `rows=${inventory.summary.mismatchRowCount ?? 0} selectedIdentityAffected=${inventory.summary.selectedIdentityAffectedCount ?? 0} cleanAlternatives=${inventory.summary.cleanAlternativeAvailableCount ?? 0} selected=${inventory.summary.selectedMismatchId ?? "none"} owners=${formatCountRecord(inventory.summary.ownerCounts, 4)}`;
}

function formatSetBudgetGapInventory(
  inventory:
    | {
        summary?: {
          gapRowCount?: number;
          setDistributionIntentOwnedCount?: number;
          downstreamMaterializerOrCapacityCount?: number;
          diagnosticOnlyOrStaleCount?: number;
          selectedGapId?: string | null;
          ownerCounts?: Record<string, number>;
        };
      }
    | null
    | undefined
): string {
  if (!inventory?.summary) {
    return "not_available";
  }
  return `rows=${inventory.summary.gapRowCount ?? 0} setDistributionOwned=${inventory.summary.setDistributionIntentOwnedCount ?? 0} downstreamOrCapacity=${inventory.summary.downstreamMaterializerOrCapacityCount ?? 0} diagnosticOrStale=${inventory.summary.diagnosticOnlyOrStaleCount ?? 0} selected=${inventory.summary.selectedGapId ?? "none"} owners=${formatCountRecord(inventory.summary.ownerCounts, 4)}`;
}

function formatSupportFloorGapInventory(
  inventory:
    | {
        summary?: {
          gapRowCount?: number;
          setDistributionIntentOwnedCount?: number;
          downstreamMaterializerOrCapacityCount?: number;
          diagnosticOnlyOrStaleCount?: number;
          trueOwnerSpecificGapCount?: number;
          staleNoiseCount?: number;
          measuredNoImpactCount?: number;
          blockerCount?: number;
          selectedGapId?: string | null;
          readoutClassificationCounts?: Record<string, number>;
          ownerCounts?: Record<string, number>;
        };
        rows?: ReadonlyArray<{
          rank?: number;
          supportFloorGapId?: string;
          week?: number;
          slotId?: string;
          laneId?: string;
          muscle?: string;
          directFloorExpected?: number;
          directFloorDelivered?: number;
          likelyOwnerSeam?: string;
          evidenceQuality?: string;
          trainingImportance?: string;
          classification?: string;
          readoutClassification?: string;
        }>;
      }
    | null
    | undefined
): string {
  if (!inventory?.summary) {
    return "not_available";
  }
  const selectedId = inventory.summary.selectedGapId;
  const selectedRow = asArray(inventory.rows).find(
    (row) => row.supportFloorGapId === selectedId
  );
  const readoutSummary = inventory.summary.readoutClassificationCounts
    ? ` readout=${formatCountRecord(inventory.summary.readoutClassificationCounts, 6)}`
    : "";
  const selectedDetail = selectedRow
    ? ` selectedDetail=week_${selectedRow.week ?? "?"}:${selectedRow.slotId ?? "unknown"}:${selectedRow.laneId ?? "unknown"}:${selectedRow.muscle ?? "unknown"} floor=${selectedRow.directFloorDelivered ?? "?"}/${selectedRow.directFloorExpected ?? "?"} owner=${selectedRow.likelyOwnerSeam ?? "unknown"} evidence=${selectedRow.evidenceQuality ?? "unknown"} class=${selectedRow.classification ?? "unknown"} readout=${selectedRow.readoutClassification ?? "unknown"}`
    : "";
  return `rows=${inventory.summary.gapRowCount ?? 0} setDistributionOwned=${inventory.summary.setDistributionIntentOwnedCount ?? 0} downstreamOrCapacity=${inventory.summary.downstreamMaterializerOrCapacityCount ?? 0} diagnosticOrStale=${inventory.summary.diagnosticOnlyOrStaleCount ?? 0} measuredNoImpact=${inventory.summary.measuredNoImpactCount ?? 0} staleNoise=${inventory.summary.staleNoiseCount ?? 0} trueOwner=${inventory.summary.trueOwnerSpecificGapCount ?? 0} blockers=${inventory.summary.blockerCount ?? 0} selected=${selectedId ?? "none"} owners=${formatCountRecord(inventory.summary.ownerCounts, 4)}${readoutSummary}${selectedDetail}`;
}

function formatSelectedGapProof(
  proof:
    | {
        gapId: string;
        selectedMismatchId?: string;
        selectedSetBudgetGapId?: string;
        selectedSupportFloorGapId?: string;
        classification: string;
        proofResult: string;
        rightfulOwnerSeam: string;
        consumedByProduction: boolean;
        safeForBehaviorPromotion: boolean;
        missingGates: readonly string[];
        nextSafeAction: string;
      }
    | null
    | undefined
): string {
  if (!proof) {
    return "not_available";
  }
  const selectedId =
    proof.selectedMismatchId ??
    proof.selectedSetBudgetGapId ??
    proof.selectedSupportFloorGapId;
  return `${proof.gapId}:${proof.proofResult}@${proof.rightfulOwnerSeam} classification=${proof.classification}${selectedId ? ` selected=${selectedId}` : ""} consumedByProduction=${proof.consumedByProduction ? "yes" : "no"} safeForBehavior=${proof.safeForBehaviorPromotion ? "yes" : "no"} missing=${formatNameList(proof.missingGates, 4)} next=${proof.nextSafeAction}`;
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
    risks.push("Chest below preferred target across accumulation");
  }
  if (hasWarning("MUSCLE_OVERDELIVERED_ACROSS_ACCUMULATION", "Hamstrings")) {
    risks.push("Hamstrings overdelivered if repeated");
  }
  if (hasWarning("SUPPORT_UNDER_TARGET_ACROSS_ACCUMULATION", "Side Delts")) {
    risks.push("Side Delts below preferred support target");
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
    risks.push("Chest below preferred target across accumulation");
  }
  if (hasWarning("HAMSTRINGS_OVERDELIVERED_ACROSS_ACCUMULATION")) {
    risks.push("Hamstrings overdelivered across accumulation");
  }
  if (hasWarning("SIDE_DELTS_UNDER_TARGET_ACROSS_ACCUMULATION")) {
    risks.push("Side Delts below preferred support target across accumulation");
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
  const repairPromotionScoreboard =
    input.artifact.mesocycleExplain?.plannerOnlyNoRepair?.repairPromotionScoreboard;
  const scoreboardPromotionCandidates = asArray(
    repairPromotionScoreboard?.promotionCandidates
  );
  const legacyRepairQuarantine =
    repairPromotionScoreboard?.interpretation.legacyRepairQuarantine;
  const repairQuarantineGroups =
    repairPromotionScoreboard?.interpretation.quarantineGroups;
  const missingPromotionProof =
    repairPromotionScoreboard?.interpretation.missingProofBeforeBehaviorPromotion;
  const gapInventory = repairPromotionScoreboard?.interpretation.gapInventory;
  const selectedGapProof =
    repairPromotionScoreboard?.interpretation.selectedGapProof;
  const taxonomyMismatchInventory =
    repairPromotionScoreboard?.interpretation.taxonomyMismatchInventory;
  const supportFloorGapInventory =
    repairPromotionScoreboard?.interpretation.supportFloorGapInventory;
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
  if (legacyRepairQuarantine) {
    lines.push(
      `- legacyRepairQuarantine: evidence_only behaviorCandidates=${legacyRepairQuarantine.behaviorPromotionCandidateCount} quarantined=${legacyRepairQuarantine.quarantinedRowCount} staleArtifacts=${legacyRepairQuarantine.staleRepairedProjectionArtifactCount}`
    );
  }
  if (repairQuarantineGroups) {
    lines.push(
      `- quarantineGroups: upstreamOwned=${repairQuarantineGroups.upstreamOwnedCandidate.count} safetyRepairOnly=${repairQuarantineGroups.safetyRepairOnly.count} collateralAmbiguous=${repairQuarantineGroups.collateralAmbiguous.count} staleArtifact=${repairQuarantineGroups.staleArtifact.count} missingEvidenceOrGate=${repairQuarantineGroups.missingEvidenceOrUnmeasuredGate.count}`
    );
  }
  if (missingPromotionProof) {
    lines.push(
      `- missingProofBeforeBehaviorPromotion: ${formatPromotionProofGates(missingPromotionProof)}`
    );
  }
  if (gapInventory) {
    lines.push(`- rankedGapInventory: ${formatGapInventory(gapInventory)}`);
  }
  if (taxonomyMismatchInventory) {
    lines.push(
      `- taxonomyMismatchInventory: ${formatTaxonomyMismatchInventory(taxonomyMismatchInventory)}`
    );
  }
  if (supportFloorGapInventory) {
    lines.push(
      `- supportFloorGapInventory: ${formatSupportFloorGapInventory(supportFloorGapInventory)}`
    );
  }
  if (selectedGapProof) {
    lines.push(`- selectedGapProof: ${formatSelectedGapProof(selectedGapProof)}`);
  }
  const promotionCandidateSignal =
    repairPromotionScoreboard
      ? scoreboardPromotionCandidates
          .map((row) => `${row.slotId} ${row.muscle} -> ${row.correctOwner}`)
          .slice(0, 6)
          .join("; ")
      : promotionCandidates.length > 0
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
  lines.push("", repairPromotionScoreboard ? "Behavior promotion candidates:" : "Promotion candidates:");
  if (repairPromotionScoreboard) {
    if (scoreboardPromotionCandidates.length === 0) {
      lines.push("- none");
    } else {
      lines.push(
        ...scoreboardPromotionCandidates
          .slice(0, 8)
          .map(
            (row) =>
              `- ${row.slotId}: ${row.muscle} (${row.action}, ${row.materiality}) -> ${row.correctOwner}`
          )
      );
    }
  } else if (promotionCandidates.length > 0) {
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

export function buildAcceptedSeedDraftSuccessorRecoverySummary(input: {
  artifact: Pick<WorkoutAuditArtifact, "replaceEmptySuccessorFromAcceptedSeedDraft">;
  outputPath: string;
}): string[] | null {
  const payload = input.artifact.replaceEmptySuccessorFromAcceptedSeedDraft;
  if (!payload) {
    return null;
  }

  const blockers = payload.guardSummary.blockers.join(",") || "none";
  const changedSlots = payload.seedComparison.changedSlotIds.join(", ") || "none";
  const oldUpper = payload.seedComparison.anchors.upperA.old;
  const newUpper = payload.seedComparison.anchors.upperA.candidate;
  const oldLower = payload.seedComparison.anchors.lowerA.old;
  const newLower = payload.seedComparison.anchors.lowerA.candidate;

  return [
    `[workout-audit:accepted-seed-draft-recovery] source=${payload.sourceMesocycle.id} successor=${payload.targetSuccessor.id} verdict=${payload.verdict} dry_run=${formatBooleanFlag(payload.dryRun)} write_eligible=${formatBooleanFlag(payload.write.eligible)}`,
    `[workout-audit:accepted-seed-draft-recovery] replacement_source=${payload.recoverySource.replacementSource} persisted_draft=${formatBooleanFlag(payload.recoverySource.persistedAcceptedSeedDraft)} fresh_v2_generated=${formatBooleanFlag(payload.recoverySource.freshV2Generated)}`,
    `[workout-audit:accepted-seed-draft-recovery] blockers=${blockers} target_empty=${formatBooleanFlag(payload.guardSummary.targetEmpty)} slot_order_compatible=${formatBooleanFlag(payload.guardSummary.slotOrderCompatible)} current_seed_differs=${formatBooleanFlag(payload.guardSummary.currentSeedDiffers)}`,
    `[workout-audit:accepted-seed-draft-recovery] seed_source=${payload.seedComparison.currentSource ?? "missing"}->${payload.seedComparison.candidateSource ?? "missing"} changed_slots=${changedSlots}`,
    `[workout-audit:accepted-seed-draft-recovery] upper_a=${oldUpper?.exerciseName ?? "missing"}:${formatAuditValue(oldUpper?.setCount)}->${newUpper?.exerciseName ?? "missing"}:${formatAuditValue(newUpper?.setCount)} lower_a=${oldLower?.exerciseName ?? "missing"}:${formatAuditValue(oldLower?.setCount)}->${newLower?.exerciseName ?? "missing"}:${formatAuditValue(newLower?.setCount)}`,
    `[workout-audit:accepted-seed-draft-recovery] safety db_write=${formatBooleanFlag(payload.safety.liveDbMutated)} runtime_replay_changed=${formatBooleanFlag(payload.safety.runtimeReplayChanged)} workouts_logs_sessions_created=${formatBooleanFlag(payload.safety.workoutsLogsSessionsCreated)} transaction=${payload.write.transactionStatus}`,
    `[workout-audit:accepted-seed-draft-recovery] artifact=${input.outputPath}`,
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

export function buildNextMesocycleHandoffDryRunSummary(input: {
  artifact: Pick<WorkoutAuditArtifact, "nextMesocycleHandoffDryRun">;
}): string[] | null {
  const payload = input.artifact.nextMesocycleHandoffDryRun;
  if (!payload) {
    return null;
  }

  const lines = [
    "",
    "Handoff Dry Run Summary",
    `writes=${payload.summary.writes}`,
    `source_state=${payload.summary.sourceState ?? "unknown"}`,
    `source_mesocycle_id=${payload.summary.sourceMesocycleId}`,
    `candidate_available=${formatBooleanFlag(payload.summary.candidateAvailable)}`,
    `handoff_ready=${formatBooleanFlag(payload.summary.handoffReady)}`,
    `blocking_reason=${payload.summary.blockingReason ?? "none"}`,
    "",
    "Persisted Draft Truth",
    `persisted_draft_source=${payload.persistedDraftTruth.source ?? "none"}`,
    `persisted_draft_rows=${payload.persistedDraftTruth.exerciseCount}`,
    `persisted_draft_shape=${payload.persistedDraftTruth.seedShape}`,
    `persisted_draft_parser_compatible=${formatBooleanFlag(payload.persistedDraftTruth.parserCompatible)}`,
    `persisted_draft_minimal_executable_rows_only=${formatBooleanFlag(payload.persistedDraftTruth.minimalExecutableRowsOnly)}`,
    "",
    "Prepared Projection / Would-Write Summary",
  ];

  if (payload.wouldPrepareWriteSummary) {
    const summary = payload.wouldPrepareWriteSummary;
    lines.push(`successor_source=${summary.successorSource}`);
    lines.push(`slot_sequence=${summary.slotSequence}`);
    lines.push(`seed_shape=${summary.seedShape}`);
    lines.push(
      `prepared_projection_source=${summary.slotPlanSeedSource ?? "none"}`,
    );
    lines.push(`legacy_projection_use=${summary.legacyProjectionUse}`);
    lines.push(`training_blocks_count=${summary.trainingBlocksCount}`);
    lines.push(`carried_roles_count=${summary.carriedRolesCount}`);
    lines.push(`constraints_action=${summary.constraintsAction}`);
    lines.push(`source_completion_action=${summary.sourceCompletionAction}`);
    lines.push(`transaction_boundary=${summary.transactionBoundary}`);
  } else {
    lines.push("not_available");
  }
  lines.push("No DB writes occur.");

  lines.push("");
  lines.push("Candidate Identity Summary");
  if (payload.candidateIdentity.rows.length === 0) {
    lines.push("candidate_identity=not_available_until_handoff");
  } else {
    lines.push("slot | lane/role | exercise | set_count | source");
    for (const row of payload.candidateIdentity.rows) {
      lines.push(
        [
          row.slotId,
          row.laneOrRole,
          row.exerciseName,
          row.setCount,
          row.source,
        ].join(" | "),
      );
    }
  }

  lines.push("");
  lines.push("Seed Shape Summary");
  lines.push(
    `slotPlanSeedJson=${payload.seedShapeSummary.slotPlanSeedJson} would_be_built=${formatBooleanFlag(payload.seedShapeSummary.wouldBeBuilt)}`,
  );
  lines.push(`truth_basis=${payload.seedShapeSummary.truthBasis}`);
  lines.push(
    `minimal_executable_rows_only=${formatBooleanFlag(payload.seedShapeSummary.minimalExecutableRowsOnly)} fields=${payload.seedShapeSummary.executableFields.join(",")}`,
  );
  lines.push(`serializer_path=${payload.seedShapeSummary.serializerPath}`);
  lines.push(
    `slots=${payload.seedShapeSummary.slotCount} exercises=${payload.seedShapeSummary.exerciseCount} parser_compatible=${formatBooleanFlag(payload.seedShapeSummary.parserCompatible === true)}`,
  );

  lines.push("");
  lines.push("Weekly Volume / Floor / Cap Summary");
  lines.push(
    `status=${payload.weeklyVolumeFloorCapSummary.status} basis=${payload.weeklyVolumeFloorCapSummary.basis}`,
  );

  lines.push("");
  lines.push("Acceptance Gate Payload Summary");
  lines.push("check | enough_data | basis");
  for (const check of payload.acceptanceGatePayloadSummary.checks) {
    lines.push(
      `${check.check} | ${formatBooleanFlag(check.enoughData)} | ${check.basis}`,
    );
  }

  lines.push("");
  lines.push("Week 1 Runtime Replay Preview");
  lines.push(
    `status=${payload.weekOneRuntimeReplayPreview.status} runtime_replay_instantiated=${formatBooleanFlag(payload.weekOneRuntimeReplayPreview.runtimeReplayInstantiated)}`,
  );
  lines.push(`limitation=${payload.weekOneRuntimeReplayPreview.limitation}`);
  if (payload.weekOneRuntimeReplayPreview.rows.length > 0) {
    lines.push("slot | exercise | role | set_count");
    for (const row of payload.weekOneRuntimeReplayPreview.rows) {
      lines.push(
        [row.slotId, row.exerciseName, row.role, row.setCount].join(" | "),
      );
    }
  }

  lines.push("");
  lines.push("Compare To Existing Modes");
  for (const comparison of payload.modeComparison) {
    lines.push(`${comparison.mode}: ${comparison.distinction}`);
  }

  return lines;
}

export function buildNextMesocycleAcceptanceGateSummary(input: {
  artifact: Pick<WorkoutAuditArtifact, "nextMesocycleAcceptanceGate">;
}): string[] | null {
  const payload = input.artifact.nextMesocycleAcceptanceGate;
  if (!payload) {
    return null;
  }

  const lines = [
    "",
    "Next Mesocycle Acceptance Gate",
    `candidate found: ${formatBooleanFlag(payload.candidateFound)}`,
    `final decision: ${payload.gateResult}`,
  ];

  if (payload.why.length > 0) {
    lines.push("why:");
    for (const reason of payload.why) {
      lines.push(`- ${reason}`);
    }
  }
  lines.push(`recommendation: ${payload.recommendation}`);
  lines.push("");
  lines.push("Decision Summary");
  lines.push(
    "Trainability | Planner/materializer quality | Repair burden | Repair source | Repair classification | Materializer guardrail | Materializer next action | Shadow consumption | Shadow next action | Repair evidence | Materializer evidence | Shadow evidence",
  );
  lines.push(
    [
      payload.decisionSummary.trainability,
      payload.decisionSummary.plannerMaterializerQuality,
      payload.decisionSummary.repairBurden,
      payload.decisionSummary.repairBurdenSource,
      payload.decisionSummary.repairBurdenClassification,
      payload.decisionSummary.materializerGuardrailClassification,
      payload.decisionSummary.materializerGuardrailNextSafeAction,
      payload.decisionSummary.shadowConsumptionClassification,
      payload.decisionSummary.shadowConsumptionNextSafeAction,
      payload.decisionSummary.repairBurdenEvidence,
      payload.decisionSummary.materializerGuardrailEvidence,
      payload.decisionSummary.shadowConsumptionEvidence,
    ].join(" | "),
  );
  lines.push("");
  lines.push("Candidate Identity");
  lines.push("Owner | Source Mesocycle | Source State | Candidate | Candidate/Draft ID | Accepted/Draft/Absent | Write Needed");
  lines.push(
    [
      payload.candidateIdentity.ownerEmail ?? "unknown",
      payload.candidateIdentity.sourceMesocycleId,
      payload.candidateIdentity.sourceState ?? "unknown",
      payload.candidateFound ? "yes" : "no",
      payload.candidateIdentity.candidateMesocycleId ?? "none",
      payload.candidateIdentity.candidateKind,
      payload.candidateIdentity.writeNeededToInspect ? "yes" : "no",
    ].join(" | "),
  );
  lines.push("");
  lines.push("Gate | Status | Severity | Evidence | Owner seam | Smallest safe fix | Must fix before Week 1 | Notes");
  for (const gate of payload.gates) {
    lines.push(
      [
        gate.gate,
        gate.status,
        gate.severity,
        gate.evidence,
        gate.ownerSeam,
        gate.smallestSafeFix,
        gate.mustFixBeforeWeek1 ? "yes" : "no",
        gate.notes,
      ].join(" | "),
    );
  }

  if (payload.weeklyMuscleTable.length > 0) {
    lines.push("");
    lines.push("Muscle | Projected sets | MEV | Productive/Target | MAV | Status | Severity | Notes");
    for (const row of payload.weeklyMuscleTable) {
      lines.push(
        [
          row.muscle,
          formatAuditDecimal(row.projectedSets),
          formatAuditDecimal(row.mev),
          row.productiveTarget == null
            ? "unknown"
            : formatAuditDecimal(row.productiveTarget),
          formatAuditDecimal(row.mav),
          row.status,
          row.severity,
          row.notes,
        ].join(" | "),
      );
    }
  }

  lines.push("");
  lines.push("Prior-Block Recurring Risks");
  lines.push("Risk | Status | Severity | Evidence | Notes");
  for (const risk of payload.priorBlockRecurringRisks) {
    lines.push(
      `${risk.risk} | ${risk.status} | ${risk.severity} | ${risk.evidence} | ${risk.notes}`,
    );
  }

  lines.push("");
  lines.push("Completed Block Evidence");
  lines.push(
    "Risk | Severity | Evidence | Hypothesis | Acceptance implication | Required fix | Owner seam | Smallest safe fix | Must fix before Week 1",
  );
  for (const row of payload.completedBlockEvidence) {
    lines.push(
      [
        row.risk,
        row.severity,
        row.evidence,
        row.hypothesis,
        row.acceptanceImplication,
        row.requiredFix,
        row.ownerSeam,
        row.smallestSafeFix,
        row.mustFixBeforeWeek1 ? "yes" : "no",
      ].join(" | "),
    );
  }

  lines.push("");
  lines.push("Watch Items");
  lines.push("Risk | Why it matters | Monitoring plan");
  if (payload.watchItems.length === 0) {
    lines.push("none | none | none");
  } else {
    for (const item of payload.watchItems) {
      lines.push(
        `${item.risk} | ${item.whyItMatters} | ${item.monitoringPlan}`,
      );
    }
  }

  lines.push("");
  lines.push("Findings / Remediation");
  lines.push(
    "Finding | Severity | Owner seam | Smallest safe fix | Must fix before Week 1 | Evidence",
  );
  if (payload.findings.length === 0) {
    lines.push("none | pass | audit/readout | no implementation required | no | none");
  } else {
    for (const finding of payload.findings) {
      lines.push(
        [
          finding.finding,
          finding.severity,
          finding.ownerSeam,
          finding.smallestSafeFix,
          finding.mustFixBeforeWeek1 ? "yes" : "no",
          finding.evidence,
        ].join(" | "),
      );
    }
  }

  lines.push("");
  lines.push("Do Not Fix From This Gate Alone");
  lines.push("Item | Reason");
  for (const note of payload.doNotFixNotes) {
    lines.push(`${note.item} | ${note.reason}`);
  }

  lines.push("");
  lines.push("Diagnostic Preview");
  lines.push(
    `available=${formatBooleanFlag(payload.diagnosticPreview.available)} label=${payload.diagnosticPreview.label} can_be_accepted=no planning_shape=${payload.diagnosticPreview.planningShape ?? "unknown"}`,
  );
  for (const note of payload.diagnosticPreview.notes) {
    lines.push(`- ${note}`);
  }

  return lines;
}

export function buildNextMesocyclePostAcceptVerificationSummary(input: {
  artifact: Pick<WorkoutAuditArtifact, "nextMesocyclePostAcceptVerification">;
}): string[] | null {
  const payload = input.artifact.nextMesocyclePostAcceptVerification;
  if (!payload) {
    return null;
  }

  const failedChecks = payload.checks.filter((row) => row.status === "fail");
  const watchChecks = payload.checks.filter(
    (row) => row.status === "warning" || row.status === "unknown",
  );
  const mustFixChecks = failedChecks.filter((row) => row.mustFixBeforeWeek1);
  const lines = [
    "",
    "Post-Accept Successor Verification",
    `verification_result=${payload.verificationResult}`,
    `recommendation=${payload.recommendation}`,
    `source_mesocycle=${payload.sourceMesocycle.id} state=${payload.sourceMesocycle.state ?? "unknown"} active=${formatAuditValue(payload.sourceMesocycle.isActive)}`,
    `successor_mesocycle=${payload.successorMesocycle.id ?? "missing"} requested=${payload.successorMesocycle.requestedId ?? "none"} state=${payload.successorMesocycle.state ?? "unknown"} active=${formatAuditValue(payload.successorMesocycle.isActive)} active_mesocycle=${payload.successorMesocycle.activeMesocycleId ?? "missing"}`,
    `seed=${payload.seedContract.slotPlanSeedJson} minimal_executable_rows_only=${formatBooleanFlag(payload.seedContract.minimalExecutableRowsOnly)} slots=${payload.seedContract.slotCount} exercises=${payload.seedContract.exerciseCount}`,
    `slot_sequence_persisted=${formatBooleanFlag(payload.slotSequence.hasPersistedSequence)} order_stable=${formatBooleanFlag(payload.slotSequence.orderStable)} order=${payload.slotSequence.slotOrder.join(">") || "missing"}`,
    `future_week=${payload.futureWeekReplay.status} composition_source=${payload.futureWeekReplay.compositionSource ?? "missing"} path=${payload.futureWeekReplay.generationPath} order_matches_seed=${formatBooleanFlag(payload.futureWeekReplay.exerciseOrderMatchesSeed)} generated_exercises=${payload.futureWeekReplay.generatedExerciseCount}`,
    `prescription_confidence=${payload.prescriptionConfidence.status} rows=${payload.prescriptionConfidence.summary.rowCount} low=${payload.prescriptionConfidence.summary.lowConfidenceCount} caution=${payload.prescriptionConfidence.summary.cautionCount} classifications=${Object.entries(payload.prescriptionConfidence.summary.classificationCounts).map(([key, value]) => `${key}:${value}`).join(",") || "none"}`,
    `projected_week=${payload.projectedWeekVolume.status} mesocycle=${payload.projectedWeekVolume.mesocycleId ?? "missing"} sessions=${payload.projectedWeekVolume.projectedSessionCount} seed_backed=${formatBooleanFlag(payload.projectedWeekVolume.allProjectedSessionsSeedBacked)}`,
    `read_models home_slot_source=${payload.readModels.homeNextSessionSlotSource ?? "missing"} program_sources=${payload.readModels.programExerciseSources.join(",") || "missing"} seed_backed=${formatBooleanFlag(payload.readModels.allProgramRowsSeedBacked)}`,
    `provenance=${payload.provenance.status} receipt_composition_source=${payload.provenance.receiptCompositionSource ?? "missing"} warnings=${payload.provenance.warningCodes.join(",") || "none"}`,
    `failed_checks=${failedChecks.length} must_fix_before_week_1=${mustFixChecks.length} watch_items=${watchChecks.length}`,
    "",
    "Check | Status | Must fix before Week 1 | Owner seam | Evidence",
  ];

  for (const row of payload.checks) {
    lines.push(
      [
        row.check,
        row.status,
        row.mustFixBeforeWeek1 ? "yes" : "no",
        row.ownerSeam,
        row.evidence,
      ].join(" | "),
    );
  }

  lines.push("");
  lines.push("Prescription Confidence Source Map");
  lines.push("Exercise | Classification | Confidence | Load source | Caution | Owner seam | Evidence");
  if (payload.prescriptionConfidence.rows.length === 0) {
    lines.push("none | runtime_only | unknown | unknown | unknown | template-session seeded runtime replay | prescription load/readiness requires accepted successor generation");
  } else {
    for (const row of payload.prescriptionConfidence.rows) {
      lines.push(
        [
          row.exerciseName,
          row.classification,
          row.confidence,
          row.loadSource,
          row.cautionLevel,
          row.ownerSeam,
          row.evidence,
        ].join(" | "),
      );
    }
  }

  lines.push("");
  lines.push(
    `safety writes=${payload.safety.writes} db_mutated=${formatBooleanFlag(payload.safety.dbMutated)} mesocycle_created=${formatBooleanFlag(payload.safety.mesocycleCreated)} workout_session_created=${formatBooleanFlag(payload.safety.workoutLogSessionCreated)} seed_runtime_changed=${formatBooleanFlag(payload.safety.seedRuntimeBehaviorChanged)} transaction=${formatBooleanFlag(payload.safety.transactionExecuted)}`,
  );

  return lines;
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
      `[workout-audit:week:debug] projected_session[${index + 1}] label=${formatProjectedWeekSessionLabel(session)} is_next=${session.isNext} category=${session.projectionCategory ?? "legacy"} reliable=${session.evidenceReliable ?? true} exercises=${session.exerciseCount} total_sets=${session.totalSets} performed=${formatTopSessionContributors(session.performedContributionByMuscle ?? {})} remaining=${formatTopSessionContributors(session.remainingContributionByMuscle ?? {})} top_contributors=${formatTopSessionContributors(session.projectedContributionByMuscle)}`
    );
  }

  if (projectedWeekVolume.volumeByCategory) {
    const categories = projectedWeekVolume.volumeByCategory;
    lines.push(
      `[workout-audit:week:debug] volume_categories completed=${formatTopSessionContributors(categories.completedPerformed)} incomplete_performed=${formatTopSessionContributors(categories.incompletePerformed)} incomplete_remaining=${formatTopSessionContributors(categories.incompleteRemaining)} unmaterialized_future=${formatTopSessionContributors(categories.unmaterializedFutureProjected)}`
    );
  }

  if (projectedWeekVolume.incompleteWorkoutProjections) {
    if (projectedWeekVolume.incompleteWorkoutProjections.length === 0) {
      lines.push("[workout-audit:week:debug] incomplete_projection=none");
    } else {
      for (const [index, projection] of projectedWeekVolume.incompleteWorkoutProjections.entries()) {
        lines.push(
          `[workout-audit:week:debug] incomplete_projection[${index + 1}] workout=${projection.workoutId} slot=${projection.slotId ?? "none"} status=${projection.status} source=${projection.evidence.source} snapshot_versions=${projection.evidence.snapshotVersions.join(",") || "none"} runtime_edit_attribution=${projection.evidence.runtimeEditAttribution} reasons=${projection.evidence.reasons.join(",") || "none"} performed=${formatTopSessionContributors(projection.performed.contributionsByMuscle)} remaining=${formatTopSessionContributors(projection.remaining.contributionsByMuscle)}`
        );
      }
    }
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
  const demandZoneLearning = strategy?.demandZoneLearning;
  const strategyToDemandDiff = strategy?.strategyToDemandDiff;
  const strategyToDemandSummary = strategyToDemandDiff?.summary;
  const strategyToDemandProjection = noRepair.strategyToDemandProjection;
  const strategyToDemandProjectionSummary =
    strategyToDemandProjection?.summary;
  const strategyToDemandProjectionMeasurement =
    strategyToDemandProjection?.measuredCurrentNonRegressionSummary;
  const strategyToDemandCandidateInventory =
    strategyToDemandProjection?.candidateInventory;
  const strategyToDemandCandidateSummary =
    strategyToDemandCandidateInventory?.summary;
  const strategyToDemandTopCandidate =
    strategyToDemandCandidateSummary?.topCandidate;
  const strategyToDemandOwnerScopedProjection =
    strategyToDemandProjection?.ownerScopedProjection;
  const strategyToDemandOwnerScopedSummary =
    strategyToDemandOwnerScopedProjection?.summary;
  const strategyToDemandOwnerScopedTopRow =
    strategyToDemandOwnerScopedSummary?.topRow;
  const strategyToDemandBehaviorTrial =
    strategyToDemandProjection?.boundedBehaviorTrial;
  const strategyToDemandBehaviorTrialSummary =
    strategyToDemandBehaviorTrial?.summary;
  const strategyToDemandDownstreamProjection =
    strategyToDemandBehaviorTrial?.downstreamBehaviorProjection;
  const strategyToDemandDownstreamSummary =
    strategyToDemandDownstreamProjection?.summary;
  const strategyToDemandMeasuredRedistribution =
    strategyToDemandBehaviorTrial?.measuredRedistributionProjection;
  const strategyToDemandMeasuredRedistributionSummary =
    strategyToDemandMeasuredRedistribution?.summary;
  const strategyToDemandMeasuredRedistributionBlockers =
    strategyToDemandMeasuredRedistribution?.blockerSummary;
  const strategyToDemandAlternateCandidates =
    strategyToDemandMeasuredRedistribution?.alternateCandidateDiagnostic;
  const strategyRowMaterializerProjection =
    noRepair.v2StrategyRowMaterializerProjection;
  const strategyRowMaterializerDelta =
    strategyRowMaterializerProjection?.materializerDeltas;
  const strategyRowMaterializerCoverage =
    strategyRowMaterializerProjection?.protectedCoverageImpact;
  const strategyRowMaterializerLossCause =
    strategyRowMaterializerProjection?.protectedCoverageLossCause;
  const strategyRowMaterializerSetBudgetBasisCheck =
    strategyRowMaterializerProjection?.setBudgetBasisCheck;
  const strategyRowMaterializerConcentration =
    strategyRowMaterializerProjection?.duplicateConcentrationImpact;
  const preselectionMaterializerProjection =
    noRepair.v2PreselectionMaterializerProjection;
  const preselectionMaterializerDelta =
    preselectionMaterializerProjection?.deltas;
  const preselectionMaterializerCoverage =
    preselectionMaterializerProjection?.protectedCoverageImpact;
  const preselectionMaterializerConcentration =
    preselectionMaterializerProjection?.duplicateConcentrationImpact;
  const formatProjectionIdentities = (
    rows: Array<{ exerciseName: string; setCount: number }> | undefined,
  ): string =>
    rows && rows.length > 0
      ? rows.map((row) => `${row.exerciseName}:${row.setCount}`).join("|")
      : "none";
  const selectionCapacityDiagnostic =
    noRepair.v2SelectionCapacityPlanDiagnostic;
  const selectionCapacitySummary = selectionCapacityDiagnostic?.summary;
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
        `Demand-zone learning: ${formatStatus(demandZoneLearning?.status ?? "not_available")} floor=${demandZoneLearning?.floorProtectionSignals.length ?? 0} productive=${demandZoneLearning?.productiveMonitorSignals.length ?? 0} stretch=${demandZoneLearning?.stretchMonitorSignals.length ?? 0} cap=${demandZoneLearning?.capRedistributionSignals.length ?? 0} next=${formatStatus(demandZoneLearning?.nextSafeAction ?? "collect_more_performed_evidence")}`,
        `Demand-zone consumed by demand/materializer: ${demandZoneLearning?.consumedByDemandOrMaterializer ? "yes" : "no"}`,
        `Strategy-to-demand diff: ${formatStatus(strategyToDemandDiff?.status ?? "not_available")} rows=${strategyToDemandDiff?.rows.length ?? 0} floor=${strategyToDemandSummary?.floorProtectionCount ?? 0} productive=${strategyToDemandSummary?.productiveMonitorCount ?? 0} stretch=${strategyToDemandSummary?.stretchMonitorCount ?? 0} cap=${strategyToDemandSummary?.capRedistributionCount ?? 0} readOnlyDiff=${strategyToDemandSummary?.readOnlyDiffCount ?? 0} blocked=${strategyToDemandSummary?.blockedCount ?? 0} monitor=${strategyToDemandSummary?.monitorOnlyCount ?? 0} needsEvidence=${strategyToDemandSummary?.needsEvidenceCount ?? 0} next=${formatStatus(strategyToDemandDiff?.nextSafeAction ?? "collect_more_evidence")}`,
        `Strategy-to-demand consumed by demand/materializer: ${strategyToDemandDiff?.consumedByDemandOrMaterializer ? "yes" : "no"}`,
        `Strategy-to-demand projection: ${formatStatus(strategyToDemandProjection?.status ?? "not_available")} rows=${strategyToDemandProjectionSummary?.rowCount ?? 0} baseMatched=${strategyToDemandProjectionSummary?.baseDemandMatchedCount ?? 0} noMutation=${strategyToDemandProjectionSummary?.currentNoMutationProjectionCount ?? 0} measuredCurrent=${strategyToDemandProjectionSummary?.measuredCurrentProjectionPassCount ?? 0} behaviorUnknown=${strategyToDemandProjectionSummary?.behaviorProjectionUnknownCount ?? 0} blocked=${strategyToDemandProjectionSummary?.blockedCount ?? 0} monitor=${strategyToDemandProjectionSummary?.monitorOnlyCount ?? 0} next=${formatStatus(strategyToDemandProjection?.nextSafeAction ?? "collect_more_evidence")}`,
        `Strategy-to-demand current measurement: measured=${strategyToDemandProjectionMeasurement?.measuredRowCount ?? 0} pass=${strategyToDemandProjectionMeasurement?.passCount ?? 0} unknown=${strategyToDemandProjectionMeasurement?.unknownCount ?? 0} maxDelta=${strategyToDemandProjectionMeasurement?.maxAbsoluteRangeDelta ?? 0} netNew=${strategyToDemandProjectionMeasurement?.totalNetNewVolumeDelta ?? 0} behaviorMeasured=${strategyToDemandProjectionMeasurement?.behaviorProjectionMeasured ? "yes" : "no"}`,
        `Strategy-to-demand candidate inventory: ${formatStatus(strategyToDemandCandidateInventory?.status ?? "not_available")} rows=${strategyToDemandCandidateSummary?.rowCount ?? 0} performed=${strategyToDemandCandidateSummary?.performedRealityCount ?? 0} benchmarkWatch=${strategyToDemandCandidateSummary?.benchmarkWatchCount ?? 0} noRepair=${strategyToDemandCandidateSummary?.noRepairProjectionCount ?? 0} repairOnly=${strategyToDemandCandidateSummary?.repairOnlyCount ?? 0} candidate=${strategyToDemandCandidateSummary?.candidateForReadOnlyProjectionCount ?? 0} blocked=${strategyToDemandCandidateSummary?.blockedCount ?? 0} diagnostic=${strategyToDemandCandidateSummary?.diagnosticOnlyCount ?? 0} top=${strategyToDemandTopCandidate ? `${formatStatus(strategyToDemandTopCandidate.proposedOwnerSeam)}:${strategyToDemandTopCandidate.muscle ?? "block"}:${formatStatus(strategyToDemandTopCandidate.suggestedFutureActionType)}:${formatStatus(strategyToDemandTopCandidate.readiness)}` : "none"} proof=${formatNameList(strategyToDemandTopCandidate?.requiredProofBeforeBehavior ?? [], 3)}`,
        `Strategy-to-demand owner-scoped projection: ${formatStatus(strategyToDemandOwnerScopedProjection?.status ?? "not_available")} rows=${strategyToDemandOwnerScopedSummary?.rowCount ?? 0} blocked=${strategyToDemandOwnerScopedSummary?.blockedCount ?? 0} diagnosticNoImpact=${strategyToDemandOwnerScopedSummary?.diagnosticNoImpactCount ?? 0} candidate=${strategyToDemandOwnerScopedSummary?.candidateForBoundedReviewCount ?? 0} top=${strategyToDemandOwnerScopedTopRow ? `${formatStatus(strategyToDemandOwnerScopedTopRow.rowKey)}:${formatStatus(strategyToDemandOwnerScopedTopRow.readiness)}` : "none"} proof=${formatNameList(strategyToDemandOwnerScopedTopRow?.requiredProofBeforeBehavior ?? [], 3)}`,
        `Strategy-to-demand bounded behavior trial: ${formatStatus(strategyToDemandBehaviorTrial?.status ?? "not_available")} candidates=${strategyToDemandBehaviorTrialSummary?.candidateCount ?? 0} ready=${strategyToDemandBehaviorTrialSummary?.readyForBehaviorCount ?? 0} blocked=${strategyToDemandBehaviorTrialSummary?.blockedCount ?? 0} monitor=${strategyToDemandBehaviorTrialSummary?.monitorOnlyCount ?? 0} netNewFail=${strategyToDemandBehaviorTrialSummary?.netNewVolumeFailCount ?? 0} redistributionReady=${strategyToDemandBehaviorTrialSummary?.redistributionContextReadyCount ?? 0} redistributionMissing=${strategyToDemandBehaviorTrialSummary?.redistributionContextMissingCount ?? 0} downstreamUnknown=${strategyToDemandBehaviorTrialSummary?.downstreamUnknownCount ?? 0} materializerUnknown=${strategyToDemandBehaviorTrialSummary?.materializerUnknownCount ?? 0} next=${formatStatus(strategyToDemandBehaviorTrial?.nextSafeAction ?? "keep_diagnostic_only")}`,
        `Strategy-to-demand downstream context: ${formatStatus(strategyToDemandDownstreamProjection?.status ?? "not_available")} candidates=${strategyToDemandDownstreamSummary?.candidateCount ?? 0} weeklyReady=${strategyToDemandDownstreamSummary?.weeklyCurveAvailableCount ?? 0} slotReady=${strategyToDemandDownstreamSummary?.slotAllocationAvailableCount ?? 0} setReady=${strategyToDemandDownstreamSummary?.setDistributionContextAvailableCount ?? 0} netNewUnknown=${strategyToDemandDownstreamSummary?.netNewVolumeUnknownCount ?? 0} materializerUnknown=${strategyToDemandDownstreamSummary?.materializerUnknownCount ?? 0} ready=${strategyToDemandDownstreamSummary?.readyForBehaviorCount ?? 0} next=${formatStatus(strategyToDemandDownstreamProjection?.nextSafeAction ?? "keep_diagnostic_only")}`,
        `Strategy-to-demand measured redistribution: ${formatStatus(strategyToDemandMeasuredRedistribution?.status ?? "not_available")} candidates=${strategyToDemandMeasuredRedistributionSummary?.candidateCount ?? 0} measured=${strategyToDemandMeasuredRedistributionSummary?.measuredCandidateCount ?? 0} ready=${strategyToDemandMeasuredRedistributionSummary?.readyForBehaviorProjectionTrialCount ?? 0} blocked=${strategyToDemandMeasuredRedistributionSummary?.blockedByRegressionCount ?? 0} pass=${strategyToDemandMeasuredRedistributionSummary?.passGateCount ?? 0} fail=${strategyToDemandMeasuredRedistributionSummary?.failGateCount ?? 0} unknown=${strategyToDemandMeasuredRedistributionSummary?.unknownGateCount ?? 0} netNew=${strategyToDemandMeasuredRedistributionSummary?.totalNetNewVolumeDelta ?? 0} materialRepairDelta=${strategyToDemandMeasuredRedistributionSummary?.materializerRepairDelta ?? 0} concentrationDelta=${strategyToDemandMeasuredRedistributionSummary?.concentrationDelta ?? 0} next=${formatStatus(strategyToDemandMeasuredRedistribution?.nextSafeAction ?? "keep_diagnostic_only")}`,
        `Strategy-to-demand measured blockers: ${formatStatus(strategyToDemandMeasuredRedistributionBlockers?.status ?? "not_available")} scope=${formatStatus(strategyToDemandMeasuredRedistributionBlockers?.projectionScope ?? "not_available")} independent=${strategyToDemandMeasuredRedistributionBlockers?.independentCandidateProjectionAvailable ? "yes" : "no"} floor=${formatNameList(strategyToDemandMeasuredRedistributionBlockers?.floorRegressionMuscles ?? [], 4)} donors=${formatNameList(strategyToDemandMeasuredRedistributionBlockers?.donorOffsetMuscles ?? [], 4)} required=${formatNameList(strategyToDemandMeasuredRedistributionBlockers?.nextRequiredEvidence ?? [], 4)}`,
        `Strategy-to-demand alternate donors: ${formatStatus(strategyToDemandAlternateCandidates?.status ?? "not_available")} scope=${formatStatus(strategyToDemandAlternateCandidates?.measuredProjectionScope ?? "not_projected")} current=${formatNameList(strategyToDemandAlternateCandidates?.currentDonorMuscles ?? [], 4)} alternateEligible=${strategyToDemandAlternateCandidates?.alternateEligibleDonorCount ?? 0} excluded=${formatNameList(strategyToDemandAlternateCandidates?.excludedDonorMuscles ?? [], 4)} required=${formatNameList(strategyToDemandAlternateCandidates?.requiredEvidence ?? [], 4)} next=${formatStatus(strategyToDemandAlternateCandidates?.nextSafeAction ?? "keep_diagnostic_only")}`,
        `Strategy row materializer projection: ${formatStatus(strategyRowMaterializerProjection?.status ?? "not_available")} row=${formatStatus(strategyRowMaterializerProjection?.row.rowKey ?? "not_available")} target=${strategyRowMaterializerProjection ? `${strategyRowMaterializerProjection.boundedDeltaAttempted.week}:${strategyRowMaterializerProjection.boundedDeltaAttempted.slotId}:${strategyRowMaterializerProjection.boundedDeltaAttempted.laneId}` : "none"} readiness=${formatStatus(strategyRowMaterializerProjection?.readiness ?? "blocked")} identityDelta=${strategyRowMaterializerDelta?.selectedIdentityDelta ?? 0} setDelta=${strategyRowMaterializerDelta?.totalSetDelta ?? 0} laneSetDelta=${strategyRowMaterializerDelta?.targetLaneSetDelta ?? 0} blockerDelta=${strategyRowMaterializerDelta?.materializerBlockerDelta ?? 0} protected=${formatStatus(strategyRowMaterializerCoverage?.status ?? "not_measured")} setBudgetBasis=${formatStatus(strategyRowMaterializerSetBudgetBasisCheck?.status ?? "not_measured")} basisChanged=${strategyRowMaterializerSetBudgetBasisCheck?.markerChangedSetBudgetBasis ? "yes" : "no"} lossCause=${formatStatus(strategyRowMaterializerLossCause?.classification ?? "not_measured")} lossPrimary=${formatStatus(strategyRowMaterializerLossCause?.primaryCause ?? "not_measured")} lossOwner=${formatStatus(strategyRowMaterializerLossCause?.ownerSeam ?? "unknown")} concentration=${formatStatus(strategyRowMaterializerConcentration?.status ?? "not_measured")} next=${formatStatus(strategyRowMaterializerProjection?.nextSafeSlice ?? "keep_blocked_until_owner_donor_or_acceptance_proof")}`,
        `Preselection materializer projection: ${formatStatus(preselectionMaterializerProjection?.status ?? "not_available")} candidate=${formatStatus(preselectionMaterializerProjection?.candidateId ?? "not_available")} owner=${formatStatus(preselectionMaterializerProjection?.ownerSeam ?? "unknown")} readiness=${formatStatus(preselectionMaterializerProjection?.readiness ?? "blocked")} baseline=${formatProjectionIdentities(preselectionMaterializerProjection?.materializedHamstrings.baselineIdentities)} trial=${formatProjectionIdentities(preselectionMaterializerProjection?.materializedHamstrings.trialIdentities)} identityDelta=${preselectionMaterializerDelta?.selectedIdentityDelta ?? 0} setDelta=${preselectionMaterializerDelta?.totalSetDelta ?? 0} laneSetDelta=${preselectionMaterializerDelta?.targetLaneSetDelta ?? 0} blockerDelta=${preselectionMaterializerDelta?.materializerBlockerDelta ?? 0} blockerOmissionDelta=${preselectionMaterializerDelta?.blockerOmissionDelta ?? 0} protected=${formatStatus(preselectionMaterializerCoverage?.status ?? "not_measured")} concentration=${formatStatus(preselectionMaterializerConcentration?.status ?? "not_measured")} acceptance=${formatStatus(preselectionMaterializerProjection?.acceptanceWatchStatus ?? "missing_proof")} next=${formatStatus(preselectionMaterializerProjection?.nextSafeSlice ?? "keep_blocked_until_clean_preselection_projection_exists")}`,
        `Strategy-to-demand fallback capacity inspection: ${formatStatus(selectionCapacityDiagnostic?.status ?? "not_available")} blockers=${selectionCapacitySummary?.blockerCount ?? 0} pressure=${selectionCapacitySummary?.capacityPressureCount ?? 0} capAwareExpansion=${selectionCapacitySummary?.capAwareExpansionNeededCount ?? 0} optionalSuppressed=${selectionCapacitySummary?.optionalSuppressedCount ?? 0} safeForPromotion=${selectionCapacityDiagnostic?.safeForBehaviorPromotion ? "yes" : "no"}`,
        `Strategy-to-demand projection consumed by demand/materializer: ${strategyToDemandProjection?.consumedByDemandOrMaterializer ? "yes" : "no"}`,
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
  const legacyRepairQuarantine =
    repairScoreboard?.interpretation.legacyRepairQuarantine;
  const repairQuarantineGroups =
    repairScoreboard?.interpretation.quarantineGroups;
  const missingPromotionProof =
    repairScoreboard?.interpretation.missingProofBeforeBehaviorPromotion;
  const gapInventory = repairScoreboard?.interpretation.gapInventory;
  const selectedGapProof = repairScoreboard?.interpretation.selectedGapProof;
  const taxonomyMismatchInventory =
    repairScoreboard?.interpretation.taxonomyMismatchInventory;
  const setBudgetGapInventory =
    repairScoreboard?.interpretation.setBudgetGapInventory;
  const supportFloorGapInventory =
    repairScoreboard?.interpretation.supportFloorGapInventory;
  const repairDeprecationReadiness =
    repairScoreboard?.interpretation.repairDeprecationReadiness;
  const planQualityBenchmark = noRepair.v2PlanQualityBenchmark;
  const promotionCandidateEvaluator = noRepair.v2PromotionCandidateEvaluator;
  const promotionCandidateRecommendation =
    promotionCandidateEvaluator?.recommendation;
  const slotWeekAcceptance =
    planQualityBenchmark?.slotWeekAllocationAcceptanceProjection?.acceptance;
  const slotWeekClassificationCounts =
    slotWeekAcceptance?.classificationCounts;
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
  const planQualityBenchmarkLines = planQualityBenchmark
    ? [
        "V2 Plan Quality Benchmark",
        "-------------------------",
        `Status: ${formatStatus(planQualityBenchmark.status)} deprecation=${formatStatus(planQualityBenchmark.deprecationReadiness.status)}`,
        `Gates: pass=${planQualityBenchmark.summary.passCount} warn=${planQualityBenchmark.summary.warningCount} fail=${planQualityBenchmark.summary.failCount} missing=${planQualityBenchmark.summary.missingEvidenceCount} mustFixW1=${planQualityBenchmark.summary.mustFixBeforeWeek1Count}`,
        `Slot/week allocation: readiness=${formatStatus(planQualityBenchmark.summary.slotWeekAllocationReadiness)} blockedRows=${planQualityBenchmark.summary.slotWeekAllocationBlockedRowCount} next=${formatStatus(planQualityBenchmark.summary.slotWeekAllocationNextSafeSlice ?? "none")}`,
        `Slot/week acceptance projection: decision=${formatStatus(planQualityBenchmark.slotWeekAllocationAcceptanceProjection?.decision ?? "not_available")} weeks=${formatNameList((planQualityBenchmark.slotWeekAllocationAcceptanceProjection?.representativeAccumulationWeeks ?? []).map((week) => `W${week}`), 8)} watch=${planQualityBenchmark.slotWeekAllocationAcceptanceProjection?.acceptance.watchItems.length ?? 0} blockers=${planQualityBenchmark.slotWeekAllocationAcceptanceProjection?.acceptance.blockers.length ?? 0} next=${formatStatus(planQualityBenchmark.slotWeekAllocationAcceptanceProjection?.acceptance.nextSafeSlice ?? "none")}`,
        `Slot/week watch classification: accepted=${slotWeekClassificationCounts?.acceptedWatch ?? 0} boundedOwner=${slotWeekClassificationCounts?.boundedOwnerWatch ?? 0} ownerFix=${slotWeekClassificationCounts?.ownerSpecificNextFix ?? 0} staleNoise=${slotWeekClassificationCounts?.staleOrDiagnosticNoise ?? 0} blockers=${slotWeekClassificationCounts?.blocker ?? 0}`,
        `Gate detail: ${planQualityBenchmark.gates.map((row) => `${row.gate}:${row.status}:${row.evidenceSource}`).join("; ")}`,
        `Warning evidence: ${
          planQualityBenchmark.gates
            .filter((row) => row.status === "warning")
            .map(
              (row) =>
                `${row.gate}@${row.ownerSeam}: ${formatNameList(row.evidence, 12)}`,
            )
            .join("; ") || "none"
        }`,
        `Next safe action: ${formatStatus(planQualityBenchmark.summary.nextSafeAction)}`,
        `Guardrails: seedRuntimeChanged=${planQualityBenchmark.guardrails.seedRuntimeChanged ? "yes" : "no"} productionMaterializerChanged=${planQualityBenchmark.guardrails.productionMaterializerChanged ? "yes" : "no"} acceptanceThresholdChanged=${planQualityBenchmark.guardrails.acceptanceThresholdChanged ? "yes" : "no"} persistenceChanged=${planQualityBenchmark.guardrails.persistenceChanged ? "yes" : "no"}`,
      ]
    : [];
  const promotionCandidateEvaluatorLines = promotionCandidateEvaluator
    ? [
        "V2 Promotion Candidate Evaluator",
        "--------------------------------",
        `Status: ${formatStatus(promotionCandidateEvaluator.status)} evaluated=${promotionCandidateEvaluator.summary.evaluatedCandidateCount} ready=${promotionCandidateEvaluator.summary.readyCandidateCount} stopped=${promotionCandidateEvaluator.summary.stoppedCandidateCount} watch=${promotionCandidateEvaluator.summary.watchCandidateCount}`,
        `Recommendation: ${formatStatus(promotionCandidateRecommendation?.decision ?? "none_ready")} top=${formatStatus(promotionCandidateRecommendation?.candidateId ?? "none")} owner=${formatStatus(promotionCandidateRecommendation?.ownerSeam ?? "none")} score=${promotionCandidateRecommendation?.score ?? "n/a"}`,
        `Reason: ${promotionCandidateRecommendation?.reason ?? "none"}`,
        `Next projection: ${formatStatus(promotionCandidateEvaluator.summary.nextProjectionRecommendation ?? "not_available")}`,
        `Stop reasons: ${formatNameList(Object.entries(promotionCandidateEvaluator.stopReasonCounts).map(([reason, count]) => `${reason}=${count}`), 8)}`,
        `Next safe action: ${formatStatus(promotionCandidateRecommendation?.nextSafeAction ?? promotionCandidateEvaluator.summary.nextSafeAction)}`,
        `Non-consumption: production=${promotionCandidateEvaluator.consumedByProduction ? "yes" : "no"} demandOrMaterializer=${promotionCandidateEvaluator.consumedByDemandOrMaterializer ? "yes" : "no"} seedRuntime=${promotionCandidateEvaluator.guardrails.seedRuntimeChanged ? "changed" : "unchanged"} receipts=${promotionCandidateEvaluator.guardrails.receiptChanged ? "changed" : "unchanged"} persistence=${promotionCandidateEvaluator.guardrails.persistenceChanged ? "changed" : "unchanged"}`,
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
        legacyRepairQuarantine
          ? `Legacy repair quarantine: role=${legacyRepairQuarantine.repairedProjectionRole} behaviorCandidates=${legacyRepairQuarantine.behaviorPromotionCandidateCount} quarantined=${legacyRepairQuarantine.quarantinedRowCount} staleArtifacts=${legacyRepairQuarantine.staleRepairedProjectionArtifactCount}`
          : "Legacy repair quarantine: not_available",
        repairQuarantineGroups
          ? `Quarantine groups: upstreamOwned=${repairQuarantineGroups.upstreamOwnedCandidate.count} safetyRepairOnly=${repairQuarantineGroups.safetyRepairOnly.count} collateralAmbiguous=${repairQuarantineGroups.collateralAmbiguous.count} staleArtifact=${repairQuarantineGroups.staleArtifact.count} missingEvidenceOrGate=${repairQuarantineGroups.missingEvidenceOrUnmeasuredGate.count}`
          : "Quarantine groups: not_available",
        repairQuarantineGroups
          ? `Top quarantine reasons: safety=${formatCountRecord(repairQuarantineGroups.safetyRepairOnly.topReasons, 3)} collateral=${formatCountRecord(repairQuarantineGroups.collateralAmbiguous.topReasons, 3)} stale=${formatCountRecord(repairQuarantineGroups.staleArtifact.topReasons, 3)} missing=${formatCountRecord(repairQuarantineGroups.missingEvidenceOrUnmeasuredGate.topReasons, 3)}`
          : "Top quarantine reasons: not_available",
        `Missing proof before behavior: ${formatPromotionProofGates(missingPromotionProof)}`,
        `Ranked gap inventory: ${formatGapInventory(gapInventory)}`,
        `Taxonomy mismatch inventory: ${formatTaxonomyMismatchInventory(taxonomyMismatchInventory)}`,
        `Set-budget gap inventory: ${formatSetBudgetGapInventory(setBudgetGapInventory)}`,
        `Support-floor gap inventory: ${formatSupportFloorGapInventory(supportFloorGapInventory)}`,
        `Selected gap proof: ${formatSelectedGapProof(selectedGapProof)}`,
        repairDeprecationReadiness
          ? `Repair deprecation readiness: safetyNet=${repairDeprecationReadiness.summary.safetyNetCount} planAuthoring=${repairDeprecationReadiness.summary.planAuthoringLeftoverCount} obsoleteNoImpact=${repairDeprecationReadiness.summary.obsoleteNoImpactCount} stillUnproven=${repairDeprecationReadiness.summary.stillUnprovenCount} readyForReview=${repairDeprecationReadiness.summary.readyForDeprecationReviewCount} executable=${repairDeprecationReadiness.deprecationIsExecutable ? "yes" : "no"} next=${formatStatus(repairDeprecationReadiness.nextSafeAction)}`
          : "Repair deprecation readiness: not_available",
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
    ...planQualityBenchmarkLines,
    ...promotionCandidateEvaluatorLines,
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
  const belowPreferred =
    currentWeekAudit.belowPreferred
      ?.map((row) => `${row.muscle}:${row.status} (-${row.deficit.toFixed(1)})`)
      .join(", ") || "none";
  const sessionRisks =
    projectedWeekVolume.sessionRisks
      ?.map((risk) => `${risk.slotId}: ${risk.issue}`)
      .join("; ") || "none";

  return [
    `[workout-audit:current-week] below_mev=${formatCurrentWeekList(currentWeekAudit.belowMEV)} mev_closure_clusters=${formatCurrentWeekUnderTargetClusters(currentWeekAudit.underTargetClusters)} below_preferred=${belowPreferred} over_mav=${formatCurrentWeekList(currentWeekAudit.overMAV)}`,
    `[workout-audit:current-week] fatigue_risks=${formatCurrentWeekList(currentWeekAudit.fatigueRisks, 3)}`,
    `[workout-audit:current-week] intervention_hints=${interventionHints}`,
    "[workout-audit:current-week] no_target_chasing=above_mev_below_target_rows_are_monitor_only",
    `[workout-audit:current-week] session_risks=${sessionRisks}`,
  ];
}

function buildSeedReplayReadoutLines(input: {
  compositionSource?: string | null;
}): string[] {
  if (input.compositionSource === "persisted_slot_plan_seed") {
    return [
      "Seed order/set counts respected: yes, generated preview is from persisted seed replay",
    ];
  }

  if (input.compositionSource === "deload_seed_replay") {
    return [
      "Exercise identity/order source: accepted seed replay for deload",
      "Set-count policy: deload-adjusted; accumulation seed set counts intentionally reduced",
    ];
  }

  return [
    "Seed order/set counts respected: unknown, composition source is not persisted seed replay",
  ];
}

export function buildPreSessionReadinessSummary(input: {
  artifact: Pick<
    WorkoutAuditArtifact,
    | "identity"
    | "request"
    | "nextSession"
    | "generation"
    | "sessionSnapshot"
    | "generationPath"
    | "generationProvenance"
    | "projectedWeekVolume"
    | "weeklyRetro"
    | "warningSummary"
    | "preSessionReadiness"
  >;
  operatorDebug?: boolean;
}): string[] | null {
  const payload = input.artifact.preSessionReadiness;
  if (!payload) {
    return null;
  }
  if (payload.contract) {
    return buildPreSessionReadinessSummaryFromContract({
      artifact: input.artifact,
      contract: payload.contract,
    });
  }

  const projectedWeek = input.artifact.projectedWeekVolume;
  const generated = input.artifact.sessionSnapshot?.generated;
  const nextProjectedSession = projectedWeek?.projectedSessions.find(
    (session) => session.isNext
  ) ?? projectedWeek?.projectedSessions[0];
  const receiptProvenance = input.artifact.generationProvenance?.receiptProvenance;
  const seed = input.artifact.generationProvenance?.seed?.provenanceConsistency;
  const active = payload.activeMesocycle;
  const nextSession = input.artifact.nextSession;
  const isActiveDeload = active.state === "ACTIVE_DELOAD";
  const seedReplayReadoutLines = buildSeedReplayReadoutLines({
    compositionSource: receiptProvenance?.compositionSource,
  });
  const deloadProgressLine =
    isActiveDeload
      ? `Deload sessions completed: ${formatAuditValue(active.deloadSessionsCompleted)}`
      : "Deload sessions completed: n/a";
  const deloadPositionLine =
    isActiveDeload
      ? `Deload session position: ${
          active.deloadSessionPosition
            ? `${active.deloadSessionPosition.current} of ${active.deloadSessionPosition.total}`
            : "n/a"
        }`
      : "Deload session position: n/a";
  const doseDiagnostics = selectPreSessionDoseDiagnostics({
    diagnostics: projectedWeek?.runtimeDoseAdjustmentDiagnostics ?? [],
    nextSession: nextProjectedSession,
    operatorDebug: input.operatorDebug === true,
  });
  const safeToTrain = buildSafeToTrain({ artifact: input.artifact });
  const exercises = [...(generated?.exercises ?? [])].sort(
    (left, right) => left.orderIndex - right.orderIndex
  );
  const lines = [
    "Pre-Session Readiness",
    "---------------------",
    `Current app state: owner=${input.artifact.identity.ownerEmail ?? input.artifact.identity.userId} active_mesocycle=${active.mesocycleId ?? "unknown"} state=${active.state ?? "unknown"} completed_accumulation_sessions=${formatAuditValue(active.completedAccumulationSessions)} current_week=${formatAuditValue(active.currentWeek)} current_session=${formatAuditValue(active.currentSession)} next_slot=${nextSession?.slotId ?? "unknown"} incomplete_workout_blocker=${nextSession?.source === "existing_incomplete" && nextSession.selectedIncompleteReadiness?.safeToTrain !== true ? `${nextSession.existingWorkoutId ?? "unknown"} (${nextSession.selectedIncompleteStatus ?? "unknown"})` : "none"} incomplete_workout_readiness=${formatIncompleteWorkoutReadiness(nextSession)}`,
    `Existing workout action: ${nextSession?.selectedIncompleteReadiness?.reason ?? "none"}`,
    deloadProgressLine,
    deloadPositionLine,
    `Lifecycle blocker: ${nextSession?.source === "final_week_close_pending" ? nextSession.lifecycleBlocker?.message ?? "final accumulation closeout is pending" : "none"}`,
    `Generation: path=${input.artifact.generationPath?.executionMode ?? "unknown"} generator=${input.artifact.generationPath?.generator ?? "unknown"} composition_source=${receiptProvenance?.compositionSource ?? "unknown"} receipt_mesocycle=${receiptProvenance?.mesocycleId ?? "unknown"} seed_source=${seed?.seed.source ?? "unknown"} seed_shape=${seed?.seed.executableShape ?? "unknown"} seed_or_slot_hash=not_available`,
    ...seedReplayReadoutLines,
    "",
    "Generated Preview",
    "Order | Exercise | Sets | Load | Rep target/range | RPE",
  ];

  if (input.artifact.generation && "error" in input.artifact.generation) {
    lines.push(`generation_error | ${input.artifact.generation.error}`);
  } else if (exercises.length === 0) {
    lines.push("none | no generated exercises available | n/a | n/a | n/a | n/a");
  } else {
    for (const exercise of exercises) {
      const firstSet = exercise.prescribedSets[0];
      lines.push(
        `${exercise.orderIndex + 1} | ${exercise.exerciseName} | ${exercise.prescribedSetCount} | ${formatAuditDecimal(firstSet?.targetLoad)} | ${formatRepTarget(firstSet)} | ${formatAuditDecimal(firstSet?.targetRpe)}`
      );
    }
  }

  lines.push("", "Prescription Confidence / Cautions");
  if (exercises.length === 0) {
    lines.push("none");
  } else {
    for (const exercise of exercises) {
      const trace = generated?.traces.progression[exercise.exerciseId];
      const firstSet = exercise.prescribedSets[0];
      const action = trace?.outcome.action ?? "hold";
      const caution =
        trace?.confidence.reasons.length
          ? trace.confidence.reasons.slice(0, 2).join(",")
          : "standard";
      const executionNote =
        typeof firstSet?.targetRpe === "number"
          ? `cap around RPE ${formatAuditDecimal(firstSet.targetRpe)}`
          : "use prescribed effort target";
      lines.push(
        `${exercise.exerciseName}: load=${formatAuditDecimal(firstSet?.targetLoad)} action=${action} confidence=${formatAuditDecimal(trace?.confidence.combinedScale)} caution=${caution} note=${executionNote}`
      );
    }
  }

  lines.push(
    "",
    isActiveDeload
      ? "Current-Week Dose Guidance (Deload Context)"
      : "Current-Week Dose Guidance"
  );
  if (isActiveDeload) {
    lines.push(DELOAD_DO_NOT_CHASE_VOLUME_MESSAGE);
  }
  lines.push("Muscle | projected vs MEV/target/MAV | status | recommended action | confidence");
  if (doseDiagnostics.length === 0) {
    lines.push(
      isActiveDeload
        ? "none | deload-context volume deficits are non-actionable | n/a | run deload prescription; no MEV/top-up work | n/a"
        : "none | no relevant dose diagnostics | n/a | hold seed | n/a"
    );
  } else {
    for (const diagnostic of doseDiagnostics) {
      lines.push(
        `${diagnostic.muscle} | ${formatDoseStatus(diagnostic)} | ${
          isActiveDeload
            ? `deload_non_actionable:${diagnostic.targetStatus}`
            : diagnostic.targetStatus
        } | ${
          isActiveDeload
            ? "deload context: non-actionable; do not top up"
            : formatDoseAction(diagnostic.recommendedAction, diagnostic)
        } | ${formatAuditDecimal(diagnostic.confidence)}`
      );
    }
  }
  const doseClosurePlan = isActiveDeload
    ? buildDeloadDoseClosurePlan()
    : buildDoseClosurePlan({
        diagnostics: projectedWeek?.runtimeDoseAdjustmentDiagnostics ?? [],
        fullWeekRows: projectedWeek?.fullWeekByMuscle ?? [],
        projectedSessions: projectedWeek?.projectedSessions ?? [],
        nextSession: nextProjectedSession,
      });
  lines.push(...doseClosurePlan.lines);

  const retro = input.artifact.weeklyRetro;
  const fatigueRows = [
    ...(retro?.volumeTargeting.overMav ?? []).map((muscle) => `${muscle}: over MAV`),
    ...(retro?.volumeTargeting.overTargetOnly ?? []).map(
      (muscle) => `${muscle}: over target`
    ),
    ...(projectedWeek?.currentWeekAudit?.fatigueRisks ?? []),
  ];
  lines.push("", "Prior-Week / Fatigue Context");
  lines.push(
    retro
      ? `prior_week=${retro.week} planned_completed=${retro.planAdherence.plannedWorkCompletedSets}/${retro.planAdherence.plannedWorkTotalSets} performed_planned_sets missed=${retro.planAdherence.plannedWorkMissedSets} added_sets=${formatSignedSetDelta(retro.planAdherence.explainedAdditions.totalSets)} confidence_impact=${retro.planAdherence.engineConfidenceImpact}`
      : "prior_week=not_available"
  );
  lines.push(
    `fatigue_notes=${fatigueRows.length > 0 ? fatigueRows.slice(0, 6).join("; ") : "none"}`
  );
  lines.push(
    `recovery_caveats=${doseDiagnostics
      .filter((diagnostic) => diagnostic.recoveryReadinessCaveat.status !== "none")
      .map(
        (diagnostic) =>
          `${diagnostic.muscle}:${diagnostic.recoveryReadinessCaveat.status}`
      )
      .join("; ") || "none"}`
  );

  const avoid = buildPreSessionAvoidList({
    diagnostics: doseDiagnostics,
    sessionRisks: projectedWeek?.sessionRisks ?? [],
    nextSession: nextProjectedSession,
    doseClosureRecommendations: doseClosurePlan.recommendations,
  });

  lines.push(
    ...buildSessionLocalCoachingReadout({
      isActiveDeload,
      generated,
      exercises,
      diagnostics: doseDiagnostics,
      doseClosureRecommendations: doseClosurePlan.recommendations,
      fatigueRows,
      sessionRisks: projectedWeek?.sessionRisks ?? [],
      avoid,
    })
  );

  lines.push("", "Session-Local Add-On Recommendation");
  lines.push(isActiveDeload ? "Run deload seed as prescribed." : "Run seed as prescribed.");
  lines.push(
    isActiveDeload
      ? DELOAD_DO_NOT_CHASE_VOLUME_MESSAGE
      : "Use Dose Closure Guidance for MEV-floor top-ups; session-local only."
  );
  lines.push("Optional add-ons:");
  if (doseClosurePlan.recommendations.length === 0) {
    lines.push("- none");
  } else {
    for (const recommendation of doseClosurePlan.recommendations.slice(0, 4)) {
      lines.push(recommendation.addonLine);
    }
  }
  lines.push("Avoid:");
  if (isActiveDeload) {
    lines.push("- hypertrophy add-ons / MEV closure top-ups during ACTIVE_DELOAD");
  } else if (avoid.length === 0) {
    lines.push("- no extra work beyond session-local readiness judgment");
  } else {
    for (const item of Array.from(new Set(avoid)).slice(0, 6)) {
      lines.push(`- ${item}`);
    }
  }
  lines.push(
    "Boundary: recommendations only; no workout/session/log/seed/progression mutation."
  );

  lines.push("", `Safe to train: ${safeToTrain.safe ? "yes" : "no"}`);
  lines.push(`Reason: ${safeToTrain.reasons.join("; ")}`);

  return lines;
}

type WeeklyRetroPayload = NonNullable<WorkoutAuditArtifact["weeklyRetro"]>;
type WeeklyRetroExerciseReconciliationRow =
  NonNullable<WeeklyRetroPayload["exerciseLoadCalibrationRows"]>[number];

function formatSetCount(value: number): string {
  return Number.isInteger(value) ? String(value) : formatAuditDecimal(value);
}

function formatSetWord(value: number): string {
  return Math.abs(value) === 1 ? "set" : "sets";
}

function hasDuplicateEvidence(row: WeeklyRetroExerciseReconciliationRow): boolean {
  return [...row.reasonCodes, ...row.notes].some((value) =>
    value.toLowerCase().includes("duplicate")
  );
}

function getCompletedExerciseReconciliationRows(
  weeklyRetro: WeeklyRetroPayload
): WeeklyRetroExerciseReconciliationRow[] {
  const rows = weeklyRetro.exerciseLoadCalibrationRows ?? [];
  if (!rows.some((row) => row.reviewBucket)) {
    return rows;
  }
  return rows.filter((row) => row.reviewBucket === "completed_session");
}

function formatExerciseReconciliationNotes(input: {
  row: WeeklyRetroExerciseReconciliationRow;
  interpretations: WeeklyRetroPayload["planAdherence"]["interpretations"];
}): string {
  const { row } = input;
  const normalizedExerciseName = row.exerciseName.toLowerCase();
  const matchingInterpretations = input.interpretations.filter(
    (interpretation) =>
      interpretation.exerciseId === row.exerciseId ||
      interpretation.evidence.some((evidence) =>
        evidence.toLowerCase().includes(normalizedExerciseName)
      )
  );
  const notes: string[] = [];

  if (row.replacementLike) {
    notes.push(
      `replacement_like ${row.replacementLike.movementPattern} with ${row.replacementLike.pairedExerciseName}; seed mutation no`
    );
  }

  if (matchingInterpretations.some((interpretation) => interpretation.intent === "substitution")) {
    notes.push("substitute / replacement-like pattern");
  }

  if (hasDuplicateEvidence(row)) {
    notes.push("same-exercise duplicate logging");
  }

  if (row.addedSetCount > 0) {
    const targetGapWork = matchingInterpretations.some((interpretation) =>
      ["final_weekly_opportunity_mev_closure", "target_gap_closure"].includes(
        interpretation.intent
      )
    );
    const addedNote =
      row.plannedSetCount === 0
        ? "added exercise, session-local performed reality"
        : `+${formatSetCount(row.addedSetCount)} runtime-added ${formatSetWord(row.addedSetCount)}`;
    notes.push(targetGapWork ? `${addedNote}; target-gap work` : addedNote);
  }

  if (row.skippedSetCount > 0) {
    notes.push(
      `${formatSetCount(row.skippedSetCount)} skipped planned ${formatSetWord(row.skippedSetCount)}`
    );
  }

  if (
    (row.classification === "target_too_low" ||
      row.classification === "target_too_high") &&
    typeof row.performedLoadSummary.medianLoad === "number" &&
    typeof row.targetLoad === "number"
  ) {
    notes.push(
      `median ${formatAuditDecimal(row.performedLoadSummary.medianLoad)} vs target ${formatAuditDecimal(row.targetLoad)}`
    );
  }

  if (
    row.classification === "recalibrated_hold" &&
    typeof row.performedLoadSummary.anchorLoad === "number" &&
    typeof row.performedLoadSummary.medianLoad === "number" &&
    typeof row.targetLoad === "number"
  ) {
    notes.push(
      `opened ${formatAuditDecimal(row.performedLoadSummary.anchorLoad)} then median ${formatAuditDecimal(row.performedLoadSummary.medianLoad)} vs target ${formatAuditDecimal(row.targetLoad)}`
    );
  }

  if (row.classification === "skipped_or_low_coverage" && notes.length === 0) {
    notes.push("planned low performed coverage");
  }

  if (row.classification === "insufficient_evidence" && notes.length === 0) {
    notes.push("missing target or performed load evidence");
  }

  return notes.length > 0 ? Array.from(new Set(notes)).join("; ") : "none";
}

function buildWeeklyRetroExerciseReconciliationTable(
  weeklyRetro: WeeklyRetroPayload
): string[] {
  const rows = getCompletedExerciseReconciliationRows(weeklyRetro);
  if (rows.length === 0) {
    return [
      "",
      "Exercise Reconciliation",
      "Exercise | Slot | Planned | Saved | Performed | Skipped | Added | Classification | Notes",
      "none | n/a | 0 | 0 | 0 | 0 | 0 | n/a | no exercise-level reconciliation rows available",
    ];
  }

  return [
    "",
    "Exercise Reconciliation",
    "Exercise | Slot | Planned | Saved | Performed | Skipped | Added | Classification | Notes",
    ...rows.map((row) =>
      [
        row.exerciseName,
        row.slotId ?? row.sessionLabel,
        formatSetCount(row.plannedSetCount),
        formatSetCount(row.savedSetCount),
        formatSetCount(row.performedSetCount),
        formatSetCount(row.skippedSetCount),
        formatSetCount(row.addedSetCount),
        row.classification,
        formatExerciseReconciliationNotes({
          row,
          interpretations: weeklyRetro.planAdherence.interpretations,
        }),
      ].join(" | ")
    ),
  ];
}

function buildWeeklySetSummaryTable(weeklyRetro: WeeklyRetroPayload): string[] {
  const rows = getCompletedExerciseReconciliationRows(weeklyRetro);
  const sumRows = (
    selector: (row: WeeklyRetroExerciseReconciliationRow) => number
  ): string => {
    if (rows.length === 0) {
      return "n/a";
    }
    return formatSetCount(rows.reduce((sum, row) => sum + selector(row), 0));
  };
  const planned = weeklyRetro.planAdherence.plannedWorkTotalSets;
  const plannedCompleted = weeklyRetro.planAdherence.plannedWorkCompletedSets;

  return [
    "",
    "Weekly Set Summary",
    "Planned | Saved | Performed | Skipped | Added | Planned Completed",
    [
      formatSetCount(planned),
      sumRows((row) => row.savedSetCount),
      sumRows((row) => row.performedSetCount),
      sumRows((row) => row.skippedSetCount),
      sumRows((row) => row.addedSetCount),
      `${formatSetCount(plannedCompleted)}/${formatSetCount(planned)}`,
    ].join(" | "),
  ];
}

function buildPostSessionCalibrationDeltaTable(
  weeklyRetro: WeeklyRetroPayload
): string[] {
  const rows = weeklyRetro.postSessionReview?.calibrationRows ?? [];
  if (rows.length === 0) {
    return [
      "",
      "Post-Session Calibration Deltas",
      "Exercise | Role | Target load/reps/RPE | Performed load/reps/RPE | Load delta % | RPE delta | Classification | Next exposure note",
      "none | n/a | n/a | n/a | n/a | n/a | n/a | no completed calibration rows available",
    ];
  }

  return [
    "",
    "Post-Session Calibration Deltas",
    "Exercise | Role | Target load/reps/RPE | Performed load/reps/RPE | Load delta % | RPE delta | Classification | Next exposure note",
    ...rows.map((row) =>
      [
        row.exerciseName,
        row.role,
        formatCalibrationPrescription({
          load: row.target.load,
          repRange: row.target.repRange,
          rpe: row.target.rpe,
        }),
        formatCalibrationPrescription({
          load: row.performed.load,
          reps: row.performed.reps,
          rpe: row.performed.rpe,
        }),
        formatAuditMaybeNumber(row.loadDeltaPct),
        formatAuditMaybeNumber(row.rpeDelta),
        row.classification,
        row.nextExposureNote,
      ].join(" | ")
    ),
  ];
}

function buildCompletedSessionReconciliationTable(
  weeklyRetro: WeeklyRetroPayload
): string[] {
  const sessions =
    weeklyRetro.sessionExecution?.sessions?.filter((session) =>
      session.reviewBucket
        ? session.reviewBucket === "completed_session"
        : ["COMPLETED", "PARTIAL"].includes(session.status)
    ) ?? [];
  if (sessions.length === 0) {
    return [
      "",
      "Completed Session Reconciliation",
      "Workout | Week | Session | Slot | Status | Composition | Seed/runtime | Planned | Performed | Skipped | Added | Replacement-like",
      "none | n/a | n/a | n/a | n/a | n/a | unchanged | 0 | 0 | 0 | 0 | 0",
    ];
  }

  const exerciseRows = getCompletedExerciseReconciliationRows(weeklyRetro);
  return [
    "",
    "Completed Session Reconciliation",
    "Workout | Week | Session | Slot | Status | Composition | Seed/runtime | Planned | Performed | Skipped | Added | Replacement-like",
    ...sessions.map((session) => {
      const rows = exerciseRows.filter((row) => row.workoutId === session.workoutId);
      const sum = (selector: (row: WeeklyRetroExerciseReconciliationRow) => number) =>
        rows.reduce((total, row) => total + selector(row), 0);
      const replacementLikeCount = rows.filter(
        (row) => row.classification === "replacement_like" && row.plannedSetCount > 0
      ).length;
      return [
        session.workoutId,
        session.mesocycleSnapshot?.week ?? "n/a",
        session.mesocycleSnapshot?.session ?? "n/a",
        session.slot?.slotId ?? "n/a",
        session.status,
        session.compositionSource ?? "unknown",
        "unchanged",
        formatSetCount(sum((row) => row.plannedSetCount)),
        formatSetCount(sum((row) => row.performedSetCount)),
        formatSetCount(sum((row) => row.skippedSetCount)),
        formatSetCount(sum((row) => row.addedSetCount)),
        formatSetCount(replacementLikeCount),
      ].join(" | ");
    }),
  ];
}

function buildFuturePlannedIncompleteTable(
  weeklyRetro: WeeklyRetroPayload
): string[] {
  const rows =
    weeklyRetro.postSessionReview?.futurePlannedIncompleteWorkouts ??
    weeklyRetro.sessionExecution?.sessions
      ?.filter((session) => session.reviewBucket === "future_planned_incomplete")
      .map((session) => ({
        workoutId: session.workoutId,
        scheduledDate: session.scheduledDate,
        status: session.status,
        sessionIntent: session.sessionIntent,
        slotId: session.slot?.slotId,
        mesocycleWeek: session.mesocycleSnapshot?.week ?? undefined,
        mesoSession: session.mesocycleSnapshot?.session ?? undefined,
        compositionSource: session.compositionSource,
      })) ??
    [];

  if (rows.length === 0) {
    return [
      "",
      "Future Planned / Incomplete Workouts",
      "Workout | Week | Session | Slot | Status | Composition | Interpretation",
      "none | n/a | n/a | n/a | n/a | n/a | no future planned/incomplete workouts in this readout",
    ];
  }

  return [
    "",
    "Future Planned / Incomplete Workouts",
    "Workout | Week | Session | Slot | Status | Composition | Interpretation",
    ...rows.map((row) =>
      [
        row.workoutId,
        row.mesocycleWeek ?? "n/a",
        row.mesoSession ?? "n/a",
        row.slotId ?? row.sessionIntent ?? "n/a",
        row.status,
        row.compositionSource ?? "unknown",
        "scheduled next; not missed work in post-session context",
      ].join(" | ")
    ),
  ];
}

function formatWeeklyMuscleStatus(
  row: WeeklyRetroPayload["volumeTargeting"]["muscles"][number]
): string {
  if (row.mav > 0 && row.actualEffectiveSets > row.mav) {
    return "over_cap";
  }
  if (row.mav > 0 && row.actualEffectiveSets >= row.mav * 0.9) {
    return "near_cap";
  }
  if (row.mev <= 0) {
    return "no_mev_floor";
  }
  if (row.actualEffectiveSets < row.mev) {
    return "below_mev";
  }
  if (
    row.actualEffectiveSets === row.mev &&
    row.actualEffectiveSets < row.weeklyTarget
  ) {
    return "at_mev";
  }
  if (row.actualEffectiveSets < row.weeklyTarget) {
    return "below_preferred";
  }
  if (row.actualEffectiveSets === row.weeklyTarget) {
    return "preferred_reached";
  }
  return "productive_range";
}

function formatCompactSetGap(value: number): string {
  return formatAuditDecimal(Math.abs(value));
}

function formatWeeklyMuscleNote(
  row: WeeklyRetroPayload["volumeTargeting"]["muscles"][number]
): string {
  const status = formatWeeklyMuscleStatus(row);
  if (status === "below_mev") {
    return `floor gap ${formatCompactSetGap(row.deltaToMev)}`;
  }
  if (status === "at_mev") {
    return "floor reached; thin margin";
  }
  if (status === "below_preferred") {
    return "floor reached; below preferred";
  }
  if (status === "near_cap") {
    return "near MAV cap";
  }
  if (status === "over_cap") {
    return "over MAV";
  }
  if (status === "no_mev_floor") {
    return "no MEV floor";
  }
  return "fine";
}

function buildWeeklyMuscleVolumeTable(weeklyRetro: WeeklyRetroPayload): string[] {
  const rows = weeklyRetro.volumeTargeting.muscles;
  if (rows.length === 0) {
    return [
      "",
      "Weekly Muscle Volume",
      "Muscle | Sets | MEV | Target | MAV | Status | Notes",
      "none | 0 | n/a | n/a | n/a | n/a | no weekly muscle volume rows available",
    ];
  }

  return [
    "",
    "Weekly Muscle Volume",
    "Muscle | Sets | MEV | Target | MAV | Status | Notes",
    ...rows.map((row) =>
      [
        row.muscle,
        formatAuditDecimal(row.actualEffectiveSets),
        formatAuditDecimal(row.mev),
        formatAuditDecimal(row.weeklyTarget),
        formatAuditDecimal(row.mav),
        formatWeeklyMuscleStatus(row),
        formatWeeklyMuscleNote(row),
      ].join(" | ")
    ),
  ];
}

export function buildWeeklyRetroOperatorSummary(input: {
  artifact: Pick<WorkoutAuditArtifact, "weeklyRetro">;
  operatorDebug?: boolean;
}): string[] | null {
  const weeklyRetro = input.artifact.weeklyRetro;
  if (!weeklyRetro) {
    return null;
  }

  const formatRows = (
    rows: WeeklyRetroPayload["volumeTargeting"]["muscles"],
    deltaSelector: (row: WeeklyRetroPayload["volumeTargeting"]["muscles"][number]) => number
  ): string =>
    rows
      .slice()
      .sort((left, right) => deltaSelector(left) - deltaSelector(right))
      .slice(0, 4)
      .map((row) => `${row.muscle} (${formatSignedSetDelta(deltaSelector(row))})`)
      .join(", ") || "none";
  const belowMevRows = weeklyRetro.volumeTargeting.muscles.filter(
    (row) => row.status === "below_mev"
  );
  const belowPreferredRows = weeklyRetro.volumeTargeting.muscles.filter(
    (row) => row.status === "under_target_only"
  );
  const nearCapRows = weeklyRetro.volumeTargeting.muscles.filter(
    (row) =>
      row.mav > 0 &&
      row.actualEffectiveSets <= row.mav &&
      row.actualEffectiveSets >= row.mav * 0.9
  );
  const overCapRows = weeklyRetro.volumeTargeting.muscles.filter(
    (row) => row.status === "over_mav"
  );
  const belowMevSummary = formatRows(belowMevRows, (row) => row.deltaToMev);
  const belowPreferredSummary = formatRows(belowPreferredRows, (row) => row.deltaToTarget);
  const nearCapSummary = formatRows(nearCapRows, (row) => row.deltaToMav);
  const overCapSummary = formatRows(overCapRows, (row) => row.deltaToMav);
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
    `[workout-audit:retro] volume below_mev=${belowMevSummary} below_preferred=${belowPreferredSummary} near_cap=${nearCapSummary} over_cap=${overCapSummary}`,
    `[workout-audit:retro] interventions=${interventions}`,
    `[workout-audit:retro] recommendation=${recommendation}`,
  ];

  if (projectionDrift) {
    lines.push(
      `[workout-audit:retro] projection_delivery_drift=${projectionDrift.status} direction=${projectionDrift.summary.direction} under=${projectionDrift.summary.materialUnderdeliveryCount} over=${projectionDrift.summary.materialOverdeliveryCount} net=${formatSignedSetDelta(projectionDrift.summary.netEffectiveSetDelta)}`
    );
  }

  if (input.operatorDebug === true) {
    lines.push(...buildCompletedSessionReconciliationTable(weeklyRetro));
    lines.push(...buildFuturePlannedIncompleteTable(weeklyRetro));
    lines.push(...buildWeeklySetSummaryTable(weeklyRetro));
    lines.push(...buildWeeklyMuscleVolumeTable(weeklyRetro));
    lines.push(...buildWeeklyRetroExerciseReconciliationTable(weeklyRetro));
    lines.push(...buildPostSessionCalibrationDeltaTable(weeklyRetro));
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
  let shouldWriteAcceptedSeedDraftRecovery!: boolean;
  let shouldConfirmAcceptedSeedDraftRecovery!: boolean;
  let shouldDryRunOnly!: boolean;
  let hasExplicitEmptyMesocycleV2ReplacementFlag!: boolean;
  let hasExplicitAcceptedSeedDraftRecoveryFlag!: boolean;
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
    shouldConfirmEmptyMesocycleV2Replacement =
      args["confirm-empty-mesocycle-replacement"] === true;
    shouldConfirmAcceptedSeedDraftRecovery =
      args["confirm-accepted-seed-draft-successor-recovery"] === true;
    shouldDryRunOnly = args["dry-run"] === true;
    hasExplicitEmptyMesocycleV2ReplacementFlag =
      args["replace-empty-active-mesocycle-with-v2"] === true;
    hasExplicitAcceptedSeedDraftRecoveryFlag =
      args["replace-empty-successor-from-accepted-seed-draft"] === true;
    shouldRunPlannerOnlyDryRun = args["planner-only-dry-run"] === true;
    shouldRunPlannerOnlyNoRepair = args["planner-only-no-repair"] === true;
    shouldWriteV2DebugArtifact = args["v2-debug-artifact"] === true;
    shouldCompareRepaired = args["compare-repaired"] === true;
    shouldSuppressArtifactWrites = shouldSuppressAuditArtifactWrites(args);
    assertNoArtifactWriteCompatibility(args);
    requestedMode =
      (args.mode as WorkoutAuditRequest["mode"] | undefined) ?? "future-week";
    shouldWriteEmptyMesocycleV2Replacement =
      requestedMode === "replace-empty-mesocycle-with-v2" && args.write === true;
    shouldWriteAcceptedSeedDraftRecovery =
      requestedMode === "replace-empty-successor-from-accepted-seed-draft" &&
      args.write === true;
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
    if (requestedMode === "replace-empty-successor-from-accepted-seed-draft") {
      if (!hasExplicitAcceptedSeedDraftRecoveryFlag) {
        throw new Error(
          "--replace-empty-successor-from-accepted-seed-draft is required for --mode replace-empty-successor-from-accepted-seed-draft"
        );
      }
      if (typeof args.owner !== "string" || args.owner.trim().length === 0) {
        throw new Error(
          "replace-empty-successor-from-accepted-seed-draft requires explicit --owner",
        );
      }
      if (
        typeof args["source-mesocycle-id"] !== "string" ||
        args["source-mesocycle-id"].trim().length === 0
      ) {
        throw new Error(
          "replace-empty-successor-from-accepted-seed-draft requires explicit --source-mesocycle-id",
        );
      }
      if (
        typeof args["mesocycle-id"] !== "string" ||
        args["mesocycle-id"].trim().length === 0
      ) {
        throw new Error(
          "replace-empty-successor-from-accepted-seed-draft requires explicit --mesocycle-id",
        );
      }
      if (shouldDryRunOnly && shouldWriteAcceptedSeedDraftRecovery) {
        throw new Error("Use only one accepted-seed-draft recovery execution flag: --dry-run or --write");
      }
      if (
        shouldWriteAcceptedSeedDraftRecovery &&
        !shouldConfirmAcceptedSeedDraftRecovery
      ) {
        throw new Error(
          "--write requires --confirm-accepted-seed-draft-successor-recovery for replace-empty-successor-from-accepted-seed-draft"
        );
      }
    } else if (
      shouldWriteAcceptedSeedDraftRecovery ||
      shouldConfirmAcceptedSeedDraftRecovery ||
      hasExplicitAcceptedSeedDraftRecoveryFlag
    ) {
      throw new Error(
        "accepted-seed-draft successor recovery flags require --mode replace-empty-successor-from-accepted-seed-draft"
      );
    }
    if (
      args.write === true &&
      requestedMode !== "replace-empty-mesocycle-with-v2" &&
      requestedMode !== "replace-empty-successor-from-accepted-seed-draft"
    ) {
      throw new Error("--write is only supported by explicit recovery modes");
    }
    env = loadAuditEnv(argv, { allowWrite: true });
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
      : run.replaceEmptySuccessorFromAcceptedSeedDraft
        ? `source=${run.replaceEmptySuccessorFromAcceptedSeedDraft.sourceMesocycle.id} successor=${run.replaceEmptySuccessorFromAcceptedSeedDraft.targetSuccessor.id} verdict=${run.replaceEmptySuccessorFromAcceptedSeedDraft.verdict}`
      : run.v2AcceptedSeedPrepareCompare
        ? `handoff_candidate=${run.v2AcceptedSeedPrepareCompare.handoffCandidate.found ? "yes" : "no"} compare_status=${run.v2AcceptedSeedPrepareCompare.compareStatus}`
      : run.nextMesocycleHandoffDryRun
        ? `source_state=${run.nextMesocycleHandoffDryRun.summary.sourceState ?? "unknown"} candidate_available=${run.nextMesocycleHandoffDryRun.summary.candidateAvailable ? "yes" : "no"} handoff_ready=${run.nextMesocycleHandoffDryRun.summary.handoffReady ? "yes" : "no"} writes=${run.nextMesocycleHandoffDryRun.summary.writes}`
      : run.nextMesocycleAcceptanceGate
        ? `candidate_found=${run.nextMesocycleAcceptanceGate.candidateFound ? "yes" : "no"} gate_result=${run.nextMesocycleAcceptanceGate.gateResult}`
      : run.nextMesocyclePostAcceptVerification
        ? `verification_result=${run.nextMesocyclePostAcceptVerification.verificationResult} failed_checks=${run.nextMesocyclePostAcceptVerification.checks.filter((row) => row.status === "fail").length}`
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
    buildWorkoutAuditModeLine({
      mode: context.mode,
      plannerDiagnosticsMode: context.plannerDiagnosticsMode,
      summary,
      preSessionReadiness: run.preSessionReadiness,
      projectedWeekVolume: run.projectedWeekVolume,
      weeklyRetro: run.weeklyRetro,
    })
  );
  const preSessionReadinessSummary = buildPreSessionReadinessSummary({
    artifact,
    operatorDebug: args["operator-debug"] === true,
  });
  if (preSessionReadinessSummary) {
    for (const line of preSessionReadinessSummary) {
      console.log(line);
    }
  }
  const projectedWeekSummary = buildProjectedWeekOperatorSummary({
    artifact,
    outputPath: outputPathForSummary,
  });
  if (projectedWeekSummary && !preSessionReadinessSummary) {
    for (const line of projectedWeekSummary) {
      console.log(line);
    }
  }
  const currentWeekAuditSummary = buildCurrentWeekAuditOperatorSummary({
    artifact,
  });
  if (currentWeekAuditSummary && !preSessionReadinessSummary) {
    for (const line of currentWeekAuditSummary) {
      console.log(line);
    }
  }
  const weeklyRetroSummary = buildWeeklyRetroOperatorSummary({
    artifact,
    operatorDebug: args["operator-debug"] === true,
  });
  if (weeklyRetroSummary && !preSessionReadinessSummary) {
    for (const line of weeklyRetroSummary) {
      console.log(line);
    }
  }
  const futureWeekSummary = buildFutureWeekOperatorDebugSummary({
    artifact,
    operatorDebug: args["operator-debug"] === true,
  });
  if (futureWeekSummary && !preSessionReadinessSummary) {
    for (const line of futureWeekSummary) {
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
  const acceptedSeedDraftRecoverySummary =
    buildAcceptedSeedDraftSuccessorRecoverySummary({
      artifact,
      outputPath: outputPathForSummary,
    });
  if (acceptedSeedDraftRecoverySummary) {
    for (const line of acceptedSeedDraftRecoverySummary) {
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
  const nextMesocycleHandoffDryRunSummary =
    buildNextMesocycleHandoffDryRunSummary({
      artifact,
    });
  if (nextMesocycleHandoffDryRunSummary) {
    for (const line of nextMesocycleHandoffDryRunSummary) {
      console.log(line);
    }
  }
  const nextMesocycleAcceptanceGateSummary =
    buildNextMesocycleAcceptanceGateSummary({
      artifact,
    });
  if (nextMesocycleAcceptanceGateSummary) {
    for (const line of nextMesocycleAcceptanceGateSummary) {
      console.log(line);
    }
  }
  const nextMesocyclePostAcceptVerificationSummary =
    buildNextMesocyclePostAcceptVerificationSummary({
      artifact,
    });
  if (nextMesocyclePostAcceptVerificationSummary) {
    for (const line of nextMesocyclePostAcceptVerificationSummary) {
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
  let acceptedSeedDraftRecoveryWriteSummary: string[] | null = null;
  if (shouldWriteAcceptedSeedDraftRecovery) {
    const { replaceEmptySuccessorFromAcceptedSeedDraft } = await import(
      "@/lib/api/replace-empty-successor-from-accepted-seed-draft"
    );
    const writeResult = await replaceEmptySuccessorFromAcceptedSeedDraft({
      userId: context.userId,
      ownerEmail: context.ownerEmail ?? "",
      sourceMesocycleId: request.sourceMesocycleId!,
      successorMesocycleId: request.mesocycleId!,
      replaceEmptySuccessorFromAcceptedSeedDraft: true,
      write: true,
      confirmAcceptedSeedDraftSuccessorRecovery:
        shouldConfirmAcceptedSeedDraftRecovery,
    });
    acceptedSeedDraftRecoveryWriteSummary = [
      `[workout-audit:accepted-seed-draft-recovery:write] source=${writeResult.sourceMesocycle.id} successor=${writeResult.targetSuccessor.id} eligible=${formatBooleanFlag(writeResult.write.eligible)} db_write=${formatBooleanFlag(writeResult.write.dbWriteOccurred)} transaction=${writeResult.write.transactionStatus}`,
      `[workout-audit:accepted-seed-draft-recovery:write] verdict=${writeResult.verdict} blockers=${writeResult.guardSummary.blockers.join(",") || "none"}`,
    ];
  }
  if (acceptedSeedDraftRecoveryWriteSummary) {
    for (const line of acceptedSeedDraftRecoveryWriteSummary) {
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
  if (args["operator-debug"] === true && !preSessionReadinessSummary) {
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
