import type { V2SetDistributionIntent } from "@/lib/engine/planning/v2/set-distribution-intent";
import { classSatisfiesIntent, classifySelectedExerciseClass } from "./selection-alignment";
import { normalizeMuscle } from "./shared-evidence";
import { uniqueSorted } from "./planner-intent";
import type {
  DuplicateContinuityJustification,
  ExerciseClassAlignment,
  ExerciseClassDistributionBySlot,
  ExerciseClassUnresolvedCause,
  ExerciseConcentrationDiagnostic,
  PlannerOwnedAccumulationProjection,
  SlotCompositionSnapshotDiagnostic,
} from "./types";

type V2LaneDiffEvidence = {
  laneId: string;
  targetPrimaryMuscles: string[];
  targetExerciseClasses: string[];
  targetSets: { min: number; preferred: number; max: number };
  currentStatus: string;
  currentEvidence: {
    selectedExercises: Array<{
      name: string;
      sets: number;
      matchedClass?: string;
      role?: string;
    }>;
    relevantDiagnostics: string[];
  };
  gapCause: string;
  migrationRecommendation: string;
  severity: string;
};

export type V2ExerciseSelectionPlanDiagnostic = {
  version: 1;
  source: "v2_planner_policy";
  readOnly: true;
  affectsScoringOrGeneration: false;
  status:
    | "diagnostic_only"
    | "projected_with_limitations"
    | "selection_ready_but_not_consumed"
    | "blocked";
  identityBasis: "week_1_selected_identities";
  projectionBasis: "planner_owned_accumulation_projection_plus_week_1_identity_continuity";
  summary: {
    weeksEvaluated: number;
    lanesEvaluated: number;
    preservedIdentityCount: number;
    candidateAvailableCount: number;
    missingCandidateCount: number;
    classMismatchCount: number;
    duplicateRequiresJustificationCount: number;
    concentrationWarningCount: number;
    blockedLaneCount: number;
  };
  weeks: Array<{
    week: 1 | 2 | 3 | 4;
    slots: Array<{
      slotId: string;
      lanes: Array<{
        laneId: string;
        plannedClass: string[];
        primaryMuscles: string[];
        selectedIdentity?: {
          exerciseId: string | null;
          exerciseName: string;
          sourceWeek: 1;
          setCount: number;
        };
        identityStatus:
          | "preserved"
          | "candidate_available"
          | "missing_candidate"
          | "duplicate_requires_justification"
          | "class_mismatch"
          | "not_evaluated";
        laneClassStatus: "match" | "partial" | "mismatch" | "not_evaluated";
        setBudgetStatus:
          | "within_budget"
          | "allowed_expansion"
          | "requires_justification"
          | "blocked";
        duplicateStatus: "pass" | "justified" | "requires_justification" | "blocked";
        concentrationStatus: "pass" | "quality_warning" | "blocked";
        fatigueStatus: "pass" | "quality_warning" | "blocked" | "not_evaluated";
        inventoryStatus: "available" | "classification_gap" | "missing" | "not_evaluated";
        capacityStatus: "within_capacity" | "at_capacity" | "blocked" | "not_evaluated";
        cleanAlternatives: Array<{
          exerciseId: string | null;
          exerciseName: string;
          exerciseClass: string;
          evidence: string[];
        }>;
        unresolvedDemand: string[];
        evidenceRefs: string[];
        limitations: string[];
      }>;
    }>;
  }>;
  blockers: string[];
  warnings: string[];
  missingInputs: string[];
  safeForBehaviorPromotion: false;
};

type BuilderInput = {
  plannerOwnedAccumulationProjection: PlannerOwnedAccumulationProjection;
  week1SelectedIdentities: ReadonlyArray<SlotCompositionSnapshotDiagnostic>;
  v2SetDistributionIntent: V2SetDistributionIntent;
  v2TargetVsNoRepairDiff: {
    slotDiffs: Array<{
      slotId: string;
      laneDiffs: V2LaneDiffEvidence[];
    }>;
  };
  exerciseClassDistributionBySlot?: ReadonlyArray<ExerciseClassDistributionBySlot>;
  exerciseClassAlignment?: ExerciseClassAlignment;
  exerciseClassUnresolvedCauses?: ReadonlyArray<ExerciseClassUnresolvedCause>;
  duplicateContinuityJustification?: DuplicateContinuityJustification;
  exerciseConcentration?: ReadonlyArray<ExerciseConcentrationDiagnostic>;
};

