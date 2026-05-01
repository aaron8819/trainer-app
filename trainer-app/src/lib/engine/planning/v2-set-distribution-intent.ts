import type { V2SupportLanePolicy } from "./v2/support-lane-policy";
import type {
  V2ExerciseClassDistributionBySlot,
  V2PlannerSetRange,
  V2SlotDemandAllocationByWeek,
} from "./v2/types";

export type V2SetDistributionIntentSlotId =
  | "upper_a"
  | "lower_a"
  | "upper_b"
  | "lower_b";

export type V2SetDistributionIntentPhase =
  | "entry_calibration"
  | "accumulation"
  | "hard_accumulation"
  | "peak_overreach_lite"
  | "deload";

export type V2SetDistributionIntentLaneRole =
  | "anchor"
  | "support"
  | "accessory"
  | "optional";

type V2SetDistributionIntentClassLaneKind =
  V2ExerciseClassDistributionBySlot["weeks"][number]["slots"][number]["classLanes"][number]["classLaneKind"];

type V2SetDistributionIntentOwnershipKind =
  V2ExerciseClassDistributionBySlot["weeks"][number]["slots"][number]["classLanes"][number]["ownershipRows"][number]["ownershipKind"];

export type V2SetDistributionIntent = {
  version: 1;
  source: "v2_planner_policy";
  readOnly: true;
  affectsScoringOrGeneration: false;

  summary: {
    weekCount: number;
    slotCount: number;
    laneCount: number;
    plannedTotalSetsByWeek: Array<{
      week: number;
      totalSets: number;
      volumeMultiplier: number;
      phase: string;
    }>;
  };

  weeks: Array<{
    week: number;
    phase: V2SetDistributionIntentPhase;
    volumeMultiplier: number;
    rirTarget: string;

    slots: Array<{
      slotId: V2SetDistributionIntentSlotId;
      slotIntent: string;
      targetSessionSets: { min: number; preferred: number; max: number };

      lanes: Array<{
        laneId: string;
        role: V2SetDistributionIntentLaneRole;
        classLaneKind: V2SetDistributionIntentClassLaneKind;
        primaryMuscles: string[];
        supportMuscles: string[];
        optionalMuscles: string[];
        managedCollateralMuscles: string[];
        preferredExerciseClasses: string[];
        requiredExerciseClasses: string[];
        allocatedTargetSetRange: V2PlannerSetRange;
        ownershipKinds: V2SetDistributionIntentOwnershipKind[];

        setBudget: {
          min: number;
          preferred: number;
          max: number;
          basis:
            | "class_ownership_allocation"
            | "support_direct_floor"
            | "optional_activation_required"
            | "managed_collateral_budget"
            | "deload_transform";
        };

        directFloor?: {
          muscle: string;
          minDirectSets: number;
          collateralCanSatisfy: false;
        };

        optionalActivation?: {
          type: "activate_only_if_weekly_target_below_range";
          weeklyFloorSets: number;
          requiresSlotExerciseHeadroom: true;
          requiresCleanAlternative: true;
          requiresRecoverability: true;
        };

        capPolicy: {
          maxSetsPerExerciseWithoutJustification: number;
          maxDirectExercises: number;
          allowAboveFiveSetsOnlyWithJustification: boolean;
        };

        concentrationPolicy: {
          warningShare: number;
          blockerShare: number;
          appliesTo:
            | "primary_target"
            | "support_target"
            | "diagnostic_only";
        };

        evidenceBasis: string[];
      }>;
    }>;
  }>;

  guardrails: {
    doesNotUseRepairedProjectionAsTarget: true;
    doesNotUseAcceptedSeedAsTarget: true;
    doesNotAffectSelection: true;
    doesNotAffectRepair: true;
    doesNotAffectSeedSerialization: true;
    doesNotAffectRuntimeReplay: true;
  };
};

export type V2SetDistributionIntentInput = {
  slotDemandAllocationByWeek: V2SlotDemandAllocationByWeek;
  exerciseClassDistributionBySlot: V2ExerciseClassDistributionBySlot;
  v2SupportLanePolicy: V2SupportLanePolicy;
  weeklyProgressionModel: {
    weeks: ReadonlyArray<{
      week: number;
      phase: V2SetDistributionIntentPhase;
      volumeMultiplier: number | null;
      rirTarget: string;
    }>;
  };
};

type ClassSlot =
  V2ExerciseClassDistributionBySlot["weeks"][number]["slots"][number];
