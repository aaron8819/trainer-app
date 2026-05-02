import type {
  V2ExerciseSelectionPlan,
  V2TargetSkeleton,
} from "./types";

export type V2LaneSelectionIntentRisk =
  | "correctness"
  | "quality"
  | "extensibility"
  | "acceptable_for_now";

export type V2LaneSelectionIntentAudit = {
  version: 1;
  source: "v2_lane_selection_intent_audit";
  readOnly: true;
  affectsScoringOrGeneration: false;
  consumedByDemandOrMaterializer: false;
  summary: {
    totalLanes: number;
    lanesWithCorrectnessRisk: number;
    lanesWithQualityRisk: number;
    lanesWithExtensibilityRisk: number;
  };
  lanes: Array<{
    slotId: string;
    laneId: string;
    role: string;
    availableIntent: Record<string, unknown>;
    missingIntent: Array<{
      field: string;
      risk: V2LaneSelectionIntentRisk;
      reason: string;
      recommendedFutureContractField?: string;
    }>;
    notes?: string[];
  }>;
};

export type V2LaneSelectionIntentAuditInput = {
  exerciseSelectionPlan: V2ExerciseSelectionPlan;
  targetSkeleton?: V2TargetSkeleton;
};

type AuditLane = V2LaneSelectionIntentAudit["lanes"][number];
type MissingIntent = AuditLane["missingIntent"][number];
type PlanSlot =
  V2ExerciseSelectionPlan["weeks"][number]["slots"][number];
type PlanLane = PlanSlot["lanes"][number];
type SkeletonLane = V2TargetSkeleton["slots"][number]["lanes"][number];

const MATERIALIZER_FACING_PHASES = new Set([
  "accumulation",
  "hard_accumulation",
  "peak_overreach_lite",
]);

function laneKey(slotId: string, laneId: string): string {
  return `${slotId}:${laneId}`;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function hasOwnField(value: object, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, field);
}

function hasAnyClass(lane: PlanLane, classes: string[]): boolean {
  return classes.some(
    (className) =>
      lane.acceptableExerciseClasses.includes(className) ||
      lane.preferredExerciseClasses.includes(className),
  );
}

function hasExplicitMovementIntent(lane: PlanLane): boolean {
  return (
    hasOwnField(lane, "requiredMovementPatterns") ||
    hasOwnField(lane, "preferredMovementPatterns") ||
    hasOwnField(lane, "movementPatternRequirements")
  );
}

function hasExplicitSubstitutionStrictness(lane: PlanLane): boolean {
  return (
    hasOwnField(lane, "substitutionStrictness") ||
    hasOwnField(lane, "allowedSubstitutionClasses") ||
    hasOwnField(lane, "disallowedSubstitutionClasses")
  );
}

function hasExplicitStabilityPreference(lane: PlanLane): boolean {
  return (
    hasOwnField(lane, "stabilityPreference") ||
    hasOwnField(lane, "stabilityBias")
  );
}

function hasExplicitFatiguePreference(lane: PlanLane): boolean {
  return (
    hasOwnField(lane, "fatiguePreference") ||
    hasOwnField(lane, "axialFatiguePreference") ||
    hasOwnField(lane, "systemicFatiguePreference")
  );
}

function hasExplicitRankingPriority(lane: PlanLane): boolean {
  return hasOwnField(lane, "rankingPriority");
}

function hasExplicitProgressionPreference(lane: PlanLane): boolean {
  return (
    hasOwnField(lane, "progressionLoadabilityPreference") ||
    hasOwnField(lane, "loadabilityPreference")
  );
}

function pushMissing(
  missing: MissingIntent[],
  field: string,
  risk: V2LaneSelectionIntentRisk,
  reason: string,
  recommendedFutureContractField?: string,
): void {
  if (
    missing.some(
      (item) =>
        item.field === field && item.risk === risk && item.reason === reason,
    )
  ) {
    return;
  }

  missing.push({
    field,
    risk,
    reason,
    ...(recommendedFutureContractField
      ? { recommendedFutureContractField }
      : {}),
  });
}

function isVerticalPullLane(laneId: string): boolean {
  return laneId === "vertical_pull_anchor" || laneId === "vertical_pull_support";
}

