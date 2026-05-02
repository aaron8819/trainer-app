import type { MuscleTargetTier } from "@/lib/engine/volume-landmarks";
import { getMuscleTargetSemantics } from "@/lib/engine/volume-landmarks";
import { V2_POLICY_GUARDRAILS } from "./mesocycle-demand";
import type {
  V2PlannerSetRange,
  V2PlannerSlotId,
  V2TargetSkeleton,
} from "./types";

export type V2SupportLanePolicyRationaleLabel =
  | "hypertrophy_training_principle"
  | "v2_target_spec"
  | "app_architecture"
  | "diagnostic_only";

export type V2SupportLaneExpansionPolicy = {
  firstChoice: string;
  supplementalOnly: string[];
  avoidAsPrimarySolution: string[];
  provisionalOrDiagnosticOnly: string[];
};

export type V2SupportLaneTierAwareConcentrationPolicy = {
  targetTier: MuscleTargetTier | "PRIMARY_TARGET_POLICY";
  laneKind: "primary_target" | "support_direct_isolation" | "diagnostic_optional";
  warningShare: number;
  blockerShare: number;
  maxDirectSetsPerExerciseWithoutJustification: number;
  rationale: string[];
};

export type V2SupportLaneOptionalActivationRule =
  | {
      type: "not_applicable";
      diagnosticOnly: true;
    }
  | {
      type: "conditional_under_support_floor";
      slotId: V2PlannerSlotId;
      laneId: string;
      required: false;
      weeklySupportFloor: number;
      requiresDirectFloorAttemptedFirst: true;
      requiresReasonableCollateralCreditedFirst: true;
      requiresRecoverability: true;
      doesNotCreateHardFloor: true;
      diagnosticOnly: true;
    };

export type V2SupportLanePolicyRow = {
  muscle: "Triceps" | "Side Delts" | "Rear Delts" | "Biceps";
  targetTier: MuscleTargetTier | null;
  owningSlotId: V2PlannerSlotId;
  owningLaneId: string;
  directFloor: {
    slotId: V2PlannerSlotId;
    laneId: string;
    minDirectSets: number;
    requiredExerciseClasses: string[];
    collateralCanSatisfyDirectFloor: false;
  };
  preferredDirectSets: V2PlannerSetRange;
  collateralCreditLimit: {
    maxWeeklyEffectiveSetsCreditable: number;
    collateralSources: string[];
    creditAppliesToWeeklyTotalOnly: true;
  };
  collateralMaySupplement: boolean;
  collateralCanSatisfyDirectFloor: false;
  optionalActivationRule: V2SupportLaneOptionalActivationRule;
  expansionPolicy: V2SupportLaneExpansionPolicy;
  tierAwareConcentrationPolicy: V2SupportLaneTierAwareConcentrationPolicy;
  rationaleLabels: V2SupportLanePolicyRationaleLabel[];
  evidenceBasis: string[];
  limitations: string[];
};

export type V2SupportLanePolicy = {
  version: 1;
  source: "v2_planner_policy";
  readOnly: true;
  affectsScoringOrGeneration: false;
  designBasis: {
    targetSkeleton: "upper_lower_4x_v2";
    evidencePolicy: "volume_landmarks_and_target_tiers";
    allocationTiming: "before_exercise_selection";
  };
  summary: {
    policyCount: number;
    requiredDirectFloorCount: number;
    optionalConditionalLaneCount: number;
    diagnosticOnlyCount: number;
  };
  tierAwareConcentrationPolicy: V2SupportLaneTierAwareConcentrationPolicy[];
  supportLanes: V2SupportLanePolicyRow[];
  guardrails: typeof V2_POLICY_GUARDRAILS & {
    doesNotUseRepairEvidenceAsPolicy: true;
    doesNotAffectSelection: true;
    doesNotAffectRepair: true;
    doesNotAffectSeedSerialization: true;
  };
};

export type V2SupportLaneActivationEvaluation = {
  active: boolean;
  reason:
    | "not_conditional_lane"
    | "candidate_slot_mismatch"
    | "direct_floor_not_attempted"
    | "not_recoverable"
    | "still_under_support_floor_after_direct_floor_and_collateral"
    | "support_floor_already_covered";
  creditedCollateralSets: number;
  countedTowardDirectFloor: 0;
};

type SupportLanePolicySpec = {
  muscle: V2SupportLanePolicyRow["muscle"];
  owningSlotId: V2PlannerSlotId;
  owningLaneId: string;
  directFloorMin: number;
  preferredDirectSets: V2PlannerSetRange;
  collateralCreditLimit: V2SupportLanePolicyRow["collateralCreditLimit"];
  optionalActivationRule: V2SupportLaneOptionalActivationRule;
  expansionPolicy: V2SupportLaneExpansionPolicy;
  limitations?: string[];
};