type ClassLane = ClassSlot["classLanes"][number];
type OwnershipRow = ClassLane["ownershipRows"][number];
type IntentLane =
  V2SetDistributionIntent["weeks"][number]["slots"][number]["lanes"][number];
type SupportLane = V2SupportLanePolicy["supportLanes"][number];
type OptionalActivationRule =
  V2SupportLanePolicy["supportLanes"][number]["optionalActivationRule"];

const ZERO_SET_RANGE: V2PlannerSetRange = { min: 0, preferred: 0, max: 0 };

function roundSetCount(value: number): number {
  return Math.max(0, Math.round(value));
}

function normalizeMultiplier(value: number | null): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function uniqueSorted<T extends string>(values: ReadonlyArray<T>): T[] {
  return Array.from(new Set(values)).sort((left, right) =>
    left.localeCompare(right),
  );
}

function laneKey(slotId: string, laneId: string): string {
  return `${slotId}:${laneId}`;
}

function slotWeekKey(week: number, slotId: string): string {
  return `${week}:${slotId}`;
}

function supportLaneIndex(
  policy: V2SupportLanePolicy,
): Map<string, SupportLane> {
  const index = new Map<string, SupportLane>();
  for (const row of policy.supportLanes) {
    index.set(laneKey(row.owningSlotId, row.owningLaneId), row);
  }
  return index;
}

function optionalActivationIndex(
  policy: V2SupportLanePolicy,
): Map<string, OptionalActivationRule> {
  const index = new Map<string, OptionalActivationRule>();
  for (const row of policy.supportLanes) {
    const rule = row.optionalActivationRule;
    if (rule.type === "conditional_under_support_floor") {
      index.set(laneKey(rule.slotId, rule.laneId), rule);
    }
  }
  return index;
}

function allocationSlotIndex(
  allocation: V2SlotDemandAllocationByWeek,
): Map<
  string,
  V2SlotDemandAllocationByWeek["weeks"][number]["slots"][number]
> {
  const index = new Map<
    string,
    V2SlotDemandAllocationByWeek["weeks"][number]["slots"][number]
  >();
  for (const week of allocation.weeks) {
    for (const slot of week.slots) {
      index.set(slotWeekKey(week.week, slot.slotId), slot);
    }
  }
  return index;
}

function progressionWeekIndex(
  input: V2SetDistributionIntentInput["weeklyProgressionModel"],
): Map<number, V2SetDistributionIntentInput["weeklyProgressionModel"]["weeks"][number]> {
  return new Map(input.weeks.map((week) => [week.week, week]));
}

function positiveOwnershipRows(lane: ClassLane): OwnershipRow[] {
  return lane.ownershipRows.filter(
    (row) =>
      row.ownershipKind !== "managed_collateral" &&
      row.ownershipKind !== "optional_if_needed" &&
      row.targetSetRange.max > 0,
  );
}

function driverRows(lane: ClassLane): OwnershipRow[] {
  const positiveRows = positiveOwnershipRows(lane);
  const primaryRows = positiveRows.filter(
    (row) => row.ownershipKind === "primary_exposure",
  );
  if (primaryRows.length > 0) {
    return primaryRows;
  }
  const directRows = positiveRows.filter(
    (row) => row.ownershipKind === "direct_support",
  );
  if (directRows.length > 0) {
    return directRows;
  }
  return positiveRows;
}

function maxRangeForRows(rows: ReadonlyArray<OwnershipRow>): V2PlannerSetRange {
  return rows.reduce(
    (maxRange, row) => ({
      min: Math.max(maxRange.min, row.targetSetRange.min),
      preferred: Math.max(maxRange.preferred, row.targetSetRange.preferred),
      max: Math.max(maxRange.max, row.targetSetRange.max),
    }),
    ZERO_SET_RANGE,
  );
}

function hasClassIntent(lane: ClassLane, classIntent: string): boolean {
  return lane.classIntents.includes(classIntent);
}

function isManagedCollateralLane(lane: ClassLane): boolean {
  return lane.classLaneKind === "managed_collateral_marker";
}

function isOptionalLane(lane: ClassLane): boolean {
  return lane.classLaneKind === "optional_recoverable_lane";
}

function isLowDoseHingeSupport(lane: ClassLane): boolean {
  return hasClassIntent(lane, "low_dose_hinge_support");
}

function isCalfDirectLane(lane: ClassLane): boolean {
  return hasClassIntent(lane, "calf_isolation");
}

function hasHardTargetOwnership(rows: ReadonlyArray<OwnershipRow>): boolean {
  return rows.some((row) => row.targetStatus === "hard");
}

