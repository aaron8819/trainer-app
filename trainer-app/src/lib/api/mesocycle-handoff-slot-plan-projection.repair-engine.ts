import type { WorkoutSessionIntent } from "@prisma/client";
import type { WorkoutExercise, WorkoutPlan, WorkoutSet } from "@/lib/engine/types";
import { VOLUME_LANDMARKS } from "@/lib/engine/volume-landmarks";
import { getEffectiveStimulusByMuscle } from "@/lib/engine/stimulus";
import {
  getProjectionRepairCompatibleMuscles,
  getProtectedWeekOneCoverageObligations,
  resolveSessionSlotPolicy,
  type ProtectedWeekOneCoverageMuscle,
} from "@/lib/planning/session-slot-profile";
import { SESSION_CAPS } from "./template-session/selection-adapter";
import type { MappedGenerationContext } from "./template-session/types";
import type { MesocycleSlotSequence } from "./mesocycle-slot-contract";
import { mapProjectedWorkoutToSlotPlan } from "./mesocycle-handoff-slot-plan-projection.seed-serialization";
import {
  addSupportFloorRepairReason,
  buildSlotSequenceEntries,
  computeProjectedWeeklyContributionByMuscle,
  computeProjectedWeeklyContributionWithWorkout,
  computeWorkoutContributionByMuscle,
  countWorkoutExercises,
  evaluateProtectedWeekOneCoverage,
  evaluateUpperProtectedSupportQuality,
  exerciseHasAnyPrimaryMuscle,
  exerciseHasPrimaryMuscle,
  exerciseMatchesMovementPattern,
  getRequiredMovementPatternCount,
  getWorkoutExercises,
  MAX_PROJECTED_SUPPORT_FLOOR_SET_BUMP,
  normalizeMuscleName,
  preservesSlotIdentity,
  PRIMARY_WEEK_ONE_SUPPORT_FLOOR_MUSCLES,
  ProjectedSlotWorkout,
  sortSupportFloorDeficits,
  SUPPORT_FLOOR_EPSILON,
  SupportFloorRepairReason,
  toSessionIntent,
  WEEK_ONE_SUPPORT_FLOOR_REPAIR_PRIORITY,
} from "./mesocycle-handoff-slot-plan-projection.coverage-evaluation";

function selectSupportIsolation(input: {
  exerciseLibrary: MappedGenerationContext["exerciseLibrary"];
  selectedExerciseIds: Set<string>;
  muscle: string;
}): WorkoutExercise["exercise"] | undefined {
  return input.exerciseLibrary
    .filter((exercise) => !input.selectedExerciseIds.has(exercise.id))
    .filter((exercise) => !(exercise.isCompound ?? false))
    .filter((exercise) => !(exercise.isMainLiftEligible ?? false))
    .filter((exercise) => (exercise.primaryMuscles ?? []).includes(input.muscle))
    .sort((left, right) => {
      const fatigueDelta = (left.fatigueCost ?? 3) - (right.fatigueCost ?? 3);
      if (fatigueDelta !== 0) {
        return fatigueDelta;
      }
      return left.name.localeCompare(right.name);
    })[0];
}

const MAX_PROJECTED_ACCESSORY_SETS_PER_EXERCISE = 4;
const MAX_PROJECTED_MAIN_LIFT_SETS_PER_EXERCISE = 5;
const MAX_PROJECTED_EXERCISE_MUSCLE_CONTRIBUTION_RATIO = 0.5;

function getMaxProjectedSetCount(exercise: Pick<WorkoutExercise, "isMainLift" | "role">): number {
  return exercise.isMainLift || exercise.role === "main"
    ? MAX_PROJECTED_MAIN_LIFT_SETS_PER_EXERCISE
    : MAX_PROJECTED_ACCESSORY_SETS_PER_EXERCISE;
}

function getDistributionAwareSupportSetCount(input: {
  exercise: WorkoutExercise["exercise"];
  defaultSetCount: number;
  muscle?: ProtectedWeekOneCoverageMuscle;
  practicalFloor?: number;
  requestedEffectiveSets?: number;
}): number {
  let maxSetCount = MAX_PROJECTED_ACCESSORY_SETS_PER_EXERCISE;
  const effectivePerSet = input.muscle
    ? (getEffectiveStimulusByMuscle(input.exercise, 1).get(input.muscle) ?? 0)
    : 0;

  if (effectivePerSet > 0 && input.practicalFloor != null) {
    maxSetCount = Math.min(
      maxSetCount,
      Math.floor(
        (input.practicalFloor * MAX_PROJECTED_EXERCISE_MUSCLE_CONTRIBUTION_RATIO +
          SUPPORT_FLOOR_EPSILON) /
          effectivePerSet
      )
    );
  }

  if (effectivePerSet > 0 && input.requestedEffectiveSets != null) {
    maxSetCount = Math.min(
      maxSetCount,
      Math.ceil(input.requestedEffectiveSets / effectivePerSet - SUPPORT_FLOOR_EPSILON)
    );
  }

  return Math.max(1, Math.min(input.defaultSetCount, maxSetCount));
}

