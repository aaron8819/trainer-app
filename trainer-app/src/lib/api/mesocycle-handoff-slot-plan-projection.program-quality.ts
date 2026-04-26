import type { Exercise, WorkoutExercise, WorkoutPlan, WorkoutSet } from "@/lib/engine/types";
import { getEffectiveStimulusByMuscle } from "@/lib/engine/stimulus";
import {
  MUSCLE_TARGET_TIER_BY_MUSCLE,
  VOLUME_LANDMARKS,
} from "@/lib/engine/volume-landmarks";
import {
  getProjectionRepairCompatibleMuscles,
  resolveSessionSlotPolicy,
  type ProtectedWeekOneCoverageMuscle,
} from "@/lib/planning/session-slot-profile";
import { SESSION_CAPS } from "./template-session/selection-adapter";
import { getWeekOneSupportFloor } from "./template-session/role-budgeting";
import type { MappedGenerationContext } from "./template-session/types";
import {
  buildSlotSequenceEntries,
  computeProjectedWeeklyContributionByMuscle,
  computeWorkoutContributionByMuscle,
  countWorkoutExercises,
  exerciseHasPrimaryMuscle,
  getWorkoutExercises,
  preservesSlotIdentity,
  ProjectedSlotWorkout,
  roundToTenth,
  toSessionIntent,
} from "./mesocycle-handoff-slot-plan-projection.coverage-evaluation";
import {
  appendAccessory,
  buildSupportAccessoryExercise,
  MIN_PROJECTED_ACCESSORY_SETS_PER_EXERCISE,
  MIN_PROJECTED_MAIN_LIFT_SETS_PER_EXERCISE,
  updateProjectedSlotWorkout,
} from "./mesocycle-handoff-slot-plan-projection.repair-engine";
import {
  evaluateDuplicateExerciseReuse,
  HARD_WEEKLY_OBLIGATION_MUSCLES,
  type DuplicateExerciseReuseDiagnostic,
  type WeeklyMuscleObligationPlan,
} from "./mesocycle-handoff-slot-plan-projection.weekly-obligations";

export const PROGRAM_QUALITY_CONSTRAINT_PRIORITY = {
  P0: "weekly_obligations_slot_identity",
  P1: "movement_pattern_coverage",
  P2: "per_exercise_efficiency",
  P3: "stimulus_diversity",
  P4: "duplicate_penalties",
  P5: "isolation_completeness",
} as const;

export const PROGRAM_QUALITY_PENALTY_MODEL = {
  type: "additive",
  monotonic: true,
} as const;

export const SOFT_MAIN_LIFT_SET_CAP = 4;
export const SOFT_ACCESSORY_SET_CAP = 3;
const STIMULUS_DIVERSITY_ACTIVATION_SETS = 8;
const SINGLE_EXERCISE_SHARE_ACTIVATION_SETS = 10;
export const MAX_SINGLE_EXERCISE_MUSCLE_SHARE = 0.5;
export const MAX_SINGLE_PATTERN_MUSCLE_SHARE = 0.7;
export const LOWER_HINGE_SHARE_MAX = 0.6;
export const UPPER_PUSH_PULL_SHARE_MAX = 0.65;
export const MAX_SAME_PATTERN_PER_SESSION = 2;
const MAX_MAIN_COMPOUNDS_PER_SESSION = 2;
const ISOLATION_COMPLETENESS_TARGETS: ProtectedWeekOneCoverageMuscle[] = [
  "Biceps",
  "Triceps",
  "Side Delts",
];

type ProgramQualityPriority = keyof typeof PROGRAM_QUALITY_CONSTRAINT_PRIORITY;
type BroadMovementPattern = "push" | "pull" | "squat" | "hinge" | "lunge" | "isolation" | "other";
type ProgramQualityBlockReason =
  | "no_compatible_alternative"
  | "would_break_slot_identity"
  | "would_exceed_hard_cap"
  | "would_break_weekly_target"
  | "would_worsen_fatigue";
type RedistributionScope = "same_slot" | "paired_slot" | "elsewhere_week" | "added_alternative";

export type ProgramQualityDiagnostic = {
  priority: ProgramQualityPriority;
  constraint:
    | "per_exercise_efficiency"
    | "stimulus_diversity"
    | "single_exercise_volume_share"
    | "cross_slot_duplicate"
    | "weekly_pattern_balance"
    | "isolation_completeness"
    | "session_composition"
    | "redundancy";
  penalty: number;
  slotId?: string;
  exerciseId?: string;
  name?: string;
  muscle?: string;
  pattern?: string;
  reason: string;
  blockReason?: ProgramQualityBlockReason;
  details?: Record<string, number | string | boolean | string[]>;
};

export type ProgramQualityEvaluation = {
  totalPenalty: number;
  diagnostics: ProgramQualityDiagnostic[];
  constraintCounts: Record<string, number>;
};

export type ProgramQualityConstraintResult = {
  projectedSlots: ProjectedSlotWorkout[];
  appliedDiagnostics: ProgramQualityDiagnostic[];
  evaluation: ProgramQualityEvaluation;
};

type SlotSequenceEntries = ReturnType<typeof buildSlotSequenceEntries>;

function getExerciseRole(exercise: WorkoutExercise): "main" | "accessory" {
  return exercise.isMainLift || exercise.role === "main" ? "main" : "accessory";
}

function getSoftSetCap(exercise: WorkoutExercise): number {
  return getExerciseRole(exercise) === "main"
    ? SOFT_MAIN_LIFT_SET_CAP
    : SOFT_ACCESSORY_SET_CAP;
}

function getHardSetCap(exercise: WorkoutExercise): number {
  return getExerciseRole(exercise) === "main" ? 5 : 4;
}

function getMinimumSetCount(exercise: WorkoutExercise): number {
  return getExerciseRole(exercise) === "main"
    ? MIN_PROJECTED_MAIN_LIFT_SETS_PER_EXERCISE
    : MIN_PROJECTED_ACCESSORY_SETS_PER_EXERCISE;
}

function getBroadMovementPattern(exercise: Pick<Exercise, "movementPatterns">): BroadMovementPattern {
  const patterns = exercise.movementPatterns ?? [];
  if (patterns.some((pattern) => pattern === "horizontal_push" || pattern === "vertical_push")) {
    return "push";
  }
  if (patterns.some((pattern) => pattern === "horizontal_pull" || pattern === "vertical_pull")) {
    return "pull";
  }
  if (patterns.includes("squat")) {
    return "squat";
  }
  if (patterns.includes("hinge")) {
    return "hinge";
  }
  if (patterns.includes("lunge")) {
    return "lunge";
  }
  if (patterns.includes("isolation")) {
    return "isolation";
  }
  return "other";
}

function getResistanceProfile(exercise: Pick<Exercise, "equipment" | "stimulusBias">): string {
  const equipment = [...(exercise.equipment ?? [])].sort().join("+") || "unknown";
  const stimulusBias = [...(exercise.stimulusBias ?? [])].sort().join("+") || "general";
  return `${equipment}:${stimulusBias}`;
}

function buildProjectionSetFromTemplate(
  template: WorkoutSet | undefined,
  setIndex: number,
  role: WorkoutExercise["role"]
): WorkoutSet {
  return {
    ...(template ?? { targetReps: 12 }),
    setIndex,
    role: role ?? "accessory",
  };
}

function withSetCount(exercise: WorkoutExercise, setCount: number): WorkoutExercise {
  const sets = exercise.sets.slice(0, setCount);
  while (sets.length < setCount) {
    sets.push(buildProjectionSetFromTemplate(sets.at(-1), sets.length + 1, exercise.role));
  }
  return {
    ...exercise,
    sets: sets.map((set, index) => ({ ...set, setIndex: index + 1 })),
  };
}

function replaceWorkoutExercise(workout: WorkoutPlan, replacement: WorkoutExercise): WorkoutPlan {
  return reindexWorkout({
    ...workout,
    mainLifts: workout.mainLifts.map((exercise) =>
      exercise.exercise.id === replacement.exercise.id ? replacement : exercise
    ),
    accessories: workout.accessories.map((exercise) =>
      exercise.exercise.id === replacement.exercise.id ? replacement : exercise
    ),
  });
}

function reindexWorkout(workout: WorkoutPlan): WorkoutPlan {
  return {
    ...workout,
    mainLifts: workout.mainLifts.map((exercise, index) => ({
      ...exercise,
      orderIndex: index,
    })),
    accessories: workout.accessories.map((exercise, index) => ({
      ...exercise,
      orderIndex: workout.mainLifts.length + index,
    })),
  };
}

function normalizeProjectedSlots(slots: ReadonlyArray<ProjectedSlotWorkout>): ProjectedSlotWorkout[] {
  return slots.map((slot) => updateProjectedSlotWorkout(slot, slot.workout));
}

function getSlotPolicy(input: {
  slot: ProjectedSlotWorkout;
  slotSequenceEntries: SlotSequenceEntries;
}) {
  return resolveSessionSlotPolicy({
    sessionIntent: toSessionIntent(input.slot.slotPlan.intent),
    slotId: input.slot.slotPlan.slotId,
    slotSequence: { slots: input.slotSequenceEntries },
  }).currentSession;
}

function evaluateConstraintCounts(diagnostics: ProgramQualityDiagnostic[]) {
  return diagnostics.reduce<Record<string, number>>((counts, diagnostic) => {
    counts[diagnostic.constraint] = (counts[diagnostic.constraint] ?? 0) + 1;
    return counts;
  }, {});
}

function penalty(overage: number, weight = 1): number {
  return roundToTenth(Math.max(0, overage) * weight);
}

function getExerciseMuscleContribution(exercise: WorkoutExercise, muscle: string): number {
  return (getEffectiveStimulusByMuscle(exercise.exercise, exercise.sets.length).get(muscle) ?? 0);
}

function getWeeklyContribution(slots: ReadonlyArray<ProjectedSlotWorkout>): Map<string, number> {
  return computeProjectedWeeklyContributionByMuscle({
    projectedSlots: slots,
    currentSlotContribution: new Map(),
  });
}

function redundancyPenalty(slots: ReadonlyArray<ProjectedSlotWorkout>): number {
  return evaluateRedundancy(slots).reduce((sum, diagnostic) => sum + diagnostic.penalty, 0);
}

