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
  } | null;
};

const PLANNING_REALITY_SIZE_BUDGET_APPROACH_RATIO = 0.9;
const PLANNING_REALITY_SIZE_BUDGET_SECTION_LIMIT = 8;

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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const shouldApplyBoundedReseed = args["apply-bounded-reseed"] === true;
  const shouldAcceptSlotPlanUpgrade = args["accept-slot-plan-upgrade"] === true;
  const shouldRunPlannerOnlyDryRun = args["planner-only-dry-run"] === true;
  const shouldCompareRepaired = args["compare-repaired"] === true;
  if (shouldRunPlannerOnlyDryRun && !shouldCompareRepaired) {
    throw new Error("--planner-only-dry-run currently requires --compare-repaired");
  }
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
  const { artifact, serializedArtifact, serialized, sizeBytes } = output;

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
      : run.activeMesocycleSlotReseed
        ? `week=${run.activeMesocycleSlotReseed.activeMesocycle.week} verdict=${run.activeMesocycleSlotReseed.recommendation.verdict}`
      : run.mesocycleExplain
        ? `source=${run.mesocycleExplain.sourceMesocycleId} retrospective=${run.mesocycleExplain.retrospectiveMesocycleId} preview_slots=${run.mesocycleExplain.preview.slotPlans.length}`
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
    outputPath,
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
  const activeMesocycleSlotReseedSummary = buildActiveMesocycleSlotReseedSummary({
    artifact,
    outputPath,
  });
  if (activeMesocycleSlotReseedSummary) {
    for (const line of activeMesocycleSlotReseedSummary) {
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