function preferredCap(input: {
  lane: ClassLane;
  directSupportPolicy: SupportLane | undefined;
  driverRange: V2PlannerSetRange;
  phase: V2SetDistributionIntentPhase;
}): number {
  if (isManagedCollateralLane(input.lane) || isOptionalLane(input.lane)) {
    return 0;
  }
  if (input.phase === "deload") {
    return input.lane.role === "optional" ? 0 : 3;
  }
  if (isLowDoseHingeSupport(input.lane)) {
    return 1;
  }
  if (input.directSupportPolicy) {
    return Math.min(4, input.directSupportPolicy.preferredDirectSets.preferred);
  }
  if (isCalfDirectLane(input.lane)) {
    return 4;
  }
  if (input.lane.role === "anchor") {
    return 4;
  }
  if (
    input.lane.classLaneKind === "support_class_lane" &&
    hasHardTargetOwnership(driverRows(input.lane)) &&
    input.driverRange.preferred >= 3.5
  ) {
    return 4;
  }
  return 3;
}

function minimumFloor(input: {
  lane: ClassLane;
  directSupportPolicy: SupportLane | undefined;
  preferred: number;
  phase: V2SetDistributionIntentPhase;
}): number {
  if (input.preferred <= 0) {
    return 0;
  }
  if (input.phase === "deload") {
    return Math.min(input.preferred, Math.max(1, Math.floor(input.preferred)));
  }
  if (isLowDoseHingeSupport(input.lane)) {
    return 1;
  }
  if (input.directSupportPolicy) {
    return Math.min(
      input.preferred,
      input.directSupportPolicy.directFloor.minDirectSets,
    );
  }
  if (isCalfDirectLane(input.lane)) {
    return Math.min(input.preferred, 3);
  }
  if (input.lane.role === "anchor") {
    return Math.min(input.preferred, 3);
  }
  return Math.min(input.preferred, 2);
}

function buildSetBudget(input: {
  lane: ClassLane;
  directSupportPolicy: SupportLane | undefined;
  phase: V2SetDistributionIntentPhase;
}): IntentLane["setBudget"] {
  if (isManagedCollateralLane(input.lane)) {
    return {
      ...ZERO_SET_RANGE,
      basis:
        input.phase === "deload"
          ? "deload_transform"
          : "managed_collateral_budget",
    };
  }
  if (isOptionalLane(input.lane)) {
    return {
      ...ZERO_SET_RANGE,
      basis:
        input.phase === "deload"
          ? "deload_transform"
          : "optional_activation_required",
    };
  }

  const drivers = driverRows(input.lane);
  const driverRange = maxRangeForRows(drivers);
  const cap = preferredCap({
    lane: input.lane,
    directSupportPolicy: input.directSupportPolicy,
    driverRange,
    phase: input.phase,
  });
  const basePreferred = isLowDoseHingeSupport(input.lane)
    ? 1
    : input.phase !== "deload" && input.directSupportPolicy
      ? input.directSupportPolicy.preferredDirectSets.preferred
      : roundSetCount(driverRange.preferred);
  const preferred = clamp(basePreferred, 0, cap);
  const min = minimumFloor({
    lane: input.lane,
    directSupportPolicy: input.directSupportPolicy,
    preferred,
    phase: input.phase,
  });
  const max =
    preferred === 0
      ? 0
      : clamp(roundSetCount(driverRange.max), preferred, cap);

  return {
    min,
    preferred,
    max,
    basis:
      input.phase === "deload"
        ? "deload_transform"
        : input.directSupportPolicy
          ? "support_direct_floor"
          : "class_ownership_allocation",
  };
}

function directFloorForLane(
  policy: SupportLane | undefined,
): IntentLane["directFloor"] | undefined {
  if (!policy) {
    return undefined;
  }
  return {
    muscle: policy.muscle,
    minDirectSets: policy.directFloor.minDirectSets,
    collateralCanSatisfy: false,
  };
}

function optionalActivationForLane(
  rule: OptionalActivationRule | undefined,
): IntentLane["optionalActivation"] | undefined {
  if (!rule || rule.type !== "conditional_under_support_floor") {
    return undefined;
  }
  return {
    type: "activate_only_if_weekly_target_below_range",
    weeklyFloorSets: rule.weeklySupportFloor,
    requiresSlotExerciseHeadroom: true,
    requiresCleanAlternative: true,
    requiresRecoverability: true,
  };
}

function capPolicyForLane(
  lane: ClassLane,
): IntentLane["capPolicy"] {
  return {
    maxSetsPerExerciseWithoutJustification:
      lane.role === "optional" ? 3 : 4,
    maxDirectExercises:
      lane.role === "anchor" || lane.role === "support" ? 2 : 1,
    allowAboveFiveSetsOnlyWithJustification: true,
  };
}