function getWeeklyHardTargetFloor(input: {
  muscle: (typeof HARD_WEEKLY_OBLIGATION_MUSCLES)[number];
  beforeTotal: number;
  weeklyObligationPlan: WeeklyMuscleObligationPlan;
}): number {
  const targetSets = input.weeklyObligationPlan.muscles[input.muscle].targetSets;
  if (targetSets <= 0) {
    return 0;
  }
  return input.beforeTotal >= targetSets ? targetSets : input.beforeTotal;
}

function getSlotPrimaryIdentityMuscles(input: {
  slot: ProjectedSlotWorkout;
  slotSequenceEntries: SlotSequenceEntries;
}): string[] {
  const slotPolicy = getSlotPolicy({
    slot: input.slot,
    slotSequenceEntries: input.slotSequenceEntries,
  });
  if (!slotPolicy) {
    return [];
  }

  const lanePrimaries =
    slotPolicy.compoundControl?.lanes.flatMap((lane) => lane.preferredPrimaryMuscles ?? []) ??
    [];
  const biasPrimaries = slotPolicy.compoundBias?.preferredPrimaryMuscles ?? [];
  return Array.from(new Set([...lanePrimaries, ...biasPrimaries]));
}

function getSlotPrimaryContributionFloor(input: {
  weeklyObligationPlan: WeeklyMuscleObligationPlan;
  slotId: string;
  muscle: string;
}): number {
  const hardMuscle = HARD_WEEKLY_OBLIGATION_MUSCLES.find((candidate) => candidate === input.muscle);
  const authoredFloor = hardMuscle
    ? input.weeklyObligationPlan.muscles[hardMuscle].allocatedSlots.find(
        (slot) => slot.slotId === input.slotId
      )?.minEffectiveSets
    : undefined;
  return Math.min(2, authoredFloor ?? 2);
}

function preservesSlotPrimaryContributionFloor(input: {
  beforeSlot: ProjectedSlotWorkout;
  afterSlot: ProjectedSlotWorkout;
  slotSequenceEntries: SlotSequenceEntries;
  weeklyObligationPlan: WeeklyMuscleObligationPlan;
}): boolean {
  const primaryMuscles = getSlotPrimaryIdentityMuscles({
    slot: input.beforeSlot,
    slotSequenceEntries: input.slotSequenceEntries,
  });
  if (primaryMuscles.length === 0) {
    return true;
  }

  const beforeContribution = computeWorkoutContributionByMuscle(input.beforeSlot.workout);
  const afterContribution = computeWorkoutContributionByMuscle(input.afterSlot.workout);
  return primaryMuscles.every((muscle) => {
    const floor = getSlotPrimaryContributionFloor({
      weeklyObligationPlan: input.weeklyObligationPlan,
      slotId: input.beforeSlot.slotPlan.slotId,
      muscle,
    });
    const beforeSatisfied = (beforeContribution.get(muscle) ?? 0) + 1e-9 >= floor;
    if (!beforeSatisfied) {
      return true;
    }
    return (afterContribution.get(muscle) ?? 0) + 1e-9 >= floor;
  });
}

function getHardCapBlockReason(slots: ReadonlyArray<ProjectedSlotWorkout>): ProgramQualityBlockReason | null {
  for (const slot of slots) {
    if (countWorkoutExercises(slot.workout) > SESSION_CAPS.maxExercises) {
      return "would_exceed_hard_cap";
    }
    for (const exercise of getWorkoutExercises(slot.workout)) {
      if (exercise.sets.length > getHardSetCap(exercise)) {
        return "would_exceed_hard_cap";
      }
    }
  }
  return null;
}

function hasSameSlotSpreadReceiver(input: {
  workout: WorkoutPlan;
  donor: WorkoutExercise;
  muscle: string;
}): boolean {
  return getWorkoutExercises(input.workout).some((candidate) => {
    if (candidate.exercise.id === input.donor.exercise.id) {
      return false;
    }
    if (candidate.sets.length >= getHardSetCap(candidate)) {
      return false;
    }
    return getExerciseMuscleContribution(candidate, input.muscle) > 0;
  });
}

function evaluatePerExerciseEfficiency(
  slots: ReadonlyArray<ProjectedSlotWorkout>
): ProgramQualityDiagnostic[] {
  return slots.flatMap((slot) =>
    getWorkoutExercises(slot.workout).flatMap((exercise) => {
      const softCap = getSoftSetCap(exercise);
      if (exercise.sets.length <= softCap) {
        return [];
      }
      const primaryMuscle = exercise.exercise.primaryMuscles?.[0] ?? "";
      const canSpread =
        primaryMuscle.length > 0 &&
        hasSameSlotSpreadReceiver({ workout: slot.workout, donor: exercise, muscle: primaryMuscle });
      return [
        {
          priority: "P2",
          constraint: "per_exercise_efficiency",
          penalty: penalty(exercise.sets.length - softCap, getExerciseRole(exercise) === "main" ? 1 : 1.25),
          slotId: slot.slotPlan.slotId,
          exerciseId: exercise.exercise.id,
          name: exercise.exercise.name,
          muscle: primaryMuscle || undefined,
          reason: canSpread ? "soft_cap_exceeded_with_spread_option" : "soft_cap_exceeded_higher_priority_or_capacity_bound",
          details: {
            setCount: exercise.sets.length,
            softCap,
            hardCap: getHardSetCap(exercise),
          },
        } satisfies ProgramQualityDiagnostic,
      ];
    })
  );
}

function getExerciseContributionRows(slots: ReadonlyArray<ProjectedSlotWorkout>) {
  return slots.flatMap((slot) =>
    getWorkoutExercises(slot.workout).flatMap((exercise) =>
      Array.from(getEffectiveStimulusByMuscle(exercise.exercise, exercise.sets.length).entries())
        .filter(([, effectiveSets]) => effectiveSets > 0)
        .map(([muscle, effectiveSets]) => ({
          slotId: slot.slotPlan.slotId,
          intent: slot.slotPlan.intent,
          exercise,
          muscle,
          effectiveSets,
          broadPattern: getBroadMovementPattern(exercise.exercise),
        }))
    )
  );
}

function evaluateStimulusDiversity(slots: ReadonlyArray<ProjectedSlotWorkout>): ProgramQualityDiagnostic[] {
  const rows = getExerciseContributionRows(slots);
  const muscles = Array.from(new Set(rows.map((row) => row.muscle)));
  const diagnostics: ProgramQualityDiagnostic[] = [];

  for (const muscle of muscles) {
    const muscleRows = rows.filter((row) => row.muscle === muscle);
    const total = muscleRows.reduce((sum, row) => sum + row.effectiveSets, 0);
    if (total >= SINGLE_EXERCISE_SHARE_ACTIVATION_SETS) {
      const exerciseTotals = new Map<string, { row: (typeof muscleRows)[number]; total: number }>();
      for (const row of muscleRows) {
        const existing = exerciseTotals.get(row.exercise.exercise.id);
        exerciseTotals.set(row.exercise.exercise.id, {
          row,
          total: (existing?.total ?? 0) + row.effectiveSets,
        });
      }
      const dominant = Array.from(exerciseTotals.values()).sort((left, right) => right.total - left.total)[0];
      const share = dominant ? dominant.total / total : 0;
      if (dominant && share > MAX_SINGLE_EXERCISE_MUSCLE_SHARE) {
        diagnostics.push({
          priority: "P3",
          constraint: "single_exercise_volume_share",
          penalty: penalty((share - MAX_SINGLE_EXERCISE_MUSCLE_SHARE) * 10, 1.5),
          slotId: dominant.row.slotId,
          exerciseId: dominant.row.exercise.exercise.id,
          name: dominant.row.exercise.exercise.name,
          muscle,
          reason: "single_exercise_volume_share_exceeded",
          details: {
            muscleSets: roundToTenth(total),
            exerciseSets: roundToTenth(dominant.total),
            share: roundToTenth(share),
            maxShare: MAX_SINGLE_EXERCISE_MUSCLE_SHARE,
          },
        });
      }
    }

    if (total < STIMULUS_DIVERSITY_ACTIVATION_SETS) {
      continue;
    }
    const patternTotals = new Map<BroadMovementPattern, number>();
    for (const row of muscleRows) {
      patternTotals.set(row.broadPattern, (patternTotals.get(row.broadPattern) ?? 0) + row.effectiveSets);
    }
    const dominantPattern = Array.from(patternTotals.entries()).sort((left, right) => right[1] - left[1])[0];
    const share = dominantPattern ? dominantPattern[1] / total : 0;
    if (dominantPattern && share > MAX_SINGLE_PATTERN_MUSCLE_SHARE) {
      diagnostics.push({
        priority: "P3",
        constraint: "stimulus_diversity",
        penalty: penalty((share - MAX_SINGLE_PATTERN_MUSCLE_SHARE) * 10),
        muscle,
        pattern: dominantPattern[0],
        reason: "single_pattern_share_exceeded",
        details: {
          muscleSets: roundToTenth(total),
          patternSets: roundToTenth(dominantPattern[1]),
          share: roundToTenth(share),
          maxShare: MAX_SINGLE_PATTERN_MUSCLE_SHARE,
        },
      });
    }
  }

  return diagnostics;
}

function countPatternSets(slots: ReadonlyArray<ProjectedSlotWorkout>, patterns: BroadMovementPattern[]): number {
  const patternSet = new Set(patterns);
  return slots.reduce(
    (sum, slot) =>
      sum +
      getWorkoutExercises(slot.workout)
        .filter((exercise) => patternSet.has(getBroadMovementPattern(exercise.exercise)))
        .reduce((exerciseSum, exercise) => exerciseSum + exercise.sets.length, 0),
    0
  );
}

