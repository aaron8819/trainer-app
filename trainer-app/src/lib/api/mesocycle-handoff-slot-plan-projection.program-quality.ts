import type { Exercise, WorkoutExercise, WorkoutPlan, WorkoutSet } from "@/lib/engine/types";
import { getEffectiveStimulusByMuscle } from "@/lib/engine/stimulus";
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
  evaluateWeeklyObligationPlan,
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

const SOFT_MAIN_LIFT_SET_CAP = 4;
const SOFT_ACCESSORY_SET_CAP = 3;
const STIMULUS_DIVERSITY_ACTIVATION_SETS = 8;
const SINGLE_EXERCISE_SHARE_ACTIVATION_SETS = 10;
const MAX_SINGLE_EXERCISE_MUSCLE_SHARE = 0.5;
const MAX_SINGLE_PATTERN_MUSCLE_SHARE = 0.7;
const LOWER_HINGE_SHARE_MAX = 0.6;
const UPPER_PUSH_PULL_SHARE_MAX = 0.65;
const MAX_SAME_PATTERN_PER_SESSION = 2;
const MAX_MAIN_COMPOUNDS_PER_SESSION = 2;
const ISOLATION_COMPLETENESS_TARGETS: ProtectedWeekOneCoverageMuscle[] = [
  "Biceps",
  "Triceps",
  "Side Delts",
];

type ProgramQualityPriority = keyof typeof PROGRAM_QUALITY_CONSTRAINT_PRIORITY;
type BroadMovementPattern = "push" | "pull" | "squat" | "hinge" | "lunge" | "isolation" | "other";

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
          diagnostic.role === "main" ? 0.5 : diagnostic.hasCompatibleAlternative ? 3 : 0.5,
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
  const beforeRows = evaluateWeeklyObligationPlan({
    plan: input.weeklyObligationPlan,
    projectedSlots: input.beforeSlots,
  });
  const afterRows = evaluateWeeklyObligationPlan({
    plan: input.weeklyObligationPlan,
    projectedSlots: input.afterSlots,
  });

  return beforeRows.every((beforeRow) => {
    if (beforeRow.shortfall > 0) {
      return true;
    }
    const afterRow = afterRows.find(
      (row) => row.slotId === beforeRow.slotId && row.muscle === beforeRow.muscle
    );
    return (afterRow?.shortfall ?? 0) <= 0;
  });
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
  const slotPolicy = getSlotPolicy({ slot, slotSequenceEntries: input.slotSequenceEntries });
  if (
    preservesSlotIdentity({ slotPolicy, workout: slot.workout }) &&
    !preservesSlotIdentity({ slotPolicy, workout: input.workout })
  ) {
    return null;
  }
  const candidateSlots = input.slots.map((projectedSlot, index) =>
    index === input.slotIndex ? updateProjectedSlotWorkout(projectedSlot, input.workout) : projectedSlot
  );
  return preservesP0WeeklyObligations({
    beforeSlots: input.slots,
    afterSlots: candidateSlots,
    weeklyObligationPlan: input.weeklyObligationPlan,
  })
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