type SelectedIdentity = {
  exerciseId: string | null;
  exerciseName: string;
  sourceWeek: 1;
  setCount: number;
  exerciseClass: string;
};

const MAX_SLOT_EXERCISES = 6;

function laneKey(slotId: string, laneId: string): string {
  return `${slotId}:${laneId}`;
}

function buildWeek1LaneDiffIndex(
  diff: BuilderInput["v2TargetVsNoRepairDiff"],
): Map<string, V2LaneDiffEvidence> {
  const index = new Map<string, V2LaneDiffEvidence>();
  for (const slot of diff.slotDiffs) {
    for (const lane of slot.laneDiffs) {
      index.set(laneKey(slot.slotId, lane.laneId), lane);
    }
  }
  return index;
}

function buildWeek1SlotIndex(
  slots: ReadonlyArray<SlotCompositionSnapshotDiagnostic>,
): Map<string, SlotCompositionSnapshotDiagnostic> {
  return new Map(slots.map((slot) => [slot.slotId, slot]));
}

function findSelectedIdentity(input: {
  slot: SlotCompositionSnapshotDiagnostic | undefined;
  lane: {
    laneId: string;
    preferredExerciseClasses: string[];
    primaryMuscles: string[];
  };
  laneDiff: V2LaneDiffEvidence | undefined;
}): SelectedIdentity | undefined {
  const diffExercises = input.laneDiff?.currentEvidence.selectedExercises ?? [];
  const diffExercise =
    diffExercises.find((exercise) => {
      const matchingExercise = input.slot?.exercises.find(
        (candidate) => candidate.exerciseName === exercise.name,
      );
      const exerciseClass =
        exercise.matchedClass ??
        (matchingExercise
          ? classifySelectedExerciseClass({
              exercise: matchingExercise,
              muscle:
                input.lane.primaryMuscles.find((muscle) =>
                  matchingExercise.primaryMuscles.map(normalizeMuscle).includes(muscle),
                ) ??
                input.lane.primaryMuscles[0] ??
                "",
            })
          : undefined);
      return exerciseClass
        ? input.lane.preferredExerciseClasses.some((plannedClass) =>
            classSatisfiesDiagnosticIntent({
              exerciseClass,
              plannedClass,
              laneId: input.lane.laneId,
            }),
          )
        : false;
    }) ?? diffExercises[0];
  if (input.laneDiff && !diffExercise) {
    return undefined;
  }
  const matchingExercise = input.slot?.exercises.find((exercise) =>
    diffExercise
      ? exercise.exerciseName === diffExercise.name
      : input.lane.primaryMuscles.some((muscle) =>
          exercise.primaryMuscles.map(normalizeMuscle).includes(muscle),
        ),
  );
  if (!matchingExercise && !diffExercise) {
    return undefined;
  }
  const exerciseName = matchingExercise?.exerciseName ?? diffExercise?.name ?? "unknown";
  const setCount = matchingExercise?.setCount ?? diffExercise?.sets ?? 0;
  const matchingMuscle =
    input.lane.primaryMuscles.find((muscle) =>
      matchingExercise?.primaryMuscles.map(normalizeMuscle).includes(muscle),
    ) ?? input.lane.primaryMuscles[0] ?? "";
  const exerciseClass =
    diffExercise?.matchedClass ??
    (matchingExercise
      ? classifySelectedExerciseClass({
          exercise: matchingExercise,
          muscle: matchingMuscle,
        })
      : "unclassified");

  return {
    exerciseId: matchingExercise?.exerciseId ?? null,
    exerciseName,
    sourceWeek: 1,
    setCount,
    exerciseClass,
  };
}

function laneClassStatus(input: {
  selectedIdentity: SelectedIdentity | undefined;
  plannedClass: ReadonlyArray<string>;
  laneDiff: V2LaneDiffEvidence | undefined;
}): V2ExerciseSelectionPlanDiagnostic["weeks"][number]["slots"][number]["lanes"][number]["laneClassStatus"] {
  if (!input.selectedIdentity) {
    return "not_evaluated";
  }
  if (
    input.plannedClass.some((planned) =>
      classSatisfiesDiagnosticIntent({
        exerciseClass: input.selectedIdentity!.exerciseClass,
        plannedClass: planned,
        laneId: input.laneDiff?.laneId,
      }),
    )
  ) {
    return "match";
  }
  if (input.laneDiff?.currentStatus === "partial") {
    return "partial";
  }
  return "mismatch";
}