function countLowerBDuplicateSquatPressure(slots: ReadonlyArray<ProjectedSlotWorkout>): number {
  const lowerSlots = slots.filter((slot) => slot.slotPlan.intent === "LOWER");
  const lowerB = lowerSlots.find((slot) => slot.slotPlan.slotId.endsWith("_b"));
  if (!lowerB) {
    return 0;
  }
  const earlierSquatIds = new Set(
    lowerSlots
      .filter((slot) => slot.slotPlan.slotId !== lowerB.slotPlan.slotId)
      .flatMap((slot) =>
        getWorkoutExercises(slot.workout)
          .filter((exercise) => getBroadMovementPattern(exercise.exercise) === "squat")
          .map((exercise) => exercise.exercise.id)
      )
  );
  const lowerBSquats = getWorkoutExercises(lowerB.workout).filter(
    (exercise) => getBroadMovementPattern(exercise.exercise) === "squat"
  );
  const duplicateSquats = lowerBSquats.filter((exercise) => earlierSquatIds.has(exercise.exercise.id)).length;
  const extraSquatAccessories = Math.max(
    0,
    lowerB.workout.accessories.filter(
      (exercise) => getBroadMovementPattern(exercise.exercise) === "squat"
    ).length - 1
  );
  return duplicateSquats + extraSquatAccessories;
}

function lowerFatigueRiskScore(slots: ReadonlyArray<ProjectedSlotWorkout>): number {
  const lowerSlots = slots.filter((slot) => slot.slotPlan.intent === "LOWER");
  if (lowerSlots.length === 0) {
    return 0;
  }
  const totals = getWeeklyContribution(slots);
  const gluteMav = VOLUME_LANDMARKS.Glutes?.mav ?? Number.POSITIVE_INFINITY;
  const gluteOverMav = Math.max(0, (totals.get("Glutes") ?? 0) - gluteMav);
  const hingeSets = countPatternSets(lowerSlots, ["hinge"]);
  const lowerPatternSets = countPatternSets(lowerSlots, ["hinge", "squat", "lunge"]);
  const hingeShare = lowerPatternSets > 0 ? hingeSets / lowerPatternSets : 0;
  const hingeOver = Math.max(0, hingeShare - LOWER_HINGE_SHARE_MAX) * 10;
  return roundToTenth(gluteOverMav + hingeOver + countLowerBDuplicateSquatPressure(slots));
}

function evaluateWeeklyPatternBalance(slots: ReadonlyArray<ProjectedSlotWorkout>): ProgramQualityDiagnostic[] {
  const lowerSlots = slots.filter((slot) => slot.slotPlan.intent === "LOWER");
  const upperSlots = slots.filter((slot) => ["UPPER", "PUSH", "PULL"].includes(slot.slotPlan.intent));
  const diagnostics: ProgramQualityDiagnostic[] = [];

  const hingeSets = countPatternSets(lowerSlots, ["hinge"]);
  const lowerPatternSets = countPatternSets(lowerSlots, ["hinge", "squat", "lunge"]);
  const hingeShare = lowerPatternSets > 0 ? hingeSets / lowerPatternSets : 0;
  if (lowerPatternSets > 0 && hingeShare > LOWER_HINGE_SHARE_MAX) {
    diagnostics.push({
      priority: "P1",
      constraint: "weekly_pattern_balance",
      penalty: penalty((hingeShare - LOWER_HINGE_SHARE_MAX) * 10, 2),
      pattern: "hinge",
      reason: "lower_hinge_share_exceeded",
      details: {
        hingeSets,
        lowerPatternSets,
        share: roundToTenth(hingeShare),
        maxShare: LOWER_HINGE_SHARE_MAX,
      },
    });
  }

  const pushSets = countPatternSets(upperSlots, ["push"]);
  const pullSets = countPatternSets(upperSlots, ["pull"]);
  const upperPatternSets = pushSets + pullSets;
  const dominantUpperShare = upperPatternSets > 0 ? Math.max(pushSets, pullSets) / upperPatternSets : 0;
  if (upperPatternSets > 0 && dominantUpperShare > UPPER_PUSH_PULL_SHARE_MAX) {
    diagnostics.push({
      priority: "P1",
      constraint: "weekly_pattern_balance",
      penalty: penalty((dominantUpperShare - UPPER_PUSH_PULL_SHARE_MAX) * 10, 2),
      pattern: pushSets >= pullSets ? "push" : "pull",
      reason: "upper_push_pull_imbalance_exceeded",
      details: {
        pushSets,
        pullSets,
        share: roundToTenth(dominantUpperShare),
        maxShare: UPPER_PUSH_PULL_SHARE_MAX,
      },
    });
  }

  return diagnostics;
}

function evaluateSessionComposition(slots: ReadonlyArray<ProjectedSlotWorkout>): ProgramQualityDiagnostic[] {
  return slots.flatMap((slot) => {
    const exercises = getWorkoutExercises(slot.workout);
    const mainCompoundCount = slot.workout.mainLifts.filter(
      (exercise) => exercise.exercise.isCompound ?? false
    ).length;
    const diagnostics: ProgramQualityDiagnostic[] = [];
    if (mainCompoundCount > MAX_MAIN_COMPOUNDS_PER_SESSION) {
      diagnostics.push({
        priority: "P2",
        constraint: "session_composition",
        penalty: penalty(mainCompoundCount - MAX_MAIN_COMPOUNDS_PER_SESSION, 2),
        slotId: slot.slotPlan.slotId,
        reason: "main_compound_count_exceeded",
        details: { mainCompoundCount, maxMainCompounds: MAX_MAIN_COMPOUNDS_PER_SESSION },
      });
    }

    const patternCounts = new Map<BroadMovementPattern, number>();
    for (const exercise of exercises) {
      const pattern = getBroadMovementPattern(exercise.exercise);
      patternCounts.set(pattern, (patternCounts.get(pattern) ?? 0) + 1);
    }
    for (const [pattern, count] of patternCounts) {
      if (pattern === "other" || count <= MAX_SAME_PATTERN_PER_SESSION) {
        continue;
      }
      diagnostics.push({
        priority: "P3",
        constraint: "session_composition",
        penalty: penalty(count - MAX_SAME_PATTERN_PER_SESSION),
        slotId: slot.slotPlan.slotId,
        pattern,
        reason: "same_pattern_count_exceeded",
        details: { count, maxSamePatternPerSession: MAX_SAME_PATTERN_PER_SESSION },
      });
    }

    return diagnostics;
  });
}

function evaluateRedundancy(slots: ReadonlyArray<ProjectedSlotWorkout>): ProgramQualityDiagnostic[] {
  return slots.flatMap((slot) => {
    const exercises = getWorkoutExercises(slot.workout);
    const diagnostics: ProgramQualityDiagnostic[] = [];
    for (let leftIndex = 0; leftIndex < exercises.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < exercises.length; rightIndex += 1) {
        const left = exercises[leftIndex];
        const right = exercises[rightIndex];
        if (!left || !right) {
          continue;
        }
        const samePattern =
          getBroadMovementPattern(left.exercise) === getBroadMovementPattern(right.exercise);
        const similarResistance =
          getResistanceProfile(left.exercise) === getResistanceProfile(right.exercise);
        if (!samePattern || !similarResistance) {
          continue;
        }
        diagnostics.push({
          priority: "P4",
          constraint: "redundancy",
          penalty: 1,
          slotId: slot.slotPlan.slotId,
          exerciseId: right.exercise.id,
          name: right.exercise.name,
          pattern: getBroadMovementPattern(right.exercise),
          reason: "same_pattern_and_resistance_profile",
          details: { pairedExerciseId: left.exercise.id },
        });
      }
    }
    return diagnostics;
  });
}

function evaluateDuplicateDiagnostics(input: {
  slots: ReadonlyArray<ProjectedSlotWorkout>;
  exerciseLibrary: MappedGenerationContext["exerciseLibrary"];
}): ProgramQualityDiagnostic[] {
  const diagnostics: ProgramQualityDiagnostic[] = [];
  const previousSlots: ProjectedSlotWorkout[] = [];
  for (const slot of input.slots) {
    const reuse = evaluateDuplicateExerciseReuse({
      projectedSlots: previousSlots,
      workout: slot.workout,
      slotId: slot.slotPlan.slotId,
      exerciseLibrary: input.exerciseLibrary,
    });
    diagnostics.push(
      ...reuse.diagnostics.map((diagnostic) => ({
        priority: "P4" as const,
        constraint: "cross_slot_duplicate" as const,
        penalty:
          diagnostic.role === "main"
            ? diagnostic.hasCompatibleAlternative ? 4 : 0.5
            : diagnostic.hasCompatibleAlternative ? 3 : 0.5,
        slotId: diagnostic.repeatedInSlotId,
        exerciseId: diagnostic.exerciseId,
        name: diagnostic.name,
        reason: diagnostic.reason,
        details: {
          previousSlotIds: diagnostic.previousSlotIds,
          role: diagnostic.role,
          hasCompatibleAlternative: diagnostic.hasCompatibleAlternative,
        },
      }))
    );
    previousSlots.push(slot);
  }
  return diagnostics;
}

function evaluateIsolationCompleteness(slots: ReadonlyArray<ProjectedSlotWorkout>): ProgramQualityDiagnostic[] {
  const totals = computeProjectedWeeklyContributionByMuscle({
    projectedSlots: slots,
    currentSlotContribution: new Map(),
  });
  return ISOLATION_COMPLETENESS_TARGETS.flatMap((muscle) => {
    const threshold = getWeekOneSupportFloor(muscle) ?? 0;
    if (threshold <= 0) {
      return [];
    }
    const total = totals.get(muscle) ?? 0;
    if (total >= threshold) {
      return [];
    }
    return [
      {
        priority: "P5",
        constraint: "isolation_completeness",
        penalty: penalty(threshold - total, 0.75),
        muscle,
        reason: "direct_isolation_deficit",
        details: {
          projectedEffectiveSets: roundToTenth(total),
          threshold,
        },
      } satisfies ProgramQualityDiagnostic,
    ];
  });
}

export function evaluateProgramQualityConstraints(input: {
  projectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
  exerciseLibrary: MappedGenerationContext["exerciseLibrary"];
}): ProgramQualityEvaluation {
  const diagnostics = [
    ...evaluateWeeklyPatternBalance(input.projectedSlots),
    ...evaluatePerExerciseEfficiency(input.projectedSlots),
    ...evaluateStimulusDiversity(input.projectedSlots),
    ...evaluateSessionComposition(input.projectedSlots),
    ...evaluateRedundancy(input.projectedSlots),
    ...evaluateDuplicateDiagnostics({
      slots: input.projectedSlots,
      exerciseLibrary: input.exerciseLibrary,
    }),
    ...evaluateIsolationCompleteness(input.projectedSlots),
  ];
  return {
    totalPenalty: roundToTenth(diagnostics.reduce((sum, diagnostic) => sum + diagnostic.penalty, 0)),
    diagnostics,
    constraintCounts: evaluateConstraintCounts(diagnostics),
  };
}