const REQUIRED_RATIONALE_LABELS: V2SupportLanePolicyRationaleLabel[] = [
  "hypertrophy_training_principle",
  "v2_target_spec",
  "app_architecture",
  "diagnostic_only",
];

const SUPPORT_LANE_SPECS: SupportLanePolicySpec[] = [
  {
    muscle: "Triceps",
    owningSlotId: "upper_a",
    owningLaneId: "triceps",
    directFloorMin: 2,
    preferredDirectSets: { min: 2, preferred: 3, max: 3 },
    collateralCreditLimit: {
      maxWeeklyEffectiveSetsCreditable: 2,
      collateralSources: ["horizontal_press", "vertical_press"],
      creditAppliesToWeeklyTotalOnly: true,
    },
    optionalActivationRule: {
      type: "conditional_under_support_floor",
      slotId: "upper_b",
      laneId: "optional_triceps_if_under_target",
      required: false,
      weeklySupportFloor: 4,
      requiresDirectFloorAttemptedFirst: true,
      requiresReasonableCollateralCreditedFirst: true,
      requiresRecoverability: true,
      doesNotCreateHardFloor: true,
      diagnosticOnly: true,
    },
    expansionPolicy: {
      firstChoice: "upper_a_direct_triceps_isolation_floor",
      supplementalOnly: ["pressing_collateral_after_direct_floor"],
      avoidAsPrimarySolution: ["pressing_collateral_as_direct_floor"],
      provisionalOrDiagnosticOnly: ["upper_b_optional_triceps_if_still_under_floor"],
    },
  },
  {
    muscle: "Side Delts",
    owningSlotId: "upper_a",
    owningLaneId: "side_delt_isolation",
    directFloorMin: 2,
    preferredDirectSets: { min: 2, preferred: 2, max: 2 },
    collateralCreditLimit: {
      maxWeeklyEffectiveSetsCreditable: 1,
      collateralSources: ["ohp", "vertical_press"],
      creditAppliesToWeeklyTotalOnly: true,
    },
    optionalActivationRule: {
      type: "not_applicable",
      diagnosticOnly: true,
    },
    expansionPolicy: {
      firstChoice: "upper_a_second_direct_side_delt_isolation_exposure",
      supplementalOnly: ["ohp_vertical_press_collateral"],
      avoidAsPrimarySolution: ["vertical_press_collateral_as_side_delt_solution"],
      provisionalOrDiagnosticOnly: [],
    },
  },
  {
    muscle: "Side Delts",
    owningSlotId: "upper_b",
    owningLaneId: "side_delt_isolation",
    directFloorMin: 3,
    preferredDirectSets: { min: 3, preferred: 4, max: 4 },
    collateralCreditLimit: {
      maxWeeklyEffectiveSetsCreditable: 1,
      collateralSources: ["ohp", "vertical_press"],
      creditAppliesToWeeklyTotalOnly: true,
    },
    optionalActivationRule: {
      type: "not_applicable",
      diagnosticOnly: true,
    },
    expansionPolicy: {
      firstChoice: "upper_b_lateral_raise_or_low_collateral_side_delt_isolation",
      supplementalOnly: ["ohp_vertical_press_collateral"],
      avoidAsPrimarySolution: ["vertical_press_collateral_as_side_delt_solution"],
      provisionalOrDiagnosticOnly: [],
    },
  },
  {
    muscle: "Rear Delts",
    owningSlotId: "upper_a",
    owningLaneId: "rear_delt",
    directFloorMin: 2,
    preferredDirectSets: { min: 2, preferred: 2, max: 2 },
    collateralCreditLimit: {
      maxWeeklyEffectiveSetsCreditable: 1,
      collateralSources: ["row", "horizontal_pull", "vertical_pull"],
      creditAppliesToWeeklyTotalOnly: true,
    },
    optionalActivationRule: {
      type: "not_applicable",
      diagnosticOnly: true,
    },
    expansionPolicy: {
      firstChoice: "upper_a_rear_delt_isolation",
      supplementalOnly: ["row_collateral_with_direct_rear_delt_stimulus"],
      avoidAsPrimarySolution: ["generic_row_collateral_as_rear_delt_floor"],
      provisionalOrDiagnosticOnly: [
        "second_rear_delt_exposure_until_full_block_projection_proves_need_and_recoverability",
      ],
    },
    limitations: ["second_exposure_provisional_diagnostic_only"],
  },
  {
    muscle: "Biceps",
    owningSlotId: "upper_b",
    owningLaneId: "biceps",
    directFloorMin: 2,
    preferredDirectSets: { min: 2, preferred: 3, max: 3 },
    collateralCreditLimit: {
      maxWeeklyEffectiveSetsCreditable: 2,
      collateralSources: ["vertical_pull", "horizontal_pull"],
      creditAppliesToWeeklyTotalOnly: true,
    },
    optionalActivationRule: {
      type: "not_applicable",
      diagnosticOnly: true,
    },
    expansionPolicy: {
      firstChoice: "upper_b_direct_curl_lane",
      supplementalOnly: ["pulling_collateral_after_direct_curl_floor"],
      avoidAsPrimarySolution: ["pulling_collateral_as_direct_curl_floor"],
      provisionalOrDiagnosticOnly: ["upper_a_biceps_not_a_hard_floor"],
    },
  },
];

