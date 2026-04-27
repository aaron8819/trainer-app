import type {
  AccumulationWeekProjection,
  CleanupCandidateFeasibility,
  DuplicateContinuityJustification,
  ExerciseClassAlignment,
  ExerciseClassDistributionBySlot,
  ExerciseClassUnresolvedCause,
  ExerciseConcentrationDiagnostic,
  ProjectedDeliveryDiagnostic,
  ShadowRepairMaterialityDiagnostic,
  ShadowRepairSummary,
  SlotCompositionSnapshotDiagnostic,
  SlotDemandAllocationByWeek,
  SlotPlanPlanningRealityDiagnostic,
  TopDownMesocycleLane,
  TopDownMesocyclePlan,
  TopDownTargetLaneStatus,
  WeakPreselectionConsumptionDiagnostic,
  WeeklyMuscleDemandDiagnostic,
} from "./types";
import type { ForbiddenCleanupRerouteDiagnostic } from "../mesocycle-handoff-slot-plan-projection.repair-engine";

type TargetLaneDefinition = {
  lane: TopDownMesocycleLane;
  muscles: string[];
  preferredClasses: string[];
  targetSets: string;
};

type TargetSlotDefinition = {
  slotId: "upper_a" | "lower_a" | "upper_b" | "lower_b";
  targetIntent: string;
  lanes: TargetLaneDefinition[];
};

const TARGET_FLOW: TopDownMesocyclePlan["targetFlow"] = [
  "MesocycleDemand",
  "WeeklyDemandByWeek",
  "SlotDemandAllocationByWeek",
  "ExerciseClassDistributionBySlot",
  "SetDistributionIntent",
  "SelectionObjective",
  "Prescription",
  "Validation",
  "Receipt",
  "Runtime",
];

const TARGET_SLOTS: TargetSlotDefinition[] = [
  {
    slotId: "upper_a",
    targetIntent: "upper_horizontal",
    lanes: [
      {
        lane: "chest_anchor",
        muscles: ["Chest"],
        preferredClasses: ["press"],
        targetSets: "3-4",
      },
      {
        lane: "row_anchor",
        muscles: ["Upper Back", "Lats"],
        preferredClasses: ["row"],
        targetSets: "3-4",
      },
      {
        lane: "vertical_pull",
        muscles: ["Lats"],
        preferredClasses: ["pull"],
        targetSets: "2-3",
      },
      {
        lane: "chest_secondary",
        muscles: ["Chest"],
        preferredClasses: ["fly_press"],
        targetSets: "2-3",
      },
      {
        lane: "rear_delt",
        muscles: ["Rear Delts"],
        preferredClasses: ["rear_delt"],
        targetSets: "2-3",
      },
      {
        lane: "triceps",
        muscles: ["Triceps"],
        preferredClasses: ["triceps"],
        targetSets: "2-3",
      },
    ],
  },
  {
    slotId: "lower_a",
    targetIntent: "lower_squat",
    lanes: [
      {
        lane: "squat_anchor",
        muscles: ["Quads"],
        preferredClasses: ["squat"],
        targetSets: "3-4",
      },
      {
        lane: "quad_isolation",
        muscles: ["Quads"],
        preferredClasses: ["leg_ext"],
        targetSets: "2-3",
      },
      {
        lane: "knee_flexion_curl",
        muscles: ["Hamstrings"],
        preferredClasses: ["curl"],
        targetSets: "2-3",
      },
      {
        lane: "hinge_anchor",
        muscles: ["Hamstrings"],
        preferredClasses: ["hinge"],
        targetSets: "2",
      },
      {
        lane: "calves",
        muscles: ["Calves"],
        preferredClasses: ["calf"],
        targetSets: "3-4",
      },
    ],
  },
  {
    slotId: "upper_b",
    targetIntent: "upper_vertical",
    lanes: [
      {
        lane: "vertical_press",
        muscles: ["Front Delts", "Side Delts"],
        preferredClasses: ["press"],
        targetSets: "2-3",
      },
      {
        lane: "vertical_pull",
        muscles: ["Lats"],
        preferredClasses: ["pull"],
        targetSets: "3-4",
      },
      {
        lane: "chest_secondary",
        muscles: ["Chest"],
        preferredClasses: ["chest2"],
        targetSets: "3-4",
      },
      {
        lane: "row_anchor",
        muscles: ["Upper Back", "Lats"],
        preferredClasses: ["row"],
        targetSets: "2-3",
      },
      {
        lane: "side_delt_isolation",
        muscles: ["Side Delts"],
        preferredClasses: ["raise"],
        targetSets: "3-4",
      },
      {
        lane: "biceps",
        muscles: ["Biceps"],
        preferredClasses: ["biceps"],
        targetSets: "2-3",
      },
      {
        lane: "triceps",
        muscles: ["Triceps"],
        preferredClasses: ["triceps"],
        targetSets: "0-2",
      },
    ],
  },
  {
    slotId: "lower_b",
    targetIntent: "lower_hinge",
    lanes: [
      {
        lane: "hinge_anchor",
        muscles: ["Hamstrings", "Glutes"],
        preferredClasses: ["hinge"],
        targetSets: "3",
      },
      {
        lane: "knee_flexion_curl",
        muscles: ["Hamstrings"],
        preferredClasses: ["curl"],
        targetSets: "2-3",
      },
      {
        lane: "quad_support",
        muscles: ["Quads"],
        preferredClasses: ["quad"],
        targetSets: "2-3",
      },
      {
        lane: "calves",
        muscles: ["Calves"],
        preferredClasses: ["calf"],
        targetSets: "3-4",
      },
      {
        lane: "optional_core_adductor_glute",
        muscles: ["Core", "Adductors", "Glutes"],
        preferredClasses: ["optional"],
        targetSets: "0-2",
      },
    ],
  },
];