function concentrationPolicyForLane(
  lane: ClassLane,
): IntentLane["concentrationPolicy"] {
  if (isManagedCollateralLane(lane) || isOptionalLane(lane)) {
    return {
      warningShare: 0.65,
      blockerShare: 0.8,
      appliesTo: "diagnostic_only",
    };
  }
  if (lane.classLaneKind === "owned_class_lane" || lane.role === "anchor") {
    return {
      warningShare: 0.5,
      blockerShare: 0.6,
      appliesTo: "primary_target",
    };
  }
  return {
    warningShare: 0.6,
    blockerShare: 0.75,
    appliesTo: "support_target",
  };
}

function evidenceBasis(input: {
  lane: ClassLane;
  directSupportPolicy: SupportLane | undefined;
  optionalActivation: IntentLane["optionalActivation"] | undefined;
}): string[] {
  return uniqueSorted([
    "exercise_class_distribution_by_slot",
    "slot_demand_allocation_ownership_rows",
    "allocated_target_set_range",
    "session_capacity_policy",
    "per_lane_concentration_cap_policy",
    "ignores_no_repair_repaired_seed_runtime_output",
    ...(input.directSupportPolicy ? ["support_lane_policy_direct_floor"] : []),
    ...(input.optionalActivation ? ["optional_activation_rule_not_met_by_default"] : []),
    ...(isOptionalLane(input.lane) ? ["optional_lane_zero_until_activation"] : []),
    ...(isManagedCollateralLane(input.lane)
      ? ["managed_collateral_zero_direct_set_budget"]
      : []),
  ]);
}

function buildLane(input: {
  slotId: V2SetDistributionIntentSlotId;
  lane: ClassLane;
  directSupportPolicy: SupportLane | undefined;
  optionalActivationRule: OptionalActivationRule | undefined;
  phase: V2SetDistributionIntentPhase;
}): IntentLane {
  const optionalActivation = optionalActivationForLane(
    input.optionalActivationRule,
  );
  return {
    laneId: input.lane.laneId,
    role: input.lane.role,
    classLaneKind: input.lane.classLaneKind,
    primaryMuscles: uniqueSorted([
      ...input.lane.primaryMuscles,
      ...input.lane.supportMuscles,
    ]),
    supportMuscles: [...input.lane.supportMuscles],
    optionalMuscles: [...input.lane.optionalMuscles],
    managedCollateralMuscles: [...input.lane.managedCollateralMuscles],
    preferredExerciseClasses: [...input.lane.preferredExerciseClasses],
    requiredExerciseClasses: [...input.lane.requiredExerciseClasses],
    allocatedTargetSetRange: { ...input.lane.allocatedTargetSetRange },
    ownershipKinds: uniqueSorted(
      input.lane.ownershipRows.map((row) => row.ownershipKind),
    ),
    setBudget: buildSetBudget({
      lane: input.lane,
      directSupportPolicy: input.directSupportPolicy,
      phase: input.phase,
    }),
    ...(input.phase !== "deload" && input.directSupportPolicy
      ? { directFloor: directFloorForLane(input.directSupportPolicy) }
      : {}),
    ...(optionalActivation ? { optionalActivation } : {}),
    capPolicy: capPolicyForLane(input.lane),
    concentrationPolicy: concentrationPolicyForLane(input.lane),
    evidenceBasis: evidenceBasis({
      lane: input.lane,
      directSupportPolicy: input.directSupportPolicy,
      optionalActivation,
    }),
  };
}

function laneReductionPriority(lane: IntentLane): number {
  if (lane.role === "optional" || lane.classLaneKind === "optional_recoverable_lane") {
    return 0;
  }
  if (lane.classLaneKind === "managed_collateral_marker") {
    return 1;
  }
  if (lane.role === "accessory") {
    return 2;
  }
  if (lane.role === "support") {
    return 3;
  }
  return 4;
}

