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

type PlanningRealitySummaryArtifact = {
  mesocycleExplain?: {
    preview?: {
      projectionDiagnostics?: {
        planningReality?: PartialPlanningRealityDiagnostic | null;
      } | null;
    } | null;
  } | null;
};

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

function formatPlanningRealityArchitectureImplication(
  planningShape: string | null | undefined
): string {
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

  const lines = ["Planning Reality Summary", "------------------------"];
  if (input.outputPath) {
    lines.push(`Artifact: ${input.outputPath}`);
  }

  const planningShape = planningReality.summary?.planningShape;
  lines.push(`Planning shape: ${planningShape ?? "unknown"}`, "");
  lines.push("Demand:");
  lines.push(`- Explicit upstream muscles: ${formatNameList(explicitMuscles)}`);
  lines.push(`- Inferred downstream muscles: ${formatNameList(inferredMuscles)}`, "");
  lines.push("Repair:");
  lines.push(
    `- Material repairs: ${formatPlanningRealityNumber(planningReality.summary?.materialRepairCount)}`
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
  lines.push(formatPlanningRealityArchitectureImplication(planningShape));

  return lines;
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
