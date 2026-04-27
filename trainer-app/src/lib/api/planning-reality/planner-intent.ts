import { resolveSessionSlotPolicy } from "@/lib/planning/session-slot-profile";
import { getWeeklyVolumeTarget } from "../mesocycle-lifecycle";
import {
  buildSlotSequenceEntries,
  roundToTenth,
  toSessionIntent,
} from "../mesocycle-handoff-slot-plan-projection.coverage-evaluation";
import {
  MAX_SAME_PATTERN_PER_SESSION,
  MAX_SINGLE_EXERCISE_MUSCLE_SHARE,
  MAX_SINGLE_PATTERN_MUSCLE_SHARE,
  SOFT_ACCESSORY_SET_CAP,
  SOFT_MAIN_LIFT_SET_CAP,
} from "../mesocycle-handoff-slot-plan-projection.program-quality";
import {
  MAX_PROJECTED_ACCESSORY_SETS_PER_EXERCISE,
  MAX_PROJECTED_MAIN_LIFT_SETS_PER_EXERCISE,
  MIN_PROJECTED_ACCESSORY_SETS_PER_EXERCISE,
  MIN_PROJECTED_MAIN_LIFT_SETS_PER_EXERCISE,
} from "../mesocycle-handoff-slot-plan-projection.repair-engine";
import type { DuplicateExerciseReuseDiagnostic } from "../mesocycle-handoff-slot-plan-projection.weekly-obligations";
import { SESSION_CAPS } from "../template-session/selection-adapter";
import type {
  AccumulationWeekProjection,
  ActiveMesocycleForDiagnostics,
  ExerciseConcentrationDiagnostic,
  PreselectionDistributionPolicyByWeek,
  ProjectedDeliveryDiagnostic,
  PromotionCandidate,
  SetDistributionIntent,
  ShadowRepairMaterialityDiagnostic,
  ShadowSlotDemandAllocation,
  ShadowWeeklyMuscleDemand,
  SlotCompositionSnapshotDiagnostic,
  SlotDemandAllocationByWeek,
  SlotDemandAllocationDiagnostic,
  SlotPlanPlanningRealityDiagnostic,
  SlotPrescriptionIntent,
  SlotSequenceEntry,
  SuspiciousRepairNotEligibleForPromotion,
  WeeklyDemandCurve,
  WeeklyDemandCurveResolvedMuscle,
} from "./types";
import { getAllocationFatigueBudget, normalizeMuscle } from "./shared-evidence";
export type MusclePrescription = SlotPrescriptionIntent["musclePrescriptions"][number];
type MovementLanePrescription = SlotPrescriptionIntent["movementLanePrescriptions"][number];

const DIAGNOSTIC_COLLATERAL_MUSCLES = [
  "Front Delts",
  "Upper Back",
  "Lower Back",
  "Glutes",
  "Forearms",
  "Core",
  "Adductors",
  "Abductors",
] as const;

const UPPER_SLOT_FORBIDDEN_MUSCLES = ["Quads", "Hamstrings", "Calves"] as const;
const LOWER_SLOT_FORBIDDEN_MUSCLES = [
  "Chest",
  "Lats",
  "Side Delts",
  "Rear Delts",
  "Triceps",
  "Biceps",
] as const;

export function sortPrescriptionStrings(values: ReadonlyArray<string>): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

export function getSlotRegionFromIntent(input: {
  slotId: string;
  intent: string;
  slotArchetype: string | null | undefined;
}): "upper" | "lower" | "other" {
  const slotId = input.slotId.toLowerCase();
  const intent = input.intent.toLowerCase();
  const slotArchetype = input.slotArchetype ?? "";
  if (slotArchetype.startsWith("upper_") || ["upper", "push", "pull"].includes(intent) || slotId.startsWith("upper")) {
    return "upper";
  }
  if (slotArchetype.startsWith("lower_") || ["lower", "legs"].includes(intent) || slotId.startsWith("lower")) {
    return "lower";
  }
  return "other";
}

export function getMusclePrescriptionTemplate(input: {
  muscle: string;
  slotRegion: "upper" | "lower" | "other";
  slotArchetype: string | null | undefined;
}): Pick<
  MusclePrescription,
  | "allowedPatterns"
  | "allowedExerciseClasses"
  | "forbiddenPatterns"
  | "forbiddenExerciseClasses"
  | "collateralLimits"
  | "reasons"
> {
  switch (input.muscle) {
    case "Chest":
      return input.slotRegion === "lower"
        ? {
            allowedPatterns: [],
            allowedExerciseClasses: [],
            forbiddenPatterns: ["horizontal_push", "vertical_push", "isolation"],
            forbiddenExerciseClasses: ["chest_fly", "chest_isolation", "press"],
            collateralLimits: [],
            reasons: ["lower_slot_does_not_own_chest", "blocked_repairs_should_not_become_valid_prescription"],
          }
        : {
            allowedPatterns: ["horizontal_push", "vertical_push", "isolation"],
            allowedExerciseClasses: ["chest_fly", "chest_isolation", "press"],
            forbiddenPatterns: [],
            forbiddenExerciseClasses: [],
            collateralLimits: [
              { muscle: "Front Delts", maxAddedEffectiveSets: 2 },
              { muscle: "Triceps", maxAddedEffectiveSets: 3 },
            ],
            reasons: ["upper_press_or_fly_slot_can_own_chest", "use_stimulus_profile_effective_sets"],
          };
    case "Lats":
      return {
        allowedPatterns: ["vertical_pull", "horizontal_pull"],
        allowedExerciseClasses: ["lat_pull", "row_with_lat_stimulus"],
        forbiddenPatterns: input.slotRegion === "lower" ? ["hinge", "squat", "lunge"] : [],
        forbiddenExerciseClasses: input.slotRegion === "lower" ? ["lower_body_compound"] : [],
        collateralLimits: [{ muscle: "Upper Back", maxAddedEffectiveSets: 3 }],
        reasons: [
          "upper_pull_lane_owned",
          "generic_upper_back_collateral_is_not_clean_lats_closure_without_stimulus_profile_support",
        ],
      };
    case "Side Delts":
      return {
        allowedPatterns: ["vertical_push", "isolation"],
        allowedExerciseClasses: ["lateral_raise", "vertical_press_overlap"],
        forbiddenPatterns: input.slotRegion === "lower" ? ["squat", "hinge", "lunge"] : [],
        forbiddenExerciseClasses: input.slotRegion === "lower" ? ["lower_body_compound"] : [],
        collateralLimits: [{ muscle: "Front Delts", maxAddedEffectiveSets: 2 }],
        reasons: [
          "compatible_upper_support",
          "direct_lateral_raise_and_vertical_press_overlap_allowed",
          "cap_duplicate_lateral_raise_identities_and_set_stacking",
        ],
      };
    case "Rear Delts":
      return {
        allowedPatterns: ["horizontal_pull", "vertical_pull", "isolation"],
        allowedExerciseClasses: ["rear_delt_isolation_when_slot_owned", "pull_overlap_with_direct_rear_delt_stimulus"],
        forbiddenPatterns: input.slotRegion === "lower" ? ["squat", "hinge", "lunge"] : [],
        forbiddenExerciseClasses: input.slotRegion === "lower" ? ["lower_body_compound"] : [],
        collateralLimits: [
          { muscle: "Upper Back", maxAddedEffectiveSets: 2 },
          { muscle: "Lats", maxAddedEffectiveSets: 2 },
        ],
        reasons: [
          "support_but_collateral_sensitive",
          "generic_rows_or_pulls_do_not_count_as_clean_direct_rear_delt_closure",
          "pull_pattern_pressure_must_remain_capped",
        ],
      };
    case "Triceps":
      return {
        allowedPatterns: ["horizontal_push", "vertical_push", "isolation"],
        allowedExerciseClasses: ["press_overlap", "triceps_isolation_if_under_floor"],
        forbiddenPatterns: [],
        forbiddenExerciseClasses: [],
        collateralLimits: [{ muscle: "Front Delts", maxAddedEffectiveSets: 2 }],
        reasons: ["prefer_pressing_overlap", "direct_isolation_only_if_below_support_floor", "do_not_replace_pull_biceps_or_slot_balance_work_for_triceps_closure"],
      };
    case "Biceps":
      return {
        allowedPatterns: ["vertical_pull", "horizontal_pull", "isolation"],
        allowedExerciseClasses: ["pull_overlap", "biceps_isolation_if_under_floor"],
        forbiddenPatterns: [],
        forbiddenExerciseClasses: [],
        collateralLimits: [
          { muscle: "Forearms", maxAddedEffectiveSets: 2 },
          { muscle: "Upper Back", maxAddedEffectiveSets: 2 },
        ],
        reasons: ["prefer_pulling_overlap", "direct_isolation_only_if_below_support_floor", "cap_forearm_collateral_and_pulling_redundancy"],
      };
    case "Quads":
      return {
        allowedPatterns: ["squat", "lunge", "isolation"],
        allowedExerciseClasses: ["squat", "lunge", "leg_extension"],
        forbiddenPatterns: input.slotRegion === "upper" ? ["horizontal_push", "vertical_push", "horizontal_pull", "vertical_pull"] : [],
        forbiddenExerciseClasses: input.slotRegion === "upper" ? ["upper_body_compound"] : [],
        collateralLimits: [
          { muscle: "Glutes", maxAddedEffectiveSets: 3 },
          { muscle: "Adductors", maxAddedEffectiveSets: 2 },
        ],
        reasons: ["hard_lower_primary", "protect_lower_slot_identity"],
      };
    case "Hamstrings":
      return {
        allowedPatterns: ["hinge", "isolation"],
        allowedExerciseClasses: ["hinge_compound", "knee_flexion_curl"],
        forbiddenPatterns: input.slotRegion === "upper" ? ["horizontal_push", "vertical_push", "horizontal_pull", "vertical_pull"] : [],
        forbiddenExerciseClasses: input.slotRegion === "upper" ? ["upper_body_compound"] : [],
        collateralLimits: [
          { muscle: "Lower Back", maxAddedEffectiveSets: 2 },
          { muscle: "Glutes", maxAddedEffectiveSets: 3 },
        ],
        reasons: ["hard_lower_primary", "hinge_stimulus_and_knee_flexion_curl_stimulus_are_distinct", "hinge_is_not_equivalent_to_curl"],
      };
    case "Calves":
      return {
        allowedPatterns: ["isolation"],
        allowedExerciseClasses: ["calf_raise"],
        forbiddenPatterns: input.slotRegion === "upper" ? ["horizontal_push", "vertical_push", "horizontal_pull", "vertical_pull"] : [],
        forbiddenExerciseClasses: input.slotRegion === "upper" ? ["upper_body_compound"] : [],
        collateralLimits: [],
        reasons: ["low_fatigue_direct_support", "distribute_across_lower_slots", "avoid_duplicate_calf_variants_unless_specialization_is_explicit"],
      };
    default:
      return {
        allowedPatterns: [],
        allowedExerciseClasses: [],
        forbiddenPatterns: [],
        forbiddenExerciseClasses: [],
        collateralLimits: [],
        reasons: ["diagnostic_collateral_only_unless_explicitly_slot_owned"],
      };
  }
}

export function chooseDemandType(input: {
  muscle: string;
  role: ShadowSlotDemandAllocation["allocatedMuscles"][number]["role"];
  targetStatus: ShadowSlotDemandAllocation["allocatedMuscles"][number]["targetStatus"] | "forbidden";
  actualEffectiveSets: number;
  minEffectiveSets: number | null;
}): MusclePrescription["demandType"] {
  if (input.targetStatus === "forbidden") {
    return "do_not_train_here";
  }
  if (input.targetStatus === "diagnostic" || input.role === "implicit" || input.role === "secondary") {
    return "diagnostic_only";
  }
  if (input.muscle === "Triceps" || input.muscle === "Biceps") {
    return input.minEffectiveSets != null && input.actualEffectiveSets < input.minEffectiveSets
      ? "direct_if_under_floor"
      : "overlap_preferred";
  }
  if (input.muscle === "Side Delts") {
    return "soft_direct_allowed";
  }
  if (input.muscle === "Rear Delts" || input.muscle === "Calves") {
    return input.minEffectiveSets != null && input.actualEffectiveSets < input.minEffectiveSets
      ? "direct_if_under_floor"
      : "soft_direct_allowed";
  }
  return input.targetStatus === "hard" && input.role === "primary"
    ? "direct_required"
    : input.targetStatus === "hard"
      ? "overlap_preferred"
      : "soft_direct_allowed";
}

export function buildOwnedMusclePrescription(input: {
  allocation: ShadowSlotDemandAllocation["allocatedMuscles"][number];
  projectedEffectiveStimulusByMuscle: Record<string, number>;
  slotRegion: "upper" | "lower" | "other";
  slotArchetype: string | null | undefined;
}): MusclePrescription {
  const actualEffectiveSets = input.projectedEffectiveStimulusByMuscle[input.allocation.muscle] ?? 0;
  const template = getMusclePrescriptionTemplate({
    muscle: input.allocation.muscle,
    slotRegion: input.slotRegion,
    slotArchetype: input.slotArchetype,
  });
  const demandType = chooseDemandType({
    muscle: input.allocation.muscle,
    role: input.allocation.role,
    targetStatus: input.allocation.targetStatus,
    actualEffectiveSets,
    minEffectiveSets: input.allocation.minEffectiveSets,
  });

  return {
    muscle: input.allocation.muscle,
    role: input.allocation.role,
    targetStatus: input.allocation.targetStatus,
    demandType,
    desiredEffectiveSets: input.allocation.preferredEffectiveSets,
    minEffectiveSets: input.allocation.minEffectiveSets,
    maxEffectiveSets: input.allocation.maxEffectiveSets,
    allowedPatterns: sortPrescriptionStrings(template.allowedPatterns),
    allowedExerciseClasses: sortPrescriptionStrings(template.allowedExerciseClasses),
    forbiddenPatterns: sortPrescriptionStrings(template.forbiddenPatterns),
    forbiddenExerciseClasses: sortPrescriptionStrings(template.forbiddenExerciseClasses),
    collateralLimits: template.collateralLimits,
    reasons: sortPrescriptionStrings([
      ...template.reasons,
      ...input.allocation.allocationReason,
      `current_projected_effective_sets:${roundToTenth(actualEffectiveSets)}`,
      `program_quality_soft_caps:main_${SOFT_MAIN_LIFT_SET_CAP}:accessory_${SOFT_ACCESSORY_SET_CAP}`,
      demandType,
    ]),
  };
}