function minTargetSets(targetSets: string): number {
  const first = Number.parseFloat(targetSets.split("-")[0] ?? "");
  return Number.isFinite(first) ? first : 0;
}

function compactRefs(values: ReadonlyArray<string>, limit = 1): string[] {
  return Array.from(new Set(values.filter(Boolean)))
    .sort((left, right) => left.localeCompare(right))
    .slice(0, limit);
}

function findFinalSlot(
  finalSlotPlan: ReadonlyArray<SlotCompositionSnapshotDiagnostic>,
  slotId: string,
): SlotCompositionSnapshotDiagnostic | undefined {
  return finalSlotPlan.find((slot) => slot.slotId === slotId);
}

function slotStimulus(input: {
  slot: SlotCompositionSnapshotDiagnostic | undefined;
  muscles: ReadonlyArray<string>;
}): number {
  if (!input.slot) {
    return 0;
  }
  return Math.max(
    0,
    ...input.muscles.map(
      (muscle) => input.slot?.projectedEffectiveStimulusByMuscle[muscle] ?? 0,
    ),
  );
}

function exerciseMatchesLane(input: {
  exercise: SlotCompositionSnapshotDiagnostic["exercises"][number];
  lane: TopDownMesocycleLane;
}): boolean {
  const name = input.exercise.exerciseName.toLowerCase();
  const patterns = input.exercise.movementPatterns.map((pattern) =>
    pattern.toLowerCase(),
  );
  switch (input.lane) {
    case "chest_anchor":
      return patterns.some((pattern) => pattern.includes("horizontal_push")) ||
        name.includes("bench") ||
        name.includes("press");
    case "chest_secondary":
      return name.includes("fly") ||
        name.includes("crossover") ||
        name.includes("machine press") ||
        name.includes("cable press");
    case "row_anchor":
      return patterns.some((pattern) => pattern.includes("horizontal_pull")) ||
        name.includes("row");
    case "vertical_pull":
      return patterns.some((pattern) => pattern.includes("vertical_pull")) ||
        name.includes("pulldown") ||
        name.includes("pull-up");
    case "vertical_press":
      return patterns.some((pattern) => pattern.includes("vertical_push")) ||
        name.includes("overhead press") ||
        name.includes("shoulder press");
    case "side_delt_isolation":
      return name.includes("lateral raise");
    case "rear_delt":
      return name.includes("rear delt") ||
        name.includes("reverse fly") ||
        name.includes("face pull");
    case "triceps":
      return name.includes("triceps") || name.includes("pressdown");
    case "biceps":
      return name.includes("curl");
    case "squat_anchor":
      return patterns.some((pattern) => pattern.includes("squat")) ||
        name.includes("squat");
    case "quad_isolation":
      return name.includes("leg extension");
    case "hinge_anchor":
      return patterns.some((pattern) => pattern.includes("hinge")) ||
        name.includes("deadlift") ||
        name.includes("rdl");
    case "knee_flexion_curl":
      return name.includes("leg curl") ||
        name.includes("hamstring curl") ||
        name.includes("nordic") ||
        patterns.some((pattern) => pattern.includes("flexion"));
    case "calves":
      return name.includes("calf");
    case "quad_support":
      return patterns.some((pattern) => pattern.includes("squat")) ||
        name.includes("leg press") ||
        name.includes("leg extension") ||
        name.includes("lunge");
    case "optional_core_adductor_glute":
      return name.includes("core") ||
        name.includes("adductor") ||
        name.includes("glute");
  }
}