function classSatisfiesDiagnosticIntent(input: {
  exerciseClass: string;
  plannedClass: string;
  laneId?: string;
}): boolean {
  const { exerciseClass, plannedClass } = input;
  if (classSatisfiesIntent(exerciseClass, plannedClass)) {
    return true;
  }
  const aliases: Record<string, string[]> = {
    press: ["chest_press"],
    horizontal_press: ["chest_press"],
    fly: ["chest_isolation", "cable_fly", "chest_fly"],
    horizontal_pull_support: ["horizontal_pull", "cable_row"],
    hamstring_curl: ["knee_flexion_curl", "leg_curl"],
    biceps_isolation: ["biceps_curl"],
    triceps_isolation_if_under_floor: ["triceps_isolation"],
    squat: ["squat_compound", "squat_or_quad_support"],
    leg_press: ["squat_or_quad_support"],
    lunge: ["squat_or_quad_support"],
    quad_isolation: ["squat_or_quad_support"],
  };
  if (
    plannedClass === "low_dose_hinge" &&
    input.laneId === "secondary_hinge" &&
    ["hinge", "light_hinge"].includes(exerciseClass)
  ) {
    return true;
  }
  return aliases[plannedClass]?.includes(exerciseClass) ?? false;
}

function laneDiffDiagnostics(laneDiff: V2LaneDiffEvidence | undefined): string[] {
  return laneDiff?.currentEvidence.relevantDiagnostics ?? [];
}

function hasTrueHardLaneEvidence(
  laneDiff: V2LaneDiffEvidence | undefined,
): boolean {
  if (
    laneDiff?.currentStatus !== "blocked" ||
    laneDiff.severity !== "hard_blocker"
  ) {
    return false;
  }
  const diagnostics = laneDiffDiagnostics(laneDiff).map((row) => row.toLowerCase());
  const joined = diagnostics.join("|");
  const hasDirtyCollateralSolvingTarget =
    joined.includes("dirty") &&
    (joined.includes("target_delivery:satisfied") ||
      joined.includes("target_status:satisfied") ||
      joined.includes("target_status:overdelivered") ||
      joined.includes("solving_target"));

  return (
    diagnostics.includes("setpolicy:hard_blocker") ||
    diagnostics.includes("target_status:blocked") ||
    joined.includes("setpolicyreason:gt_5_sets") ||
    joined.includes("forbidden") ||
    hasDirtyCollateralSolvingTarget ||
    joined.includes("fatigue_blocked") ||
    joined.includes("risk:axial_fatigue") ||
    joined.includes("risk:systemic_fatigue") ||
    joined.includes("excessive_systemic") ||
    joined.includes("systemic_fatigue_risk")
  );
}

function isDowngradedConcentrationPolicyGap(
  laneDiff: V2LaneDiffEvidence | undefined,
): boolean {
  return (
    laneDiff?.severity === "quality_warning" &&
    laneDiff.migrationRecommendation === "keep_diagnostic_only" &&
    laneDiff.gapCause === "concentration_policy_gap"
  );
}

function laneDiffHasConcentrationWarning(
  laneDiff: V2LaneDiffEvidence | undefined,
): boolean {
  return (
    isDowngradedConcentrationPolicyGap(laneDiff) ||
    (laneDiff?.severity === "quality_warning" &&
      laneDiffDiagnostics(laneDiff).some((row) =>
        row.toLowerCase().includes("concentration"),
      ))
  );
}

function hasSetBudgetHardEvidence(
  laneDiff: V2LaneDiffEvidence | undefined,
): boolean {
  if (!hasTrueHardLaneEvidence(laneDiff)) {
    return false;
  }
  const joined = laneDiffDiagnostics(laneDiff).join("|").toLowerCase();
  return (
    joined.includes("setpolicy:hard_blocker") ||
    joined.includes("setpolicyreason:gt_5_sets") ||
    joined.includes("set_count_gt_5") ||
    joined.includes("compound_gt_5") ||
    joined.includes("isolation_gt_5")
  );
}