function findLane(input: {
  targetSkeleton: V2TargetSkeleton;
  slotId: V2PlannerSlotId;
  laneId: string;
}): V2TargetSkeleton["slots"][number]["lanes"][number] | undefined {
  return input.targetSkeleton.slots
    .find((slot) => slot.slotId === input.slotId)
    ?.lanes.find((lane) => lane.laneId === input.laneId);
}

export function resolveV2TierAwareConcentrationPolicy(input: {
  targetTier: MuscleTargetTier | null;
  laneKind: V2SupportLaneTierAwareConcentrationPolicy["laneKind"];
}): V2SupportLaneTierAwareConcentrationPolicy {
  if (input.laneKind === "primary_target" || input.targetTier === "A_PRIMARY") {
    return {
      targetTier: input.targetTier ?? "PRIMARY_TARGET_POLICY",
      laneKind: "primary_target",
      warningShare: 0.5,
      blockerShare: 0.6,
      maxDirectSetsPerExerciseWithoutJustification: 5,
      rationale: ["primary_targets_use_stricter_concentration_limits"],
    };
  }
  if (input.laneKind === "diagnostic_optional") {
    return {
      targetTier: input.targetTier ?? "B_SUPPORT",
      laneKind: "diagnostic_optional",
      warningShare: 0.65,
      blockerShare: 0.8,
      maxDirectSetsPerExerciseWithoutJustification: 3,
      rationale: ["optional_lanes_remain_diagnostic_until_projection_proves_need"],
    };
  }
  return {
    targetTier: input.targetTier ?? "B_SUPPORT",
    laneKind: "support_direct_isolation",
    warningShare: 0.6,
    blockerShare: 0.75,
    maxDirectSetsPerExerciseWithoutJustification: 4,
    rationale: [
      "support_direct_isolation_allows_more_concentration_than_primary_targets",
      "direct_floor_still_requires_isolation_sets",
    ],
  };
}

function buildSupportLane(input: {
  targetSkeleton: V2TargetSkeleton;
  spec: SupportLanePolicySpec;
}): V2SupportLanePolicyRow {
  const lane = findLane({
    targetSkeleton: input.targetSkeleton,
    slotId: input.spec.owningSlotId,
    laneId: input.spec.owningLaneId,
  });
  const targetTier = getMuscleTargetSemantics(input.spec.muscle).targetTier;

  return {
    muscle: input.spec.muscle,
    targetTier,
    owningSlotId: input.spec.owningSlotId,
    owningLaneId: input.spec.owningLaneId,
    directFloor: {
      slotId: input.spec.owningSlotId,
      laneId: input.spec.owningLaneId,
      minDirectSets: input.spec.directFloorMin,
      requiredExerciseClasses: [...(lane?.preferredExerciseClasses ?? [])],
      collateralCanSatisfyDirectFloor: false,
    },
    preferredDirectSets: { ...input.spec.preferredDirectSets },
    collateralCreditLimit: {
      ...input.spec.collateralCreditLimit,
      collateralSources: [...input.spec.collateralCreditLimit.collateralSources],
    },
    collateralMaySupplement: true,
    collateralCanSatisfyDirectFloor: false,
    optionalActivationRule: input.spec.optionalActivationRule,
    expansionPolicy: {
      firstChoice: input.spec.expansionPolicy.firstChoice,
      supplementalOnly: [...input.spec.expansionPolicy.supplementalOnly],
      avoidAsPrimarySolution: [...input.spec.expansionPolicy.avoidAsPrimarySolution],
      provisionalOrDiagnosticOnly: [
        ...input.spec.expansionPolicy.provisionalOrDiagnosticOnly,
      ],
    },
    tierAwareConcentrationPolicy: resolveV2TierAwareConcentrationPolicy({
      targetTier,
      laneKind: "support_direct_isolation",
    }),
    rationaleLabels: [...REQUIRED_RATIONALE_LABELS],
    evidenceBasis: [
      "v2_target_skeleton",
      "volume_landmarks_and_target_tiers",
      "support_lane_policy_v2_target_spec",
      "ignores_no_repair_repaired_seed_runtime_output",
    ],
    limitations: uniqueSorted([
      ...(lane ? [] : ["owning_lane_missing_from_target_skeleton"]),
      ...(input.spec.limitations ?? []),
      "read_only_diagnostic_policy_not_selection_or_repair_input",
    ]),
  };
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) =>
    left.localeCompare(right),
  );
}

