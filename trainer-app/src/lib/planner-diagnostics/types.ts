import type { MuscleId } from "@/lib/engine/types";
import type { SessionInventoryKind, SessionOpportunityCharacter } from "@/lib/planning/session-opportunities";
import type { SessionIntent } from "@/lib/engine/session-types";

export type PlannerRoleAnchor =
  | { kind: "muscle"; muscle: MuscleId }
  | { kind: "movement_pattern"; movementPattern: string };

export type PlannerOvershootAdjustment = {
  initialSetTarget: number;
  finalSetTarget: number;
  reductionsApplied: number;
  limitingMuscles: string[];
};

export type PlannerAnchorBudgetDecision = {
  weeklyTarget: number;
  performedEffectiveVolumeBeforeSession: number;
  plannedEffectiveVolumeBeforeAssignment: number;
  reservedEffectiveVolumeForRemainingRoleFixtures: number;
  anchorRemainingBeforeAssignment: number;
  planningAdjustedAnchorRemaining?: number;
  anchorContributionPerSet: number;
  desiredSetTarget: number;
  anchorConstrainedContinuousSetTarget: number;
};

export type PlannerExerciseDiagnostic = {
  exerciseId: string;
  exerciseName: string;
  assignedSetCount: number;
  stimulusVector: Record<string, number>;
  anchorUsed?: PlannerRoleAnchor;
  anchorBudgetDecision?: PlannerAnchorBudgetDecision;
  overshootAdjustmentsApplied?: PlannerOvershootAdjustment;
  isRoleFixture: boolean;
  isClosureAddition: boolean;
  isSetExpandedCarryover: boolean;
  closureSetDelta: number;
};

export type PlannerMuscleDiagnostic = {
  weeklyTarget: number;
  performedEffectiveVolumeBeforeSession: number;
  plannedEffectiveVolumeAfterRoleBudgeting: number;
  projectedEffectiveVolumeAfterRoleBudgeting: number;
  deficitAfterRoleBudgeting: number;
  plannedEffectiveVolumeAfterClosure: number;
  projectedEffectiveVolumeAfterClosure: number;
  finalRemainingDeficit: number;
};

export type PlannerClosureActionDiagnostic = {
  exerciseId: string;
  exerciseName: string;
  kind: "add" | "expand";
  setDelta: number;
  deficitReduction: number;
  collateralOvershoot: number;
  fatigueCost: number;
  score: number;
};

export type PlannerClosureCandidateDiagnostic = {
  exerciseId: string;
  kind: "add" | "expand";
  setDelta: number;
  dominantDeficitMuscleId?: MuscleId;
  dominantDeficitRemaining?: number;
  dominantDeficitContribution: number;
  decision: "selected" | "rejected";
  rejectionReason?: string;
  deficitReduction?: number;
  dominantDeficitReduction?: number;
  collateralOvershoot?: number;
  fatigueCost?: number;
  score: number | null;
  exerciseName?: string;
};

export type PlannerLayerName =
  | "anchor"
  | "standard"
  | "supplemental"
  | "closure"
  | "rescue";

export type PlannerDeficitSnapshot = {
  weeklyTarget: number;
  performedEffectiveVolumeBeforeSession: number;
  plannedEffectiveVolume: number;
  projectedEffectiveVolume: number;
  remainingDeficit: number;
};

export type PlannerTradeoffDiagnostic = {
  layer: PlannerLayerName;
  code: string;
  message: string;
  exerciseId?: string;
  muscle?: string;
};

export type PlannerOpportunityMuscleDiagnostic = {
  sessionOpportunityWeight: number;
  weeklyTarget: number;
  performedEffectiveVolumeBeforeSession: number;
  startingDeficit: number;
  futureOpportunityUnits?: number;
  weeklyOpportunityUnits?: number;
  futureCapacity?: number;
  requiredNow?: number;
  urgencyMultiplier?: number;
};

export type PlannerOpportunityDiagnostic = {
  opportunityKey: string;
  sessionIntent: SessionIntent;
  sessionCharacter: SessionOpportunityCharacter;
  targetMuscles?: string[];
  planningInventoryKind: Extract<SessionInventoryKind, "standard" | "rescue">;
  closureInventoryKind: SessionInventoryKind;
  currentSessionMuscleOpportunity: Record<string, PlannerOpportunityMuscleDiagnostic>;
  remainingWeek?: {
    futureSlots: SessionIntent[];
    futureSlotCounts: Partial<Record<SessionIntent, number>>;
    futureCapacityFactor: number;
  };
};

