import type {
  V2SetDistributionIntent,
  V2SupportLanePolicy,
  V2SupportLanePolicyRow,
} from "@/lib/engine/planning/v2";
import { evaluateV2SupportLaneOptionalActivation } from "@/lib/engine/planning/v2";
import type {
  PlannerOwnedAccumulationProjection,
  SlotCompositionSnapshotDiagnostic,
} from "./types";
import type { V2ExerciseSelectionPlanDiagnostic } from "./exercise-selection-plan-diagnostic";

type SupportMuscle = "Triceps" | "Side Delts" | "Rear Delts" | "Biceps";

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

type V2TargetVsNoRepairDiffLike = {
  slotDiffs: Array<{
    slotId: string;
    laneDiffs: V2LaneDiffEvidence[];
  }>;
};

type WeeklyMuscleTotalLike = {
  muscle: string;
  projectedEffectiveSets: number;
  targetMin: number | null;
  targetPreferred: number | null;
  status: "below" | "within" | "above" | "diagnostic";
};

export type V2SupportLaneProjectionDiagnostic = {
  version: 1;
  source: "v2_planner_policy";
  readOnly: true;
  affectsScoringOrGeneration: false;
  status: "diagnostic_only" | "projected_with_limitations" | "blocked";
  summary: {
    supportMusclesEvaluated: number;
    directFloorsMet: number;
    directFloorsBelow: number;
    optionalActivations: number;
    expansionRecommendations: number;
    unrecoverableExpansions: number;
    diagnosticOnlyWarnings: number;
  };
  muscles: Array<{
    muscle: SupportMuscle;
    ownerSlots: string[];
    directFloor: number;
    preferredDirectSets: number;
    currentDirectSets: number;
    collateralCreditUsed: number;
    collateralCreditLimit: number;
    weeklyTargetStatus: "below" | "within" | "above" | "unknown";
    directFloorStatus: "met" | "below" | "above_preferred" | "not_evaluated";
    optionalActivationStatus:
      | "not_applicable"
      | "not_triggered"
      | "triggered_diagnostic_only"
      | "blocked";
    expansionStatus:
      | "none"
      | "recommended_diagnostic_only"
      | "recoverable"
      | "unrecoverable"
      | "not_evaluated";
    rationale: string[];
    limitations: string[];
  }>;
  blockers: string[];
  warnings: string[];
  missingInputs: string[];
  safeForBehaviorPromotion: false;
};

type BuilderInput = {
  v2SupportLanePolicy: V2SupportLanePolicy;
  plannerOwnedAccumulationProjection: PlannerOwnedAccumulationProjection;
  v2SetDistributionIntent: V2SetDistributionIntent;
  v2TargetVsNoRepairDiff: V2TargetVsNoRepairDiffLike;
  v2ExerciseSelectionPlanDiagnostic: V2ExerciseSelectionPlanDiagnostic;
  weeklyMuscleTotals: ReadonlyArray<WeeklyMuscleTotalLike>;
  week1SelectedIdentities: ReadonlyArray<SlotCompositionSnapshotDiagnostic>;
};

type Recoverability = {
  status: "recoverable" | "unrecoverable" | "not_evaluated";
  rationale: string[];
  limitations: string[];
};

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

function classSatisfiesDirectFloor(input: {
  exerciseName: string;
  matchedClass: string | undefined;
  policy: V2SupportLanePolicyRow;
}): boolean {
  const allowed = new Set(input.policy.directFloor.requiredExerciseClasses);
  if (!input.matchedClass) {
    const name = input.exerciseName.toLowerCase();
    if (allowed.has("biceps_isolation")) {
      return name.includes("curl");
    }
    if (allowed.has("triceps_isolation") || allowed.has("pressdown")) {
      return (
        name.includes("triceps") ||
        name.includes("pressdown") ||
        name.includes("extension") ||
        name.includes("skull")
      );
    }
    if (
      allowed.has("lateral_raise") ||
      allowed.has("low_collateral_side_delt")
    ) {
      return name.includes("lateral") && name.includes("raise");
    }
    if (allowed.has("rear_delt_isolation")) {
      return (
        name.includes("rear delt") ||
        name.includes("reverse fly") ||
        name.includes("face pull")
      );
    }
    return false;
  }
  const aliases: Record<string, string[]> = {
    biceps_isolation: ["biceps_curl"],
    triceps_isolation: ["pressdown", "cable_pressdown"],
    lateral_raise: ["low_collateral_side_delt"],
  };
  return (
    allowed.has(input.matchedClass) ||
    Array.from(allowed).some((directClass) =>
      (aliases[directClass] ?? []).includes(input.matchedClass as string),
    )
  );
}