export function buildV2SupportLanePolicy(input: {
  targetSkeleton: V2TargetSkeleton;
}): V2SupportLanePolicy {
  const supportLanes = SUPPORT_LANE_SPECS.map((spec) =>
    buildSupportLane({ targetSkeleton: input.targetSkeleton, spec }),
  );

  return {
    version: 1,
    source: "v2_planner_policy",
    readOnly: true,
    affectsScoringOrGeneration: false,
    designBasis: {
      targetSkeleton: "upper_lower_4x_v2",
      evidencePolicy: "volume_landmarks_and_target_tiers",
      allocationTiming: "before_exercise_selection",
    },
    summary: {
      policyCount: supportLanes.length,
      requiredDirectFloorCount: supportLanes.filter(
        (lane) => lane.directFloor.minDirectSets > 0,
      ).length,
      optionalConditionalLaneCount: supportLanes.filter(
        (lane) => lane.optionalActivationRule.type !== "not_applicable",
      ).length,
      diagnosticOnlyCount: supportLanes.filter((lane) =>
        lane.rationaleLabels.includes("diagnostic_only"),
      ).length,
    },
    tierAwareConcentrationPolicy: [
      resolveV2TierAwareConcentrationPolicy({
        targetTier: "A_PRIMARY",
        laneKind: "primary_target",
      }),
      resolveV2TierAwareConcentrationPolicy({
        targetTier: "B_SUPPORT",
        laneKind: "support_direct_isolation",
      }),
      resolveV2TierAwareConcentrationPolicy({
        targetTier: "B_SUPPORT",
        laneKind: "diagnostic_optional",
      }),
    ],
    supportLanes,
    guardrails: {
      ...V2_POLICY_GUARDRAILS,
      doesNotUseRepairEvidenceAsPolicy: true,
      doesNotAffectSelection: true,
      doesNotAffectRepair: true,
      doesNotAffectSeedSerialization: true,
    },
  };
}

export function evaluateV2SupportLaneOptionalActivation(input: {
  policy: V2SupportLanePolicyRow;
  candidateSlotId: V2PlannerSlotId;
  directSetsInOwningSlot: number;
  reasonableCollateralEffectiveSets: number;
  recoverable: boolean;
}): V2SupportLaneActivationEvaluation {
  const rule = input.policy.optionalActivationRule;
  const creditedCollateralSets = Math.min(
    Math.max(0, input.reasonableCollateralEffectiveSets),
    input.policy.collateralCreditLimit.maxWeeklyEffectiveSetsCreditable,
  );

  if (rule.type !== "conditional_under_support_floor") {
    return {
      active: false,
      reason: "not_conditional_lane",
      creditedCollateralSets,
      countedTowardDirectFloor: 0,
    };
  }
  if (input.candidateSlotId !== rule.slotId) {
    return {
      active: false,
      reason: "candidate_slot_mismatch",
      creditedCollateralSets,
      countedTowardDirectFloor: 0,
    };
  }
  if (input.directSetsInOwningSlot < input.policy.directFloor.minDirectSets) {
    return {
      active: false,
      reason: "direct_floor_not_attempted",
      creditedCollateralSets,
      countedTowardDirectFloor: 0,
    };
  }
  if (!input.recoverable) {
    return {
      active: false,
      reason: "not_recoverable",
      creditedCollateralSets,
      countedTowardDirectFloor: 0,
    };
  }

  const weeklyTotalAfterReasonableCollateral =
    input.directSetsInOwningSlot + creditedCollateralSets;
  const active = weeklyTotalAfterReasonableCollateral < rule.weeklySupportFloor;

  return {
    active,
    reason: active
      ? "still_under_support_floor_after_direct_floor_and_collateral"
      : "support_floor_already_covered",
    creditedCollateralSets,
    countedTowardDirectFloor: 0,
  };
}