export function buildSupportAccessoryExercise(input: {
  exercise: WorkoutExercise["exercise"];
  template: WorkoutExercise | undefined;
  orderIndex: number;
  muscle?: ProtectedWeekOneCoverageMuscle;
  practicalFloor?: number;
  requestedEffectiveSets?: number;
}): WorkoutExercise {
  const templateSets = input.template?.sets ?? [];
  const baseSets = templateSets.length > 0 ? templateSets : Array.from({ length: 4 }, (_, index) => ({
    setIndex: index + 1,
    targetReps: 12,
    role: "accessory" as const,
  }));
  const setCount = getDistributionAwareSupportSetCount({
    exercise: input.exercise,
    defaultSetCount: baseSets.length,
    muscle: input.muscle,
    practicalFloor: input.practicalFloor,
    requestedEffectiveSets: input.requestedEffectiveSets,
  });
  const sets = baseSets.slice(0, setCount).map((set, index) => ({
    ...set,
    setIndex: index + 1,
    role: "accessory" as const,
  }));

  return {
    id: `${input.exercise.id}:projection-support`,
    exercise: input.exercise,
    orderIndex: input.orderIndex,
    isMainLift: false,
    role: "accessory",
    sets,
  };
}

function removeAccessory(workout: WorkoutPlan, exerciseId: string): WorkoutPlan {
  return {
    ...workout,
    accessories: workout.accessories
      .filter((exercise) => exercise.exercise.id !== exerciseId)
      .map((exercise, index) => ({ ...exercise, orderIndex: workout.mainLifts.length + index })),
  };
}

export function appendAccessory(workout: WorkoutPlan, exercise: WorkoutExercise): WorkoutPlan {
  return {
    ...workout,
    accessories: [...workout.accessories, exercise].map((entry, index) => ({
      ...entry,
      orderIndex: workout.mainLifts.length + index,
    })),
  };
}

function buildProjectionSetFromTemplate(
  template: WorkoutSet | undefined,
  setIndex: number,
  role: WorkoutExercise["role"]
): WorkoutSet {
  return {
    ...(template ?? {
      targetReps: 12,
    }),
    setIndex,
    role: role ?? "accessory",
  };
}

function withAdditionalAccessorySets(
  exercise: WorkoutExercise,
  additionalSets: number
): WorkoutExercise {
  if (additionalSets <= 0) {
    return exercise;
  }

  const sets = [...exercise.sets];
  for (let index = 0; index < additionalSets; index += 1) {
    sets.push(
      buildProjectionSetFromTemplate(
        sets.at(-1),
        sets.length + 1,
        exercise.role ?? "accessory"
      )
    );
  }

  return {
    ...exercise,
    sets,
  };
}

function withOneFewerSet(exercise: WorkoutExercise): WorkoutExercise {
  return {
    ...exercise,
    sets: exercise.sets.slice(0, -1).map((set, index) => ({
      ...set,
      setIndex: index + 1,
    })),
  };
}

function replaceWorkoutExercise(
  workout: WorkoutPlan,
  replacement: WorkoutExercise
): WorkoutPlan {
  return {
    ...workout,
    mainLifts: workout.mainLifts.map((exercise) =>
      exercise.exercise.id === replacement.exercise.id ? replacement : exercise
    ),
    accessories: workout.accessories.map((exercise) =>
      exercise.exercise.id === replacement.exercise.id ? replacement : exercise
    ),
  };
}

function getEffectiveContributionPerSet(
  exercise: WorkoutExercise,
  muscle: ProtectedWeekOneCoverageMuscle
): number {
  return getEffectiveStimulusByMuscle(exercise.exercise, 1).get(muscle) ?? 0;
}

function getMaxPracticalSetBump(exercise: WorkoutExercise, requestedSetBump: number): number {
  return Math.max(
    0,
    Math.min(
      requestedSetBump,
      getMaxProjectedSetCount(exercise) - exercise.sets.length
    )
  );
}

function getMaxContributionSetBump(input: {
  exercise: WorkoutExercise;
  muscle: ProtectedWeekOneCoverageMuscle;
  practicalFloor: number;
  requestedSetBump: number;
}): number {
  const effectivePerSet = getEffectiveContributionPerSet(input.exercise, input.muscle);
  if (effectivePerSet <= 0) {
    return 0;
  }

  const currentContribution = effectivePerSet * input.exercise.sets.length;
  const maxContribution =
    input.practicalFloor * MAX_PROJECTED_EXERCISE_MUSCLE_CONTRIBUTION_RATIO;
  return Math.max(
    0,
    Math.min(
      input.requestedSetBump,
      Math.floor(
        (maxContribution - currentContribution + SUPPORT_FLOOR_EPSILON) / effectivePerSet
      )
    )
  );
}

function getMaxMavSafeSetBump(input: {
  exercise: WorkoutExercise;
  projectedTotals: ReadonlyMap<string, number>;
  requestedSetBump: number;
}): number {
  let maxSetBump = input.requestedSetBump;
  for (const [muscle, effectiveSetsPerSet] of getEffectiveStimulusByMuscle(
    input.exercise.exercise,
    1
  )) {
    if (effectiveSetsPerSet <= 0) {
      continue;
    }
    const mav = VOLUME_LANDMARKS[muscle]?.mav;
    if (mav == null) {
      continue;
    }
    const remainingToMav = mav - (input.projectedTotals.get(muscle) ?? 0);
    maxSetBump = Math.min(
      maxSetBump,
      Math.floor((remainingToMav + SUPPORT_FLOOR_EPSILON) / effectiveSetsPerSet)
    );
  }
  return Math.max(0, maxSetBump);
}