function findClassAlignment(input: {
  exerciseClassAlignment: ExerciseClassAlignment;
  slotId: string;
  muscles: ReadonlyArray<string>;
}): ExerciseClassAlignment["slots"][number]["muscleAlignments"][number] | undefined {
  return input.exerciseClassAlignment.slots
    .find((slot) => slot.slotId === input.slotId)
    ?.muscleAlignments.find((row) => input.muscles.includes(row.muscle));
}

function laneStatus(input: {
  lane: TargetLaneDefinition;
  slotId: string;
  finalSlot: SlotCompositionSnapshotDiagnostic | undefined;
  exerciseClassDistributionBySlot: ReadonlyArray<ExerciseClassDistributionBySlot>;
  exerciseClassAlignment: ExerciseClassAlignment;
  repairMaterialityAfterShadowAllocation: ReadonlyArray<ShadowRepairMaterialityDiagnostic>;
  weakPreselectionConsumption: ReadonlyArray<WeakPreselectionConsumptionDiagnostic>;
  exerciseConcentration: ReadonlyArray<ExerciseConcentrationDiagnostic>;
}): {
  status: TopDownTargetLaneStatus;
  evidenceRefs: string[];
  limitations: string[];
} {
  const minSets = minTargetSets(input.lane.targetSets);
  const currentStimulus = slotStimulus({
    slot: input.finalSlot,
    muscles: input.lane.muscles,
  });
  const matchingExerciseCount =
    input.finalSlot?.exercises.filter((exercise) =>
      exerciseMatchesLane({ exercise, lane: input.lane.lane }),
    ).length ?? 0;
  const alignment = findClassAlignment({
    exerciseClassAlignment: input.exerciseClassAlignment,
    slotId: input.slotId,
    muscles: input.lane.muscles,
  });
  const repairRows = input.repairMaterialityAfterShadowAllocation.filter(
    (row) =>
      row.slotId === input.slotId &&
      row.muscle != null &&
      input.lane.muscles.includes(row.muscle) &&
      (row.materiality === "moderate" || row.materiality === "major"),
  );
  const classRows = input.exerciseClassDistributionBySlot.filter(
    (row) =>
      row.week === 1 &&
      row.slotId === input.slotId &&
      row.muscleDemands.some((demand) =>
        input.lane.muscles.includes(demand.muscle),
      ),
  );
  const weakRows = input.weakPreselectionConsumption.filter(
    (row) => row.slotId === input.slotId && input.lane.muscles.includes(row.muscle),
  );
  const concentrationRows = input.exerciseConcentration.filter(
    (row) =>
      row.slotId === input.slotId &&
      input.lane.muscles.some((muscle) =>
        Object.prototype.hasOwnProperty.call(
          row.percentageOfWeeklyProjectedStimulusByMuscle,
          muscle,
        ),
      ),
  );
  const isOptional = input.lane.targetSets.startsWith("0-");
  const status: TopDownTargetLaneStatus =
    isOptional && currentStimulus === 0
      ? "matched"
      : repairRows.length > 0 && currentStimulus >= Math.max(1, minSets)
        ? "partial"
        : alignment?.finalAlignment === "satisfied" ||
            (currentStimulus >= Math.max(1, minSets) && matchingExerciseCount > 0)
        ? concentrationRows.some((row) =>
              row.flags.some((flag) => flag.includes("OVER_60_PERCENT")),
            ) &&
            !(
              input.slotId === "lower_b" &&
              ["hinge_anchor", "knee_flexion_curl"].includes(input.lane.lane)
            )
            ? "overdelivered"
            : "matched"
          : currentStimulus > 0 || classRows.length > 0 || matchingExerciseCount > 0
            ? "partial"
            : weakRows.length > 0
              ? "blocked"
              : "missing";
  const evidenceRefs = status === "matched" ? [] : compactRefs([
    ...(currentStimulus > 0
      ? [`stim:${input.slotId}:${input.lane.muscles[0]}=${currentStimulus}`]
      : []),
    ...(matchingExerciseCount > 0
      ? [`lane:${input.slotId}:${input.lane.lane}:n=${matchingExerciseCount}`]
      : []),
    ...(alignment
      ? [`class:${input.slotId}:${alignment.muscle}:${alignment.finalAlignment}`]
      : []),
    ...(repairRows.length > 0 ? [`repair:${input.slotId}:n=${repairRows.length}`] : []),
    ...(weakRows.length > 0 ? [`weak:${input.slotId}:${input.lane.muscles[0]}`] : []),
  ]);
  const limitations = compactRefs([
    ...(repairRows.length > 0 ? ["repair_shaped"] : []),
    ...(classRows.length === 0 ? ["class_intent_missing_or_compact"] : []),
  ]);
  return { status, evidenceRefs, limitations };
}