function setBudgetStatus(input: {
  selectedIdentity: SelectedIdentity | undefined;
  budget: { min: number; preferred: number; max: number };
  maxSetsPerExercise: number;
  laneDiff: V2LaneDiffEvidence | undefined;
}): V2ExerciseSelectionPlanDiagnostic["weeks"][number]["slots"][number]["lanes"][number]["setBudgetStatus"] {
  if (hasSetBudgetHardEvidence(input.laneDiff)) {
    return "blocked";
  }
  if (!input.selectedIdentity) {
    return input.budget.min > 0 ? "blocked" : "within_budget";
  }
  if (input.selectedIdentity.setCount <= input.budget.max) {
    return "within_budget";
  }
  if (input.selectedIdentity.setCount <= input.maxSetsPerExercise) {
    return "allowed_expansion";
  }
  return "requires_justification";
}

function matchingDuplicate(input: {
  duplicateContinuityJustification: DuplicateContinuityJustification | undefined;
  selectedIdentity: SelectedIdentity | undefined;
  slotId: string;
}) {
  if (!input.selectedIdentity) {
    return undefined;
  }
  return input.duplicateContinuityJustification?.duplicates.find(
    (duplicate) =>
      (duplicate.exerciseId === input.selectedIdentity!.exerciseId ||
        duplicate.exerciseName === input.selectedIdentity!.exerciseName) &&
      duplicate.duplicatedInSlots.includes(input.slotId),
  );
}

function duplicateStatus(input: {
  duplicate: ReturnType<typeof matchingDuplicate>;
  laneDiff: V2LaneDiffEvidence | undefined;
}): V2ExerciseSelectionPlanDiagnostic["weeks"][number]["slots"][number]["lanes"][number]["duplicateStatus"] {
  if (!input.duplicate) {
    return "pass";
  }
  if (input.duplicate.risk === "high" && input.duplicate.justification === "unjustified") {
    return "blocked";
  }
  if (
    input.duplicate.justification === "unknown" ||
    input.duplicate.justification === "unjustified" ||
    input.duplicate.policyRecommendation === "requires_planner_decision" ||
    input.laneDiff?.gapCause === "duplicate_policy_gap"
  ) {
    return "requires_justification";
  }
  return "justified";
}

function concentrationStatus(input: {
  exerciseConcentration: ReadonlyArray<ExerciseConcentrationDiagnostic> | undefined;
  selectedIdentity: SelectedIdentity | undefined;
  slotId: string;
  laneDiff: V2LaneDiffEvidence | undefined;
}): V2ExerciseSelectionPlanDiagnostic["weeks"][number]["slots"][number]["lanes"][number]["concentrationStatus"] {
  if (!input.selectedIdentity) {
    return "pass";
  }
  if (hasTrueHardLaneEvidence(input.laneDiff)) {
    return "blocked";
  }
  if (laneDiffHasConcentrationWarning(input.laneDiff)) {
    return "quality_warning";
  }
  const rows = (input.exerciseConcentration ?? []).filter(
    (row) =>
      row.slotId === input.slotId &&
      (row.exerciseId === input.selectedIdentity!.exerciseId ||
        row.exerciseName === input.selectedIdentity!.exerciseName),
  );
  if (
    rows.some((row) =>
      row.flags.includes("EXERCISE_SUPPLIES_OVER_60_PERCENT_WEEKLY_STIMULUS"),
    )
  ) {
    return "quality_warning";
  }
  if (rows.some((row) => row.flags.length > 0)) {
    return "quality_warning";
  }
  return "pass";
}

function fatigueStatus(input: {
  concentrationStatus: V2ExerciseSelectionPlanDiagnostic["weeks"][number]["slots"][number]["lanes"][number]["concentrationStatus"];
  laneDiff: V2LaneDiffEvidence | undefined;
  limitations: ReadonlyArray<string>;
}): V2ExerciseSelectionPlanDiagnostic["weeks"][number]["slots"][number]["lanes"][number]["fatigueStatus"] {
  if (
    input.concentrationStatus === "blocked" &&
    hasTrueHardLaneEvidence(input.laneDiff)
  ) {
    return "blocked";
  }
  if (
    input.concentrationStatus === "quality_warning" ||
    input.limitations.some((row) => row.includes("fatigue") || row.includes("collateral"))
  ) {
    return "quality_warning";
  }
  return input.laneDiff ? "pass" : "not_evaluated";
}

function getClassDemands(input: {
  exerciseClassDistributionBySlot: ReadonlyArray<ExerciseClassDistributionBySlot> | undefined;
  slotId: string;
  lane: { primaryMuscles: ReadonlyArray<string> };
}) {
  const muscles = new Set(input.lane.primaryMuscles);
  return (input.exerciseClassDistributionBySlot ?? [])
    .filter((slot) => slot.week === 1 && slot.slotId === input.slotId)
    .flatMap((slot) => slot.muscleDemands)
    .filter((demand) => muscles.has(demand.muscle));
}