function findExistingSupportExercise(input: {
  workout: WorkoutPlan;
  muscle: ProtectedWeekOneCoverageMuscle;
  includeMainLifts?: boolean;
}): WorkoutExercise | undefined {
  const exercises =
    input.includeMainLifts === true
      ? [...input.workout.accessories, ...input.workout.mainLifts]
      : [...input.workout.accessories];
  return exercises
    .filter((exercise) => getEffectiveContributionPerSet(exercise, input.muscle) > 0)
    .sort((left, right) => {
      const leftAccessory = left.role === "accessory" || !left.isMainLift ? 1 : 0;
      const rightAccessory = right.role === "accessory" || !right.isMainLift ? 1 : 0;
      if (leftAccessory !== rightAccessory) {
        return rightAccessory - leftAccessory;
      }
      const leftPrimary = exerciseHasPrimaryMuscle(left.exercise, input.muscle) ? 1 : 0;
      const rightPrimary = exerciseHasPrimaryMuscle(right.exercise, input.muscle) ? 1 : 0;
      if (leftPrimary !== rightPrimary) {
        return rightPrimary - leftPrimary;
      }
      const contributionDelta =
        getEffectiveContributionPerSet(right, input.muscle) -
        getEffectiveContributionPerSet(left, input.muscle);
      if (Math.abs(contributionDelta) > SUPPORT_FLOOR_EPSILON) {
        return contributionDelta;
      }
      return left.exercise.name.localeCompare(right.exercise.name);
    })[0];
}

function accessoryTargetsProtectedMuscle(
  exercise: WorkoutExercise,
  protectedMuscles: ReadonlySet<string>
): boolean {
  return (exercise.exercise.primaryMuscles ?? []).some((muscle) =>
    protectedMuscles.has(normalizeMuscleName(muscle))
  );
}

function getProtectedPrimaryMuscles(
  exercise: WorkoutExercise,
  protectedMuscles: ReadonlySet<string>
): string[] {
  return (exercise.exercise.primaryMuscles ?? [])
    .map(normalizeMuscleName)
    .filter((muscle) => protectedMuscles.has(muscle));
}

function getSupportFloorRepairPriority(muscle: string): number {
  const normalized = normalizeMuscleName(muscle);
  const index = WEEK_ONE_SUPPORT_FLOOR_REPAIR_PRIORITY.findIndex(
    (entry) => normalizeMuscleName(entry) === normalized
  );
  return index >= 0 ? index : WEEK_ONE_SUPPORT_FLOOR_REPAIR_PRIORITY.length;
}

function canReplaceForHigherPrioritySupport(input: {
  requestedMuscle: ProtectedWeekOneCoverageMuscle;
  accessory: WorkoutExercise;
  protectedMuscleSet: ReadonlySet<string>;
}): boolean {
  const requestedPriority = getSupportFloorRepairPriority(input.requestedMuscle);
  const protectedPrimaries = getProtectedPrimaryMuscles(
    input.accessory,
    input.protectedMuscleSet
  );
  return (
    protectedPrimaries.length > 0 &&
    protectedPrimaries.every(
      (protectedMuscle) => getSupportFloorRepairPriority(protectedMuscle) > requestedPriority
    )
  );
}