export function buildForbiddenMusclePrescription(input: {
  muscle: string;
  slotRegion: "upper" | "lower" | "other";
  slotArchetype: string | null | undefined;
}): MusclePrescription {
  const template = getMusclePrescriptionTemplate({
    muscle: input.muscle,
    slotRegion: input.slotRegion,
    slotArchetype: input.slotArchetype,
  });
  return {
    muscle: input.muscle,
    role: "collateral",
    targetStatus: "forbidden",
    demandType: "do_not_train_here",
    desiredEffectiveSets: null,
    minEffectiveSets: null,
    maxEffectiveSets: 0,
    allowedPatterns: [],
    allowedExerciseClasses: [],
    forbiddenPatterns: sortPrescriptionStrings(template.forbiddenPatterns),
    forbiddenExerciseClasses: sortPrescriptionStrings(template.forbiddenExerciseClasses),
    collateralLimits: [],
    reasons: sortPrescriptionStrings([
      ...template.reasons,
      "forbidden_cross_slot_target_chasing",
    ]),
  };
}

export function buildCollateralPrescription(muscle: string): MusclePrescription {
  return {
    muscle,
    role: "collateral",
    targetStatus: "diagnostic",
    demandType: "diagnostic_only",
    desiredEffectiveSets: null,
    minEffectiveSets: null,
    maxEffectiveSets: null,
    allowedPatterns: [],
    allowedExerciseClasses: [],
    forbiddenPatterns: [],
    forbiddenExerciseClasses: [],
    collateralLimits: [{ muscle, maxAddedEffectiveSets: 2 }],
    reasons: [
      "diagnostic_collateral_only_unless_explicitly_slot_owned",
      "do_not_target_chase_from_planning_reality",
    ],
  };
}

export function dedupeMusclePrescriptions(prescriptions: MusclePrescription[]): MusclePrescription[] {
  const order: Record<MusclePrescription["targetStatus"], number> = {
    hard: 0,
    soft: 1,
    forbidden: 2,
    diagnostic: 3,
  };
  const byMuscle = new Map<string, MusclePrescription>();
  for (const prescription of prescriptions) {
    const existing = byMuscle.get(prescription.muscle);
    if (!existing || order[prescription.targetStatus] < order[existing.targetStatus]) {
      byMuscle.set(prescription.muscle, prescription);
    }
  }
  return Array.from(byMuscle.values()).sort((left, right) => {
    const statusDelta = order[left.targetStatus] - order[right.targetStatus];
    return statusDelta || left.muscle.localeCompare(right.muscle);
  });
}

export function toLaneFromPattern(pattern: string): MovementLanePrescription["lane"] | null {
  if (pattern === "horizontal_push" || pattern === "vertical_push") {
    return "press";
  }
  if (pattern === "horizontal_pull" || pattern === "vertical_pull") {
    return "pull";
  }
  if (pattern === "squat" || pattern === "lunge") {
    return "squat";
  }
  if (pattern === "hinge") {
    return "hinge";
  }
  if (pattern === "isolation") {
    return "isolation";
  }
  return null;
}

export function appendLane(
  lanes: MovementLanePrescription[],
  lane: MovementLanePrescription
): void {
  const existing = lanes.find((entry) => entry.lane === lane.lane);
  if (!existing) {
    lanes.push(lane);
    return;
  }
  existing.required = existing.required || lane.required;
  existing.preferredPatterns = sortPrescriptionStrings([
    ...existing.preferredPatterns,
    ...lane.preferredPatterns,
  ]);
  existing.fallbackPatterns = sortPrescriptionStrings([
    ...existing.fallbackPatterns,
    ...lane.fallbackPatterns,
  ]);
  existing.maxSamePatternCount =
    existing.maxSamePatternCount == null
      ? lane.maxSamePatternCount
      : lane.maxSamePatternCount == null
        ? existing.maxSamePatternCount
        : Math.min(existing.maxSamePatternCount, lane.maxSamePatternCount);
}

export function buildMovementLanePrescriptions(input: {
  slot: SlotSequenceEntry;
  musclePrescriptions: ReadonlyArray<MusclePrescription>;
  slotSequenceEntries: ReturnType<typeof buildSlotSequenceEntries>;
}): MovementLanePrescription[] {
  const slotPolicy = resolveSessionSlotPolicy({
    sessionIntent: toSessionIntent(input.slot.intent),
    slotId: input.slot.slotId,
    slotSequence: { slots: input.slotSequenceEntries },
  }).currentSession;
  const lanes: MovementLanePrescription[] = [];

  for (const lane of slotPolicy?.compoundControl?.lanes ?? []) {
    const resolvedLane: MovementLanePrescription["lane"] =
      lane.key === "press"
        ? "press"
        : lane.key === "pull"
          ? "pull"
          : slotPolicy?.slotArchetype === "lower_hinge_dominant"
            ? "hinge"
            : "squat";
    appendLane(lanes, {
      lane: resolvedLane,
      required: true,
      preferredPatterns: [...lane.preferredMovementPatterns],
      fallbackPatterns: [...lane.fallbackOnlyMovementPatterns],
      maxSamePatternCount: MAX_SAME_PATTERN_PER_SESSION,
    });
  }

  for (const pattern of slotPolicy?.sessionShape?.requiredMovementPatterns ?? []) {
    const lane = toLaneFromPattern(pattern);
    if (!lane) {
      continue;
    }
    appendLane(lanes, {
      lane,
      required: true,
      preferredPatterns: [pattern],
      fallbackPatterns: [],
      maxSamePatternCount: MAX_SAME_PATTERN_PER_SESSION,
    });
  }

  if (input.musclePrescriptions.some((prescription) => prescription.muscle === "Hamstrings" && prescription.targetStatus !== "forbidden")) {
    appendLane(lanes, {
      lane: "knee_flexion",
      required: false,
      preferredPatterns: ["isolation"],
      fallbackPatterns: ["hinge"],
      maxSamePatternCount: MAX_SAME_PATTERN_PER_SESSION,
    });
  }
  if (input.musclePrescriptions.some((prescription) => prescription.muscle === "Calves" && prescription.targetStatus !== "forbidden")) {
    appendLane(lanes, {
      lane: "calf",
      required: false,
      preferredPatterns: ["isolation"],
      fallbackPatterns: [],
      maxSamePatternCount: MAX_SAME_PATTERN_PER_SESSION,
    });
  }
  if (input.musclePrescriptions.some((prescription) =>
    ["soft_direct_allowed", "direct_if_under_floor"].includes(prescription.demandType)
  )) {
    appendLane(lanes, {
      lane: "isolation",
      required: false,
      preferredPatterns: ["isolation"],
      fallbackPatterns: [],
      maxSamePatternCount: MAX_SAME_PATTERN_PER_SESSION,
    });
  }

  return lanes.sort((left, right) => left.lane.localeCompare(right.lane));
}

export function buildCollateralMaxByMuscle(input: {
  slotRegion: "upper" | "lower" | "other";
  musclePrescriptions: ReadonlyArray<MusclePrescription>;
}): Record<string, number> {
  const limits = new Map<string, number>();
  const seed =
    input.slotRegion === "lower"
      ? { "Lower Back": 2, Glutes: 4, Adductors: 2, Abductors: 2, Core: 2 }
      : input.slotRegion === "upper"
        ? { "Front Delts": 2, "Upper Back": 3, Forearms: 2, Core: 2 }
        : { Core: 2 };

  for (const [muscle, max] of Object.entries(seed)) {
    limits.set(muscle, max);
  }
  for (const prescription of input.musclePrescriptions) {
    for (const limit of prescription.collateralLimits) {
      limits.set(
        limit.muscle,
        Math.min(limits.get(limit.muscle) ?? limit.maxAddedEffectiveSets, limit.maxAddedEffectiveSets)
      );
    }
  }

  return Object.fromEntries(
    Array.from(limits.entries()).sort(([left], [right]) => left.localeCompare(right))
  );
}

export function buildSlotDiagnosticRepairStrings(input: {
  slotId: string;
  musclePrescriptions: ReadonlyArray<MusclePrescription>;
  promotionCandidates: ReadonlyArray<PromotionCandidate>;
  suspiciousRepairs: ReadonlyArray<SuspiciousRepairNotEligibleForPromotion>;
  repairRows: ReadonlyArray<ShadowRepairMaterialityDiagnostic>;
}): SlotPrescriptionIntent["diagnostic"] {
  const blockedRepairs = input.suspiciousRepairs
    .filter((row) => row.slotId === input.slotId)
    .map((row) => {
      const prescription = input.musclePrescriptions.find(
        (entry) => entry.muscle === row.muscle
      );
      const reason = prescription?.targetStatus === "forbidden"
        ? "blocked_do_not_train_here"
        : "blocked_suspicious_not_promoted";
      return `${row.slotId}:${row.muscle}:${row.exerciseName ?? row.repairMechanism}:${reason}`;
    });
  const priorRepairsPrevented = input.promotionCandidates
    .filter((row) => row.slotId === input.slotId)
    .map((row) =>
      `${row.slotId}:${row.muscle}:${row.targetStatus === "hard" ? "direct_required" : "soft_direct_allowed"}:${row.suggestedPromotion}`
    );
  const priorRepairsStillRepairOwned = input.repairRows
    .filter((row) => row.slotId === input.slotId)
    .filter((row) => !row.likelyAvoidableWithShadowAllocation || row.action === "removed" || row.action === "set_trimmed")
    .map((row) => {
      const muscle = row.muscle ?? "week";
      const reason =
        row.action === "removed" || row.action === "set_trimmed" ||
        row.shadowAllocationBasis === "diagnostic_or_cap_cleanup"
          ? "cap_cleanup"
          : row.muscle === "Rear Delts" || row.muscle === "Upper Back"
            ? "pull_collateral"
            : row.shadowAllocationBasis === "weekly_demand_owned_elsewhere"
              ? "non_owned_stimulus"
              : "repair_cleanup";
      return `${row.slotId}:${muscle}:still_repair_owned_${reason}`;
    });

  return {
    priorRepairsPrevented: sortPrescriptionStrings(priorRepairsPrevented),
    priorRepairsStillRepairOwned: sortPrescriptionStrings(priorRepairsStillRepairOwned),
    blockedRepairs: sortPrescriptionStrings(blockedRepairs),
  };
}

export function buildSlotPrescriptionIntents(input: {
  slotSequence: ReadonlyArray<SlotSequenceEntry>;
  slotDemandAllocation: ReadonlyArray<SlotDemandAllocationDiagnostic>;
  shadowSlotDemandAllocation: ReadonlyArray<ShadowSlotDemandAllocation>;
  finalSlotPlan: ReadonlyArray<SlotCompositionSnapshotDiagnostic>;
  repairMaterialityAfterShadowAllocation: ReadonlyArray<ShadowRepairMaterialityDiagnostic>;
  suspiciousRepairsNotEligibleForPromotion: ReadonlyArray<SuspiciousRepairNotEligibleForPromotion>;
  promotionCandidates: ReadonlyArray<PromotionCandidate>;
}): SlotPrescriptionIntent[] {
  const slotSequenceEntries = buildSlotSequenceEntries(input.slotSequence);
  const allocationBySlotId = new Map(
    input.shadowSlotDemandAllocation.map((slot) => [slot.slotId, slot])
  );
  const slotDemandBySlotId = new Map(
    input.slotDemandAllocation.map((slot) => [slot.slotId, slot])
  );
  const finalSlotBySlotId = new Map(input.finalSlotPlan.map((slot) => [slot.slotId, slot]));

  return input.slotSequence.map((slot, slotIndex) => {
    const shadowAllocation = allocationBySlotId.get(slot.slotId);
    const slotDemand = slotDemandBySlotId.get(slot.slotId);
    const slotRegion = getSlotRegionFromIntent({
      slotId: slot.slotId,
      intent: toSessionIntent(slot.intent),
      slotArchetype: shadowAllocation?.slotArchetype ?? slotDemand?.slotProfile.slotArchetype,
    });
    const ownedPrescriptions = (shadowAllocation?.allocatedMuscles ?? []).map((allocation) =>
      buildOwnedMusclePrescription({
        allocation,
        projectedEffectiveStimulusByMuscle: slotDemand?.projectedEffectiveStimulusByMuscle ?? {},
        slotRegion,
        slotArchetype: shadowAllocation?.slotArchetype ?? slotDemand?.slotProfile.slotArchetype,
      })
    );
    const ownedMuscles = new Set(ownedPrescriptions.map((prescription) => prescription.muscle));
    const forbiddenMuscles =
      slotRegion === "lower"
        ? LOWER_SLOT_FORBIDDEN_MUSCLES
        : slotRegion === "upper"
          ? UPPER_SLOT_FORBIDDEN_MUSCLES
          : [];
    const forbiddenPrescriptions = forbiddenMuscles
      .filter((muscle) => !ownedMuscles.has(muscle))
      .map((muscle) =>
        buildForbiddenMusclePrescription({
          muscle,
          slotRegion,
          slotArchetype: shadowAllocation?.slotArchetype ?? slotDemand?.slotProfile.slotArchetype,
        })
      );
    const collateralPrescriptions = DIAGNOSTIC_COLLATERAL_MUSCLES
      .filter((muscle) => !ownedMuscles.has(muscle))
      .map(buildCollateralPrescription);
    const musclePrescriptions = dedupeMusclePrescriptions([
      ...ownedPrescriptions,
      ...forbiddenPrescriptions,
      ...collateralPrescriptions,
    ]);
    const finalSlot = finalSlotBySlotId.get(slot.slotId);
    const fatigueBudget = shadowAllocation?.fatigueBudget ??
      getAllocationFatigueBudget(shadowAllocation?.slotArchetype ?? slotDemand?.slotProfile.slotArchetype);

    return {
      version: 1,
      slotId: slot.slotId,
      slotIndex,
      intent: toSessionIntent(slot.intent),
      slotArchetype: shadowAllocation?.slotArchetype ?? slotDemand?.slotProfile.slotArchetype ?? null,
      musclePrescriptions,
      movementLanePrescriptions: buildMovementLanePrescriptions({
        slot,
        musclePrescriptions,
        slotSequenceEntries,
      }),
      setBudget: {
        minTotalSets:
          MIN_PROJECTED_MAIN_LIFT_SETS_PER_EXERCISE +
          (SESSION_CAPS.minExercises - 1) * MIN_PROJECTED_ACCESSORY_SETS_PER_EXERCISE,
        preferredTotalSets: finalSlot?.totalSets ?? 0,
        maxTotalSets:
          MAX_PROJECTED_MAIN_LIFT_SETS_PER_EXERCISE +
          (SESSION_CAPS.maxExercises - 1) * MAX_PROJECTED_ACCESSORY_SETS_PER_EXERCISE,
        maxSetsPerMain: MAX_PROJECTED_MAIN_LIFT_SETS_PER_EXERCISE,
        maxSetsPerAccessory: MAX_PROJECTED_ACCESSORY_SETS_PER_EXERCISE,
        maxDirectIsolationExercises: 2,
      },
      diversityBudget: {
        maxExerciseShareByMuscle: MAX_SINGLE_EXERCISE_MUSCLE_SHARE,
        maxPatternShareByMuscle: MAX_SINGLE_PATTERN_MUSCLE_SHARE,
        maxDuplicateIsolationVariantsByMuscle: 1,
        maxDuplicateResistanceProfiles: 1,
      },
      fatigueBudget: {
        systemic: fatigueBudget?.systemic ?? "moderate",
        axial: fatigueBudget?.axial ?? "moderate",
        collateralMaxByMuscle: buildCollateralMaxByMuscle({
          slotRegion,
          musclePrescriptions,
        }),
      },
      diagnostic: buildSlotDiagnosticRepairStrings({
        slotId: slot.slotId,
        musclePrescriptions,
        promotionCandidates: input.promotionCandidates,
        suspiciousRepairs: input.suspiciousRepairsNotEligibleForPromotion,
        repairRows: input.repairMaterialityAfterShadowAllocation,
      }),
    };
  });
}

