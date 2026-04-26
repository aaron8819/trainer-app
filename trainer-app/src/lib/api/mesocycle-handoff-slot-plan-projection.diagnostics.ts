import type { WorkoutSessionIntent } from "@prisma/client";
import { getEffectiveStimulusByMuscle } from "@/lib/engine/stimulus";
import {
  getMuscleTargetSemantics,
  normalizeExposedMuscle,
  VOLUME_LANDMARKS,
  type MuscleTargetTier,
  type VolumeSoftTargetRange,
  type VolumeTargetKind,
} from "@/lib/engine/volume-landmarks";
import {
  getProjectionPreferredSupportMuscles,
  getProjectionSoftPreferredSupportMuscles,
  getProtectedWeekOneCoverageObligations,
  resolveSessionSlotPolicy,
  type ProtectedWeekOneCoverageMuscle,
} from "@/lib/planning/session-slot-profile";
import type { WorkoutExercise } from "@/lib/engine/types";
import { getWeeklyVolumeTarget } from "./mesocycle-lifecycle";
import type { MesocycleSlotSequence } from "./mesocycle-slot-contract";
import {
  buildSlotSequenceEntries,
  computeProjectedWeeklyContributionByMuscle,
  getWorkoutExercises,
  roundToTenth,
  toSessionIntent,
  type ProjectedSlotWorkout,
  type ProtectedWeekOneCoverageEvaluation,
  type SupportFloorRepairReason,
} from "./mesocycle-handoff-slot-plan-projection.coverage-evaluation";
import type {
  ProgramQualityDiagnostic,
  ProgramQualityEvaluation,
} from "./mesocycle-handoff-slot-plan-projection.program-quality";
import {
  getSlotWeeklyObligations,
  HARD_WEEKLY_OBLIGATION_MUSCLES,
  type SlotObligationEvaluation,
  type WeeklyMuscleObligationPlan,
} from "./mesocycle-handoff-slot-plan-projection.weekly-obligations";
import { getWeekOneSupportFloor } from "./template-session/role-budgeting";
import type { MappedGenerationContext } from "./template-session/types";

export type RepairMateriality = "none" | "minor" | "moderate" | "major";

export type ProgramShapeWarningCode =
  | "REPAIR_CREATED_MATERIAL_SUPPORT_COVERAGE"
  | "REPAIR_ADDED_EXERCISE_IDENTITY"
  | "EXERCISE_CONCENTRATION_HIGH"
  | "SLOT_ALLOCATION_NOT_EXPLICIT"
  | "PRIMARY_MUSCLE_BELOW_TARGET_BEFORE_REPAIR"
  | "SUPPORT_FLOOR_CLOSED_LATE"
  | "FINAL_CAP_TRIM_REQUIRED";

export type WeeklyMuscleDemandDiagnostic = {
  muscle: string;
  targetTier: MuscleTargetTier | null;
  targetKind: VolumeTargetKind;
  targetStatus: "hard" | "soft" | "diagnostic";
  targetRange: VolumeSoftTargetRange | null;
  preferredTarget: number | null;
  mev: number | null;
  mav: number | null;
  explicitUpstream: boolean;
  inferredDownstream: boolean;
  source: string[];
};

export type SlotDemandAllocationDiagnostic = {
  slotId: string;
  slotLabel: string;
  intent: string;
  authoredSlotRole: string | null;
  slotProfile: {
    slotArchetype: string | null;
    continuityScope: string | null;
    requiredMovementPatterns: string[];
    preferredPrimaryMuscles: string[];
    preferredSupportMuscles: string[];
    protectedCoverageMuscles: string[];
  };
  expectedMuscleObligations: Array<{
    muscle: string;
    source:
      | "weekly_obligation"
      | "authored_protected_coverage"
      | "authored_primary_lane"
      | "authored_support_preference";
    targetStatus: "hard" | "soft" | "diagnostic";
    explicitUpstream: boolean;
    minEffectiveSets: number | null;
    priority: "primary" | "secondary" | "support" | "lane" | null;
  }>;
  projectedEffectiveStimulusByMuscle: Record<string, number>;
  meaningfullyServedMuscles: string[];
  allocationBasis:
    | "explicit_weekly_demand"
    | "authored_slot_semantics"
    | "local_movement_or_lane_semantics"
    | "unclear";
  satisfiesKnownWeeklyDemand: boolean;
};

export type ProjectedDeliveryDiagnostic = {
  muscle: string;
  targetStatus: WeeklyMuscleDemandDiagnostic["targetStatus"];
  targetRange: VolumeSoftTargetRange | null;
  preferredTarget: number | null;
  projectedEffectiveStimulusAfterInitialSlotComposition: number | null;
  projectedEffectiveStimulusAfterRepairAndFinalShaping: number;
  deltaFromPreferredTarget: number | null;
  exposureCount: number;
  majorContributingExercises: Array<{
    slotId: string;
    exerciseId: string;
    exerciseName: string;
    effectiveStimulus: number;
    percentOfWeeklyStimulus: number;
  }>;
};

export type RepairMaterialityDiagnostic = {
  repairMechanism: string;
  materiality: RepairMateriality;
  muscle: string | null;
  slotId: string | null;
  exerciseId: string | null;
  exerciseName: string | null;
  action:
    | "added"
    | "removed"
    | "set_bumped"
    | "set_trimmed"
    | "diagnostic_only";
  effectiveStimulusAdded: number;
  effectiveStimulusDelta: number;
  rawSetsAdded: number;
  rawSetDelta: number;
  changedExerciseIdentity: boolean;
  changedSlotShapeMaterially: boolean;
  behaviorClass: "minor_safety_net" | "program_shaping";
  source: string;
  rationale: string;
};

export type ExerciseConcentrationDiagnostic = {
  slotId: string;
  intent: string;
  exerciseId: string;
  exerciseName: string;
  setCount: number;
  role: "main" | "accessory";
  isCompound: boolean;
  primaryMuscles: string[];
  effectiveStimulusContributionByMuscle: Record<string, number>;
  percentageOfWeeklyProjectedStimulusByMuscle: Record<string, number>;
  producedOrIncreasedByRepair: boolean;
  flags: Array<
    | "COMPOUND_GT_5_SETS"
    | "ISOLATION_GT_5_SETS"
    | "EXERCISE_SUPPLIES_OVER_50_PERCENT_WEEKLY_STIMULUS"
    | "EXERCISE_SUPPLIES_OVER_60_PERCENT_WEEKLY_STIMULUS"
    | "EXERCISE_ADDED_BY_REPAIR"
    | "SET_COUNT_INCREASED_BY_REPAIR"
  >;
};