function appendOrReplaceSupportAccessory(input: {
  workout: WorkoutPlan;
  slotPolicy: ReturnType<typeof resolveSessionSlotPolicy>["currentSession"];
  exerciseLibrary: MappedGenerationContext["exerciseLibrary"];
  selectedExerciseIds: Set<string>;
  muscle: ProtectedWeekOneCoverageMuscle;
  protectedMuscles: readonly ProtectedWeekOneCoverageMuscle[];
  allowLowerPriorityProtectedReplacement?: boolean;
  practicalFloor?: number;
  requestedEffectiveSets?: number;
}): WorkoutPlan {
  const supportExercise = selectSupportIsolation({
    exerciseLibrary: input.exerciseLibrary,
    selectedExerciseIds: input.selectedExerciseIds,
    muscle: input.muscle,
  });
  if (!supportExercise) {
    return input.workout;
  }

  const buildAccessory = (workout: WorkoutPlan, template?: WorkoutExercise) =>
    buildSupportAccessoryExercise({
      exercise: supportExercise,
      template: template ?? workout.accessories.at(-1),
      orderIndex: workout.mainLifts.length + workout.accessories.length,
      muscle: input.muscle,
      practicalFloor: input.practicalFloor,
      requestedEffectiveSets: input.requestedEffectiveSets,
    });

  if (countWorkoutExercises(input.workout) < SESSION_CAPS.maxExercises) {
    const candidateWorkout = appendAccessory(input.workout, buildAccessory(input.workout));
    return preservesSlotIdentity({ slotPolicy: input.slotPolicy, workout: candidateWorkout }) ||
      !preservesSlotIdentity({ slotPolicy: input.slotPolicy, workout: input.workout })
      ? candidateWorkout
      : input.workout;
  }

  const protectedMuscleSet = new Set(input.protectedMuscles.map(normalizeMuscleName));
  for (const accessory of input.workout.accessories) {
    if (
      accessoryTargetsProtectedMuscle(accessory, protectedMuscleSet) &&
      !(
        input.allowLowerPriorityProtectedReplacement === true &&
        canReplaceForHigherPrioritySupport({
          requestedMuscle: input.muscle,
          accessory,
          protectedMuscleSet,
        })
      )
    ) {
      continue;
    }
    const workoutWithoutAccessory = removeAccessory(input.workout, accessory.exercise.id);
    const candidateWorkout = appendAccessory(
      workoutWithoutAccessory,
      buildAccessory(workoutWithoutAccessory, accessory)
    );
    if (preservesSlotIdentity({ slotPolicy: input.slotPolicy, workout: candidateWorkout })) {
      return candidateWorkout;
    }
  }
  const requestedMuscle = normalizeMuscleName(input.muscle);
  for (const accessory of input.workout.accessories) {
    const accessoryProtectedPrimaries = getProtectedPrimaryMuscles(accessory, protectedMuscleSet);
    if (
      accessoryProtectedPrimaries.length === 0 ||
      accessoryProtectedPrimaries.includes(requestedMuscle)
    ) {
      continue;
    }
    const hasDuplicateProtectedPrimary = accessoryProtectedPrimaries.some((protectedMuscle) =>
      getWorkoutExercises(input.workout).some(
        (other) =>
          other.exercise.id !== accessory.exercise.id &&
          getProtectedPrimaryMuscles(other, protectedMuscleSet).includes(protectedMuscle)
      )
    );
    if (!hasDuplicateProtectedPrimary) {
      continue;
    }

    const workoutWithoutAccessory = removeAccessory(input.workout, accessory.exercise.id);
    const candidateWorkout = appendAccessory(
      workoutWithoutAccessory,
      buildAccessory(workoutWithoutAccessory, accessory)
    );
    if (preservesSlotIdentity({ slotPolicy: input.slotPolicy, workout: candidateWorkout })) {
      return candidateWorkout;
    }
  }

  return input.workout;
}

export function rebalanceUpperSupportProjection(input: {
  workout: WorkoutPlan;
  slotPolicy: ReturnType<typeof resolveSessionSlotPolicy>["currentSession"];
  exerciseLibrary: MappedGenerationContext["exerciseLibrary"];
  protectedMuscles: readonly ProtectedWeekOneCoverageMuscle[];
}): WorkoutPlan {
  if (input.slotPolicy?.sessionIntent !== "upper") {
    return input.workout;
  }

  const protectedMuscles =
    input.protectedMuscles.length > 0
      ? input.protectedMuscles
      : getProtectedWeekOneCoverageObligations(input.slotPolicy);
  const initialQuality = evaluateUpperProtectedSupportQuality({
    slotPolicy: input.slotPolicy,
    contributionByMuscle: computeWorkoutContributionByMuscle(input.workout),
    protectedMuscles,
  });
  if (!initialQuality.isRelevant || initialQuality.satisfied) {
    return input.workout;
  }

  const selectedExerciseIds = new Set(
    [...input.workout.mainLifts, ...input.workout.accessories].map(
      (exercise) => exercise.exercise.id
    )
  );

  let workout = input.workout;
  const missingPrimarySupportMuscles = protectedMuscles.filter(
    (muscle) =>
      PRIMARY_WEEK_ONE_SUPPORT_FLOOR_MUSCLES.has(muscle) &&
      !getWorkoutExercises(workout).some((exercise) =>
        exerciseHasPrimaryMuscle(exercise.exercise, muscle)
      )
  );
  const repairMuscles = Array.from(
    new Set([...initialQuality.missingMuscles, ...missingPrimarySupportMuscles])
  );
  for (const muscle of repairMuscles) {
    workout = appendOrReplaceSupportAccessory({
      workout,
      slotPolicy: input.slotPolicy,
      exerciseLibrary: input.exerciseLibrary,
      selectedExerciseIds,
      muscle,
      protectedMuscles,
      allowLowerPriorityProtectedReplacement:
        muscle !== "Chest" && getSupportFloorRepairPriority(muscle) < WEEK_ONE_SUPPORT_FLOOR_REPAIR_PRIORITY.length,
    });
    for (const exercise of [...workout.mainLifts, ...workout.accessories]) {
      selectedExerciseIds.add(exercise.exercise.id);
    }
  }

  return workout;
}

