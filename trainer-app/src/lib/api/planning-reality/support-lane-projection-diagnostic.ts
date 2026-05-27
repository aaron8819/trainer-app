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
    supportPolicyMissCount: number;
    setBudgetAuthoredCount: number;
    authoredDroppedCount: number;
    selectionPreservedCount: number;
    highRiskDroppedCount: number;
    diagnosticOnlyWarnings: number;
  };
  laneBoundaryRows: Array<{
    muscle: SupportMuscle;
    slotId: string;
    laneId: string;
    laneKind: "direct_floor" | "optional_top_up";
    supportPolicyAuthored: boolean;
    setDistributionBudgeted: boolean;
    setBudget: { min: number; preferred: number; max: number } | null;
    exerciseSelectionPreserved: boolean;
    exerciseSelectionStatus:
      | "preserved"
      | "candidate_available"
      | "missing_candidate"
      | "duplicate_requires_justification"
      | "class_mismatch"
      | "not_evaluated";
    weeklyTargetStatus: "below" | "within" | "above" | "unknown";
    projectedEffectiveSets: number | null;
    mevFloor: number | null;
    likelyOwnerSeam:
      | "support_lane_policy"
      | "set_distribution_intent"
      | "materializer_exercise_selection_capacity"
      | "none"
      | "not_evaluated";
    status:
      | "policy_miss"
      | "set_budget_missing"
      | "authored_support_lane_dropped"
      | "support_lane_preserved"
      | "not_evaluated";
    severity: "pass" | "info" | "warning" | "high_risk";
    mustFixBeforeWeek1: boolean;
    evidence: string[];
    limitations: string[];
  }>;
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

type BoundaryRow = V2SupportLaneProjectionDiagnostic["laneBoundaryRows"][number];
type IntentLane =
  V2SetDistributionIntent["weeks"][number]["slots"][number]["lanes"][number];
type SelectionLane =
  V2ExerciseSelectionPlanDiagnostic["weeks"][number]["slots"][number]["lanes"][number];

function uniqueSorted(values: ReadonlyArray<string>): string[] {
  return Array.from(new Set(values.filter((value) => value.length > 0))).sort(
    (left, right) => left.localeCompare(right),
  );
}

function laneKey(slotId: string, laneId: string): string {
  return `${slotId}:${laneId}`;
}

function isSupportMuscle(value: string): value is SupportMuscle {
  return (
    value === "Triceps" ||
    value === "Side Delts" ||
    value === "Rear Delts" ||
    value === "Biceps"
  );
}

function representativeIntentLaneIndex(
  intent: V2SetDistributionIntent,
): Map<string, IntentLane> {
  const week =
    intent.weeks.find((row) => row.week === 1) ??
    intent.weeks.find((row) => row.week >= 1 && row.week <= 4);
  const index = new Map<string, IntentLane>();
  for (const slot of week?.slots ?? []) {
    for (const lane of slot.lanes) {
      index.set(laneKey(slot.slotId, lane.laneId), lane);
    }
  }
  return index;
}

function representativeIntentSupportRows(
  intent: V2SetDistributionIntent,
): BoundaryRow[] {
  const week =
    intent.weeks.find((row) => row.week === 1) ??
    intent.weeks.find((row) => row.week >= 1 && row.week <= 4);
  const rows: BoundaryRow[] = [];
  for (const slot of week?.slots ?? []) {
    for (const lane of slot.lanes) {
      const directMuscle = lane.directFloor?.muscle;
      const muscles = uniqueSorted([
        ...(directMuscle && isSupportMuscle(directMuscle) ? [directMuscle] : []),
        ...lane.optionalMuscles.filter(isSupportMuscle),
      ]) as SupportMuscle[];
      for (const muscle of muscles) {
        rows.push({
          muscle,
          slotId: slot.slotId,
          laneId: lane.laneId,
          laneKind: lane.role === "optional" ? "optional_top_up" : "direct_floor",
          supportPolicyAuthored: false,
          setDistributionBudgeted: false,
          setBudget: null,
          exerciseSelectionPreserved: false,
          exerciseSelectionStatus: "not_evaluated",
          weeklyTargetStatus: "unknown",
          projectedEffectiveSets: null,
          mevFloor: null,
          likelyOwnerSeam: "not_evaluated",
          status: "not_evaluated",
          severity: "info",
          mustFixBeforeWeek1: false,
          evidence: [],
          limitations: [],
        });
      }
    }
  }
  return rows;
}