function isSquatOrQuadLane(laneId: string): boolean {
  return (
    laneId === "squat_anchor" ||
    laneId === "quad_isolation" ||
    laneId === "quad_support"
  );
}

function isQuadIsolationLane(laneId: string): boolean {
  return laneId === "quad_isolation";
}

function isQuadSupportLane(laneId: string): boolean {
  return laneId === "quad_support";
}

function isHingeAnchorLane(laneId: string): boolean {
  return laneId === "hinge_anchor";
}

function isChestLane(laneId: string): boolean {
  return (
    laneId === "chest_anchor" ||
    laneId === "chest_second_exposure" ||
    laneId === "chest_secondary"
  );
}

function isChestSecondExposureLane(laneId: string): boolean {
  return laneId === "chest_second_exposure" || laneId === "chest_secondary";
}

function isRowLane(laneId: string): boolean {
  return laneId === "row_anchor" || laneId === "row_support";
}

function isCalfLane(laneId: string): boolean {
  return laneId === "calves";
}

function laneFamilyNotes(lane: PlanLane): string[] {
  const notes: string[] = [];
  const classes = unique([
    ...lane.acceptableExerciseClasses,
    ...lane.preferredExerciseClasses,
  ]);

  if (isVerticalPullLane(lane.laneId)) {
    notes.push("high_risk_lane_family:vertical_pull");
  }
  if (isSquatOrQuadLane(lane.laneId)) {
    notes.push("high_risk_lane_family:squat_quad");
  }
  if (isHingeAnchorLane(lane.laneId)) {
    notes.push("high_risk_lane_family:hinge_anchor");
  }
  if (isChestLane(lane.laneId)) {
    notes.push("high_risk_lane_family:chest");
  }
  if (isRowLane(lane.laneId)) {
    notes.push("high_risk_lane_family:row");
  }
  if (isCalfLane(lane.laneId)) {
    notes.push("high_risk_lane_family:calves");
  }
  if (classes.length > 0) {
    notes.push(`class_intent_available:${classes.join(",")}`);
  }
  if (
    isQuadIsolationLane(lane.laneId) &&
    classes.includes("quad_isolation") &&
    !classes.includes("squat_pattern")
  ) {
    notes.push("quad_isolation_class_separate_from_squat_pattern");
  }
  if (lane.directFloor) {
    notes.push("direct_floor_available");
  }
  if (lane.managedCollateralMuscles.length > 0) {
    notes.push("managed_collateral_muscles_available");
  }

  return notes;
}