export function applyExistingAccessorySupportFloorBumps(input: {
  workout: WorkoutPlan;
  slotPolicy: ReturnType<typeof resolveSessionSlotPolicy>["currentSession"];
  exerciseLibrary: MappedGenerationContext["exerciseLibrary"];
  projectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
  activeMesocycle: NonNullable<MappedGenerationContext["activeMesocycle"]>;
  slotSequence: ReadonlyArray<{
    slotId: string;
    intent: WorkoutSessionIntent;
    authoredSemantics?: MesocycleSlotSequence["slots"][number]["authoredSemantics"];
  }>;
}): {
  workout: WorkoutPlan;
  reasons: Partial<Record<ProtectedWeekOneCoverageMuscle, SupportFloorRepairReason[]>>;
} {
  const reasons: Partial<Record<ProtectedWeekOneCoverageMuscle, SupportFloorRepairReason[]>> = {};
  let workout = input.workout;

  for (let pass = 0; pass < 2; pass += 1) {
    const evaluation = evaluateProtectedWeekOneCoverage({
      projectedSlots: [
        ...input.projectedSlots,
        {
          slotPlan: mapProjectedWorkoutToSlotPlan({
            slotId: input.slotPolicy?.slotId ?? "projection-current-slot",
            intent: (input.slotPolicy?.sessionIntent?.toUpperCase() ??
              "UPPER") as WorkoutSessionIntent,
            workout,
          }),
          workout,
          projectedContributionByMuscle: computeWorkoutContributionByMuscle(workout),
          repairMuscles: [],
        },
      ],
      activeMesocycle: input.activeMesocycle,
      slotSequence: input.slotSequence,
    });
    const repairRows = sortSupportFloorDeficits(
      evaluation.deficitsBelowPracticalFloor.filter((row) =>
        getProjectionRepairCompatibleMuscles(input.slotPolicy, [row.muscle]).includes(row.muscle)
      )
    );

    if (repairRows.length === 0) {
      break;
    }

    let appliedAnyBump = false;
    for (const row of repairRows) {
      const selectedExerciseIds = new Set(
        [
          ...input.projectedSlots.flatMap((slot) =>
            getWorkoutExercises(slot.workout).map((exercise) => exercise.exercise.id)
          ),
          ...getWorkoutExercises(workout).map((exercise) => exercise.exercise.id),
        ]
      );
      const repairedWorkout = appendOrReplaceSupportAccessory({
        workout,
        slotPolicy: input.slotPolicy,
        exerciseLibrary: input.exerciseLibrary,
        selectedExerciseIds,
        muscle: row.muscle,
        protectedMuscles: getProtectedWeekOneCoverageObligations(input.slotPolicy),
        practicalFloor: row.practicalFloor,
        requestedEffectiveSets: row.deficitToPracticalFloor,
        allowLowerPriorityProtectedReplacement:
          row.muscle !== "Chest" &&
          getSupportFloorRepairPriority(row.muscle) <
            WEEK_ONE_SUPPORT_FLOOR_REPAIR_PRIORITY.length,
      });
      if (repairedWorkout !== workout) {
        workout = repairedWorkout;
        addSupportFloorRepairReason(reasons, row.muscle, "support_accessory_replacement");
        appliedAnyBump = true;
        continue;
      }

      const existingAccessory = findExistingSupportExercise({
        workout,
        muscle: row.muscle,
        includeMainLifts: row.muscle === "Chest" || row.muscle === "Hamstrings",
      });
      if (!existingAccessory) {
        const supportExercise = selectSupportIsolation({
          exerciseLibrary: input.exerciseLibrary,
          selectedExerciseIds,
          muscle: row.muscle,
        });
        addSupportFloorRepairReason(
          reasons,
          row.muscle,
          supportExercise
            ? countWorkoutExercises(workout) >= SESSION_CAPS.maxExercises
              ? "exercise_cap_blocked"
              : "slot_identity_blocked"
            : "no_compatible_exercise"
        );
        continue;
      }

      const effectivePerSet = getEffectiveContributionPerSet(existingAccessory, row.muscle);
      if (effectivePerSet <= 0) {
        addSupportFloorRepairReason(reasons, row.muscle, "effective_weight_shortfall");
        continue;
      }

      const projectedTotals = computeProjectedWeeklyContributionWithWorkout({
        projectedSlots: input.projectedSlots,
        workout,
      });
      const requestedSetBump = Math.min(
        MAX_PROJECTED_SUPPORT_FLOOR_SET_BUMP,
        Math.ceil(row.deficitToPracticalFloor / effectivePerSet - SUPPORT_FLOOR_EPSILON)
      );
      const practicalSetBump = getMaxContributionSetBump({
        exercise: existingAccessory,
        muscle: row.muscle,
        practicalFloor: row.practicalFloor,
        requestedSetBump: getMaxPracticalSetBump(existingAccessory, requestedSetBump),
      });
      if (practicalSetBump <= 0) {
        addSupportFloorRepairReason(reasons, row.muscle, "capacity_blocked");
        continue;
      }
      const safeSetBump = getMaxMavSafeSetBump({
        exercise: existingAccessory,
        projectedTotals,
        requestedSetBump: practicalSetBump,
      });

      if (safeSetBump <= 0) {
        addSupportFloorRepairReason(reasons, row.muscle, "capacity_blocked");
        continue;
      }

      workout = replaceWorkoutExercise(
        workout,
        withAdditionalAccessorySets(existingAccessory, safeSetBump)
      );
      addSupportFloorRepairReason(reasons, row.muscle, "existing_accessory_set_bump");
      if (safeSetBump < requestedSetBump) {
        addSupportFloorRepairReason(reasons, row.muscle, "effective_weight_shortfall");
      }
      appliedAnyBump = true;
    }

    if (!appliedAnyBump) {
      break;
    }
  }

  return { workout, reasons };
}