function preservesP0WeeklyObligations(input: {
  beforeSlots: ReadonlyArray<ProjectedSlotWorkout>;
  afterSlots: ReadonlyArray<ProjectedSlotWorkout>;
  weeklyObligationPlan: WeeklyMuscleObligationPlan;
}): boolean {
  const beforeTotals = getWeeklyContribution(input.beforeSlots);
  const afterTotals = getWeeklyContribution(input.afterSlots);

  return HARD_WEEKLY_OBLIGATION_MUSCLES.every((muscle) => {
    const beforeTotal = beforeTotals.get(muscle) ?? 0;
    const requiredWeeklyFloor = getWeeklyHardTargetFloor({
      muscle,
      beforeTotal,
      weeklyObligationPlan: input.weeklyObligationPlan,
    });
    return (afterTotals.get(muscle) ?? 0) + 1e-9 >= requiredWeeklyFloor;
  });
}

function getSlotIdentityBlockReason(input: {
  beforeSlots: ReadonlyArray<ProjectedSlotWorkout>;
  afterSlots: ReadonlyArray<ProjectedSlotWorkout>;
  slotSequenceEntries: SlotSequenceEntries;
  weeklyObligationPlan: WeeklyMuscleObligationPlan;
}): ProgramQualityBlockReason | null {
  for (const [index, beforeSlot] of input.beforeSlots.entries()) {
    const afterSlot = input.afterSlots[index];
    if (!afterSlot) {
      continue;
    }
    const slotPolicy = getSlotPolicy({
      slot: beforeSlot,
      slotSequenceEntries: input.slotSequenceEntries,
    });
    if (
      preservesSlotIdentity({ slotPolicy, workout: beforeSlot.workout }) &&
      !preservesSlotIdentity({ slotPolicy, workout: afterSlot.workout })
    ) {
      return "would_break_slot_identity";
    }
    if (
      !preservesSlotPrimaryContributionFloor({
        beforeSlot,
        afterSlot,
        slotSequenceEntries: input.slotSequenceEntries,
        weeklyObligationPlan: input.weeklyObligationPlan,
      })
    ) {
      return "would_break_slot_identity";
    }
  }
  return null;
}

function getCandidateBlockReason(input: {
  beforeSlots: ReadonlyArray<ProjectedSlotWorkout>;
  afterSlots: ReadonlyArray<ProjectedSlotWorkout>;
  slotSequenceEntries: SlotSequenceEntries;
  weeklyObligationPlan: WeeklyMuscleObligationPlan;
}): ProgramQualityBlockReason | null {
  const slotIdentityBlock = getSlotIdentityBlockReason({
    beforeSlots: input.beforeSlots,
    afterSlots: input.afterSlots,
    slotSequenceEntries: input.slotSequenceEntries,
    weeklyObligationPlan: input.weeklyObligationPlan,
  });
  if (slotIdentityBlock) {
    return slotIdentityBlock;
  }
  const hardCapBlock = getHardCapBlockReason(input.afterSlots);
  if (hardCapBlock) {
    return hardCapBlock;
  }
  if (
    !preservesP0WeeklyObligations({
      beforeSlots: input.beforeSlots,
      afterSlots: input.afterSlots,
      weeklyObligationPlan: input.weeklyObligationPlan,
    })
  ) {
    return "would_break_weekly_target";
  }
  if (lowerFatigueRiskScore(input.afterSlots) > lowerFatigueRiskScore(input.beforeSlots) + 1e-9) {
    return "would_worsen_fatigue";
  }
  if (redundancyPenalty(input.afterSlots) > redundancyPenalty(input.beforeSlots)) {
    return "no_compatible_alternative";
  }
  return null;
}

function withUpdatedSlotWorkout(
  slots: ReadonlyArray<ProjectedSlotWorkout>,
  slotIndex: number,
  workout: WorkoutPlan
): ProjectedSlotWorkout[] {
  return slots.map((projectedSlot, index) =>
    index === slotIndex ? updateProjectedSlotWorkout(projectedSlot, workout) : projectedSlot
  );
}

function tryReplaceSlotWorkout(input: {
  slots: ReadonlyArray<ProjectedSlotWorkout>;
  slotIndex: number;
  workout: WorkoutPlan;
  slotSequenceEntries: SlotSequenceEntries;
  weeklyObligationPlan: WeeklyMuscleObligationPlan;
}): ProjectedSlotWorkout[] | null {
  const slot = input.slots[input.slotIndex];
  if (!slot) {
    return null;
  }
  const candidateSlots = withUpdatedSlotWorkout(input.slots, input.slotIndex, input.workout);
  return getCandidateBlockReason({
    beforeSlots: input.slots,
    afterSlots: candidateSlots,
    slotSequenceEntries: input.slotSequenceEntries,
    weeklyObligationPlan: input.weeklyObligationPlan,
  }) == null
    ? candidateSlots
    : null;
}

function getReceiverScore(input: {
  donor: WorkoutExercise;
  receiver: WorkoutExercise;
  muscle: string;
}) {
  const donorPattern = getBroadMovementPattern(input.donor.exercise);
  const receiverPattern = getBroadMovementPattern(input.receiver.exercise);
  const receiverContribution = getEffectiveStimulusByMuscle(input.receiver.exercise, 1).get(input.muscle) ?? 0;
  return (
    (receiverPattern !== donorPattern ? 100 : 0) +
    (getSoftSetCap(input.receiver) - input.receiver.sets.length) * 10 +
    receiverContribution
  );
}

function moveOneSet(input: {
  workout: WorkoutPlan;
  donor: WorkoutExercise;
  receiver: WorkoutExercise;
}): WorkoutPlan {
  const donor = withSetCount(input.donor, input.donor.sets.length - 1);
  const receiver = withSetCount(input.receiver, input.receiver.sets.length + 1);
  return replaceWorkoutExercise(replaceWorkoutExercise(input.workout, donor), receiver);
}

function getPairedSlotId(slotId: string): string | null {
  if (slotId.endsWith("_a")) {
    return `${slotId.slice(0, -2)}_b`;
  }
  if (slotId.endsWith("_b")) {
    return `${slotId.slice(0, -2)}_a`;
  }
  return null;
}

function getReceiverSlotIndexes(input: {
  slots: ReadonlyArray<ProjectedSlotWorkout>;
  donorSlotIndex: number;
  scope: Exclude<RedistributionScope, "added_alternative">;
}): number[] {
  const donorSlot = input.slots[input.donorSlotIndex];
  if (!donorSlot) {
    return [];
  }
  if (input.scope === "same_slot") {
    return [input.donorSlotIndex];
  }
  const pairedSlotId = getPairedSlotId(donorSlot.slotPlan.slotId);
  if (input.scope === "paired_slot") {
    const pairedIndex = pairedSlotId
      ? input.slots.findIndex((slot) => slot.slotPlan.slotId === pairedSlotId)
      : -1;
    return pairedIndex >= 0 ? [pairedIndex] : [];
  }
  return input.slots
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot, index }) => index !== input.donorSlotIndex && slot.slotPlan.slotId !== pairedSlotId)
    .map(({ index }) => index);
}

function getTriggerMuscles(exercise: WorkoutExercise, preferredMuscle?: string): string[] {
  const contributions = Array.from(getEffectiveStimulusByMuscle(exercise.exercise, 1).entries())
    .filter(([, effectiveSets]) => effectiveSets > 0)
    .map(([muscle]) => muscle);
  const primaryMuscles = exercise.exercise.primaryMuscles ?? [];
  return Array.from(
    new Set([
      ...(preferredMuscle ? [preferredMuscle] : []),
      ...primaryMuscles.filter((muscle) => contributions.includes(muscle)),
      ...contributions,
    ])
  );
}

function getCurrentExercise(
  workout: WorkoutPlan,
  exerciseId: string
): WorkoutExercise | undefined {
  return getWorkoutExercises(workout).find((exercise) => exercise.exercise.id === exerciseId);
}

function chooseBlockReason(reasons: ReadonlySet<ProgramQualityBlockReason>): ProgramQualityBlockReason {
  for (const reason of [
    "would_break_weekly_target",
    "would_break_slot_identity",
    "would_exceed_hard_cap",
    "would_worsen_fatigue",
    "no_compatible_alternative",
  ] as const) {
    if (reasons.has(reason)) {
      return reason;
    }
  }
  return "no_compatible_alternative";
}

function buildRedistributionDiagnostic(input: {
  priority: ProgramQualityPriority;
  constraint: ProgramQualityDiagnostic["constraint"];
  slotId: string;
  donor: WorkoutExercise;
  muscle: string;
  reason: string;
  scope: RedistributionScope;
  fromSetCount: number;
  toExerciseId?: string;
  toSetCount?: number;
  blockReason?: ProgramQualityBlockReason;
}): ProgramQualityDiagnostic {
  return {
    priority: input.priority,
    constraint: input.constraint,
    penalty: 0,
    slotId: input.slotId,
    exerciseId: input.donor.exercise.id,
    name: input.donor.exercise.name,
    muscle: input.muscle,
    reason: input.reason,
    ...(input.blockReason ? { blockReason: input.blockReason } : {}),
    details: {
      redistributionScope: input.scope,
      fromSetCount: input.fromSetCount,
      ...(input.toExerciseId ? { toExerciseId: input.toExerciseId } : {}),
      ...(input.toSetCount != null ? { toSetCount: input.toSetCount } : {}),
    },
  };
}

function tryAcceptRedistribution(input: {
  beforeSlots: ReadonlyArray<ProjectedSlotWorkout>;
  afterSlots: ReadonlyArray<ProjectedSlotWorkout>;
  slotSequenceEntries: SlotSequenceEntries;
  weeklyObligationPlan: WeeklyMuscleObligationPlan;
}): { projectedSlots: ProjectedSlotWorkout[] } | { blockReason: ProgramQualityBlockReason } {
  const blockReason = getCandidateBlockReason({
    beforeSlots: input.beforeSlots,
    afterSlots: input.afterSlots,
    slotSequenceEntries: input.slotSequenceEntries,
    weeklyObligationPlan: input.weeklyObligationPlan,
  });
  return blockReason ? { blockReason } : { projectedSlots: [...input.afterSlots] };
}