function buildSelectionLaneIndex(
  diagnostic: V2ExerciseSelectionPlanDiagnostic,
): Map<string, SelectionLane> {
  const index = new Map<string, SelectionLane>();
  for (const week of diagnostic.weeks) {
    if (week.week !== 1) {
      continue;
    }
    for (const slot of week.slots) {
      for (const lane of slot.lanes) {
        index.set(laneKey(slot.slotId, lane.laneId), lane);
      }
    }
  }
  return index;
}

function boundaryPolicyRows(
  policy: V2SupportLanePolicy,
): BoundaryRow[] {
  return policy.supportLanes.flatMap((row) => {
    const directRow: BoundaryRow = {
      muscle: row.muscle,
      slotId: row.owningSlotId,
      laneId: row.owningLaneId,
      laneKind: "direct_floor",
      supportPolicyAuthored: true,
      setDistributionBudgeted: false,
      setBudget: null,
      exerciseSelectionPreserved: false,
      exerciseSelectionStatus: "not_evaluated",
      weeklyTargetStatus: "unknown",
      projectedEffectiveSets: null,
      mevFloor: null,
      likelyOwnerSeam: "not_evaluated",
      status: "not_evaluated",
      severity: "info",
      mustFixBeforeWeek1: false,
      evidence: [],
      limitations: [],
    };
    if (row.optionalActivationRule.type !== "conditional_under_support_floor") {
      return [directRow];
    }
    return [
      directRow,
      {
        ...directRow,
        slotId: row.optionalActivationRule.slotId,
        laneId: row.optionalActivationRule.laneId,
        laneKind: "optional_top_up",
      },
    ];
  });
}

function boundaryKey(row: Pick<BoundaryRow, "slotId" | "laneId" | "muscle">): string {
  return `${row.slotId}:${row.laneId}:${row.muscle}`;
}

function selectedByLaneDiff(
  laneDiff: V2LaneDiffEvidence | undefined,
): boolean {
  return Boolean(laneDiff?.currentEvidence.selectedExercises.length);
}