function findSetSpreadReceiver(input: {
  workout: WorkoutPlan;
  donor: WorkoutExercise;
  muscle: string;
  requireDifferentPattern?: boolean;
}): WorkoutExercise | undefined {
  const donorPattern = getBroadMovementPattern(input.donor.exercise);
  return getWorkoutExercises(input.workout)
    .filter((candidate) => candidate.exercise.id !== input.donor.exercise.id)
    .filter((candidate) => candidate.sets.length < getHardSetCap(candidate))
    .filter((candidate) => !input.requireDifferentPattern || getBroadMovementPattern(candidate.exercise) !== donorPattern)
    .filter((candidate) => (getEffectiveStimulusByMuscle(candidate.exercise, 1).get(input.muscle) ?? 0) > 0)
    .sort((left, right) => {
      const scoreDelta =
        getReceiverScore({ donor: input.donor, receiver: right, muscle: input.muscle }) -
        getReceiverScore({ donor: input.donor, receiver: left, muscle: input.muscle });
      if (scoreDelta !== 0) {
        return scoreDelta;
      }
      return left.exercise.name.localeCompare(right.exercise.name);
    })[0];
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
}): ProjectedSlotWorkout[] {
  let slots = [...input.slots];
  for (let pass = 0; pass < 24; pass += 1) {
    let applied = false;
    for (const [slotIndex, slot] of slots.entries()) {
      const donor = getWorkoutExercises(slot.workout)
        .filter((exercise) => exercise.sets.length > getSoftSetCap(exercise))
        .filter((exercise) => exercise.sets.length > getMinimumSetCount(exercise))
        .sort((left, right) => {
          const leftOverage = left.sets.length - getSoftSetCap(left);
          const rightOverage = right.sets.length - getSoftSetCap(right);
          if (rightOverage !== leftOverage) {
            return rightOverage - leftOverage;
          }
          return right.sets.length - left.sets.length;
        })[0];
      if (!donor) {
        continue;
      }
      const donorMuscles = Array.from(getEffectiveStimulusByMuscle(donor.exercise, 1).entries())
        .filter(([, effectiveSets]) => effectiveSets > 0)
        .map(([muscle]) => muscle);
      const receiver = donorMuscles
        .flatMap((muscle) => {
          const candidate = findSetSpreadReceiver({ workout: slot.workout, donor, muscle });
          return candidate ? [{ muscle, candidate }] : [];
        })
        .sort((left, right) =>
          getReceiverScore({ donor, receiver: right.candidate, muscle: right.muscle }) -
          getReceiverScore({ donor, receiver: left.candidate, muscle: left.muscle })
        )[0];
      if (!receiver) {
        if (getExerciseRole(donor) !== "main") {
          continue;
        }
        const candidate = tryReplaceSlotWorkout({
          slots,
          slotIndex,
          workout: replaceWorkoutExercise(
            slot.workout,
            withSetCount(donor, donor.sets.length - 1)
          ),
          slotSequenceEntries: input.slotSequenceEntries,
          weeklyObligationPlan: input.weeklyObligationPlan,
        });
        if (!candidate) {
          continue;
        }
        slots = candidate;
        input.appliedDiagnostics.push({
          priority: "P2",
          constraint: "per_exercise_efficiency",
          penalty: 0,
          slotId: slot.slotPlan.slotId,
          exerciseId: donor.exercise.id,
          name: donor.exercise.name,
          muscle: donorMuscles[0],
          reason: "trimmed_one_main_set_above_soft_cap",
          details: {
            fromSetCount: donor.sets.length,
            toSetCount: donor.sets.length - 1,
          },
        });
        applied = true;
        break;
      }
      const candidate = tryReplaceSlotWorkout({
        slots,
        slotIndex,
        workout: moveOneSet({
          workout: slot.workout,
          donor,
          receiver: receiver.candidate,
        }),
        slotSequenceEntries: input.slotSequenceEntries,
        weeklyObligationPlan: input.weeklyObligationPlan,
      });
      if (!candidate) {
        continue;
      }
      slots = candidate;
      input.appliedDiagnostics.push({
        priority: "P2",
        constraint: "per_exercise_efficiency",
        penalty: 0,
        slotId: slot.slotPlan.slotId,
        exerciseId: donor.exercise.id,
        name: donor.exercise.name,
        muscle: receiver.muscle,
        reason: "moved_one_set_to_existing_alternative",
        details: {
          fromSetCount: donor.sets.length,
          toExerciseId: receiver.candidate.exercise.id,
          toSetCount: receiver.candidate.sets.length + 1,
        },
      });
      applied = true;
      break;
    }
    if (!applied) {
      break;
    }
  }
  return slots;
}