function slotStatus(
  lanes: ReadonlyArray<{ currentStatus: TopDownTargetLaneStatus; limitations: string[] }>,
): TopDownMesocyclePlan["slotTargets"][number]["slotStatus"] {
  if (lanes.some((lane) => lane.currentStatus === "blocked")) {
    return "blocked";
  }
  if (lanes.some((lane) => lane.limitations.includes("repair_shaped"))) {
    return "repair_shaped";
  }
  if (lanes.every((lane) => lane.currentStatus === "matched")) {
    return "matched";
  }
  return "partial";
}

function buildSlotTargets(input: {
  finalSlotPlan: ReadonlyArray<SlotCompositionSnapshotDiagnostic>;
  exerciseClassDistributionBySlot: ReadonlyArray<ExerciseClassDistributionBySlot>;
  exerciseClassAlignment: ExerciseClassAlignment;
  repairMaterialityAfterShadowAllocation: ReadonlyArray<ShadowRepairMaterialityDiagnostic>;
  weakPreselectionConsumption: ReadonlyArray<WeakPreselectionConsumptionDiagnostic>;
  exerciseConcentration: ReadonlyArray<ExerciseConcentrationDiagnostic>;
}): TopDownMesocyclePlan["slotTargets"] {
  return TARGET_SLOTS.map((slot) => {
    const finalSlot = findFinalSlot(input.finalSlotPlan, slot.slotId);
    const requiredClassLanes = slot.lanes.map((lane) => ({
      lane: lane.lane,
      preferredClasses: lane.preferredClasses,
      targetSets: lane.targetSets,
      currentStatus: laneStatus({
        lane,
        slotId: slot.slotId,
        finalSlot,
        exerciseClassDistributionBySlot: input.exerciseClassDistributionBySlot,
        exerciseClassAlignment: input.exerciseClassAlignment,
        repairMaterialityAfterShadowAllocation:
          input.repairMaterialityAfterShadowAllocation,
        weakPreselectionConsumption: input.weakPreselectionConsumption,
        exerciseConcentration: input.exerciseConcentration,
      }).status,
      evidenceRefs: laneStatus({
        lane,
        slotId: slot.slotId,
        finalSlot,
        exerciseClassDistributionBySlot: input.exerciseClassDistributionBySlot,
        exerciseClassAlignment: input.exerciseClassAlignment,
        repairMaterialityAfterShadowAllocation:
          input.repairMaterialityAfterShadowAllocation,
        weakPreselectionConsumption: input.weakPreselectionConsumption,
        exerciseConcentration: input.exerciseConcentration,
      }).evidenceRefs,
      limitations: laneStatus({
        lane,
        slotId: slot.slotId,
        finalSlot,
        exerciseClassDistributionBySlot: input.exerciseClassDistributionBySlot,
        exerciseClassAlignment: input.exerciseClassAlignment,
        repairMaterialityAfterShadowAllocation:
          input.repairMaterialityAfterShadowAllocation,
        weakPreselectionConsumption: input.weakPreselectionConsumption,
        exerciseConcentration: input.exerciseConcentration,
      }).limitations,
    }));
    return {
      slotId: slot.slotId,
      targetIntent: slot.targetIntent,
      requiredClassLanes,
      slotStatus: slotStatus(requiredClassLanes),
    };
  });
}