function buildLaneBoundaryRows(input: {
  v2SupportLanePolicy: V2SupportLanePolicy;
  v2SetDistributionIntent: V2SetDistributionIntent;
  v2ExerciseSelectionPlanDiagnostic: V2ExerciseSelectionPlanDiagnostic;
  laneDiffs: ReadonlyMap<string, V2LaneDiffEvidence>;
  weeklyTotals: ReadonlyMap<string, WeeklyMuscleTotalLike>;
}): BoundaryRow[] {
  const intentLanes = representativeIntentLaneIndex(input.v2SetDistributionIntent);
  const selectionLanes = buildSelectionLaneIndex(
    input.v2ExerciseSelectionPlanDiagnostic,
  );
  const rows = new Map<string, BoundaryRow>();
  for (const row of boundaryPolicyRows(input.v2SupportLanePolicy)) {
    rows.set(boundaryKey(row), row);
  }
  for (const row of representativeIntentSupportRows(input.v2SetDistributionIntent)) {
    if (!rows.has(boundaryKey(row))) {
      rows.set(boundaryKey(row), row);
    }
  }

  return Array.from(rows.values())
    .map((row) => {
      const intentLane = intentLanes.get(laneKey(row.slotId, row.laneId));
      const selectionLane = selectionLanes.get(laneKey(row.slotId, row.laneId));
      const laneDiff = input.laneDiffs.get(laneKey(row.slotId, row.laneId));
      const weeklyTotal = input.weeklyTotals.get(row.muscle);
      const setDistributionBudgeted = Boolean(
        intentLane &&
          (intentLane.setBudget.min > 0 ||
            intentLane.setBudget.preferred > 0 ||
            intentLane.setBudget.max > 0),
      );
      const exerciseSelectionPreserved = Boolean(
        selectionLane?.selectedIdentity || selectedByLaneDiff(laneDiff),
      );
      const weeklyStatus = weeklyTargetStatus(weeklyTotal);
      const projectedEffectiveSets = weeklyTotal?.projectedEffectiveSets ?? null;
      const mevFloor = weeklyTotal?.targetMin ?? null;
      const belowFloor =
        weeklyStatus === "below" &&
        mevFloor != null &&
        projectedEffectiveSets != null &&
        projectedEffectiveSets < mevFloor;
      const status: BoundaryRow["status"] = !row.supportPolicyAuthored
        ? "policy_miss"
        : !setDistributionBudgeted
          ? "set_budget_missing"
          : !exerciseSelectionPreserved
            ? "authored_support_lane_dropped"
            : "support_lane_preserved";
      const likelyOwnerSeam: BoundaryRow["likelyOwnerSeam"] =
        status === "policy_miss"
          ? "support_lane_policy"
          : status === "set_budget_missing"
            ? "set_distribution_intent"
            : status === "authored_support_lane_dropped"
              ? "materializer_exercise_selection_capacity"
              : "none";
      const severity: BoundaryRow["severity"] =
        status === "support_lane_preserved"
          ? "pass"
          : belowFloor
            ? "high_risk"
            : status === "authored_support_lane_dropped"
              ? "warning"
              : "warning";

      return {
        ...row,
        setDistributionBudgeted,
        setBudget: intentLane
          ? {
              min: intentLane.setBudget.min,
              preferred: intentLane.setBudget.preferred,
              max: intentLane.setBudget.max,
            }
          : null,
        exerciseSelectionPreserved,
        exerciseSelectionStatus:
          selectionLane?.identityStatus ??
          (selectedByLaneDiff(laneDiff) ? "preserved" : "not_evaluated"),
        weeklyTargetStatus: weeklyStatus,
        projectedEffectiveSets,
        mevFloor,
        likelyOwnerSeam,
        status,
        severity,
        mustFixBeforeWeek1:
          status !== "support_lane_preserved" && belowFloor,
        evidence: uniqueSorted([
          `supportPolicyAuthored:${row.supportPolicyAuthored ? "yes" : "no"}`,
          `setDistributionBudgeted:${setDistributionBudgeted ? "yes" : "no"}`,
          `exerciseSelectionPreserved:${exerciseSelectionPreserved ? "yes" : "no"}`,
          `weeklyTargetStatus:${weeklyStatus}`,
          `status:${status}`,
          ...(selectionLane?.capacityStatus
            ? [`selectionCapacityStatus:${selectionLane.capacityStatus}`]
            : []),
          ...(laneDiff?.currentEvidence.relevantDiagnostics ?? []),
        ]),
        limitations: uniqueSorted([
          "diagnostic_only_not_selection_or_materializer_input",
          ...(intentLane ? [] : ["set_distribution_lane_missing"]),
          ...(selectionLane ? [] : ["exercise_selection_lane_missing"]),
          ...(status === "authored_support_lane_dropped"
            ? ["authored_budget_not_preserved_after_exercise_selection"]
            : []),
        ]),
      };
    })
    .sort(
      (left, right) =>
        left.slotId.localeCompare(right.slotId) ||
        left.laneId.localeCompare(right.laneId) ||
        left.muscle.localeCompare(right.muscle),
    );
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
  const laneBoundaryRows = buildLaneBoundaryRows({
    v2SupportLanePolicy: input.v2SupportLanePolicy,
    v2SetDistributionIntent: input.v2SetDistributionIntent,
    v2ExerciseSelectionPlanDiagnostic:
      input.v2ExerciseSelectionPlanDiagnostic,
    laneDiffs,
    weeklyTotals,
  });
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
    ...laneBoundaryRows.flatMap((row) =>
      row.status === "authored_support_lane_dropped"
        ? [
            `${row.muscle}:${row.slotId}:${row.laneId}:authored_support_lane_dropped`,
          ]
        : [],
    ),
    ...laneBoundaryRows.flatMap((row) =>
      row.status === "policy_miss"
        ? [`${row.muscle}:${row.slotId}:${row.laneId}:support_policy_miss`]
        : [],
    ),
    ...laneBoundaryRows.flatMap((row) =>
      row.status === "set_budget_missing"
        ? [`${row.muscle}:${row.slotId}:${row.laneId}:set_budget_missing`]
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
      supportPolicyMissCount: laneBoundaryRows.filter(
        (row) => row.status === "policy_miss",
      ).length,
      setBudgetAuthoredCount: laneBoundaryRows.filter(
        (row) => row.setDistributionBudgeted,
      ).length,
      authoredDroppedCount: laneBoundaryRows.filter(
        (row) => row.status === "authored_support_lane_dropped",
      ).length,
      selectionPreservedCount: laneBoundaryRows.filter(
        (row) => row.exerciseSelectionPreserved,
      ).length,
      highRiskDroppedCount: laneBoundaryRows.filter(
        (row) =>
          row.status === "authored_support_lane_dropped" &&
          row.severity === "high_risk",
      ).length,
      diagnosticOnlyWarnings: warnings.length,
    },
    laneBoundaryRows,
    muscles,
    blockers,
    warnings,
    missingInputs,
    safeForBehaviorPromotion: false,
  };
}