function tryMoveOneSetToExistingReceiver(input: {
  slots: ReadonlyArray<ProjectedSlotWorkout>;
  donorSlotIndex: number;
  donor: WorkoutExercise;
  muscle: string;
  scope: Exclude<RedistributionScope, "added_alternative">;
  slotSequenceEntries: SlotSequenceEntries;
  weeklyObligationPlan: WeeklyMuscleObligationPlan;
}):
  | {
      projectedSlots: ProjectedSlotWorkout[];
      receiver: WorkoutExercise;
      receiverSlotId: string;
    }
  | { blockReasons: Set<ProgramQualityBlockReason> } {
  const blockReasons = new Set<ProgramQualityBlockReason>();
  const receiverIndexes = getReceiverSlotIndexes({
    slots: input.slots,
    donorSlotIndex: input.donorSlotIndex,
    scope: input.scope,
  });
  const receiverCandidates = receiverIndexes
    .flatMap((slotIndex) => {
      const slot = input.slots[slotIndex];
      if (!slot) {
        return [];
      }
      return getWorkoutExercises(slot.workout)
        .filter((candidate) => candidate.exercise.id !== input.donor.exercise.id)
        .filter((candidate) => candidate.sets.length < getSoftSetCap(candidate))
        .filter((candidate) => getExerciseMuscleContribution(candidate, input.muscle) > 0)
        .map((candidate) => ({ slot, slotIndex, candidate }));
    })
    .sort((left, right) => {
      const scoreDelta =
        getReceiverScore({ donor: input.donor, receiver: right.candidate, muscle: input.muscle }) -
        getReceiverScore({ donor: input.donor, receiver: left.candidate, muscle: input.muscle });
      if (scoreDelta !== 0) {
        return scoreDelta;
      }
      if (left.slotIndex !== right.slotIndex) {
        return left.slotIndex - right.slotIndex;
      }
      return left.candidate.exercise.name.localeCompare(right.candidate.exercise.name);
    });

  if (receiverCandidates.length === 0) {
    blockReasons.add("no_compatible_alternative");
    return { blockReasons };
  }

  for (const receiverCandidate of receiverCandidates) {
    let candidateSlots: ProjectedSlotWorkout[];
    if (receiverCandidate.slotIndex === input.donorSlotIndex) {
      candidateSlots = withUpdatedSlotWorkout(
        input.slots,
        input.donorSlotIndex,
        moveOneSet({
          workout: receiverCandidate.slot.workout,
          donor: input.donor,
          receiver: receiverCandidate.candidate,
        })
      );
    } else {
      const donorSlot = input.slots[input.donorSlotIndex];
      if (!donorSlot) {
        continue;
      }
      candidateSlots = withUpdatedSlotWorkout(
        input.slots,
        input.donorSlotIndex,
        replaceWorkoutExercise(donorSlot.workout, withSetCount(input.donor, input.donor.sets.length - 1))
      );
      const updatedReceiverSlot = candidateSlots[receiverCandidate.slotIndex];
      if (!updatedReceiverSlot) {
        continue;
      }
      candidateSlots = withUpdatedSlotWorkout(
        candidateSlots,
        receiverCandidate.slotIndex,
        replaceWorkoutExercise(
          updatedReceiverSlot.workout,
          withSetCount(receiverCandidate.candidate, receiverCandidate.candidate.sets.length + 1)
        )
      );
    }

    const accepted = tryAcceptRedistribution({
      beforeSlots: input.slots,
      afterSlots: candidateSlots,
      slotSequenceEntries: input.slotSequenceEntries,
      weeklyObligationPlan: input.weeklyObligationPlan,
    });
    if ("projectedSlots" in accepted) {
      return {
        projectedSlots: accepted.projectedSlots,
        receiver: receiverCandidate.candidate,
        receiverSlotId: receiverCandidate.slot.slotPlan.slotId,
      };
    }
    blockReasons.add(accepted.blockReason);
  }

  return { blockReasons };
}

function selectCompatibleAlternativeExercise(input: {
  exerciseLibrary: MappedGenerationContext["exerciseLibrary"];
  selectedExerciseIds: Set<string>;
  donor: WorkoutExercise;
  muscle: string;
}) {
  const donorPattern = getBroadMovementPattern(input.donor.exercise);
  return input.exerciseLibrary
    .filter((exercise) => !input.selectedExerciseIds.has(exercise.id))
    .filter((exercise) => (getEffectiveStimulusByMuscle(exercise, 1).get(input.muscle) ?? 0) > 0)
    .filter((exercise) => exerciseHasPrimaryMuscle(exercise, input.muscle))
    .sort((left, right) => {
      const leftDifferentPattern = getBroadMovementPattern(left) !== donorPattern ? 1 : 0;
      const rightDifferentPattern = getBroadMovementPattern(right) !== donorPattern ? 1 : 0;
      if (leftDifferentPattern !== rightDifferentPattern) {
        return rightDifferentPattern - leftDifferentPattern;
      }
      const leftMainEligible = left.isMainLiftEligible ? 1 : 0;
      const rightMainEligible = right.isMainLiftEligible ? 1 : 0;
      if (leftMainEligible !== rightMainEligible) {
        return leftMainEligible - rightMainEligible;
      }
      const contributionDelta =
        (getEffectiveStimulusByMuscle(right, 1).get(input.muscle) ?? 0) -
        (getEffectiveStimulusByMuscle(left, 1).get(input.muscle) ?? 0);
      if (contributionDelta !== 0) {
        return contributionDelta;
      }
      const fatigueDelta = (left.fatigueCost ?? 3) - (right.fatigueCost ?? 3);
      if (fatigueDelta !== 0) {
        return fatigueDelta;
      }
      return left.name.localeCompare(right.name);
    })[0];
}

function buildAlternativeWorkoutExercise(input: {
  exercise: WorkoutExercise["exercise"];
  template: WorkoutExercise | undefined;
  orderIndex: number;
  setCount: number;
}): WorkoutExercise {
  return withSetCount(
    buildSupportAccessoryExercise({
      exercise: input.exercise,
      template: input.template,
      orderIndex: input.orderIndex,
    }),
    input.setCount
  );
}

function getAlternativeSlotIndexes(input: {
  slots: ReadonlyArray<ProjectedSlotWorkout>;
  donorSlotIndex: number;
}): number[] {
  return [
    ...getReceiverSlotIndexes({ ...input, scope: "same_slot" }),
    ...getReceiverSlotIndexes({ ...input, scope: "paired_slot" }),
    ...getReceiverSlotIndexes({ ...input, scope: "elsewhere_week" }),
  ];
}

function tryAddCompatibleAlternative(input: {
  slots: ReadonlyArray<ProjectedSlotWorkout>;
  donorSlotIndex: number;
  donor: WorkoutExercise;
  muscle: string;
  exerciseLibrary: MappedGenerationContext["exerciseLibrary"];
  slotSequenceEntries: SlotSequenceEntries;
  weeklyObligationPlan: WeeklyMuscleObligationPlan;
}):
  | {
      projectedSlots: ProjectedSlotWorkout[];
      exercise: WorkoutExercise["exercise"];
      setCount: number;
      slotId: string;
    }
  | { blockReasons: Set<ProgramQualityBlockReason> } {
  const blockReasons = new Set<ProgramQualityBlockReason>();
  const donorCapacity = input.donor.sets.length - getMinimumSetCount(input.donor);
  const transferSetCount = Math.min(
    SOFT_ACCESSORY_SET_CAP,
    donorCapacity,
    Math.max(MIN_PROJECTED_ACCESSORY_SETS_PER_EXERCISE, input.donor.sets.length - getSoftSetCap(input.donor))
  );
  if (transferSetCount < MIN_PROJECTED_ACCESSORY_SETS_PER_EXERCISE) {
    blockReasons.add("would_break_slot_identity");
    return { blockReasons };
  }

  const selectedExerciseIds = new Set(
    input.slots.flatMap((slot) => getWorkoutExercises(slot.workout).map((exercise) => exercise.exercise.id))
  );
  const alternative = selectCompatibleAlternativeExercise({
    exerciseLibrary: input.exerciseLibrary,
    selectedExerciseIds,
    donor: input.donor,
    muscle: input.muscle,
  });
  if (!alternative) {
    blockReasons.add("no_compatible_alternative");
    return { blockReasons };
  }

  const targetSlotIndexes = getAlternativeSlotIndexes({
    slots: input.slots,
    donorSlotIndex: input.donorSlotIndex,
  });
  if (
    targetSlotIndexes.every((slotIndex) => {
      const slot = input.slots[slotIndex];
      return !slot || countWorkoutExercises(slot.workout) >= SESSION_CAPS.maxExercises;
    })
  ) {
    blockReasons.add("would_exceed_hard_cap");
    return { blockReasons };
  }

  for (const targetSlotIndex of targetSlotIndexes) {
    const targetSlot = input.slots[targetSlotIndex];
    const donorSlot = input.slots[input.donorSlotIndex];
    if (!targetSlot || !donorSlot || countWorkoutExercises(targetSlot.workout) >= SESSION_CAPS.maxExercises) {
      continue;
    }

    let candidateSlots = withUpdatedSlotWorkout(
      input.slots,
      input.donorSlotIndex,
      replaceWorkoutExercise(donorSlot.workout, withSetCount(input.donor, input.donor.sets.length - transferSetCount))
    );
    const updatedTargetSlot = candidateSlots[targetSlotIndex];
    if (!updatedTargetSlot) {
      continue;
    }
    const targetWorkout = appendAccessory(
      updatedTargetSlot.workout,
      buildAlternativeWorkoutExercise({
        exercise: alternative,
        template: updatedTargetSlot.workout.accessories.at(-1),
        orderIndex: countWorkoutExercises(updatedTargetSlot.workout),
        setCount: transferSetCount,
      })
    );
    candidateSlots = withUpdatedSlotWorkout(candidateSlots, targetSlotIndex, targetWorkout);

    const accepted = tryAcceptRedistribution({
      beforeSlots: input.slots,
      afterSlots: candidateSlots,
      slotSequenceEntries: input.slotSequenceEntries,
      weeklyObligationPlan: input.weeklyObligationPlan,
    });
    if ("projectedSlots" in accepted) {
      return {
        projectedSlots: accepted.projectedSlots,
        exercise: alternative,
        setCount: transferSetCount,
        slotId: targetSlot.slotPlan.slotId,
      };
    }
    blockReasons.add(accepted.blockReason);
  }

  return { blockReasons };
}

