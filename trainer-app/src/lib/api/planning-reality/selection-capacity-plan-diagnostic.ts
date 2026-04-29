import type { V2SetDistributionIntent } from "@/lib/engine/planning/v2";
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
  safeForBehaviorPromotion: false;
};

type BuilderInput = {
  v2SetDistributionIntent: V2SetDistributionIntent;
  v2ExerciseSelectionPlanDiagnostic: V2ExerciseSelectionPlanDiagnostic;
  v2TargetVsNoRepairDiff: V2TargetVsNoRepairDiffLike;
  week1SelectedIdentities: ReadonlyArray<SlotCompositionSnapshotDiagnostic>;
  weeklyMuscleTotals: ReadonlyArray<WeeklyMuscleTotalLike>;
};

type SelectionLane =
  V2ExerciseSelectionPlanDiagnostic["weeks"][number]["slots"][number]["lanes"][number];
type IntentSlot = V2SetDistributionIntent["weeks"][number]["slots"][number];
type IntentLane = IntentSlot["lanes"][number];

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

function buildLane(input: {
  week: number;
  slotId: string;
  slot: IntentSlot;
  lane: IntentLane;
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
  const slotHeadroom = MAX_SLOT_EXERCISES - exerciseCount;
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
    slotAtCapacity: exerciseCount >= MAX_SLOT_EXERCISES,
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

  return {
    laneId: input.lane.laneId,
    classification,
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
      `maxSlotExerciseCapacity:${MAX_SLOT_EXERCISES}`,
      `targetSessionSets:${input.slot.targetSessionSets.min}-${input.slot.targetSessionSets.preferred}-${input.slot.targetSessionSets.max}`,
      ...(capHeadroom != null ? [`perExerciseCapHeadroom:${capHeadroom}`] : []),
      `weeklyTargetStatus:${weeklyStatus}`,
      `classification:${classification}`,
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
    ]),
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
        return {
          slotId: slot.slotId,
          exerciseCount: evidence?.exerciseCount ?? 0,
          maxExerciseCount: MAX_SLOT_EXERCISES,
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
    week.slots.flatMap((slot) => slot.lanes.map((lane) => ({ week, slot, lane }))),
  );
  const blockers = uniqueSorted(
    lanes.flatMap(({ week, slot, lane }) =>
      lane.classification === "blocker"
        ? [`week_${week.week}:${slot.slotId}:${lane.laneId}:blocker`]
        : [],
    ),
  );
  const warnings = uniqueSorted([
    ...lanes.flatMap(({ week, slot, lane }) =>
      lane.classification === "capacity_pressure"
        ? [`week_${week.week}:${slot.slotId}:${lane.laneId}:capacity_pressure`]
        : [],
    ),
    ...lanes.flatMap(({ week, slot, lane }) =>
      lane.classification === "cap_aware_expansion_needed"
        ? [
            `week_${week.week}:${slot.slotId}:${lane.laneId}:cap_aware_expansion_needed`,
          ]
        : [],
    ),
    ...lanes.flatMap(({ week, slot, lane }) =>
      lane.classification === "optional_suppressed"
        ? [`week_${week.week}:${slot.slotId}:${lane.laneId}:optional_suppressed`]
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
    },
    weeks,
    blockers,
    warnings,
    missingInputs,
    safeForBehaviorPromotion: false,
  };
}
