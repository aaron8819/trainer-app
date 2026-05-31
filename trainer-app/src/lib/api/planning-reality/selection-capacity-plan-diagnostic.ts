import type {
  V2SelectionCapacityPlan,
  V2SetDistributionIntent,
} from "@/lib/engine/planning/v2";
import type { V2ExerciseSelectionPlanDiagnostic } from "./exercise-selection-plan-diagnostic";
import { classSatisfiesIntent } from "./selection-alignment";
import type { SlotCompositionSnapshotDiagnostic } from "./types";

type WeeklyMuscleTotalLike = {
  muscle: string;
  projectedEffectiveSets: number;
  targetMin: number | null;
  targetPreferred: number | null;
  status: "below" | "within" | "above" | "diagnostic";
};

type V2LaneDiffEvidence = {
  laneId: string;
  targetRole?: string;
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

type V2TargetVsNoRepairDiffLike = {
  slotDiffs: Array<{
    slotId: string;
    laneDiffs: V2LaneDiffEvidence[];
  }>;
};

export type V2CapacityLaneInspectionCategory =
  | "must_preserve"
  | "floor_critical"
  | "productive_support"
  | "optional_stretch"
  | "redundant_duplicate"
  | "high_fatigue_trim_candidate"
  | "unknown";

export type V2CapacityPolicyTrialGateId =
  | "hard_floors"
  | "over_mav"
  | "session_size"
  | "five_set_stacking"
  | "lane_survival"
  | "duplicates"
  | "materializer_validity"
  | "acceptance_result";

export type V2CapacityPolicyTrialGateStatus =
  | "requires_projection"
  | "unknown";

export type V2CapacityBehaviorProjectionGateStatus =
  | "pass"
  | "fail"
  | "unknown";

export type V2CapacityPolicyTrialDesign = {
  version: 1;
  source: "v2_selection_capacity_plan_diagnostic";
  readOnly: true;
  affectsScoringOrGeneration: false;
  consumedByDemandOrMaterializer: false;
  status: "design_only" | "not_available";
  trialId: string | null;
  scope: "read_only_projection_only";
  candidateChange: {
    kind: "slot_max_exercise_count_delta";
    slotId: string;
    delta: 1;
    reason: string;
  } | null;
  targetSlots: string[];
  basis: {
    targetSlotId: string | null;
    targetSlotWeek: number | null;
    targetSlotExerciseCount: number | null;
    targetSlotMaxExerciseCount: number | null;
    targetSlotSetCount: number | null;
    targetSlotMaxSets: number | null;
    targetSlotFloorCriticalLaneCount: number;
    targetSlotCapacityPressureLaneCount: number;
    targetSlotMustPreserveLaneCount: number;
    targetSlotProductiveSupportLaneCount: number;
    totalFloorCriticalLaneCount: number;
    totalCapacityPressureLaneCount: number;
    totalOptionalStretchLaneCount: number;
    totalHighFatigueTrimCandidateLaneCount: number;
    totalRedundantDuplicateLaneCount: number;
  };
  gates: Array<{
    gateId: V2CapacityPolicyTrialGateId;
    status: V2CapacityPolicyTrialGateStatus;
    ownerSeam: string;
    requiredEvidence: string[];
    currentEvidence: string[];
    failureMeaning: string;
  }>;
  blockersBeforeBehavior: string[];
  nextSafeAction:
    | "run_read_only_capacity_behavior_projection"
    | "inspect_capacity_rows";
  limitations: string[];
  safeForBehaviorPromotion: false;
};

export type V2CapacityBehaviorProjection = {
  version: 1;
  source: "v2_selection_capacity_plan_diagnostic";
  readOnly: true;
  affectsScoringOrGeneration: false;
  consumedByDemandOrMaterializer: false;
  status: "projected_with_limitations" | "not_available";
  projectionMode: "slot_cap_delta_existing_evidence_only";
  trialId: string | null;
  candidateImpact: {
    selectedIdentityDelta: 0;
    weeklyVolumeDelta: 0;
    capacityPressureRowsBefore: number;
    capacityPressureRowsAfter: number;
    capacityPressureRowsRelieved: number;
    floorCriticalRowsBefore: number;
    floorCriticalRowsAfter: number;
    optionalStretchRowsActivated: 0;
    regressionCount: number;
    regressions: string[];
    improvements: string[];
  };
  projectedSlots: Array<{
    week: number;
    slotId: string;
    exerciseCount: number;
    maxExerciseCountBefore: number;
    maxExerciseCountAfter: number;
    slotHeadroomBefore: number;
    slotHeadroomAfter: number;
    setCount: number;
    targetSessionMaxSets: number;
    setHeadroom: number;
    capacityPressureRowsBefore: number;
    capacityPressureRowsAfter: number;
    floorCriticalRowsBefore: number;
    floorCriticalRowsAfter: number;
    mustPreserveRows: number;
    productiveSupportRows: number;
    sessionSizeStatus: "within_limits" | "over_exercise_limit" | "over_set_limit";
  }>;
  gates: Array<{
    gateId: V2CapacityPolicyTrialGateId;
    status: V2CapacityBehaviorProjectionGateStatus;
    measured: boolean;
    ownerSeam: string;
    evidence: string[];
    regressions: string[];
    requiredNextEvidence: string[];
  }>;
  blockersBeforeBehavior: string[];
  nextSafeAction:
    | "run_read_only_materializer_capacity_projection"
    | "inspect_capacity_rows";
  limitations: string[];
  safeForBehaviorPromotion: false;
};

export type V2SelectionCapacityPlanDiagnostic = {
  version: 1;
  source: "v2_planner_policy";
  readOnly: true;
  affectsScoringOrGeneration: false;
  status: "diagnostic_only" | "projected_with_limitations" | "blocked";
  summary: {
    weeksEvaluated: number;
    slotsEvaluated: number;
    lanesEvaluated: number;
    targetMetNoActionCount: number;
    capacityPressureCount: number;
    capAwareExpansionNeededCount: number;
    optionalSuppressedCount: number;
    blockerCount: number;
    laneInspectionCategoryCounts: Record<V2CapacityLaneInspectionCategory, number>;
  };
  weeks: Array<{
    week: number;
    slots: Array<{
      slotId: string;
      exerciseCount: number;
      maxExerciseCount: number;
      setCount: number;
      targetSessionSets: { min: number; preferred: number; max: number };
      lanes: Array<{
        laneId: string;
        classification:
          | "target_met_no_action"
          | "capacity_pressure"
          | "cap_aware_expansion_needed"
          | "optional_suppressed"
          | "blocker"
          | "not_evaluated";
        inspectionCategory: V2CapacityLaneInspectionCategory;
        selectedExercise?: string;
        selectedSets?: number;
        setBudget: { min: number; preferred: number; max: number };
        perExerciseCap: number | null;
        weeklyTargetStatus: "below" | "within" | "above" | "unknown";
        slotHeadroom: number;
        setHeadroom: number;
        cleanAlternativeCount: number | null;
        optionalEligibility:
          | "eligible"
          | "suppressed"
          | "not_applicable"
          | "not_evaluated";
        evidence: string[];
        limitations: string[];
      }>;
    }>;
  }>;
  blockers: string[];
  warnings: string[];
  missingInputs: string[];
  capacityPolicyTrialDesign: V2CapacityPolicyTrialDesign;
  capacityBehaviorProjection: V2CapacityBehaviorProjection;
  safeForBehaviorPromotion: false;
};

type BuilderInput = {
  v2SetDistributionIntent: V2SetDistributionIntent;
  selectionCapacityPlan: V2SelectionCapacityPlan;
  v2ExerciseSelectionPlanDiagnostic: V2ExerciseSelectionPlanDiagnostic;
  v2TargetVsNoRepairDiff: V2TargetVsNoRepairDiffLike;
  week1SelectedIdentities: ReadonlyArray<SlotCompositionSnapshotDiagnostic>;
  weeklyMuscleTotals: ReadonlyArray<WeeklyMuscleTotalLike>;
};

type SelectionLane =
  V2ExerciseSelectionPlanDiagnostic["weeks"][number]["slots"][number]["lanes"][number];
type IntentSlot = V2SetDistributionIntent["weeks"][number]["slots"][number];
type IntentLane = IntentSlot["lanes"][number];
type CapacitySlot =
  V2SelectionCapacityPlan["weeks"][number]["slots"][number];
type CapacityDiagnosticLane =
  V2SelectionCapacityPlanDiagnostic["weeks"][number]["slots"][number]["lanes"][number];
type CapacityLaneInspectionRow = {
  week: number;
  slotId: string;
  exerciseCount: number;
  maxExerciseCount: number;
  setCount: number;
  targetSessionSets: { min: number; preferred: number; max: number };
  lane: CapacityDiagnosticLane;
};

const MAX_SLOT_EXERCISES = 6;

function uniqueSorted(values: ReadonlyArray<string>): string[] {
  return Array.from(new Set(values.filter((value) => value.length > 0))).sort(
    (left, right) => left.localeCompare(right),
  );
}

function laneKey(slotId: string, laneId: string): string {
  return `${slotId}:${laneId}`;
}

function buildLaneDiffIndex(
  diff: V2TargetVsNoRepairDiffLike,
): Map<string, V2LaneDiffEvidence> {
  const index = new Map<string, V2LaneDiffEvidence>();
  for (const slot of diff.slotDiffs) {
    for (const lane of slot.laneDiffs) {
      index.set(laneKey(slot.slotId, lane.laneId), lane);
    }
  }
  return index;
}

function buildSelectionLaneIndex(
  diagnostic: V2ExerciseSelectionPlanDiagnostic,
): Map<string, SelectionLane> {
  const index = new Map<string, SelectionLane>();
  for (const week of diagnostic.weeks) {
    for (const slot of week.slots) {
      for (const lane of slot.lanes) {
        index.set(`${week.week}:${laneKey(slot.slotId, lane.laneId)}`, lane);
      }
    }
  }
  return index;
}

function buildCapacitySlotIndex(
  plan: V2SelectionCapacityPlan,
): Map<string, CapacitySlot> {
  const index = new Map<string, CapacitySlot>();
  for (const week of plan.weeks) {
    for (const slot of week.slots) {
      index.set(`${week.week}:${slot.slotId}`, slot);
    }
  }
  return index;
}

function weeklyTargetStatus(input: {
  primaryMuscles: ReadonlyArray<string>;
  weeklyTotals: ReadonlyMap<string, WeeklyMuscleTotalLike>;
}): V2SelectionCapacityPlanDiagnostic["weeks"][number]["slots"][number]["lanes"][number]["weeklyTargetStatus"] {
  const rows = input.primaryMuscles
    .map((muscle) => input.weeklyTotals.get(muscle))
    .filter((row): row is WeeklyMuscleTotalLike => Boolean(row));
  if (rows.length === 0 || rows.some((row) => row.status === "diagnostic")) {
    return "unknown";
  }
  if (rows.some((row) => row.status === "below")) {
    return "below";
  }
  if (rows.every((row) => row.status === "above")) {
    return "above";
  }
  return "within";
}

function classSatisfiesCapacityIntent(input: {
  exerciseClass: string;
  plannedClasses: ReadonlyArray<string>;
  laneId: string;
}): boolean {
  const aliases: Record<string, string[]> = {
    chest_supported_row: ["row", "horizontal_pull", "cable_row"],
    cable_row: ["row", "horizontal_pull"],
    t_bar_row: ["row", "horizontal_pull"],
    horizontal_pull_support: ["row", "horizontal_pull", "cable_row"],
    vertical_pull: ["vertical_pull"],
    calf_isolation: ["calf_raise"],
    hamstring_curl: ["knee_flexion_curl", "leg_curl"],
    biceps_isolation: ["biceps_curl"],
    triceps_isolation: ["triceps_isolation", "pressdown"],
    pressdown: ["triceps_isolation", "pressdown"],
    fly: ["chest_isolation", "cable_fly", "chest_fly"],
    horizontal_press: ["chest_press"],
    lateral_raise: ["low_collateral_side_delt"],
  };
  return input.plannedClasses.some(
    (planned) =>
      classSatisfiesIntent(input.exerciseClass, planned) ||
      input.exerciseClass === planned ||
      (aliases[planned] ?? []).includes(input.exerciseClass) ||
      (input.laneId === "row_anchor" && input.exerciseClass === "row") ||
      (input.laneId === "vertical_pull_anchor" &&
        input.exerciseClass === "vertical_pull"),
  );
}

function selectedEvidence(input: {
  lane: IntentLane;
  selectionLane: SelectionLane | undefined;
  laneDiff: V2LaneDiffEvidence | undefined;
}): { exerciseName?: string; sets: number } {
  const diffSelected = input.laneDiff?.currentEvidence.selectedExercises.find(
    (exercise) =>
      exercise.matchedClass != null &&
      classSatisfiesCapacityIntent({
        exerciseClass: exercise.matchedClass,
        plannedClasses: input.lane.preferredExerciseClasses,
        laneId: input.lane.laneId,
      }),
  );
  if (diffSelected) {
    return { exerciseName: diffSelected.name, sets: diffSelected.sets };
  }
  const selected = input.selectionLane?.selectedIdentity;
  if (selected) {
    return { exerciseName: selected.exerciseName, sets: selected.setCount };
  }
  const fallbackDiffSelected = input.laneDiff?.currentEvidence.selectedExercises[0];
  return {
    exerciseName: fallbackDiffSelected?.name,
    sets: fallbackDiffSelected?.sets ?? 0,
  };
}

function cleanAlternativeCount(
  selectionLane: SelectionLane | undefined,
): number | null {
  if (!selectionLane || selectionLane.inventoryStatus === "not_evaluated") {
    return null;
  }
  return selectionLane.cleanAlternatives.length;
}

function selectedSetsInRange(input: {
  selectedSets: number;
  lane: IntentLane;
  selectionLane: SelectionLane | undefined;
}): boolean {
  return (
    input.selectionLane?.setBudgetStatus === "within_budget" ||
    input.selectionLane?.setBudgetStatus === "allowed_expansion" ||
    (input.selectedSets >= input.lane.setBudget.min &&
      input.selectedSets <= input.lane.setBudget.max)
  );
}

function hasCapacityPressureEvidence(input: {
  laneDiff: V2LaneDiffEvidence | undefined;
  selectionLane: SelectionLane | undefined;
}): boolean {
  const diagnostics =
    input.laneDiff?.currentEvidence.relevantDiagnostics.join("|").toLowerCase() ??
    "";
  return (
    input.laneDiff?.gapCause === "selection_feasibility_pressure" ||
    input.selectionLane?.capacityStatus === "at_capacity" ||
    diagnostics.includes("capacitypressure:") ||
    diagnostics.includes("selectionfeasibility:session_capacity_pressure") ||
    diagnostics.includes("slot_capacity")
  );
}

function hasCapAwareExpansion(input: {
  week: number;
  lane: IntentLane;
  week1SelectedSets: number;
  weeklyStatus: "below" | "within" | "above" | "unknown";
  laneDiff: V2LaneDiffEvidence | undefined;
}): boolean {
  const diagnostics =
    input.laneDiff?.currentEvidence.relevantDiagnostics.join("|").toLowerCase() ??
    "";
  return Boolean(
    input.week >= 2 &&
      input.week <= 4 &&
      input.week1SelectedSets >= input.lane.setBudget.min &&
      (input.weeklyStatus === "within" || input.weeklyStatus === "above") &&
      input.lane.setBudget.preferred >
        input.lane.capPolicy.maxSetsPerExerciseWithoutJustification &&
      input.lane.capPolicy.maxDirectExercises <= 1 &&
      (input.lane.laneId === "calves" ||
        input.laneDiff?.gapCause === "cap_aware_expansion_limitation" ||
        diagnostics.includes("capawareexpansion:preferred_exceeds_single_exercise_cap")),
  );
}

function optionalEligibility(input: {
  lane: IntentLane;
  classification:
    V2SelectionCapacityPlanDiagnostic["weeks"][number]["slots"][number]["lanes"][number]["classification"];
  weeklyStatus: "below" | "within" | "above" | "unknown";
  slotHeadroom: number;
  cleanAlternativeCount: number | null;
}): V2SelectionCapacityPlanDiagnostic["weeks"][number]["slots"][number]["lanes"][number]["optionalEligibility"] {
  if (input.lane.role !== "optional") {
    return "not_applicable";
  }
  if (input.classification === "optional_suppressed") {
    return "suppressed";
  }
  if (input.weeklyStatus === "unknown") {
    return "not_evaluated";
  }
  return input.weeklyStatus === "below" &&
    input.slotHeadroom > 0 &&
    (input.cleanAlternativeCount ?? 1) > 0
    ? "eligible"
    : "suppressed";
}

function classifyLane(input: {
  week: number;
  slotAtCapacity: boolean;
  slotHeadroom: number;
  lane: IntentLane;
  selectionLane: SelectionLane | undefined;
  laneDiff: V2LaneDiffEvidence | undefined;
  selectedSets: number;
  week1SelectedSets: number;
  weeklyStatus: "below" | "within" | "above" | "unknown";
  cleanAlternativeCount: number | null;
}): V2SelectionCapacityPlanDiagnostic["weeks"][number]["slots"][number]["lanes"][number]["classification"] {
  const targetMet =
    input.weeklyStatus === "within" || input.weeklyStatus === "above";
  const inRange = selectedSetsInRange(input);
  const noCleanHeadroom =
    input.slotAtCapacity &&
    (input.cleanAlternativeCount == null || input.cleanAlternativeCount === 0);
  if (
    input.lane.role === "optional" &&
    (targetMet || input.slotHeadroom <= 0 || input.cleanAlternativeCount === 0)
  ) {
    return "optional_suppressed";
  }
  if (input.weeklyStatus === "below" && input.selectedSets < input.lane.setBudget.min) {
    return "blocker";
  }
  if (hasCapAwareExpansion(input)) {
    return "cap_aware_expansion_needed";
  }
  if (
    inRange &&
    targetMet &&
    noCleanHeadroom &&
    input.selectionLane?.concentrationStatus !== "blocked" &&
    hasCapacityPressureEvidence(input)
  ) {
    return "capacity_pressure";
  }
  if (inRange && targetMet) {
    return "target_met_no_action";
  }
  return input.selectionLane || input.laneDiff ? "not_evaluated" : "not_evaluated";
}

function classifyInspectionCategory(input: {
  lane: IntentLane;
  classification:
    V2SelectionCapacityPlanDiagnostic["weeks"][number]["slots"][number]["lanes"][number]["classification"];
  weeklyStatus: "below" | "within" | "above" | "unknown";
  selectedSets: number;
  laneDiff: V2LaneDiffEvidence | undefined;
  selectionLane: SelectionLane | undefined;
}): V2CapacityLaneInspectionCategory {
  const evidence = [
    input.laneDiff?.gapCause ?? "",
    input.laneDiff?.migrationRecommendation ?? "",
    input.selectionLane?.concentrationStatus ?? "",
    input.selectionLane?.fatigueStatus ?? "",
    ...(input.laneDiff?.currentEvidence.relevantDiagnostics ?? []),
    ...(input.selectionLane?.evidenceRefs ?? []),
    ...(input.selectionLane?.limitations ?? []),
  ]
    .join("|")
    .toLowerCase();
  const duplicateEvidence = [
    input.laneDiff?.gapCause ?? "",
    input.selectionLane?.duplicateStatus ?? "",
    ...(input.laneDiff?.currentEvidence.relevantDiagnostics ?? []),
    ...(input.selectionLane?.evidenceRefs ?? []),
  ]
    .join("|")
    .toLowerCase();

  if (
    input.classification === "blocker" ||
    (input.weeklyStatus === "below" &&
      input.selectedSets < input.lane.setBudget.min)
  ) {
    return "floor_critical";
  }
  if (
    input.classification === "optional_suppressed" ||
    input.lane.role === "optional"
  ) {
    return "optional_stretch";
  }
  if (
    input.laneDiff?.gapCause === "duplicate_policy_gap" ||
    input.selectionLane?.duplicateStatus === "blocked" ||
    duplicateEvidence.includes("duplicate_policy") ||
    duplicateEvidence.includes("duplicate_exposure") ||
    duplicateEvidence.includes("duplicate_requires")
  ) {
    return "redundant_duplicate";
  }
  if (
    input.selectedSets > 0 &&
    (input.weeklyStatus === "above" ||
      evidence.includes("fatigue") ||
      evidence.includes("concentration:blocked") ||
      evidence.includes("high_concentration") ||
      evidence.includes("gt_5_sets"))
  ) {
    return "high_fatigue_trim_candidate";
  }
  if (
    input.lane.role === "anchor" &&
    input.selectedSets >= input.lane.setBudget.min
  ) {
    return "must_preserve";
  }
  if (
    (input.lane.role === "support" || input.lane.role === "accessory") &&
    input.selectedSets > 0
  ) {
    return "productive_support";
  }
  return "unknown";
}

function buildLane(input: {
  week: number;
  slotId: string;
  slot: IntentSlot;
  lane: IntentLane;
  maxExerciseCount: number;
  slotEvidence: SlotCompositionSnapshotDiagnostic | undefined;
  selectionLane: SelectionLane | undefined;
  laneDiff: V2LaneDiffEvidence | undefined;
  weeklyTotals: ReadonlyMap<string, WeeklyMuscleTotalLike>;
  week1SelectedSets: number;
}): V2SelectionCapacityPlanDiagnostic["weeks"][number]["slots"][number]["lanes"][number] {
  const selected = selectedEvidence({
    lane: input.lane,
    selectionLane: input.selectionLane,
    laneDiff: input.laneDiff,
  });
  const exerciseCount = input.slotEvidence?.exerciseCount ?? 0;
  const slotHeadroom = input.maxExerciseCount - exerciseCount;
  const setCount = input.slotEvidence?.totalSets ?? 0;
  const setHeadroom = input.slot.targetSessionSets.max - setCount;
  const perExerciseCap =
    input.lane.capPolicy.maxSetsPerExerciseWithoutJustification ?? null;
  const cleanCount = cleanAlternativeCount(input.selectionLane);
  const weeklyStatus = weeklyTargetStatus({
    primaryMuscles: input.lane.primaryMuscles,
    weeklyTotals: input.weeklyTotals,
  });
  const classification = classifyLane({
    week: input.week,
    slotAtCapacity: exerciseCount >= input.maxExerciseCount,
    slotHeadroom,
    lane: input.lane,
    selectionLane: input.selectionLane,
    laneDiff: input.laneDiff,
    selectedSets: selected.sets,
    week1SelectedSets: input.week1SelectedSets,
    weeklyStatus,
    cleanAlternativeCount: cleanCount,
  });
  const capHeadroom =
    perExerciseCap == null ? null : perExerciseCap - selected.sets;
  const inspectionCategory = classifyInspectionCategory({
    lane: input.lane,
    classification,
    weeklyStatus,
    selectedSets: selected.sets,
    laneDiff: input.laneDiff,
    selectionLane: input.selectionLane,
  });

  return {
    laneId: input.lane.laneId,
    classification,
    inspectionCategory,
    ...(selected.exerciseName ? { selectedExercise: selected.exerciseName } : {}),
    ...(selected.sets > 0 ? { selectedSets: selected.sets } : {}),
    setBudget: {
      min: input.lane.setBudget.min,
      preferred: input.lane.setBudget.preferred,
      max: input.lane.setBudget.max,
    },
    perExerciseCap,
    weeklyTargetStatus: weeklyStatus,
    slotHeadroom,
    setHeadroom,
    cleanAlternativeCount: cleanCount,
    optionalEligibility: optionalEligibility({
      lane: input.lane,
      classification,
      weeklyStatus,
      slotHeadroom,
      cleanAlternativeCount: cleanCount,
    }),
    evidence: uniqueSorted([
      ...(input.laneDiff?.currentEvidence.relevantDiagnostics ?? []),
      ...(input.selectionLane?.evidenceRefs ?? []),
      `slotExerciseCount:${exerciseCount}`,
      `maxSlotExerciseCapacity:${input.maxExerciseCount}`,
      `targetSessionSets:${input.slot.targetSessionSets.min}-${input.slot.targetSessionSets.preferred}-${input.slot.targetSessionSets.max}`,
      ...(capHeadroom != null ? [`perExerciseCapHeadroom:${capHeadroom}`] : []),
      `weeklyTargetStatus:${weeklyStatus}`,
      `classification:${classification}`,
      `inspectionCategory:${inspectionCategory}`,
    ]),
    limitations: uniqueSorted([
      ...(input.selectionLane?.limitations ?? []),
      "diagnostic_only_not_selection_input",
      ...(classification === "capacity_pressure"
        ? ["slot_at_exercise_capacity_no_clean_additional_headroom"]
        : []),
      ...(classification === "cap_aware_expansion_needed"
        ? ["preferred_budget_exceeds_single_exercise_cap_without_second_direct_exercise_rule"]
        : []),
      ...(classification === "optional_suppressed"
        ? ["optional_lane_not_activated_by_capacity_plan"]
        : []),
      ...(inspectionCategory === "unknown"
        ? ["capacity_inspection_category_requires_more_evidence"]
        : []),
    ]),
  };
}

function countInspectionCategories(
  lanes: ReadonlyArray<{
    lane: CapacityDiagnosticLane;
  }>,
): Record<V2CapacityLaneInspectionCategory, number> {
  const counts: Record<V2CapacityLaneInspectionCategory, number> = {
    must_preserve: 0,
    floor_critical: 0,
    productive_support: 0,
    optional_stretch: 0,
    redundant_duplicate: 0,
    high_fatigue_trim_candidate: 0,
    unknown: 0,
  };
  for (const { lane } of lanes) {
    counts[lane.inspectionCategory] += 1;
  }
  return counts;
}

function countRows(
  lanes: ReadonlyArray<CapacityLaneInspectionRow>,
  predicate: (row: CapacityLaneInspectionRow) => boolean,
): number {
  return lanes.filter(predicate).length;
}

function buildCapacityTrialGates(input: {
  target: CapacityLaneInspectionRow | null;
  targetRows: ReadonlyArray<CapacityLaneInspectionRow>;
  allRows: ReadonlyArray<CapacityLaneInspectionRow>;
}): V2CapacityPolicyTrialDesign["gates"] {
  const target = input.target;
  const targetEvidence = target
    ? [
        `targetSlot:${target.slotId}`,
        `week:${target.week}`,
        `exerciseCount:${target.exerciseCount}`,
        `maxExerciseCount:${target.maxExerciseCount}`,
        `setCount:${target.setCount}`,
        `maxSets:${target.targetSessionSets.max}`,
      ]
    : ["target_slot:not_available"];

  return [
    {
      gateId: "hard_floors",
      status: "requires_projection",
      ownerSeam: "candidate_evaluator",
      requiredEvidence: [
        "projected weekly floor status for every A-primary and protected support muscle",
        "no new below-minimum lane after capacity delta",
      ],
      currentEvidence: [
        `floorCriticalLaneCount:${countRows(
          input.allRows,
          (row) => row.lane.inspectionCategory === "floor_critical",
        )}`,
        `targetSlotFloorCriticalLaneCount:${countRows(
          input.targetRows,
          (row) => row.lane.inspectionCategory === "floor_critical",
        )}`,
      ],
      failureMeaning: "capacity change would trade away trainability floors",
    },
    {
      gateId: "over_mav",
      status: "requires_projection",
      ownerSeam: "candidate_evaluator",
      requiredEvidence: [
        "projected weekly volume deltas against MAV/cap bands",
        "no net new over-MAV muscle caused by the trial",
      ],
      currentEvidence: [
        `highFatigueTrimCandidateLaneCount:${countRows(
          input.allRows,
          (row) => row.lane.inspectionCategory === "high_fatigue_trim_candidate",
        )}`,
      ],
      failureMeaning: "capacity change would create or worsen recovery risk",
    },
    {
      gateId: "session_size",
      status: "requires_projection",
      ownerSeam: "selection_capacity_plan",
      requiredEvidence: [
        "projected slot exercise count after the +1 cap",
        "projected slot set count within target session set max",
      ],
      currentEvidence: targetEvidence,
      failureMeaning: "capacity change would produce an oversized session",
    },
    {
      gateId: "five_set_stacking",
      status: "requires_projection",
      ownerSeam: "set_distribution_intent",
      requiredEvidence: [
        "projected per-exercise set counts",
        "no new accessory above cap and no unjustified 5-set stacking",
      ],
      currentEvidence: [
        `targetSlotSelectedFiveSetLaneCount:${countRows(
          input.targetRows,
          (row) => (row.lane.selectedSets ?? 0) >= 5,
        )}`,
      ],
      failureMeaning: "capacity change would hide pressure by stacking too many sets",
    },
    {
      gateId: "lane_survival",
      status: "requires_projection",
      ownerSeam: "materializer_exercise_selection_capacity",
      requiredEvidence: [
        "all must-preserve lanes still selected",
        "productive support lanes do not disappear unless explicitly traded off",
      ],
      currentEvidence: [
        `targetSlotMustPreserveLaneCount:${countRows(
          input.targetRows,
          (row) => row.lane.inspectionCategory === "must_preserve",
        )}`,
        `targetSlotProductiveSupportLaneCount:${countRows(
          input.targetRows,
          (row) => row.lane.inspectionCategory === "productive_support",
        )}`,
      ],
      failureMeaning: "capacity change would improve one lane by sacrificing useful work",
    },
    {
      gateId: "duplicates",
      status: "requires_projection",
      ownerSeam: "exercise_selection_plan",
      requiredEvidence: [
        "projected duplicate identity and class-distinctness deltas",
        "no new unjustified duplicate continuity conflict",
      ],
      currentEvidence: [
        `redundantDuplicateLaneCount:${countRows(
          input.allRows,
          (row) => row.lane.inspectionCategory === "redundant_duplicate",
        )}`,
      ],
      failureMeaning: "capacity change would add redundant or unjustified identities",
    },
    {
      gateId: "materializer_validity",
      status: "requires_projection",
      ownerSeam: "v2_materialization_dry_run",
      requiredEvidence: [
        "dry-run materializer emits a seed-shaped candidate",
        "no required materializer blocker or seed-shape incompatibility",
      ],
      currentEvidence: ["materializer_projection:not_run"],
      failureMeaning: "capacity design cannot be translated into a valid candidate",
    },
    {
      gateId: "acceptance_result",
      status: "requires_projection",
      ownerSeam: "next_mesocycle_acceptance_gate",
      requiredEvidence: [
        "candidate evaluator rerun on projected candidate",
        "acceptance gate remains accepted or accepted_with_watch_items",
      ],
      currentEvidence: ["acceptance_gate:not_rerun"],
      failureMeaning: "capacity design would degrade the trainable V2 candidate",
    },
  ];
}

function buildCapacityPolicyTrialDesign(
  rows: ReadonlyArray<CapacityLaneInspectionRow>,
): V2CapacityPolicyTrialDesign {
  const candidateSlots = Array.from(
    rows
      .filter(
        (row) =>
          row.week === 1 &&
          row.lane.slotHeadroom <= 0 &&
          (row.lane.classification === "capacity_pressure" ||
            row.lane.inspectionCategory === "floor_critical"),
      )
      .reduce<Map<string, CapacityLaneInspectionRow[]>>((index, row) => {
        index.set(row.slotId, [...(index.get(row.slotId) ?? []), row]);
        return index;
      }, new Map())
      .entries(),
  )
    .map(([slotId, slotRows]) => {
      const first = slotRows[0] ?? null;
      return {
        slotId,
        representative: first,
        rows: slotRows,
        score:
          countRows(slotRows, (row) => row.lane.inspectionCategory === "floor_critical") *
            3 +
          countRows(slotRows, (row) => row.lane.classification === "capacity_pressure") *
            2 +
          countRows(slotRows, (row) => row.lane.inspectionCategory === "must_preserve") +
          countRows(
            slotRows,
            (row) => row.lane.inspectionCategory === "productive_support",
          ),
      };
    })
    .filter(
      (
        slot,
      ): slot is {
        slotId: string;
        representative: CapacityLaneInspectionRow;
        rows: CapacityLaneInspectionRow[];
        score: number;
      } => Boolean(slot.representative),
    )
    .sort(
      (left, right) =>
        right.score - left.score || left.slotId.localeCompare(right.slotId),
    );
  const selectedSlot = candidateSlots[0] ?? null;
  const target = selectedSlot?.representative ?? null;
  const targetRows = selectedSlot?.rows ?? [];
  const status = selectedSlot ? "design_only" : "not_available";
  const counts = countInspectionCategories(rows);

  return {
    version: 1,
    source: "v2_selection_capacity_plan_diagnostic",
    readOnly: true,
    affectsScoringOrGeneration: false,
    consumedByDemandOrMaterializer: false,
    status,
    trialId: selectedSlot
      ? `${selectedSlot.slotId}_max_exercise_count_plus_one_projection_only`
      : null,
    scope: "read_only_projection_only",
    candidateChange: selectedSlot
      ? {
          kind: "slot_max_exercise_count_delta",
          slotId: selectedSlot.slotId,
          delta: 1,
          reason: "zero_headroom_capacity_pressure_or_floor_critical_lanes",
        }
      : null,
    targetSlots: selectedSlot ? [selectedSlot.slotId] : [],
    basis: {
      targetSlotId: target?.slotId ?? null,
      targetSlotWeek: target?.week ?? null,
      targetSlotExerciseCount: target?.exerciseCount ?? null,
      targetSlotMaxExerciseCount: target?.maxExerciseCount ?? null,
      targetSlotSetCount: target?.setCount ?? null,
      targetSlotMaxSets: target?.targetSessionSets.max ?? null,
      targetSlotFloorCriticalLaneCount: countRows(
        targetRows,
        (row) => row.lane.inspectionCategory === "floor_critical",
      ),
      targetSlotCapacityPressureLaneCount: countRows(
        targetRows,
        (row) => row.lane.classification === "capacity_pressure",
      ),
      targetSlotMustPreserveLaneCount: countRows(
        targetRows,
        (row) => row.lane.inspectionCategory === "must_preserve",
      ),
      targetSlotProductiveSupportLaneCount: countRows(
        targetRows,
        (row) => row.lane.inspectionCategory === "productive_support",
      ),
      totalFloorCriticalLaneCount: counts.floor_critical,
      totalCapacityPressureLaneCount: countRows(
        rows,
        (row) => row.lane.classification === "capacity_pressure",
      ),
      totalOptionalStretchLaneCount: counts.optional_stretch,
      totalHighFatigueTrimCandidateLaneCount: counts.high_fatigue_trim_candidate,
      totalRedundantDuplicateLaneCount: counts.redundant_duplicate,
    },
    gates: buildCapacityTrialGates({ target, targetRows, allRows: rows }),
    blockersBeforeBehavior: selectedSlot
      ? [
          "read_only_capacity_projection_not_run",
          "materializer_validity_not_measured",
          "acceptance_gate_not_rerun",
          "candidate_impact_not_measured",
        ]
      : ["no_zero_headroom_capacity_trial_slot_identified"],
    nextSafeAction: selectedSlot
      ? "run_read_only_capacity_behavior_projection"
      : "inspect_capacity_rows",
    limitations: [
      "design_only_not_a_simulation",
      "does_not_change_selection_capacity_plan",
      "does_not_feed_materializer_ranking",
      "does_not_feed_acceptance_scoring",
      "does_not_change_seed_or_runtime_replay",
    ],
    safeForBehaviorPromotion: false,
  };
}

function buildProjectedSlotDeltas(input: {
  rows: ReadonlyArray<CapacityLaneInspectionRow>;
  targetSlotId: string;
  delta: 1;
}): V2CapacityBehaviorProjection["projectedSlots"] {
  return Array.from(
    input.rows
      .filter((row) => row.slotId === input.targetSlotId)
      .reduce<Map<number, CapacityLaneInspectionRow[]>>((index, row) => {
        index.set(row.week, [...(index.get(row.week) ?? []), row]);
        return index;
      }, new Map())
      .entries(),
  )
    .sort(([leftWeek], [rightWeek]) => leftWeek - rightWeek)
    .map(([week, weekRows]) => {
      const first = weekRows[0];
      if (!first) {
        throw new Error("expected grouped capacity rows to include a first row");
      }
      const maxExerciseCountAfter = first.maxExerciseCount + input.delta;
      const slotHeadroomAfter = maxExerciseCountAfter - first.exerciseCount;
      const capacityPressureRowsBefore = countRows(
        weekRows,
        (row) => row.lane.classification === "capacity_pressure",
      );
      const capacityPressureRowsAfter =
        slotHeadroomAfter > 0 ? 0 : capacityPressureRowsBefore;
      const floorCriticalRows = countRows(
        weekRows,
        (row) => row.lane.inspectionCategory === "floor_critical",
      );
      const sessionSizeStatus =
        first.exerciseCount > maxExerciseCountAfter
          ? "over_exercise_limit"
          : first.setCount > first.targetSessionSets.max
            ? "over_set_limit"
            : "within_limits";

      return {
        week,
        slotId: input.targetSlotId,
        exerciseCount: first.exerciseCount,
        maxExerciseCountBefore: first.maxExerciseCount,
        maxExerciseCountAfter,
        slotHeadroomBefore: first.maxExerciseCount - first.exerciseCount,
        slotHeadroomAfter,
        setCount: first.setCount,
        targetSessionMaxSets: first.targetSessionSets.max,
        setHeadroom: first.targetSessionSets.max - first.setCount,
        capacityPressureRowsBefore,
        capacityPressureRowsAfter,
        floorCriticalRowsBefore: floorCriticalRows,
        floorCriticalRowsAfter: floorCriticalRows,
        mustPreserveRows: countRows(
          weekRows,
          (row) => row.lane.inspectionCategory === "must_preserve",
        ),
        productiveSupportRows: countRows(
          weekRows,
          (row) => row.lane.inspectionCategory === "productive_support",
        ),
        sessionSizeStatus,
      };
    });
}

function buildProjectionGate(input: {
  gateId: V2CapacityPolicyTrialGateId;
  projectedSlots: ReadonlyArray<V2CapacityBehaviorProjection["projectedSlots"][number]>;
  capacityPressureRowsRelieved: number;
  floorCriticalRowsAfter: number;
}): V2CapacityBehaviorProjection["gates"][number] {
  switch (input.gateId) {
    case "hard_floors":
      return {
        gateId: "hard_floors",
        status: input.floorCriticalRowsAfter > 0 ? "unknown" : "pass",
        measured: input.floorCriticalRowsAfter === 0,
        ownerSeam: "candidate_evaluator",
        evidence: [`floorCriticalRowsAfter:${input.floorCriticalRowsAfter}`],
        regressions: [],
        requiredNextEvidence:
          input.floorCriticalRowsAfter > 0
            ? ["materializer_projection_must_show_floor_critical_lanes_resolved"]
            : [],
      };
    case "over_mav":
      return {
        gateId: "over_mav",
        status: "pass",
        measured: true,
        ownerSeam: "candidate_evaluator",
        evidence: ["weeklyVolumeDelta:0", "no_new_over_mav_from_cap_delta_only"],
        regressions: [],
        requiredNextEvidence: [],
      };
    case "session_size": {
      const regressions = input.projectedSlots
        .filter((slot) => slot.sessionSizeStatus !== "within_limits")
        .map(
          (slot) =>
            `week_${slot.week}:${slot.slotId}:${slot.sessionSizeStatus}:sets_${slot.setCount}_max_${slot.targetSessionMaxSets}`,
        );
      return {
        gateId: "session_size",
        status: regressions.length > 0 ? "fail" : "pass",
        measured: true,
        ownerSeam: "selection_capacity_plan",
        evidence: input.projectedSlots.map(
          (slot) =>
            `week_${slot.week}:exercise_${slot.exerciseCount}/${slot.maxExerciseCountAfter}:sets_${slot.setCount}/${slot.targetSessionMaxSets}`,
        ),
        regressions,
        requiredNextEvidence: [],
      };
    }
    case "five_set_stacking":
      return {
        gateId: "five_set_stacking",
        status: "pass",
        measured: true,
        ownerSeam: "set_distribution_intent",
        evidence: ["selectedIdentityDelta:0", "weeklyVolumeDelta:0"],
        regressions: [],
        requiredNextEvidence: [],
      };
    case "lane_survival":
      return {
        gateId: "lane_survival",
        status: "pass",
        measured: true,
        ownerSeam: "materializer_exercise_selection_capacity",
        evidence: ["selectedIdentityDelta:0", "no_existing_lane_removed"],
        regressions: [],
        requiredNextEvidence: [],
      };
    case "duplicates":
      return {
        gateId: "duplicates",
        status: "pass",
        measured: true,
        ownerSeam: "exercise_selection_plan",
        evidence: ["selectedIdentityDelta:0", "no_new_duplicate_identity"],
        regressions: [],
        requiredNextEvidence: [],
      };
    case "materializer_validity":
      return {
        gateId: "materializer_validity",
        status: "unknown",
        measured: false,
        ownerSeam: "v2_materialization_dry_run",
        evidence: [
          `capacityPressureRowsRelieved:${input.capacityPressureRowsRelieved}`,
          "materializer_projection:not_run",
        ],
        regressions: [],
        requiredNextEvidence: [
          "read_only_materializer_projection_with_candidate_identity_rows",
          "seed_shape_compatibility_check",
        ],
      };
    case "acceptance_result":
      return {
        gateId: "acceptance_result",
        status: "unknown",
        measured: false,
        ownerSeam: "next_mesocycle_acceptance_gate",
        evidence: ["acceptance_gate:not_rerun"],
        regressions: [],
        requiredNextEvidence: [
          "candidate_evaluator_projection",
          "read_only_acceptance_gate_result_for_projected_candidate",
        ],
      };
  }
}

function buildCapacityBehaviorProjection(input: {
  rows: ReadonlyArray<CapacityLaneInspectionRow>;
  design: V2CapacityPolicyTrialDesign;
}): V2CapacityBehaviorProjection {
  const change = input.design.candidateChange;
  if (!change) {
    return {
      version: 1,
      source: "v2_selection_capacity_plan_diagnostic",
      readOnly: true,
      affectsScoringOrGeneration: false,
      consumedByDemandOrMaterializer: false,
      status: "not_available",
      projectionMode: "slot_cap_delta_existing_evidence_only",
      trialId: null,
      candidateImpact: {
        selectedIdentityDelta: 0,
        weeklyVolumeDelta: 0,
        capacityPressureRowsBefore: 0,
        capacityPressureRowsAfter: 0,
        capacityPressureRowsRelieved: 0,
        floorCriticalRowsBefore: 0,
        floorCriticalRowsAfter: 0,
        optionalStretchRowsActivated: 0,
        regressionCount: 0,
        regressions: [],
        improvements: [],
      },
      projectedSlots: [],
      gates: [],
      blockersBeforeBehavior: ["no_capacity_policy_trial_design_available"],
      nextSafeAction: "inspect_capacity_rows",
      limitations: [
        "projection_not_available_without_capacity_policy_trial_design",
        "does_not_change_selection_capacity_plan",
        "does_not_feed_materializer_ranking",
        "does_not_feed_acceptance_scoring",
        "does_not_change_seed_or_runtime_replay",
      ],
      safeForBehaviorPromotion: false,
    };
  }

  const projectedSlots = buildProjectedSlotDeltas({
    rows: input.rows,
    targetSlotId: change.slotId,
    delta: change.delta,
  });
  const capacityPressureRowsBefore = projectedSlots.reduce(
    (sum, slot) => sum + slot.capacityPressureRowsBefore,
    0,
  );
  const capacityPressureRowsAfter = projectedSlots.reduce(
    (sum, slot) => sum + slot.capacityPressureRowsAfter,
    0,
  );
  const floorCriticalRowsBefore = projectedSlots.reduce(
    (sum, slot) => sum + slot.floorCriticalRowsBefore,
    0,
  );
  const floorCriticalRowsAfter = projectedSlots.reduce(
    (sum, slot) => sum + slot.floorCriticalRowsAfter,
    0,
  );
  const capacityPressureRowsRelieved =
    capacityPressureRowsBefore - capacityPressureRowsAfter;
  const gates = input.design.gates.map((gate) =>
    buildProjectionGate({
      gateId: gate.gateId,
      projectedSlots,
      capacityPressureRowsRelieved,
      floorCriticalRowsAfter,
    }),
  );
  const regressions = uniqueSorted(gates.flatMap((gate) => gate.regressions));

  return {
    version: 1,
    source: "v2_selection_capacity_plan_diagnostic",
    readOnly: true,
    affectsScoringOrGeneration: false,
    consumedByDemandOrMaterializer: false,
    status: "projected_with_limitations",
    projectionMode: "slot_cap_delta_existing_evidence_only",
    trialId: input.design.trialId,
    candidateImpact: {
      selectedIdentityDelta: 0,
      weeklyVolumeDelta: 0,
      capacityPressureRowsBefore,
      capacityPressureRowsAfter,
      capacityPressureRowsRelieved,
      floorCriticalRowsBefore,
      floorCriticalRowsAfter,
      optionalStretchRowsActivated: 0,
      regressionCount: regressions.length,
      regressions,
      improvements:
        capacityPressureRowsRelieved > 0
          ? [`capacity_pressure_rows_relieved:${capacityPressureRowsRelieved}`]
          : [],
    },
    projectedSlots,
    gates,
    blockersBeforeBehavior: uniqueSorted([
      ...(floorCriticalRowsAfter > 0
        ? ["floor_critical_lanes_still_need_materializer_projection"]
        : []),
      "materializer_validity_not_measured",
      "acceptance_gate_not_rerun",
      "candidate_identity_impact_not_measured",
    ]),
    nextSafeAction: "run_read_only_materializer_capacity_projection",
    limitations: [
      "cap_delta_only_existing_evidence_projection",
      "does_not_select_new_exercises",
      "does_not_change_weekly_volume_or_set_distribution",
      "does_not_run_materializer",
      "does_not_run_acceptance_gate",
      "does_not_change_selection_capacity_plan",
      "does_not_feed_materializer_ranking",
      "does_not_feed_acceptance_scoring",
      "does_not_change_seed_or_runtime_replay",
    ],
    safeForBehaviorPromotion: false,
  };
}

export function buildV2SelectionCapacityPlanDiagnostic(
  input: BuilderInput,
): V2SelectionCapacityPlanDiagnostic {
  const slotEvidence = new Map(
    input.week1SelectedIdentities.map((slot) => [slot.slotId, slot]),
  );
  const selectionLanes = buildSelectionLaneIndex(
    input.v2ExerciseSelectionPlanDiagnostic,
  );
  const capacitySlots = buildCapacitySlotIndex(input.selectionCapacityPlan);
  const laneDiffs = buildLaneDiffIndex(input.v2TargetVsNoRepairDiff);
  const weeklyTotals = new Map(
    input.weeklyMuscleTotals.map((row) => [row.muscle, row]),
  );
  const week1Intent = input.v2SetDistributionIntent.weeks.find(
    (week) => week.week === 1,
  );
  const weeks = input.v2SetDistributionIntent.weeks
    .filter((week) => week.week >= 1 && week.week <= 4)
    .map((week) => ({
      week: week.week,
      slots: week.slots.map((slot) => {
        const evidence = slotEvidence.get(slot.slotId);
        const capacitySlot = capacitySlots.get(`${week.week}:${slot.slotId}`);
        const maxExerciseCount =
          capacitySlot?.maxExerciseCount ?? MAX_SLOT_EXERCISES;
        return {
          slotId: slot.slotId,
          exerciseCount: evidence?.exerciseCount ?? 0,
          maxExerciseCount,
          setCount: evidence?.totalSets ?? 0,
          targetSessionSets: slot.targetSessionSets,
          lanes: slot.lanes.map((lane) => {
            const selectionLane =
              selectionLanes.get(`${week.week}:${laneKey(slot.slotId, lane.laneId)}`) ??
              selectionLanes.get(`1:${laneKey(slot.slotId, lane.laneId)}`);
            const laneDiff = laneDiffs.get(laneKey(slot.slotId, lane.laneId));
            const week1Lane =
              week1Intent?.slots
                .find((row) => row.slotId === slot.slotId)
                ?.lanes.find((row) => row.laneId === lane.laneId) ?? lane;
            const week1Selected = selectedEvidence({
              lane: week1Lane,
              selectionLane: selectionLanes.get(
                `1:${laneKey(slot.slotId, lane.laneId)}`,
              ),
              laneDiff,
            });
            return buildLane({
              week: week.week,
              slotId: slot.slotId,
              slot,
              lane,
              maxExerciseCount,
              slotEvidence: evidence,
              selectionLane,
              laneDiff,
              weeklyTotals,
              week1SelectedSets:
                week1Selected.sets > 0 ? week1Selected.sets : week1Lane.setBudget.min,
            });
          }),
        };
      }),
    }));

  const lanes = weeks.flatMap((week) =>
    week.slots.flatMap((slot) =>
      slot.lanes.map((lane) => ({
        week: week.week,
        slotId: slot.slotId,
        exerciseCount: slot.exerciseCount,
        maxExerciseCount: slot.maxExerciseCount,
        setCount: slot.setCount,
        targetSessionSets: slot.targetSessionSets,
        lane,
      })),
    ),
  );
  const blockers = uniqueSorted(
    lanes.flatMap(({ week, slotId, lane }) =>
      lane.classification === "blocker"
        ? [`week_${week}:${slotId}:${lane.laneId}:blocker`]
        : [],
    ),
  );
  const warnings = uniqueSorted([
    ...lanes.flatMap(({ week, slotId, lane }) =>
      lane.classification === "capacity_pressure"
        ? [`week_${week}:${slotId}:${lane.laneId}:capacity_pressure`]
        : [],
    ),
    ...lanes.flatMap(({ week, slotId, lane }) =>
      lane.classification === "cap_aware_expansion_needed"
        ? [
            `week_${week}:${slotId}:${lane.laneId}:cap_aware_expansion_needed`,
          ]
        : [],
    ),
    ...lanes.flatMap(({ week, slotId, lane }) =>
      lane.classification === "optional_suppressed"
        ? [`week_${week}:${slotId}:${lane.laneId}:optional_suppressed`]
        : [],
    ),
    "safeForBehaviorPromotion:false",
    "diagnostic_does_not_feed_selection_repair_seed_or_runtime",
  ]);
  const missingInputs = uniqueSorted([
    ...(input.v2SetDistributionIntent.weeks.length === 0
      ? ["v2SetDistributionIntent:weeks:missing"]
      : []),
    ...(input.v2ExerciseSelectionPlanDiagnostic.weeks.length === 0
      ? ["v2ExerciseSelectionPlanDiagnostic:weeks:missing"]
      : []),
    ...(input.selectionCapacityPlan.weeks.length === 0
      ? ["selectionCapacityPlan:weeks:missing"]
      : []),
    ...(input.week1SelectedIdentities.length === 0
      ? ["week_1_selected_identities:not_visible"]
      : []),
  ]);
  const status: V2SelectionCapacityPlanDiagnostic["status"] =
    blockers.length > 0
      ? "blocked"
      : missingInputs.length > 0 || warnings.length > 0
        ? "projected_with_limitations"
        : "diagnostic_only";
  const capacityPolicyTrialDesign = buildCapacityPolicyTrialDesign(lanes);

  return {
    version: 1,
    source: "v2_planner_policy",
    readOnly: true,
    affectsScoringOrGeneration: false,
    status,
    summary: {
      weeksEvaluated: weeks.length,
      slotsEvaluated: weeks.reduce((sum, week) => sum + week.slots.length, 0),
      lanesEvaluated: lanes.length,
      targetMetNoActionCount: lanes.filter(
        ({ lane }) => lane.classification === "target_met_no_action",
      ).length,
      capacityPressureCount: lanes.filter(
        ({ lane }) => lane.classification === "capacity_pressure",
      ).length,
      capAwareExpansionNeededCount: lanes.filter(
        ({ lane }) => lane.classification === "cap_aware_expansion_needed",
      ).length,
      optionalSuppressedCount: lanes.filter(
        ({ lane }) => lane.classification === "optional_suppressed",
      ).length,
      blockerCount: blockers.length,
      laneInspectionCategoryCounts: countInspectionCategories(lanes),
    },
    weeks,
    blockers,
    warnings,
    missingInputs,
    capacityPolicyTrialDesign,
    capacityBehaviorProjection: buildCapacityBehaviorProjection({
      rows: lanes,
      design: capacityPolicyTrialDesign,
    }),
    safeForBehaviorPromotion: false,
  };
}