function getAlignmentRows(input: {
  exerciseClassAlignment: ExerciseClassAlignment | undefined;
  slotId: string;
  lane: { primaryMuscles: ReadonlyArray<string> };
}) {
  const muscles = new Set(input.lane.primaryMuscles);
  return (
    input.exerciseClassAlignment?.slots
      .find((slot) => slot.slotId === input.slotId)
      ?.muscleAlignments.filter((row) => muscles.has(row.muscle)) ?? []
  );
}

function getUnresolvedCauses(input: {
  exerciseClassUnresolvedCauses: ReadonlyArray<ExerciseClassUnresolvedCause> | undefined;
  slotId: string;
  lane: { primaryMuscles: ReadonlyArray<string> };
}) {
  const muscles = new Set(input.lane.primaryMuscles);
  return (input.exerciseClassUnresolvedCauses ?? []).filter(
    (row) => row.slotId === input.slotId && muscles.has(row.muscle),
  );
}

function parseInventoryEvidence(row: string): {
  exerciseName: string;
  exerciseClass: string;
  availability: string;
} | null {
  const match = /^inventory:(.*):class=([^:]+):availability=([^:]+)$/.exec(row);
  if (!match) {
    return null;
  }
  return {
    exerciseName: match[1] ?? "unknown",
    exerciseClass: match[2] ?? "unknown",
    availability: match[3] ?? "unknown",
  };
}

function cleanAlternatives(input: {
  classDemands: ReturnType<typeof getClassDemands>;
  duplicate: ReturnType<typeof matchingDuplicate>;
  selectedIdentity: SelectedIdentity | undefined;
}): V2ExerciseSelectionPlanDiagnostic["weeks"][number]["slots"][number]["lanes"][number]["cleanAlternatives"] {
  const alternatives = new Map<
    string,
    V2ExerciseSelectionPlanDiagnostic["weeks"][number]["slots"][number]["lanes"][number]["cleanAlternatives"][number]
  >();
  for (const demand of input.classDemands) {
    for (const evidence of demand.inventoryEvidence) {
      const parsed = parseInventoryEvidence(evidence);
      if (!parsed) {
        continue;
      }
      if (
        parsed.availability !== "clean_available" &&
        !parsed.availability.startsWith("available_but")
      ) {
        continue;
      }
      if (parsed.exerciseName === input.selectedIdentity?.exerciseName) {
        continue;
      }
      alternatives.set(parsed.exerciseName, {
        exerciseId: null,
        exerciseName: parsed.exerciseName,
        exerciseClass: parsed.exerciseClass,
        evidence: [evidence],
      });
    }
  }
  for (const alternative of input.duplicate?.compatibleAlternatives ?? []) {
    if (alternative.exerciseName === input.selectedIdentity?.exerciseName) {
      continue;
    }
    alternatives.set(alternative.exerciseName, {
      exerciseId: null,
      exerciseName: alternative.exerciseName,
      exerciseClass: alternative.exerciseClass ?? "unknown",
      evidence: alternative.reasonAvailableOrBlocked,
    });
  }
  return Array.from(alternatives.values())
    .sort((left, right) => left.exerciseName.localeCompare(right.exerciseName))
    .slice(0, 5);
}

function inventoryStatus(input: {
  selectedIdentity: SelectedIdentity | undefined;
  classDemands: ReturnType<typeof getClassDemands>;
  unresolvedCauses: ReturnType<typeof getUnresolvedCauses>;
  alternatives: ReturnType<typeof cleanAlternatives>;
}): V2ExerciseSelectionPlanDiagnostic["weeks"][number]["slots"][number]["lanes"][number]["inventoryStatus"] {
  if (
    input.unresolvedCauses.some(
      (cause) => cause.owningCause === "inventory_classification_gap",
    )
  ) {
    return "classification_gap";
  }
  if (input.selectedIdentity || input.alternatives.length > 0) {
    return "available";
  }
  const hasInventoryEvidence = input.classDemands.some((demand) =>
    demand.inventoryEvidence.some((row) => row.startsWith("inventory:")),
  );
  return hasInventoryEvidence ? "missing" : "not_evaluated";
}