type SetDistributionMusclePolicy = SetDistributionIntent["musclePolicies"][number];

const SET_DISTRIBUTION_MAX_MAIN_LIFTS = 2;

export function countDirectExercisesForMuscle(
  slot: SlotCompositionSnapshotDiagnostic | undefined,
  muscle: string
): number {
  return (
    slot?.exercises.filter((exercise) =>
      exercise.primaryMuscles.map(normalizeMuscle).includes(muscle)
    ).length ?? 0
  );
}

export function getPreferredDistribution(input: {
  prescription: MusclePrescription;
  finalSlot: SlotCompositionSnapshotDiagnostic | undefined;
}): SetDistributionMusclePolicy["preferredDistribution"] {
  const muscle = input.prescription.muscle;
  if (input.prescription.targetStatus === "forbidden") {
    return "forbidden";
  }
  if (
    input.prescription.targetStatus === "diagnostic" ||
    input.prescription.demandType === "diagnostic_only"
  ) {
    return "diagnostic_only";
  }
  if (muscle === "Chest" || muscle === "Lats" || muscle === "Quads" || muscle === "Hamstrings") {
    return "two_exercise_split";
  }
  if (muscle === "Side Delts") {
    return countDirectExercisesForMuscle(input.finalSlot, muscle) > 1
      ? "two_exercise_split"
      : "overlap_first";
  }
  if (muscle === "Rear Delts" || muscle === "Calves") {
    return "direct_isolation_only_if_needed";
  }
  if (muscle === "Triceps" || muscle === "Biceps") {
    return "overlap_first";
  }
  return input.prescription.role === "primary"
    ? "single_anchor_plus_accessory"
    : "direct_isolation_only_if_needed";
}

export function getWhenAtLimit(
  prescription: MusclePrescription
): SetDistributionMusclePolicy["whenAtLimit"] {
  const muscle = prescription.muscle;
  if (prescription.targetStatus === "forbidden") {
    return "do_not_bump";
  }
  if (
    prescription.targetStatus === "diagnostic" ||
    prescription.demandType === "diagnostic_only"
  ) {
    return "leave_unresolved";
  }
  if (muscle === "Triceps" || muscle === "Biceps") {
    return prescription.demandType === "direct_if_under_floor"
      ? "allow_if_no_clean_alternative"
      : "do_not_bump";
  }
  if (muscle === "Calves") {
    return "allow_if_no_clean_alternative";
  }
  return "prefer_alternative";
}

export function getMaxDirectExercises(
  prescription: MusclePrescription
): number | null {
  if (prescription.targetStatus === "forbidden") {
    return 0;
  }
  if (prescription.targetStatus === "diagnostic") {
    return null;
  }
  if (
    prescription.muscle === "Chest" ||
    prescription.muscle === "Lats" ||
    prescription.muscle === "Quads" ||
    prescription.muscle === "Hamstrings"
  ) {
    return 2;
  }
  return 1;
}

export function getMaxSetsPerExercise(input: {
  prescription: MusclePrescription;
  slotIntent: SlotPrescriptionIntent;
}): number | null {
  if (input.prescription.targetStatus === "forbidden") {
    return 0;
  }
  if (input.prescription.targetStatus === "diagnostic") {
    return null;
  }
  return input.prescription.role === "primary"
    ? input.slotIntent.setBudget.maxSetsPerMain
    : input.slotIntent.setBudget.maxSetsPerAccessory;
}

export function formatConcentrationEvidenceRow(
  row: ExerciseConcentrationDiagnostic
): string[] {
  const highShareRows = Object.entries(row.percentageOfWeeklyProjectedStimulusByMuscle)
    .filter(([, percent]) => percent >= 50)
    .sort(([leftMuscle], [rightMuscle]) => leftMuscle.localeCompare(rightMuscle))
    .map(
      ([muscle, percent]) =>
        `${row.slotId}:${row.exerciseName}:${muscle}:${roundToTenth(percent)}%`
    );

  if (highShareRows.length > 0) {
    return highShareRows;
  }
  if (
    row.flags.includes("COMPOUND_GT_5_SETS") ||
    row.flags.includes("ISOLATION_GT_5_SETS")
  ) {
    return [`${row.slotId}:${row.exerciseName}:sets:${row.setCount}`];
  }
  return [];
}

export function formatCapCleanupRow(row: ShadowRepairMaterialityDiagnostic): string {
  const slotId = row.slotId ?? "week";
  const exercise = row.exerciseName ?? row.exerciseId ?? "unknown exercise";
  const delta = row.rawSetDelta !== 0 ? row.rawSetDelta : row.action;
  return `${slotId}:${exercise}:${delta}`;
}

export function formatStillRepairOwnedRow(row: ShadowRepairMaterialityDiagnostic): string | null {
  if (!row.muscle && !row.exerciseName && !row.exerciseId) {
    return null;
  }
  const slotId = row.slotId ?? "week";
  const exercise = row.exerciseName ?? row.exerciseId ?? "unknown exercise";
  const muscle = row.muscle ?? "unknown muscle";
  return `${slotId}:${exercise}:${muscle}:${row.shadowAllocationBasis}`;
}

export function buildSetDistributionIntents(input: {
  slotPrescriptionIntents: ReadonlyArray<SlotPrescriptionIntent>;
  finalSlotPlan: ReadonlyArray<SlotCompositionSnapshotDiagnostic>;
  exerciseConcentration: ReadonlyArray<ExerciseConcentrationDiagnostic>;
  repairMaterialityAfterShadowAllocation: ReadonlyArray<ShadowRepairMaterialityDiagnostic>;
}): SetDistributionIntent[] {
  const finalSlotById = new Map(input.finalSlotPlan.map((slot) => [slot.slotId, slot]));
  const concentrationRowsBySlotId = new Map<string, string[]>();
  for (const row of input.exerciseConcentration) {
    for (const evidence of formatConcentrationEvidenceRow(row)) {
      concentrationRowsBySlotId.set(row.slotId, [
        ...(concentrationRowsBySlotId.get(row.slotId) ?? []),
        evidence,
      ]);
    }
  }
  const capCleanupRowsBySlotId = new Map<string, string[]>();
  const stillRepairRowsBySlotId = new Map<string, string[]>();
  for (const row of input.repairMaterialityAfterShadowAllocation) {
    if (!row.slotId) {
      continue;
    }
    if (row.action === "set_trimmed" || row.action === "removed") {
      capCleanupRowsBySlotId.set(row.slotId, [
        ...(capCleanupRowsBySlotId.get(row.slotId) ?? []),
        formatCapCleanupRow(row),
      ]);
    }
    if (
      !row.likelyAvoidableWithShadowAllocation ||
      row.action === "set_trimmed" ||
      row.action === "removed"
    ) {
      const evidence = formatStillRepairOwnedRow(row);
      if (!evidence) {
        continue;
      }
      stillRepairRowsBySlotId.set(row.slotId, [
        ...(stillRepairRowsBySlotId.get(row.slotId) ?? []),
        evidence,
      ]);
    }
  }

  return input.slotPrescriptionIntents.map((slotIntent) => {
    const finalSlot = finalSlotById.get(slotIntent.slotId);
    return {
      version: 1,
      slotId: slotIntent.slotId,
      slotIndex: slotIntent.slotIndex,
      intent: slotIntent.intent,
      slotArchetype: slotIntent.slotArchetype,
      musclePolicies: slotIntent.musclePrescriptions.map((prescription) => ({
        muscle: prescription.muscle,
        role: prescription.role,
        targetStatus: prescription.targetStatus,
        demandType: prescription.demandType,
        preferredEffectiveSets: prescription.desiredEffectiveSets,
        minEffectiveSets: prescription.minEffectiveSets,
        maxEffectiveSets: prescription.maxEffectiveSets,
        maxSingleExerciseShare:
          prescription.targetStatus === "diagnostic"
            ? null
            : slotIntent.diversityBudget.maxExerciseShareByMuscle,
        maxSinglePatternShare:
          prescription.targetStatus === "diagnostic"
            ? null
            : slotIntent.diversityBudget.maxPatternShareByMuscle,
        maxSetsPerExercise: getMaxSetsPerExercise({ prescription, slotIntent }),
        maxDirectExercises: getMaxDirectExercises(prescription),
        maxDuplicateExerciseClasses:
          prescription.targetStatus === "diagnostic"
            ? null
            : prescription.targetStatus === "forbidden"
              ? 0
              : slotIntent.diversityBudget.maxDuplicateIsolationVariantsByMuscle,
        preferredDistribution: getPreferredDistribution({ prescription, finalSlot }),
        whenAtLimit: getWhenAtLimit(prescription),
      })),
      slotBudget: {
        preferredTotalSets: slotIntent.setBudget.preferredTotalSets,
        maxTotalSets: slotIntent.setBudget.maxTotalSets,
        maxMainLifts: Math.min(SET_DISTRIBUTION_MAX_MAIN_LIFTS, SESSION_CAPS.maxExercises),
        maxAccessories: Math.max(0, SESSION_CAPS.maxExercises - 1),
        maxDirectIsolationExercises: slotIntent.setBudget.maxDirectIsolationExercises ?? 0,
      },
      evidence: {
        concentrationRows: sortPrescriptionStrings(
          concentrationRowsBySlotId.get(slotIntent.slotId) ?? []
        ),
        capCleanupRows: sortPrescriptionStrings(
          capCleanupRowsBySlotId.get(slotIntent.slotId) ?? []
        ),
        repairRowsStillRepairOwned: sortPrescriptionStrings(
          stillRepairRowsBySlotId.get(slotIntent.slotId) ?? []
        ),
      },
      readOnly: true,
      affectsScoringOrGeneration: false,
    };
  });
}

type DistributionPolicyWeek =
  PreselectionDistributionPolicyByWeek["weeks"][number];
type DistributionPolicySlot = DistributionPolicyWeek["slots"][number];
type DistributionPolicyMuscle =
  DistributionPolicySlot["muscleDistributions"][number];
type DistributionPolicyAffects =
  PreselectionDistributionPolicyByWeek["affectsCatalog"][string];
type ExpandedDistributionPolicyMuscle = Omit<
  DistributionPolicyMuscle,
  "affectsRef" | "evidenceRefs" | "limitationRefs"
> & {
  affects: DistributionPolicyAffects;
  evidence: string[];
  limitations: string[];
};
type ExpandedDistributionPolicySlot = Omit<
  DistributionPolicySlot,
  "muscleDistributions"
> & {
  muscleDistributions: ExpandedDistributionPolicyMuscle[];
};
type ExpandedDistributionPolicyWeek = Omit<DistributionPolicyWeek, "slots"> & {
  slots: ExpandedDistributionPolicySlot[];
};
type SlotMusclePrescription =
  SlotPrescriptionIntent["musclePrescriptions"][number];
export type SetDistributionPolicy = SetDistributionIntent["musclePolicies"][number];