export type PlannerAnchorFixtureDiagnostic = {
  exerciseId: string;
  exerciseName: string;
  role: "CORE_COMPOUND" | "ACCESSORY" | "UNASSIGNED";
  priority: "core" | "accessory";
  anchor?: PlannerRoleAnchor;
  proposedSets: number;
  minimumSets: number;
  desiredSets: number;
  plannedSets: number;
  kept: boolean;
  decisionCode:
    | "deload_passthrough"
    | "passed_through_without_anchor"
    | "kept_at_desired_target"
    | "kept_at_floor"
    | "trimmed_by_anchor_budget"
    | "trimmed_by_collateral_guardrail"
    | "trimmed_by_anchor_budget_and_collateral_guardrail"
    | "dropped_by_anchor_budget";
  reason: string;
  anchorBudgetDecision?: PlannerAnchorBudgetDecision;
  overshootAdjustmentsApplied?: PlannerOvershootAdjustment;
};

export type PlannerAnchorLayerDiagnostic = {
  used: boolean;
  policy: {
    coreMinimumSets: number;
    accessoryMinimumSets: number;
    coreDeferredDeficitCarryFraction: number;
    accessoryDeferredDeficitCarryFraction: number;
    supplementalInventory: Extract<SessionInventoryKind, "standard" | "closure">;
  };
  consideredFixtureIds: string[];
  keptFixtureIds: string[];
  droppedFixtureIds: string[];
  fixtures: PlannerAnchorFixtureDiagnostic[];
};

export type PlannerInventoryCandidateDiagnostic = {
  exerciseId: string;
  exerciseName: string;
  inventoryKind: SessionInventoryKind;
  eligibilityReason: string;
  selected: boolean;
  selectedSets?: number;
  rationale?: string;
  rejectionReason?: string;
};

export type PlannerStandardLayerDiagnostic = {
  used: boolean;
  reason: string;
  inventoryKind: "standard";
  selectedExerciseIds: string[];
  candidateCount: number;
  candidates?: PlannerInventoryCandidateDiagnostic[];
};

export type PlannerSupplementalLayerDiagnostic = {
  allowed: boolean;
  used: boolean;
  reason: string;
  inventoryKind?: Extract<SessionInventoryKind, "standard" | "closure" | "rescue">;
  deficitsTargeted: string[];
  selectedExerciseIds: string[];
  candidateCount: number;
  candidates?: PlannerInventoryCandidateDiagnostic[];
};

export type PlannerDiagnostics = {
  opportunity?: PlannerOpportunityDiagnostic;
  anchor?: PlannerAnchorLayerDiagnostic;
  standard?: PlannerStandardLayerDiagnostic;
  supplemental?: PlannerSupplementalLayerDiagnostic;
  muscles: Record<string, PlannerMuscleDiagnostic>;
  exercises: Record<string, PlannerExerciseDiagnostic>;
  closure: {
    eligible?: boolean;
    used?: boolean;
    reason?: string;
    inventoryKind?: SessionInventoryKind;
    eligibleExerciseIds?: string[];
    winningAction?: PlannerClosureActionDiagnostic;
    actions: PlannerClosureActionDiagnostic[];
    firstIterationCandidates?: PlannerClosureCandidateDiagnostic[];
  };
  rescue?: {
    eligible: boolean;
    used: boolean;
    reason: string;
    rescueOnlyCandidateCount: number;
    rescueOnlyExerciseIds: string[];
    selectedExerciseIds: string[];
    candidates?: PlannerInventoryCandidateDiagnostic[];
  };
  outcome?: {
    layersUsed: PlannerLayerName[];
    startingDeficits: Record<string, PlannerDeficitSnapshot>;
    deficitsAfterBaseSession: Record<string, PlannerDeficitSnapshot>;
    deficitsAfterSupplementation: Record<string, PlannerDeficitSnapshot>;
    deficitsAfterClosure: Record<string, PlannerDeficitSnapshot>;
    unresolvedDeficits: string[];
    keyTradeoffs: PlannerTradeoffDiagnostic[];
  };
};