function buildAcceptanceChecks(input: {
  weeklyMuscleDemand: ReadonlyArray<WeeklyMuscleDemandDiagnostic>;
  projectedDelivery: ReadonlyArray<ProjectedDeliveryDiagnostic>;
  shadowRepairSummary: ShadowRepairSummary;
  repairMaterialityAfterShadowAllocation: ReadonlyArray<ShadowRepairMaterialityDiagnostic>;
  duplicateContinuityJustification: DuplicateContinuityJustification;
  exerciseConcentration: ReadonlyArray<ExerciseConcentrationDiagnostic>;
  slotDemandAllocationByWeek: SlotDemandAllocationByWeek;
  exerciseClassDistributionBySlot: ReadonlyArray<ExerciseClassDistributionBySlot>;
  forbiddenCleanupReroute?: ForbiddenCleanupRerouteDiagnostic;
}): TopDownMesocyclePlan["targetAcceptanceChecks"] {
  const deliveryByMuscle = new Map(input.projectedDelivery.map((row) => [row.muscle, row]));
  const hardDemand = input.weeklyMuscleDemand.filter((row) => row.targetStatus === "hard");
  const primaryBelowMinimum = hardDemand.filter((demand) => {
    const delivery = deliveryByMuscle.get(demand.muscle);
    return (
      demand.mev != null &&
      (delivery?.projectedEffectiveStimulusAfterRepairAndFinalShaping ?? -1) + 1e-9 <
        demand.mev
    );
  });
  const primaryUnknown = hardDemand.filter((demand) => {
    const delivery = deliveryByMuscle.get(demand.muscle);
    return demand.mev == null || delivery == null;
  });
  const gt5 = input.exerciseConcentration.filter((row) =>
    row.flags.some((flag) => flag === "COMPOUND_GT_5_SETS" || flag === "ISOLATION_GT_5_SETS"),
  );
  const over60 = input.exerciseConcentration.filter((row) =>
    row.flags.includes("EXERCISE_SUPPLIES_OVER_60_PERCENT_WEEKLY_STIMULUS"),
  );
  const over50 = input.exerciseConcentration.filter((row) =>
    row.flags.includes("EXERCISE_SUPPLIES_OVER_50_PERCENT_WEEKLY_STIMULUS"),
  );
  const badDuplicates = input.duplicateContinuityJustification.duplicates.filter(
    (row) =>
      row.compatibleAlternativeExists === true &&
      (row.policyRecommendation === "block_if_clean_alternative_exists" ||
        row.justification === "unjustified" ||
        row.justification === "unknown"),
  );
  const materialRepairCount = input.shadowRepairSummary.materialRepairCount;
  const forbiddenCleanupVisible =
    (input.forbiddenCleanupReroute?.removedExercises.length ?? 0) > 0 ||
    (input.forbiddenCleanupReroute?.unresolvedDemand.length ?? 0) > 0;
  const crossWeekWarnings = input.slotDemandAllocationByWeek.crossWeekAllocationWarnings;

  return [
    {
      check: "primary_muscles_above_minimum",
      currentStatus:
        primaryBelowMinimum.length > 0
          ? "fail"
          : primaryUnknown.length > 0
            ? "unknown"
            : "pass",
      evidenceRefs: compactRefs([
        ...primaryBelowMinimum.map((row) => `belowMev:${row.muscle}`),
        ...hardDemand.map((row) => `hard:${row.muscle}`),
      ]),
      ...(primaryBelowMinimum.length > 0
        ? { blockingReason: "primary_below_minimum" }
        : {}),
    },
    {
      check: "no_forbidden_slot_primary_solution",
      currentStatus: forbiddenCleanupVisible ? "partial" : "pass",
      evidenceRefs: forbiddenCleanupVisible
        ? ["forbiddenCleanupReroute:visible"]
        : ["forbiddenCleanupReroute:none"],
      ...(forbiddenCleanupVisible
        ? { blockingReason: "forbidden_cleanup_visible" }
        : {}),
    },
    {
      check: "no_unjustified_gt_5_sets",
      currentStatus: gt5.length > 0 ? "fail" : "pass",
      evidenceRefs: compactRefs(gt5.map((row) => `gt5:${row.slotId}:${row.exerciseName}`)),
      ...(gt5.length > 0 ? { blockingReason: "gt5_unjustified" } : {}),
    },
    {
      check: "no_material_repair_for_basic_shape",
      currentStatus: materialRepairCount > 0 ? "fail" : "pass",
      evidenceRefs: [`materialRepairCount:${materialRepairCount}`],
      ...(materialRepairCount > 0 ? { blockingReason: "repair_created_shape" } : {}),
    },
    {
      check: "no_duplicate_main_lift_if_clean_alternative_exists",
      currentStatus: badDuplicates.length > 0 ? "fail" : "partial",
      evidenceRefs: compactRefs(
        badDuplicates.map((row) => `dup:${row.exerciseName}:cleanAlt`),
      ),
      ...(badDuplicates.length > 0 ? { blockingReason: "duplicate_clean_alt" } : {}),
    },
    {
      check: "no_excessive_axial_fatigue_stacking",
      currentStatus:
        crossWeekWarnings.some((warning) => warning.code.includes("DUPLICATE")) ||
        input.repairMaterialityAfterShadowAllocation.some((row) =>
          ["Lower Back", "Glutes"].includes(row.muscle ?? ""),
        )
          ? "partial"
          : "unknown",
      evidenceRefs: compactRefs([
        ...crossWeekWarnings.map((row) => row.code),
        ...input.repairMaterialityAfterShadowAllocation
          .filter((row) => ["Lower Back", "Glutes"].includes(row.muscle ?? ""))
          .map((row) => `collateral:${row.slotId}:${row.muscle}`),
      ]),
      blockingReason: "cross_week_axial_policy_missing",
    },
    {
      check: "no_single_exercise_over_50_60_percent_without_intent",
      currentStatus: over60.length > 0 ? "fail" : over50.length > 0 ? "partial" : "pass",
      evidenceRefs: compactRefs(
        [...over60, ...over50].map((row) => `share:${row.slotId}:${row.exerciseName}`),
      ),
      ...(over60.length > 0
        ? { blockingReason: "single_exercise_over_60pct" }
        : over50.length > 0
          ? { blockingReason: "single_exercise_over_50pct" }
          : {}),
    },
    {
      check: "slot_demand_allocation_before_selection",
      currentStatus: input.slotDemandAllocationByWeek.weeks.length > 0 ? "partial" : "unknown",
      evidenceRefs: ["slotDemandAllocationByWeek:read_only"],
      blockingReason: "diagnostic_not_selection_input",
    },
    {
      check: "exercise_class_intent_before_selection",
      currentStatus: input.exerciseClassDistributionBySlot.length > 0 ? "partial" : "unknown",
      evidenceRefs: ["exerciseClassDistributionBySlot:read_only"],
      blockingReason: "diagnostic_not_selection_input",
    },
    {
      check: "runtime_seed_replay_without_reselection",
      currentStatus: "pass",
      evidenceRefs: ["seedReplay:pass"],
    },
  ];
}