function missingIntentForPlanLane(lane: PlanLane): MissingIntent[] {
  const missing: MissingIntent[] = [];
  const hasMovementIntent = hasExplicitMovementIntent(lane);
  const hasSubstitutionStrictness = hasExplicitSubstitutionStrictness(lane);
  const hasStabilityPreference = hasExplicitStabilityPreference(lane);
  const hasFatiguePreference = hasExplicitFatiguePreference(lane);
  const hasRankingPriority = hasExplicitRankingPriority(lane);
  const hasProgressionPreference = hasExplicitProgressionPreference(lane);

  if (isVerticalPullLane(lane.laneId)) {
    if (!hasMovementIntent) {
      pushMissing(
        missing,
        "requiredMovementPatterns",
        "correctness",
        "The lane exposes a vertical_pull class, but the planner does not state the required direct vertical-pull movement pattern; materialization must infer it from taxonomy aliases.",
        "movementPatternRequirements.required",
      );
    }
    if (!lane.directFloor) {
      pushMissing(
        missing,
        "directnessRequirement",
        "correctness",
        "The lane targets Lats directly, but directness is implicit in class matching instead of a planner-owned directness contract.",
        "directness.requiredDirectMuscles",
      );
    }
    if (!hasSubstitutionStrictness) {
      pushMissing(
        missing,
        "substitutionStrictness",
        "correctness",
        "The lane does not state which near-pull substitutions are disallowed when a direct vertical-pull class is required.",
        "substitution.strictness",
      );
    }
  }

  if (isQuadIsolationLane(lane.laneId)) {
    if (!hasMovementIntent) {
      pushMissing(
        missing,
        "requiredMovementPatterns",
        "correctness",
        "The lane exposes leg_extension and quad_isolation classes, but the planner does not state the required isolation movement pattern.",
        "movementPatternRequirements.required",
      );
    }
    if (!hasSubstitutionStrictness) {
      pushMissing(
        missing,
        "substitutionStrictness",
        "correctness",
        "The lane does not explicitly forbid squat-pattern substitution when the support intent is quad isolation.",
        "substitution.disallowedClasses",
      );
    }
  }

  if (isQuadSupportLane(lane.laneId)) {
    if (!hasMovementIntent) {
      pushMissing(
        missing,
        "movementPatternPreferences",
        "quality",
        "The lane allows broad quad-support classes but does not rank squat, press, lunge, and isolation patterns for the support role.",
        "movementPatternRequirements.preferred",
      );
    }
    if (!hasSubstitutionStrictness) {
      pushMissing(
        missing,
        "substitutionStrictness",
        "quality",
        "The lane does not state how far a support substitution can drift from the intended quad-support pattern.",
        "substitution.strictness",
      );
    }
  }

  if (lane.laneId === "squat_anchor" && !hasFatiguePreference) {
    pushMissing(
      missing,
      "axialFatiguePreference",
      "quality",
      "The squat anchor has class intent, but no planner-owned axial or systemic fatigue preference for choosing among viable quad anchors.",
      "fatiguePreference.axial",
    );
  }

  if (isHingeAnchorLane(lane.laneId)) {
    if (lane.managedCollateralMuscles.length > 0) {
      pushMissing(
        missing,
        "managedCollateralPolicy",
        "correctness",
        "Managed collateral muscles are visible, but caps or allowed collateral levels are not materializer-consumable.",
        "managedCollateral.maxStimulusByMuscle",
      );
    }
    if (!hasFatiguePreference) {
      pushMissing(
        missing,
        "axialFatiguePreference",
        "quality",
        "The hinge anchor lacks explicit axial/systemic fatigue preference, so fatigue ranking is inferred downstream.",
        "fatiguePreference.axial",
      );
    }
    if (!hasMovementIntent) {
      pushMissing(
        missing,
        "movementPatternPreferences",
        "quality",
        "The hinge anchor exposes classes but does not rank hinge versus lower-axial hip-extension pattern preference.",
        "movementPatternRequirements.preferred",
      );
    }
  }

  if (isChestLane(lane.laneId)) {
    if (!hasStabilityPreference) {
      pushMissing(
        missing,
        "stabilityPreference",
        "quality",
        "The lane does not state stability preference for chest stimulus; continuity policy only covers lane-class identity.",
        "stabilityPreference",
      );
    }
    if (isChestSecondExposureLane(lane.laneId) && !hasMovementIntent) {
      pushMissing(
        missing,
        "pressVsFlyPriority",
        "quality",
        "The second chest exposure allows press-or-fly classes but does not state press-vs-fly priority or when either is preferred.",
        "movementPatternRequirements.ranking",
      );
    }
  }

  if (isRowLane(lane.laneId)) {
    if (!hasMovementIntent) {
      pushMissing(
        missing,
        "requiredMovementPatterns",
        "quality",
        "The lane exposes row classes, but the planner does not state the required horizontal-pull movement pattern directly.",
        "movementPatternRequirements.required",
      );
    }
    if (!hasSubstitutionStrictness) {
      pushMissing(
        missing,
        "substitutionStrictness",
        "quality",
        "The lane does not state which pull substitutions are unacceptable for row-anchor or row-support intent.",
        "substitution.disallowedClasses",
      );
    }
  }

  if (isCalfLane(lane.laneId)) {
    if (!hasMovementIntent) {
      pushMissing(
        missing,
        "movementPatternPreferences",
        "extensibility",
        "The calf lane is direct-classed, but future calf-variant or bias policy is not explicit.",
        "movementPatternRequirements.preferred",
      );
    }
    pushMissing(
      missing,
      "crossSlotDuplicatePolicy",
      "quality",
      "The lane has same-slot duplicate policy but no explicit cross-lower-slot calf variant or reuse policy.",
      "duplicatePolicy.crossSlot",
    );
  }

  if (lane.role === "anchor" && !hasProgressionPreference) {
    pushMissing(
      missing,
      "progressionLoadabilityPreference",
      "quality",
      "Anchor lanes do not state loadability or progression preference, so the materializer can only infer it indirectly.",
      "progressionLoadabilityPreference",
    );
  }

  if (lane.requirement === "required" && !hasRankingPriority) {
    pushMissing(
      missing,
      "rankingPriority",
      "extensibility",
      "The lane does not expose planner-owned ranking priority among class fit, directness, stability, fatigue, loadability, continuity, and duplicate policy.",
      "rankingPriority",
    );
  }

  if (
    lane.requirement !== "required" &&
    lane.setBudget.preferred <= 0 &&
    missing.length === 0
  ) {
    pushMissing(
      missing,
      "activationRankingPriority",
      "acceptable_for_now",
      "Zero-budget optional or managed-collateral lanes are intentionally not materialized until a future activation policy promotes them.",
      "optionalActivation.rankingPriority",
    );
  }

  return missing;
}