export function updateProjectedSlotWorkout(
  projectedSlot: ProjectedSlotWorkout,
  workout: WorkoutPlan
): ProjectedSlotWorkout {
  return {
    ...projectedSlot,
    workout,
    slotPlan: mapProjectedWorkoutToSlotPlan({
      slotId: projectedSlot.slotPlan.slotId,
      intent: projectedSlot.slotPlan.intent,
      workout,
    }),
    projectedContributionByMuscle: computeWorkoutContributionByMuscle(workout),
  };
}

function getMinimumProjectedSetCount(exercise: WorkoutExercise): number {
  return exercise.isMainLift || exercise.role === "main" ? 2 : 1;
}

function getOverMavMuscles(projectedSlots: ReadonlyArray<ProjectedSlotWorkout>): string[] {
  const projectedTotals = computeProjectedWeeklyContributionByMuscle({
    projectedSlots,
    currentSlotContribution: new Map(),
  });

  return Array.from(projectedTotals.entries())
    .filter(([muscle, effectiveSets]) => {
      const mav = VOLUME_LANDMARKS[muscle]?.mav;
      return mav != null && effectiveSets > mav + SUPPORT_FLOOR_EPSILON;
    })
    .map(([muscle]) => muscle);
}

function preservesProtectedMev(input: {
  projectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
  activeMesocycle: NonNullable<MappedGenerationContext["activeMesocycle"]>;
  slotSequence: ReadonlyArray<{
    slotId: string;
    intent: WorkoutSessionIntent;
    authoredSemantics?: MesocycleSlotSequence["slots"][number]["authoredSemantics"];
  }>;
}): boolean {
  return (
    evaluateProtectedWeekOneCoverage({
      projectedSlots: input.projectedSlots,
      activeMesocycle: input.activeMesocycle,
      slotSequence: input.slotSequence,
    }).deficitsBelowMev.length === 0
  );
}

export function applyFinalMavTrim(input: {
  projectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
  activeMesocycle: NonNullable<MappedGenerationContext["activeMesocycle"]>;
  slotSequence: ReadonlyArray<{
    slotId: string;
    intent: WorkoutSessionIntent;
    authoredSemantics?: MesocycleSlotSequence["slots"][number]["authoredSemantics"];
  }>;
  slotSequenceEntries: ReturnType<typeof buildSlotSequenceEntries>;
}): ProjectedSlotWorkout[] {
  let projectedSlots = [...input.projectedSlots];

  for (let pass = 0; pass < 24; pass += 1) {
    const overMavMuscles = getOverMavMuscles(projectedSlots);
    if (overMavMuscles.length === 0) {
      break;
    }
    const overMavSet = new Set(overMavMuscles);
    const candidates = projectedSlots
      .flatMap((projectedSlot, slotIndex) => {
        const slotPolicy = resolveSessionSlotPolicy({
          sessionIntent: toSessionIntent(projectedSlot.slotPlan.intent),
          slotId: projectedSlot.slotPlan.slotId,
          slotSequence: {
            slots: input.slotSequenceEntries,
          },
        }).currentSession;

        return getWorkoutExercises(projectedSlot.workout)
          .filter((exercise) => exercise.sets.length > getMinimumProjectedSetCount(exercise))
          .map((exercise) => {
            const overMavContributionPerSet = Array.from(
              getEffectiveStimulusByMuscle(exercise.exercise, 1).entries()
            )
              .filter(([muscle]) => overMavSet.has(muscle))
              .reduce((sum, [, effectiveSets]) => sum + effectiveSets, 0);
            return {
              projectedSlot,
              slotIndex,
              slotPolicy,
              exercise,
              overMavContributionPerSet,
            };
          })
          .filter((candidate) => candidate.overMavContributionPerSet > 0);
      })
      .sort((left, right) => {
        if (right.overMavContributionPerSet !== left.overMavContributionPerSet) {
          return right.overMavContributionPerSet - left.overMavContributionPerSet;
        }
        const leftMain = left.exercise.isMainLift || left.exercise.role === "main" ? 1 : 0;
        const rightMain = right.exercise.isMainLift || right.exercise.role === "main" ? 1 : 0;
        if (leftMain !== rightMain) {
          return leftMain - rightMain;
        }
        return right.exercise.sets.length - left.exercise.sets.length;
      });

    let appliedTrim = false;
    for (const candidate of candidates) {
      const trimmedWorkout = replaceWorkoutExercise(
        candidate.projectedSlot.workout,
        withOneFewerSet(candidate.exercise)
      );
      if (
        preservesSlotIdentity({
          slotPolicy: candidate.slotPolicy,
          workout: candidate.projectedSlot.workout,
        }) &&
        !preservesSlotIdentity({ slotPolicy: candidate.slotPolicy, workout: trimmedWorkout })
      ) {
        continue;
      }

      const candidateProjectedSlots = projectedSlots.map((projectedSlot, index) =>
        index === candidate.slotIndex
          ? updateProjectedSlotWorkout(projectedSlot, trimmedWorkout)
          : projectedSlot
      );
      if (
        !preservesProtectedMev({
          projectedSlots: candidateProjectedSlots,
          activeMesocycle: input.activeMesocycle,
          slotSequence: input.slotSequence,
        })
      ) {
        continue;
      }

      projectedSlots = candidateProjectedSlots;
      appliedTrim = true;
      break;
    }

    if (!appliedTrim) {
      break;
    }
  }

  return projectedSlots;
}