function getDirectSets(input: {
  policy: V2SupportLanePolicyRow;
  laneDiff: V2LaneDiffEvidence | undefined;
}): number {
  return (
    input.laneDiff?.currentEvidence.selectedExercises.reduce(
      (sum, exercise) =>
        classSatisfiesDirectFloor({
          exerciseName: exercise.name,
          matchedClass: exercise.matchedClass,
          policy: input.policy,
        })
          ? sum + exercise.sets
          : sum,
      0,
    ) ?? 0
  );
}

function weeklyTargetStatus(
  row: WeeklyMuscleTotalLike | undefined,
): "below" | "within" | "above" | "unknown" {
  if (!row || row.status === "diagnostic") {
    return "unknown";
  }
  return row.status;
}

function directFloorStatus(input: {
  directFloor: number;
  preferredDirectSets: number;
  currentDirectSets: number;
  laneDiff: V2LaneDiffEvidence | undefined;
}): V2SupportLaneProjectionDiagnostic["muscles"][number]["directFloorStatus"] {
  if (!input.laneDiff) {
    return input.currentDirectSets > 0 ? "met" : "below";
  }
  if (input.currentDirectSets < input.directFloor) {
    return "below";
  }
  if (input.currentDirectSets > input.preferredDirectSets) {
    return "above_preferred";
  }
  return "met";
}

function projectedClassLaneExists(input: {
  projection: PlannerOwnedAccumulationProjection;
  policy: V2SupportLanePolicyRow;
}): boolean {
  return input.projection.weeks.some((week) =>
    week.slots.some(
      (slot) =>
        slot.slotId === input.policy.owningSlotId &&
        slot.classLanes.some(
          (lane) =>
            lane.laneId === input.policy.owningLaneId &&
            lane.setBudget.max >= input.policy.directFloor.minDirectSets,
        ),
    ),
  );
}

function selectionDiagnosticLanes(input: {
  diagnostic: V2ExerciseSelectionPlanDiagnostic;
  policy: V2SupportLanePolicyRow;
}) {
  return input.diagnostic.weeks
    .filter((week) => week.week === 3 || week.week === 4)
    .flatMap((week) =>
      week.slots
        .filter((slot) => slot.slotId === input.policy.owningSlotId)
        .flatMap((slot) =>
          slot.lanes
            .filter((lane) => lane.laneId === input.policy.owningLaneId)
            .map((lane) => ({ week: week.week, slotId: slot.slotId, lane })),
        ),
    );
}

function slotHasRecoverableHeadroom(input: {
  intent: V2SetDistributionIntent;
  policy: V2SupportLanePolicyRow;
}): boolean | null {
  const weekRows = input.intent.weeks.filter(
    (week) => week.week === 3 || week.week === 4,
  );
  if (weekRows.length === 0) {
    return null;
  }
  return weekRows.some((week) => {
    const slot = week.slots.find(
      (row) => row.slotId === input.policy.owningSlotId,
    );
    if (!slot) {
      return false;
    }
    const directLane = slot.lanes.find(
      (lane) => lane.laneId === input.policy.owningLaneId,
    );
    return (
      directLane != null &&
      directLane.setBudget.max >= input.policy.directFloor.minDirectSets &&
      directLane.setBudget.max <= slot.targetSessionSets.max
    );
  });
}