function replaceAccessoryExercise(
  workout: WorkoutPlan,
  originalExerciseId: string,
  replacement: WorkoutExercise
): WorkoutPlan {
  return reindexWorkout({
    ...workout,
    accessories: workout.accessories.map((exercise) =>
      exercise.exercise.id === originalExerciseId ? replacement : exercise
    ),
  });
}

function selectLowerFatigueSupportAlternative(input: {
  exerciseLibrary: MappedGenerationContext["exerciseLibrary"];
  selectedExerciseIds: Set<string>;
}): WorkoutExercise["exercise"] | undefined {
  return input.exerciseLibrary
    .filter((exercise) => !input.selectedExerciseIds.has(exercise.id))
    .filter((exercise) => !(exercise.isMainLiftEligible ?? false))
    .filter((exercise) => {
      const primaryMuscles = exercise.primaryMuscles ?? [];
      const pattern = getBroadMovementPattern(exercise);
      return (
        (primaryMuscles.includes("Hamstrings") && pattern !== "hinge") ||
        primaryMuscles.includes("Calves")
      );
    })
    .sort((left, right) => {
      const leftHamstring = (left.primaryMuscles ?? []).includes("Hamstrings") ? 1 : 0;
      const rightHamstring = (right.primaryMuscles ?? []).includes("Hamstrings") ? 1 : 0;
      if (leftHamstring !== rightHamstring) {
        return rightHamstring - leftHamstring;
      }
      const fatigueDelta = (left.fatigueCost ?? 3) - (right.fatigueCost ?? 3);
      if (fatigueDelta !== 0) {
        return fatigueDelta;
      }
      return left.name.localeCompare(right.name);
    })[0];
}

function hasLowerPairFatiguePressure(slots: ReadonlyArray<ProjectedSlotWorkout>): boolean {
  const lowerSlots = slots.filter((slot) => slot.slotPlan.intent === "LOWER");
  if (lowerSlots.length < 2) {
    return false;
  }
  const totals = getWeeklyContribution(slots);
  const gluteMav = VOLUME_LANDMARKS.Glutes?.mav ?? Number.POSITIVE_INFINITY;
  const hingeSets = countPatternSets(lowerSlots, ["hinge"]);
  const lowerPatternSets = countPatternSets(lowerSlots, ["hinge", "squat", "lunge"]);
  const hingeShare = lowerPatternSets > 0 ? hingeSets / lowerPatternSets : 0;
  return (
    (totals.get("Glutes") ?? 0) > gluteMav ||
    hingeShare > LOWER_HINGE_SHARE_MAX ||
    countLowerBDuplicateSquatPressure(slots) > 0
  );
}

function applyLowerPairFatigueShaping(input: {
  slots: ReadonlyArray<ProjectedSlotWorkout>;
  exerciseLibrary: MappedGenerationContext["exerciseLibrary"];
  slotSequenceEntries: SlotSequenceEntries;
  weeklyObligationPlan: WeeklyMuscleObligationPlan;
  appliedDiagnostics: ProgramQualityDiagnostic[];
}): ProjectedSlotWorkout[] {
  let slots = [...input.slots];
  if (!hasLowerPairFatiguePressure(slots)) {
    return slots;
  }

  const lowerBIndex = slots.findIndex(
    (slot) => slot.slotPlan.intent === "LOWER" && slot.slotPlan.slotId.endsWith("_b")
  );
  const lowerB = slots[lowerBIndex];
  if (!lowerB) {
    return slots;
  }
  const lowerBPolicy = getSlotPolicy({
    slot: lowerB,
    slotSequenceEntries: input.slotSequenceEntries,
  });
  if (lowerBPolicy?.sessionShape?.id !== "lower_hinge_dominant") {
    return slots;
  }

  const selectedExerciseIds = new Set(
    slots.flatMap((slot) => getWorkoutExercises(slot.workout).map((exercise) => exercise.exercise.id))
  );
  const supportAlternative = selectLowerFatigueSupportAlternative({
    exerciseLibrary: input.exerciseLibrary,
    selectedExerciseIds,
  });

  if (supportAlternative) {
    const requiredSquatSupports = lowerBPolicy.sessionShape.requiredMovementPatterns?.includes("squat")
      ? 1
      : 0;
    const squatAccessories = lowerB.workout.accessories.filter(
      (exercise) => getBroadMovementPattern(exercise.exercise) === "squat"
    );
    for (const accessory of squatAccessories.slice(requiredSquatSupports)) {
      const replacement = buildAlternativeWorkoutExercise({
        exercise: supportAlternative,
        template: accessory,
        orderIndex: accessory.orderIndex,
        setCount: Math.min(accessory.sets.length, SOFT_ACCESSORY_SET_CAP),
      });
      const candidate = tryReplaceSlotWorkout({
        slots,
        slotIndex: lowerBIndex,
        workout: replaceAccessoryExercise(lowerB.workout, accessory.exercise.id, replacement),
        slotSequenceEntries: input.slotSequenceEntries,
        weeklyObligationPlan: input.weeklyObligationPlan,
      });
      if (!candidate) {
        continue;
      }
      slots = candidate;
      selectedExerciseIds.add(supportAlternative.id);
      input.appliedDiagnostics.push({
        priority: "P1",
        constraint: "weekly_pattern_balance",
        penalty: 0,
        slotId: lowerB.slotPlan.slotId,
        exerciseId: accessory.exercise.id,
        name: accessory.exercise.name,
        pattern: "squat",
        reason: "replaced_duplicate_squat_support_for_lower_fatigue",
        details: {
          toExerciseId: supportAlternative.id,
        },
      });
      break;
    }
  }

  for (let pass = 0; pass < 4 && lowerFatigueRiskScore(slots) > 0; pass += 1) {
    const currentLowerB = slots[lowerBIndex];
    if (!currentLowerB) {
      break;
    }
    const duplicateSquatSupport = currentLowerB.workout.accessories
      .filter((exercise) => getBroadMovementPattern(exercise.exercise) === "squat")
      .filter((exercise) => exercise.sets.length > getMinimumSetCount(exercise))
      .sort((left, right) => right.sets.length - left.sets.length || left.exercise.name.localeCompare(right.exercise.name))[0];
    if (!duplicateSquatSupport) {
      break;
    }
    const candidate = tryReplaceSlotWorkout({
      slots,
      slotIndex: lowerBIndex,
      workout: replaceWorkoutExercise(
        currentLowerB.workout,
        withSetCount(duplicateSquatSupport, duplicateSquatSupport.sets.length - 1)
      ),
      slotSequenceEntries: input.slotSequenceEntries,
      weeklyObligationPlan: input.weeklyObligationPlan,
    });
    if (!candidate || lowerFatigueRiskScore(candidate) >= lowerFatigueRiskScore(slots)) {
      break;
    }
    slots = candidate;
    input.appliedDiagnostics.push({
      priority: "P1",
      constraint: "weekly_pattern_balance",
      penalty: 0,
      slotId: currentLowerB.slotPlan.slotId,
      exerciseId: duplicateSquatSupport.exercise.id,
      name: duplicateSquatSupport.exercise.name,
      pattern: "squat",
      reason: "reduced_duplicate_squat_support_for_lower_fatigue",
      details: {
        fromSetCount: duplicateSquatSupport.sets.length,
        toSetCount: duplicateSquatSupport.sets.length - 1,
      },
    });
  }

  for (let pass = 0; pass < 2 && lowerFatigueRiskScore(slots) > 0; pass += 1) {
    const currentLowerB = slots[lowerBIndex];
    if (!currentLowerB) {
      break;
    }
    const hingeDonor = getWorkoutExercises(currentLowerB.workout)
      .filter((exercise) => getBroadMovementPattern(exercise.exercise) === "hinge")
      .filter((exercise) => exercise.sets.length > getMinimumSetCount(exercise))
      .sort((left, right) => right.sets.length - left.sets.length || left.exercise.name.localeCompare(right.exercise.name))[0];
    const kneeFlexionReceiver = currentLowerB.workout.accessories
      .filter((exercise) => getBroadMovementPattern(exercise.exercise) !== "hinge")
      .filter((exercise) => getExerciseMuscleContribution(exercise, "Hamstrings") > 0)
      .filter((exercise) => exercise.sets.length < getHardSetCap(exercise))
      .sort((left, right) => left.sets.length - right.sets.length || left.exercise.name.localeCompare(right.exercise.name))[0];
    if (!hingeDonor || !kneeFlexionReceiver) {
      break;
    }
    const candidateSlots = withUpdatedSlotWorkout(
      slots,
      lowerBIndex,
      moveOneSet({
        workout: currentLowerB.workout,
        donor: hingeDonor,
        receiver: kneeFlexionReceiver,
      })
    );
    const accepted = tryAcceptRedistribution({
      beforeSlots: slots,
      afterSlots: candidateSlots,
      slotSequenceEntries: input.slotSequenceEntries,
      weeklyObligationPlan: input.weeklyObligationPlan,
    });
    if ("blockReason" in accepted || lowerFatigueRiskScore(accepted.projectedSlots) >= lowerFatigueRiskScore(slots)) {
      break;
    }
    slots = accepted.projectedSlots;
    input.appliedDiagnostics.push({
      priority: "P1",
      constraint: "weekly_pattern_balance",
      penalty: 0,
      slotId: currentLowerB.slotPlan.slotId,
      exerciseId: hingeDonor.exercise.id,
      name: hingeDonor.exercise.name,
      muscle: "Hamstrings",
      pattern: "hinge",
      reason: "moved_hinge_hamstring_work_to_knee_flexion",
      details: {
        fromSetCount: hingeDonor.sets.length,
        toExerciseId: kneeFlexionReceiver.exercise.id,
        toSetCount: kneeFlexionReceiver.sets.length + 1,
      },
    });
  }

  return slots;
}

type RedistributionTrigger = {
  priority: ProgramQualityPriority;
  constraint: ProgramQualityDiagnostic["constraint"];
  slotIndex: number;
  slotId: string;
  donor: WorkoutExercise;
  muscle?: string;
  key: string;
};