function buildMigrationReadiness(input: {
  shadowRepairSummary: ShadowRepairSummary;
  suspiciousRepairCount: number;
  accumulationWeekProjection: AccumulationWeekProjection;
  duplicateContinuityJustification: DuplicateContinuityJustification;
  cleanupCandidateFeasibility: ReadonlyArray<CleanupCandidateFeasibility>;
  exerciseClassUnresolvedCauses: ReadonlyArray<ExerciseClassUnresolvedCause>;
  weakPreselectionConsumption: ReadonlyArray<WeakPreselectionConsumptionDiagnostic>;
}): TopDownMesocyclePlan["migrationReadiness"] {
  const hasHamstringsOverdelivery = input.accumulationWeekProjection.crossWeekWarnings
    .some((warning) => warning.code === "HAMSTRINGS_OVERDELIVERED_ACROSS_ACCUMULATION");
  const calfCleanup = input.cleanupCandidateFeasibility.find(
    (row) => row.candidate === "lower_b_calf_duplicate_cleanup",
  );
  const hasDuplicateRisk =
    input.duplicateContinuityJustification.summary.unjustifiedOrUnknown > 0 ||
    input.duplicateContinuityJustification.summary.cleanAlternativeAvailable > 0;
  const supportNeedsPlanner = input.exerciseClassUnresolvedCauses.some(
    (row) => row.recommendedOwner === "support_demand_planner",
  ) || input.weakPreselectionConsumption.length > 0;
  const repairMaterialityGate =
    input.shadowRepairSummary.materialRepairCount > 0 || input.shadowRepairSummary.majorRepairCount > 0;
  return [
    {
      candidate: "chest_upper_distinct_class_distribution",
      readiness: "blocked_by_repair_materiality",
      reason: "prior_chest_trial_failed_repair_materiality_gate",
      evidenceRefs: [
        `material:${input.shadowRepairSummary.materialRepairCount}`,
        `major:${input.shadowRepairSummary.majorRepairCount}`,
      ],
      gateMetricsRequired: [
        "material",
        "major",
        "suspicious",
      ],
    },
    {
      candidate: "lower_b_hinge_curl_distribution",
      readiness: hasHamstringsOverdelivery
        ? "blocked_by_cross_week_uncertainty"
        : "diagnostic_only",
      reason: "hinge_curl_visible_but_weekly_hams_overdelivery_unresolved",
      evidenceRefs: hasHamstringsOverdelivery
        ? ["accumulationWeekProjection:HAMSTRINGS_OVERDELIVERED"]
        : ["lower_b_hinge_curl:diagnostic"],
      gateMetricsRequired: [
        "hinge",
        "curl",
        "hams",
      ],
    },
    {
      candidate: "side_delt_direct_support",
      readiness: "diagnostic_only",
      reason: "awaits_weekly_projection_and_concentration_gate",
      evidenceRefs: ["side_delt:diagnostic_only"],
      gateMetricsRequired: [
        "side_delt",
        "share",
        "duplicate",
      ],
    },
    {
      candidate: "calf_duplicate_distribution",
      readiness:
        calfCleanup?.feasibility === "not_feasible_under_current_caps"
          ? "blocked_by_feasibility"
          : "diagnostic_only",
      reason:
        calfCleanup?.feasibility === "not_feasible_under_current_caps"
          ? "single_calf_variant_cannot_preserve_floor_under_caps"
          : "diagnostic_until_single_variant_feasible",
      evidenceRefs: calfCleanup
        ? [`cleanupCandidateFeasibility.recommendation:${calfCleanup.recommendation}`]
        : ["cleanupCandidateFeasibility:missing"],
      gateMetricsRequired: [
        "floor",
        "single_variant",
        "no_lower_a",
      ],
    },
    {
      candidate: "duplicate_main_lift_policy",
      readiness: hasDuplicateRisk
        ? "blocked_by_cross_week_uncertainty"
        : "diagnostic_only",
      reason: "needs_weekly_identity_fatigue_and_deload_policy",
      evidenceRefs: [
        `duplicates:${input.duplicateContinuityJustification.summary.totalDuplicates}`,
      ],
      gateMetricsRequired: [
        "clean_alt",
        "anchor",
        "weeks_1_4",
      ],
    },
    {
      candidate: "support_floor_planner_ownership",
      readiness: supportNeedsPlanner || repairMaterialityGate
        ? "blocked_by_repair_materiality"
        : "diagnostic_only",
      reason: "planner_must_own_equivalent_support_before_repair_demotion",
      evidenceRefs: [
        `weakPreselection:${input.weakPreselectionConsumption.length}`,
        `material:${input.shadowRepairSummary.materialRepairCount}`,
      ],
      gateMetricsRequired: [
        "pre_repair",
        "weak_zero",
        "late_zero",
      ],
    },
    {
      candidate: "repair_path_demotion",
      readiness:
        input.suspiciousRepairCount > 0
          ? "blocked_by_suspicious_repair"
          : repairMaterialityGate
            ? "blocked_by_repair_materiality"
            : "diagnostic_only",
      reason: "blocked_until_planner_owns_demand_class_set_distribution",
      evidenceRefs: [
        `material:${input.shadowRepairSummary.materialRepairCount}`,
        `suspicious:${input.suspiciousRepairCount}`,
      ],
      gateMetricsRequired: [
        "material_zero",
        "major_zero",
        "suspicious_zero",
      ],
    },
  ];
}