function applyStimulusSpread(input: {
  slots: ReadonlyArray<ProjectedSlotWorkout>;
  slotSequenceEntries: SlotSequenceEntries;
  weeklyObligationPlan: WeeklyMuscleObligationPlan;
  appliedDiagnostics: ProgramQualityDiagnostic[];
}): ProjectedSlotWorkout[] {
  let slots = [...input.slots];
  for (let pass = 0; pass < 16; pass += 1) {
    const diversityDiagnostic = evaluateStimulusDiversity(slots).find(
      (diagnostic) =>
        diagnostic.constraint === "single_exercise_volume_share" ||
        diagnostic.constraint === "stimulus_diversity"
    );
    if (!diversityDiagnostic?.muscle) {
      break;
    }
    const rows = getExerciseContributionRows(slots).filter(
      (row) => row.muscle === diversityDiagnostic.muscle
    );
    const donor = rows
      .filter((row) =>
        diversityDiagnostic.exerciseId
          ? row.exercise.exercise.id === diversityDiagnostic.exerciseId
          : row.broadPattern === diversityDiagnostic.pattern
      )
      .filter((row) => row.exercise.sets.length > getMinimumSetCount(row.exercise))
      .sort((left, right) => right.effectiveSets - left.effectiveSets)[0];
    if (!donor) {
      break;
    }
    const slotIndex = slots.findIndex((slot) => slot.slotPlan.slotId === donor.slotId);
    const slot = slots[slotIndex];
    if (!slot) {
      break;
    }
    const receiver = findSetSpreadReceiver({
      workout: slot.workout,
      donor: donor.exercise,
      muscle: donor.muscle,
      requireDifferentPattern: diversityDiagnostic.constraint === "stimulus_diversity",
    });
    if (!receiver) {
      break;
    }
    const candidate = tryReplaceSlotWorkout({
      slots,
      slotIndex,
      workout: moveOneSet({
        workout: slot.workout,
        donor: donor.exercise,
        receiver,
      }),
      slotSequenceEntries: input.slotSequenceEntries,
      weeklyObligationPlan: input.weeklyObligationPlan,
    });
    if (!candidate) {
      break;
    }
    slots = candidate;
    input.appliedDiagnostics.push({
      priority: "P3",
      constraint: diversityDiagnostic.constraint,
      penalty: 0,
      slotId: slot.slotPlan.slotId,
      exerciseId: donor.exercise.exercise.id,
      name: donor.exercise.exercise.name,
      muscle: donor.muscle,
      reason: "moved_one_set_for_stimulus_spread",
      details: {
        toExerciseId: receiver.exercise.id,
      },
    });
  }
  return slots;
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
    if (!targetSlot) {
      continue;
    }
    const requestedEffectiveSets = threshold - currentTotal;
    const workout = appendAccessory(
      targetSlot.slot.workout,
      buildSupportAccessoryExercise({
        exercise,
        template: targetSlot.slot.workout.accessories.at(-1),
        orderIndex:
          targetSlot.slot.workout.mainLifts.length + targetSlot.slot.workout.accessories.length,
        muscle,
        practicalFloor: threshold,
        requestedEffectiveSets,
      })
    );
    const candidate = tryReplaceSlotWorkout({
      slots,
      slotIndex: targetSlot.index,
      workout,
      slotSequenceEntries: input.slotSequenceEntries,
      weeklyObligationPlan: input.weeklyObligationPlan,
    });
    if (!candidate) {
      continue;
    }
    slots = candidate;
    selectedExerciseIds.add(exercise.id);
    input.appliedDiagnostics.push({
      priority: "P5",
      constraint: "isolation_completeness",
      penalty: 0,
      slotId: targetSlot.slot.slotPlan.slotId,
      exerciseId: exercise.id,
      name: exercise.name,
      muscle,
      reason: "injected_direct_isolation_for_deficit",
      details: {
        projectedEffectiveSets: roundToTenth(currentTotal),
        threshold,
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
  });
  projectedSlots = applyStimulusSpread({
    slots: projectedSlots,
    slotSequenceEntries: input.slotSequenceEntries,
    weeklyObligationPlan: input.weeklyObligationPlan,
    appliedDiagnostics,
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
    penalty: diagnostic.role === "main" ? 0.5 : diagnostic.hasCompatibleAlternative ? 3 : 0.5,
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