function findRedistributionTrigger(
  slots: ReadonlyArray<ProjectedSlotWorkout>,
  blockedKeys: ReadonlySet<string>
): RedistributionTrigger | null {
  const softCapTrigger = slots
    .flatMap((slot, slotIndex) =>
      getWorkoutExercises(slot.workout)
        .filter((exercise) => exercise.sets.length > getSoftSetCap(exercise))
        .filter((exercise) => exercise.sets.length > getMinimumSetCount(exercise))
        .map((exercise) => ({
          priority: "P2" as const,
          constraint: "per_exercise_efficiency" as const,
          slotIndex,
          slotId: slot.slotPlan.slotId,
          donor: exercise,
          muscle: exercise.exercise.primaryMuscles?.[0],
          key: `soft-cap:${slot.slotPlan.slotId}:${exercise.exercise.id}`,
        }))
    )
    .filter((trigger) => !blockedKeys.has(trigger.key))
    .sort((left, right) => {
      const leftOverage = left.donor.sets.length - getSoftSetCap(left.donor);
      const rightOverage = right.donor.sets.length - getSoftSetCap(right.donor);
      if (rightOverage !== leftOverage) {
        return rightOverage - leftOverage;
      }
      if (right.donor.sets.length !== left.donor.sets.length) {
        return right.donor.sets.length - left.donor.sets.length;
      }
      return left.donor.exercise.name.localeCompare(right.donor.exercise.name);
    })[0];
  if (softCapTrigger) {
    return softCapTrigger;
  }

  const dominanceTrigger = evaluateStimulusDiversity(slots)
    .filter((diagnostic) => diagnostic.constraint === "single_exercise_volume_share")
    .flatMap((diagnostic) => {
      const slotIndex = slots.findIndex((slot) => slot.slotPlan.slotId === diagnostic.slotId);
      const slot = slots[slotIndex];
      const donor = slot && diagnostic.exerciseId
        ? getCurrentExercise(slot.workout, diagnostic.exerciseId)
        : undefined;
      if (!slot || !donor || donor.sets.length <= getMinimumSetCount(donor)) {
        return [];
      }
      return [
        {
          priority: "P3" as const,
          constraint: "single_exercise_volume_share" as const,
          slotIndex,
          slotId: slot.slotPlan.slotId,
          donor,
          muscle: diagnostic.muscle,
          key: `dominance:${slot.slotPlan.slotId}:${donor.exercise.id}:${diagnostic.muscle ?? ""}`,
        },
      ];
    })
    .filter((trigger) => !blockedKeys.has(trigger.key))
    .sort((left, right) => left.slotIndex - right.slotIndex || left.donor.exercise.name.localeCompare(right.donor.exercise.name))[0];

  return dominanceTrigger ?? null;
}

function mustRedistributeExcessSets(input: {
  slots: ReadonlyArray<ProjectedSlotWorkout>;
  exerciseLibrary: MappedGenerationContext["exerciseLibrary"];
  slotSequenceEntries: SlotSequenceEntries;
  weeklyObligationPlan: WeeklyMuscleObligationPlan;
  appliedDiagnostics: ProgramQualityDiagnostic[];
}): ProjectedSlotWorkout[] {
  let slots = [...input.slots];
  const blockedKeys = new Set<string>();

  for (let pass = 0; pass < 48; pass += 1) {
    const trigger = findRedistributionTrigger(slots, blockedKeys);
    if (!trigger) {
      break;
    }
    const donorSlot = slots[trigger.slotIndex];
    if (!donorSlot) {
      blockedKeys.add(trigger.key);
      continue;
    }
    const donor = getCurrentExercise(donorSlot.workout, trigger.donor.exercise.id) ?? trigger.donor;
    const muscles = getTriggerMuscles(donor, trigger.muscle);
    const blockReasons = new Set<ProgramQualityBlockReason>();
    let redistributed = false;

    for (const scope of ["same_slot", "paired_slot", "elsewhere_week"] as const) {
      for (const muscle of muscles) {
        const result = tryMoveOneSetToExistingReceiver({
          slots,
          donorSlotIndex: trigger.slotIndex,
          donor,
          muscle,
          scope,
          slotSequenceEntries: input.slotSequenceEntries,
          weeklyObligationPlan: input.weeklyObligationPlan,
        });
        if ("projectedSlots" in result) {
          slots = result.projectedSlots;
          input.appliedDiagnostics.push(
            buildRedistributionDiagnostic({
              priority: trigger.priority,
              constraint: trigger.constraint,
              slotId: trigger.slotId,
              donor,
              muscle,
              reason:
                scope === "same_slot"
                  ? "moved_one_set_to_existing_same_slot_alternative"
                  : scope === "paired_slot"
                    ? "moved_one_set_to_existing_paired_slot_alternative"
                    : "moved_one_set_to_existing_week_alternative",
              scope,
              fromSetCount: donor.sets.length,
              toExerciseId: result.receiver.exercise.id,
              toSetCount: result.receiver.sets.length + 1,
            })
          );
          redistributed = true;
          break;
        }
        for (const reason of result.blockReasons) {
          blockReasons.add(reason);
        }
      }
      if (redistributed) {
        break;
      }
    }

    if (redistributed) {
      continue;
    }

    for (const muscle of muscles) {
      const result = tryAddCompatibleAlternative({
        slots,
        donorSlotIndex: trigger.slotIndex,
        donor,
        muscle,
        exerciseLibrary: input.exerciseLibrary,
        slotSequenceEntries: input.slotSequenceEntries,
        weeklyObligationPlan: input.weeklyObligationPlan,
      });
      if ("projectedSlots" in result) {
        slots = result.projectedSlots;
        input.appliedDiagnostics.push(
          buildRedistributionDiagnostic({
            priority: trigger.priority,
            constraint: trigger.constraint,
            slotId: trigger.slotId,
            donor,
            muscle,
            reason: "added_compatible_alternative_for_redistribution",
            scope: "added_alternative",
            fromSetCount: donor.sets.length,
            toExerciseId: result.exercise.id,
            toSetCount: result.setCount,
          })
        );
        redistributed = true;
        break;
      }
      for (const reason of result.blockReasons) {
        blockReasons.add(reason);
      }
    }

    if (redistributed) {
      continue;
    }

    const blockReason = chooseBlockReason(blockReasons);
    input.appliedDiagnostics.push(
      buildRedistributionDiagnostic({
        priority: trigger.priority,
        constraint: trigger.constraint,
        slotId: trigger.slotId,
        donor,
        muscle: muscles[0] ?? trigger.muscle ?? "",
        reason: "redistribution_blocked_stacking_allowed",
        scope: "added_alternative",
        fromSetCount: donor.sets.length,
        blockReason,
      })
    );
    blockedKeys.add(trigger.key);
  }

  return slots;
}

function applyMainCompoundLimit(input: {
  slots: ReadonlyArray<ProjectedSlotWorkout>;
  slotSequenceEntries: SlotSequenceEntries;
  weeklyObligationPlan: WeeklyMuscleObligationPlan;
  appliedDiagnostics: ProgramQualityDiagnostic[];
}): ProjectedSlotWorkout[] {
  let slots = [...input.slots];
  for (const [slotIndex, slot] of slots.entries()) {
    const mainCompounds = slot.workout.mainLifts.filter(
      (exercise) => exercise.exercise.isCompound ?? false
    );
    if (mainCompounds.length <= MAX_MAIN_COMPOUNDS_PER_SESSION) {
      continue;
    }
    let workout = slot.workout;
    for (const exercise of mainCompounds.slice(MAX_MAIN_COMPOUNDS_PER_SESSION)) {
      workout = reindexWorkout({
        ...workout,
        mainLifts: workout.mainLifts.filter((entry) => entry.exercise.id !== exercise.exercise.id),
        accessories: [
          ...workout.accessories,
          {
            ...exercise,
            isMainLift: false,
            role: "accessory",
          },
        ],
      });
    }
    const candidate = tryReplaceSlotWorkout({
      slots,
      slotIndex,
      workout,
      slotSequenceEntries: input.slotSequenceEntries,
      weeklyObligationPlan: input.weeklyObligationPlan,
    });
    if (!candidate) {
      continue;
    }
    slots = candidate;
    input.appliedDiagnostics.push({
      priority: "P2",
      constraint: "session_composition",
      penalty: 0,
      slotId: slot.slotPlan.slotId,
      reason: "demoted_excess_main_compounds",
      details: {
        mainCompoundCount: mainCompounds.length,
        maxMainCompounds: MAX_MAIN_COMPOUNDS_PER_SESSION,
      },
    });
  }
  return slots;
}

function applySetSpread(input: {
  slots: ReadonlyArray<ProjectedSlotWorkout>;
  slotSequenceEntries: SlotSequenceEntries;
  weeklyObligationPlan: WeeklyMuscleObligationPlan;
  appliedDiagnostics: ProgramQualityDiagnostic[];
  exerciseLibrary: MappedGenerationContext["exerciseLibrary"];
}): ProjectedSlotWorkout[] {
  return mustRedistributeExcessSets(input);
}

function selectIsolationExercise(input: {
  exerciseLibrary: MappedGenerationContext["exerciseLibrary"];
  selectedExerciseIds: Set<string>;
  muscle: string;
}) {
  return input.exerciseLibrary
    .filter((exercise) => !input.selectedExerciseIds.has(exercise.id))
    .filter((exercise) => !(exercise.isCompound ?? false))
    .filter((exercise) => !(exercise.isMainLiftEligible ?? false))
    .filter((exercise) => exerciseHasPrimaryMuscle(exercise, input.muscle))
    .sort((left, right) => {
      const fatigueDelta = (left.fatigueCost ?? 3) - (right.fatigueCost ?? 3);
      if (fatigueDelta !== 0) {
        return fatigueDelta;
      }
      return left.name.localeCompare(right.name);
    })[0];
}

function isIsolationCompatibleWithSlot(input: {
  muscle: string;
  slotPolicy: ReturnType<typeof resolveSessionSlotPolicy>["currentSession"];
}): boolean {
  const sessionIntent = input.slotPolicy?.sessionIntent;
  if (input.muscle === "Biceps") {
    return sessionIntent === "pull" || sessionIntent === "upper";
  }
  if (input.muscle === "Triceps" || input.muscle === "Side Delts") {
    return sessionIntent === "push" || sessionIntent === "upper";
  }
  return false;
}