function capacityStatus(input: {
  slot: SlotCompositionSnapshotDiagnostic | undefined;
  selectedIdentity: SelectedIdentity | undefined;
  identityStatus: V2ExerciseSelectionPlanDiagnostic["weeks"][number]["slots"][number]["lanes"][number]["identityStatus"];
}): V2ExerciseSelectionPlanDiagnostic["weeks"][number]["slots"][number]["lanes"][number]["capacityStatus"] {
  if (!input.slot) {
    return "not_evaluated";
  }
  if (
    !input.selectedIdentity &&
    input.identityStatus === "missing_candidate" &&
    input.slot.exerciseCount >= MAX_SLOT_EXERCISES
  ) {
    return "blocked";
  }
  return input.slot.exerciseCount >= MAX_SLOT_EXERCISES
    ? "at_capacity"
    : "within_capacity";
}

function buildLane(input: {
  week: 1 | 2 | 3 | 4;
  slotId: string;
  lane: {
    laneId: string;
    preferredExerciseClasses: string[];
    primaryMuscles: string[];
    setBudget: { min: number; preferred: number; max: number };
    concentrationPolicy: { maxSetsPerExercise: number };
  };
  week1Slot: SlotCompositionSnapshotDiagnostic | undefined;
  laneDiff: V2LaneDiffEvidence | undefined;
  classDemands: ReturnType<typeof getClassDemands>;
  alignmentRows: ReturnType<typeof getAlignmentRows>;
  unresolvedCauses: ReturnType<typeof getUnresolvedCauses>;
  duplicateContinuityJustification: DuplicateContinuityJustification | undefined;
  exerciseConcentration: ReadonlyArray<ExerciseConcentrationDiagnostic> | undefined;
}) {
  const selectedIdentity = findSelectedIdentity({
    slot: input.week1Slot,
    lane: input.lane,
    laneDiff: input.laneDiff,
  });
  const laneClass = laneClassStatus({
    selectedIdentity,
    plannedClass: input.lane.preferredExerciseClasses,
    laneDiff: input.laneDiff,
  });
  const duplicateRow = matchingDuplicate({
    duplicateContinuityJustification: input.duplicateContinuityJustification,
    selectedIdentity,
    slotId: input.slotId,
  });
  const dupStatus = duplicateStatus({ duplicate: duplicateRow, laneDiff: input.laneDiff });
  const concentration = concentrationStatus({
    exerciseConcentration: input.exerciseConcentration,
    selectedIdentity,
    slotId: input.slotId,
    laneDiff: input.laneDiff,
  });
  const alternatives = cleanAlternatives({
    classDemands: input.classDemands,
    duplicate: duplicateRow,
    selectedIdentity,
  });
  const inventory = inventoryStatus({
    selectedIdentity,
    classDemands: input.classDemands,
    unresolvedCauses: input.unresolvedCauses,
    alternatives,
  });
  const setBudget = setBudgetStatus({
    selectedIdentity,
    budget: input.lane.setBudget,
    maxSetsPerExercise: input.lane.concentrationPolicy.maxSetsPerExercise,
    laneDiff: input.laneDiff,
  });
  const limitationEvidence = uniqueSorted([
    ...input.classDemands.flatMap((demand) => demand.limitations),
    ...input.alignmentRows.flatMap((row) => row.limitations),
    ...input.unresolvedCauses.flatMap((row) => row.limitations),
    ...(input.week === 1
      ? ["week_1_selected_identity_basis"]
      : ["week_1_identity_continuity_only"]),
    ...(inventory === "not_evaluated"
      ? ["generic_per_lane_candidate_inventory_not_available"]
      : []),
  ]);
  const fatigue = fatigueStatus({
    concentrationStatus: concentration,
    laneDiff: input.laneDiff,
    limitations: limitationEvidence,
  });
  const identityStatus: V2ExerciseSelectionPlanDiagnostic["weeks"][number]["slots"][number]["lanes"][number]["identityStatus"] =
    dupStatus === "blocked" || dupStatus === "requires_justification"
      ? "duplicate_requires_justification"
      : laneClass === "mismatch"
        ? "class_mismatch"
        : selectedIdentity
          ? "preserved"
          : alternatives.length > 0
            ? "candidate_available"
            : inventory === "missing"
              ? "missing_candidate"
              : "not_evaluated";

  return {
    laneId: input.lane.laneId,
    plannedClass: [...input.lane.preferredExerciseClasses],
    primaryMuscles: [...input.lane.primaryMuscles],
    ...(selectedIdentity
      ? {
          selectedIdentity: {
            exerciseId: selectedIdentity.exerciseId,
            exerciseName: selectedIdentity.exerciseName,
            sourceWeek: 1 as const,
            setCount: selectedIdentity.setCount,
          },
        }
      : {}),
    identityStatus,
    laneClassStatus: laneClass,
    setBudgetStatus: setBudget,
    duplicateStatus: dupStatus,
    concentrationStatus: concentration,
    fatigueStatus: fatigue,
    inventoryStatus: inventory,
    capacityStatus: capacityStatus({
      slot: input.week1Slot,
      selectedIdentity,
      identityStatus,
    }),
    cleanAlternatives: alternatives,
    unresolvedDemand: uniqueSorted([
      ...input.unresolvedCauses.map(
        (cause) => `${cause.muscle}:${cause.owningCause}`,
      ),
      ...(input.laneDiff?.gapCause && input.laneDiff.gapCause !== "none"
        ? [`v2TargetVsNoRepairDiff:${input.laneDiff.gapCause}`]
        : []),
    ]),
    evidenceRefs: uniqueSorted([
      ...(input.laneDiff?.currentEvidence.relevantDiagnostics ?? []),
      ...input.classDemands.flatMap((demand) => demand.inventoryEvidence.slice(0, 4)),
      ...input.alignmentRows.flatMap((row) => row.evidence.slice(0, 4)),
      ...input.unresolvedCauses.flatMap((row) => row.evidence.slice(0, 4)),
      ...(duplicateRow
        ? [`duplicate:${duplicateRow.justification}:${duplicateRow.policyRecommendation}`]
        : []),
    ]).slice(0, 12),
    limitations: limitationEvidence,
  };
}