function availableIntentForPlanLane(input: {
  week: number;
  slot: PlanSlot;
  lane: PlanLane;
}): Record<string, unknown> {
  const { week, slot, lane } = input;
  return {
    representativeWeek: week,
    materializerFacing: true,
    requirement: lane.requirement,
    classLaneKind: lane.classLaneKind,
    targetMuscles: {
      primary: [...lane.primaryMuscles],
      support: [...lane.supportMuscles],
      optional: [...lane.optionalMuscles],
      managedCollateral: [...lane.managedCollateralMuscles],
    },
    setBudget: { ...lane.setBudget },
    setBudgetBasis: lane.setBudgetBasis,
    classRequirementsPreferences: {
      acceptableExerciseClasses: [...lane.acceptableExerciseClasses],
      preferredExerciseClasses: [...lane.preferredExerciseClasses],
    },
    ...(lane.directFloor
      ? {
          directnessRequirement: {
            ...lane.directFloor,
            requiredExerciseClasses: [
              ...lane.directFloor.requiredExerciseClasses,
            ],
          },
        }
      : {}),
    ...(lane.optionalActivation
      ? { optionalActivation: { ...lane.optionalActivation } }
      : {}),
    perExerciseCap: { ...lane.perExerciseCap },
    cleanAlternativePolicy: { ...lane.cleanAlternativePolicy },
    continuityDuplicatePolicy: {
      duplicatePolicy: { ...lane.duplicatePolicy },
      cleanAlternativePolicy: { ...lane.cleanAlternativePolicy },
      continuityPolicy: { ...lane.continuityPolicy },
    },
    slotCapacity: {
      maxExerciseCount: slot.maxExerciseCount,
      targetSessionSets: { ...slot.targetSessionSets },
    },
  };
}

function representativePlanSlots(
  plan: V2ExerciseSelectionPlan,
): Array<{ week: number; slot: PlanSlot }> {
  const sortedWeeks = [...plan.weeks].sort((left, right) => left.week - right.week);
  const baseWeeks = sortedWeeks.filter((week) =>
    MATERIALIZER_FACING_PHASES.has(week.phase),
  );
  const sourceWeeks = baseWeeks.length > 0 ? baseWeeks : sortedWeeks;
  const seenSlots = new Set<string>();
  const slots: Array<{ week: number; slot: PlanSlot }> = [];

  for (const week of sourceWeeks) {
    for (const slot of [...week.slots].sort(
      (left, right) =>
        left.slotIndex - right.slotIndex || left.slotId.localeCompare(right.slotId),
    )) {
      if (seenSlots.has(slot.slotId)) {
        continue;
      }
      seenSlots.add(slot.slotId);
      slots.push({ week: week.week, slot });
    }
  }

  return slots;
}

function buildPlanAuditLanes(plan: V2ExerciseSelectionPlan): AuditLane[] {
  return representativePlanSlots(plan).flatMap(({ week, slot }) =>
    slot.lanes.map((lane) => {
      const notes = laneFamilyNotes(lane);
      return {
        slotId: slot.slotId,
        laneId: lane.laneId,
        role: lane.role,
        availableIntent: availableIntentForPlanLane({ week, slot, lane }),
        missingIntent: missingIntentForPlanLane(lane),
        ...(notes.length ? { notes } : {}),
      };
    }),
  );
}