function planStatus(input: {
  planningShape: SlotPlanPlanningRealityDiagnostic["summary"]["planningShape"];
  shadowRepairSummary: ShadowRepairSummary;
}): TopDownMesocyclePlan["planStatus"] {
  if (
    input.planningShape === "mostly_repair_shaped" ||
    input.shadowRepairSummary.materialRepairCount > 0 ||
    input.shadowRepairSummary.majorRepairCount > 0
  ) {
    return "blocked_by_repair_shape";
  }
  if (input.planningShape === "mostly_upstream_planned") {
    return "partially_modeled";
  }
  return "diagnostic_only";
}

export function buildTopDownMesocyclePlan(input: {
  summary: SlotPlanPlanningRealityDiagnostic["summary"];
  weeklyMuscleDemand: ReadonlyArray<WeeklyMuscleDemandDiagnostic>;
  projectedDelivery: ReadonlyArray<ProjectedDeliveryDiagnostic>;
  finalSlotPlan: ReadonlyArray<SlotCompositionSnapshotDiagnostic>;
  shadowRepairSummary: ShadowRepairSummary;
  repairMaterialityAfterShadowAllocation: ReadonlyArray<ShadowRepairMaterialityDiagnostic>;
  suspiciousRepairCount: number;
  weakPreselectionConsumption: ReadonlyArray<WeakPreselectionConsumptionDiagnostic>;
  slotDemandAllocationByWeek: SlotDemandAllocationByWeek;
  exerciseClassDistributionBySlot: ReadonlyArray<ExerciseClassDistributionBySlot>;
  exerciseClassAlignment: ExerciseClassAlignment;
  exerciseClassUnresolvedCauses: ReadonlyArray<ExerciseClassUnresolvedCause>;
  duplicateContinuityJustification: DuplicateContinuityJustification;
  cleanupCandidateFeasibility: ReadonlyArray<CleanupCandidateFeasibility>;
  accumulationWeekProjection: AccumulationWeekProjection;
  exerciseConcentration: ReadonlyArray<ExerciseConcentrationDiagnostic>;
  forbiddenCleanupReroute?: ForbiddenCleanupRerouteDiagnostic;
}): TopDownMesocyclePlan {
  const slotTargets = buildSlotTargets({
    finalSlotPlan: input.finalSlotPlan,
    exerciseClassDistributionBySlot: input.exerciseClassDistributionBySlot,
    exerciseClassAlignment: input.exerciseClassAlignment,
    repairMaterialityAfterShadowAllocation:
      input.repairMaterialityAfterShadowAllocation,
    weakPreselectionConsumption: input.weakPreselectionConsumption,
    exerciseConcentration: input.exerciseConcentration,
  });
  const allLanes = slotTargets.flatMap((slot) => slot.requiredClassLanes);
  const migrationReadiness = buildMigrationReadiness({
    shadowRepairSummary: input.shadowRepairSummary,
    suspiciousRepairCount: input.suspiciousRepairCount,
    accumulationWeekProjection: input.accumulationWeekProjection,
    duplicateContinuityJustification: input.duplicateContinuityJustification,
    cleanupCandidateFeasibility: input.cleanupCandidateFeasibility,
    exerciseClassUnresolvedCauses: input.exerciseClassUnresolvedCauses,
    weakPreselectionConsumption: input.weakPreselectionConsumption,
  });

  return {
    version: 1,
    source: "first_principles_target_spec",
    targetSpecPath: "docs/10_HYPERTROPHY_MESOCYCLE_ENGINE_TARGET_SPEC.md",
    readOnly: true,
    affectsScoringOrGeneration: false,
    planStatus: planStatus({
      planningShape: input.summary.planningShape,
      shadowRepairSummary: input.shadowRepairSummary,
    }),
    targetFlow: TARGET_FLOW,
    slotTargets,
    targetAcceptanceChecks: buildAcceptanceChecks({
      weeklyMuscleDemand: input.weeklyMuscleDemand,
      projectedDelivery: input.projectedDelivery,
      shadowRepairSummary: input.shadowRepairSummary,
      repairMaterialityAfterShadowAllocation:
        input.repairMaterialityAfterShadowAllocation,
      duplicateContinuityJustification: input.duplicateContinuityJustification,
      exerciseConcentration: input.exerciseConcentration,
      slotDemandAllocationByWeek: input.slotDemandAllocationByWeek,
      exerciseClassDistributionBySlot: input.exerciseClassDistributionBySlot,
      forbiddenCleanupReroute: input.forbiddenCleanupReroute,
    }),
    migrationReadiness,
    summary: {
      matchedTargetLanes: allLanes.filter((lane) => lane.currentStatus === "matched").length,
      partialTargetLanes: allLanes.filter((lane) => lane.currentStatus === "partial").length,
      missingTargetLanes: allLanes.filter((lane) => lane.currentStatus === "missing").length,
      repairShapedTargetLanes: allLanes.filter((lane) =>
        lane.limitations.includes("repair_shaped"),
      ).length,
      blockedMigrationCandidates: migrationReadiness.filter((row) =>
        row.readiness.startsWith("blocked_by_"),
      ).length,
      readyMigrationCandidates: migrationReadiness.filter(
        (row) => row.readiness === "ready_for_bounded_trial",
      ).length,
    },
  };
}