export function getDiagnosticMesocycleId(
  activeMesocycle: ActiveMesocycleForDiagnostics,
): string | null {
  const value = (activeMesocycle as { id?: unknown }).id;
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function getDiagnosticDurationWeeks(
  activeMesocycle: ActiveMesocycleForDiagnostics,
): number {
  const value = (activeMesocycle as { durationWeeks?: unknown }).durationWeeks;
  return typeof value === "number" && Number.isFinite(value) && value >= 2
    ? Math.floor(value)
    : 5;
}

export function toPolicyRole(
  role: SlotMusclePrescription["role"],
): DistributionPolicyMuscle["role"] {
  return role === "primary" || role === "support" ? role : "collateral";
}

export function toPreferredSetSplit(
  preferredDistribution: SetDistributionPolicy["preferredDistribution"],
): DistributionPolicyMuscle["preferredSetSplit"] {
  switch (preferredDistribution) {
    case "single_anchor_plus_accessory":
      return "anchor_plus_isolation";
    case "two_exercise_split":
      return "two_distinct_exercises";
    case "overlap_first":
    case "direct_isolation_only_if_needed":
      return "overlap_first_then_isolation";
    case "diagnostic_only":
      return "diagnostic_only";
    case "forbidden":
      return "forbidden";
  }
}

export function uniqueSorted(values: ReadonlyArray<string>): string[] {
  return Array.from(
    new Set(values.filter((value) => value.trim().length > 0)),
  ).sort((left, right) => left.localeCompare(right));
}

export function exerciseMatchesMuscle(
  exercise: SlotCompositionSnapshotDiagnostic["exercises"][number],
  muscle: string,
): boolean {
  return exercise.primaryMuscles.map(normalizeMuscle).includes(muscle);
}

export function findDuplicateRowsForMuscle(input: {
  slot: SlotCompositionSnapshotDiagnostic | undefined;
  policy: SetDistributionPolicy;
  duplicateExerciseReuse: ReadonlyArray<DuplicateExerciseReuseDiagnostic>;
}): DuplicateExerciseReuseDiagnostic[] {
  if (!input.slot) {
    return [];
  }
  const exerciseIds = new Set(
    input.slot.exercises
      .filter((exercise) => exerciseMatchesMuscle(exercise, input.policy.muscle))
      .flatMap((exercise) => [exercise.exerciseId, exercise.exerciseName]),
  );
  return input.duplicateExerciseReuse.filter(
    (row) =>
      row.repeatedInSlotId === input.slot?.slotId &&
      (exerciseIds.has(row.exerciseId) || exerciseIds.has(row.name)),
  );
}

export function chooseDuplicatePolicy(input: {
  policy: SetDistributionPolicy;
  duplicateRows: ReadonlyArray<DuplicateExerciseReuseDiagnostic>;
}): DistributionPolicyMuscle["duplicatePolicy"] {
  if (input.policy.targetStatus === "forbidden") {
    return "block_duplicate_if_alternative_exists";
  }
  if (
    input.duplicateRows.some(
      (row) => row.hasCompatibleAlternative && row.role === "main",
    )
  ) {
    return "block_duplicate_if_alternative_exists";
  }
  if (
    input.duplicateRows.length > 0 ||
    input.policy.muscle === "Calves" ||
    input.policy.muscle === "Side Delts"
  ) {
    return "discourage_if_alternative_exists";
  }
  return "allow_continuity";
}

export function buildDistributionEvidence(input: {
  slotId: string;
  policy: SetDistributionPolicy;
  prescription?: SlotMusclePrescription;
  setDistributionIntent: SetDistributionIntent;
  projectedDelivery: ReadonlyArray<ProjectedDeliveryDiagnostic>;
  warnings: SlotPlanPlanningRealityDiagnostic["warnings"];
  duplicateRows: ReadonlyArray<DuplicateExerciseReuseDiagnostic>;
}): string[] {
  const delivery = input.projectedDelivery.find(
    (row) => row.muscle === input.policy.muscle,
  );
  const warningEvidence = input.warnings.flatMap((warning) => {
    const evidence = warning.evidence.filter((entry) =>
      entry.includes(input.policy.muscle),
    );
    return evidence.map((entry) => `${warning.code}:${entry}`);
  });
  const distributionEvidence = [
    ...input.setDistributionIntent.evidence.concentrationRows.filter((row) =>
      row.includes(input.policy.muscle),
    ),
    ...input.setDistributionIntent.evidence.repairRowsStillRepairOwned.filter(
      (row) => row.includes(input.policy.muscle),
    ),
  ];
  const duplicateEvidence = input.duplicateRows.map(
    (row) =>
      `duplicate:${row.name}:role=${row.role}:previous=${row.previousSlotIds.join("+")}:alternative=${row.hasCompatibleAlternative}`,
  );

  return uniqueSorted([
    `${input.slotId}:${input.policy.muscle}:${input.policy.targetStatus}:${input.policy.demandType}`,
    ...(delivery
      ? [
          `projectedDelivery:${input.policy.muscle}:initial=${formatNullableNumber(delivery.projectedEffectiveStimulusAfterInitialSlotComposition)}:final=${delivery.projectedEffectiveStimulusAfterRepairAndFinalShaping}:target=${formatNullableNumber(delivery.preferredTarget)}`,
        ]
      : []),
    ...(input.prescription?.reasons ?? []),
    ...distributionEvidence,
    ...warningEvidence,
    ...duplicateEvidence,
  ]);
}

export function formatNullableNumber(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : "null";
}

export function buildWeekOnePolicySlots(input: {
  slotPrescriptionIntents: ReadonlyArray<SlotPrescriptionIntent>;
  setDistributionIntents: ReadonlyArray<SetDistributionIntent>;
  finalSlotPlan: ReadonlyArray<SlotCompositionSnapshotDiagnostic>;
  projectedDelivery: ReadonlyArray<ProjectedDeliveryDiagnostic>;
  duplicateExerciseReuse: ReadonlyArray<DuplicateExerciseReuseDiagnostic>;
  warnings: SlotPlanPlanningRealityDiagnostic["warnings"];
}): ExpandedDistributionPolicySlot[] {
  const prescriptionBySlotId = new Map(
    input.slotPrescriptionIntents.map((slot) => [slot.slotId, slot]),
  );
  const finalSlotById = new Map(
    input.finalSlotPlan.map((slot) => [slot.slotId, slot]),
  );

  return input.setDistributionIntents.map((intent) => {
    const slotPrescription = prescriptionBySlotId.get(intent.slotId);
    const finalSlot = finalSlotById.get(intent.slotId);
    return {
      slotId: intent.slotId,
      slotArchetype: intent.slotArchetype ?? "unknown",
      muscleDistributions: intent.musclePolicies.map((policy) => {
        const prescription = slotPrescription?.musclePrescriptions.find(
          (row) => row.muscle === policy.muscle,
        );
        const duplicateRows = findDuplicateRowsForMuscle({
          slot: finalSlot,
          policy,
          duplicateExerciseReuse: input.duplicateExerciseReuse,
        });
        const requiredExerciseClasses =
          policy.targetStatus === "hard" &&
          policy.demandType === "direct_required"
            ? (prescription?.allowedExerciseClasses ?? [])
            : [];
        const preferredExerciseClasses =
          requiredExerciseClasses.length === 0
            ? (prescription?.allowedExerciseClasses ?? [])
            : [];
        const forbiddenExerciseClasses =
          prescription?.forbiddenExerciseClasses ?? [];

        return {
          muscle: policy.muscle,
          targetStatus: policy.targetStatus,
          role: toPolicyRole(policy.role),
          demandType: policy.demandType,
          targetEffectiveSets: policy.preferredEffectiveSets,
          minEffectiveSets: policy.minEffectiveSets,
          maxEffectiveSets: policy.maxEffectiveSets,
          ...(requiredExerciseClasses.length > 0
            ? { requiredExerciseClasses }
            : {}),
          ...(preferredExerciseClasses.length > 0
            ? { preferredExerciseClasses }
            : {}),
          ...(forbiddenExerciseClasses.length > 0
            ? { forbiddenExerciseClasses }
            : {}),
          maxSingleExerciseShare: policy.maxSingleExerciseShare,
          maxSinglePatternShare: policy.maxSinglePatternShare,
          preferredSetSplit: toPreferredSetSplit(policy.preferredDistribution),
          duplicatePolicy: chooseDuplicatePolicy({ policy, duplicateRows }),
          unresolvedBehavior:
            policy.whenAtLimit === "leave_unresolved" ||
            policy.targetStatus === "forbidden"
              ? "leave_unresolved"
              : "allow_repair_safety_net",
          affects: {
            volumeProgression: policy.targetStatus === "hard",
            exerciseContinuity:
              duplicateRows.length > 0 || policy.targetStatus !== "diagnostic",
            setDistribution:
              policy.targetStatus === "hard" || policy.targetStatus === "soft",
            fatigueManagement:
              duplicateRows.length > 0 ||
              policy.muscle === "Hamstrings" ||
              policy.muscle === "Lower Back" ||
              policy.muscle === "Glutes",
            deloadPreservation:
              policy.targetStatus === "hard" ||
              duplicateRows.some((row) => row.role === "main"),
            runtimeAdaptation: false,
          },
          evidence: buildDistributionEvidence({
            slotId: intent.slotId,
            policy,
            prescription,
            setDistributionIntent: intent,
            projectedDelivery: input.projectedDelivery,
            warnings: input.warnings,
            duplicateRows,
          }),
          limitations: [
            "week_1_evidence_only",
            "diagnostic_shadow_policy_not_behavior",
            "does_not_affect_scoring_generation_repair_seed_or_runtime",
          ],
        };
      }),
    };
  });
}

export function buildWeekOnePolicyWarnings(input: {
  warnings: SlotPlanPlanningRealityDiagnostic["warnings"];
  duplicateExerciseReuse: ReadonlyArray<DuplicateExerciseReuseDiagnostic>;
  finalSlotPlan: ReadonlyArray<SlotCompositionSnapshotDiagnostic>;
}): string[] {
  const calfExerciseKeys = new Set(
    input.finalSlotPlan.flatMap((slot) =>
      slot.exercises
        .filter((exercise) => exerciseMatchesMuscle(exercise, "Calves"))
        .flatMap((exercise) => [
          `${slot.slotId}:${exercise.exerciseId}`,
          `${slot.slotId}:${exercise.exerciseName}`,
        ]),
    ),
  );
  const duplicateWarnings = input.duplicateExerciseReuse.flatMap((row) => {
    const base =
      row.role === "main"
        ? [
            `duplicate_main_lift_pressure:${row.name}:${row.previousSlotIds.join("+")}->${row.repeatedInSlotId}`,
          ]
        : [];
    const calfDuplicate = calfExerciseKeys.has(`${row.repeatedInSlotId}:${row.exerciseId}`) ||
      calfExerciseKeys.has(`${row.repeatedInSlotId}:${row.name}`)
        ? [
            `calf_duplicate_isolation_pressure:${row.name}:${row.previousSlotIds.join("+")}->${row.repeatedInSlotId}`,
          ]
        : [];
    return [...base, ...calfDuplicate];
  });
  const shapeWarnings = input.warnings.flatMap((warning) =>
    warning.evidence.length > 0
      ? warning.evidence.map((entry) => `${warning.code}:${entry}`)
      : [warning.code],
  );
  return uniqueSorted([...shapeWarnings, ...duplicateWarnings]);
}

export function buildUnprojectedWeek(input: {
  week: number;
  phase: DistributionPolicyWeek["phase"];
  projectionStatus: DistributionPolicyWeek["projectionStatus"];
  weekScope: DistributionPolicyWeek["weekScope"];
  warnings: string[];
}): ExpandedDistributionPolicyWeek {
  return {
    week: input.week,
    phase: input.phase,
    projectionStatus: input.projectionStatus,
    weekScope: input.weekScope,
    slots: [],
    weekLevelWarnings: input.warnings,
  };
}

export function buildStringCatalog(prefix: string, values: ReadonlyArray<string>): {
  catalog: Record<string, string>;
  refsByValue: Map<string, string>;
} {
  const catalog: Record<string, string> = {};
  const refsByValue = new Map<string, string>();

  for (const value of values) {
    if (value.trim().length === 0 || refsByValue.has(value)) {
      continue;
    }
    const ref = `${prefix}${refsByValue.size + 1}`;
    refsByValue.set(value, ref);
    catalog[ref] = value;
  }

  return { catalog, refsByValue };
}

export function getAffectsCatalogKey(affects: DistributionPolicyAffects): string {
  return [
    affects.volumeProgression,
    affects.exerciseContinuity,
    affects.setDistribution,
    affects.fatigueManagement,
    affects.deloadPreservation,
    affects.runtimeAdaptation,
  ].map((value) => (value ? "1" : "0")).join("");
}

export function compactDistributionPolicyWeeks(
  weeks: ReadonlyArray<ExpandedDistributionPolicyWeek>,
): Pick<
  PreselectionDistributionPolicyByWeek,
  "weeks" | "limitationCatalog" | "evidenceCatalog" | "affectsCatalog"
> {
  const muscleRows = weeks.flatMap((week) =>
    week.slots.flatMap((slot) => slot.muscleDistributions),
  );
  const { catalog: limitationCatalog, refsByValue: limitationRefsByValue } =
    buildStringCatalog(
      "L",
      muscleRows.flatMap((row) => row.limitations),
    );
  const { catalog: evidenceCatalog, refsByValue: evidenceRefsByValue } =
    buildStringCatalog(
      "E",
      muscleRows.flatMap((row) => row.evidence),
    );
  const affectsCatalog: PreselectionDistributionPolicyByWeek["affectsCatalog"] =
    {};
  const affectsRefsByKey = new Map<string, string>();

  for (const row of muscleRows) {
    const key = getAffectsCatalogKey(row.affects);
    if (affectsRefsByKey.has(key)) {
      continue;
    }
    const ref = `A${affectsRefsByKey.size + 1}`;
    affectsRefsByKey.set(key, ref);
    affectsCatalog[ref] = row.affects;
  }

  return {
    limitationCatalog,
    evidenceCatalog,
    affectsCatalog,
    weeks: weeks.map((week) => ({
      ...week,
      slots: week.slots.map((slot) => ({
        ...slot,
        muscleDistributions: slot.muscleDistributions.map((row) => {
          const { affects, evidence, limitations, ...rest } = row;
          return {
            ...rest,
            affectsRef: affectsRefsByKey.get(getAffectsCatalogKey(affects))!,
            evidenceRefs: evidence.map((entry) => evidenceRefsByValue.get(entry)!),
            limitationRefs: limitations.map((entry) => limitationRefsByValue.get(entry)!),
          };
        }),
      })),
    })),
  };
}

export function buildCandidateBehaviorSlices(): PreselectionDistributionPolicyByWeek["candidateBehaviorSlices"] {
  return [
    {
      candidate: "chest_upper_slot_distinct_exercise_distribution",
      weekScope: "accumulation_weeks",
      expectedBenefit:
        "Chest is a hard primary target, is currently under target, direct Chest evidence is concentrated in repeated Incline DB Bench exposure, and lower-slot Chest repair is blocked; a projected week-by-week distinct upper-slot press/fly distribution is the safest future behavior slice.",
      risk:
        "Implementing it before weekly projection would optimize Week 1 evidence while pretending to solve the whole mesocycle.",
      prereqs: [
        "inventory/class visibility for distinct chest press/fly options",
        "week-by-week Chest demand",
        "duplicate continuity justification",
      ],
      recommendation: "best_future_behavior",
    },
    {
      candidate: "hamstrings_weekly_overdelivery_control",
      weekScope: "accumulation_weeks",
      expectedBenefit:
        "Could cap weekly Hamstrings overdelivery once demand curves and carryover exist.",
      risk:
        "Hamstrings are already high and lower_b recently improved through a clean curl route; starting here risks breaking the hinge/curl distinction or broadening Hamstrings demand.",
      prereqs: [
        "week-by-week Hamstrings demand",
        "hinge versus knee-flexion preservation checks",
        "fatigue carryover model",
      ],
      recommendation: "not_first",
    },
    {
      candidate: "side_delt_second_slot_support",
      weekScope: "accumulation_weeks",
      expectedBenefit:
        "Can make the successful upper_b Side Delts support path visible across the block without relying on late support-floor repair.",
      risk:
        "Side Delts remain low, but behavior needs an OHP/lateral-raise spam guard before promotion.",
      prereqs: [
        "per-week Side Delts support demand",
        "duplicate lateral-raise pressure visibility",
        "press-overlap versus isolation split policy",
      ],
      recommendation: "diagnostic_only",
    },
    {
      candidate: "duplicate_main_lift_suppression",
      weekScope: "whole_mesocycle",
      expectedBenefit:
        "Would reduce repeated anchor fatigue across accumulation weeks and improve exercise diversity.",
      risk:
        "High leverage but high blast radius; needs a persisted duplicate-continuity justification model before it can safely alter selection.",
      prereqs: [
        "persisted duplicate justification model",
        "week-by-week anchor continuity policy",
        "deload identity preservation expectations",
      ],
      recommendation: "not_first",
    },
    {
      candidate: "calf_duplicate_suppression",
      weekScope: "accumulation_weeks",
      expectedBenefit:
        "Would reduce duplicate calf-isolation noise once larger distribution policy is in place.",
      risk:
        "Low architecture leverage compared with hard primary distribution and duplicate main-lift fatigue.",
      prereqs: [
        "per-week Calves support demand",
        "duplicate isolation variant visibility",
        "slot capacity after hard primary floors",
      ],
      recommendation: "later_cleanup",
    },
  ];
}

export function getDiagnosticStringField(
  activeMesocycle: ActiveMesocycleForDiagnostics,
  field: "intensityBias" | "focus" | "volumeTarget" | "splitType",
): string | null {
  const value = (activeMesocycle as Record<string, unknown>)[field];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function getDiagnosticNumberField(
  activeMesocycle: ActiveMesocycleForDiagnostics,
  field: "sessionsPerWeek",
): number | null {
  const value = (activeMesocycle as Record<string, unknown>)[field];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function toWeeklyDemandRole(
  priority: ShadowWeeklyMuscleDemand["priority"],
): WeeklyDemandCurveResolvedMuscle["role"] {
  return priority === "primary" ||
    priority === "support" ||
    priority === "secondary"
    ? priority
    : "implicit";
}

export function getWeeklyDemandCurvePhase(input: {
  week: number;
  durationWeeks: number;
}): WeeklyDemandCurve["weeks"][number]["phase"] {
  if (input.week === 1) {
    return "entry";
  }
  if (input.week === input.durationWeeks) {
    return "deload";
  }
  if (input.week === input.durationWeeks - 1) {
    return "peak";
  }
  if (input.week > 1 && input.week < input.durationWeeks) {
    return "accumulation";
  }
  return "unknown";
}

export function getWeeklyDemandCurveProgressionIntent(input: {
  phase: WeeklyDemandCurve["weeks"][number]["phase"];
  targetStatus: ShadowWeeklyMuscleDemand["targetStatus"];
}): WeeklyDemandCurveResolvedMuscle["progressionIntent"] {
  if (input.targetStatus === "diagnostic") {
    return "diagnostic_only";
  }
  switch (input.phase) {
    case "entry":
      return "hold";
    case "accumulation":
      return "increase";
    case "peak":
      return "peak";
    case "deload":
      return "deload";
    case "unknown":
      return "diagnostic_only";
  }
}

export function getWeekLevelLimitations(
  phase: WeeklyDemandCurve["weeks"][number]["phase"],
): string[] {
  if (phase === "entry") {
    return [
      "week_1_current_projection_evidence_only",
      "does_not_affect_scoring_generation_repair_seed_or_runtime",
    ];
  }
  if (phase === "deload") {
    return [
      "missing_deload_demand_curve",
      "missing_deload_identity_preservation_policy",
      "missing_deload_set_reduction_projection",
      "does_not_affect_scoring_generation_repair_seed_or_runtime",
    ];
  }
  return [
    "partially_projected_from_week_1",
    "missing_per_week_slot_distribution",
    "missing_fatigue_carryover_model",
    "missing_cross_week_exercise_continuity_policy",
    "does_not_affect_scoring_generation_repair_seed_or_runtime",
  ];
}

export function getWeeklyDemandCurveProjectionStatus(
  phase: WeeklyDemandCurve["weeks"][number]["phase"],
): WeeklyDemandCurve["weeks"][number]["projectionStatus"] {
  if (phase === "deload") {
    return "not_projected_missing_policy";
  }
  return "partially_projected_from_week_1";
}

type ExpandedWeeklyDemandCurveWeek = Omit<
  WeeklyDemandCurve["weeks"][number],
  "muscles"
> & {
  muscles: WeeklyDemandCurveResolvedMuscle[];
};

function toWeeklyDemandCatalogKey(prefix: string, index: number): string {
  return `${prefix}${index + 1}`;
}

function toWeeklyDemandMuscleRef(muscle: string): string {
  const slug = normalizeMuscle(muscle)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `m:${slug || "unknown"}`;
}

function buildWeeklyDemandStringCatalog(
  values: ReadonlyArray<string>,
  prefix: string,
): {
  catalog: Record<string, string>;
  refByValue: Map<string, string>;
} {
  const catalog: Record<string, string> = {};
  const refByValue = new Map<string, string>();

  uniqueSorted(values).forEach((value, index) => {
    const key = toWeeklyDemandCatalogKey(prefix, index);
    catalog[key] = value;
    refByValue.set(value, key);
  });

  return { catalog, refByValue };
}

function requireWeeklyDemandRef(
  refByValue: ReadonlyMap<string, string>,
  value: string,
): string {
  const ref = refByValue.get(value);
  if (!ref) {
    throw new Error(`Missing weeklyDemandCurve catalog ref for ${value}`);
  }
  return ref;
}

export function compactWeeklyDemandCurveWeeks(
  weeks: ReadonlyArray<ExpandedWeeklyDemandCurveWeek>,
): Pick<
  WeeklyDemandCurve,
  "sourceCatalog" | "limitationCatalog" | "muscleCatalog" | "weeks"
> {
  const { catalog: sourceCatalog, refByValue: sourceRefByValue } =
    buildWeeklyDemandStringCatalog(
      weeks.flatMap((week) => week.muscles.flatMap((muscle) => muscle.source)),
      "s",
    );
  const { catalog: limitationCatalog, refByValue: limitationRefByValue } =
    buildWeeklyDemandStringCatalog(
      weeks.flatMap((week) =>
        week.muscles.flatMap((muscle) => muscle.limitations),
      ),
      "l",
    );
  const muscleCatalog: WeeklyDemandCurve["muscleCatalog"] = {};

  for (const muscle of weeks.flatMap((week) => week.muscles)) {
    const muscleRef = toWeeklyDemandMuscleRef(muscle.muscle);
    muscleCatalog[muscleRef] ??= {
      muscle: muscle.muscle,
      targetTier: muscle.targetTier,
      targetStatus: muscle.targetStatus,
      role: muscle.role,
      desiredExposureCount: muscle.desiredExposureCount,
    };
  }

  return {
    sourceCatalog,
    limitationCatalog,
    muscleCatalog: Object.fromEntries(
      Object.entries(muscleCatalog).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
    weeks: weeks.map((week) => ({
      week: week.week,
      phase: week.phase,
      projectionStatus: week.projectionStatus,
      muscles: week.muscles.map((muscle) => ({
        muscleRef: toWeeklyDemandMuscleRef(muscle.muscle),
        minEffectiveSets: muscle.minEffectiveSets,
        preferredEffectiveSets: muscle.preferredEffectiveSets,
        maxEffectiveSets: muscle.maxEffectiveSets,
        currentEvidenceEffectiveSets: muscle.currentEvidenceEffectiveSets,
        progressionIntent: muscle.progressionIntent,
        sourceRefs: muscle.source.map((source) =>
          requireWeeklyDemandRef(sourceRefByValue, source),
        ),
        limitationRefs: muscle.limitations
          .filter((limitation) => !week.weekLevelLimitations.includes(limitation))
          .map((limitation) =>
            requireWeeklyDemandRef(limitationRefByValue, limitation),
          ),
      })),
      weekLevelLimitations: week.weekLevelLimitations,
    })),
  };
}

export function resolveWeeklyDemandCurveMuscleRows(input: {
  curve: WeeklyDemandCurve;
  week: WeeklyDemandCurve["weeks"][number];
}): WeeklyDemandCurveResolvedMuscle[] {
  return input.week.muscles.map((row) => {
    const catalogEntry = input.curve.muscleCatalog[row.muscleRef];
    const limitationRefs = [
      ...row.limitationRefs,
      ...input.week.weekLevelLimitations
        .map((limitation) =>
          Object.entries(input.curve.limitationCatalog).find(
            ([, value]) => value === limitation,
          )?.[0],
        )
        .filter((ref): ref is string => ref != null),
    ];

    return {
      muscle: catalogEntry?.muscle ?? row.muscleRef,
      targetTier: catalogEntry?.targetTier ?? "IMPLICIT",
      targetStatus: catalogEntry?.targetStatus ?? "diagnostic",
      role: catalogEntry?.role ?? "implicit",
      minEffectiveSets: row.minEffectiveSets,
      preferredEffectiveSets: row.preferredEffectiveSets,
      maxEffectiveSets: row.maxEffectiveSets,
      currentEvidenceEffectiveSets: row.currentEvidenceEffectiveSets,
      desiredExposureCount: catalogEntry?.desiredExposureCount ?? null,
      progressionIntent: row.progressionIntent,
      source: row.sourceRefs.map(
        (ref) => input.curve.sourceCatalog[ref] ?? ref,
      ),
      limitations: uniqueSorted(
        limitationRefs.map(
          (ref) => input.curve.limitationCatalog[ref] ?? ref,
        ),
      ),
    };
  });
}

export function getPolicyTargetForCurve(input: {
  activeMesocycle: ActiveMesocycleForDiagnostics;
  demand: ShadowWeeklyMuscleDemand;
  week: number;
  phase: WeeklyDemandCurve["weeks"][number]["phase"];
}): {
  minEffectiveSets: number | null;
  preferredEffectiveSets: number | null;
  maxEffectiveSets: number | null;
  source: string[];
  limitations: string[];
} {
  const source = [...input.demand.source];
  const limitations: string[] = [];

  if (input.phase === "deload") {
    return {
      minEffectiveSets: null,
      preferredEffectiveSets: null,
      maxEffectiveSets: null,
      source: uniqueSorted([...source, "deload_week_present_but_demand_curve_unprojected"]),
      limitations: [
        "missing_deload_demand_curve",
        "missing_deload_identity_preservation_policy",
        "missing_deload_set_reduction_projection",
      ],
    };
  }

  if (input.demand.targetStatus === "hard") {
    source.push(`getWeeklyVolumeTarget(week=${input.week})`);
    limitations.push(
      "volume_target_policy_visible_but_slot_distribution_policy_missing",
    );
    return {
      minEffectiveSets: input.demand.minEffectiveSets,
      preferredEffectiveSets: roundToTenth(
        getWeeklyVolumeTarget(
          input.activeMesocycle,
          input.demand.muscle,
          input.week,
        ),
      ),
      maxEffectiveSets: input.demand.maxEffectiveSets,
      source: uniqueSorted(source),
      limitations,
    };
  }

  if (input.demand.targetStatus === "soft") {
    limitations.push(
      "support_floor_not_scaled_by_week",
      "missing_per_week_support_demand_policy",
    );
  } else {
    limitations.push(
      "diagnostic_collateral_readout_only_not_hard_demand",
    );
  }

  return {
    minEffectiveSets: input.demand.minEffectiveSets,
    preferredEffectiveSets: input.demand.preferredEffectiveSets,
    maxEffectiveSets: input.demand.maxEffectiveSets,
    source: uniqueSorted(source),
    limitations,
  };
}

export function formatCurveEvidenceForDelivery(
  delivery: ProjectedDeliveryDiagnostic | undefined,
): string[] {
  if (!delivery) {
    return [];
  }
  const target =
    delivery.preferredTarget == null ? "null" : String(delivery.preferredTarget);
  return [
    `week1_final=${delivery.projectedEffectiveStimulusAfterRepairAndFinalShaping}:preferred=${target}`,
    ...delivery.majorContributingExercises
      .slice(0, 2)
      .map(
        (row) =>
          `week1_contributor=${row.slotId}:${row.exerciseName}:${row.effectiveStimulus}`,
      ),
  ];
}

export function addWeeklyDemandCurveWarning(
  warnings: WeeklyDemandCurve["crossWeekWarnings"],
  warning: WeeklyDemandCurve["crossWeekWarnings"][number],
): void {
  const key = `${warning.code}:${warning.muscle ?? ""}`;
  if (
    warnings.some(
      (existing) => `${existing.code}:${existing.muscle ?? ""}` === key,
    )
  ) {
    return;
  }
  warnings.push(warning);
}

export function buildWeeklyDemandCurveWarnings(input: {
  projectedDelivery: ReadonlyArray<ProjectedDeliveryDiagnostic>;
  exerciseConcentration: ReadonlyArray<ExerciseConcentrationDiagnostic>;
}): WeeklyDemandCurve["crossWeekWarnings"] {
  const warnings: WeeklyDemandCurve["crossWeekWarnings"] = [];
  const deliveryByMuscle = new Map(
    input.projectedDelivery.map((row) => [row.muscle, row]),
  );

  for (const delivery of input.projectedDelivery) {
    if (delivery.preferredTarget == null) {
      continue;
    }
    const evidence = formatCurveEvidenceForDelivery(delivery);
    if (
      delivery.targetStatus === "hard" &&
      delivery.projectedEffectiveStimulusAfterRepairAndFinalShaping + 1e-9 <
        delivery.preferredTarget
    ) {
      addWeeklyDemandCurveWarning(warnings, {
        code: "PRIMARY_UNDER_TARGET_ACROSS_ACCUMULATION",
        muscle: delivery.muscle,
        evidence: [
          ...evidence,
          "if_week_1_distribution_repeats_accumulation_shortfall_persists",
        ],
        severity: "warning",
      });
    }
    if (
      delivery.targetStatus === "hard" &&
      delivery.projectedEffectiveStimulusAfterRepairAndFinalShaping >
        delivery.preferredTarget + 1e-9
    ) {
      addWeeklyDemandCurveWarning(warnings, {
        code: "MUSCLE_OVERDELIVERED_ACROSS_ACCUMULATION",
        muscle: delivery.muscle,
        evidence: [
          ...evidence,
          "if_week_1_distribution_repeats_accumulation_overdelivery_persists",
        ],
        severity:
          delivery.muscle === "Hamstrings" ? "warning" : "info",
      });
    }
    if (
      delivery.targetStatus === "soft" &&
      delivery.projectedEffectiveStimulusAfterRepairAndFinalShaping + 1e-9 <
        delivery.preferredTarget
    ) {
      addWeeklyDemandCurveWarning(warnings, {
        code: "SUPPORT_UNDER_TARGET_ACROSS_ACCUMULATION",
        muscle: delivery.muscle,
        evidence: [
          ...evidence,
          "support_floor_still_under_target_if_week_1_repeats",
        ],
        severity:
          delivery.muscle === "Side Delts" ? "warning" : "info",
      });
    }
  }

  const fatigueConcentrationRows = input.exerciseConcentration.filter((row) =>
    row.flags.some(
      (flag) =>
        flag === "COMPOUND_GT_5_SETS" ||
        flag === "ISOLATION_GT_5_SETS" ||
        flag.includes("EXERCISE_SUPPLIES_OVER"),
    ),
  );
  if (fatigueConcentrationRows.length > 0) {
    addWeeklyDemandCurveWarning(warnings, {
      code: "DUPLICATE_EXERCISE_FATIGUE_RISK",
      evidence: fatigueConcentrationRows
        .slice(0, 6)
        .map(
          (row) =>
            `${row.slotId}:${row.exerciseName}:${row.setCount} sets:${row.flags.join("+")}`,
        ),
      severity: "warning",
    });
  }

  for (const muscle of ["Glutes", "Front Delts", "Lower Back", "Upper Back"]) {
    const delivery = deliveryByMuscle.get(muscle);
    if (
      delivery &&
      delivery.targetStatus === "diagnostic" &&
      delivery.projectedEffectiveStimulusAfterRepairAndFinalShaping > 0
    ) {
      addWeeklyDemandCurveWarning(warnings, {
        code: "MUSCLE_OVERDELIVERED_ACROSS_ACCUMULATION",
        muscle,
        evidence: [
          ...formatCurveEvidenceForDelivery(delivery),
          "diagnostic_collateral_risk_only_not_hard_demand",
        ],
        severity: "info",
      });
    }
  }

  addWeeklyDemandCurveWarning(warnings, {
    code: "DELOAD_PRESERVATION_UNPROJECTED",
    evidence: [
      "missing_deload_demand_curve",
      "missing_deload_identity_preservation_policy",
      "missing_deload_set_reduction_projection",
    ],
    severity: "warning",
  });
  addWeeklyDemandCurveWarning(warnings, {
    code: "WEEKLY_DEMAND_POLICY_MISSING",
    evidence: [
      "weeks_2_to_4_have_volume_target_visibility_but_missing_per_week_slot_distribution",
      "missing_fatigue_carryover_model",
      "missing_cross_week_exercise_continuity_policy",
    ],
    severity: "info",
  });

  return warnings.sort(
    (left, right) =>
      left.code.localeCompare(right.code) ||
      (left.muscle ?? "").localeCompare(right.muscle ?? ""),
  );
}

export function buildWeeklyDemandCurve(input: {
  activeMesocycle: ActiveMesocycleForDiagnostics;
  shadowWeeklyDemand: ReadonlyArray<ShadowWeeklyMuscleDemand>;
  projectedDelivery: ReadonlyArray<ProjectedDeliveryDiagnostic>;
  exerciseConcentration: ReadonlyArray<ExerciseConcentrationDiagnostic>;
}): WeeklyDemandCurve {
  const durationWeeks = getDiagnosticDurationWeeks(input.activeMesocycle);
  const deliveryByMuscle = new Map(
    input.projectedDelivery.map((row) => [row.muscle, row]),
  );
  const warnings = buildWeeklyDemandCurveWarnings({
    projectedDelivery: input.projectedDelivery,
    exerciseConcentration: input.exerciseConcentration,
  });
  const weeks: ExpandedWeeklyDemandCurveWeek[] = Array.from(
    { length: durationWeeks },
    (_, index) => {
      const week = index + 1;
      const phase = getWeeklyDemandCurvePhase({ week, durationWeeks });
      const weekLevelLimitations = getWeekLevelLimitations(phase);
      return {
        week,
        phase,
        projectionStatus: getWeeklyDemandCurveProjectionStatus(phase),
        muscles: input.shadowWeeklyDemand.map((demand) => {
          const target = getPolicyTargetForCurve({
            activeMesocycle: input.activeMesocycle,
            demand,
            week,
            phase,
          });
          const delivery = deliveryByMuscle.get(demand.muscle);
          return {
            muscle: demand.muscle,
            targetTier: demand.targetTier ?? "IMPLICIT",
            targetStatus: demand.targetStatus,
            role: toWeeklyDemandRole(demand.priority),
            minEffectiveSets: target.minEffectiveSets,
            preferredEffectiveSets: target.preferredEffectiveSets,
            maxEffectiveSets: target.maxEffectiveSets,
            currentEvidenceEffectiveSets:
              week === 1
                ? (delivery?.projectedEffectiveStimulusAfterRepairAndFinalShaping ?? null)
                : null,
            desiredExposureCount: demand.desiredExposureCount,
            progressionIntent: getWeeklyDemandCurveProgressionIntent({
              phase,
              targetStatus: demand.targetStatus,
            }),
            source: uniqueSorted([
              ...target.source,
              ...(week === 1 ? formatCurveEvidenceForDelivery(delivery) : []),
            ]),
            limitations: uniqueSorted([
              ...target.limitations,
              ...weekLevelLimitations,
            ]),
          };
        }),
        weekLevelLimitations,
      };
    },
  );
  const compactWeeks = compactWeeklyDemandCurveWeeks(weeks);

  return {
    mesocycleId: getDiagnosticMesocycleId(input.activeMesocycle),
    source: "diagnostic_shadow_planner",
    readOnly: true,
    affectsScoringOrGeneration: false,
    designBasis: {
      durationWeeks,
      intensityBias: getDiagnosticStringField(input.activeMesocycle, "intensityBias"),
      focus: getDiagnosticStringField(input.activeMesocycle, "focus"),
      volumeTarget: getDiagnosticStringField(input.activeMesocycle, "volumeTarget"),
      splitType: getDiagnosticStringField(input.activeMesocycle, "splitType"),
      sessionsPerWeek: getDiagnosticNumberField(input.activeMesocycle, "sessionsPerWeek"),
    },
    ...compactWeeks,
    crossWeekWarnings: warnings,
    candidateBehaviorGate: {
      status: "blocked_until_weekly_curve_is_visible",
      likelyBestFutureBehavior: "chest_upper_slot_distinct_exercise_distribution",
      requiredQuestions: [
        "would_this_improve_weeks_1_to_4_not_just_week_1",
        "would_this_preserve_deload_quality",
        "would_this_increase_fatigue_concentration",
      ],
      evidence: [
        "chest_upper_slot_distinct_exercise_distribution_is_likely_best_future_behavior",
        "behavior_must_remain_blocked_until_weekly_curve_answers_cross_week_questions",
        ...warnings
          .filter((warning) =>
            [
              "PRIMARY_UNDER_TARGET_ACROSS_ACCUMULATION",
              "DUPLICATE_EXERCISE_FATIGUE_RISK",
              "DELOAD_PRESERVATION_UNPROJECTED",
            ].includes(warning.code),
          )
          .flatMap((warning) => warning.evidence)
          .slice(0, 8),
      ],
    },
  };
}

type SlotDemandAllocationWeek = SlotDemandAllocationByWeek["weeks"][number];
type SlotDemandAllocationWeekSlot =
  SlotDemandAllocationWeek["slots"][number];
type SlotDemandAllocationWeekMuscle =
  SlotDemandAllocationWeekSlot["allocatedMuscles"][number];

export function toSlotDemandAllocationRole(
  role: ShadowSlotDemandAllocation["allocatedMuscles"][number]["role"],
): SlotDemandAllocationWeekMuscle["role"] {
  return role === "implicit" ? "collateral" : role;
}

export function getAllocationConfidence(
  allocation: ShadowSlotDemandAllocation["allocatedMuscles"][number],
): SlotDemandAllocationWeekMuscle["allocationConfidence"] {
  if (
    allocation.targetStatus === "hard" &&
    allocation.allocationReason.some((reason) =>
      reason.includes("weekly_obligation"),
    )
  ) {
    return "high";
  }
  if (
    allocation.allocationReason.some(
      (reason) =>
        reason.includes("authored_protected") ||
        reason.includes("authored_preferred") ||
        reason.includes("authored_primary"),
    )
  ) {
    return allocation.targetStatus === "diagnostic" ? "low" : "medium";
  }
  if (allocation.targetStatus === "diagnostic") {
    return "low";
  }
  return "medium";
}

export function getDeliveryLimitations(
  delivery: ProjectedDeliveryDiagnostic | undefined,
): string[] {
  if (!delivery) {
    return ["week_1_delivery_evidence_missing"];
  }
  const limitations: string[] = [];
  if (
    delivery.preferredTarget != null &&
    delivery.projectedEffectiveStimulusAfterRepairAndFinalShaping + 1e-9 <
      delivery.preferredTarget
  ) {
    limitations.push("week_1_under_preferred_target");
  }
  if (
    delivery.preferredTarget != null &&
    delivery.projectedEffectiveStimulusAfterRepairAndFinalShaping >
      delivery.preferredTarget + 1e-9
  ) {
    limitations.push("week_1_over_preferred_target");
  }
  if (delivery.targetStatus === "diagnostic") {
    limitations.push("diagnostic_collateral_readout_only_not_hard_demand");
  }
  return limitations;
}

export function getSlotMuscleDuplicateEvidence(input: {
  slot: SlotCompositionSnapshotDiagnostic | undefined;
  muscle: string;
  duplicateExerciseReuse: ReadonlyArray<DuplicateExerciseReuseDiagnostic>;
}): string[] {
  if (!input.slot) {
    return [];
  }
  const exerciseKeys = new Set(
    input.slot.exercises
      .filter((exercise) => exerciseMatchesMuscle(exercise, input.muscle))
      .flatMap((exercise) => [exercise.exerciseId, exercise.exerciseName]),
  );
  return input.duplicateExerciseReuse
    .filter(
      (row) =>
        row.repeatedInSlotId === input.slot?.slotId &&
        (exerciseKeys.has(row.exerciseId) || exerciseKeys.has(row.name)),
    )
    .map(
      (row) =>
        `duplicate:${row.name}:previous=${row.previousSlotIds.join("+")}:alternative=${row.hasCompatibleAlternative}`,
    );
}

export function getSlotMuscleConcentrationEvidence(input: {
  slotId: string;
  muscle: string;
  exerciseConcentration: ReadonlyArray<ExerciseConcentrationDiagnostic>;
}): string[] {
  return input.exerciseConcentration
    .filter(
      (row) =>
        row.slotId === input.slotId &&
        Object.prototype.hasOwnProperty.call(
          row.percentageOfWeeklyProjectedStimulusByMuscle,
          input.muscle,
        ) &&
        row.flags.some(
          (flag) =>
            flag === "COMPOUND_GT_5_SETS" ||
            flag === "ISOLATION_GT_5_SETS" ||
            flag.includes("EXERCISE_SUPPLIES_OVER"),
        ),
    )
    .map(
      (row) =>
        `concentration:${row.exerciseName}:${input.muscle}:${row.percentageOfWeeklyProjectedStimulusByMuscle[input.muscle]}%`,
    );
}

export function buildWeekOneSlotDemandAllocationSlots(input: {
  shadowSlotDemandAllocation: ReadonlyArray<ShadowSlotDemandAllocation>;
  finalSlotPlan: ReadonlyArray<SlotCompositionSnapshotDiagnostic>;
  projectedDelivery: ReadonlyArray<ProjectedDeliveryDiagnostic>;
  duplicateExerciseReuse: ReadonlyArray<DuplicateExerciseReuseDiagnostic>;
  exerciseConcentration: ReadonlyArray<ExerciseConcentrationDiagnostic>;
}): SlotDemandAllocationWeekSlot[] {
  const finalSlotById = new Map(
    input.finalSlotPlan.map((slot) => [slot.slotId, slot]),
  );
  const deliveryByMuscle = new Map(
    input.projectedDelivery.map((row) => [row.muscle, row]),
  );

  return input.shadowSlotDemandAllocation.map((slot) => {
    const finalSlot = finalSlotById.get(slot.slotId);
    const allocatedMuscles: SlotDemandAllocationWeekMuscle[] =
      slot.allocatedMuscles.map((allocation) => {
      const delivery = deliveryByMuscle.get(allocation.muscle);
      const duplicateEvidence = getSlotMuscleDuplicateEvidence({
        slot: finalSlot,
        muscle: allocation.muscle,
        duplicateExerciseReuse: input.duplicateExerciseReuse,
      });
      const concentrationEvidence = getSlotMuscleConcentrationEvidence({
        slotId: slot.slotId,
        muscle: allocation.muscle,
        exerciseConcentration: input.exerciseConcentration,
      });
      const limitations = uniqueSorted([
        "week_1_current_projection_evidence_only",
        "diagnostic_read_only_no_generation_scoring_repair_seed_or_runtime_effect",
        ...getDeliveryLimitations(delivery),
        ...(duplicateEvidence.length > 0
          ? ["duplicate_exercise_variant_pressure_visible"]
          : []),
        ...(concentrationEvidence.length > 0
          ? ["exercise_concentration_visible"]
          : []),
      ]);

      return {
        muscle: allocation.muscle,
        role: toSlotDemandAllocationRole(allocation.role),
        targetStatus: allocation.targetStatus,
        minEffectiveSets: allocation.minEffectiveSets,
        preferredEffectiveSets: allocation.preferredEffectiveSets,
        maxEffectiveSets: allocation.maxEffectiveSets,
        weekScope: "week_1_only",
        allocationConfidence: getAllocationConfidence(allocation),
        allocationReason: uniqueSorted([
          ...allocation.allocationReason,
          ...(delivery
            ? [
                `week1_total=${delivery.projectedEffectiveStimulusAfterRepairAndFinalShaping}:preferred=${formatNullableNumber(delivery.preferredTarget)}`,
              ]
            : []),
          ...duplicateEvidence,
          ...concentrationEvidence,
        ]),
        limitations,
      };
    });

    const slotLevelWarnings = uniqueSorted(
      allocatedMuscles.flatMap((allocation) =>
        allocation.limitations
          .filter(
            (limitation) =>
              limitation === "week_1_under_preferred_target" ||
              limitation === "week_1_over_preferred_target" ||
              limitation === "duplicate_exercise_variant_pressure_visible" ||
              limitation === "exercise_concentration_visible",
          )
          .map((limitation) => `${allocation.muscle}:${limitation}`),
      ),
    );

    return {
      slotId: slot.slotId,
      slotIndex: slot.slotIndex,
      slotArchetype: slot.slotArchetype,
      intent: slot.intent,
      allocatedMuscles,
      slotLevelWarnings,
    };
  });
}

export function buildFutureSlotAllocationWeek(
  week: WeeklyDemandCurve["weeks"][number],
): SlotDemandAllocationWeek {
  const isDeload = week.phase === "deload";
  const missingWeeklyProjectionWarnings = [
    "not_allocated_missing_weekly_projection",
    "missing_per_week_slot_composition",
    "missing_fatigue_carryover_model",
    "missing_progression_adjusted_set_targets",
    "missing_cross_week_duplicate_justification",
    "missing_weekly_exercise_identity_policy",
  ];
  const deloadWarnings = [
    "deload_slot_allocation_unprojected",
    "missing_deload_identity_preservation",
    "missing_deload_set_reduction_projection",
    "missing_deload_hard_support_target_adjustment",
  ];
  const canPartiallyReadWeeklyCurve =
    !isDeload &&
    week.projectionStatus === "projected_from_policy" &&
    !week.weekLevelLimitations.includes("missing_per_week_slot_distribution");

  return {
    week: week.week,
    phase: week.phase,
    projectionStatus: isDeload
      ? "not_allocated_missing_deload_policy"
      : canPartiallyReadWeeklyCurve
        ? "partially_allocated_from_weekly_demand_curve"
        : "not_allocated_missing_weekly_projection",
    slots: [],
    weekLevelWarnings: isDeload
      ? deloadWarnings
      : uniqueSorted([
          ...missingWeeklyProjectionWarnings,
          ...week.weekLevelLimitations,
        ]),
  };
}

export function mapWeeklyDemandCurveWarningToSlotAllocationWarning(
  warning: WeeklyDemandCurve["crossWeekWarnings"][number],
): SlotDemandAllocationByWeek["crossWeekAllocationWarnings"][number] | null {
  switch (warning.code) {
    case "PRIMARY_UNDER_TARGET_ACROSS_ACCUMULATION":
    case "SUPPORT_UNDER_TARGET_ACROSS_ACCUMULATION":
      return {
        code: "MUSCLE_UNDER_ALLOCATED_ACROSS_ACCUMULATION",
        muscle: warning.muscle,
        evidence: warning.evidence,
        severity: warning.severity,
      };
    case "MUSCLE_OVERDELIVERED_ACROSS_ACCUMULATION":
      return {
        code: "MUSCLE_OVER_ALLOCATED_ACROSS_ACCUMULATION",
        muscle: warning.muscle,
        evidence: warning.evidence,
        severity: warning.severity,
      };
    case "DUPLICATE_EXERCISE_FATIGUE_RISK":
      return {
        code: "DUPLICATE_SLOT_OWNERSHIP_RISK",
        evidence: warning.evidence,
        severity: warning.severity,
      };
    case "DELOAD_PRESERVATION_UNPROJECTED":
      return {
        code: "DELOAD_SLOT_ALLOCATION_UNPROJECTED",
        evidence: warning.evidence,
        severity: warning.severity,
      };
    case "WEEKLY_DEMAND_POLICY_MISSING":
      return {
        code: "WEEKLY_SLOT_ALLOCATION_POLICY_MISSING",
        evidence: warning.evidence,
        severity: warning.severity,
      };
  }
  return null;
}

export function buildSlotDemandAllocationByWeek(input: {
  activeMesocycle: ActiveMesocycleForDiagnostics;
  weeklyDemandCurve: WeeklyDemandCurve;
  shadowSlotDemandAllocation: ReadonlyArray<ShadowSlotDemandAllocation>;
  finalSlotPlan: ReadonlyArray<SlotCompositionSnapshotDiagnostic>;
  projectedDelivery: ReadonlyArray<ProjectedDeliveryDiagnostic>;
  duplicateExerciseReuse: ReadonlyArray<DuplicateExerciseReuseDiagnostic>;
  exerciseConcentration: ReadonlyArray<ExerciseConcentrationDiagnostic>;
}): SlotDemandAllocationByWeek {
  const weeks = input.weeklyDemandCurve.weeks.map((week) => {
    if (week.week === 1) {
      return {
        week: week.week,
        phase: week.phase,
        projectionStatus: "allocated_from_current_week_evidence" as const,
        slots: buildWeekOneSlotDemandAllocationSlots({
          shadowSlotDemandAllocation: input.shadowSlotDemandAllocation,
          finalSlotPlan: input.finalSlotPlan,
          projectedDelivery: input.projectedDelivery,
          duplicateExerciseReuse: input.duplicateExerciseReuse,
          exerciseConcentration: input.exerciseConcentration,
        }),
        weekLevelWarnings: uniqueSorted([
          "week_1_current_projection_evidence_only",
          "later_week_slot_allocation_not_inferred_from_week_1",
          "diagnostic_read_only_no_generation_scoring_repair_seed_or_runtime_effect",
        ]),
      };
    }
    return buildFutureSlotAllocationWeek(week);
  });

  const crossWeekAllocationWarnings = input.weeklyDemandCurve.crossWeekWarnings
    .map(mapWeeklyDemandCurveWarningToSlotAllocationWarning)
    .filter(
      (
        warning,
      ): warning is SlotDemandAllocationByWeek["crossWeekAllocationWarnings"][number] =>
        warning != null,
    )
    .filter(
      (warning, index, rows) =>
        rows.findIndex(
          (candidate) =>
            candidate.code === warning.code &&
            candidate.muscle === warning.muscle,
        ) === index,
    )
    .sort(
      (left, right) =>
        left.code.localeCompare(right.code) ||
        (left.muscle ?? "").localeCompare(right.muscle ?? ""),
    );

  return {
    mesocycleId: getDiagnosticMesocycleId(input.activeMesocycle),
    source: "diagnostic_shadow_planner",
    readOnly: true,
    affectsScoringOrGeneration: false,
    weeks,
    crossWeekAllocationWarnings,
  };
}


type AccumulationProjectionWeek = AccumulationWeekProjection["weeks"][number];
type AccumulationProjectedMuscle =
  AccumulationProjectionWeek["projectedMuscles"][number];
type AccumulationProjectedSlotRisk =
  AccumulationProjectionWeek["projectedSlotRisks"][number];

export function toAccumulationProjectionPhase(
  phase: WeeklyDemandCurve["weeks"][number]["phase"],
): AccumulationProjectionWeek["phase"] {
  if (phase === "accumulation") {
    return "accumulation";
  }
  if (phase === "peak") {
    return "peak";
  }
  return "unknown";
}

export function getAccumulationProjectionStatus(
  phase: WeeklyDemandCurve["weeks"][number]["phase"],
): AccumulationProjectionWeek["projectionStatus"] {
  return phase === "accumulation" || phase === "peak"
    ? "partially_projected_missing_progression"
    : "not_projected_missing_policy";
}

export function getProjectedMuscleStatus(input: {
  targetStatus: AccumulationProjectedMuscle["targetStatus"];
  projectedEffectiveSets: number | null;
  preferredEffectiveSets: number | null;
}): AccumulationProjectedMuscle["status"] {
  if (input.targetStatus === "diagnostic") {
    return "diagnostic_only";
  }
  if (
    input.projectedEffectiveSets == null ||
    input.preferredEffectiveSets == null
  ) {
    return "unknown";
  }
  if (input.projectedEffectiveSets + 1e-9 < input.preferredEffectiveSets) {
    return "below";
  }
  if (input.projectedEffectiveSets > input.preferredEffectiveSets + 1e-9) {
    return "above";
  }
  return "within";
}

export function getProjectedMuscleTrend(
  status: AccumulationProjectedMuscle["status"],
): AccumulationProjectedMuscle["trend"] {
  switch (status) {
    case "below":
      return "persistent_under_target";
    case "above":
      return "persistent_over_target";
    case "within":
      return "stable";
    case "diagnostic_only":
    case "unknown":
      return "unknown";
  }
}

export function buildRepeatedExerciseEvidence(
  finalSlotPlan: ReadonlyArray<SlotCompositionSnapshotDiagnostic>,
): string[] {
  const byExercise = new Map<
    string,
    { name: string; slotIds: Set<string>; isMain: boolean }
  >();

  for (const slot of finalSlotPlan) {
    for (const exercise of slot.exercises) {
      const key = exercise.exerciseId || exercise.exerciseName;
      const existing =
        byExercise.get(key) ??
        {
          name: exercise.exerciseName,
          slotIds: new Set<string>(),
          isMain: false,
        };
      existing.slotIds.add(slot.slotId);
      if (exercise.role === "main") {
        existing.isMain = true;
      }
      byExercise.set(key, existing);
    }
  }

  return Array.from(byExercise.values())
    .filter((row) => row.slotIds.size > 1)
    .map(
      (row) =>
        `duplicate:${row.name}:slots=${Array.from(row.slotIds)
          .sort((left, right) => left.localeCompare(right))
          .join("+")}:role=${row.isMain ? "main" : "accessory"}`,
    )
    .sort((left, right) => left.localeCompare(right));
}

export function buildDuplicateProjectionEvidence(input: {
  finalSlotPlan: ReadonlyArray<SlotCompositionSnapshotDiagnostic>;
  duplicateExerciseReuse: ReadonlyArray<DuplicateExerciseReuseDiagnostic>;
}): string[] {
  return uniqueSorted([
    ...input.duplicateExerciseReuse.map(
      (row) =>
        `duplicate:${row.name}:slot=${row.repeatedInSlotId}:previous=${row.previousSlotIds.join(
          "+",
        )}:role=${row.role}:alternative=${row.hasCompatibleAlternative}`,
    ),
    ...buildRepeatedExerciseEvidence(input.finalSlotPlan),
  ]);
}

export function buildAccumulationProjectionMuscles(input: {
  weeklyDemandCurve: WeeklyDemandCurve;
  week: WeeklyDemandCurve["weeks"][number];
  projectedDelivery: ReadonlyArray<ProjectedDeliveryDiagnostic>;
}): AccumulationProjectedMuscle[] {
  const deliveryByMuscle = new Map(
    input.projectedDelivery.map((row) => [row.muscle, row]),
  );

  return resolveWeeklyDemandCurveMuscleRows({
    curve: input.weeklyDemandCurve,
    week: input.week,
  }).map((muscle) => {
    const delivery = deliveryByMuscle.get(muscle.muscle);
    const projectedEffectiveSets =
      delivery?.projectedEffectiveStimulusAfterRepairAndFinalShaping ?? null;
    const preferredEffectiveSets =
      delivery?.preferredTarget ?? muscle.preferredEffectiveSets;
    const status = getProjectedMuscleStatus({
      targetStatus: muscle.targetStatus,
      projectedEffectiveSets,
      preferredEffectiveSets,
    });
    const evidence = uniqueSorted([
      ...(delivery ? formatCurveEvidenceForDelivery(delivery) : []),
      `week_${input.week.week}_uses_repeated_week_1_final_shape`,
      ...(status === "below" ? ["repeated_week_1_shape_stays_below_target"] : []),
      ...(status === "above" ? ["repeated_week_1_shape_stays_above_target"] : []),
    ]);

    return {
      muscle: muscle.muscle,
      targetStatus: muscle.targetStatus,
      projectedEffectiveSets,
      preferredEffectiveSets,
      minEffectiveSets: muscle.minEffectiveSets,
      maxEffectiveSets: muscle.maxEffectiveSets,
      status,
      trend: getProjectedMuscleTrend(status),
      evidence,
      limitations: uniqueSorted([
        "repeated_week_1_final_shape_only",
        "not_true_week_progression",
        "missing_per_week_slot_distribution",
        "missing_fatigue_carryover_model",
        "does_not_affect_scoring_generation_repair_seed_or_runtime",
        ...muscle.limitations,
      ]),
    };
  });
}

export function firstContributorSlot(
  delivery: ProjectedDeliveryDiagnostic | undefined,
): string {
  return delivery?.majorContributingExercises[0]?.slotId ?? "week";
}

export function buildRepeatedShapeSlotRisks(input: {
  projectedDelivery: ReadonlyArray<ProjectedDeliveryDiagnostic>;
  duplicateExerciseReuse: ReadonlyArray<DuplicateExerciseReuseDiagnostic>;
  exerciseConcentration: ReadonlyArray<ExerciseConcentrationDiagnostic>;
}): AccumulationProjectedSlotRisk[] {
  const risks: AccumulationProjectedSlotRisk[] = [];
  const addRisk = (risk: AccumulationProjectedSlotRisk) => {
    const key = `${risk.slotId}:${risk.risk}:${risk.evidence.join("|")}`;
    if (
      risks.some(
        (existing) =>
          `${existing.slotId}:${existing.risk}:${existing.evidence.join("|")}` ===
          key,
      )
    ) {
      return;
    }
    risks.push(risk);
  };

  for (const row of input.duplicateExerciseReuse) {
    addRisk({
      slotId: row.repeatedInSlotId,
      risk: "duplicate_exercise_reuse",
      severity: row.role === "main" ? "warning" : "info",
      evidence: [
        `${row.name}:previous=${row.previousSlotIds.join("+")}:reason=${row.reason}`,
      ],
    });
  }

  for (const row of input.exerciseConcentration) {
    const concentrationFlags = row.flags.filter(
      (flag) =>
        flag === "COMPOUND_GT_5_SETS" ||
        flag === "ISOLATION_GT_5_SETS" ||
        flag.includes("EXERCISE_SUPPLIES_OVER"),
    );
    if (concentrationFlags.length === 0) {
      continue;
    }
    addRisk({
      slotId: row.slotId,
      risk: "single_exercise_concentration",
      severity: "warning",
      evidence: [`${row.exerciseName}:${row.setCount} sets:${concentrationFlags.join("+")}`],
    });
  }

  for (const delivery of input.projectedDelivery) {
    if (
      ["Front Delts", "Glutes", "Lower Back", "Upper Back"].includes(
        delivery.muscle,
      ) &&
      delivery.projectedEffectiveStimulusAfterRepairAndFinalShaping > 0
    ) {
      addRisk({
        slotId: firstContributorSlot(delivery),
        risk: "collateral_fatigue",
        severity: "info",
        evidence: formatCurveEvidenceForDelivery(delivery),
      });
    }
    if (
      delivery.targetStatus === "hard" &&
      delivery.preferredTarget != null &&
      delivery.projectedEffectiveStimulusAfterRepairAndFinalShaping + 1e-9 <
        delivery.preferredTarget
    ) {
      addRisk({
        slotId: firstContributorSlot(delivery),
        risk: "under_allocated_primary",
        severity: "warning",
        evidence: formatCurveEvidenceForDelivery(delivery),
      });
    }
    if (
      delivery.targetStatus === "hard" &&
      delivery.preferredTarget != null &&
      delivery.projectedEffectiveStimulusAfterRepairAndFinalShaping >
        delivery.preferredTarget + 1e-9
    ) {
      addRisk({
        slotId: firstContributorSlot(delivery),
        risk: "over_allocated_primary",
        severity: delivery.muscle === "Hamstrings" ? "warning" : "info",
        evidence: formatCurveEvidenceForDelivery(delivery),
      });
    }
  }

  return risks.sort(
    (left, right) =>
      left.slotId.localeCompare(right.slotId) ||
      left.risk.localeCompare(right.risk),
  );
}

export function findProjectionDelivery(
  rows: ReadonlyArray<ProjectedDeliveryDiagnostic>,
  muscle: string,
): ProjectedDeliveryDiagnostic | undefined {
  return rows.find((row) => row.muscle === muscle);
}

export function isUnderPreferred(
  delivery: ProjectedDeliveryDiagnostic | undefined,
): boolean {
  return (
    delivery?.preferredTarget != null &&
    delivery.projectedEffectiveStimulusAfterRepairAndFinalShaping + 1e-9 <
      delivery.preferredTarget
  );
}

export function isOverPreferred(
  delivery: ProjectedDeliveryDiagnostic | undefined,
): boolean {
  return (
    delivery?.preferredTarget != null &&
    delivery.projectedEffectiveStimulusAfterRepairAndFinalShaping >
      delivery.preferredTarget + 1e-9
  );
}

export function buildAccumulationProjectionWarnings(input: {
  projectedDelivery: ReadonlyArray<ProjectedDeliveryDiagnostic>;
  duplicateEvidence: ReadonlyArray<string>;
}): AccumulationWeekProjection["crossWeekWarnings"] {
  const warnings: AccumulationWeekProjection["crossWeekWarnings"] = [];
  const add = (
    warning: AccumulationWeekProjection["crossWeekWarnings"][number],
  ) => {
    if (
      warnings.some(
        (existing) =>
          existing.code === warning.code && existing.muscle === warning.muscle,
      )
    ) {
      return;
    }
    warnings.push(warning);
  };

  const chest = findProjectionDelivery(input.projectedDelivery, "Chest");
  if (isUnderPreferred(chest)) {
    add({
      code: "CHEST_UNDER_TARGET_ACROSS_ACCUMULATION",
      muscle: "Chest",
      evidence: [
        ...formatCurveEvidenceForDelivery(chest),
        "repeated_week_1_final_shape_projects_chest_shortfall_across_accumulation",
      ],
      severity: "warning",
    });
  }

  const hamstrings = findProjectionDelivery(input.projectedDelivery, "Hamstrings");
  if (isOverPreferred(hamstrings)) {
    add({
      code: "HAMSTRINGS_OVERDELIVERED_ACROSS_ACCUMULATION",
      muscle: "Hamstrings",
      evidence: [
        ...formatCurveEvidenceForDelivery(hamstrings),
        "repeated_week_1_final_shape_projects_hamstrings_overdelivery_across_accumulation",
      ],
      severity: "warning",
    });
  }

  const sideDelts = findProjectionDelivery(input.projectedDelivery, "Side Delts");
  if (isUnderPreferred(sideDelts)) {
    add({
      code: "SIDE_DELTS_UNDER_TARGET_ACROSS_ACCUMULATION",
      muscle: "Side Delts",
      evidence: [
        ...formatCurveEvidenceForDelivery(sideDelts),
        "repeated_week_1_final_shape_projects_side_delts_shortfall_across_accumulation",
      ],
      severity: "warning",
    });
  }

  if (input.duplicateEvidence.length > 0) {
    add({
      code: "DUPLICATE_MAIN_LIFT_REUSE_ACROSS_ACCUMULATION",
      evidence: [
        ...input.duplicateEvidence.slice(0, 8),
        "repeated_week_1_final_shape_would_repeat_duplicate_identity_pressure",
      ],
      severity: "warning",
    });
  }

  const collateralEvidence = ["Front Delts", "Glutes", "Lower Back", "Upper Back"]
    .flatMap((muscle) => {
      const delivery = findProjectionDelivery(input.projectedDelivery, muscle);
      return delivery &&
        delivery.projectedEffectiveStimulusAfterRepairAndFinalShaping > 0
        ? formatCurveEvidenceForDelivery(delivery)
        : [];
    })
    .slice(0, 8);
  if (collateralEvidence.length > 0) {
    add({
      code: "COLLATERAL_FATIGUE_RISK_ACROSS_ACCUMULATION",
      evidence: [
        ...collateralEvidence,
        "repeated_week_1_final_shape_keeps_collateral_readouts_visible",
      ],
      severity: "info",
    });
  }

  add({
    code: "DELOAD_PRESERVATION_STILL_UNPROJECTED",
    evidence: [
      "missing_deload_identity_preservation_policy",
      "missing_deload_set_reduction_projection",
      "accumulation_projection_does_not_project_deload",
    ],
    severity: "warning",
  });

  return warnings.sort(
    (left, right) =>
      left.code.localeCompare(right.code) ||
      (left.muscle ?? "").localeCompare(right.muscle ?? ""),
  );
}

export function buildCandidateBehaviorReadiness(input: {
  projectedDelivery: ReadonlyArray<ProjectedDeliveryDiagnostic>;
  duplicateEvidence: ReadonlyArray<string>;
  crossWeekWarnings: AccumulationWeekProjection["crossWeekWarnings"];
}): AccumulationWeekProjection["candidateBehaviorReadiness"] {
  const hasWarning = (
    code: AccumulationWeekProjection["crossWeekWarnings"][number]["code"],
  ) => input.crossWeekWarnings.some((warning) => warning.code === code);
  const chestConcentrationEvidence = [
    ...input.duplicateEvidence,
    ...formatCurveEvidenceForDelivery(
      findProjectionDelivery(input.projectedDelivery, "Chest"),
    ),
  ].some((entry) => /incline|bench|contributor/i.test(entry));
  const chestReady =
    hasWarning("CHEST_UNDER_TARGET_ACROSS_ACCUMULATION") &&
    chestConcentrationEvidence;

  return [
    {
      candidate: "chest_upper_slot_distinct_exercise_distribution",
      readiness: chestReady
        ? "ready_for_bounded_trial"
        : "needs_more_projection",
      reason: chestReady
        ? "Repeated Week 1 shape keeps Chest under target and keeps Chest exercise concentration/duplicate evidence visible across accumulation."
        : "Needs accumulation projection evidence that Chest remains under target and concentrated in one repeated pressing identity.",
      requiredGuardrails: [
        "bounded_to_upper_chest_distribution_only",
        "preserve_upper_slot_pull_identity",
        "do_not_change_seed_schema_or_runtime_replay",
        "do_not_increase_front_delt_or_triceps_collateral_without_diagnostic_evidence",
      ],
    },
    {
      candidate: "hamstrings_weekly_overdelivery_control",
      readiness: "not_first",
      reason:
        "Hamstrings overdelivery is visible, but lower_b was recently improved and the fix requires whole-week control rather than a local repair tweak.",
      requiredGuardrails: [
        "preserve_lower_b_hinge_identity",
        "keep_clean_knee_flexion_route_visible",
        "avoid_glutes_lower_back_collateral_increase",
      ],
    },
    {
      candidate: "side_delt_second_slot_support",
      readiness: "diagnostic_only",
      reason:
        "Side Delts under-target remains visible, but support should stay diagnostic until projection proves it avoids OHP/lateral-raise overconcentration.",
      requiredGuardrails: [
        "preserve_upper_b_preselection_success",
        "cap_duplicate_lateral_raise_identities",
        "avoid_pressing_collateral_as_fake_side_delt_support",
      ],
    },
    {
      candidate: "duplicate_main_lift_suppression",
      readiness: "needs_more_projection",
      reason:
        "Duplicate reuse is visible, but broad duplicate suppression has high blast radius and needs per-week identity and fatigue policy first.",
      requiredGuardrails: [
        "persist_duplicate_justification",
        "preserve_required_slot_anchors",
        "prove_no_target_regression_across_weeks_1_to_4",
      ],
    },
    {
      candidate: "calf_duplicate_suppression",
      readiness: "not_first",
      reason:
        "Calf cleanup is lower leverage than Chest distribution and whole-week Hamstrings control.",
      requiredGuardrails: [
        "keep_calf_support_floor_visible",
        "avoid_bumping_past_single_exercise_share_limits",
      ],
    },
  ];
}

export function buildAccumulationWeekProjection(input: {
  activeMesocycle: ActiveMesocycleForDiagnostics;
  weeklyDemandCurve: WeeklyDemandCurve;
  finalSlotPlan: ReadonlyArray<SlotCompositionSnapshotDiagnostic>;
  projectedDelivery: ReadonlyArray<ProjectedDeliveryDiagnostic>;
  duplicateExerciseReuse: ReadonlyArray<DuplicateExerciseReuseDiagnostic>;
  exerciseConcentration: ReadonlyArray<ExerciseConcentrationDiagnostic>;
}): AccumulationWeekProjection {
  const duplicateEvidence = buildDuplicateProjectionEvidence({
    finalSlotPlan: input.finalSlotPlan,
    duplicateExerciseReuse: input.duplicateExerciseReuse,
  });
  const crossWeekWarnings = buildAccumulationProjectionWarnings({
    projectedDelivery: input.projectedDelivery,
    duplicateEvidence,
  });
  const projectedSlotRisks = buildRepeatedShapeSlotRisks({
    projectedDelivery: input.projectedDelivery,
    duplicateExerciseReuse: input.duplicateExerciseReuse,
    exerciseConcentration: input.exerciseConcentration,
  });
  const weeks = input.weeklyDemandCurve.weeks
    .filter((week) => week.week > 1 && week.phase !== "deload")
    .map((week) => ({
      week: week.week,
      phase: toAccumulationProjectionPhase(week.phase),
      projectionStatus: getAccumulationProjectionStatus(week.phase),
      projectedMuscles: buildAccumulationProjectionMuscles({
        weeklyDemandCurve: input.weeklyDemandCurve,
        week,
        projectedDelivery: input.projectedDelivery,
      }),
      projectedSlotRisks,
      weekLevelWarnings: uniqueSorted([
        "repeated_week_1_final_shape_only",
        "missing_true_accumulation_progression_policy",
        "missing_per_week_slot_distribution",
        "missing_fatigue_carryover_model",
        "deload_not_projected_here",
        "diagnostic_read_only_no_generation_scoring_repair_seed_or_runtime_effect",
        ...week.weekLevelLimitations,
      ]),
    }));

  return {
    mesocycleId: getDiagnosticMesocycleId(input.activeMesocycle),
    source: "diagnostic_shadow_planner",
    readOnly: true,
    affectsScoringOrGeneration: false,
    projectionBasis: {
      sourceWeek: 1,
      method: "repeat_week_1_final_shape",
      limitations: [
        "repeats_week_1_final_slot_plan_shape_for_accumulation_diagnostics_only",
        "does_not_apply_true_progression_policy",
        "does_not_allocate_new_week_2_to_4_slot_distribution",
        "does_not_model_fatigue_carryover_or_exercise_staleness_adaptation",
        "does_not_project_deload_identity_or_set_reduction",
        "does_not_affect_scoring_generation_repair_seed_or_runtime",
      ],
    },
    weeks,
    crossWeekWarnings,
    candidateBehaviorReadiness: buildCandidateBehaviorReadiness({
      projectedDelivery: input.projectedDelivery,
      duplicateEvidence,
      crossWeekWarnings,
    }),
  };
}

export function buildPreselectionDistributionPolicyByWeek(input: {
  activeMesocycle: ActiveMesocycleForDiagnostics;
  slotPrescriptionIntents: ReadonlyArray<SlotPrescriptionIntent>;
  setDistributionIntents: ReadonlyArray<SetDistributionIntent>;
  finalSlotPlan: ReadonlyArray<SlotCompositionSnapshotDiagnostic>;
  projectedDelivery: ReadonlyArray<ProjectedDeliveryDiagnostic>;
  duplicateExerciseReuse: ReadonlyArray<DuplicateExerciseReuseDiagnostic>;
  warnings: SlotPlanPlanningRealityDiagnostic["warnings"];
}): PreselectionDistributionPolicyByWeek {
  const durationWeeks = getDiagnosticDurationWeeks(input.activeMesocycle);
  const accumulationWeeks = Math.max(1, durationWeeks - 1);
  const weekOneWarnings = buildWeekOnePolicyWarnings({
    warnings: input.warnings,
    duplicateExerciseReuse: input.duplicateExerciseReuse,
    finalSlotPlan: input.finalSlotPlan,
  });
  const futureAccumulationWarnings = [
    "weeks_2_to_4_unprojected",
    "missing_weekly_demand_curve",
    "missing_accumulation_progression_policy",
    "missing_per_week_slot_distribution",
    "missing_fatigue_carryover_model",
  ];
  const deloadWarnings = [
    "deload_distribution_not_projected",
    "missing_deload_identity_preservation_policy",
    "missing_deload_set_reduction_projection",
  ];

  const weeks: ExpandedDistributionPolicyWeek[] = [
    {
      week: 1,
      phase: "accumulation",
      projectionStatus: "projected_from_current_week_evidence",
      weekScope: "week_1_only",
      slots: buildWeekOnePolicySlots(input),
      weekLevelWarnings: weekOneWarnings,
    },
  ];

  for (let week = 2; week <= accumulationWeeks; week += 1) {
    weeks.push(
      buildUnprojectedWeek({
        week,
        phase: "accumulation",
        projectionStatus:
          week === 2
            ? "not_projected_missing_weekly_demand_curve"
            : "not_projected_missing_accumulation_policy",
        weekScope: "accumulation_weeks",
        warnings: futureAccumulationWarnings,
      }),
    );
  }

  weeks.push(
    buildUnprojectedWeek({
      week: durationWeeks,
      phase: "deload",
      projectionStatus: "not_projected_missing_deload_policy",
      weekScope: "deload_week",
      warnings: deloadWarnings,
    }),
  );
  const compactPolicy = compactDistributionPolicyWeeks(weeks);

  return {
    mesocycleId: getDiagnosticMesocycleId(input.activeMesocycle),
    source: "diagnostic_shadow_planner",
    readOnly: true,
    affectsScoringOrGeneration: false,
    limitations: [
      "diagnostic_read_only_no_generation_scoring_repair_seed_or_runtime_effect",
      "week_1_supported_by_current_projection_evidence_only",
      "weeks_2_to_4_unprojected",
      "missing_weekly_demand_curve",
      "missing_accumulation_progression_policy",
      "missing_per_week_slot_distribution",
      "missing_fatigue_carryover_model",
      "deload_distribution_not_projected",
      "missing_deload_identity_preservation_policy",
      "missing_deload_set_reduction_projection",
    ],
    limitationCatalog: compactPolicy.limitationCatalog,
    evidenceCatalog: compactPolicy.evidenceCatalog,
    affectsCatalog: compactPolicy.affectsCatalog,
    weeks: compactPolicy.weeks,
    candidateBehaviorSlices: buildCandidateBehaviorSlices(),
    recommendedNextStep: "add_weekly_demand_curve_diagnostic",
  };
}