function skeletonOnlyNotes(lane: SkeletonLane): string[] {
  const notes = ["skeleton_only_lane", "not_materializer_facing"];
  if (isChestLane(lane.laneId)) {
    notes.push("high_risk_lane_family:chest");
  }
  if (lane.preferredExerciseClasses.length > 0) {
    notes.push(
      `class_intent_available:${lane.preferredExerciseClasses.join(",")}`,
    );
  }
  return notes;
}

function skeletonOnlyMissingIntent(input: {
  slotId: string;
  lane: SkeletonLane;
}): MissingIntent[] {
  const risk: V2LaneSelectionIntentRisk = input.lane.required
    ? "correctness"
    : "extensibility";
  return [
    {
      field: "materializerFacingLane",
      risk,
      reason:
        "The target skeleton lane is not present in the final ExerciseSelectionPlan, so materialization cannot preserve or reject this lane intent.",
      recommendedFutureContractField:
        "exerciseSelectionPlan.lanes[] or targetSkeleton.retiredLanes[]",
    },
    {
      field: "staticOwnershipRows",
      risk: "extensibility",
      reason:
        "The lane has skeleton intent but no current static ownership row feeding class, set, or selection policy.",
      recommendedFutureContractField:
        "slotDemandAllocation.ownershipRows",
    },
  ];
}

function buildSkeletonOnlyAuditLanes(input: {
  targetSkeleton: V2TargetSkeleton | undefined;
  materializerFacingKeys: ReadonlySet<string>;
}): AuditLane[] {
  if (!input.targetSkeleton) {
    return [];
  }

  return input.targetSkeleton.slots.flatMap((slot) =>
    slot.lanes.flatMap((lane) => {
      if (input.materializerFacingKeys.has(laneKey(slot.slotId, lane.laneId))) {
        return [];
      }
      return [
        {
          slotId: slot.slotId,
          laneId: lane.laneId,
          role: lane.role,
          availableIntent: {
            materializerFacing: false,
            presentInTargetSkeleton: true,
            presentInExerciseSelectionPlan: false,
            required: lane.required,
            targetMuscles: {
              primary: [...lane.primaryMuscles],
            },
            setBudget: { ...lane.targetSets },
            classRequirementsPreferences: {
              preferredExerciseClasses: [...lane.preferredExerciseClasses],
            },
          },
          missingIntent: skeletonOnlyMissingIntent({
            slotId: slot.slotId,
            lane,
          }),
          notes: skeletonOnlyNotes(lane),
        },
      ];
    }),
  );
}

function summaryForLanes(
  lanes: V2LaneSelectionIntentAudit["lanes"],
): V2LaneSelectionIntentAudit["summary"] {
  return {
    totalLanes: lanes.length,
    lanesWithCorrectnessRisk: lanes.filter((lane) =>
      lane.missingIntent.some((missing) => missing.risk === "correctness"),
    ).length,
    lanesWithQualityRisk: lanes.filter((lane) =>
      lane.missingIntent.some((missing) => missing.risk === "quality"),
    ).length,
    lanesWithExtensibilityRisk: lanes.filter((lane) =>
      lane.missingIntent.some((missing) => missing.risk === "extensibility"),
    ).length,
  };
}

export function buildV2LaneSelectionIntentAudit(
  input: V2LaneSelectionIntentAuditInput,
): V2LaneSelectionIntentAudit {
  const planLanes = buildPlanAuditLanes(input.exerciseSelectionPlan);
  const materializerFacingKeys = new Set(
    planLanes.map((lane) => laneKey(lane.slotId, lane.laneId)),
  );
  const skeletonOnlyLanes = buildSkeletonOnlyAuditLanes({
    targetSkeleton: input.targetSkeleton,
    materializerFacingKeys,
  });
  const lanes = [...planLanes, ...skeletonOnlyLanes];

  return {
    version: 1,
    source: "v2_lane_selection_intent_audit",
    readOnly: true,
    affectsScoringOrGeneration: false,
    consumedByDemandOrMaterializer: false,
    summary: summaryForLanes(lanes),
    lanes,
  };
}