export function buildV2ExerciseSelectionPlanDiagnostic(
  input: BuilderInput,
): V2ExerciseSelectionPlanDiagnostic {
  const week1Slots = buildWeek1SlotIndex(input.week1SelectedIdentities);
  const laneDiffs = buildWeek1LaneDiffIndex(input.v2TargetVsNoRepairDiff);
  const weekOneIntent = input.v2SetDistributionIntent.weeks.find(
    (week) => week.week === 1,
  );
  const weekRows = [
    ...(weekOneIntent
      ? [
          {
            week: 1 as const,
            slots: weekOneIntent.slots.map((slot) => ({
              slotId: slot.slotId,
              lanes: slot.lanes.map((lane) => ({
                laneId: lane.laneId,
                preferredExerciseClasses: lane.preferredExerciseClasses,
                primaryMuscles: lane.primaryMuscles,
                setBudget: {
                  min: lane.setBudget.min,
                  preferred: lane.setBudget.preferred,
                  max: lane.setBudget.max,
                },
                concentrationPolicy: {
                  maxSetsPerExercise:
                    lane.capPolicy.maxSetsPerExerciseWithoutJustification,
                },
              })),
            })),
          },
        ]
      : []),
    ...input.plannerOwnedAccumulationProjection.weeks.map((week) => ({
      week: week.week,
      slots: week.slots.map((slot) => ({
        slotId: slot.slotId,
        lanes: slot.classLanes.map((lane) => ({
          laneId: lane.laneId,
          preferredExerciseClasses: lane.preferredExerciseClasses,
          primaryMuscles: uniqueSorted(
            slot.allocatedMuscles
              .filter((muscle) => muscle.role !== "secondary")
              .map((muscle) => muscle.muscle),
          ),
          setBudget: lane.setBudget,
          concentrationPolicy: {
            maxSetsPerExercise: lane.concentrationPolicy.maxSetsPerExercise,
          },
        })),
      })),
    })),
  ];

  const missingInputs = uniqueSorted([
    ...(!weekOneIntent ? ["v2SetDistributionIntent:week_1:missing"] : []),
    ...input.plannerOwnedAccumulationProjection.weeks.flatMap((week) =>
      week.validation.missingInputs,
    ),
  ]);

  const weeks = weekRows.map((week) => ({
    week: week.week,
    slots: week.slots.map((slot) => ({
      slotId: slot.slotId,
      lanes: slot.lanes.map((lane) => {
        const laneDiff = laneDiffs.get(laneKey(slot.slotId, lane.laneId));
        return buildLane({
          week: week.week,
          slotId: slot.slotId,
          lane,
          week1Slot: week1Slots.get(slot.slotId),
          laneDiff,
          classDemands: getClassDemands({
            exerciseClassDistributionBySlot: input.exerciseClassDistributionBySlot,
            slotId: slot.slotId,
            lane,
          }),
          alignmentRows: getAlignmentRows({
            exerciseClassAlignment: input.exerciseClassAlignment,
            slotId: slot.slotId,
            lane,
          }),
          unresolvedCauses: getUnresolvedCauses({
            exerciseClassUnresolvedCauses: input.exerciseClassUnresolvedCauses,
            slotId: slot.slotId,
            lane,
          }),
          duplicateContinuityJustification:
            input.duplicateContinuityJustification,
          exerciseConcentration: input.exerciseConcentration,
        });
      }),
    })),
  }));

  const lanes = weeks.flatMap((week) =>
    week.slots.flatMap((slot) => slot.lanes.map((lane) => ({ week, slot, lane }))),
  );
  const blockedLaneCount = lanes.filter(
    ({ lane }) =>
      lane.setBudgetStatus === "blocked" ||
      lane.duplicateStatus === "blocked" ||
      lane.concentrationStatus === "blocked" ||
      lane.fatigueStatus === "blocked" ||
      lane.capacityStatus === "blocked",
  ).length;
  const warningCount = lanes.filter(
    ({ lane }) =>
      lane.identityStatus === "duplicate_requires_justification" ||
      lane.laneClassStatus === "partial" ||
      lane.setBudgetStatus === "requires_justification" ||
      lane.concentrationStatus === "quality_warning" ||
      lane.fatigueStatus === "quality_warning" ||
      lane.capacityStatus === "at_capacity",
  ).length;
  const candidateAvailableCount = lanes.filter(
    ({ lane }) => lane.cleanAlternatives.length > 0,
  ).length;
  const blockers = uniqueSorted(
    lanes.flatMap(({ week, slot, lane }) =>
      lane.setBudgetStatus === "blocked" ||
      lane.duplicateStatus === "blocked" ||
      lane.concentrationStatus === "blocked" ||
      lane.fatigueStatus === "blocked" ||
      lane.capacityStatus === "blocked"
        ? [`week_${week.week}:${slot.slotId}:${lane.laneId}:blocked`]
        : [],
    ),
  );
  const warnings = uniqueSorted([
    ...lanes.flatMap(({ week, slot, lane }) =>
      lane.identityStatus === "duplicate_requires_justification"
        ? [`week_${week.week}:${slot.slotId}:${lane.laneId}:duplicate_requires_justification`]
        : [],
    ),
    ...lanes.flatMap(({ week, slot, lane }) =>
      lane.concentrationStatus === "quality_warning"
        ? [`week_${week.week}:${slot.slotId}:${lane.laneId}:concentration_quality_warning`]
        : [],
    ),
    ...lanes.flatMap(({ week, slot, lane }) =>
      lane.inventoryStatus === "not_evaluated"
        ? [`week_${week.week}:${slot.slotId}:${lane.laneId}:inventory_not_evaluated`]
        : [],
    ),
  ]);
  const status: V2ExerciseSelectionPlanDiagnostic["status"] =
    blockedLaneCount > 0
      ? "blocked"
      : missingInputs.length > 0 || warningCount > 0
        ? "projected_with_limitations"
        : lanes.length > 0
          ? "selection_ready_but_not_consumed"
          : "diagnostic_only";

  return {
    version: 1,
    source: "v2_planner_policy",
    readOnly: true,
    affectsScoringOrGeneration: false,
    status,
    identityBasis: "week_1_selected_identities",
    projectionBasis:
      "planner_owned_accumulation_projection_plus_week_1_identity_continuity",
    summary: {
      weeksEvaluated: weeks.length,
      lanesEvaluated: lanes.length,
      preservedIdentityCount: lanes.filter(
        ({ lane }) => lane.identityStatus === "preserved",
      ).length,
      candidateAvailableCount,
      missingCandidateCount: lanes.filter(
        ({ lane }) => lane.identityStatus === "missing_candidate",
      ).length,
      classMismatchCount: lanes.filter(
        ({ lane }) => lane.laneClassStatus === "mismatch",
      ).length,
      duplicateRequiresJustificationCount: lanes.filter(
        ({ lane }) => lane.identityStatus === "duplicate_requires_justification",
      ).length,
      concentrationWarningCount: lanes.filter(
        ({ lane }) => lane.concentrationStatus === "quality_warning",
      ).length,
      blockedLaneCount,
    },
    weeks,
    blockers,
    warnings,
    missingInputs,
    safeForBehaviorPromotion: false,
  };
}