export type SlotPlanPlanningRealityDiagnostic = {
  label: "weekly demand / slot allocation diagnostics";
  readOnly: true;
  affectsScoringOrGeneration: false;
  summary: {
    planningShape:
      | "mostly_upstream_planned"
      | "mixed_upstream_plus_repair_shaped"
      | "mostly_repair_shaped"
      | "unclear_due_to_missing_instrumentation";
    explicitWeeklyDemandMuscles: number;
    inferredDemandMuscles: number;
    slotsWithExplicitWeeklyDemand: number;
    slotsWithOnlyLocalOrInferredSemantics: number;
    materialRepairCount: number;
    majorRepairCount: number;
    highExerciseConcentrationCount: number;
    warningCodes: ProgramShapeWarningCode[];
  };
  weeklyMuscleDemand: WeeklyMuscleDemandDiagnostic[];
  slotDemandAllocation: SlotDemandAllocationDiagnostic[];
  projectedDelivery: ProjectedDeliveryDiagnostic[];
  repairMateriality: RepairMaterialityDiagnostic[];
  exerciseConcentration: ExerciseConcentrationDiagnostic[];
  warnings: Array<{
    code: ProgramShapeWarningCode;
    severity: "info" | "warning";
    message: string;
    evidence: string[];
  }>;
  limitations: string[];
};

type ActiveMesocycleForDiagnostics = NonNullable<MappedGenerationContext["activeMesocycle"]>;

type SlotSequenceEntry = {
  slotId: string;
  intent: WorkoutSessionIntent;
  authoredSemantics?: MesocycleSlotSequence["slots"][number]["authoredSemantics"];
};

type ExerciseRow = {
  slotId: string;
  intent: string;
  exercise: WorkoutExercise;
  role: "main" | "accessory";
  setCount: number;
  contributionByMuscle: Record<string, number>;
};

function normalizeMuscle(muscle: string): string {
  return normalizeExposedMuscle(muscle);
}