function trimLanePreferredToCapacity(
  lanes: IntentLane[],
  maxSessionSets: number,
): IntentLane[] {
  let excess =
    lanes.reduce((sum, lane) => sum + lane.setBudget.preferred, 0) -
    maxSessionSets;
  if (excess <= 0) {
    return lanes;
  }
  const next = lanes.map((lane) => ({
    ...lane,
    setBudget: { ...lane.setBudget },
  }));

  while (excess > 0) {
    const candidate = [...next]
      .filter((lane) => lane.setBudget.preferred > lane.setBudget.min)
      .sort(
        (left, right) =>
          laneReductionPriority(left) - laneReductionPriority(right) ||
          right.setBudget.preferred - left.setBudget.preferred ||
          left.laneId.localeCompare(right.laneId),
      )[0];
    if (!candidate) {
      break;
    }
    candidate.setBudget.preferred -= 1;
    candidate.setBudget.max = Math.max(
      candidate.setBudget.preferred,
      candidate.setBudget.max - 1,
    );
    excess -= 1;
  }

  return next;
}

function sumBudget(
  lanes: ReadonlyArray<IntentLane>,
  key: keyof V2PlannerSetRange,
): number {
  return lanes.reduce((sum, lane) => sum + lane.setBudget[key], 0);
}

function targetSessionSets(input: {
  allocationSlot:
    | V2SlotDemandAllocationByWeek["weeks"][number]["slots"][number]
    | undefined;
  lanes: ReadonlyArray<IntentLane>;
}): V2PlannerSetRange {
  const laneMin = sumBudget(input.lanes, "min");
  const lanePreferred = sumBudget(input.lanes, "preferred");
  const laneMax = sumBudget(input.lanes, "max");
  const capacityMax = input.allocationSlot?.targetSessionSets.max ?? laneMax;
  const max = Math.min(capacityMax, laneMax);
  const min = Math.min(input.allocationSlot?.targetSessionSets.min ?? laneMin, max);
  const preferred = clamp(lanePreferred, min, max);
  return {
    min,
    preferred,
    max,
  };
}

export function buildV2SetDistributionIntent(
  input: V2SetDistributionIntentInput,
): V2SetDistributionIntent {
  const directSupportByLane = supportLaneIndex(input.v2SupportLanePolicy);
  const optionalActivationByLane = optionalActivationIndex(
    input.v2SupportLanePolicy,
  );
  const allocationBySlot = allocationSlotIndex(input.slotDemandAllocationByWeek);
  const progressionByWeek = progressionWeekIndex(input.weeklyProgressionModel);

  const intentWeeks = input.exerciseClassDistributionBySlot.weeks.map((week) => {
    const progression = progressionByWeek.get(week.week);
    const multiplier = normalizeMultiplier(progression?.volumeMultiplier ?? null);
    const phase = (progression?.phase ?? week.phase) as V2SetDistributionIntentPhase;
    const slots = week.slots.map((slot) => {
      const allocationSlot = allocationBySlot.get(slotWeekKey(week.week, slot.slotId));
      const rawLanes = slot.classLanes.map((lane) =>
        buildLane({
          slotId: slot.slotId,
          lane,
          directSupportPolicy: directSupportByLane.get(
            laneKey(slot.slotId, lane.laneId),
          ),
          optionalActivationRule: optionalActivationByLane.get(
            laneKey(slot.slotId, lane.laneId),
          ),
          phase,
        }),
      );
      const lanes = trimLanePreferredToCapacity(
        rawLanes,
        allocationSlot?.targetSessionSets.max ?? sumBudget(rawLanes, "preferred"),
      );

      return {
        slotId: slot.slotId,
        slotIntent: slot.intent,
        targetSessionSets: targetSessionSets({ allocationSlot, lanes }),
        lanes,
      };
    });

    return {
      week: week.week,
      phase,
      volumeMultiplier: multiplier,
      rirTarget: progression?.rirTarget ?? "",
      slots,
    };
  });

  const representativeWeek = intentWeeks[0];

  return {
    version: 1,
    source: "v2_planner_policy",
    readOnly: true,
    affectsScoringOrGeneration: false,
    summary: {
      weekCount: intentWeeks.length,
      slotCount: representativeWeek?.slots.length ?? 0,
      laneCount:
        representativeWeek?.slots.reduce(
          (sum, slot) => sum + slot.lanes.length,
          0,
        ) ?? 0,
      plannedTotalSetsByWeek: intentWeeks.map((week) => ({
        week: week.week,
        totalSets: week.slots.reduce(
          (sum, slot) => sum + slot.targetSessionSets.preferred,
          0,
        ),
        volumeMultiplier: week.volumeMultiplier,
        phase: week.phase,
      })),
    },
    weeks: intentWeeks,
    guardrails: {
      doesNotUseRepairedProjectionAsTarget: true,
      doesNotUseAcceptedSeedAsTarget: true,
      doesNotAffectSelection: true,
      doesNotAffectRepair: true,
      doesNotAffectSeedSerialization: true,
      doesNotAffectRuntimeReplay: true,
    },
  };
}