function getFinalRepairSlotPreference(input: {
  muscle: ProtectedWeekOneCoverageMuscle;
  slot: ProjectedSlotWorkout;
}): number {
  if (input.muscle === "Side Delts" && input.slot.slotPlan.slotId === "upper_b") {
    return 0;
  }
  if (input.muscle === "Calves" && input.slot.slotPlan.intent === "LOWER") {
    return 0;
  }
  return 1;
}

export function applyFinalSupportFloorClosure(input: {
  projectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
  activeMesocycle: NonNullable<MappedGenerationContext["activeMesocycle"]>;
  slotSequence: ReadonlyArray<{
    slotId: string;
    intent: WorkoutSessionIntent;
    authoredSemantics?: MesocycleSlotSequence["slots"][number]["authoredSemantics"];
  }>;
  slotSequenceEntries: ReturnType<typeof buildSlotSequenceEntries>;
}): {
  projectedSlots: ProjectedSlotWorkout[];
  reasons: Partial<Record<ProtectedWeekOneCoverageMuscle, SupportFloorRepairReason[]>>;
} {
  const reasons: Partial<Record<ProtectedWeekOneCoverageMuscle, SupportFloorRepairReason[]>> = {};
  let projectedSlots = [...input.projectedSlots];

  for (let pass = 0; pass < 2; pass += 1) {
    const evaluation = evaluateProtectedWeekOneCoverage({
      projectedSlots,
      activeMesocycle: input.activeMesocycle,
      slotSequence: input.slotSequence,
    });
    const repairRows = sortSupportFloorDeficits(evaluation.deficitsBelowPracticalFloor);
    if (repairRows.length === 0) {
      break;
    }

    let appliedAnyBump = false;
    for (const row of repairRows) {
      const candidates = projectedSlots
        .map((projectedSlot, index) => {
          const slotPolicy = resolveSessionSlotPolicy({
            sessionIntent: toSessionIntent(projectedSlot.slotPlan.intent),
            slotId: projectedSlot.slotPlan.slotId,
            slotSequence: {
              slots: input.slotSequenceEntries,
            },
          }).currentSession;
          const compatible = getProjectionRepairCompatibleMuscles(slotPolicy, [
            row.muscle,
          ]).includes(row.muscle);
          const accessory = compatible
            ? findExistingSupportExercise({
                workout: projectedSlot.workout,
                muscle: row.muscle,
                includeMainLifts: row.muscle === "Hamstrings",
              })
            : undefined;
          return { projectedSlot, index, slotPolicy, accessory, compatible };
        })
        .filter(
          (candidate): candidate is {
            projectedSlot: ProjectedSlotWorkout;
            index: number;
            slotPolicy: ReturnType<typeof resolveSessionSlotPolicy>["currentSession"];
            accessory: WorkoutExercise;
            compatible: true;
          } => Boolean(candidate.compatible && candidate.accessory)
        )
        .sort((left, right) => {
          const preferenceDelta =
            getFinalRepairSlotPreference({ muscle: row.muscle, slot: left.projectedSlot }) -
            getFinalRepairSlotPreference({ muscle: row.muscle, slot: right.projectedSlot });
          if (preferenceDelta !== 0) {
            return preferenceDelta;
          }
          return left.index - right.index;
        });

      const candidate = candidates[0];
      if (!candidate) {
        addSupportFloorRepairReason(reasons, row.muscle, "no_compatible_exercise");
        continue;
      }

      const effectivePerSet = getEffectiveContributionPerSet(candidate.accessory, row.muscle);
      if (effectivePerSet <= 0) {
        addSupportFloorRepairReason(reasons, row.muscle, "effective_weight_shortfall");
        continue;
      }

      const requestedSetBump = Math.min(
        MAX_PROJECTED_SUPPORT_FLOOR_SET_BUMP,
        Math.ceil(row.deficitToPracticalFloor / effectivePerSet - SUPPORT_FLOOR_EPSILON)
      );
      const projectedTotals = computeProjectedWeeklyContributionByMuscle({
        projectedSlots,
        currentSlotContribution: new Map(),
      });
      const safeSetBump = getMaxMavSafeSetBump({
        exercise: candidate.accessory,
        projectedTotals,
        requestedSetBump: getMaxPracticalSetBump(candidate.accessory, requestedSetBump),
      });
      if (safeSetBump <= 0) {
        addSupportFloorRepairReason(reasons, row.muscle, "capacity_blocked");
        continue;
      }

      const bumpedWorkout = replaceWorkoutExercise(
        candidate.projectedSlot.workout,
        withAdditionalAccessorySets(candidate.accessory, safeSetBump)
      );
      if (
        preservesSlotIdentity({
          slotPolicy: candidate.slotPolicy,
          workout: candidate.projectedSlot.workout,
        }) &&
        !preservesSlotIdentity({ slotPolicy: candidate.slotPolicy, workout: bumpedWorkout })
      ) {
        addSupportFloorRepairReason(reasons, row.muscle, "slot_identity_blocked");
        continue;
      }

      projectedSlots = projectedSlots.map((projectedSlot, index) =>
        index === candidate.index ? updateProjectedSlotWorkout(projectedSlot, bumpedWorkout) : projectedSlot
      );
      addSupportFloorRepairReason(reasons, row.muscle, "existing_accessory_set_bump");
      if (safeSetBump < requestedSetBump) {
        addSupportFloorRepairReason(reasons, row.muscle, "effective_weight_shortfall");
      }
      appliedAnyBump = true;
    }

    if (!appliedAnyBump) {
      break;
    }
  }

  return { projectedSlots, reasons };
}