function getTierAFloor(input: {
  muscle: string;
  weeklyObligationPlan: WeeklyMuscleObligationPlan;
}): number {
  const hardMuscle = HARD_WEEKLY_OBLIGATION_MUSCLES.find((muscle) => muscle === input.muscle);
  return hardMuscle
    ? input.weeklyObligationPlan.muscles[hardMuscle].targetSets
    : VOLUME_LANDMARKS[input.muscle]?.mev ?? 0;
}

function findReplaceableTierARedundancy(input: {
  workout: WorkoutPlan;
  totals: ReadonlyMap<string, number>;
  weeklyObligationPlan: WeeklyMuscleObligationPlan;
}): WorkoutExercise | undefined {
  return input.workout.accessories
    .filter((exercise) => {
      const primaryMuscles = exercise.exercise.primaryMuscles ?? [];
      if (primaryMuscles.length === 0) {
        return false;
      }
      if (primaryMuscles.some((muscle) => MUSCLE_TARGET_TIER_BY_MUSCLE[muscle] === "B_SUPPORT")) {
        return false;
      }
      return primaryMuscles.every((muscle) => {
        const tier = MUSCLE_TARGET_TIER_BY_MUSCLE[muscle];
        if (tier !== "A_PRIMARY" && tier !== "IMPLICIT") {
          return false;
        }
        const floor = getTierAFloor({
          muscle,
          weeklyObligationPlan: input.weeklyObligationPlan,
        });
        return (input.totals.get(muscle) ?? 0) + 1e-9 >= floor;
      });
    })
    .sort((left, right) => {
      const leftFatigue = left.exercise.fatigueCost ?? 3;
      const rightFatigue = right.exercise.fatigueCost ?? 3;
      if (rightFatigue !== leftFatigue) {
        return rightFatigue - leftFatigue;
      }
      return left.exercise.name.localeCompare(right.exercise.name);
    })[0];
}

function applyDeficitDrivenIsolation(input: {
  slots: ReadonlyArray<ProjectedSlotWorkout>;
  exerciseLibrary: MappedGenerationContext["exerciseLibrary"];
  slotSequenceEntries: SlotSequenceEntries;
  weeklyObligationPlan: WeeklyMuscleObligationPlan;
  appliedDiagnostics: ProgramQualityDiagnostic[];
}): ProjectedSlotWorkout[] {
  let slots = [...input.slots];
  const selectedExerciseIds = new Set(
    slots.flatMap((slot) => getWorkoutExercises(slot.workout).map((exercise) => exercise.exercise.id))
  );

  for (const muscle of ISOLATION_COMPLETENESS_TARGETS) {
    const threshold = getWeekOneSupportFloor(muscle) ?? 0;
    const totals = computeProjectedWeeklyContributionByMuscle({
      projectedSlots: slots,
      currentSlotContribution: new Map(),
    });
    const currentTotal = totals.get(muscle) ?? 0;
    if (threshold <= 0 || currentTotal >= threshold) {
      continue;
    }
    const exercise = selectIsolationExercise({
      exerciseLibrary: input.exerciseLibrary,
      selectedExerciseIds,
      muscle,
    });
    if (!exercise) {
      continue;
    }
    const slotCandidates = slots
      .map((slot, index) => {
        if (countWorkoutExercises(slot.workout) >= SESSION_CAPS.maxExercises) {
          return null;
        }
        const slotPolicy = getSlotPolicy({ slot, slotSequenceEntries: input.slotSequenceEntries });
        const compatible =
          getProjectionRepairCompatibleMuscles(slotPolicy, [muscle]).includes(muscle) ||
          isIsolationCompatibleWithSlot({ muscle, slotPolicy });
        if (!compatible) {
          return null;
        }
        return { slot, index, slotPolicy };
      })
      .filter(
        (candidate): candidate is {
          slot: ProjectedSlotWorkout;
          index: number;
          slotPolicy: ReturnType<typeof resolveSessionSlotPolicy>["currentSession"];
        } => Boolean(candidate)
      )
      .sort((left, right) => left.index - right.index);
    const targetSlot = slotCandidates[0];
    const requestedEffectiveSets = threshold - currentTotal;
    const buildIsolation = (workout: WorkoutPlan, template?: WorkoutExercise) =>
      buildSupportAccessoryExercise({
        exercise,
        template: template ?? workout.accessories.at(-1),
        orderIndex: workout.mainLifts.length + workout.accessories.length,
        muscle,
        practicalFloor: threshold,
        requestedEffectiveSets,
      });

    let candidate: ProjectedSlotWorkout[] | null = null;
    let appliedSlot = targetSlot;
    let replacedExercise: WorkoutExercise | undefined;

    if (targetSlot) {
      candidate = tryReplaceSlotWorkout({
        slots,
        slotIndex: targetSlot.index,
        workout: appendAccessory(targetSlot.slot.workout, buildIsolation(targetSlot.slot.workout)),
        slotSequenceEntries: input.slotSequenceEntries,
        weeklyObligationPlan: input.weeklyObligationPlan,
      });
    }

    if (!candidate) {
      const replacementCandidate = slots
        .map((slot, index) => {
          const slotPolicy = getSlotPolicy({ slot, slotSequenceEntries: input.slotSequenceEntries });
          const compatible =
            getProjectionRepairCompatibleMuscles(slotPolicy, [muscle]).includes(muscle) ||
            isIsolationCompatibleWithSlot({ muscle, slotPolicy });
          if (!compatible) {
            return null;
          }
          const redundantExercise = findReplaceableTierARedundancy({
            workout: slot.workout,
            totals,
            weeklyObligationPlan: input.weeklyObligationPlan,
          });
          return redundantExercise ? { slot, index, redundantExercise, slotPolicy } : null;
        })
        .filter(
          (
            entry
          ): entry is {
            slot: ProjectedSlotWorkout;
            index: number;
            redundantExercise: WorkoutExercise;
            slotPolicy: ReturnType<typeof resolveSessionSlotPolicy>["currentSession"];
          } => Boolean(entry)
        )
        .sort((left, right) => left.index - right.index)[0];
      if (!replacementCandidate) {
        continue;
      }
      const replacement = buildIsolation(
        replacementCandidate.slot.workout,
        replacementCandidate.redundantExercise
      );
      candidate = tryReplaceSlotWorkout({
        slots,
        slotIndex: replacementCandidate.index,
        workout: replaceAccessoryExercise(
          replacementCandidate.slot.workout,
          replacementCandidate.redundantExercise.exercise.id,
          replacement
        ),
        slotSequenceEntries: input.slotSequenceEntries,
        weeklyObligationPlan: input.weeklyObligationPlan,
      });
      if (!candidate) {
        continue;
      }
      appliedSlot = replacementCandidate;
      replacedExercise = replacementCandidate.redundantExercise;
    }
    slots = candidate;
    selectedExerciseIds.add(exercise.id);
    input.appliedDiagnostics.push({
      priority: "P5",
      constraint: "isolation_completeness",
      penalty: 0,
      slotId: appliedSlot.slot.slotPlan.slotId,
      exerciseId: exercise.id,
      name: exercise.name,
      muscle,
      reason: replacedExercise
        ? "replaced_tier_a_redundancy_for_tier_b_deficit"
        : "injected_direct_isolation_for_deficit",
      details: {
        projectedEffectiveSets: roundToTenth(currentTotal),
        threshold,
        ...(replacedExercise ? { replacedExerciseId: replacedExercise.exercise.id } : {}),
      },
    });
  }

  return slots;
}

export function applyProgramQualityConstraints(input: {
  projectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
  exerciseLibrary: MappedGenerationContext["exerciseLibrary"];
  weeklyObligationPlan: WeeklyMuscleObligationPlan;
  slotSequenceEntries: SlotSequenceEntries;
}): ProgramQualityConstraintResult {
  const appliedDiagnostics: ProgramQualityDiagnostic[] = [];
  let projectedSlots = normalizeProjectedSlots(input.projectedSlots);

  projectedSlots = applyLowerPairFatigueShaping({
    slots: projectedSlots,
    exerciseLibrary: input.exerciseLibrary,
    slotSequenceEntries: input.slotSequenceEntries,
    weeklyObligationPlan: input.weeklyObligationPlan,
    appliedDiagnostics,
  });
  projectedSlots = applyMainCompoundLimit({
    slots: projectedSlots,
    slotSequenceEntries: input.slotSequenceEntries,
    weeklyObligationPlan: input.weeklyObligationPlan,
    appliedDiagnostics,
  });
  projectedSlots = applySetSpread({
    slots: projectedSlots,
    slotSequenceEntries: input.slotSequenceEntries,
    weeklyObligationPlan: input.weeklyObligationPlan,
    appliedDiagnostics,
    exerciseLibrary: input.exerciseLibrary,
  });
  projectedSlots = applyDeficitDrivenIsolation({
    slots: projectedSlots,
    exerciseLibrary: input.exerciseLibrary,
    slotSequenceEntries: input.slotSequenceEntries,
    weeklyObligationPlan: input.weeklyObligationPlan,
    appliedDiagnostics,
  });

  return {
    projectedSlots,
    appliedDiagnostics,
    evaluation: evaluateProgramQualityConstraints({
      projectedSlots,
      exerciseLibrary: input.exerciseLibrary,
    }),
  };
}

export function mapDuplicateReuseToProgramQualityDiagnostics(
  diagnostics: DuplicateExerciseReuseDiagnostic[]
): ProgramQualityDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    priority: "P4",
    constraint: "cross_slot_duplicate",
    penalty:
      diagnostic.role === "main"
        ? diagnostic.hasCompatibleAlternative ? 4 : 0.5
        : diagnostic.hasCompatibleAlternative ? 3 : 0.5,
    slotId: diagnostic.repeatedInSlotId,
    exerciseId: diagnostic.exerciseId,
    name: diagnostic.name,
    reason: diagnostic.reason,
    details: {
      previousSlotIds: diagnostic.previousSlotIds,
      role: diagnostic.role,
      hasCompatibleAlternative: diagnostic.hasCompatibleAlternative,
    },
  }));
}
