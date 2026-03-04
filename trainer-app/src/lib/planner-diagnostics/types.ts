import type { MuscleId } from "@/lib/engine/types";

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
  exerciseName: string;
  kind: "add" | "expand";
  setDelta: number;
  dominantDeficitMuscle?: string;
  dominantDeficitRemaining?: number;
  dominantDeficitContribution: number;
  totalScore?: number;
  deficitReduction?: number;
  dominantDeficitReduction?: number;
  collateralOvershoot?: number;
  fatigueCost?: number;
  score?: number;
  filteredOutReason?: string;
};

export type PlannerDiagnostics = {
  muscles: Record<string, PlannerMuscleDiagnostic>;
  exercises: Record<string, PlannerExerciseDiagnostic>;
  closure: {
    actions: PlannerClosureActionDiagnostic[];
    firstIterationCandidates?: PlannerClosureCandidateDiagnostic[];
  };
};