function countNonDirectionalPullPattern(input: {
  workout: WorkoutPlan;
  pattern: string;
  directionalSupportMuscles: readonly string[];
}): number {
  return getWorkoutExercises(input.workout).filter((exercise) => {
    if (!exerciseMatchesMovementPattern(exercise.exercise, input.pattern)) {
      return false;
    }
    return !exerciseHasAnyPrimaryMuscle(exercise.exercise, input.directionalSupportMuscles);
  }).length;
}

export function trimRedundantUpperPullSupportProjection(input: {
  workout: WorkoutPlan;
  slotPolicy: ReturnType<typeof resolveSessionSlotPolicy>["currentSession"];
  protectedMuscles: readonly ProtectedWeekOneCoverageMuscle[];
}): WorkoutPlan {
  if (input.slotPolicy?.sessionShape?.id !== "upper_horizontal_balanced") {
    return input.workout;
  }

  const directionalSupportMuscles: ProtectedWeekOneCoverageMuscle[] = [
    "Chest",
    "Triceps",
    "Rear Delts",
  ];
  const protectedMuscles =
    input.protectedMuscles.length > 0
      ? input.protectedMuscles
      : getProtectedWeekOneCoverageObligations(input.slotPolicy);
  let workout = input.workout;

  for (const pattern of ["horizontal_pull", "vertical_pull"]) {
    const requiredPatternCount = getRequiredMovementPatternCount({
      slotPolicy: input.slotPolicy,
      pattern,
    });
    while (
      countWorkoutExercises(workout) > SESSION_CAPS.minExercises &&
      countNonDirectionalPullPattern({
        workout,
        pattern,
        directionalSupportMuscles,
      }) > requiredPatternCount
    ) {
      const redundantAccessory = workout.accessories.find(
        (exercise) =>
          exerciseMatchesMovementPattern(exercise.exercise, pattern) &&
          !exerciseHasAnyPrimaryMuscle(exercise.exercise, directionalSupportMuscles)
      );
      if (!redundantAccessory) {
        break;
      }

      const candidateWorkout = removeAccessory(workout, redundantAccessory.exercise.id);
      const supportQuality = evaluateUpperProtectedSupportQuality({
        slotPolicy: input.slotPolicy,
        contributionByMuscle: computeWorkoutContributionByMuscle(candidateWorkout),
        protectedMuscles,
      });
      if (
        !supportQuality.satisfied ||
        !preservesSlotIdentity({ slotPolicy: input.slotPolicy, workout: candidateWorkout })
      ) {
        break;
      }

      workout = candidateWorkout;
    }
  }

  return workout;
}

function reindexWorkoutSections(workout: WorkoutPlan): WorkoutPlan {
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

export function preserveLowerPatternPrimacy(input: {
  workout: WorkoutPlan;
  slotPolicy: ReturnType<typeof resolveSessionSlotPolicy>["currentSession"];
}): WorkoutPlan {
  if (input.slotPolicy?.sessionShape?.id !== "lower_hinge_dominant") {
    return input.workout;
  }

  const firstMainLift = input.workout.mainLifts[0];
  if (firstMainLift && exerciseMatchesMovementPattern(firstMainLift.exercise, "hinge")) {
    return input.workout;
  }

  const hingeMainLiftIndex = input.workout.mainLifts.findIndex(
    (exercise) =>
      (exercise.exercise.isCompound ?? false) &&
      exerciseMatchesMovementPattern(exercise.exercise, "hinge")
  );
  if (hingeMainLiftIndex > 0) {
    const hingeMainLift = input.workout.mainLifts[hingeMainLiftIndex];
    if (!hingeMainLift) {
      return input.workout;
    }
    return reindexWorkoutSections({
      ...input.workout,
      mainLifts: [
        hingeMainLift,
        ...input.workout.mainLifts.filter((_, index) => index !== hingeMainLiftIndex),
      ],
    });
  }

  const hingeAccessoryIndex = input.workout.accessories.findIndex(
    (exercise) =>
      (exercise.exercise.isCompound ?? false) &&
      exerciseMatchesMovementPattern(exercise.exercise, "hinge")
  );
  if (hingeAccessoryIndex < 0 || !firstMainLift) {
    return input.workout;
  }

  const hingeAccessory = input.workout.accessories[hingeAccessoryIndex];
  if (!hingeAccessory) {
    return input.workout;
  }

  return reindexWorkoutSections({
    ...input.workout,
    mainLifts: [
      {
        ...hingeAccessory,
        isMainLift: true,
        role: "main",
      },
      ...input.workout.mainLifts.slice(1),
    ],
    accessories: [
      {
        ...firstMainLift,
        isMainLift: false,
        role: "accessory",
      },
      ...input.workout.accessories.filter((_, index) => index !== hingeAccessoryIndex),
    ],
  });
}