function evaluateRecoverability(input: {
  policy: V2SupportLanePolicyRow;
  plannerOwnedAccumulationProjection: PlannerOwnedAccumulationProjection;
  v2SetDistributionIntent: V2SetDistributionIntent;
  v2ExerciseSelectionPlanDiagnostic: V2ExerciseSelectionPlanDiagnostic;
}): Recoverability {
  const lanes = selectionDiagnosticLanes({
    diagnostic: input.v2ExerciseSelectionPlanDiagnostic,
    policy: input.policy,
  });
  const hasProjectedLane = projectedClassLaneExists({
    projection: input.plannerOwnedAccumulationProjection,
    policy: input.policy,
  });
  const headroom = slotHasRecoverableHeadroom({
    intent: input.v2SetDistributionIntent,
    policy: input.policy,
  });
  const hardBlocked = lanes.some(
    ({ lane }) =>
      (lane.setBudgetStatus === "blocked" && lane.selectedIdentity != null) ||
      lane.capacityStatus === "blocked" ||
      lane.concentrationStatus === "blocked" ||
      lane.fatigueStatus === "blocked" ||
      lane.duplicateStatus === "blocked",
  );
  const rationale = uniqueSorted([
    ...(hasProjectedLane ? ["weeks_3_to_4_direct_lane_budget_visible"] : []),
    ...(headroom === true
      ? ["session_size_headroom_within_v2_set_distribution_intent"]
      : []),
    ...(lanes.some(({ lane }) => lane.cleanAlternatives.length > 0)
      ? ["clean_alternative_visible_in_selection_diagnostic"]
      : []),
  ]);
  const limitations = uniqueSorted([
    ...(hasProjectedLane ? [] : ["weeks_3_to_4_direct_lane_budget_missing"]),
    ...(headroom === null
      ? ["weeks_3_to_4_set_distribution_intent_missing"]
      : headroom
        ? []
        : ["session_size_or_lane_budget_headroom_not_visible"]),
    ...(hardBlocked ? ["selection_capacity_or_concentration_blocked"] : []),
    ...lanes.flatMap(({ week, lane }) =>
      lane.capacityStatus === "at_capacity"
        ? [
            `week_${week}:${input.policy.owningSlotId}:${lane.laneId}:at_capacity`,
          ]
        : [],
    ),
    "recoverability_is_diagnostic_only_not_selection_input",
  ]);

  if (!hasProjectedLane || headroom == null) {
    return { status: "not_evaluated", rationale, limitations };
  }
  if (hardBlocked || headroom === false) {
    return { status: "unrecoverable", rationale, limitations };
  }
  return { status: "recoverable", rationale, limitations };
}

function ownerSlots(policy: V2SupportLanePolicyRow): string[] {
  return uniqueSorted([
    policy.owningSlotId,
    ...(policy.optionalActivationRule.type === "conditional_under_support_floor"
      ? [policy.optionalActivationRule.slotId]
      : []),
  ]);
}