function toRoundedRecord(map: ReadonlyMap<string, number>): Record<string, number> {
  const record: Record<string, number> = {};
  for (const [rawMuscle, rawValue] of map) {
    const muscle = normalizeMuscle(rawMuscle);
    record[muscle] = roundToTenth((record[muscle] ?? 0) + rawValue);
  }
  return Object.fromEntries(
    Object.entries(record)
      .filter(([, value]) => value > 0)
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

function mergeContributionRecords(records: ReadonlyArray<Record<string, number>>): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const record of records) {
    for (const [muscle, value] of Object.entries(record)) {
      merged[muscle] = roundToTenth((merged[muscle] ?? 0) + value);
    }
  }
  return Object.fromEntries(
    Object.entries(merged)
      .filter(([, value]) => value > 0)
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

function isHardObligationMuscle(muscle: string): muscle is (typeof HARD_WEEKLY_OBLIGATION_MUSCLES)[number] {
  return HARD_WEEKLY_OBLIGATION_MUSCLES.includes(
    muscle as (typeof HARD_WEEKLY_OBLIGATION_MUSCLES)[number]
  );
}

function getWeeklyObligationEntry(
  plan: WeeklyMuscleObligationPlan,
  muscle: string
) {
  return isHardObligationMuscle(muscle) ? plan.muscles[muscle] : null;
}

function getTargetForMuscle(input: {
  activeMesocycle: ActiveMesocycleForDiagnostics;
  weeklyObligationPlan: WeeklyMuscleObligationPlan;
  muscle: string;
}): {
  targetStatus: WeeklyMuscleDemandDiagnostic["targetStatus"];
  targetRange: VolumeSoftTargetRange | null;
  preferredTarget: number | null;
  explicitUpstream: boolean;
  inferredDownstream: boolean;
  source: string[];
} {
  const targetSemantics = getMuscleTargetSemantics(input.muscle);
  const weeklyObligation = getWeeklyObligationEntry(input.weeklyObligationPlan, input.muscle);
  const supportFloor = getWeekOneSupportFloor(input.muscle as ProtectedWeekOneCoverageMuscle);
  const explicitUpstream = Boolean(
    weeklyObligation && (weeklyObligation.targetSets > 0 || weeklyObligation.allocatedSlots.length > 0)
  );
  const inferredDownstream = !explicitUpstream && (
    supportFloor != null ||
    targetSemantics.targetTier === "B_SUPPORT" ||
    targetSemantics.targetKind === "soft"
  );
  const preferredTarget =
    explicitUpstream && weeklyObligation
      ? weeklyObligation.targetSets
      : supportFloor != null
        ? supportFloor
        : targetSemantics.softTargetRange
          ? roundToTenth((targetSemantics.softTargetRange.min + targetSemantics.softTargetRange.max) / 2)
          : VOLUME_LANDMARKS[input.muscle]
            ? getWeeklyVolumeTarget(input.activeMesocycle, input.muscle, 1)
            : null;
  const source = [
    ...(explicitUpstream ? ["weekly_obligation_plan:getWeeklyVolumeTarget(week=1)"] : []),
    ...(supportFloor != null ? ["week_one_support_floor"] : []),
    ...(targetSemantics.softTargetRange ? ["volume_landmarks:soft_target_range"] : []),
    ...(targetSemantics.targetTier ? [`volume_landmarks:target_tier:${targetSemantics.targetTier}`] : []),
  ];

  return {
    targetStatus: explicitUpstream
      ? "hard"
      : inferredDownstream
        ? "soft"
        : "diagnostic",
    targetRange: targetSemantics.softTargetRange,
    preferredTarget,
    explicitUpstream,
    inferredDownstream,
    source: source.length > 0 ? source : ["projected_stimulus_observed"],
  };
}

function buildExerciseRows(slots: ReadonlyArray<ProjectedSlotWorkout>): ExerciseRow[] {
  return slots.flatMap((slot) =>
    getWorkoutExercises(slot.workout).map((exercise) => ({
      slotId: slot.slotPlan.slotId,
      intent: slot.slotPlan.intent,
      exercise,
      role: exercise.isMainLift || exercise.role === "main" ? "main" : "accessory",
      setCount: exercise.sets.length,
      contributionByMuscle: toRoundedRecord(
        getEffectiveStimulusByMuscle(exercise.exercise, exercise.sets.length, {
          logFallback: false,
        })
      ),
    }))
  );
}

function getExerciseKey(slotId: string, exerciseId: string): string {
  return `${slotId}:${exerciseId}`;
}

function buildExerciseRowMap(rows: ReadonlyArray<ExerciseRow>): Map<string, ExerciseRow> {
  return new Map(rows.map((row) => [getExerciseKey(row.slotId, row.exercise.exercise.id), row]));
}

function collectRelevantMuscles(input: {
  initialProjectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
  finalProjectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
  weeklyObligationPlan: WeeklyMuscleObligationPlan;
  protectedCoverage: ProtectedWeekOneCoverageEvaluation;
  supportFloorRepairReasons: Partial<Record<ProtectedWeekOneCoverageMuscle, SupportFloorRepairReason[]>>;
  programQualityAppliedDiagnostics: ReadonlyArray<ProgramQualityDiagnostic>;
  slotSequence: ReadonlyArray<SlotSequenceEntry>;
}): string[] {
  const muscles = new Set<string>();
  const add = (muscle: string | null | undefined) => {
    if (muscle && muscle.trim().length > 0) {
      muscles.add(normalizeMuscle(muscle));
    }
  };

  for (const muscle of HARD_WEEKLY_OBLIGATION_MUSCLES) {
    const obligation = input.weeklyObligationPlan.muscles[muscle];
    if (obligation.targetSets > 0 || obligation.allocatedSlots.length > 0) {
      add(muscle);
    }
  }
  for (const row of input.protectedCoverage.muscles) {
    add(row.muscle);
  }
  for (const muscle of Object.keys(input.supportFloorRepairReasons)) {
    add(muscle);
  }
  for (const diagnostic of input.programQualityAppliedDiagnostics) {
    add(diagnostic.muscle);
  }
  for (const slot of [...input.initialProjectedSlots, ...input.finalProjectedSlots]) {
    for (const [muscle, value] of slot.projectedContributionByMuscle) {
      if (value > 0) {
        add(muscle);
      }
    }
  }
  const slotSequenceEntries = buildSlotSequenceEntries(input.slotSequence);
  for (const slot of input.slotSequence) {
    const slotPolicy = resolveSessionSlotPolicy({
      sessionIntent: toSessionIntent(slot.intent),
      slotId: slot.slotId,
      slotSequence: { slots: slotSequenceEntries },
    }).currentSession;
    for (const muscle of getProtectedWeekOneCoverageObligations(slotPolicy)) {
      add(muscle);
    }
    for (const muscle of getProjectionPreferredSupportMuscles(slotPolicy)) {
      add(muscle);
    }
    for (const muscle of slotPolicy?.compoundBias?.preferredPrimaryMuscles ?? []) {
      add(muscle);
    }
  }

  return Array.from(muscles).sort((left, right) => left.localeCompare(right));
}

function buildWeeklyMuscleDemand(input: {
  activeMesocycle: ActiveMesocycleForDiagnostics;
  weeklyObligationPlan: WeeklyMuscleObligationPlan;
  protectedCoverage: ProtectedWeekOneCoverageEvaluation;
  relevantMuscles: string[];
}): WeeklyMuscleDemandDiagnostic[] {
  const protectedMuscles = new Set(input.protectedCoverage.muscles.map((row) => normalizeMuscle(row.muscle)));

  return input.relevantMuscles.map((muscle) => {
    const targetSemantics = getMuscleTargetSemantics(muscle);
    const target = getTargetForMuscle({
      activeMesocycle: input.activeMesocycle,
      weeklyObligationPlan: input.weeklyObligationPlan,
      muscle,
    });
    const landmark = VOLUME_LANDMARKS[muscle] ?? null;
    const source = Array.from(
      new Set([
        ...target.source,
        ...(protectedMuscles.has(muscle) ? ["protected_week_one_coverage_evaluation"] : []),
      ])
    );

    return {
      muscle,
      targetTier: targetSemantics.targetTier,
      targetKind: targetSemantics.targetKind,
      targetStatus: target.targetStatus,
      targetRange: target.targetRange,
      preferredTarget: target.preferredTarget,
      mev: landmark?.mev ?? null,
      mav: landmark?.mav ?? null,
      explicitUpstream: target.explicitUpstream,
      inferredDownstream: target.inferredDownstream || protectedMuscles.has(muscle),
      source,
    };
  });
}

function appendSlotObligation(
  obligations: SlotDemandAllocationDiagnostic["expectedMuscleObligations"],
  obligation: SlotDemandAllocationDiagnostic["expectedMuscleObligations"][number]
): void {
  const existing = obligations.find(
    (entry) => entry.muscle === obligation.muscle && entry.source === obligation.source
  );
  if (!existing) {
    obligations.push(obligation);
  }
}

function buildSlotDemandAllocation(input: {
  slotSequence: ReadonlyArray<SlotSequenceEntry>;
  weeklyObligationPlan: WeeklyMuscleObligationPlan;
  finalProjectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
}): SlotDemandAllocationDiagnostic[] {
  const slotSequenceEntries = buildSlotSequenceEntries(input.slotSequence);
  const projectedSlotById = new Map(
    input.finalProjectedSlots.map((slot) => [slot.slotPlan.slotId, slot])
  );

  return input.slotSequence.map((slot, index) => {
    const slotPolicy = resolveSessionSlotPolicy({
      sessionIntent: toSessionIntent(slot.intent),
      slotId: slot.slotId,
      slotSequence: { slots: slotSequenceEntries },
    }).currentSession;
    const projectedSlot = projectedSlotById.get(slot.slotId);
    const projectedStimulus = toRoundedRecord(projectedSlot?.projectedContributionByMuscle ?? new Map());
    const expectedMuscleObligations: SlotDemandAllocationDiagnostic["expectedMuscleObligations"] = [];

    for (const obligation of getSlotWeeklyObligations({
      plan: input.weeklyObligationPlan,
      slotId: slot.slotId,
    })) {
      appendSlotObligation(expectedMuscleObligations, {
        muscle: obligation.muscle,
        source: "weekly_obligation",
        targetStatus: "hard",
        explicitUpstream: true,
        minEffectiveSets: obligation.minEffectiveSets,
        priority: obligation.priority,
      });
    }

    for (const muscle of getProtectedWeekOneCoverageObligations(slotPolicy)) {
      appendSlotObligation(expectedMuscleObligations, {
        muscle,
        source: "authored_protected_coverage",
        targetStatus: isHardObligationMuscle(muscle) ? "hard" : "soft",
        explicitUpstream: false,
        minEffectiveSets: getWeekOneSupportFloor(muscle) ?? 2,
        priority: "support",
      });
    }

    for (const muscle of slotPolicy?.compoundBias?.preferredPrimaryMuscles ?? []) {
      appendSlotObligation(expectedMuscleObligations, {
        muscle: normalizeMuscle(muscle),
        source: "authored_primary_lane",
        targetStatus: isHardObligationMuscle(muscle) ? "hard" : "diagnostic",
        explicitUpstream: false,
        minEffectiveSets: null,
        priority: "lane",
      });
    }

    for (const muscle of getProjectionSoftPreferredSupportMuscles({
      slot: slotPolicy,
      protectedMuscles: getProtectedWeekOneCoverageObligations(slotPolicy),
    })) {
      appendSlotObligation(expectedMuscleObligations, {
        muscle: normalizeMuscle(muscle),
        source: "authored_support_preference",
        targetStatus: "soft",
        explicitUpstream: false,
        minEffectiveSets: getWeekOneSupportFloor(muscle as ProtectedWeekOneCoverageMuscle) ?? null,
        priority: "support",
      });
    }

    const hardObligations = expectedMuscleObligations.filter(
      (obligation) => obligation.source === "weekly_obligation"
    );
    const authoredObligations = expectedMuscleObligations.filter(
      (obligation) => obligation.source !== "weekly_obligation"
    );
    const meaningfullyServedMuscles = Object.entries(projectedStimulus)
      .filter(([muscle, value]) => {
        const obligation = expectedMuscleObligations.find((entry) => entry.muscle === muscle);
        const floor = obligation?.minEffectiveSets ?? 2;
        return value >= Math.min(2, floor) || (obligation != null && value > 0);
      })
      .map(([muscle]) => muscle)
      .sort((left, right) => left.localeCompare(right));
    const satisfiesKnownWeeklyDemand = hardObligations.some((obligation) => {
      const projected = projectedStimulus[obligation.muscle] ?? 0;
      return projected + 1e-9 >= (obligation.minEffectiveSets ?? 0);
    });
    const allocationBasis =
      hardObligations.length > 0
        ? "explicit_weekly_demand"
        : authoredObligations.length > 0
          ? "authored_slot_semantics"
          : Object.keys(projectedStimulus).length > 0
            ? "local_movement_or_lane_semantics"
            : "unclear";

    return {
      slotId: slot.slotId,
      slotLabel: `${slot.intent}@${slot.slotId}`,
      intent: toSessionIntent(slot.intent),
      authoredSlotRole: slotPolicy?.slotArchetype ?? null,
      slotProfile: {
        slotArchetype: slotPolicy?.slotArchetype ?? null,
        continuityScope: slotPolicy?.continuityScope ?? null,
        requiredMovementPatterns: [...(slotPolicy?.sessionShape?.requiredMovementPatterns ?? [])],
        preferredPrimaryMuscles: [
          ...(slotPolicy?.compoundBias?.preferredPrimaryMuscles ?? []),
          ...(slotPolicy?.compoundControl?.lanes.flatMap((lane) => lane.preferredPrimaryMuscles ?? []) ?? []),
        ],
        preferredSupportMuscles: getProjectionPreferredSupportMuscles(slotPolicy),
        protectedCoverageMuscles: getProtectedWeekOneCoverageObligations(slotPolicy),
      },
      expectedMuscleObligations,
      projectedEffectiveStimulusByMuscle: projectedStimulus,
      meaningfullyServedMuscles,
      allocationBasis,
      satisfiesKnownWeeklyDemand,
    };
  });
}

function getWeeklyTotals(slots: ReadonlyArray<ProjectedSlotWorkout>): Record<string, number> {
  return toRoundedRecord(
    computeProjectedWeeklyContributionByMuscle({
      projectedSlots: slots,
      currentSlotContribution: new Map(),
    })
  );
}

function buildProjectedDelivery(input: {
  activeMesocycle: ActiveMesocycleForDiagnostics;
  weeklyObligationPlan: WeeklyMuscleObligationPlan;
  relevantMuscles: string[];
  initialProjectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
  finalProjectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
  finalExerciseRows: ReadonlyArray<ExerciseRow>;
}): ProjectedDeliveryDiagnostic[] {
  const initialTotals = getWeeklyTotals(input.initialProjectedSlots);
  const finalTotals = getWeeklyTotals(input.finalProjectedSlots);
  const exposureCountByMuscle = new Map<string, number>();
  for (const slot of input.finalProjectedSlots) {
    const slotContribution = toRoundedRecord(slot.projectedContributionByMuscle);
    for (const [muscle, value] of Object.entries(slotContribution)) {
      if (value > 0) {
        exposureCountByMuscle.set(muscle, (exposureCountByMuscle.get(muscle) ?? 0) + 1);
      }
    }
  }

  return input.relevantMuscles.map((muscle) => {
    const target = getTargetForMuscle({
      activeMesocycle: input.activeMesocycle,
      weeklyObligationPlan: input.weeklyObligationPlan,
      muscle,
    });
    const finalTotal = finalTotals[muscle] ?? 0;
    const contributors = input.finalExerciseRows
      .map((row) => ({
        slotId: row.slotId,
        exerciseId: row.exercise.exercise.id,
        exerciseName: row.exercise.exercise.name,
        effectiveStimulus: row.contributionByMuscle[muscle] ?? 0,
        percentOfWeeklyStimulus:
          finalTotal > 0
            ? roundToTenth(((row.contributionByMuscle[muscle] ?? 0) / finalTotal) * 100)
            : 0,
      }))
      .filter((row) => row.effectiveStimulus > 0)
      .sort((left, right) => right.effectiveStimulus - left.effectiveStimulus || left.exerciseName.localeCompare(right.exerciseName))
      .slice(0, 4);

    return {
      muscle,
      targetStatus: target.targetStatus,
      targetRange: target.targetRange,
      preferredTarget: target.preferredTarget,
      projectedEffectiveStimulusAfterInitialSlotComposition:
        input.initialProjectedSlots.length > 0 ? roundToTenth(initialTotals[muscle] ?? 0) : null,
      projectedEffectiveStimulusAfterRepairAndFinalShaping: roundToTenth(finalTotal),
      deltaFromPreferredTarget:
        target.preferredTarget == null ? null : roundToTenth(finalTotal - target.preferredTarget),
      exposureCount: exposureCountByMuscle.get(muscle) ?? 0,
      majorContributingExercises: contributors,
    };
  });
}

function findAppliedProgramQualityDiagnostic(input: {
  diagnostics: ReadonlyArray<ProgramQualityDiagnostic>;
  slotId: string;
  exerciseId: string;
  muscle: string;
}): ProgramQualityDiagnostic | undefined {
  return input.diagnostics.find((diagnostic) => {
    if (diagnostic.slotId && diagnostic.slotId !== input.slotId) {
      return false;
    }
    if (diagnostic.exerciseId && diagnostic.exerciseId !== input.exerciseId) {
      return false;
    }
    if (diagnostic.muscle && normalizeMuscle(diagnostic.muscle) !== input.muscle) {
      return false;
    }
    const toExerciseId = diagnostic.details?.toExerciseId;
    return (
      diagnostic.exerciseId === input.exerciseId ||
      toExerciseId === input.exerciseId ||
      !diagnostic.exerciseId
    );
  });
}

function chooseRepairMechanism(input: {
  action: RepairMaterialityDiagnostic["action"];
  slotId: string;
  exerciseId: string;
  muscle: string;
  supportFloorRepairReasons: Partial<Record<ProtectedWeekOneCoverageMuscle, SupportFloorRepairReason[]>>;
  weeklyObligationEvaluations: ReadonlyArray<SlotObligationEvaluation>;
  programQualityAppliedDiagnostics: ReadonlyArray<ProgramQualityDiagnostic>;
}): { mechanism: string; source: string; rationale: string } {
  const appliedDiagnostic = findAppliedProgramQualityDiagnostic({
    diagnostics: input.programQualityAppliedDiagnostics,
    slotId: input.slotId,
    exerciseId: input.exerciseId,
    muscle: input.muscle,
  });
  if (appliedDiagnostic) {
    return {
      mechanism:
        appliedDiagnostic.constraint === "isolation_completeness"
          ? "deficit_driven_isolation_insertion"
          : `program_quality:${appliedDiagnostic.constraint}`,
      source: "program_quality_application",
      rationale: appliedDiagnostic.reason,
    };
  }

  const supportReasons =
    input.supportFloorRepairReasons[input.muscle as ProtectedWeekOneCoverageMuscle] ?? [];
  if (supportReasons.includes("support_accessory_replacement") && input.action === "added") {
    return {
      mechanism: "support_floor_closure",
      source: "protected_coverage_support_floor",
      rationale: "support floor repair added or replaced an accessory to close coverage",
    };
  }
  if (supportReasons.includes("existing_accessory_set_bump") && input.action === "set_bumped") {
    return {
      mechanism: "support_floor_set_bump",
      source: "protected_coverage_support_floor",
      rationale: "support floor repair increased an existing exercise set count",
    };
  }

  const weeklyObligation = input.weeklyObligationEvaluations.find(
    (row) => row.slotId === input.slotId && row.muscle === input.muscle
  );
  if (weeklyObligation) {
    return {
      mechanism: "weekly_obligation_closure",
      source: "weekly_obligation_plan",
      rationale: "final shaping adjusted the slot toward an allocated hard weekly obligation",
    };
  }

  if (input.action === "set_trimmed" || input.action === "removed") {
    return {
      mechanism: "final_cap_trim_or_redistribution",
      source: "final_projection_shaping",
      rationale: "final shaping reduced exercise sets or identity after cap/quality passes",
    };
  }

  return {
    mechanism: "final_projection_repair",
    source: "projection_diff",
    rationale: "final slot plan differs from initial slot composition after read-only repair/shaping passes",
  };
}

function classifyMateriality(input: {
  action: RepairMaterialityDiagnostic["action"];
  muscle: string | null;
  rawSetDelta: number;
  effectiveStimulusDelta: number;
  initialTotal: number;
  finalTotal: number;
  preferredTarget: number | null;
  targetStatus: WeeklyMuscleDemandDiagnostic["targetStatus"];
}): RepairMateriality {
  if (input.action === "diagnostic_only" || input.rawSetDelta === 0 && input.effectiveStimulusDelta === 0) {
    return "none";
  }
  const closesTarget =
    input.preferredTarget != null &&
    input.initialTotal + 1e-9 < input.preferredTarget &&
    input.finalTotal + 1e-9 >= input.preferredTarget;
  if (
    input.action === "added" ||
    input.action === "removed" ||
    (closesTarget && input.targetStatus !== "diagnostic")
  ) {
    return "major";
  }
  if (Math.abs(input.effectiveStimulusDelta) >= 2 || Math.abs(input.rawSetDelta) >= 2) {
    return "moderate";
  }
  return "minor";
}

function buildRepairRowsForDelta(input: {
  action: RepairMaterialityDiagnostic["action"];
  slotId: string;
  exerciseId: string;
  exerciseName: string;
  setDelta: number;
  contributionDeltaByMuscle: Record<string, number>;
  changedExerciseIdentity: boolean;
  initialTotals: Record<string, number>;
  finalTotals: Record<string, number>;
  activeMesocycle: ActiveMesocycleForDiagnostics;
  weeklyObligationPlan: WeeklyMuscleObligationPlan;
  weeklyObligationEvaluations: ReadonlyArray<SlotObligationEvaluation>;
  supportFloorRepairReasons: Partial<Record<ProtectedWeekOneCoverageMuscle, SupportFloorRepairReason[]>>;
  programQualityAppliedDiagnostics: ReadonlyArray<ProgramQualityDiagnostic>;
}): RepairMaterialityDiagnostic[] {
  const muscles = Object.keys(input.contributionDeltaByMuscle).filter(
    (muscle) => input.contributionDeltaByMuscle[muscle] !== 0
  );
  if (muscles.length === 0) {
    muscles.push(null as never);
  }

  return muscles.map((muscle) => {
    const target = muscle
      ? getTargetForMuscle({
          activeMesocycle: input.activeMesocycle,
          weeklyObligationPlan: input.weeklyObligationPlan,
          muscle,
        })
      : null;
    const effectiveStimulusDelta = muscle ? roundToTenth(input.contributionDeltaByMuscle[muscle] ?? 0) : 0;
    const materiality = classifyMateriality({
      action: input.action,
      muscle,
      rawSetDelta: input.setDelta,
      effectiveStimulusDelta,
      initialTotal: muscle ? input.initialTotals[muscle] ?? 0 : 0,
      finalTotal: muscle ? input.finalTotals[muscle] ?? 0 : 0,
      preferredTarget: target?.preferredTarget ?? null,
      targetStatus: target?.targetStatus ?? "diagnostic",
    });
    const mechanism = muscle
      ? chooseRepairMechanism({
          action: input.action,
          slotId: input.slotId,
          exerciseId: input.exerciseId,
          muscle,
          supportFloorRepairReasons: input.supportFloorRepairReasons,
          weeklyObligationEvaluations: input.weeklyObligationEvaluations,
          programQualityAppliedDiagnostics: input.programQualityAppliedDiagnostics,
        })
      : {
          mechanism: "final_projection_repair",
          source: "projection_diff",
          rationale: "exercise identity changed without measurable stimulus contribution",
        };

    return {
      repairMechanism: mechanism.mechanism,
      materiality,
      muscle,
      slotId: input.slotId,
      exerciseId: input.exerciseId,
      exerciseName: input.exerciseName,
      action: input.action,
      effectiveStimulusAdded: roundToTenth(Math.max(0, effectiveStimulusDelta)),
      effectiveStimulusDelta,
      rawSetsAdded: Math.max(0, input.setDelta),
      rawSetDelta: input.setDelta,
      changedExerciseIdentity: input.changedExerciseIdentity,
      changedSlotShapeMaterially:
        input.changedExerciseIdentity || Math.abs(input.setDelta) >= 2 || materiality === "major",
      behaviorClass:
        materiality === "major" || materiality === "moderate"
          ? "program_shaping"
          : "minor_safety_net",
      source: mechanism.source,
      rationale: mechanism.rationale,
    };
  });
}

function diffContribution(
  after: Record<string, number>,
  before: Record<string, number>
): Record<string, number> {
  const muscles = Array.from(new Set([...Object.keys(after), ...Object.keys(before)]));
  return Object.fromEntries(
    muscles
      .map((muscle) => [muscle, roundToTenth((after[muscle] ?? 0) - (before[muscle] ?? 0))] as const)
      .filter(([, value]) => value !== 0)
  );
}

function buildRepairMateriality(input: {
  activeMesocycle: ActiveMesocycleForDiagnostics;
  initialProjectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
  finalProjectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
  weeklyObligationPlan: WeeklyMuscleObligationPlan;
  weeklyObligationEvaluations: ReadonlyArray<SlotObligationEvaluation>;
  supportFloorRepairReasons: Partial<Record<ProtectedWeekOneCoverageMuscle, SupportFloorRepairReason[]>>;
  programQualityAppliedDiagnostics: ReadonlyArray<ProgramQualityDiagnostic>;
  programQualityEvaluation: ProgramQualityEvaluation;
}): RepairMaterialityDiagnostic[] {
  const initialRows = buildExerciseRows(input.initialProjectedSlots);
  const finalRows = buildExerciseRows(input.finalProjectedSlots);
  const beforeByKey = buildExerciseRowMap(initialRows);
  const afterByKey = buildExerciseRowMap(finalRows);
  const initialTotals = getWeeklyTotals(input.initialProjectedSlots);
  const finalTotals = getWeeklyTotals(input.finalProjectedSlots);
  const keys = Array.from(new Set([...beforeByKey.keys(), ...afterByKey.keys()]));
  const rows: RepairMaterialityDiagnostic[] = [];

  for (const key of keys) {
    const before = beforeByKey.get(key);
    const after = afterByKey.get(key);
    const row = after ?? before;
    if (!row) {
      continue;
    }
    const setDelta = (after?.setCount ?? 0) - (before?.setCount ?? 0);
    const contributionDelta = diffContribution(
      after?.contributionByMuscle ?? {},
      before?.contributionByMuscle ?? {}
    );
    if (!after && before) {
      rows.push(
        ...buildRepairRowsForDelta({
          action: "removed",
          slotId: before.slotId,
          exerciseId: before.exercise.exercise.id,
          exerciseName: before.exercise.exercise.name,
          setDelta,
          contributionDeltaByMuscle: contributionDelta,
          changedExerciseIdentity: true,
          initialTotals,
          finalTotals,
          activeMesocycle: input.activeMesocycle,
          weeklyObligationPlan: input.weeklyObligationPlan,
          weeklyObligationEvaluations: input.weeklyObligationEvaluations,
          supportFloorRepairReasons: input.supportFloorRepairReasons,
          programQualityAppliedDiagnostics: input.programQualityAppliedDiagnostics,
        })
      );
      continue;
    }
    if (after && !before) {
      rows.push(
        ...buildRepairRowsForDelta({
          action: "added",
          slotId: after.slotId,
          exerciseId: after.exercise.exercise.id,
          exerciseName: after.exercise.exercise.name,
          setDelta,
          contributionDeltaByMuscle: contributionDelta,
          changedExerciseIdentity: true,
          initialTotals,
          finalTotals,
          activeMesocycle: input.activeMesocycle,
          weeklyObligationPlan: input.weeklyObligationPlan,
          weeklyObligationEvaluations: input.weeklyObligationEvaluations,
          supportFloorRepairReasons: input.supportFloorRepairReasons,
          programQualityAppliedDiagnostics: input.programQualityAppliedDiagnostics,
        })
      );
      continue;
    }
    if (setDelta !== 0) {
      rows.push(
        ...buildRepairRowsForDelta({
          action: setDelta > 0 ? "set_bumped" : "set_trimmed",
          slotId: row.slotId,
          exerciseId: row.exercise.exercise.id,
          exerciseName: row.exercise.exercise.name,
          setDelta,
          contributionDeltaByMuscle: contributionDelta,
          changedExerciseIdentity: false,
          initialTotals,
          finalTotals,
          activeMesocycle: input.activeMesocycle,
          weeklyObligationPlan: input.weeklyObligationPlan,
          weeklyObligationEvaluations: input.weeklyObligationEvaluations,
          supportFloorRepairReasons: input.supportFloorRepairReasons,
          programQualityAppliedDiagnostics: input.programQualityAppliedDiagnostics,
        })
      );
    }
  }

  const existingDiagnosticKeys = new Set(
    rows.map((row) => `${row.source}:${row.slotId ?? ""}:${row.exerciseId ?? ""}:${row.muscle ?? ""}`)
  );
  for (const diagnostic of input.programQualityAppliedDiagnostics) {
    const key = `program_quality_application:${diagnostic.slotId ?? ""}:${diagnostic.exerciseId ?? ""}:${diagnostic.muscle ?? ""}`;
    if (existingDiagnosticKeys.has(key)) {
      continue;
    }
    rows.push({
      repairMechanism: `program_quality:${diagnostic.constraint}`,
      materiality: "none",
      muscle: diagnostic.muscle ? normalizeMuscle(diagnostic.muscle) : null,
      slotId: diagnostic.slotId ?? null,
      exerciseId: diagnostic.exerciseId ?? null,
      exerciseName: diagnostic.name ?? null,
      action: "diagnostic_only",
      effectiveStimulusAdded: 0,
      effectiveStimulusDelta: 0,
      rawSetsAdded: 0,
      rawSetDelta: 0,
      changedExerciseIdentity: false,
      changedSlotShapeMaterially: false,
      behaviorClass: "minor_safety_net",
      source: "program_quality_application",
      rationale: diagnostic.reason,
    });
  }

  for (const [muscle, reasons] of Object.entries(input.supportFloorRepairReasons)) {
    for (const reason of reasons ?? []) {
      const hasMaterialRow = rows.some(
        (row) => row.muscle === normalizeMuscle(muscle) && row.source === "protected_coverage_support_floor"
      );
      if (hasMaterialRow) {
        continue;
      }
      rows.push({
        repairMechanism: `support_floor:${reason}`,
        materiality: "none",
        muscle: normalizeMuscle(muscle),
        slotId: null,
        exerciseId: null,
        exerciseName: null,
        action: "diagnostic_only",
        effectiveStimulusAdded: 0,
        effectiveStimulusDelta: 0,
        rawSetsAdded: 0,
        rawSetDelta: 0,
        changedExerciseIdentity: false,
        changedSlotShapeMaterially: false,
        behaviorClass: "minor_safety_net",
        source: "protected_coverage_support_floor",
        rationale: "support-floor repair reason was emitted without a remaining net exercise/set delta",
      });
    }
  }

  for (const diagnostic of input.programQualityEvaluation.diagnostics) {
    if (
      diagnostic.constraint !== "per_exercise_efficiency" ||
      diagnostic.reason !== "soft_cap_exceeded_higher_priority_or_capacity_bound"
    ) {
      continue;
    }
    const exists = rows.some(
      (row) => row.slotId === diagnostic.slotId && row.exerciseId === diagnostic.exerciseId
    );
    if (exists) {
      continue;
    }
    rows.push({
      repairMechanism: "program_quality:soft_cap_override",
      materiality: "none",
      muscle: diagnostic.muscle ? normalizeMuscle(diagnostic.muscle) : null,
      slotId: diagnostic.slotId ?? null,
      exerciseId: diagnostic.exerciseId ?? null,
      exerciseName: diagnostic.name ?? null,
      action: "diagnostic_only",
      effectiveStimulusAdded: 0,
      effectiveStimulusDelta: 0,
      rawSetsAdded: 0,
      rawSetDelta: 0,
      changedExerciseIdentity: false,
      changedSlotShapeMaterially: false,
      behaviorClass: "minor_safety_net",
      source: "program_quality_evaluation",
      rationale: diagnostic.reason,
    });
  }

  return rows.sort((left, right) => {
    const materialityOrder: Record<RepairMateriality, number> = {
      major: 0,
      moderate: 1,
      minor: 2,
      none: 3,
    };
    return (
      materialityOrder[left.materiality] - materialityOrder[right.materiality] ||
      (left.slotId ?? "").localeCompare(right.slotId ?? "") ||
      (left.exerciseName ?? "").localeCompare(right.exerciseName ?? "") ||
      (left.muscle ?? "").localeCompare(right.muscle ?? "")
    );
  });
}

function buildExerciseConcentration(input: {
  initialProjectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
  finalProjectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
}): ExerciseConcentrationDiagnostic[] {
  const initialRowsByKey = buildExerciseRowMap(buildExerciseRows(input.initialProjectedSlots));
  const finalRows = buildExerciseRows(input.finalProjectedSlots);
  const finalWeeklyTotals = getWeeklyTotals(input.finalProjectedSlots);

  return finalRows.map((row) => {
    const before = initialRowsByKey.get(getExerciseKey(row.slotId, row.exercise.exercise.id));
    const percentages = Object.fromEntries(
      Object.entries(row.contributionByMuscle).map(([muscle, effectiveSets]) => [
        muscle,
        finalWeeklyTotals[muscle] && finalWeeklyTotals[muscle] > 0
          ? roundToTenth((effectiveSets / finalWeeklyTotals[muscle]) * 100)
          : 0,
      ])
    );
    const producedOrIncreasedByRepair = !before || row.setCount > before.setCount;
    const flags: ExerciseConcentrationDiagnostic["flags"] = [];
    if (row.exercise.exercise.isCompound && row.setCount > 5) {
      flags.push("COMPOUND_GT_5_SETS");
    }
    if (!row.exercise.exercise.isCompound && row.setCount > 5) {
      flags.push("ISOLATION_GT_5_SETS");
    }
    if (Object.values(percentages).some((percent) => percent >= 60)) {
      flags.push("EXERCISE_SUPPLIES_OVER_60_PERCENT_WEEKLY_STIMULUS");
    } else if (Object.values(percentages).some((percent) => percent >= 50)) {
      flags.push("EXERCISE_SUPPLIES_OVER_50_PERCENT_WEEKLY_STIMULUS");
    }
    if (!before) {
      flags.push("EXERCISE_ADDED_BY_REPAIR");
    } else if (row.setCount > before.setCount) {
      flags.push("SET_COUNT_INCREASED_BY_REPAIR");
    }

    return {
      slotId: row.slotId,
      intent: row.intent,
      exerciseId: row.exercise.exercise.id,
      exerciseName: row.exercise.exercise.name,
      setCount: row.setCount,
      role: row.role,
      isCompound: row.exercise.exercise.isCompound ?? false,
      primaryMuscles: [...(row.exercise.exercise.primaryMuscles ?? [])].map(normalizeMuscle),
      effectiveStimulusContributionByMuscle: row.contributionByMuscle,
      percentageOfWeeklyProjectedStimulusByMuscle: percentages,
      producedOrIncreasedByRepair,
      flags,
    };
  });
}

function buildWarnings(input: {
  weeklyMuscleDemand: WeeklyMuscleDemandDiagnostic[];
  slotDemandAllocation: SlotDemandAllocationDiagnostic[];
  projectedDelivery: ProjectedDeliveryDiagnostic[];
  repairMateriality: RepairMaterialityDiagnostic[];
  exerciseConcentration: ExerciseConcentrationDiagnostic[];
}): SlotPlanPlanningRealityDiagnostic["warnings"] {
  const warnings: SlotPlanPlanningRealityDiagnostic["warnings"] = [];
  const add = (
    code: ProgramShapeWarningCode,
    severity: "info" | "warning",
    message: string,
    evidence: string[]
  ) => {
    if (!warnings.some((warning) => warning.code === code)) {
      warnings.push({ code, severity, message, evidence });
    }
  };

  const materialSupportRepairs = input.repairMateriality.filter(
    (row) =>
      row.behaviorClass === "program_shaping" &&
      row.materiality !== "none" &&
      (row.repairMechanism.includes("support_floor") ||
        input.weeklyMuscleDemand.find((demand) => demand.muscle === row.muscle)?.targetStatus === "soft")
  );
  if (materialSupportRepairs.length > 0) {
    add(
      "REPAIR_CREATED_MATERIAL_SUPPORT_COVERAGE",
      "warning",
      "Final repair/shaping materially created support coverage.",
      materialSupportRepairs.slice(0, 4).map((row) => `${row.slotId ?? "week"}:${row.muscle}:${row.repairMechanism}`)
    );
  }

  const addedIdentity = input.repairMateriality.filter((row) => row.changedExerciseIdentity && row.action === "added");
  if (addedIdentity.length > 0) {
    add(
      "REPAIR_ADDED_EXERCISE_IDENTITY",
      "warning",
      "Final repair/shaping added exercise identity after initial slot composition.",
      addedIdentity.slice(0, 4).map((row) => `${row.slotId}:${row.exerciseName}`)
    );
  }

  const concentrationFlags = input.exerciseConcentration.filter((row) =>
    row.flags.some((flag) => flag.includes("EXERCISE_SUPPLIES_OVER"))
  );
  if (concentrationFlags.length > 0) {
    add(
      "EXERCISE_CONCENTRATION_HIGH",
      "warning",
      "One exercise supplies a high share of a muscle's projected weekly stimulus.",
      concentrationFlags.slice(0, 4).map((row) => `${row.slotId}:${row.exerciseName}`)
    );
  }

  const localSlots = input.slotDemandAllocation.filter(
    (slot) => slot.allocationBasis === "local_movement_or_lane_semantics" || slot.allocationBasis === "unclear"
  );
  if (localSlots.length > 0) {
    add(
      "SLOT_ALLOCATION_NOT_EXPLICIT",
      "info",
      "One or more slots have no explicit weekly demand allocation and are explained by local slot/movement semantics.",
      localSlots.map((slot) => slot.slotId)
    );
  }

  const primaryBelowBeforeRepair = input.projectedDelivery.filter(
    (row) =>
      row.targetStatus === "hard" &&
      row.preferredTarget != null &&
      row.projectedEffectiveStimulusAfterInitialSlotComposition != null &&
      row.projectedEffectiveStimulusAfterInitialSlotComposition < row.preferredTarget
  );
  if (primaryBelowBeforeRepair.length > 0) {
    add(
      "PRIMARY_MUSCLE_BELOW_TARGET_BEFORE_REPAIR",
      "warning",
      "A hard weekly-demand muscle was below target before final repair/shaping.",
      primaryBelowBeforeRepair.slice(0, 4).map((row) => `${row.muscle}:${row.projectedEffectiveStimulusAfterInitialSlotComposition}/${row.preferredTarget}`)
    );
  }

  const supportClosedLate = input.projectedDelivery.filter(
    (row) =>
      row.targetStatus === "soft" &&
      row.preferredTarget != null &&
      row.projectedEffectiveStimulusAfterInitialSlotComposition != null &&
      row.projectedEffectiveStimulusAfterInitialSlotComposition < row.preferredTarget &&
      row.projectedEffectiveStimulusAfterRepairAndFinalShaping >= row.preferredTarget
  );
  if (supportClosedLate.length > 0) {
    add(
      "SUPPORT_FLOOR_CLOSED_LATE",
      "warning",
      "Support-floor coverage closed only after final repair/shaping.",
      supportClosedLate.slice(0, 4).map((row) => row.muscle)
    );
  }

  const trims = input.repairMateriality.filter(
    (row) => row.action === "set_trimmed" || row.action === "removed"
  );
  if (trims.length > 0) {
    add(
      "FINAL_CAP_TRIM_REQUIRED",
      "info",
      "Final shaping trimmed sets or removed exercise identity after initial slot composition.",
      trims.slice(0, 4).map((row) => `${row.slotId}:${row.exerciseName}:${row.rawSetDelta}`)
    );
  }

  return warnings;
}

function classifyPlanningShape(input: {
  weeklyMuscleDemand: WeeklyMuscleDemandDiagnostic[];
  slotDemandAllocation: SlotDemandAllocationDiagnostic[];
  repairMateriality: RepairMaterialityDiagnostic[];
}): SlotPlanPlanningRealityDiagnostic["summary"]["planningShape"] {
  const hardDemandCount = input.weeklyMuscleDemand.filter((row) => row.targetStatus === "hard").length;
  const explicitSlotCount = input.slotDemandAllocation.filter(
    (row) => row.allocationBasis === "explicit_weekly_demand"
  ).length;
  const materialRepairCount = input.repairMateriality.filter(
    (row) => row.materiality === "moderate" || row.materiality === "major"
  ).length;
  const majorRepairCount = input.repairMateriality.filter((row) => row.materiality === "major").length;

  if (hardDemandCount === 0 && explicitSlotCount === 0) {
    return "unclear_due_to_missing_instrumentation";
  }
  if (materialRepairCount === 0 && explicitSlotCount >= Math.max(1, input.slotDemandAllocation.length / 2)) {
    return "mostly_upstream_planned";
  }
  if (majorRepairCount >= Math.max(1, hardDemandCount) || materialRepairCount > explicitSlotCount) {
    return "mostly_repair_shaped";
  }
  return "mixed_upstream_plus_repair_shaped";
}

export function buildWeeklyDemandSlotAllocationDiagnostic(input: {
  activeMesocycle: ActiveMesocycleForDiagnostics;
  slotSequence: ReadonlyArray<SlotSequenceEntry>;
  initialProjectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
  finalProjectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
  weeklyObligationPlan: WeeklyMuscleObligationPlan;
  weeklyObligationEvaluations: ReadonlyArray<SlotObligationEvaluation>;
  protectedCoverage: ProtectedWeekOneCoverageEvaluation;
  supportFloorRepairReasons: Partial<Record<ProtectedWeekOneCoverageMuscle, SupportFloorRepairReason[]>>;
  programQualityAppliedDiagnostics: ReadonlyArray<ProgramQualityDiagnostic>;
  programQualityEvaluation: ProgramQualityEvaluation;
}): SlotPlanPlanningRealityDiagnostic {
  const relevantMuscles = collectRelevantMuscles({
    initialProjectedSlots: input.initialProjectedSlots,
    finalProjectedSlots: input.finalProjectedSlots,
    weeklyObligationPlan: input.weeklyObligationPlan,
    protectedCoverage: input.protectedCoverage,
    supportFloorRepairReasons: input.supportFloorRepairReasons,
    programQualityAppliedDiagnostics: input.programQualityAppliedDiagnostics,
    slotSequence: input.slotSequence,
  });
  const weeklyMuscleDemand = buildWeeklyMuscleDemand({
    activeMesocycle: input.activeMesocycle,
    weeklyObligationPlan: input.weeklyObligationPlan,
    protectedCoverage: input.protectedCoverage,
    relevantMuscles,
  });
  const slotDemandAllocation = buildSlotDemandAllocation({
    slotSequence: input.slotSequence,
    weeklyObligationPlan: input.weeklyObligationPlan,
    finalProjectedSlots: input.finalProjectedSlots,
  });
  const finalExerciseRows = buildExerciseRows(input.finalProjectedSlots);
  const projectedDelivery = buildProjectedDelivery({
    activeMesocycle: input.activeMesocycle,
    weeklyObligationPlan: input.weeklyObligationPlan,
    relevantMuscles,
    initialProjectedSlots: input.initialProjectedSlots,
    finalProjectedSlots: input.finalProjectedSlots,
    finalExerciseRows,
  });
  const repairMateriality = buildRepairMateriality({
    activeMesocycle: input.activeMesocycle,
    initialProjectedSlots: input.initialProjectedSlots,
    finalProjectedSlots: input.finalProjectedSlots,
    weeklyObligationPlan: input.weeklyObligationPlan,
    weeklyObligationEvaluations: input.weeklyObligationEvaluations,
    supportFloorRepairReasons: input.supportFloorRepairReasons,
    programQualityAppliedDiagnostics: input.programQualityAppliedDiagnostics,
    programQualityEvaluation: input.programQualityEvaluation,
  });
  const exerciseConcentration = buildExerciseConcentration({
    initialProjectedSlots: input.initialProjectedSlots,
    finalProjectedSlots: input.finalProjectedSlots,
  });
  const warnings = buildWarnings({
    weeklyMuscleDemand,
    slotDemandAllocation,
    projectedDelivery,
    repairMateriality,
    exerciseConcentration,
  });
  const materialRepairCount = repairMateriality.filter(
    (row) => row.materiality === "moderate" || row.materiality === "major"
  ).length;
  const majorRepairCount = repairMateriality.filter((row) => row.materiality === "major").length;
  const highExerciseConcentrationCount = exerciseConcentration.filter((row) =>
    row.flags.some((flag) => flag.includes("EXERCISE_SUPPLIES_OVER"))
  ).length;

  return {
    label: "weekly demand / slot allocation diagnostics",
    readOnly: true,
    affectsScoringOrGeneration: false,
    summary: {
      planningShape: classifyPlanningShape({
        weeklyMuscleDemand,
        slotDemandAllocation,
        repairMateriality,
      }),
      explicitWeeklyDemandMuscles: weeklyMuscleDemand.filter((row) => row.explicitUpstream).length,
      inferredDemandMuscles: weeklyMuscleDemand.filter((row) => row.inferredDownstream).length,
      slotsWithExplicitWeeklyDemand: slotDemandAllocation.filter(
        (row) => row.allocationBasis === "explicit_weekly_demand"
      ).length,
      slotsWithOnlyLocalOrInferredSemantics: slotDemandAllocation.filter(
        (row) =>
          row.allocationBasis === "local_movement_or_lane_semantics" ||
          row.allocationBasis === "unclear"
      ).length,
      materialRepairCount,
      majorRepairCount,
      highExerciseConcentrationCount,
      warningCodes: warnings.map((warning) => warning.code),
    },
    weeklyMuscleDemand,
    slotDemandAllocation,
    projectedDelivery,
    repairMateriality,
    exerciseConcentration,
    warnings,
    limitations: [
      "Initial slot composition means the selected slot workout after slot-local candidate selection and before final program-quality/support-floor/weekly-obligation shaping.",
      "Repair materiality is inferred from initial-vs-final projection deltas plus existing program-quality and coverage diagnostics; historical candidate ranking internals are not persisted here.",
      "This diagnostic is read-only and does not feed scoring, generation, seed parsing, or runtime replay.",
    ],
  };
}