function buildMuscleRow(input: {
  policy: V2SupportLanePolicyRow;
  laneDiff: V2LaneDiffEvidence | undefined;
  weeklyTotal: WeeklyMuscleTotalLike | undefined;
  plannerOwnedAccumulationProjection: PlannerOwnedAccumulationProjection;
  v2SetDistributionIntent: V2SetDistributionIntent;
  v2ExerciseSelectionPlanDiagnostic: V2ExerciseSelectionPlanDiagnostic;
}): V2SupportLaneProjectionDiagnostic["muscles"][number] {
  const currentDirectSets = getDirectSets({
    policy: input.policy,
    laneDiff: input.laneDiff,
  });
  const directFloor = input.policy.directFloor.minDirectSets;
  const preferredDirectSets = input.policy.preferredDirectSets.preferred;
  const totalEffective =
    input.weeklyTotal?.projectedEffectiveSets ?? currentDirectSets;
  const collateralCreditUsed = Math.min(
    Math.max(0, totalEffective - currentDirectSets),
    input.policy.collateralCreditLimit.maxWeeklyEffectiveSetsCreditable,
  );
  const directStatus = directFloorStatus({
    directFloor,
    preferredDirectSets,
    currentDirectSets,
    laneDiff: input.laneDiff,
  });
  const recoverability = evaluateRecoverability({
    policy: input.policy,
    plannerOwnedAccumulationProjection:
      input.plannerOwnedAccumulationProjection,
    v2SetDistributionIntent: input.v2SetDistributionIntent,
    v2ExerciseSelectionPlanDiagnostic: input.v2ExerciseSelectionPlanDiagnostic,
  });
  const weeklyStatus = weeklyTargetStatus(input.weeklyTotal);
  const secondExposureProvisional =
    input.policy.muscle === "Rear Delts" ||
    input.policy.muscle === "Side Delts";
  const expansionNeeded =
    directStatus === "below" ||
    weeklyStatus === "below" ||
    input.policy.expansionPolicy.provisionalOrDiagnosticOnly.length > 0 ||
    secondExposureProvisional;
  const optionalEvaluation =
    input.policy.optionalActivationRule.type ===
    "conditional_under_support_floor"
      ? evaluateV2SupportLaneOptionalActivation({
          policy: input.policy,
          candidateSlotId: input.policy.optionalActivationRule.slotId,
          directSetsInOwningSlot: currentDirectSets,
          reasonableCollateralEffectiveSets: collateralCreditUsed,
          recoverable: recoverability.status === "recoverable",
        })
      : null;
  const optionalActivationStatus: V2SupportLaneProjectionDiagnostic["muscles"][number]["optionalActivationStatus"] =
    !optionalEvaluation
      ? "not_applicable"
      : optionalEvaluation.active
        ? "triggered_diagnostic_only"
        : optionalEvaluation.reason === "not_recoverable"
          ? "blocked"
          : "not_triggered";
  const expansionStatus: V2SupportLaneProjectionDiagnostic["muscles"][number]["expansionStatus"] =
    !expansionNeeded
      ? "none"
      : secondExposureProvisional
        ? "recommended_diagnostic_only"
        : recoverability.status === "unrecoverable"
          ? "unrecoverable"
          : recoverability.status === "recoverable" &&
              input.policy.expansionPolicy.provisionalOrDiagnosticOnly
                .length === 0
            ? "recoverable"
            : "recommended_diagnostic_only";

  return {
    muscle: input.policy.muscle,
    ownerSlots: ownerSlots(input.policy),
    directFloor,
    preferredDirectSets,
    currentDirectSets,
    collateralCreditUsed,
    collateralCreditLimit:
      input.policy.collateralCreditLimit.maxWeeklyEffectiveSetsCreditable,
    weeklyTargetStatus: weeklyStatus,
    directFloorStatus: directStatus,
    optionalActivationStatus,
    expansionStatus,
    rationale: uniqueSorted([
      "collateral_credit_applies_to_weekly_total_only",
      "direct_floor_satisfaction_uses_direct_lane_sets_only",
      ...input.policy.evidenceBasis,
      ...input.policy.rationaleLabels.map((label) => `policy:${label}`),
      ...recoverability.rationale,
      ...(optionalEvaluation
        ? [`optional_activation:${optionalEvaluation.reason}`]
        : []),
      ...(secondExposureProvisional
        ? ["second_exposure_remains_provisional_diagnostic_only"]
        : []),
      ...(!secondExposureProvisional &&
      input.policy.expansionPolicy.provisionalOrDiagnosticOnly.length > 0
        ? ["support_lane_expansion_remains_provisional_diagnostic_only"]
        : []),
    ]),
    limitations: uniqueSorted([
      ...input.policy.limitations,
      ...recoverability.limitations,
      ...(input.weeklyTotal ? [] : ["weekly_muscle_total_missing"]),
      ...(input.laneDiff ? [] : ["v2_target_vs_no_repair_direct_lane_missing"]),
      ...(input.policy.optionalActivationRule.type ===
      "conditional_under_support_floor"
        ? ["optional_activation_does_not_create_hard_floor"]
        : []),
      ...input.policy.expansionPolicy.provisionalOrDiagnosticOnly,
      ...(secondExposureProvisional
        ? ["delt_second_exposure_provisional_diagnostic_only"]
        : []),
    ]),
  };
}

export function buildV2SupportLaneProjectionDiagnostic(
  input: BuilderInput,
): V2SupportLaneProjectionDiagnostic {
  const laneDiffs = buildLaneDiffIndex(input.v2TargetVsNoRepairDiff);
  const weeklyTotals = new Map(
    input.weeklyMuscleTotals.map((row) => [row.muscle, row]),
  );
  const missingInputs = uniqueSorted([
    ...(input.v2SupportLanePolicy.supportLanes.length === 0
      ? ["v2SupportLanePolicy:supportLanes:missing"]
      : []),
    ...(input.plannerOwnedAccumulationProjection.weeks.length === 0
      ? ["plannerOwnedAccumulationProjection:weeks_2_to_4:missing"]
      : []),
    ...(input.v2SetDistributionIntent.weeks.length === 0
      ? ["v2SetDistributionIntent:weeks:missing"]
      : []),
    ...(input.week1SelectedIdentities.length === 0
      ? ["week_1_selected_identities:not_visible"]
      : []),
  ]);
  const muscles = input.v2SupportLanePolicy.supportLanes.map((policy) =>
    buildMuscleRow({
      policy,
      laneDiff: laneDiffs.get(
        laneKey(policy.owningSlotId, policy.owningLaneId),
      ),
      weeklyTotal: weeklyTotals.get(policy.muscle),
      plannerOwnedAccumulationProjection:
        input.plannerOwnedAccumulationProjection,
      v2SetDistributionIntent: input.v2SetDistributionIntent,
      v2ExerciseSelectionPlanDiagnostic:
        input.v2ExerciseSelectionPlanDiagnostic,
    }),
  );
  const blockers = uniqueSorted([
    ...muscles.flatMap((row) =>
      row.expansionStatus === "unrecoverable"
        ? [`${row.muscle}:expansion_unrecoverable`]
        : [],
    ),
  ]);
  const warnings = uniqueSorted([
    ...muscles.flatMap((row) =>
      row.directFloorStatus === "below"
        ? [`${row.muscle}:direct_floor_below_collateral_not_counted`]
        : [],
    ),
    ...muscles.flatMap((row) =>
      row.optionalActivationStatus === "triggered_diagnostic_only"
        ? [`${row.muscle}:optional_activation_triggered_diagnostic_only`]
        : [],
    ),
    ...muscles.flatMap((row) =>
      row.rationale.includes(
        "second_exposure_remains_provisional_diagnostic_only",
      )
        ? [`${row.muscle}:second_exposure_provisional_diagnostic_only`]
        : [],
    ),
    ...muscles.flatMap((row) =>
      row.rationale.includes(
        "support_lane_expansion_remains_provisional_diagnostic_only",
      )
        ? [`${row.muscle}:support_lane_expansion_provisional_diagnostic_only`]
        : [],
    ),
    "safeForBehaviorPromotion:false",
    "diagnostic_does_not_feed_selection_repair_seed_or_runtime",
  ]);
  const directFloorsMet = muscles.filter(
    (row) =>
      row.directFloorStatus === "met" ||
      row.directFloorStatus === "above_preferred",
  ).length;
  const expansionRecommendations = muscles.filter((row) =>
    ["recommended_diagnostic_only", "recoverable", "unrecoverable"].includes(
      row.expansionStatus,
    ),
  ).length;
  const status: V2SupportLaneProjectionDiagnostic["status"] =
    missingInputs.includes("v2SupportLanePolicy:supportLanes:missing") ||
    missingInputs.includes(
      "plannerOwnedAccumulationProjection:weeks_2_to_4:missing",
    )
      ? "blocked"
      : missingInputs.length > 0 || blockers.length > 0 || warnings.length > 0
        ? "projected_with_limitations"
        : "diagnostic_only";

  return {
    version: 1,
    source: "v2_planner_policy",
    readOnly: true,
    affectsScoringOrGeneration: false,
    status,
    summary: {
      supportMusclesEvaluated: muscles.length,
      directFloorsMet,
      directFloorsBelow: muscles.filter(
        (row) => row.directFloorStatus === "below",
      ).length,
      optionalActivations: muscles.filter(
        (row) => row.optionalActivationStatus === "triggered_diagnostic_only",
      ).length,
      expansionRecommendations,
      unrecoverableExpansions: muscles.filter(
        (row) => row.expansionStatus === "unrecoverable",
      ).length,
      diagnosticOnlyWarnings: warnings.length,
    },
    muscles,
    blockers,
    warnings,
    missingInputs,
    safeForBehaviorPromotion: false,
  };
}
