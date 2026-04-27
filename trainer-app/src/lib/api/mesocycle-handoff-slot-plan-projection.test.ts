import { describe, expect, it, vi } from "vitest";

const composeIntentSessionFromMappedContextSpy = vi.fn();

vi.mock("./template-session", async (importOriginal) => {
  const original = await importOriginal<typeof import("./template-session")>();
  return {
    ...original,
    composeIntentSessionFromMappedContext: (
      ...args: Parameters<typeof original.composeIntentSessionFromMappedContext>
    ) => {
      composeIntentSessionFromMappedContextSpy(...args);
      return original.composeIntentSessionFromMappedContext(...args);
    },
  };
});

import type { NextCycleSeedDraft } from "./mesocycle-handoff-contract";
import { buildFallbackDesignFromDraft } from "./mesocycle-genesis-policy";
import {
  buildMesocycleSlotPlanSeed,
  evaluateLowerPatternPrimacy,
  evaluateUpperProtectedSupportQuality,
  evaluateUpperSupportTypeQuality,
  preservesSlotIdentity,
  projectSuccessorSlotPlansFromSnapshot,
} from "./mesocycle-handoff-slot-plan-projection";
import {
  applyExistingAccessorySupportFloorBumps,
  applyFinalSupportFloorClosure,
  applyFinalWeeklyObligationClosure,
  applyFinalMinimumViableSetRedistribution,
  applyPostForbiddenCleanupReroute,
  applyLowerBCleanCurlSetDistribution,
  MIN_PROJECTED_ACCESSORY_SETS_PER_EXERCISE,
  MIN_PROJECTED_MAIN_LIFT_SETS_PER_EXERCISE,
  removeForbiddenSlotPrimaryRepairExercises,
  type DistributionGuardAction,
} from "./mesocycle-handoff-slot-plan-projection.repair-engine";
import {
  applyProgramQualityConstraints,
  evaluateProgramQualityConstraints,
  PROGRAM_QUALITY_CONSTRAINT_PRIORITY,
  PROGRAM_QUALITY_PENALTY_MODEL,
} from "./mesocycle-handoff-slot-plan-projection.program-quality";
import {
  buildSlotSequenceEntries,
  computeWorkoutContributionByMuscle,
  evaluateProtectedWeekOneCoverage,
} from "./mesocycle-handoff-slot-plan-projection.coverage-evaluation";
import { buildWeeklyDemandSlotAllocationDiagnostic } from "./mesocycle-handoff-slot-plan-projection.diagnostics";
import {
  evaluateDuplicateExerciseReuse,
  type WeeklyMuscleObligationPlan,
} from "./mesocycle-handoff-slot-plan-projection.weekly-obligations";
import { resolveSessionSlotPolicy } from "@/lib/planning/session-slot-profile";
import { getEffectiveStimulusByMuscle } from "@/lib/engine/stimulus";
import type { PreloadedGenerationSnapshot } from "./template-session/context-loader";
import type {
  MovementPatternV2,
  WorkoutExercise,
  WorkoutPlan,
} from "@/lib/engine/types";
import { findFinalSlotForbiddenPrescriptionViolations } from "../audit/workout-audit/planning-reality-invariants.test-helper";

function makeRawExercise(input: {
  id: string;
  name: string;
  movementPatterns: string[];
  splitTags: string[];
  equipment?: string[];
  primaryMuscles: string[];
  secondaryMuscles?: string[];
  isMainLiftEligible?: boolean;
  isCompound?: boolean;
  fatigueCost?: number;
  stimulusProfile?: Record<string, number>;
}) {
  return {
    id: input.id,
    name: input.name,
    movementPatterns: input.movementPatterns,
    splitTags: input.splitTags,
    jointStress: "MEDIUM",
    isMainLiftEligible: input.isMainLiftEligible ?? true,
    isCompound: input.isCompound ?? true,
    fatigueCost: input.fatigueCost ?? 3,
    sfrScore: 4,
    lengthPositionScore: 3,
    exerciseEquipment: (input.equipment ?? ["MACHINE"]).map((type) => ({
      equipment: { type },
    })),
    exerciseMuscles: [
      ...input.primaryMuscles.map((name) => ({
        role: "PRIMARY",
        muscle: { name, sraHours: 48 },
      })),
      ...(input.secondaryMuscles ?? []).map((name) => ({
        role: "SECONDARY",
        muscle: { name, sraHours: 48 },
      })),
    ],
    aliases: [],
    ...(input.stimulusProfile
      ? { stimulusProfile: input.stimulusProfile }
      : {}),
  };
}

function makeProjectedExercise(input: {
  id: string;
  name: string;
  movementPatterns: MovementPatternV2[];
  primaryMuscles: string[];
  secondaryMuscles?: string[];
  equipment?: WorkoutExercise["exercise"]["equipment"];
  sets?: number;
  isMainLift?: boolean;
  isCompound?: boolean;
  fatigueCost?: number;
  stimulusProfile?: Record<string, number>;
}): WorkoutExercise {
  return {
    id: `${input.id}:projected`,
    exercise: {
      id: input.id,
      name: input.name,
      movementPatterns: input.movementPatterns,
      splitTags: [],
      jointStress: "medium",
      isMainLiftEligible: input.isMainLift ?? false,
      isCompound: input.isCompound ?? true,
      fatigueCost: input.fatigueCost ?? 3,
      equipment: input.equipment ?? ["machine"],
      primaryMuscles: input.primaryMuscles,
      secondaryMuscles: input.secondaryMuscles ?? [],
      sfrScore: 4,
      lengthPositionScore: 3,
      ...(input.stimulusProfile
        ? { stimulusProfile: input.stimulusProfile }
        : {}),
    },
    orderIndex: 0,
    isMainLift: input.isMainLift ?? false,
    role: input.isMainLift ? "main" : "accessory",
    sets: Array.from({ length: input.sets ?? 3 }, (_, index) => ({
      setIndex: index + 1,
      targetReps: 10,
      role: input.isMainLift ? ("main" as const) : ("accessory" as const),
    })),
  };
}

function makeProjectedWorkout(input: {
  mainLifts?: WorkoutExercise[];
  accessories?: WorkoutExercise[];
}): WorkoutPlan {
  const mainLifts = (input.mainLifts ?? []).map((exercise, index) => ({
    ...exercise,
    orderIndex: index,
    isMainLift: true,
    role: "main" as const,
  }));
  const accessories = (input.accessories ?? []).map((exercise, index) => ({
    ...exercise,
    orderIndex: mainLifts.length + index,
    isMainLift: false,
    role: "accessory" as const,
  }));

  return {
    id: "projection-test",
    scheduledDate: "2026-03-19",
    warmup: [],
    mainLifts,
    accessories,
    estimatedMinutes: 60,
  };
}

function makeProjectedSlot(input: {
  slotId: string;
  intent: "UPPER" | "LOWER" | "PULL" | "PUSH";
  workout: WorkoutPlan;
}) {
  return {
    slotPlan: {
      slotId: input.slotId,
      intent: input.intent,
      exercises: [],
    },
    workout: input.workout,
    projectedContributionByMuscle: new Map<string, number>(),
    repairMuscles: [],
  };
}

function makeProjectedSlotWithContributions(input: {
  slotId: string;
  intent: "UPPER" | "LOWER" | "PULL" | "PUSH";
  workout: WorkoutPlan;
}) {
  return {
    ...makeProjectedSlot(input),
    projectedContributionByMuscle: computeWorkoutContributionByMuscle(
      input.workout,
    ),
  };
}

function emptyWeeklyObligationPlan(): WeeklyMuscleObligationPlan {
  return {
    muscles: {
      Chest: { targetSets: 0, allocatedSlots: [] },
      Lats: { targetSets: 0, allocatedSlots: [] },
      Quads: { targetSets: 0, allocatedSlots: [] },
      Hamstrings: { targetSets: 0, allocatedSlots: [] },
    },
  };
}

function weeklyObligationPlan(
  input: Partial<WeeklyMuscleObligationPlan["muscles"]>,
): WeeklyMuscleObligationPlan {
  return {
    muscles: {
      ...emptyWeeklyObligationPlan().muscles,
      ...input,
    },
  };
}

function getProjectedExercises(workout: WorkoutPlan) {
  return [...workout.mainLifts, ...workout.accessories];
}

function getExerciseSetCounts(workout: WorkoutPlan) {
  return Object.fromEntries(
    getProjectedExercises(workout).map((exercise) => [
      exercise.exercise.id,
      exercise.sets.length,
    ]),
  );
}

function getMuscleSetTotal(workout: WorkoutPlan, muscle: string) {
  return getProjectedExercises(workout)
    .filter((exercise) => exercise.exercise.primaryMuscles?.includes(muscle))
    .reduce((sum, exercise) => sum + exercise.sets.length, 0);
}

function getEffectiveMuscleSetTotal(workout: WorkoutPlan, muscle: string) {
  return getProjectedExercises(workout).reduce(
    (sum, exercise) =>
      sum +
      (getEffectiveStimulusByMuscle(
        exercise.exercise,
        exercise.sets.length,
      ).get(muscle) ?? 0),
    0,
  );
}

function getLowerBHamstringsFeasibility(
  diagnostic: ReturnType<typeof buildWeeklyDemandSlotAllocationDiagnostic>,
) {
  return diagnostic.preselectionFeasibility.find(
    (row) => row.slotId === "lower_b" && row.muscle === "Hamstrings",
  );
}

function getLowerBHamstringsCandidate(
  diagnostic: ReturnType<typeof buildWeeklyDemandSlotAllocationDiagnostic>,
  exerciseName: string,
) {
  return getLowerBHamstringsFeasibility(diagnostic)?.candidateInventory.find(
    (candidate) => candidate.exerciseName === exerciseName,
  );
}

function getClassAlignment(
  diagnostic: ReturnType<typeof buildWeeklyDemandSlotAllocationDiagnostic>,
  slotId: string,
  muscle: string,
) {
  return diagnostic.exerciseClassAlignment.slots
    .find((slot) => slot.slotId === slotId)
    ?.muscleAlignments.find((row) => row.muscle === muscle);
}

function getClassCause(
  diagnostic: ReturnType<typeof buildWeeklyDemandSlotAllocationDiagnostic>,
  slotId: string,
  muscle: string,
) {
  return diagnostic.exerciseClassUnresolvedCauses.find(
    (row) => row.slotId === slotId && row.muscle === muscle,
  );
}

function getLowerBCalfCleanupFeasibility(
  diagnostic: ReturnType<typeof buildWeeklyDemandSlotAllocationDiagnostic>,
) {
  return diagnostic.cleanupCandidateFeasibility.find(
    (row) => row.candidate === "lower_b_calf_duplicate_cleanup",
  );
}

function buildSnapshot(): PreloadedGenerationSnapshot {
  return {
    context: {
      profile: {
        id: "profile-1",
        userId: "user-1",
        trainingAge: "INTERMEDIATE",
        age: 30,
        sex: "MALE",
        heightIn: 72,
        weightLb: 185,
      },
      goals: {
        userId: "user-1",
        primaryGoal: "HYPERTROPHY",
        secondaryGoal: "NONE",
      },
      constraints: {
        userId: "user-1",
        daysPerWeek: 4,
        splitType: "UPPER_LOWER",
        weeklySchedule: ["UPPER", "LOWER", "UPPER", "LOWER"],
      },
      injuries: [],
      exercises: [
        makeRawExercise({
          id: "bench",
          name: "Bench Press",
          movementPatterns: ["horizontal_push"],
          splitTags: ["push"],
          equipment: ["BARBELL"],
          primaryMuscles: ["Chest"],
          secondaryMuscles: ["Triceps", "Front Delts"],
        }),
        makeRawExercise({
          id: "incline-press",
          name: "Incline Dumbbell Press",
          movementPatterns: ["vertical_push"],
          splitTags: ["push"],
          equipment: ["DUMBBELL"],
          primaryMuscles: ["Chest", "Front Delts"],
          secondaryMuscles: ["Triceps"],
          isMainLiftEligible: false,
        }),
        makeRawExercise({
          id: "cable-fly",
          name: "Cable Fly",
          movementPatterns: ["isolation"],
          splitTags: ["push"],
          equipment: ["CABLE"],
          primaryMuscles: ["Chest"],
          isMainLiftEligible: false,
          isCompound: false,
          fatigueCost: 2,
        }),
        makeRawExercise({
          id: "machine-press",
          name: "Machine Chest Press",
          movementPatterns: ["horizontal_push"],
          splitTags: ["push"],
          equipment: ["MACHINE"],
          primaryMuscles: ["Chest"],
          secondaryMuscles: ["Triceps"],
          isMainLiftEligible: false,
        }),
        makeRawExercise({
          id: "row",
          name: "Chest-Supported Row",
          movementPatterns: ["horizontal_pull"],
          splitTags: ["pull"],
          equipment: ["MACHINE"],
          primaryMuscles: ["Upper Back", "Lats"],
          secondaryMuscles: ["Biceps"],
        }),
        makeRawExercise({
          id: "pulldown",
          name: "Lat Pulldown",
          movementPatterns: ["vertical_pull"],
          splitTags: ["pull"],
          equipment: ["CABLE"],
          primaryMuscles: ["Lats"],
          secondaryMuscles: ["Biceps"],
          isMainLiftEligible: false,
        }),
        makeRawExercise({
          id: "seated-row",
          name: "Seated Cable Row",
          movementPatterns: ["horizontal_pull"],
          splitTags: ["pull"],
          equipment: ["CABLE"],
          primaryMuscles: ["Upper Back", "Lats"],
          secondaryMuscles: ["Biceps"],
          isMainLiftEligible: false,
        }),
        makeRawExercise({
          id: "curl",
          name: "Cable Curl",
          movementPatterns: ["isolation"],
          splitTags: ["pull"],
          equipment: ["CABLE"],
          primaryMuscles: ["Biceps"],
          isMainLiftEligible: false,
          isCompound: false,
          fatigueCost: 2,
        }),
        makeRawExercise({
          id: "rear-delt-fly",
          name: "Reverse Pec Deck",
          movementPatterns: ["isolation"],
          splitTags: ["pull"],
          equipment: ["MACHINE"],
          primaryMuscles: ["Rear Delts"],
          isMainLiftEligible: false,
          isCompound: false,
          fatigueCost: 2,
        }),
        makeRawExercise({
          id: "lateral-raise",
          name: "Lateral Raise",
          movementPatterns: ["isolation"],
          splitTags: ["push"],
          equipment: ["DUMBBELL"],
          primaryMuscles: ["Side Delts"],
          isMainLiftEligible: false,
          isCompound: false,
          fatigueCost: 2,
        }),
        makeRawExercise({
          id: "squat",
          name: "Back Squat",
          movementPatterns: ["squat"],
          splitTags: ["legs"],
          equipment: ["BARBELL"],
          primaryMuscles: ["Quads", "Glutes"],
        }),
        makeRawExercise({
          id: "rdl",
          name: "Romanian Deadlift",
          movementPatterns: ["hinge"],
          splitTags: ["legs"],
          equipment: ["BARBELL"],
          primaryMuscles: ["Hamstrings", "Glutes"],
        }),
        makeRawExercise({
          id: "hack-squat",
          name: "Hack Squat",
          movementPatterns: ["squat"],
          splitTags: ["legs"],
          equipment: ["MACHINE"],
          primaryMuscles: ["Quads", "Glutes"],
          isMainLiftEligible: false,
        }),
        makeRawExercise({
          id: "leg-curl",
          name: "Seated Leg Curl",
          movementPatterns: ["isolation"],
          splitTags: ["legs"],
          equipment: ["MACHINE"],
          primaryMuscles: ["Hamstrings"],
          isMainLiftEligible: false,
          isCompound: false,
          fatigueCost: 2,
        }),
        makeRawExercise({
          id: "leg-extension",
          name: "Leg Extension",
          movementPatterns: ["isolation"],
          splitTags: ["legs"],
          equipment: ["MACHINE"],
          primaryMuscles: ["Quads"],
          isMainLiftEligible: false,
          isCompound: false,
          fatigueCost: 2,
        }),
        makeRawExercise({
          id: "hip-thrust",
          name: "Barbell Hip Thrust",
          movementPatterns: ["hinge"],
          splitTags: ["legs"],
          equipment: ["BARBELL"],
          primaryMuscles: ["Glutes"],
          secondaryMuscles: ["Hamstrings"],
          isMainLiftEligible: false,
        }),
        makeRawExercise({
          id: "calf-raise",
          name: "Standing Calf Raise",
          movementPatterns: ["isolation"],
          splitTags: ["legs"],
          equipment: ["MACHINE"],
          primaryMuscles: ["Calves"],
          isMainLiftEligible: false,
          isCompound: false,
          fatigueCost: 2,
        }),
      ],
      workouts: [],
      preferences: null,
      checkIns: [],
    },
    activeMesocycle: null,
    rotationContext: new Map(),
    mesocycleRoleRows: [],
    phaseBlockContext: undefined,
  } as unknown as PreloadedGenerationSnapshot;
}

function buildRepairSensitiveSnapshot(): PreloadedGenerationSnapshot {
  const snapshot = buildSnapshot();
  snapshot.context.exercises.push(
    makeRawExercise({
      id: "triceps-pressdown",
      name: "Cable Triceps Pressdown",
      movementPatterns: ["isolation"],
      splitTags: ["push"],
      equipment: ["CABLE"],
      primaryMuscles: ["Triceps"],
      isMainLiftEligible: false,
      isCompound: false,
      fatigueCost: 1,
    }) as never,
    makeRawExercise({
      id: "seated-calf-raise",
      name: "Seated Calf Raise",
      movementPatterns: ["isolation"],
      splitTags: ["legs"],
      equipment: ["MACHINE"],
      primaryMuscles: ["Calves"],
      isMainLiftEligible: false,
      isCompound: false,
      fatigueCost: 1,
    }) as never,
    makeRawExercise({
      id: "donkey-calf-raise",
      name: "Donkey Calf Raise",
      movementPatterns: ["isolation"],
      splitTags: ["legs"],
      equipment: ["MACHINE"],
      primaryMuscles: ["Calves"],
      isMainLiftEligible: false,
      isCompound: false,
      fatigueCost: 1,
    }) as never,
  );
  return snapshot;
}

function buildProtectedCoverageSatisfiedSnapshot(): PreloadedGenerationSnapshot {
  const snapshot = buildRepairSensitiveSnapshot();
  snapshot.context.exercises.push(
    makeRawExercise({
      id: "overhead-triceps-extension",
      name: "Overhead Triceps Extension",
      movementPatterns: ["isolation"],
      splitTags: ["push"],
      equipment: ["CABLE"],
      primaryMuscles: ["Triceps"],
      isMainLiftEligible: false,
      isCompound: false,
      fatigueCost: 1,
    }) as never,
    makeRawExercise({
      id: "seated-leg-curl",
      name: "Seated Leg Curl",
      movementPatterns: ["isolation"],
      splitTags: ["legs"],
      equipment: ["MACHINE"],
      primaryMuscles: ["Hamstrings"],
      isMainLiftEligible: false,
      isCompound: false,
      fatigueCost: 1,
    }) as never,
    makeRawExercise({
      id: "cable-lateral-raise",
      name: "Cable Lateral Raise",
      movementPatterns: ["isolation"],
      splitTags: ["push"],
      equipment: ["CABLE"],
      primaryMuscles: ["Side Delts"],
      isMainLiftEligible: false,
      isCompound: false,
      fatigueCost: 1,
    }) as never,
  );
  return snapshot;
}

function buildNoHingeCompoundSnapshot(): PreloadedGenerationSnapshot {
  const snapshot = buildSnapshot();
  snapshot.context.exercises = snapshot.context.exercises.filter(
    (exercise) =>
      !(exercise.isCompound ?? false) ||
      !(exercise.movementPatterns ?? []).includes(
        "hinge" as (typeof exercise.movementPatterns)[number],
      ),
  );
  return snapshot;
}

function buildDraft(): NextCycleSeedDraft {
  return {
    version: 1,
    sourceMesocycleId: "meso-1",
    createdAt: "2026-03-01T00:00:00.000Z",
    structure: {
      splitType: "UPPER_LOWER",
      sessionsPerWeek: 4,
      daysPerWeek: 4,
      sequenceMode: "ordered_flexible",
      slots: [
        { slotId: "upper_a", intent: "UPPER" },
        { slotId: "lower_a", intent: "LOWER" },
        { slotId: "upper_b", intent: "UPPER" },
        { slotId: "lower_b", intent: "LOWER" },
      ],
    },
    startingPoint: {
      volumeEntry: "conservative",
      baselineSource: "accumulation_preferred",
      allowNonDeloadFallback: true,
    },
    carryForwardSelections: [
      {
        exerciseId: "bench",
        exerciseName: "Bench Press",
        sessionIntent: "UPPER",
        role: "CORE_COMPOUND",
        action: "keep",
      },
      {
        exerciseId: "squat",
        exerciseName: "Back Squat",
        sessionIntent: "LOWER",
        role: "CORE_COMPOUND",
        action: "keep",
      },
      {
        exerciseId: "row",
        exerciseName: "Chest-Supported Row",
        sessionIntent: "UPPER",
        role: "ACCESSORY",
        action: "rotate",
      },
    ],
  };
}

function buildSource() {
  return {
    macroCycleId: "macro-1",
    mesoNumber: 1,
    startWeek: 0,
    durationWeeks: 5,
    focus: "Upper Lower Hypertrophy",
    volumeTarget: "HIGH" as const,
    intensityBias: "HYPERTROPHY" as const,
    blocks: [
      {
        blockNumber: 1,
        blockType: "ACCUMULATION" as const,
        startWeek: 5,
        durationWeeks: 4,
        volumeTarget: "HIGH" as const,
        intensityBias: "HYPERTROPHY" as const,
        adaptationType: "MYOFIBRILLAR_HYPERTROPHY" as const,
      },
      {
        blockNumber: 2,
        blockType: "DELOAD" as const,
        startWeek: 9,
        durationWeeks: 1,
        volumeTarget: "LOW" as const,
        intensityBias: "HYPERTROPHY" as const,
        adaptationType: "RECOVERY" as const,
      },
    ],
  };
}

function buildDesign(draft: NextCycleSeedDraft = buildDraft()) {
  return buildFallbackDesignFromDraft({
    sourceMesocycleId: "meso-1",
    designedAt: draft.createdAt,
    profile: {
      focus: "Upper Lower Hypertrophy",
      durationWeeks: 5,
      volumeTarget: "HIGH",
      intensityBias: "HYPERTROPHY",
      blocks: [
        {
          blockNumber: 1,
          blockType: "ACCUMULATION",
          durationWeeks: 4,
          volumeTarget: "HIGH",
          intensityBias: "HYPERTROPHY",
          adaptationType: "MYOFIBRILLAR_HYPERTROPHY",
        },
        {
          blockNumber: 2,
          blockType: "DELOAD",
          durationWeeks: 1,
          volumeTarget: "LOW",
          intensityBias: "HYPERTROPHY",
          adaptationType: "RECOVERY",
        },
      ],
    },
    draft,
  });
}

function buildRepairSensitiveDraft(): NextCycleSeedDraft {
  const draft = buildDraft();
  return {
    ...draft,
    carryForwardSelections: draft.carryForwardSelections.filter(
      (selection) => selection.exerciseId !== "row",
    ),
  };
}

function getProjectedSlotPlans(
  projected: ReturnType<typeof projectSuccessorSlotPlansFromSnapshot>,
) {
  return "error" in projected
    ? (projected.slotPlans ?? [])
    : projected.slotPlans;
}

function getProtectedCoverageDiagnostics(
  projected: ReturnType<typeof projectSuccessorSlotPlansFromSnapshot>,
) {
  return projected.diagnostics?.protectedCoverage;
}

function getCoverageRow(
  projected: ReturnType<typeof projectSuccessorSlotPlansFromSnapshot>,
  muscle: string,
) {
  return getProtectedCoverageDiagnostics(projected)?.afterRepair.muscles.find(
    (row) => row.muscle === muscle,
  );
}

function getMinimumViableSetCount(role: string) {
  return role === "CORE_COMPOUND"
    ? MIN_PROJECTED_MAIN_LIFT_SETS_PER_EXERCISE
    : MIN_PROJECTED_ACCESSORY_SETS_PER_EXERCISE;
}

describe("projectSuccessorSlotPlansFromSnapshot", () => {
  it("exposes additive monotonic program quality priorities without changing seed contracts", () => {
    expect(PROGRAM_QUALITY_CONSTRAINT_PRIORITY).toEqual({
      P0: "weekly_obligations_slot_identity",
      P1: "movement_pattern_coverage",
      P2: "per_exercise_efficiency",
      P3: "stimulus_diversity",
      P4: "duplicate_penalties",
      P5: "isolation_completeness",
    });
    expect(PROGRAM_QUALITY_PENALTY_MODEL).toEqual({
      type: "additive",
      monotonic: true,
    });
  });

  it("spreads soft-cap overflow across existing same-muscle alternatives when viable", () => {
    const bench = makeProjectedExercise({
      id: "bench",
      name: "Bench Press",
      movementPatterns: ["horizontal_push"],
      primaryMuscles: ["Chest"],
      sets: 5,
      isMainLift: true,
    });
    const fly = makeProjectedExercise({
      id: "cable-fly",
      name: "Cable Fly",
      movementPatterns: ["isolation"],
      primaryMuscles: ["Chest"],
      sets: 3,
      isCompound: false,
    });
    const machinePress = makeProjectedExercise({
      id: "machine-press",
      name: "Machine Chest Press",
      movementPatterns: ["horizontal_push"],
      primaryMuscles: ["Chest"],
      sets: 2,
    });
    const slotSequenceEntries = buildSlotSequenceEntries([
      { slotId: "upper_a", intent: "UPPER" },
    ]);

    const result = applyProgramQualityConstraints({
      projectedSlots: [
        makeProjectedSlot({
          slotId: "upper_a",
          intent: "UPPER",
          workout: makeProjectedWorkout({
            mainLifts: [bench],
            accessories: [fly, machinePress],
          }),
        }),
      ],
      exerciseLibrary: [
        bench.exercise,
        fly.exercise,
        machinePress.exercise,
      ] as never,
      weeklyObligationPlan: emptyWeeklyObligationPlan(),
      slotSequenceEntries,
    });

    const exerciseSetCounts = Object.fromEntries(
      getProjectedExercises(
        result.projectedSlots[0]?.workout as WorkoutPlan,
      ).map((exercise) => [exercise.exercise.id, exercise.sets.length]),
    );
    const maxChestShare =
      result.evaluation.diagnostics.find(
        (diagnostic) =>
          diagnostic.constraint === "single_exercise_volume_share",
      ) ?? null;

    expect(exerciseSetCounts.bench).toBeLessThanOrEqual(4);
    expect(Math.max(...Object.values(exerciseSetCounts))).toBeLessThanOrEqual(
      4,
    );
    expect(maxChestShare).toBeNull();
    expect(result.appliedDiagnostics).toContainEqual(
      expect.objectContaining({
        constraint: "per_exercise_efficiency",
        reason: "moved_one_set_to_existing_same_slot_alternative",
      }),
    );
  });

  it("redistributes a 5-set main lift by adding a compatible alternative when none is selected", () => {
    const incline = makeProjectedExercise({
      id: "incline-db-bench",
      name: "Incline DB Bench",
      movementPatterns: ["horizontal_push"],
      primaryMuscles: ["Chest"],
      equipment: ["dumbbell"],
      sets: 5,
      isMainLift: true,
    });
    const machinePress = makeProjectedExercise({
      id: "machine-press",
      name: "Machine Press",
      movementPatterns: ["horizontal_push"],
      primaryMuscles: ["Chest"],
      equipment: ["machine"],
      sets: 2,
    });
    const beforeWorkout = makeProjectedWorkout({ mainLifts: [incline] });
    const slotSequenceEntries = buildSlotSequenceEntries([
      { slotId: "upper_a", intent: "UPPER" },
    ]);

    const result = applyProgramQualityConstraints({
      projectedSlots: [
        makeProjectedSlot({
          slotId: "upper_a",
          intent: "UPPER",
          workout: beforeWorkout,
        }),
      ],
      exerciseLibrary: [incline.exercise, machinePress.exercise] as never,
      weeklyObligationPlan: emptyWeeklyObligationPlan(),
      slotSequenceEntries,
    });
    const afterWorkout = result.projectedSlots[0]?.workout as WorkoutPlan;
    const counts = getExerciseSetCounts(afterWorkout);

    expect(counts["incline-db-bench"]).toBe(3);
    expect(counts["machine-press"]).toBe(2);
    expect(getMuscleSetTotal(afterWorkout, "Chest")).toBe(
      getMuscleSetTotal(beforeWorkout, "Chest"),
    );
    expect(result.appliedDiagnostics).toContainEqual(
      expect.objectContaining({
        constraint: "per_exercise_efficiency",
        reason: "added_compatible_alternative_for_redistribution",
      }),
    );
  });

  it("allows redistribution across slots when weekly Chest target and push identity stay protected", () => {
    const incline = makeProjectedExercise({
      id: "incline-db-bench",
      name: "Incline DB Bench",
      movementPatterns: ["horizontal_push"],
      primaryMuscles: ["Chest"],
      equipment: ["dumbbell"],
      sets: 5,
      isMainLift: true,
    });
    const machinePress = makeProjectedExercise({
      id: "machine-press",
      name: "Machine Press",
      movementPatterns: ["horizontal_push"],
      primaryMuscles: ["Chest"],
      equipment: ["machine"],
      sets: 2,
    });
    const upperAFillers = Array.from({ length: 5 }, (_, index) =>
      makeProjectedExercise({
        id: `upper-a-filler-${index}`,
        name: `Upper A Filler ${index}`,
        movementPatterns: ["horizontal_pull"],
        primaryMuscles: ["Lats"],
        sets: 2,
      }),
    );
    const upperBRow = makeProjectedExercise({
      id: "upper-b-row",
      name: "Upper B Row",
      movementPatterns: ["horizontal_pull"],
      primaryMuscles: ["Lats"],
      sets: 2,
    });
    const beforeWorkout = makeProjectedWorkout({
      mainLifts: [incline],
      accessories: upperAFillers,
    });
    const slotSequenceEntries = buildSlotSequenceEntries([
      { slotId: "upper_a", intent: "UPPER" },
      { slotId: "upper_b", intent: "UPPER" },
    ]);

    const result = applyProgramQualityConstraints({
      projectedSlots: [
        makeProjectedSlot({
          slotId: "upper_a",
          intent: "UPPER",
          workout: beforeWorkout,
        }),
        makeProjectedSlot({
          slotId: "upper_b",
          intent: "UPPER",
          workout: makeProjectedWorkout({ accessories: [upperBRow] }),
        }),
      ],
      exerciseLibrary: [
        incline.exercise,
        machinePress.exercise,
        upperBRow.exercise,
        ...upperAFillers.map((exercise) => exercise.exercise),
      ] as never,
      weeklyObligationPlan: weeklyObligationPlan({
        Chest: {
          targetSets: 5,
          allocatedSlots: [
            { slotId: "upper_a", minEffectiveSets: 5, priority: "primary" },
          ],
        },
      }),
      slotSequenceEntries,
    });

    const upperA = result.projectedSlots.find(
      (slot) => slot.slotPlan.slotId === "upper_a",
    )?.workout as WorkoutPlan;
    const upperB = result.projectedSlots.find(
      (slot) => slot.slotPlan.slotId === "upper_b",
    )?.workout as WorkoutPlan;
    const upperACounts = getExerciseSetCounts(upperA);
    const weeklyChest =
      getMuscleSetTotal(upperA, "Chest") + getMuscleSetTotal(upperB, "Chest");

    expect(upperACounts["incline-db-bench"]).toBe(3);
    expect(getExerciseSetCounts(upperB)["machine-press"]).toBe(2);
    expect(weeklyChest).toBeGreaterThanOrEqual(5);
    expect(getMuscleSetTotal(upperA, "Chest")).toBeGreaterThanOrEqual(2);
  });

  it("keeps a 5-set main lift only when redistribution is explicitly blocked", () => {
    const incline = makeProjectedExercise({
      id: "incline-db-bench",
      name: "Incline DB Bench",
      movementPatterns: ["horizontal_push"],
      primaryMuscles: ["Chest"],
      equipment: ["dumbbell"],
      sets: 5,
      isMainLift: true,
    });
    const slotSequenceEntries = buildSlotSequenceEntries([
      { slotId: "upper_a", intent: "UPPER" },
    ]);

    const result = applyProgramQualityConstraints({
      projectedSlots: [
        makeProjectedSlot({
          slotId: "upper_a",
          intent: "UPPER",
          workout: makeProjectedWorkout({ mainLifts: [incline] }),
        }),
      ],
      exerciseLibrary: [incline.exercise] as never,
      weeklyObligationPlan: emptyWeeklyObligationPlan(),
      slotSequenceEntries,
    });
    const counts = getExerciseSetCounts(
      result.projectedSlots[0]?.workout as WorkoutPlan,
    );

    expect(counts["incline-db-bench"]).toBe(5);
    expect(result.appliedDiagnostics).toContainEqual(
      expect.objectContaining({
        constraint: "per_exercise_efficiency",
        reason: "redistribution_blocked_stacking_allowed",
        blockReason: "no_compatible_alternative",
      }),
    );
  });

  it("blocks redistribution when a weak alternative would break the weekly target floor", () => {
    const sldl = makeProjectedExercise({
      id: "sldl",
      name: "Stiff-Legged Deadlift",
      movementPatterns: ["hinge"],
      primaryMuscles: ["Hamstrings"],
      sets: 5,
      isMainLift: true,
      stimulusProfile: { hamstrings: 1 },
    });
    const weakCurl = makeProjectedExercise({
      id: "weak-leg-curl",
      name: "Weak Leg Curl",
      movementPatterns: ["isolation"],
      primaryMuscles: ["Hamstrings"],
      sets: 2,
      isCompound: false,
      stimulusProfile: { hamstrings: 0.25 },
    });
    const slotSequenceEntries = buildSlotSequenceEntries([
      { slotId: "lower_b", intent: "LOWER" },
    ]);

    const result = applyProgramQualityConstraints({
      projectedSlots: [
        makeProjectedSlot({
          slotId: "lower_b",
          intent: "LOWER",
          workout: makeProjectedWorkout({ mainLifts: [sldl] }),
        }),
      ],
      exerciseLibrary: [sldl.exercise, weakCurl.exercise] as never,
      weeklyObligationPlan: weeklyObligationPlan({
        Hamstrings: {
          targetSets: 5,
          allocatedSlots: [
            { slotId: "lower_b", minEffectiveSets: 5, priority: "primary" },
          ],
        },
      }),
      slotSequenceEntries,
    });

    expect(
      getExerciseSetCounts(result.projectedSlots[0]?.workout as WorkoutPlan)
        .sldl,
    ).toBe(5);
    expect(result.appliedDiagnostics).toContainEqual(
      expect.objectContaining({
        constraint: "per_exercise_efficiency",
        reason: "redistribution_blocked_stacking_allowed",
        blockReason: "would_break_weekly_target",
      }),
    );
  });

  it("prevents one exercise from owning more than half of a 10-set muscle total when spread is viable", () => {
    const incline = makeProjectedExercise({
      id: "incline-db-bench",
      name: "Incline DB Bench",
      movementPatterns: ["horizontal_push"],
      primaryMuscles: ["Chest"],
      equipment: ["dumbbell"],
      sets: 6,
      isMainLift: true,
    });
    const machinePress = makeProjectedExercise({
      id: "machine-press",
      name: "Machine Press",
      movementPatterns: ["horizontal_push"],
      primaryMuscles: ["Chest"],
      equipment: ["machine"],
      sets: 2,
    });
    const cableFly = makeProjectedExercise({
      id: "cable-fly",
      name: "Cable Fly",
      movementPatterns: ["isolation"],
      primaryMuscles: ["Chest"],
      equipment: ["cable"],
      sets: 2,
      isCompound: false,
    });
    const beforeWorkout = makeProjectedWorkout({
      mainLifts: [incline],
      accessories: [machinePress, cableFly],
    });
    const slotSequenceEntries = buildSlotSequenceEntries([
      { slotId: "upper_a", intent: "UPPER" },
    ]);

    const result = applyProgramQualityConstraints({
      projectedSlots: [
        makeProjectedSlot({
          slotId: "upper_a",
          intent: "UPPER",
          workout: beforeWorkout,
        }),
      ],
      exerciseLibrary: [
        incline.exercise,
        machinePress.exercise,
        cableFly.exercise,
      ] as never,
      weeklyObligationPlan: emptyWeeklyObligationPlan(),
      slotSequenceEntries,
    });
    const afterWorkout = result.projectedSlots[0]?.workout as WorkoutPlan;
    const counts = getExerciseSetCounts(afterWorkout);

    expect(counts["incline-db-bench"]).toBeLessThanOrEqual(5);
    expect(
      counts["incline-db-bench"] / getMuscleSetTotal(afterWorkout, "Chest"),
    ).toBeLessThanOrEqual(0.5);
    expect(getMuscleSetTotal(afterWorkout, "Chest")).toBe(
      getMuscleSetTotal(beforeWorkout, "Chest"),
    );
    expect(result.evaluation.diagnostics).not.toContainEqual(
      expect.objectContaining({
        constraint: "single_exercise_volume_share",
        muscle: "Chest",
      }),
    );
  });

  it("keeps redistribution deterministic across identical projection inputs", () => {
    const incline = makeProjectedExercise({
      id: "incline-db-bench",
      name: "Incline DB Bench",
      movementPatterns: ["horizontal_push"],
      primaryMuscles: ["Chest"],
      equipment: ["dumbbell"],
      sets: 5,
      isMainLift: true,
    });
    const machinePress = makeProjectedExercise({
      id: "machine-press",
      name: "Machine Press",
      movementPatterns: ["horizontal_push"],
      primaryMuscles: ["Chest"],
      equipment: ["machine"],
    });
    const slotSequenceEntries = buildSlotSequenceEntries([
      { slotId: "upper_a", intent: "UPPER" },
    ]);
    const input = {
      projectedSlots: [
        makeProjectedSlot({
          slotId: "upper_a",
          intent: "UPPER" as const,
          workout: makeProjectedWorkout({ mainLifts: [incline] }),
        }),
      ],
      exerciseLibrary: [incline.exercise, machinePress.exercise] as never,
      weeklyObligationPlan: emptyWeeklyObligationPlan(),
      slotSequenceEntries,
    };

    const first = applyProgramQualityConstraints(input);
    const second = applyProgramQualityConstraints(input);

    expect(first.projectedSlots.map((slot) => slot.slotPlan)).toEqual(
      second.projectedSlots.map((slot) => slot.slotPlan),
    );
    expect(first.appliedDiagnostics).toEqual(second.appliedDiagnostics);
  });

  it("keeps runtime replay seed shape unchanged after redistribution", () => {
    const incline = makeProjectedExercise({
      id: "incline-db-bench",
      name: "Incline DB Bench",
      movementPatterns: ["horizontal_push"],
      primaryMuscles: ["Chest"],
      equipment: ["dumbbell"],
      sets: 5,
      isMainLift: true,
    });
    const machinePress = makeProjectedExercise({
      id: "machine-press",
      name: "Machine Press",
      movementPatterns: ["horizontal_push"],
      primaryMuscles: ["Chest"],
      equipment: ["machine"],
    });
    const slotSequence = {
      version: 1 as const,
      source: "handoff_draft" as const,
      sequenceMode: "ordered_flexible" as const,
      slots: [{ slotId: "upper_a", intent: "UPPER" as const }],
    };
    const result = applyProgramQualityConstraints({
      projectedSlots: [
        makeProjectedSlot({
          slotId: "upper_a",
          intent: "UPPER",
          workout: makeProjectedWorkout({ mainLifts: [incline] }),
        }),
      ],
      exerciseLibrary: [incline.exercise, machinePress.exercise] as never,
      weeklyObligationPlan: emptyWeeklyObligationPlan(),
      slotSequenceEntries: buildSlotSequenceEntries(slotSequence.slots),
    });

    const seed = buildMesocycleSlotPlanSeed({
      slotSequence,
      slotPlans: result.projectedSlots.map((slot) => slot.slotPlan),
    });

    expect(seed).toEqual({
      version: 1,
      source: "handoff_slot_plan_projection",
      slots: [
        {
          slotId: "upper_a",
          exercises: [
            {
              exerciseId: "incline-db-bench",
              role: "CORE_COMPOUND",
              setCount: 3,
            },
            { exerciseId: "machine-press", role: "ACCESSORY", setCount: 2 },
          ],
        },
      ],
    });
  });

  it("only enforces stimulus diversity once the muscle volume threshold is meaningful", () => {
    const lowVolumeSlot = makeProjectedSlot({
      slotId: "upper_a",
      intent: "UPPER",
      workout: makeProjectedWorkout({
        mainLifts: [
          makeProjectedExercise({
            id: "bench",
            name: "Bench Press",
            movementPatterns: ["horizontal_push"],
            primaryMuscles: ["Chest"],
            sets: 4,
            isMainLift: true,
          }),
        ],
        accessories: [
          makeProjectedExercise({
            id: "machine-press",
            name: "Machine Chest Press",
            movementPatterns: ["horizontal_push"],
            primaryMuscles: ["Chest"],
            sets: 3,
          }),
        ],
      }),
    });
    const highVolumeSlot = makeProjectedSlot({
      slotId: "upper_a",
      intent: "UPPER",
      workout: makeProjectedWorkout({
        mainLifts: [
          makeProjectedExercise({
            id: "bench",
            name: "Bench Press",
            movementPatterns: ["horizontal_push"],
            primaryMuscles: ["Chest"],
            sets: 5,
            isMainLift: true,
          }),
        ],
        accessories: [
          makeProjectedExercise({
            id: "machine-press",
            name: "Machine Chest Press",
            movementPatterns: ["horizontal_push"],
            primaryMuscles: ["Chest"],
            sets: 3,
          }),
        ],
      }),
    });

    const lowVolumeEvaluation = evaluateProgramQualityConstraints({
      projectedSlots: [lowVolumeSlot],
      exerciseLibrary: [] as never,
    });
    const highVolumeEvaluation = evaluateProgramQualityConstraints({
      projectedSlots: [highVolumeSlot],
      exerciseLibrary: [] as never,
    });

    expect(
      lowVolumeEvaluation.diagnostics.some(
        (diagnostic) => diagnostic.constraint === "stimulus_diversity",
      ),
    ).toBe(false);
    expect(highVolumeEvaluation.diagnostics).toContainEqual(
      expect.objectContaining({
        constraint: "stimulus_diversity",
        reason: "single_pattern_share_exceeded",
        muscle: "Chest",
      }),
    );
  });

  it("flags hinge dominance across the weekly lower-slot pair", () => {
    const lowerA = makeProjectedSlot({
      slotId: "lower_a",
      intent: "LOWER",
      workout: makeProjectedWorkout({
        mainLifts: [
          makeProjectedExercise({
            id: "rdl",
            name: "Romanian Deadlift",
            movementPatterns: ["hinge"],
            primaryMuscles: ["Hamstrings"],
            sets: 4,
            isMainLift: true,
          }),
        ],
      }),
    });
    const lowerB = makeProjectedSlot({
      slotId: "lower_b",
      intent: "LOWER",
      workout: makeProjectedWorkout({
        mainLifts: [
          makeProjectedExercise({
            id: "hip-thrust",
            name: "Hip Thrust",
            movementPatterns: ["hinge"],
            primaryMuscles: ["Glutes"],
            sets: 3,
            isMainLift: true,
          }),
          makeProjectedExercise({
            id: "hack-squat",
            name: "Hack Squat",
            movementPatterns: ["squat"],
            primaryMuscles: ["Quads"],
            sets: 3,
            isMainLift: true,
          }),
        ],
      }),
    });

    const evaluation = evaluateProgramQualityConstraints({
      projectedSlots: [lowerA, lowerB],
      exerciseLibrary: [] as never,
    });

    expect(evaluation.diagnostics).toContainEqual(
      expect.objectContaining({
        constraint: "weekly_pattern_balance",
        reason: "lower_hinge_share_exceeded",
        pattern: "hinge",
      }),
    );
  });

  it("shapes lower_b fatigue by preserving hinge identity while reducing duplicate squat and hinge stacks", () => {
    const squat = makeProjectedExercise({
      id: "back-squat",
      name: "Back Squat",
      movementPatterns: ["squat"],
      primaryMuscles: ["Quads"],
      sets: 4,
      isMainLift: true,
      stimulusProfile: { quads: 1, glutes: 0.75 },
    });
    const sldl = makeProjectedExercise({
      id: "sldl",
      name: "Stiff-Legged Deadlift",
      movementPatterns: ["hinge"],
      primaryMuscles: ["Hamstrings"],
      sets: 5,
      isMainLift: true,
      stimulusProfile: { hamstrings: 1, glutes: 1 },
    });
    const duplicateSquat = makeProjectedExercise({
      id: "back-squat",
      name: "Back Squat",
      movementPatterns: ["squat"],
      primaryMuscles: ["Quads"],
      sets: 3,
      stimulusProfile: { quads: 1, glutes: 0.75 },
    });
    const gobletSquat = makeProjectedExercise({
      id: "goblet-squat",
      name: "Goblet Squat",
      movementPatterns: ["squat"],
      primaryMuscles: ["Quads"],
      sets: 2,
      stimulusProfile: { quads: 1, glutes: 0.75 },
    });
    const legCurl = makeProjectedExercise({
      id: "leg-curl",
      name: "Leg Curl",
      movementPatterns: ["isolation"],
      primaryMuscles: ["Hamstrings"],
      sets: 2,
      isCompound: false,
      fatigueCost: 1,
      stimulusProfile: { hamstrings: 1 },
    });
    const backExtension = makeProjectedExercise({
      id: "back-extension-45",
      name: "Back Extension (45 Degree)",
      movementPatterns: ["extension"],
      primaryMuscles: ["Glutes", "Hamstrings", "Lower Back"],
      sets: 2,
      isCompound: false,
      fatigueCost: 0,
      stimulusProfile: { hamstrings: 0.45, glutes: 0.65, lower_back: 0.9 },
    });
    const slotSequenceEntries = buildSlotSequenceEntries([
      { slotId: "lower_a", intent: "LOWER" },
      { slotId: "lower_b", intent: "LOWER" },
    ]);
    const beforeSlots = [
      makeProjectedSlot({
        slotId: "lower_a",
        intent: "LOWER",
        workout: makeProjectedWorkout({ mainLifts: [squat] }),
      }),
      makeProjectedSlot({
        slotId: "lower_b",
        intent: "LOWER",
        workout: makeProjectedWorkout({
          mainLifts: [sldl],
          accessories: [duplicateSquat, gobletSquat],
        }),
      }),
    ];
    const beforeGlutes =
      getEffectiveMuscleSetTotal(beforeSlots[0].workout, "Glutes") +
      getEffectiveMuscleSetTotal(beforeSlots[1].workout, "Glutes");

    const result = applyProgramQualityConstraints({
      projectedSlots: beforeSlots,
      exerciseLibrary: [
        squat.exercise,
        sldl.exercise,
        duplicateSquat.exercise,
        gobletSquat.exercise,
        backExtension.exercise,
        legCurl.exercise,
      ] as never,
      weeklyObligationPlan: weeklyObligationPlan({
        Hamstrings: {
          targetSets: 6,
          allocatedSlots: [
            { slotId: "lower_b", minEffectiveSets: 6, priority: "primary" },
          ],
        },
        Quads: {
          targetSets: 6,
          allocatedSlots: [
            { slotId: "lower_a", minEffectiveSets: 6, priority: "primary" },
          ],
        },
      }),
      slotSequenceEntries,
    });

    const lowerB = result.projectedSlots.find(
      (slot) => slot.slotPlan.slotId === "lower_b",
    )?.workout as WorkoutPlan;
    const counts = getExerciseSetCounts(lowerB);
    const afterGlutes =
      getEffectiveMuscleSetTotal(
        result.projectedSlots[0]?.workout as WorkoutPlan,
        "Glutes",
      ) + getEffectiveMuscleSetTotal(lowerB, "Glutes");

    expect(counts.sldl).toBe(3);
    expect(counts["leg-curl"]).toBeGreaterThanOrEqual(2);
    expect(counts["back-extension-45"]).toBeUndefined();
    expect(counts["goblet-squat"]).toBeUndefined();
    expect(getMuscleSetTotal(lowerB, "Hamstrings")).toBeGreaterThanOrEqual(2);
    expect(afterGlutes).toBeLessThan(beforeGlutes);
    expect(result.appliedDiagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: "replaced_duplicate_squat_support_for_lower_fatigue",
        }),
        expect.objectContaining({
          reason: "moved_hinge_hamstring_work_to_knee_flexion",
        }),
      ]),
    );
  });

  it("injects direct arm or lateral-delt isolation only when the projected week has a deficit", () => {
    const row = makeProjectedExercise({
      id: "row",
      name: "Chest-Supported Row",
      movementPatterns: ["horizontal_pull"],
      primaryMuscles: ["Lats"],
      sets: 3,
      isMainLift: true,
    });
    const curl = makeProjectedExercise({
      id: "curl",
      name: "Cable Curl",
      movementPatterns: ["isolation"],
      primaryMuscles: ["Biceps"],
      sets: 2,
      isCompound: false,
    });
    const slotSequenceEntries = buildSlotSequenceEntries([
      { slotId: "pull_a", intent: "PULL" },
    ]);

    const deficitResult = applyProgramQualityConstraints({
      projectedSlots: [
        makeProjectedSlot({
          slotId: "pull_a",
          intent: "PULL",
          workout: makeProjectedWorkout({ mainLifts: [row] }),
        }),
      ],
      exerciseLibrary: [row.exercise, curl.exercise] as never,
      weeklyObligationPlan: emptyWeeklyObligationPlan(),
      slotSequenceEntries,
    });
    const noDeficitResult = applyProgramQualityConstraints({
      projectedSlots: [
        makeProjectedSlot({
          slotId: "pull_a",
          intent: "PULL",
          workout: makeProjectedWorkout({
            mainLifts: [row],
            accessories: [
              makeProjectedExercise({
                id: "curl-existing",
                name: "Existing Cable Curl",
                movementPatterns: ["isolation"],
                primaryMuscles: ["Biceps"],
                sets: 6,
                isCompound: false,
              }),
            ],
          }),
        }),
      ],
      exerciseLibrary: [row.exercise, curl.exercise] as never,
      weeklyObligationPlan: emptyWeeklyObligationPlan(),
      slotSequenceEntries,
    });

    expect(
      getProjectedExercises(
        deficitResult.projectedSlots[0]?.workout as WorkoutPlan,
      ).map((exercise) => exercise.exercise.id),
    ).toContain("curl");
    expect(deficitResult.appliedDiagnostics).toContainEqual(
      expect.objectContaining({
        constraint: "isolation_completeness",
        reason: "injected_direct_isolation_for_deficit",
        muscle: "Biceps",
      }),
    );
    expect(noDeficitResult.appliedDiagnostics).not.toContainEqual(
      expect.objectContaining({
        constraint: "isolation_completeness",
        reason: "injected_direct_isolation_for_deficit",
      }),
    );
  });

  it("replaces sufficient Tier A redundancy with Tier B support when capacity is full", () => {
    const bench = makeProjectedExercise({
      id: "bench",
      name: "Bench Press",
      movementPatterns: ["horizontal_push"],
      primaryMuscles: ["Chest"],
      sets: 4,
      isMainLift: true,
    });
    const chestAccessories = Array.from({ length: 5 }, (_, index) =>
      makeProjectedExercise({
        id: `chest-accessory-${index}`,
        name: `Chest Accessory ${index}`,
        movementPatterns: ["horizontal_push"],
        primaryMuscles: ["Chest"],
        sets: 3,
      }),
    );
    const lateralRaise = makeProjectedExercise({
      id: "lateral-raise",
      name: "Lateral Raise",
      movementPatterns: ["isolation"],
      primaryMuscles: ["Side Delts"],
      sets: 2,
      isCompound: false,
      fatigueCost: 1,
    });
    const slotSequenceEntries = buildSlotSequenceEntries([
      { slotId: "upper_a", intent: "UPPER" },
    ]);

    const result = applyProgramQualityConstraints({
      projectedSlots: [
        makeProjectedSlot({
          slotId: "upper_a",
          intent: "UPPER",
          workout: makeProjectedWorkout({
            mainLifts: [bench],
            accessories: chestAccessories,
          }),
        }),
      ],
      exerciseLibrary: [
        bench.exercise,
        lateralRaise.exercise,
        ...chestAccessories.map((exercise) => exercise.exercise),
      ] as never,
      weeklyObligationPlan: emptyWeeklyObligationPlan(),
      slotSequenceEntries,
    });

    const workout = result.projectedSlots[0]?.workout as WorkoutPlan;
    const exerciseIds = getProjectedExercises(workout).map(
      (exercise) => exercise.exercise.id,
    );

    expect(exerciseIds).toContain("lateral-raise");
    expect(
      exerciseIds.filter((exerciseId) =>
        exerciseId.startsWith("chest-accessory"),
      ).length,
    ).toBeLessThan(chestAccessories.length);
    expect(result.appliedDiagnostics).toContainEqual(
      expect.objectContaining({
        constraint: "isolation_completeness",
        reason: "replaced_tier_a_redundancy_for_tier_b_deficit",
        muscle: "Side Delts",
      }),
    );
  });

  it("demotes excess main compounds without removing selected exercises", () => {
    const slotSequenceEntries = buildSlotSequenceEntries([
      { slotId: "upper_a", intent: "UPPER" },
    ]);
    const workout = makeProjectedWorkout({
      mainLifts: [
        makeProjectedExercise({
          id: "bench",
          name: "Bench Press",
          movementPatterns: ["horizontal_push"],
          primaryMuscles: ["Chest"],
          isMainLift: true,
        }),
        makeProjectedExercise({
          id: "row",
          name: "Row",
          movementPatterns: ["horizontal_pull"],
          primaryMuscles: ["Lats"],
          isMainLift: true,
        }),
        makeProjectedExercise({
          id: "overhead-press",
          name: "Overhead Press",
          movementPatterns: ["vertical_push"],
          primaryMuscles: ["Front Delts"],
          isMainLift: true,
        }),
      ],
    });

    const result = applyProgramQualityConstraints({
      projectedSlots: [
        makeProjectedSlot({
          slotId: "upper_a",
          intent: "UPPER",
          workout,
        }),
      ],
      exerciseLibrary: getProjectedExercises(workout).map(
        (exercise) => exercise.exercise,
      ) as never,
      weeklyObligationPlan: emptyWeeklyObligationPlan(),
      slotSequenceEntries,
    });
    const projectedWorkout = result.projectedSlots[0]?.workout;

    expect(projectedWorkout?.mainLifts.length).toBeLessThanOrEqual(2);
    expect(
      getProjectedExercises(projectedWorkout as WorkoutPlan).map(
        (exercise) => exercise.exercise.id,
      ),
    ).toEqual(["bench", "row", "overhead-press"]);
  });

  it("does not count incidental upper protected support trace as meaningful coverage", () => {
    const slotPolicy = resolveSessionSlotPolicy({
      sessionIntent: "upper",
      slotId: "upper_a",
      slotSequence: {
        slots: [
          { slotId: "upper_a", intent: "UPPER", sequenceIndex: 0 },
          { slotId: "upper_b", intent: "UPPER", sequenceIndex: 1 },
        ],
      },
    }).currentSession;

    const incidentalTrace = evaluateUpperProtectedSupportQuality({
      slotPolicy,
      protectedMuscles: ["Chest", "Triceps", "Rear Delts"],
      contributionByMuscle: new Map([
        ["Chest", 2],
        ["Triceps", 1.9],
        ["Rear Delts", 2],
      ]),
    });
    const meaningfulCoverage = evaluateUpperProtectedSupportQuality({
      slotPolicy,
      protectedMuscles: ["Chest", "Triceps", "Rear Delts"],
      contributionByMuscle: new Map([
        ["Chest", 2],
        ["Triceps", 2],
        ["Rear Delts", 2],
      ]),
    });

    expect(incidentalTrace.satisfied).toBe(false);
    expect(incidentalTrace.missingMuscles).toEqual(["Triceps"]);
    expect(meaningfulCoverage.satisfied).toBe(true);
  });

  it("treats redundant pull work as lower-quality upper_a support repair than directional push support", () => {
    const slotPolicy = resolveSessionSlotPolicy({
      sessionIntent: "upper",
      slotId: "upper_a",
      slotSequence: {
        slots: [
          { slotId: "upper_a", intent: "UPPER", sequenceIndex: 0 },
          { slotId: "upper_b", intent: "UPPER", sequenceIndex: 1 },
        ],
      },
    }).currentSession;
    const basePulls = [
      makeProjectedExercise({
        id: "row",
        name: "Row",
        movementPatterns: ["horizontal_pull"],
        primaryMuscles: ["Upper Back", "Lats"],
      }),
      makeProjectedExercise({
        id: "pulldown",
        name: "Pulldown",
        movementPatterns: ["vertical_pull"],
        primaryMuscles: ["Lats"],
      }),
    ];
    const pullBloatWorkout = makeProjectedWorkout({
      mainLifts: [
        makeProjectedExercise({
          id: "bench",
          name: "Bench Press",
          movementPatterns: ["horizontal_push"],
          primaryMuscles: ["Chest"],
        }),
      ],
      accessories: [
        ...basePulls,
        makeProjectedExercise({
          id: "extra-row",
          name: "Extra Row",
          movementPatterns: ["horizontal_pull"],
          primaryMuscles: ["Upper Back", "Lats"],
        }),
      ],
    });
    const directionalRepairWorkout = makeProjectedWorkout({
      mainLifts: [
        makeProjectedExercise({
          id: "bench",
          name: "Bench Press",
          movementPatterns: ["horizontal_push"],
          primaryMuscles: ["Chest"],
        }),
      ],
      accessories: [
        ...basePulls,
        makeProjectedExercise({
          id: "triceps",
          name: "Triceps Pressdown",
          movementPatterns: ["isolation"],
          primaryMuscles: ["Triceps"],
          isCompound: false,
        }),
        makeProjectedExercise({
          id: "rear-delt",
          name: "Rear Delt Fly",
          movementPatterns: ["isolation"],
          primaryMuscles: ["Rear Delts"],
          isCompound: false,
        }),
      ],
    });

    const pullBloat = evaluateUpperSupportTypeQuality({
      slotPolicy,
      workout: pullBloatWorkout,
      contributionByMuscle: new Map([
        ["Chest", 2],
        ["Triceps", 0.8],
        ["Rear Delts", 0.8],
      ]),
    });
    const directionalRepair = evaluateUpperSupportTypeQuality({
      slotPolicy,
      workout: directionalRepairWorkout,
      contributionByMuscle: new Map([
        ["Chest", 2],
        ["Triceps", 2],
        ["Rear Delts", 2],
      ]),
    });

    expect(pullBloat.redundantPullSupportCount).toBeGreaterThan(0);
    expect(directionalRepair.redundantPullSupportCount).toBe(0);
    expect(directionalRepair.pushShortfallToFloor).toBeLessThan(
      pullBloat.pushShortfallToFloor,
    );
    expect(directionalRepair.directionalCoveredMuscleCount).toBeGreaterThan(
      pullBloat.directionalCoveredMuscleCount,
    );
  });

  it("scores lower_b as higher quality when the hinge is the primary compound anchor", () => {
    const slotPolicy = resolveSessionSlotPolicy({
      sessionIntent: "lower",
      slotId: "lower_b",
      slotSequence: {
        slots: [
          { slotId: "lower_a", intent: "LOWER", sequenceIndex: 0 },
          { slotId: "lower_b", intent: "LOWER", sequenceIndex: 1 },
        ],
      },
    }).currentSession;
    const squatFirst = evaluateLowerPatternPrimacy({
      slotPolicy,
      workout: makeProjectedWorkout({
        mainLifts: [
          makeProjectedExercise({
            id: "squat",
            name: "Back Squat",
            movementPatterns: ["squat"],
            primaryMuscles: ["Quads"],
            sets: 4,
          }),
        ],
        accessories: [
          makeProjectedExercise({
            id: "rdl",
            name: "Romanian Deadlift",
            movementPatterns: ["hinge"],
            primaryMuscles: ["Hamstrings"],
            sets: 3,
          }),
        ],
      }),
    });
    const hingeFirst = evaluateLowerPatternPrimacy({
      slotPolicy,
      workout: makeProjectedWorkout({
        mainLifts: [
          makeProjectedExercise({
            id: "rdl",
            name: "Romanian Deadlift",
            movementPatterns: ["hinge"],
            primaryMuscles: ["Hamstrings"],
            sets: 4,
          }),
        ],
        accessories: [
          makeProjectedExercise({
            id: "squat",
            name: "Squat Support",
            movementPatterns: ["squat"],
            primaryMuscles: ["Quads"],
            sets: 2,
          }),
        ],
      }),
    });

    expect(hingeFirst.primaryPatternScore).toBeGreaterThan(
      squatFirst.primaryPatternScore,
    );
    expect(hingeFirst.squatDominancePenalty).toBeLessThan(
      squatFirst.squatDominancePenalty,
    );
    expect(hingeFirst.hingeCompoundSetCount).toBeGreaterThanOrEqual(
      hingeFirst.squatCompoundSetCount,
    );
  });

  it("is deterministic for the same snapshot and draft inputs", () => {
    const input = {
      userId: "user-1",
      source: buildSource(),
      design: buildDesign(),
      snapshot: buildSnapshot(),
      now: new Date("2026-03-19T12:00:00.000Z"),
    };

    const first = projectSuccessorSlotPlansFromSnapshot(input);
    const second = projectSuccessorSlotPlansFromSnapshot(input);

    expect(first).toEqual(second);
  });

  it("keeps projected slot-plan seeds minimal while preserving final set counts", () => {
    const design = buildDesign();
    const slotSequence = {
      version: 1 as const,
      source: "handoff_draft" as const,
      sequenceMode: "ordered_flexible" as const,
      slots: design.structure.slots,
    };
    const seed = buildMesocycleSlotPlanSeed({
      slotSequence,
      slotPlans: design.structure.slots.map((slot, index) => ({
        slotId: slot.slotId,
        intent: slot.intent,
        exercises: [
          {
            exerciseId: index === 0 ? "plank" : `exercise-${index}`,
            name: index === 0 ? "Plank" : `Exercise ${index}`,
            role: "ACCESSORY",
            setCount: index + 2,
          },
        ],
      })),
    });

    expect(seed.slots[0]?.exercises[0]).toEqual({
      exerciseId: "plank",
      role: "ACCESSORY",
      setCount: 2,
    });
    expect(seed.slots[0]).not.toHaveProperty("intent");
  });

  it("builds seeds from the final repaired projection set counts", () => {
    const projected = projectSuccessorSlotPlansFromSnapshot({
      userId: "user-1",
      source: buildSource(),
      design: buildDesign(buildRepairSensitiveDraft()),
      snapshot: buildProtectedCoverageSatisfiedSnapshot(),
      now: new Date("2026-03-19T12:00:00.000Z"),
    });
    expect("error" in projected).toBe(false);
    if ("error" in projected) return;

    const seed = buildMesocycleSlotPlanSeed({
      slotSequence: {
        version: 1,
        source: "handoff_draft",
        sequenceMode: "ordered_flexible",
        slots: buildDesign(buildRepairSensitiveDraft()).structure.slots,
      },
      slotPlans: projected.slotPlans,
    });
    const seededExercises = seed.slots.flatMap((slot) => slot.exercises);

    expect(
      seededExercises.find((exercise) => exercise.exerciseId.includes("calf"))
        ?.setCount,
    ).toBeGreaterThanOrEqual(MIN_PROJECTED_ACCESSORY_SETS_PER_EXERCISE);
    expect(
      seededExercises
        .filter((exercise) =>
          ["lateral-raise", "cable-lateral-raise"].includes(
            exercise.exerciseId,
          ),
        )
        .reduce((sum, exercise) => sum + exercise.setCount, 0),
    ).toBeGreaterThanOrEqual(4);
    expect(seededExercises.every((exercise) => exercise.setCount > 0)).toBe(
      true,
    );
  });

  it("redistributes sub-floor projection sets instead of keeping 1-set exercises", () => {
    const workout = makeProjectedWorkout({
      mainLifts: [
        makeProjectedExercise({
          id: "bench",
          name: "Bench Press",
          movementPatterns: ["horizontal_push"],
          primaryMuscles: ["Chest"],
          sets: 2,
          isMainLift: true,
        }),
      ],
      accessories: [
        makeProjectedExercise({
          id: "row",
          name: "Chest-Supported Row",
          movementPatterns: ["horizontal_pull"],
          primaryMuscles: ["Lats"],
          sets: 1,
        }),
        makeProjectedExercise({
          id: "fly",
          name: "Cable Fly",
          movementPatterns: ["isolation"],
          primaryMuscles: ["Chest"],
          sets: 4,
          isCompound: false,
        }),
      ],
    });
    const beforeSetTotal = [
      ...workout.mainLifts,
      ...workout.accessories,
    ].reduce((sum, exercise) => sum + exercise.sets.length, 0);

    const [projectedSlot] = applyFinalMinimumViableSetRedistribution({
      projectedSlots: [
        {
          slotPlan: {
            slotId: "upper_a",
            intent: "UPPER",
            exercises: [],
          },
          workout,
          projectedContributionByMuscle: new Map(),
          repairMuscles: [],
        },
      ],
      slotSequenceEntries: buildSlotSequenceEntries([
        { slotId: "upper_a", intent: "UPPER" },
        { slotId: "upper_b", intent: "UPPER" },
      ]),
    });
    const exercises = projectedSlot?.slotPlan.exercises ?? [];
    const afterSetTotal = exercises.reduce(
      (sum, exercise) => sum + exercise.setCount,
      0,
    );

    expect(afterSetTotal).toBeLessThanOrEqual(beforeSetTotal);
    expect(exercises.every((exercise) => exercise.setCount > 1)).toBe(true);
    expect(
      exercises.every(
        (exercise) =>
          exercise.setCount >= getMinimumViableSetCount(exercise.role),
      ),
    ).toBe(true);
    expect(
      Math.max(...exercises.map((exercise) => exercise.setCount)),
    ).toBeLessThanOrEqual(4);
  });

  it("projects repeated intents into distinct slot plans in slot order", () => {
    const projected = projectSuccessorSlotPlansFromSnapshot({
      userId: "user-1",
      source: buildSource(),
      design: buildDesign(),
      snapshot: buildSnapshot(),
      now: new Date("2026-03-19T12:00:00.000Z"),
    });

    const slotPlans = getProjectedSlotPlans(projected);
    const upperA = slotPlans.find((slot) => slot.slotId === "upper_a");
    const upperB = slotPlans.find((slot) => slot.slotId === "upper_b");
    const lowerA = slotPlans.find((slot) => slot.slotId === "lower_a");
    const lowerB = slotPlans.find((slot) => slot.slotId === "lower_b");

    expect(upperA?.exercises.length).toBeGreaterThan(0);
    expect(upperB?.exercises.length).toBeGreaterThan(0);
    expect(lowerA?.exercises.length).toBeGreaterThan(0);
    expect(lowerB?.exercises.length).toBeGreaterThan(0);
    expect(upperA?.slotId).toBe("upper_a");
    expect(upperB?.slotId).toBe("upper_b");
    expect(
      upperA?.exercises.map((exercise) => exercise.exerciseId),
    ).not.toEqual(upperB?.exercises.map((exercise) => exercise.exerciseId));
  });

  it("reuses the extracted generation seam for each projected slot", () => {
    composeIntentSessionFromMappedContextSpy.mockClear();

    projectSuccessorSlotPlansFromSnapshot({
      userId: "user-1",
      source: buildSource(),
      design: buildDesign(),
      snapshot: buildSnapshot(),
      now: new Date("2026-03-19T12:00:00.000Z"),
    });

    const slotIds = composeIntentSessionFromMappedContextSpy.mock.calls.map(
      ([, input]) => input.slotId,
    );

    expect(slotIds.length).toBeGreaterThanOrEqual(14);
    expect(slotIds[0]).toBe("upper_a");
    expect(slotIds.at(-1)).toBe("lower_b");
    expect(slotIds).toEqual(
      expect.arrayContaining(["upper_a", "lower_a", "upper_b", "lower_b"]),
    );

    const firstLowerA = slotIds.indexOf("lower_a");
    const firstUpperB = slotIds.indexOf("upper_b");
    const firstLowerB = slotIds.indexOf("lower_b");

    expect(firstLowerA).toBeGreaterThan(slotIds.indexOf("upper_a"));
    expect(firstUpperB).toBeGreaterThan(firstLowerA);
    expect(firstLowerB).toBeGreaterThan(firstUpperB);
  });

  it("keeps later duplicate-intent slots sensitive to earlier projected work", () => {
    const projected = projectSuccessorSlotPlansFromSnapshot({
      userId: "user-1",
      source: buildSource(),
      design: buildDesign(),
      snapshot: buildSnapshot(),
      now: new Date("2026-03-19T12:00:00.000Z"),
    });

    const slotPlans = getProjectedSlotPlans(projected);
    const upperA = slotPlans.find((slot) => slot.slotId === "upper_a");
    const upperB = slotPlans.find((slot) => slot.slotId === "upper_b");
    const lowerA = slotPlans.find((slot) => slot.slotId === "lower_a");
    const lowerB = slotPlans.find((slot) => slot.slotId === "lower_b");

    expect(upperA?.exercises.map((exercise) => exercise.exerciseId)).toContain(
      "bench",
    );
    expect(upperB?.exercises.map((exercise) => exercise.exerciseId)).toContain(
      "bench",
    );
    expect(lowerA?.exercises.map((exercise) => exercise.exerciseId)).toContain(
      "squat",
    );
    expect(
      (lowerB?.exercises.map((exercise) => exercise.exerciseId) ?? []).some(
        (exerciseId) =>
          ["rdl", "hack-squat", "hip-thrust"].includes(exerciseId),
      ),
    ).toBe(true);
    expect(
      upperA?.exercises.map((exercise) => exercise.exerciseId),
    ).not.toEqual(upperB?.exercises.map((exercise) => exercise.exerciseId));
    expect(
      lowerA?.exercises.map((exercise) => exercise.exerciseId),
    ).not.toEqual(lowerB?.exercises.map((exercise) => exercise.exerciseId));
  });

  it("rebalances repeated upper slots toward push support without flattening or inflating them", () => {
    const projected = projectSuccessorSlotPlansFromSnapshot({
      userId: "user-1",
      source: buildSource(),
      design: buildDesign(buildRepairSensitiveDraft()),
      snapshot: buildProtectedCoverageSatisfiedSnapshot(),
      now: new Date("2026-03-19T12:00:00.000Z"),
    });

    const upperA = getProjectedSlotPlans(projected).find(
      (slot) => slot.slotId === "upper_a",
    );
    const upperB = getProjectedSlotPlans(projected).find(
      (slot) => slot.slotId === "upper_b",
    );
    const upperAExerciseIds =
      upperA?.exercises.map((exercise) => exercise.exerciseId) ?? [];
    const upperBExerciseIds =
      upperB?.exercises.map((exercise) => exercise.exerciseId) ?? [];
    const upperPairExerciseIds = [...upperAExerciseIds, ...upperBExerciseIds];

    expect(upperAExerciseIds).not.toEqual(upperBExerciseIds);
    expect(upperPairExerciseIds).toEqual(expect.arrayContaining(["bench"]));
    expect(
      upperPairExerciseIds.some((exerciseId) =>
        ["machine-press", "incline-press", "cable-fly"].includes(exerciseId),
      ),
    ).toBe(true);
    expect(
      upperPairExerciseIds.some((exerciseId) =>
        ["triceps-pressdown", "overhead-triceps-extension"].includes(
          exerciseId,
        ),
      ),
    ).toBe(true);
    expect(upperPairExerciseIds).toEqual(
      expect.arrayContaining(["lateral-raise"]),
    );
    expect(
      upperPairExerciseIds.some((exerciseId) =>
        ["row", "seated-row", "pulldown"].includes(exerciseId),
      ),
    ).toBe(true);
    expect(
      upperAExerciseIds.some((exerciseId) =>
        ["row", "seated-row", "pulldown"].includes(exerciseId),
      ) ||
        upperBExerciseIds.some((exerciseId) =>
          ["row", "seated-row", "pulldown"].includes(exerciseId),
        ),
    ).toBe(true);
    expect(
      upperAExerciseIds.filter((exerciseId) =>
        ["row", "seated-row"].includes(exerciseId),
      ).length,
    ).toBeLessThanOrEqual(1);
    expect(upperAExerciseIds.length).toBeLessThanOrEqual(6);
    expect(upperBExerciseIds.length).toBeLessThanOrEqual(6);
    expect(
      [...(upperA?.exercises ?? []), ...(upperB?.exercises ?? [])].every(
        (exercise) => exercise.setCount <= 5,
      ),
    ).toBe(true);
    const chest = getCoverageRow(projected, "Chest");
    expect(chest?.projectedEffectiveSets ?? 0).toBeGreaterThanOrEqual(
      chest?.mev ?? 0,
    );
  });

  it("allocates hard weekly primary obligations across compatible slots before support repair", () => {
    const projected = projectSuccessorSlotPlansFromSnapshot({
      userId: "user-1",
      source: buildSource(),
      design: buildDesign(buildRepairSensitiveDraft()),
      snapshot: buildProtectedCoverageSatisfiedSnapshot(),
      now: new Date("2026-03-19T12:00:00.000Z"),
    });

    const plan = projected.diagnostics?.weeklyObligations?.plan;

    expect(plan?.muscles.Chest.targetSets).toBe(10);
    expect(plan?.muscles.Lats.targetSets).toBe(8);
    expect(plan?.muscles.Quads.targetSets).toBe(8);
    expect(plan?.muscles.Hamstrings.targetSets).toBe(6);
    expect(
      plan?.muscles.Chest.allocatedSlots.map((slot) => slot.slotId),
    ).toEqual(["upper_a", "upper_b"]);
    expect(
      plan?.muscles.Lats.allocatedSlots.map((slot) => slot.slotId),
    ).toEqual(["upper_a", "upper_b"]);
    expect(
      plan?.muscles.Quads.allocatedSlots.map((slot) => slot.slotId),
    ).toEqual(["lower_a", "lower_b"]);
    expect(
      plan?.muscles.Hamstrings.allocatedSlots.map((slot) => slot.slotId),
    ).toEqual(["lower_a", "lower_b"]);
  });

  it("emits read-only weekly demand, slot allocation, repair, and concentration diagnostics", () => {
    const projected = projectSuccessorSlotPlansFromSnapshot({
      userId: "user-1",
      source: buildSource(),
      design: buildDesign(buildRepairSensitiveDraft()),
      snapshot: buildProtectedCoverageSatisfiedSnapshot(),
      now: new Date("2026-03-19T12:00:00.000Z"),
    });

    expect("error" in projected).toBe(false);
    if ("error" in projected) return;

    const diagnostic = projected.diagnostics?.planningReality;
    expect(diagnostic).toMatchObject({
      label: "weekly demand / slot allocation diagnostics",
      readOnly: true,
      affectsScoringOrGeneration: false,
      summary: {
        explicitWeeklyDemandMuscles: 4,
      },
    });
    expect(diagnostic?.summary.planningShape).toMatch(
      /^(mostly_upstream_planned|mixed_upstream_plus_repair_shaped|mostly_repair_shaped)$/,
    );
    expect(diagnostic?.weeklyMuscleDemand).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          muscle: "Chest",
          targetStatus: "hard",
          explicitUpstream: true,
        }),
        expect.objectContaining({
          muscle: "Side Delts",
          targetStatus: "soft",
          inferredDownstream: true,
        }),
      ]),
    );
    expect(diagnostic?.slotDemandAllocation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slotId: "upper_a",
          allocationBasis: "explicit_weekly_demand",
          satisfiesKnownWeeklyDemand: true,
        }),
      ]),
    );
    expect(diagnostic?.slotPrescriptionIntents).toEqual(expect.any(Array));
    expect(diagnostic?.setDistributionIntents).toEqual(expect.any(Array));
    expect(diagnostic?.exerciseClassDistributionBySlot).toEqual(expect.any(Array));
    expect(diagnostic?.exerciseClassDistributionBySlot[0]).toMatchObject({
      readOnly: true,
      affectsScoringOrGeneration: false,
    });
    expect(diagnostic?.exerciseClassAlignment).toMatchObject({
      version: 1,
      source: "diagnostic_shadow_planner",
      readOnly: true,
      affectsScoringOrGeneration: false,
      summary: expect.objectContaining({
        initiallySatisfied: expect.any(Number),
        finallySatisfied: expect.any(Number),
        identityChurnCount: expect.any(Number),
        unresolvedClassIntentCount: expect.any(Number),
      }),
    });
    expect(diagnostic?.exerciseClassUnresolvedCauses).toEqual(expect.any(Array));
    expect(diagnostic?.cleanupCandidateFeasibility).toEqual(expect.any(Array));
    expect(JSON.stringify(diagnostic?.exerciseClassAlignment).length).toBeLessThan(30000);
    expect(JSON.stringify(projected.slotPlans)).not.toContain(
      "exerciseClassAlignment",
    );
    expect(JSON.stringify(projected.slotPlans)).not.toContain(
      "cleanupCandidateFeasibility",
    );
    const slotPrescriptionIntents = diagnostic?.slotPrescriptionIntents ?? [];
    const setDistributionIntents = diagnostic?.setDistributionIntents ?? [];
    const exerciseClassDistributions =
      diagnostic?.exerciseClassDistributionBySlot ?? [];
    const upperAIntent = slotPrescriptionIntents.find(
      (intent) => intent.slotId === "upper_a",
    );
    const upperBIntent = slotPrescriptionIntents.find(
      (intent) => intent.slotId === "upper_b",
    );
    const lowerAIntent = slotPrescriptionIntents.find(
      (intent) => intent.slotId === "lower_a",
    );
    const lowerBIntent = slotPrescriptionIntents.find(
      (intent) => intent.slotId === "lower_b",
    );
    const upperAChest = upperAIntent?.musclePrescriptions.find(
      (row) => row.muscle === "Chest",
    );
    const lowerBChest = lowerBIntent?.musclePrescriptions.find(
      (row) => row.muscle === "Chest",
    );
    const upperBSideDelts = upperBIntent?.musclePrescriptions.find(
      (row) => row.muscle === "Side Delts",
    );
    const upperARearDelts = upperAIntent?.musclePrescriptions.find(
      (row) => row.muscle === "Rear Delts",
    );
    const upperATriceps = upperAIntent?.musclePrescriptions.find(
      (row) => row.muscle === "Triceps",
    );
    const upperABiceps = upperAIntent?.musclePrescriptions.find(
      (row) => row.muscle === "Biceps",
    );
    const lowerBHams = lowerBIntent?.musclePrescriptions.find(
      (row) => row.muscle === "Hamstrings",
    );
    const upperASetDistribution = setDistributionIntents.find(
      (intent) => intent.slotId === "upper_a",
    );
    const upperBSetDistribution = setDistributionIntents.find(
      (intent) => intent.slotId === "upper_b",
    );
    const lowerBSetDistribution = setDistributionIntents.find(
      (intent) => intent.slotId === "lower_b",
    );
    const upperAChestDistribution =
      upperASetDistribution?.musclePolicies.find(
        (row) => row.muscle === "Chest",
      );
    const upperBSetSideDelts =
      upperBSetDistribution?.musclePolicies.find(
        (row) => row.muscle === "Side Delts",
      );
    const upperAUpperBackDistribution =
      upperASetDistribution?.musclePolicies.find(
        (row) => row.muscle === "Upper Back",
      );
    const lowerBChestDistribution =
      lowerBSetDistribution?.musclePolicies.find(
        (row) => row.muscle === "Chest",
      );
    const upperAChestClass =
      exerciseClassDistributions
        .find((slot) => slot.week === 1 && slot.slotId === "upper_a")
        ?.muscleDemands.find((row) => row.muscle === "Chest");
    const upperBChestClass =
      exerciseClassDistributions
        .find((slot) => slot.week === 1 && slot.slotId === "upper_b")
        ?.muscleDemands.find((row) => row.muscle === "Chest");
    const lowerBChestClass =
      exerciseClassDistributions
        .find((slot) => slot.week === 1 && slot.slotId === "lower_b")
        ?.muscleDemands.find((row) => row.muscle === "Chest");
    const lowerBHamstringsClass =
      exerciseClassDistributions
        .find((slot) => slot.week === 1 && slot.slotId === "lower_b")
        ?.muscleDemands.find((row) => row.muscle === "Hamstrings");
    const upperBSideDeltsClass =
      exerciseClassDistributions
        .find((slot) => slot.week === 1 && slot.slotId === "upper_b")
        ?.muscleDemands.find((row) => row.muscle === "Side Delts");
    const upperARearDeltsClass =
      exerciseClassDistributions
        .find((slot) => slot.week === 1 && slot.slotId === "upper_a")
        ?.muscleDemands.find((row) => row.muscle === "Rear Delts");
    const upperATricepsClass =
      exerciseClassDistributions
        .find((slot) => slot.week === 1 && slot.slotId === "upper_a")
        ?.muscleDemands.find((row) => row.muscle === "Triceps");
    const lowerBCalvesClass =
      exerciseClassDistributions
        .find((slot) => slot.week === 1 && slot.slotId === "lower_b")
        ?.muscleDemands.find((row) => row.muscle === "Calves");

    expect(upperAChest).toMatchObject({
      role: "primary",
      targetStatus: "hard",
      demandType: "direct_required",
    });
    expect(
      lowerAIntent?.musclePrescriptions.find((row) => row.muscle === "Chest"),
    ).toMatchObject({
      targetStatus: "forbidden",
      demandType: "do_not_train_here",
    });
    expect(lowerBChest).toMatchObject({
      targetStatus: "forbidden",
      demandType: "do_not_train_here",
      maxEffectiveSets: 0,
    });
    expect(upperAChestClass).toMatchObject({
      targetStatus: "hard",
      demandType: "direct_required",
      preferredSetSplit: "two_distinct_exercises",
      requiredExerciseClasses: expect.arrayContaining(["press"]),
      preferredExerciseClasses: expect.arrayContaining([
        "press",
        "horizontal_press",
        "incline_press",
        "machine_press",
        "chest_fly",
        "cable_fly",
        "chest_isolation",
      ]),
      limitations: expect.arrayContaining([
        "upper_chest_slots_should_use_distinct_class_intent_when_inventory_supports_it",
      ]),
    });
    expect(upperBChestClass?.preferredExerciseClasses).toEqual(
      expect.arrayContaining(["machine_press", "chest_fly", "cable_fly"]),
    );
    expect(lowerBChestClass).toMatchObject({
      targetStatus: "forbidden",
      demandType: "do_not_train_here",
      preferredSetSplit: "forbidden",
      forbiddenExerciseClasses: expect.arrayContaining([
        "press",
        "horizontal_press",
        "incline_press",
        "machine_press",
        "chest_fly",
        "cable_fly",
        "chest_isolation",
      ]),
      limitations: expect.arrayContaining(["lower_slots_forbid_chest_targeting"]),
    });
    expect(getClassCause(diagnostic!, "lower_b", "Chest")).toMatchObject({
      owningCause: "diagnostic_only_not_actionable",
      recommendedOwner: "leave_unresolved",
      behaviorReadiness: "do_not_act",
    });
    expect(upperBSideDelts).toMatchObject({
      targetStatus: "soft",
      demandType: "soft_direct_allowed",
    });
    expect(upperBSideDelts?.reasons).toEqual(
      expect.arrayContaining([
        "cap_duplicate_lateral_raise_identities_and_set_stacking",
      ]),
    );
    expect(upperBSideDeltsClass).toMatchObject({
      targetStatus: "soft",
      demandType: "soft_direct_allowed",
      preferredExerciseClasses: expect.arrayContaining([
        "lateral_raise",
        "vertical_press_overlap",
      ]),
      duplicatePolicy: "discourage_if_alternative_exists",
      limitations: expect.arrayContaining([
        "prefer_low_collateral_direct_or_vertical_press_overlap",
        "avoid_ohp_overconcentration",
        "avoid_duplicate_lateral_raise_spam",
      ]),
    });
    expect(upperARearDelts?.collateralLimits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ muscle: "Upper Back" }),
        expect.objectContaining({ muscle: "Lats" }),
      ]),
    );
    expect(upperARearDelts?.reasons).toEqual(
      expect.arrayContaining([
        "generic_rows_or_pulls_do_not_count_as_clean_direct_rear_delt_closure",
        "pull_pattern_pressure_must_remain_capped",
      ]),
    );
    expect(upperARearDeltsClass).toMatchObject({
      preferredExerciseClasses: expect.arrayContaining([
        "rear_delt_isolation",
        "pull_overlap_with_direct_rear_delt_stimulus",
      ]),
      limitations: expect.arrayContaining([
        "direct_rear_delt_isolation_useful_but_pull_and_upper_back_collateral_constrained",
      ]),
    });
    expect(["overlap_preferred", "direct_if_under_floor"]).toContain(
      upperATriceps?.demandType,
    );
    expect(upperATricepsClass).toMatchObject({
      preferredExerciseClasses: expect.arrayContaining([
        "press_overlap",
        "triceps_isolation_if_under_floor",
      ]),
      preferredSetSplit: "overlap_first_then_isolation",
      limitations: expect.arrayContaining([
        "press_overlap_first_isolation_only_if_under_floor",
        "consumed_but_unmet_is_weak_evidence",
      ]),
    });
    expect(["overlap_preferred", "direct_if_under_floor"]).toContain(
      upperABiceps?.demandType,
    );
    expect(lowerBHams?.allowedExerciseClasses).toEqual(
      expect.arrayContaining(["hinge_compound", "knee_flexion_curl"]),
    );
    expect(lowerBHams?.collateralLimits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ muscle: "Lower Back" }),
        expect.objectContaining({ muscle: "Glutes" }),
      ]),
    );
    expect(lowerBHams?.reasons).toEqual(
      expect.arrayContaining([
        "hinge_stimulus_and_knee_flexion_curl_stimulus_are_distinct",
        "hinge_is_not_equivalent_to_curl",
      ]),
    );
    expect(lowerBHamstringsClass).toMatchObject({
      requiredExerciseClasses: expect.arrayContaining([
        "hinge_compound",
        "knee_flexion_curl",
      ]),
      preferredExerciseClasses: expect.arrayContaining([
        "stiff_leg_deadlift",
        "knee_flexion_curl",
        "leg_curl",
        "nordic_curl",
      ]),
      forbiddenExerciseClasses: expect.arrayContaining([
        "back_extension",
        "dirty_extension",
      ]),
      preferredSetSplit: "anchor_plus_isolation",
      limitations: expect.arrayContaining([
        "back_extension_is_not_clean_hamstrings_closure",
        "hinge_anchor_should_pair_with_knee_flexion_curl_when_clean_inventory_exists",
      ]),
    });
    expect(lowerBCalvesClass).toMatchObject({
      preferredExerciseClasses: expect.arrayContaining([
        "calf_raise",
        "standing_calf_raise",
        "seated_calf_raise",
      ]),
      forbiddenExerciseClasses: expect.arrayContaining([
        "same_session_duplicate_calf_isolation",
      ]),
      duplicatePolicy: "discourage_if_alternative_exists",
      limitations: expect.arrayContaining([
        "one_calf_isolation_per_lower_slot_unless_specialization",
        "avoid_same_session_duplicate_calf_variants",
      ]),
    });
    expect(diagnostic?.preselectionFeasibility).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slotId: "lower_b",
          muscle: "Hamstrings",
          readOnly: true,
          affectsScoringOrGeneration: false,
        }),
      ]),
    );
    const policy = diagnostic?.preselectionDistributionPolicyByWeek;
    expect(policy).toMatchObject({
      mesocycleId: expect.any(String),
      source: "diagnostic_shadow_planner",
      readOnly: true,
      affectsScoringOrGeneration: false,
      recommendedNextStep: "add_weekly_demand_curve_diagnostic",
    });
    expect(policy?.limitationCatalog).toEqual(expect.any(Object));
    expect(policy?.evidenceCatalog).toEqual(expect.any(Object));
    expect(policy?.affectsCatalog).toEqual(expect.any(Object));
    expect(policy?.limitations).toEqual(
      expect.arrayContaining([
        "weeks_2_to_4_unprojected",
        "missing_weekly_demand_curve",
        "missing_accumulation_progression_policy",
        "missing_per_week_slot_distribution",
        "missing_fatigue_carryover_model",
        "deload_distribution_not_projected",
        "missing_deload_identity_preservation_policy",
        "missing_deload_set_reduction_projection",
      ]),
    );
    if (!policy) {
      throw new Error("Expected preselectionDistributionPolicyByWeek");
    }
    const policyWeekOne = policy?.weeks.find((week) => week.week === 1);
    expect(policyWeekOne).toMatchObject({
      phase: "accumulation",
      projectionStatus: "projected_from_current_week_evidence",
      weekScope: "week_1_only",
    });
    const weekOneMusclePolicies =
      policyWeekOne?.slots.flatMap((slot) => slot.muscleDistributions) ?? [];
    for (const row of weekOneMusclePolicies) {
      expect(policy.affectsCatalog[row.affectsRef]).toEqual(expect.any(Object));
      for (const ref of row.evidenceRefs) {
        expect(policy.evidenceCatalog[ref]).toEqual(expect.any(String));
      }
      for (const ref of row.limitationRefs) {
        expect(policy.limitationCatalog[ref]).toEqual(expect.any(String));
      }
    }
    const resolveAffects = (
      row: (typeof weekOneMusclePolicies)[number] | undefined,
    ) => (row ? policy.affectsCatalog[row.affectsRef] : undefined);
    const resolveEvidence = (
      row: (typeof weekOneMusclePolicies)[number] | undefined,
    ) => row?.evidenceRefs.map((ref) => policy.evidenceCatalog[ref]) ?? [];
    const resolveLimitations = (
      row: (typeof weekOneMusclePolicies)[number] | undefined,
    ) => row?.limitationRefs.map((ref) => policy.limitationCatalog[ref]) ?? [];
    const chestPolicy = weekOneMusclePolicies.find(
      (row) => row.muscle === "Chest" && row.targetStatus === "hard",
    );
    const hamstringsPolicy = weekOneMusclePolicies.find(
      (row) => row.muscle === "Hamstrings" && row.targetStatus === "hard",
    );
    expect(weekOneMusclePolicies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          muscle: "Chest",
          targetStatus: "hard",
          role: "primary",
          demandType: "direct_required",
          preferredSetSplit: "two_distinct_exercises",
          affectsRef: expect.any(String),
          evidenceRefs: expect.any(Array),
          limitationRefs: expect.any(Array),
        }),
        expect.objectContaining({
          muscle: "Hamstrings",
          targetStatus: "hard",
          role: "primary",
          demandType: "direct_required",
          preferredSetSplit: "two_distinct_exercises",
          affectsRef: expect.any(String),
          evidenceRefs: expect.any(Array),
          limitationRefs: expect.any(Array),
        }),
        expect.objectContaining({
          muscle: "Side Delts",
          targetStatus: "soft",
          role: "support",
          demandType: "soft_direct_allowed",
        }),
        expect.objectContaining({
          muscle: "Calves",
          targetStatus: "soft",
        }),
      ]),
    );
    expect(resolveAffects(chestPolicy)).toEqual(
      expect.objectContaining({
        volumeProgression: true,
        setDistribution: true,
        runtimeAdaptation: false,
      }),
    );
    expect(resolveAffects(hamstringsPolicy)).toEqual(
      expect.objectContaining({
        fatigueManagement: true,
      }),
    );
    expect(resolveEvidence(chestPolicy)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("projectedDelivery:Chest"),
      ]),
    );
    expect(resolveLimitations(chestPolicy)).toEqual(
      expect.arrayContaining([
        "week_1_evidence_only",
        "diagnostic_shadow_policy_not_behavior",
        "does_not_affect_scoring_generation_repair_seed_or_runtime",
      ]),
    );
    expect(policy?.weeks.filter((week) => [2, 3, 4].includes(week.week))).toEqual(
      [
        expect.objectContaining({
          week: 2,
          projectionStatus: "not_projected_missing_weekly_demand_curve",
          slots: [],
          weekLevelWarnings: expect.arrayContaining([
            "weeks_2_to_4_unprojected",
            "missing_weekly_demand_curve",
            "missing_accumulation_progression_policy",
          ]),
        }),
        expect.objectContaining({
          week: 3,
          projectionStatus: "not_projected_missing_accumulation_policy",
          slots: [],
        }),
        expect.objectContaining({
          week: 4,
          projectionStatus: "not_projected_missing_accumulation_policy",
          slots: [],
        }),
      ],
    );
    expect(policy?.weeks.find((week) => week.phase === "deload")).toEqual(
      expect.objectContaining({
        week: 5,
        projectionStatus: "not_projected_missing_deload_policy",
        slots: [],
        weekLevelWarnings: expect.arrayContaining([
          "deload_distribution_not_projected",
          "missing_deload_identity_preservation_policy",
          "missing_deload_set_reduction_projection",
        ]),
      }),
    );
    expect(policy?.candidateBehaviorSlices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidate: "chest_upper_slot_distinct_exercise_distribution",
          recommendation: "best_future_behavior",
          weekScope: "accumulation_weeks",
          prereqs: expect.arrayContaining([
            "inventory/class visibility for distinct chest press/fly options",
            "week-by-week Chest demand",
            "duplicate continuity justification",
          ]),
        }),
        expect.objectContaining({
          candidate: "hamstrings_weekly_overdelivery_control",
          recommendation: "not_first",
          risk: expect.stringContaining("Hamstrings are already high"),
        }),
        expect.objectContaining({
          candidate: "side_delt_second_slot_support",
          recommendation: "diagnostic_only",
        }),
        expect.objectContaining({
          candidate: "duplicate_main_lift_suppression",
          recommendation: "not_first",
        }),
        expect.objectContaining({
          candidate: "calf_duplicate_suppression",
          recommendation: "later_cleanup",
        }),
      ]),
    );
    const weeklyDemandCurve = diagnostic?.weeklyDemandCurve;
    expect(weeklyDemandCurve).toMatchObject({
      mesocycleId: expect.any(String),
      source: "diagnostic_shadow_planner",
      readOnly: true,
      affectsScoringOrGeneration: false,
      designBasis: {
        durationWeeks: 5,
        intensityBias: "HYPERTROPHY",
        splitType: "UPPER_LOWER",
        sessionsPerWeek: 4,
      },
      candidateBehaviorGate: {
        status: "blocked_until_weekly_curve_is_visible",
        likelyBestFutureBehavior:
          "chest_upper_slot_distinct_exercise_distribution",
        requiredQuestions: expect.arrayContaining([
          "would_this_improve_weeks_1_to_4_not_just_week_1",
          "would_this_preserve_deload_quality",
          "would_this_increase_fatigue_concentration",
        ]),
      },
    });
    expect(weeklyDemandCurve?.weeks.map((week) => week.week)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(weeklyDemandCurve?.weeks[0]).toMatchObject({
      week: 1,
      phase: "entry",
      projectionStatus: "partially_projected_from_week_1",
      muscles: expect.arrayContaining([
        expect.objectContaining({
          muscle: "Chest",
          targetTier: "A_PRIMARY",
          targetStatus: "hard",
          role: "primary",
          currentEvidenceEffectiveSets: expect.any(Number),
          source: expect.arrayContaining([
            expect.stringContaining("week1_final="),
          ]),
        }),
      ]),
    });
    expect(weeklyDemandCurve?.weeks.filter((week) => [2, 3, 4].includes(week.week))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          week: 2,
          projectionStatus: "partially_projected_from_week_1",
          weekLevelLimitations: expect.arrayContaining([
            "missing_per_week_slot_distribution",
            "missing_fatigue_carryover_model",
            "missing_cross_week_exercise_continuity_policy",
          ]),
        }),
        expect.objectContaining({
          week: 4,
          phase: "peak",
          projectionStatus: "partially_projected_from_week_1",
        }),
      ]),
    );
    expect(weeklyDemandCurve?.weeks.find((week) => week.phase === "deload")).toMatchObject({
      week: 5,
      projectionStatus: "not_projected_missing_policy",
      weekLevelLimitations: expect.arrayContaining([
        "missing_deload_demand_curve",
        "missing_deload_identity_preservation_policy",
        "missing_deload_set_reduction_projection",
      ]),
      muscles: expect.arrayContaining([
        expect.objectContaining({
          muscle: "Chest",
          progressionIntent: "deload",
          preferredEffectiveSets: null,
        }),
      ]),
    });
    const slotDemandAllocationByWeek =
      diagnostic?.slotDemandAllocationByWeek;
    expect(slotDemandAllocationByWeek).toMatchObject({
      mesocycleId: expect.any(String),
      source: "diagnostic_shadow_planner",
      readOnly: true,
      affectsScoringOrGeneration: false,
    });
    expect(slotDemandAllocationByWeek?.weeks.map((week) => week.week)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(slotDemandAllocationByWeek?.weeks[0]).toMatchObject({
      week: 1,
      phase: "entry",
      projectionStatus: "allocated_from_current_week_evidence",
      weekLevelWarnings: expect.arrayContaining([
        "week_1_current_projection_evidence_only",
        "later_week_slot_allocation_not_inferred_from_week_1",
      ]),
      slots: expect.arrayContaining([
        expect.objectContaining({
          slotId: "upper_a",
          allocatedMuscles: expect.arrayContaining([
            expect.objectContaining({
              muscle: "Chest",
              role: "primary",
              targetStatus: "hard",
              weekScope: "week_1_only",
              allocationConfidence: "high",
            }),
            expect.objectContaining({
              muscle: "Lats",
              targetStatus: "hard",
            }),
          ]),
        }),
        expect.objectContaining({
          slotId: "upper_b",
          allocatedMuscles: expect.arrayContaining([
            expect.objectContaining({
              muscle: "Side Delts",
              role: "support",
              targetStatus: "soft",
            }),
          ]),
        }),
        expect.objectContaining({
          slotId: "lower_a",
          allocatedMuscles: expect.arrayContaining([
            expect.objectContaining({
              muscle: "Quads",
              role: "primary",
              targetStatus: "hard",
            }),
            expect.objectContaining({
              muscle: "Hamstrings",
              role: "primary",
              targetStatus: "hard",
            }),
          ]),
        }),
      ]),
    });
    expect(slotDemandAllocationByWeek?.weeks.filter((week) => [2, 3, 4].includes(week.week))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          week: 2,
          projectionStatus: "not_allocated_missing_weekly_projection",
          slots: [],
          weekLevelWarnings: expect.arrayContaining([
            "missing_per_week_slot_composition",
            "missing_fatigue_carryover_model",
            "missing_progression_adjusted_set_targets",
            "missing_cross_week_duplicate_justification",
            "missing_weekly_exercise_identity_policy",
          ]),
        }),
        expect.objectContaining({
          week: 4,
          projectionStatus: "not_allocated_missing_weekly_projection",
          slots: [],
        }),
      ]),
    );
    expect(slotDemandAllocationByWeek?.weeks.find((week) => week.phase === "deload")).toMatchObject({
      week: 5,
      projectionStatus: "not_allocated_missing_deload_policy",
      slots: [],
      weekLevelWarnings: expect.arrayContaining([
        "deload_slot_allocation_unprojected",
        "missing_deload_identity_preservation",
        "missing_deload_set_reduction_projection",
        "missing_deload_hard_support_target_adjustment",
      ]),
    });
    const accumulationWeekProjection =
      diagnostic?.accumulationWeekProjection;
    expect(accumulationWeekProjection).toMatchObject({
      mesocycleId: expect.any(String),
      source: "diagnostic_shadow_planner",
      readOnly: true,
      affectsScoringOrGeneration: false,
      projectionBasis: {
        sourceWeek: 1,
        method: "repeat_week_1_final_shape",
        limitations: expect.arrayContaining([
          "does_not_apply_true_progression_policy",
          "does_not_allocate_new_week_2_to_4_slot_distribution",
          "does_not_project_deload_identity_or_set_reduction",
          "does_not_affect_scoring_generation_repair_seed_or_runtime",
        ]),
      },
    });
    expect(accumulationWeekProjection?.weeks.map((week) => week.week)).toEqual([
      2, 3, 4,
    ]);
    expect(accumulationWeekProjection?.weeks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          week: 2,
          phase: "accumulation",
          projectionStatus: "partially_projected_missing_progression",
          projectedMuscles: expect.arrayContaining([
            expect.objectContaining({
              muscle: "Chest",
              targetStatus: "hard",
              projectedEffectiveSets: expect.any(Number),
              limitations: expect.arrayContaining([
                "repeated_week_1_final_shape_only",
                "not_true_week_progression",
              ]),
            }),
          ]),
          weekLevelWarnings: expect.arrayContaining([
            "missing_true_accumulation_progression_policy",
            "missing_per_week_slot_distribution",
            "deload_not_projected_here",
          ]),
        }),
        expect.objectContaining({
          week: 4,
          phase: "peak",
          projectionStatus: "partially_projected_missing_progression",
        }),
      ]),
    );
    expect(accumulationWeekProjection?.crossWeekWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "DELOAD_PRESERVATION_STILL_UNPROJECTED",
          severity: "warning",
        }),
      ]),
    );
    expect(accumulationWeekProjection?.candidateBehaviorReadiness).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidate: "chest_upper_slot_distinct_exercise_distribution",
          readiness: expect.stringMatching(
            /^(ready_for_bounded_trial|needs_more_projection)$/,
          ),
        }),
        expect.objectContaining({
          candidate: "hamstrings_weekly_overdelivery_control",
          readiness: "not_first",
        }),
        expect.objectContaining({
          candidate: "side_delt_second_slot_support",
          readiness: "diagnostic_only",
        }),
        expect.objectContaining({
          candidate: "duplicate_main_lift_suppression",
          readiness: "needs_more_projection",
        }),
      ]),
    );
    for (const collateralMuscle of [
      "Glutes",
      "Front Delts",
      "Lower Back",
      "Upper Back",
    ]) {
      const collateralRows =
        weeklyDemandCurve?.weeks.flatMap((week) =>
          week.muscles.filter((row) => row.muscle === collateralMuscle),
        ) ?? [];
      for (const row of collateralRows) {
        expect(row.targetStatus).toBe("diagnostic");
        expect(row.role).not.toBe("primary");
      }
    }
    expect(upperASetDistribution).toMatchObject({
      readOnly: true,
      affectsScoringOrGeneration: false,
      slotBudget: {
        preferredTotalSets: expect.any(Number),
        maxTotalSets: expect.any(Number),
        maxMainLifts: 2,
        maxDirectIsolationExercises: expect.any(Number),
      },
      evidence: {
        concentrationRows: expect.any(Array),
        capCleanupRows: expect.any(Array),
        repairRowsStillRepairOwned: expect.any(Array),
      },
    });
    expect(upperAChestDistribution).toMatchObject({
      targetStatus: "hard",
      demandType: "direct_required",
      preferredDistribution: "two_exercise_split",
      whenAtLimit: "prefer_alternative",
      maxSingleExerciseShare: 0.5,
      maxSinglePatternShare: 0.7,
    });
    expect(lowerBChestDistribution).toMatchObject({
      targetStatus: "forbidden",
      demandType: "do_not_train_here",
      preferredDistribution: "forbidden",
      whenAtLimit: "do_not_bump",
      maxDirectExercises: 0,
    });
    expect(upperBSetSideDelts).toMatchObject({
      targetStatus: "soft",
      demandType: "soft_direct_allowed",
      whenAtLimit: "prefer_alternative",
    });
    expect(["overlap_first", "two_exercise_split"]).toContain(
      upperBSetSideDelts?.preferredDistribution,
    );
    expect(upperAUpperBackDistribution).toMatchObject({
      targetStatus: "diagnostic",
      demandType: "diagnostic_only",
      preferredDistribution: "diagnostic_only",
      whenAtLimit: "leave_unresolved",
      maxSingleExerciseShare: null,
    });
    for (const collateralMuscle of [
      "Front Delts",
      "Upper Back",
      "Lower Back",
      "Glutes",
      "Forearms",
      "Core",
      "Adductors",
      "Abductors",
    ]) {
      const prescription = upperAIntent?.musclePrescriptions.find(
        (row) => row.muscle === collateralMuscle,
      );
      if (prescription) {
        expect(prescription).toMatchObject({
          role: "collateral",
          targetStatus: "diagnostic",
          demandType: "diagnostic_only",
        });
      }
    }
    expect(upperAIntent?.setBudget).toMatchObject({
      maxSetsPerMain: 5,
      maxSetsPerAccessory: 4,
    });
    expect(upperAIntent?.diversityBudget).toMatchObject({
      maxExerciseShareByMuscle: 0.5,
      maxPatternShareByMuscle: 0.7,
      maxDuplicateIsolationVariantsByMuscle: 1,
    });
    expect(diagnostic?.shadowWeeklyDemand).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          muscle: "Chest",
          targetTier: "A_PRIMARY",
          targetStatus: "hard",
          priority: "primary",
          desiredExposureCount: expect.any(Number),
        }),
        expect.objectContaining({
          muscle: "Lats",
          targetTier: "A_PRIMARY",
          targetStatus: "hard",
        }),
        expect.objectContaining({
          muscle: "Quads",
          targetTier: "A_PRIMARY",
          targetStatus: "hard",
        }),
        expect.objectContaining({
          muscle: "Hamstrings",
          targetTier: "A_PRIMARY",
          targetStatus: "hard",
        }),
        expect.objectContaining({
          muscle: "Side Delts",
          targetTier: "B_SUPPORT",
          targetStatus: "soft",
          priority: "support",
        }),
        expect.objectContaining({
          muscle: "Rear Delts",
          targetTier: "B_SUPPORT",
          targetStatus: "soft",
        }),
        expect.objectContaining({
          muscle: "Triceps",
          targetTier: "B_SUPPORT",
          targetStatus: "soft",
        }),
        expect.objectContaining({
          muscle: "Biceps",
          targetTier: "B_SUPPORT",
          targetStatus: "soft",
        }),
        expect.objectContaining({
          muscle: "Calves",
          targetTier: "B_SUPPORT",
          targetStatus: "soft",
        }),
      ]),
    );
    expect(diagnostic?.shadowSlotDemandAllocation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slotId: "upper_a",
          slotIndex: 0,
          slotArchetype: "upper_horizontal_balanced",
          allocatedMuscles: expect.arrayContaining([
            expect.objectContaining({ muscle: "Chest", targetStatus: "hard" }),
            expect.objectContaining({ muscle: "Lats", targetStatus: "hard" }),
            expect.objectContaining({
              muscle: "Triceps",
              targetStatus: "soft",
            }),
            expect.objectContaining({
              muscle: "Rear Delts",
              targetStatus: "soft",
            }),
            expect.objectContaining({ muscle: "Biceps", targetStatus: "soft" }),
          ]),
        }),
        expect.objectContaining({
          slotId: "lower_a",
          slotArchetype: "lower_squat_dominant",
          allocatedMuscles: expect.arrayContaining([
            expect.objectContaining({ muscle: "Quads", targetStatus: "hard" }),
            expect.objectContaining({
              muscle: "Hamstrings",
              targetStatus: "hard",
            }),
            expect.objectContaining({ muscle: "Calves", targetStatus: "soft" }),
          ]),
        }),
      ]),
    );
    expect(diagnostic?.initialSlotComposition).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slotId: "upper_a",
          exerciseCount: expect.any(Number),
          projectedEffectiveStimulusByMuscle: expect.any(Object),
        }),
      ]),
    );
    expect(diagnostic?.finalSlotPlan.map((slot) => slot.slotId)).toEqual(
      getProjectedSlotPlans(projected).map((slot) => slot.slotId),
    );
    expect(findFinalSlotForbiddenPrescriptionViolations(diagnostic)).toEqual(
      [],
    );
    expect(diagnostic?.allocationVsInitialDelta).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          comparison: "allocation_vs_initial",
          underAllocatedMuscles: expect.any(Array),
        }),
      ]),
    );
    expect(diagnostic?.allocationVsFinalDelta).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          comparison: "allocation_vs_final",
          responsibilityLoad: expect.stringMatching(
            /^(clear|overloaded|unclear)$/,
          ),
        }),
      ]),
    );
    expect(diagnostic?.repairMaterialityAfterShadowAllocation).toEqual(
      expect.any(Array),
    );
    expect(diagnostic?.projectedDelivery).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          muscle: "Chest",
          projectedEffectiveStimulusAfterInitialSlotComposition:
            expect.any(Number),
          projectedEffectiveStimulusAfterRepairAndFinalShaping:
            expect.any(Number),
          exposureCount: expect.any(Number),
        }),
      ]),
    );
    expect(diagnostic?.repairMateriality).toEqual(expect.any(Array));
    expect(diagnostic?.exerciseConcentration).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slotId: expect.any(String),
          exerciseName: expect.any(String),
          setCount: expect.any(Number),
          percentageOfWeeklyProjectedStimulusByMuscle: expect.any(Object),
        }),
      ]),
    );
    expect(diagnostic?.limitations).toEqual(
      expect.arrayContaining([expect.stringContaining("read-only")]),
    );
    expect(JSON.stringify(getProjectedSlotPlans(projected))).not.toContain(
      "shadow",
    );
    expect(JSON.stringify(getProjectedSlotPlans(projected))).not.toContain(
      "slotPrescriptionIntents",
    );
    expect(JSON.stringify(getProjectedSlotPlans(projected))).not.toContain(
      "setDistributionIntents",
    );
    expect(JSON.stringify(getProjectedSlotPlans(projected))).not.toContain(
      "preselectionDistributionPolicyByWeek",
    );
    expect(JSON.stringify(getProjectedSlotPlans(projected))).not.toContain(
      "weeklyDemandCurve",
    );
    expect(JSON.stringify(getProjectedSlotPlans(projected))).not.toContain(
      "slotDemandAllocationByWeek",
    );
    expect(JSON.stringify(getProjectedSlotPlans(projected))).not.toContain(
      "exerciseClassDistributionBySlot",
    );
    expect(JSON.stringify(getProjectedSlotPlans(projected))).not.toContain(
      "accumulationWeekProjection",
    );
  });

  it("surfaces cross-week demand risks without promoting behavior", () => {
    const slotSequence = [
      { slotId: "upper_a", intent: "UPPER" as const },
      { slotId: "lower_b", intent: "LOWER" as const },
      { slotId: "upper_b", intent: "UPPER" as const },
    ];
    const inclinePress = makeProjectedExercise({
      id: "incline-db-bench",
      name: "Incline DB Bench",
      movementPatterns: ["vertical_push"],
      primaryMuscles: ["Chest"],
      secondaryMuscles: ["Front Delts"],
      sets: 7,
      isCompound: true,
      stimulusProfile: { chest: 1, front_delts: 0.5 },
    });
    const hinge = makeProjectedExercise({
      id: "rdl-heavy",
      name: "Romanian Deadlift",
      movementPatterns: ["hinge"],
      primaryMuscles: ["Hamstrings", "Glutes"],
      secondaryMuscles: ["Lower Back"],
      sets: 8,
      isMainLift: true,
      stimulusProfile: { hamstrings: 1, glutes: 0.6, lower_back: 0.4 },
    });
    const lateralRaise = makeProjectedExercise({
      id: "lateral-raise-under",
      name: "Lateral Raise",
      movementPatterns: ["isolation"],
      primaryMuscles: ["Side Delts"],
      sets: 1,
      isCompound: false,
      stimulusProfile: { side_delts: 1 },
    });
    const row = makeProjectedExercise({
      id: "upper-back-row",
      name: "Chest-Supported Row",
      movementPatterns: ["horizontal_pull"],
      primaryMuscles: ["Upper Back"],
      sets: 2,
      stimulusProfile: { upper_back: 1 },
    });

    const diagnostic = buildWeeklyDemandSlotAllocationDiagnostic({
      activeMesocycle: buildSource() as never,
      slotSequence,
      initialProjectedSlots: [
        makeProjectedSlotWithContributions({
          slotId: "upper_a",
          intent: "UPPER",
          workout: makeProjectedWorkout({ mainLifts: [inclinePress] }),
        }),
        makeProjectedSlotWithContributions({
          slotId: "lower_b",
          intent: "LOWER",
          workout: makeProjectedWorkout({ mainLifts: [hinge] }),
        }),
        makeProjectedSlotWithContributions({
          slotId: "upper_b",
          intent: "UPPER",
          workout: makeProjectedWorkout({ accessories: [lateralRaise, row] }),
        }),
      ],
      finalProjectedSlots: [
        makeProjectedSlotWithContributions({
          slotId: "upper_a",
          intent: "UPPER",
          workout: makeProjectedWorkout({ mainLifts: [inclinePress] }),
        }),
        makeProjectedSlotWithContributions({
          slotId: "lower_b",
          intent: "LOWER",
          workout: makeProjectedWorkout({ mainLifts: [hinge] }),
        }),
        makeProjectedSlotWithContributions({
          slotId: "upper_b",
          intent: "UPPER",
          workout: makeProjectedWorkout({ accessories: [lateralRaise, row] }),
        }),
      ],
      weeklyObligationPlan: weeklyObligationPlan({
        Chest: {
          targetSets: 10,
          allocatedSlots: [
            { slotId: "upper_a", minEffectiveSets: 10, priority: "primary" },
          ],
        },
        Hamstrings: {
          targetSets: 6,
          allocatedSlots: [
            { slotId: "lower_b", minEffectiveSets: 6, priority: "primary" },
          ],
        },
      }),
      weeklyObligationEvaluations: [],
      protectedCoverage: evaluateProtectedWeekOneCoverage({
        projectedSlots: [],
        activeMesocycle: buildSource() as never,
        slotSequence,
      }),
      supportFloorRepairReasons: {},
      programQualityAppliedDiagnostics: [],
      programQualityEvaluation: evaluateProgramQualityConstraints({
        projectedSlots: [],
        exerciseLibrary: [],
      }),
      preselectionDemands: [
        {
          slotId: "upper_b",
          muscle: "Side Delts",
          role: "support",
          targetStatus: "soft",
          minEffectiveSets: 2,
          preferredEffectiveSets: 2,
          selectedEffectiveSets: 1,
          consumedBySelection: true,
          targetMet: false,
        },
      ],
      duplicateExerciseReuse: [
        {
          exerciseId: "incline-db-bench",
          name: "Incline DB Bench",
          repeatedInSlotId: "upper_b",
          previousSlotIds: ["upper_a"],
          role: "main",
          hasCompatibleAlternative: true,
          reason: "main_lift_duplicate_discouraged",
        },
        {
          exerciseId: "rdl-heavy",
          name: "Romanian Deadlift",
          repeatedInSlotId: "lower_b",
          previousSlotIds: ["lower_a"],
          role: "main",
          hasCompatibleAlternative: true,
          reason: "main_lift_duplicate_discouraged",
        },
      ],
    });

    const curve = diagnostic.weeklyDemandCurve;
    const weekOneChest = curve.weeks[0]?.muscles.find(
      (row) => row.muscle === "Chest",
    );
    const weekOneHamstrings = curve.weeks[0]?.muscles.find(
      (row) => row.muscle === "Hamstrings",
    );
    const weekOneSideDelts = curve.weeks[0]?.muscles.find(
      (row) => row.muscle === "Side Delts",
    );

    expect(weekOneChest).toMatchObject({
      targetStatus: "hard",
      preferredEffectiveSets: 10,
      currentEvidenceEffectiveSets: 7,
    });
    expect(weekOneHamstrings).toMatchObject({
      targetStatus: "hard",
      preferredEffectiveSets: 6,
      currentEvidenceEffectiveSets: 8,
    });
    expect(weekOneSideDelts).toMatchObject({
      targetStatus: "soft",
      preferredEffectiveSets: 8,
      currentEvidenceEffectiveSets: 1,
    });
    expect(curve.crossWeekWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "PRIMARY_UNDER_TARGET_ACROSS_ACCUMULATION",
          muscle: "Chest",
          severity: "warning",
          evidence: expect.arrayContaining([
            "week1_final=7:preferred=10",
            expect.stringContaining("Incline DB Bench"),
          ]),
        }),
        expect.objectContaining({
          code: "MUSCLE_OVERDELIVERED_ACROSS_ACCUMULATION",
          muscle: "Hamstrings",
          severity: "warning",
          evidence: expect.arrayContaining([
            "week1_final=8:preferred=6",
          ]),
        }),
        expect.objectContaining({
          code: "SUPPORT_UNDER_TARGET_ACROSS_ACCUMULATION",
          muscle: "Side Delts",
          severity: "warning",
          evidence: expect.arrayContaining([
            "week1_final=1:preferred=8",
          ]),
        }),
        expect.objectContaining({
          code: "DELOAD_PRESERVATION_UNPROJECTED",
        }),
        expect.objectContaining({
          code: "WEEKLY_DEMAND_POLICY_MISSING",
        }),
      ]),
    );
    const allocationByWeek = diagnostic.slotDemandAllocationByWeek;
    const weekOneAllocation = allocationByWeek.weeks.find(
      (week) => week.week === 1,
    );
    const upperAAllocation = weekOneAllocation?.slots.find(
      (slot) => slot.slotId === "upper_a",
    );
    const lowerBAllocation = weekOneAllocation?.slots.find(
      (slot) => slot.slotId === "lower_b",
    );
    const upperBAllocation = weekOneAllocation?.slots.find(
      (slot) => slot.slotId === "upper_b",
    );

    expect(allocationByWeek).toMatchObject({
      source: "diagnostic_shadow_planner",
      readOnly: true,
      affectsScoringOrGeneration: false,
      crossWeekAllocationWarnings: expect.arrayContaining([
        expect.objectContaining({
          code: "MUSCLE_UNDER_ALLOCATED_ACROSS_ACCUMULATION",
          muscle: "Chest",
          severity: "warning",
        }),
        expect.objectContaining({
          code: "MUSCLE_OVER_ALLOCATED_ACROSS_ACCUMULATION",
          muscle: "Hamstrings",
          severity: "warning",
        }),
        expect.objectContaining({
          code: "MUSCLE_UNDER_ALLOCATED_ACROSS_ACCUMULATION",
          muscle: "Side Delts",
          severity: "warning",
        }),
        expect.objectContaining({
          code: "DELOAD_SLOT_ALLOCATION_UNPROJECTED",
        }),
        expect.objectContaining({
          code: "WEEKLY_SLOT_ALLOCATION_POLICY_MISSING",
        }),
      ]),
    });
    expect(upperAAllocation?.allocatedMuscles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          muscle: "Chest",
          targetStatus: "hard",
          limitations: expect.arrayContaining([
            "week_1_under_preferred_target",
          ]),
          allocationReason: expect.arrayContaining([
            "weekly_obligation_allocated_to_compatible_slot",
            "week1_total=7:preferred=10",
          ]),
        }),
      ]),
    );
    expect(lowerBAllocation?.allocatedMuscles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          muscle: "Hamstrings",
          targetStatus: "hard",
          limitations: expect.arrayContaining([
            "week_1_over_preferred_target",
          ]),
          allocationReason: expect.arrayContaining([
            "week1_total=8:preferred=6",
          ]),
        }),
      ]),
    );
    expect(upperBAllocation?.allocatedMuscles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          muscle: "Side Delts",
          targetStatus: "soft",
          role: "support",
          limitations: expect.arrayContaining([
            "week_1_under_preferred_target",
          ]),
        }),
      ]),
    );
    expect(
      allocationByWeek.weeks.filter((week) => [2, 3, 4].includes(week.week)),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          projectionStatus: "not_allocated_missing_weekly_projection",
          slots: [],
          weekLevelWarnings: expect.arrayContaining([
            "missing_per_week_slot_composition",
            "missing_fatigue_carryover_model",
            "missing_progression_adjusted_set_targets",
            "missing_cross_week_duplicate_justification",
            "missing_weekly_exercise_identity_policy",
          ]),
        }),
      ]),
    );
    expect(allocationByWeek.weeks.find((week) => week.phase === "deload")).toEqual(
      expect.objectContaining({
        projectionStatus: "not_allocated_missing_deload_policy",
        slots: [],
        weekLevelWarnings: expect.arrayContaining([
          "deload_slot_allocation_unprojected",
          "missing_deload_identity_preservation",
          "missing_deload_set_reduction_projection",
          "missing_deload_hard_support_target_adjustment",
        ]),
      }),
    );
    const accumulationProjection = diagnostic.accumulationWeekProjection;
    expect(accumulationProjection).toMatchObject({
      source: "diagnostic_shadow_planner",
      readOnly: true,
      affectsScoringOrGeneration: false,
      projectionBasis: {
        sourceWeek: 1,
        method: "repeat_week_1_final_shape",
        limitations: expect.arrayContaining([
          "does_not_apply_true_progression_policy",
          "does_not_project_deload_identity_or_set_reduction",
        ]),
      },
    });
    expect(accumulationProjection.weeks.map((week) => week.week)).toEqual([
      2, 3, 4,
    ]);
    expect(accumulationProjection.weeks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          week: 2,
          projectionStatus: "partially_projected_missing_progression",
          projectedMuscles: expect.arrayContaining([
            expect.objectContaining({
              muscle: "Chest",
              projectedEffectiveSets: 7,
              preferredEffectiveSets: expect.any(Number),
              status: "below",
              trend: "persistent_under_target",
            }),
            expect.objectContaining({
              muscle: "Hamstrings",
              projectedEffectiveSets: 8,
              status: "above",
              trend: "persistent_over_target",
            }),
            expect.objectContaining({
              muscle: "Side Delts",
              projectedEffectiveSets: 1,
              status: "below",
              trend: "persistent_under_target",
            }),
          ]),
          projectedSlotRisks: expect.arrayContaining([
            expect.objectContaining({
              slotId: "upper_b",
              risk: "duplicate_exercise_reuse",
              severity: "warning",
              evidence: expect.arrayContaining([
                expect.stringContaining("Incline DB Bench"),
              ]),
            }),
            expect.objectContaining({
              risk: "collateral_fatigue",
            }),
            expect.objectContaining({
              risk: "under_allocated_primary",
            }),
            expect.objectContaining({
              risk: "over_allocated_primary",
            }),
          ]),
        }),
      ]),
    );
    expect(accumulationProjection.crossWeekWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "CHEST_UNDER_TARGET_ACROSS_ACCUMULATION",
          muscle: "Chest",
          severity: "warning",
        }),
        expect.objectContaining({
          code: "HAMSTRINGS_OVERDELIVERED_ACROSS_ACCUMULATION",
          muscle: "Hamstrings",
          severity: "warning",
        }),
        expect.objectContaining({
          code: "SIDE_DELTS_UNDER_TARGET_ACROSS_ACCUMULATION",
          muscle: "Side Delts",
          severity: "warning",
        }),
        expect.objectContaining({
          code: "DUPLICATE_MAIN_LIFT_REUSE_ACROSS_ACCUMULATION",
          severity: "warning",
          evidence: expect.arrayContaining([
            expect.stringContaining("Incline DB Bench"),
          ]),
        }),
        expect.objectContaining({
          code: "COLLATERAL_FATIGUE_RISK_ACROSS_ACCUMULATION",
        }),
        expect.objectContaining({
          code: "DELOAD_PRESERVATION_STILL_UNPROJECTED",
        }),
      ]),
    );
    expect(accumulationProjection.candidateBehaviorReadiness).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidate: "chest_upper_slot_distinct_exercise_distribution",
          readiness: "ready_for_bounded_trial",
          requiredGuardrails: expect.arrayContaining([
            "bounded_to_upper_chest_distribution_only",
            "do_not_change_seed_schema_or_runtime_replay",
          ]),
        }),
        expect.objectContaining({
          candidate: "hamstrings_weekly_overdelivery_control",
          readiness: "not_first",
        }),
        expect.objectContaining({
          candidate: "side_delt_second_slot_support",
          readiness: "diagnostic_only",
        }),
        expect.objectContaining({
          candidate: "duplicate_main_lift_suppression",
          readiness: "needs_more_projection",
        }),
        expect.objectContaining({
          candidate: "calf_duplicate_suppression",
          readiness: "not_first",
        }),
      ]),
    );
    for (const muscle of [
      "Glutes",
      "Front Delts",
      "Lower Back",
      "Upper Back",
    ]) {
      expect(
        curve.weeks[0]?.muscles.find((row) => row.muscle === muscle),
      ).toMatchObject({
        targetStatus: "diagnostic",
        limitations: expect.arrayContaining([
          "diagnostic_collateral_readout_only_not_hard_demand",
        ]),
      });
      const allocationRows = allocationByWeek.weeks.flatMap((week) =>
        week.slots.flatMap((slot) =>
          slot.allocatedMuscles.filter((row) => row.muscle === muscle),
        ),
      );
      for (const row of allocationRows) {
        expect(row.targetStatus).toBe("diagnostic");
        expect(row.role).not.toBe("primary");
      }
    }
    expect(curve.candidateBehaviorGate).toMatchObject({
      status: "blocked_until_weekly_curve_is_visible",
      likelyBestFutureBehavior:
        "chest_upper_slot_distinct_exercise_distribution",
    });
    expect(JSON.stringify(diagnostic.finalSlotPlan)).not.toContain(
      "candidateBehaviorGate",
    );
  });

  it("represents high concentration and cap cleanup in set distribution evidence", () => {
    const slotSequence = [{ slotId: "lower_b", intent: "LOWER" as const }];
    const stiffLegDeadlift = makeProjectedExercise({
      id: "stiff-legged-deadlift",
      name: "Stiff-Legged Deadlift",
      movementPatterns: ["hinge"],
      primaryMuscles: ["Hamstrings"],
      sets: 5,
      isMainLift: true,
      stimulusProfile: { hamstrings: 1, glutes: 0.5, lower_back: 0.5 },
    });
    const trimmedStiffLegDeadlift = {
      ...stiffLegDeadlift,
      sets: stiffLegDeadlift.sets.slice(0, 3),
    };
    const backSquat = makeProjectedExercise({
      id: "barbell-back-squat",
      name: "Barbell Back Squat",
      movementPatterns: ["squat"],
      primaryMuscles: ["Quads"],
      sets: 6,
      isMainLift: true,
      stimulusProfile: { quads: 1, core: 0.5, adductors: 0.5, glutes: 0.5 },
    });

    const diagnostic = buildWeeklyDemandSlotAllocationDiagnostic({
      activeMesocycle: buildSource() as never,
      slotSequence,
      initialProjectedSlots: [
        makeProjectedSlotWithContributions({
          slotId: "lower_b",
          intent: "LOWER",
          workout: makeProjectedWorkout({ mainLifts: [stiffLegDeadlift] }),
        }),
      ],
      finalProjectedSlots: [
        makeProjectedSlotWithContributions({
          slotId: "lower_b",
          intent: "LOWER",
          workout: makeProjectedWorkout({
            mainLifts: [trimmedStiffLegDeadlift, backSquat],
          }),
        }),
      ],
      weeklyObligationPlan: emptyWeeklyObligationPlan(),
      weeklyObligationEvaluations: [],
      protectedCoverage: {
        muscles: [],
        deficitsBelowMev: [],
        deficitsBelowPracticalFloor: [],
        unresolvedProtectedMuscles: [],
      },
      supportFloorRepairReasons: {},
      programQualityAppliedDiagnostics: [],
      programQualityEvaluation: {
        totalPenalty: 0,
        diagnostics: [],
        constraintCounts: {},
      },
    });

    const lowerBIntent = diagnostic.setDistributionIntents.find(
      (intent) => intent.slotId === "lower_b",
    );

    expect(lowerBIntent?.evidence.concentrationRows).toEqual(
      expect.arrayContaining([
        "lower_b:Barbell Back Squat:Adductors:100%",
        "lower_b:Barbell Back Squat:Core:100%",
        "lower_b:Barbell Back Squat:Quads:100%",
      ]),
    );
    expect(lowerBIntent?.evidence.capCleanupRows).toEqual([
      "lower_b:Stiff-Legged Deadlift:-2",
    ]);
    expect(lowerBIntent?.evidence.repairRowsStillRepairOwned).toEqual(
      expect.arrayContaining([
        "lower_b:Stiff-Legged Deadlift:Hamstrings:diagnostic_or_cap_cleanup",
      ]),
    );
  });

  it("marks lower_b Hamstrings dirty when Back Extension closes the shortfall with glute and lower-back collateral", () => {
    const slotSequence = [{ slotId: "lower_b", intent: "LOWER" as const }];
    const backExtension = makeProjectedExercise({
      id: "back-extension-45",
      name: "Back Extension (45 Degree)",
      movementPatterns: ["hinge"],
      primaryMuscles: ["Hamstrings"],
      sets: 4,
      isMainLift: false,
      isCompound: true,
      stimulusProfile: { hamstrings: 1, glutes: 0.5, lower_back: 0.5 },
    });

    const diagnostic = buildWeeklyDemandSlotAllocationDiagnostic({
      activeMesocycle: buildSource() as never,
      slotSequence,
      initialProjectedSlots: [
        makeProjectedSlotWithContributions({
          slotId: "lower_b",
          intent: "LOWER",
          workout: makeProjectedWorkout({}),
        }),
      ],
      finalProjectedSlots: [
        makeProjectedSlotWithContributions({
          slotId: "lower_b",
          intent: "LOWER",
          workout: makeProjectedWorkout({ accessories: [backExtension] }),
        }),
      ],
      weeklyObligationPlan: weeklyObligationPlan({
        Hamstrings: {
          targetSets: 4,
          allocatedSlots: [
            { slotId: "lower_b", minEffectiveSets: 4, priority: "primary" },
          ],
        },
      }),
      weeklyObligationEvaluations: [],
      protectedCoverage: {
        muscles: [],
        deficitsBelowMev: [],
        deficitsBelowPracticalFloor: [],
        unresolvedProtectedMuscles: [],
      },
      supportFloorRepairReasons: {},
      programQualityAppliedDiagnostics: [],
      programQualityEvaluation: {
        totalPenalty: 0,
        diagnostics: [],
        constraintCounts: {},
      },
    });

    const feasibility = getLowerBHamstringsFeasibility(diagnostic);

    expect(feasibility).toMatchObject({
      candidateStatus: "dirty_candidate",
      recommendation: "do_not_promote_yet",
      targetEffectiveSets: 4,
      currentInitialEffectiveSets: 0,
      currentFinalEffectiveSets: 4,
      shortfallBeforeRepair: 4,
      collateralEstimate: {
        glutesDelta: 2,
        lowerBackDelta: 2,
      },
    });
    expect(feasibility?.dirtyClosureSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ signal: "back_extension_closure" }),
        expect.objectContaining({ signal: "glute_collateral" }),
        expect.objectContaining({ signal: "lower_back_collateral" }),
      ]),
    );
    const hamstringsClass = diagnostic.exerciseClassDistributionBySlot
      .find((slot) => slot.week === 1 && slot.slotId === "lower_b")
      ?.muscleDemands.find((row) => row.muscle === "Hamstrings");
    expect(hamstringsClass).toMatchObject({
      preferredSetSplit: "anchor_plus_isolation",
      requiredExerciseClasses: expect.arrayContaining([
        "hinge_compound",
        "knee_flexion_curl",
      ]),
      forbiddenExerciseClasses: expect.arrayContaining([
        "back_extension",
        "dirty_extension",
      ]),
      repairEvidence: expect.arrayContaining([
        "feasibility:dirty_candidate:do_not_promote_yet",
        "dirty:back_extension_closure",
      ]),
    });
    expect(getClassAlignment(diagnostic, "lower_b", "Hamstrings")).toMatchObject({
      finalAlignment: "violated",
      forbiddenClasses: expect.arrayContaining(["back_extension", "dirty_extension"]),
      finalSelectedClasses: expect.arrayContaining([
        expect.objectContaining({
          exerciseName: "Back Extension (45 Degree)",
          exerciseClass: "dirty_extension",
        }),
      ]),
    });
  });

  it("reports duplicated upper-slot Incline class as unresolved distinct Chest alignment", () => {
    const slotSequence = [
      { slotId: "upper_a", intent: "UPPER" as const },
      { slotId: "upper_b", intent: "UPPER" as const },
    ];
    const incline = makeProjectedExercise({
      id: "incline-db-bench",
      name: "Incline DB Bench",
      movementPatterns: ["horizontal_push"],
      primaryMuscles: ["Chest"],
      sets: 3,
      isMainLift: true,
      stimulusProfile: { chest: 1, triceps: 0.3, front_delts: 0.3 },
    });

    const diagnostic = buildWeeklyDemandSlotAllocationDiagnostic({
      activeMesocycle: buildSource() as never,
      slotSequence,
      initialProjectedSlots: slotSequence.map((slot) =>
        makeProjectedSlotWithContributions({
          slotId: slot.slotId,
          intent: "UPPER",
          workout: makeProjectedWorkout({ mainLifts: [incline] }),
        }),
      ),
      finalProjectedSlots: slotSequence.map((slot) =>
        makeProjectedSlotWithContributions({
          slotId: slot.slotId,
          intent: "UPPER",
          workout: makeProjectedWorkout({ mainLifts: [incline] }),
        }),
      ),
      weeklyObligationPlan: weeklyObligationPlan({
        Chest: {
          targetSets: 6,
          allocatedSlots: [
            { slotId: "upper_a", minEffectiveSets: 3, priority: "primary" },
            { slotId: "upper_b", minEffectiveSets: 3, priority: "primary" },
          ],
        },
      }),
      weeklyObligationEvaluations: [],
      protectedCoverage: {
        muscles: [],
        deficitsBelowMev: [],
        deficitsBelowPracticalFloor: [],
        unresolvedProtectedMuscles: [],
      },
      supportFloorRepairReasons: {},
      programQualityAppliedDiagnostics: [],
      programQualityEvaluation: {
        totalPenalty: 0,
        diagnostics: [],
        constraintCounts: {},
      },
      duplicateExerciseReuse: [
        {
          exerciseId: "incline-db-bench",
          name: "Incline DB Bench",
          repeatedInSlotId: "upper_b",
          previousSlotIds: ["upper_a"],
          role: "main",
          hasCompatibleAlternative: true,
          reason: "main_lift_duplicate_discouraged",
        },
      ],
    });

    expect(getClassAlignment(diagnostic, "upper_b", "Chest")).toMatchObject({
      initialAlignment: "partial",
      finalAlignment: "partial",
      intendedClasses: expect.arrayContaining(["press"]),
      finalSelectedClasses: expect.arrayContaining([
        expect.objectContaining({
          exerciseName: "Incline DB Bench",
          exerciseClass: "incline_press",
        }),
      ]),
      evidence: expect.arrayContaining([
        expect.stringContaining("duplicate:Incline DB Bench"),
      ]),
    });
    expect(getClassCause(diagnostic, "upper_b", "Chest")).toMatchObject({
      owningCause: "duplicate_continuity_conflict",
      recommendedOwner: "duplicate_continuity_policy",
      behaviorReadiness: "needs_duplicate_policy",
      evidence: expect.arrayContaining([
        expect.stringContaining("duplicate:Incline DB Bench"),
      ]),
    });
  });

  it("marks lower_b Hamstrings dirty when Stiff-Legged Deadlift carries concentration or cap cleanup pressure", () => {
    const slotSequence = [{ slotId: "lower_b", intent: "LOWER" as const }];
    const stiffLegDeadlift = makeProjectedExercise({
      id: "stiff-legged-deadlift",
      name: "Stiff-Legged Deadlift",
      movementPatterns: ["hinge"],
      primaryMuscles: ["Hamstrings"],
      sets: 5,
      isMainLift: true,
      stimulusProfile: { hamstrings: 1, glutes: 0.5, lower_back: 0.5 },
    });
    const trimmedStiffLegDeadlift = {
      ...stiffLegDeadlift,
      sets: stiffLegDeadlift.sets.slice(0, 3),
    };

    const diagnostic = buildWeeklyDemandSlotAllocationDiagnostic({
      activeMesocycle: buildSource() as never,
      slotSequence,
      initialProjectedSlots: [
        makeProjectedSlotWithContributions({
          slotId: "lower_b",
          intent: "LOWER",
          workout: makeProjectedWorkout({ mainLifts: [stiffLegDeadlift] }),
        }),
      ],
      finalProjectedSlots: [
        makeProjectedSlotWithContributions({
          slotId: "lower_b",
          intent: "LOWER",
          workout: makeProjectedWorkout({ mainLifts: [trimmedStiffLegDeadlift] }),
        }),
      ],
      weeklyObligationPlan: weeklyObligationPlan({
        Hamstrings: {
          targetSets: 4,
          allocatedSlots: [
            { slotId: "lower_b", minEffectiveSets: 4, priority: "primary" },
          ],
        },
      }),
      weeklyObligationEvaluations: [],
      protectedCoverage: {
        muscles: [],
        deficitsBelowMev: [],
        deficitsBelowPracticalFloor: [],
        unresolvedProtectedMuscles: [],
      },
      supportFloorRepairReasons: {},
      programQualityAppliedDiagnostics: [],
      programQualityEvaluation: {
        totalPenalty: 0,
        diagnostics: [],
        constraintCounts: {},
      },
    });

    const feasibility = getLowerBHamstringsFeasibility(diagnostic);

    expect(feasibility).toMatchObject({
      candidateStatus: "dirty_candidate",
      recommendation: "requires_distribution_policy_first",
    });
    expect(feasibility?.dirtyClosureSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ signal: "sldl_concentration" }),
        expect.objectContaining({ signal: "cap_cleanup" }),
      ]),
    );
  });

  it("marks lower_b Hamstrings safe only when a clean knee-flexion curl path satisfies the target without collateral", () => {
    const slotSequence = [{ slotId: "lower_b", intent: "LOWER" as const }];
    const seatedLegCurl = makeProjectedExercise({
      id: "seated-leg-curl",
      name: "Seated Leg Curl",
      movementPatterns: ["isolation"],
      primaryMuscles: ["Hamstrings"],
      sets: 4,
      isMainLift: false,
      isCompound: false,
      stimulusProfile: { hamstrings: 1 },
    });

    const diagnostic = buildWeeklyDemandSlotAllocationDiagnostic({
      activeMesocycle: buildSource() as never,
      slotSequence,
      initialProjectedSlots: [
        makeProjectedSlotWithContributions({
          slotId: "lower_b",
          intent: "LOWER",
          workout: makeProjectedWorkout({}),
        }),
      ],
      finalProjectedSlots: [
        makeProjectedSlotWithContributions({
          slotId: "lower_b",
          intent: "LOWER",
          workout: makeProjectedWorkout({ accessories: [seatedLegCurl] }),
        }),
      ],
      weeklyObligationPlan: weeklyObligationPlan({
        Hamstrings: {
          targetSets: 4,
          allocatedSlots: [
            { slotId: "lower_b", minEffectiveSets: 4, priority: "primary" },
          ],
        },
      }),
      weeklyObligationEvaluations: [],
      protectedCoverage: {
        muscles: [],
        deficitsBelowMev: [],
        deficitsBelowPracticalFloor: [],
        unresolvedProtectedMuscles: [],
      },
      supportFloorRepairReasons: {},
      programQualityAppliedDiagnostics: [],
      programQualityEvaluation: {
        totalPenalty: 0,
        diagnostics: [],
        constraintCounts: {},
      },
    });

    const feasibility = getLowerBHamstringsFeasibility(diagnostic);

    expect(feasibility).toMatchObject({
      candidateStatus: "clean_candidate",
      recommendation: "safe_to_trial_preselection",
      collateralEstimate: {
        glutesDelta: 0,
        lowerBackDelta: 0,
      },
    });
    expect(feasibility?.preferredCleanPath).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          exerciseClass: "knee_flexion_curl",
          available: true,
          evidence: expect.arrayContaining([
            "finalSlotPlan:lower_b:Seated Leg Curl:4 sets",
          ]),
        }),
      ]),
    );
    expect(feasibility?.dirtyClosureSignals).toEqual([]);
  });

  it("marks lower_b Hamstrings class alignment satisfied when hinge and knee-flexion curl are both final-selected", () => {
    const slotSequence = [{ slotId: "lower_b", intent: "LOWER" as const }];
    const sldl = makeProjectedExercise({
      id: "sldl",
      name: "SLDL",
      movementPatterns: ["hinge"],
      primaryMuscles: ["Hamstrings"],
      sets: 3,
      isMainLift: true,
      stimulusProfile: { hamstrings: 1, glutes: 0.5, lower_back: 0.5 },
    });
    const nordic = makeProjectedExercise({
      id: "nordic-curl",
      name: "Nordic Curl",
      movementPatterns: ["flexion"],
      primaryMuscles: ["Hamstrings"],
      sets: 2,
      isMainLift: false,
      isCompound: false,
      stimulusProfile: { hamstrings: 1 },
    });

    const diagnostic = buildWeeklyDemandSlotAllocationDiagnostic({
      activeMesocycle: buildSource() as never,
      slotSequence,
      initialProjectedSlots: [
        makeProjectedSlotWithContributions({
          slotId: "lower_b",
          intent: "LOWER",
          workout: makeProjectedWorkout({ mainLifts: [sldl] }),
        }),
      ],
      finalProjectedSlots: [
        makeProjectedSlotWithContributions({
          slotId: "lower_b",
          intent: "LOWER",
          workout: makeProjectedWorkout({ mainLifts: [sldl], accessories: [nordic] }),
        }),
      ],
      weeklyObligationPlan: weeklyObligationPlan({
        Hamstrings: {
          targetSets: 5,
          allocatedSlots: [
            { slotId: "lower_b", minEffectiveSets: 5, priority: "primary" },
          ],
        },
      }),
      weeklyObligationEvaluations: [],
      protectedCoverage: {
        muscles: [],
        deficitsBelowMev: [],
        deficitsBelowPracticalFloor: [],
        unresolvedProtectedMuscles: [],
      },
      supportFloorRepairReasons: {},
      programQualityAppliedDiagnostics: [],
      programQualityEvaluation: {
        totalPenalty: 0,
        diagnostics: [],
        constraintCounts: {},
      },
    });

    expect(getClassAlignment(diagnostic, "lower_b", "Hamstrings")).toMatchObject({
      initialAlignment: "partial",
      finalAlignment: "satisfied",
      repairEffect: "improved_alignment",
      finalSelectedClasses: expect.arrayContaining([
        expect.objectContaining({ exerciseClass: "stiff_leg_deadlift" }),
        expect.objectContaining({
          exerciseName: "Nordic Curl",
          exerciseClass: "nordic_curl",
          producedOrIncreasedByRepair: true,
        }),
      ]),
    });
    expect(getClassCause(diagnostic, "lower_b", "Hamstrings")).toMatchObject({
      owningCause: "repair_identity_churn",
      recommendedOwner: "repair_safety_net",
    });
    expect(getClassCause(diagnostic, "lower_b", "Hamstrings")).not.toMatchObject({
      owningCause: "inventory_classification_gap",
    });
    expect(diagnostic.exerciseClassAlignment.summary.identityChurnCount).toBeGreaterThanOrEqual(1);
  });

  it("classifies unresolved class intent with visible compatible candidate and capacity as selection blind spot", () => {
    const slotSequence = [{ slotId: "lower_b", intent: "LOWER" as const }];
    const sldl = makeProjectedExercise({
      id: "sldl",
      name: "SLDL",
      movementPatterns: ["hinge"],
      primaryMuscles: ["Hamstrings"],
      sets: 3,
      isMainLift: true,
      stimulusProfile: { hamstrings: 1, glutes: 0.5, lower_back: 0.4 },
    });
    const nordic = makeProjectedExercise({
      id: "nordic-hamstring-curl",
      name: "Nordic Hamstring Curl",
      movementPatterns: ["flexion"],
      primaryMuscles: ["Hamstrings"],
      sets: 3,
      isMainLift: false,
      isCompound: false,
      stimulusProfile: { hamstrings: 1 },
    });

    const diagnostic = buildWeeklyDemandSlotAllocationDiagnostic({
      activeMesocycle: buildSource() as never,
      slotSequence,
      exerciseLibrary: [sldl.exercise, nordic.exercise] as never,
      initialProjectedSlots: [
        makeProjectedSlotWithContributions({
          slotId: "lower_b",
          intent: "LOWER",
          workout: makeProjectedWorkout({ mainLifts: [sldl] }),
        }),
      ],
      finalProjectedSlots: [
        makeProjectedSlotWithContributions({
          slotId: "lower_b",
          intent: "LOWER",
          workout: makeProjectedWorkout({ mainLifts: [sldl] }),
        }),
      ],
      weeklyObligationPlan: weeklyObligationPlan({
        Hamstrings: {
          targetSets: 5,
          allocatedSlots: [
            { slotId: "lower_b", minEffectiveSets: 5, priority: "primary" },
          ],
        },
      }),
      weeklyObligationEvaluations: [],
      protectedCoverage: {
        muscles: [],
        deficitsBelowMev: [],
        deficitsBelowPracticalFloor: [],
        unresolvedProtectedMuscles: [],
      },
      supportFloorRepairReasons: {},
      programQualityAppliedDiagnostics: [],
      programQualityEvaluation: {
        totalPenalty: 0,
        diagnostics: [],
        constraintCounts: {},
      },
    });

    expect(getClassAlignment(diagnostic, "lower_b", "Hamstrings")).toMatchObject({
      finalAlignment: "partial",
    });
    expect(getClassCause(diagnostic, "lower_b", "Hamstrings")).toMatchObject({
      owningCause: "selection_blind_spot",
      recommendedOwner: "selection_objective",
      behaviorReadiness: "ready_for_bounded_trial",
      evidence: expect.arrayContaining([
        "compatible_candidate_visible",
      ]),
    });
  });

  it("does not mark selection blind spots ready when material repair diagnostics are still unresolved", () => {
    const slotSequence = [{ slotId: "lower_b", intent: "LOWER" as const }];
    const sldl = makeProjectedExercise({
      id: "sldl",
      name: "SLDL",
      movementPatterns: ["hinge"],
      primaryMuscles: ["Hamstrings"],
      sets: 3,
      isMainLift: true,
      stimulusProfile: { hamstrings: 1, glutes: 0.5, lower_back: 0.4 },
    });
    const nordic = makeProjectedExercise({
      id: "nordic-hamstring-curl",
      name: "Nordic Hamstring Curl",
      movementPatterns: ["flexion"],
      primaryMuscles: ["Hamstrings"],
      sets: 3,
      isMainLift: false,
      isCompound: false,
      stimulusProfile: { hamstrings: 1 },
    });
    const lateralRaise = makeProjectedExercise({
      id: "lateral-raise",
      name: "Lateral Raise",
      movementPatterns: ["isolation"],
      primaryMuscles: ["Side Delts"],
      sets: 3,
      isMainLift: false,
      isCompound: false,
      stimulusProfile: { side_delts: 1 },
    });

    const diagnostic = buildWeeklyDemandSlotAllocationDiagnostic({
      activeMesocycle: buildSource() as never,
      slotSequence,
      exerciseLibrary: [sldl.exercise, nordic.exercise, lateralRaise.exercise] as never,
      initialProjectedSlots: [
        makeProjectedSlotWithContributions({
          slotId: "lower_b",
          intent: "LOWER",
          workout: makeProjectedWorkout({ mainLifts: [sldl] }),
        }),
      ],
      finalProjectedSlots: [
        makeProjectedSlotWithContributions({
          slotId: "lower_b",
          intent: "LOWER",
          workout: makeProjectedWorkout({
            mainLifts: [sldl],
            accessories: [lateralRaise],
          }),
        }),
      ],
      weeklyObligationPlan: weeklyObligationPlan({
        Hamstrings: {
          targetSets: 5,
          allocatedSlots: [
            { slotId: "lower_b", minEffectiveSets: 5, priority: "primary" },
          ],
        },
      }),
      weeklyObligationEvaluations: [],
      protectedCoverage: {
        muscles: [],
        deficitsBelowMev: [],
        deficitsBelowPracticalFloor: [],
        unresolvedProtectedMuscles: [],
      },
      supportFloorRepairReasons: {},
      programQualityAppliedDiagnostics: [],
      programQualityEvaluation: {
        totalPenalty: 0,
        diagnostics: [],
        constraintCounts: {},
      },
    });

    expect(diagnostic.repairMaterialityAfterShadowAllocation.length).toBeGreaterThan(0);
    expect(getClassCause(diagnostic, "lower_b", "Hamstrings")).toMatchObject({
      owningCause: "selection_blind_spot",
      behaviorReadiness: "do_not_act",
    });
  });

  it("classifies unresolved class intent with no compatible inventory as inventory classification gap", () => {
    const slotSequence = [{ slotId: "lower_b", intent: "LOWER" as const }];
    const sldl = makeProjectedExercise({
      id: "sldl",
      name: "SLDL",
      movementPatterns: ["hinge"],
      primaryMuscles: ["Hamstrings"],
      sets: 3,
      isMainLift: true,
      stimulusProfile: { hamstrings: 1, glutes: 0.5, lower_back: 0.4 },
    });

    const diagnostic = buildWeeklyDemandSlotAllocationDiagnostic({
      activeMesocycle: buildSource() as never,
      slotSequence,
      exerciseLibrary: [sldl.exercise] as never,
      initialProjectedSlots: [
        makeProjectedSlotWithContributions({
          slotId: "lower_b",
          intent: "LOWER",
          workout: makeProjectedWorkout({ mainLifts: [sldl] }),
        }),
      ],
      finalProjectedSlots: [
        makeProjectedSlotWithContributions({
          slotId: "lower_b",
          intent: "LOWER",
          workout: makeProjectedWorkout({ mainLifts: [sldl] }),
        }),
      ],
      weeklyObligationPlan: weeklyObligationPlan({
        Hamstrings: {
          targetSets: 5,
          allocatedSlots: [
            { slotId: "lower_b", minEffectiveSets: 5, priority: "primary" },
          ],
        },
      }),
      weeklyObligationEvaluations: [],
      protectedCoverage: {
        muscles: [],
        deficitsBelowMev: [],
        deficitsBelowPracticalFloor: [],
        unresolvedProtectedMuscles: [],
      },
      supportFloorRepairReasons: {},
      programQualityAppliedDiagnostics: [],
      programQualityEvaluation: {
        totalPenalty: 0,
        diagnostics: [],
        constraintCounts: {},
      },
    });

    expect(getClassAlignment(diagnostic, "lower_b", "Hamstrings")).toMatchObject({
      finalAlignment: "partial",
    });
    expect(getClassCause(diagnostic, "lower_b", "Hamstrings")).toMatchObject({
      owningCause: "inventory_classification_gap",
      recommendedOwner: "exercise_inventory_classification",
      behaviorReadiness: "needs_inventory_fix",
      evidence: expect.arrayContaining(["compatible_candidate_not_visible"]),
    });
  });

  it("reports lower-compatible Hamstrings curl inventory even when curls are not selected in lower_b", () => {
    const slotSequence = [
      { slotId: "lower_a", intent: "LOWER" as const },
      { slotId: "lower_b", intent: "LOWER" as const },
    ];
    const lyingLegCurl = makeProjectedExercise({
      id: "lying-leg-curl",
      name: "Lying Leg Curl",
      movementPatterns: ["flexion"],
      primaryMuscles: ["Hamstrings"],
      sets: 3,
      isMainLift: false,
      isCompound: false,
      stimulusProfile: { hamstrings: 1 },
    });
    const seatedLegCurl = makeProjectedExercise({
      id: "seated-leg-curl",
      name: "Seated Leg Curl",
      movementPatterns: ["flexion"],
      primaryMuscles: ["Hamstrings"],
      sets: 3,
      isMainLift: false,
      isCompound: false,
      stimulusProfile: { hamstrings: 1 },
    });
    const nordicHamstringCurl = makeProjectedExercise({
      id: "nordic-hamstring-curl",
      name: "Nordic Hamstring Curl",
      movementPatterns: ["flexion"],
      primaryMuscles: ["Hamstrings"],
      secondaryMuscles: ["Glutes"],
      sets: 3,
      isMainLift: false,
      isCompound: false,
      stimulusProfile: { hamstrings: 1, glutes: 0.2 },
    });
    const stiffLegDeadlift = makeProjectedExercise({
      id: "stiff-legged-deadlift",
      name: "Stiff-Legged Deadlift",
      movementPatterns: ["hinge"],
      primaryMuscles: ["Hamstrings"],
      secondaryMuscles: ["Glutes", "Lower Back"],
      sets: 3,
      isMainLift: true,
      stimulusProfile: { hamstrings: 1, glutes: 0.75, lower_back: 0.45 },
    });
    const backExtension = makeProjectedExercise({
      id: "back-extension-45",
      name: "Back Extension (45 Degree)",
      movementPatterns: ["extension"],
      primaryMuscles: ["Glutes", "Hamstrings", "Lower Back"],
      sets: 4,
      isMainLift: false,
      isCompound: true,
      stimulusProfile: { hamstrings: 0.45, glutes: 0.65, lower_back: 0.9 },
    });

    const diagnostic = buildWeeklyDemandSlotAllocationDiagnostic({
      activeMesocycle: buildSource() as never,
      slotSequence,
      exerciseLibrary: [
        lyingLegCurl.exercise,
        seatedLegCurl.exercise,
        nordicHamstringCurl.exercise,
        stiffLegDeadlift.exercise,
        backExtension.exercise,
      ] as never,
      initialProjectedSlots: [
        makeProjectedSlotWithContributions({
          slotId: "lower_a",
          intent: "LOWER",
          workout: makeProjectedWorkout({
            accessories: [lyingLegCurl, seatedLegCurl],
          }),
        }),
        makeProjectedSlotWithContributions({
          slotId: "lower_b",
          intent: "LOWER",
          workout: makeProjectedWorkout({}),
        }),
      ],
      finalProjectedSlots: [
        makeProjectedSlotWithContributions({
          slotId: "lower_a",
          intent: "LOWER",
          workout: makeProjectedWorkout({
            accessories: [lyingLegCurl, seatedLegCurl],
          }),
        }),
        makeProjectedSlotWithContributions({
          slotId: "lower_b",
          intent: "LOWER",
          workout: makeProjectedWorkout({
            mainLifts: [stiffLegDeadlift],
            accessories: [backExtension],
          }),
        }),
      ],
      weeklyObligationPlan: weeklyObligationPlan({
        Hamstrings: {
          targetSets: 4,
          allocatedSlots: [
            { slotId: "lower_b", minEffectiveSets: 4, priority: "primary" },
          ],
        },
      }),
      weeklyObligationEvaluations: [],
      protectedCoverage: {
        muscles: [],
        deficitsBelowMev: [],
        deficitsBelowPracticalFloor: [],
        unresolvedProtectedMuscles: [],
      },
      supportFloorRepairReasons: {},
      programQualityAppliedDiagnostics: [],
      programQualityEvaluation: {
        totalPenalty: 0,
        diagnostics: [],
        constraintCounts: {},
      },
    });

    const feasibility = getLowerBHamstringsFeasibility(diagnostic);
    const lying = getLowerBHamstringsCandidate(diagnostic, "Lying Leg Curl");
    const seated = getLowerBHamstringsCandidate(diagnostic, "Seated Leg Curl");
    const nordic = getLowerBHamstringsCandidate(
      diagnostic,
      "Nordic Hamstring Curl",
    );
    const stiffLeg = getLowerBHamstringsCandidate(
      diagnostic,
      "Stiff-Legged Deadlift",
    );
    const extension = getLowerBHamstringsCandidate(
      diagnostic,
      "Back Extension (45 Degree)",
    );

    expect(feasibility?.candidateStatus).toBe("dirty_candidate");
    expect(feasibility?.recommendation).toBe("do_not_promote_yet");
    expect(feasibility?.reasons).toContain(
      "inventory_clean_knee_flexion_candidates_visible",
    );
    expect(lying).toMatchObject({
      candidateClass: "knee_flexion_curl",
      primaryMuscles: ["Hamstrings"],
      movementPatterns: ["flexion"],
      hamstringsStimulusPerSet: 1,
      lowerSlotCompatible: true,
      lowerBCompatible: true,
      alreadySelectedInWeek: true,
      alreadySelectedSlotIds: ["lower_a"],
      selectedInLowerBInitial: false,
      selectedInLowerBFinal: false,
      availability: "available_but_already_used_elsewhere",
    });
    expect(seated).toMatchObject({
      candidateClass: "knee_flexion_curl",
      availability: "available_but_already_used_elsewhere",
      alreadySelectedSlotIds: ["lower_a"],
    });
    expect(nordic).toMatchObject({
      candidateClass: "knee_flexion_curl",
      secondaryMuscles: ["Glutes"],
      hamstringsStimulusPerSet: 1,
      glutesStimulusPerSet: 0.2,
      lowerSlotCompatible: true,
      lowerBCompatible: true,
      alreadySelectedInWeek: false,
      availability: "clean_available",
    });
    expect(stiffLeg).toMatchObject({
      candidateClass: "hinge_compound",
      availability: "dirty_not_clean_candidate",
      selectedInLowerBFinal: true,
    });
    expect(extension).toMatchObject({
      candidateClass: "dirty_extension",
      availability: "dirty_not_clean_candidate",
      lowerBCompatible: false,
      hamstringsStimulusPerSet: 0.5,
      glutesStimulusPerSet: 0.7,
      lowerBackStimulusPerSet: 0.9,
    });
    expect(lying?.reasons).toEqual(
      expect.arrayContaining([
        "classification_mismatch:movementPatterns_flexion_not_in_allowedPatterns_hinge+isolation_but_class_knee_flexion_curl_is_allowed",
        "duplicate_week_placement_possible_blocker",
        "lower_b_capacity_available",
      ]),
    );
    expect(stiffLeg?.candidateClass).not.toBe("knee_flexion_curl");
    expect(extension?.reasons).toEqual(
      expect.arrayContaining([
        "not_clean_closure:extension_collateral_sensitive",
      ]),
    );
  });

  it("does not treat OHP-only Side Delts work as full direct-class satisfaction", () => {
    const slotSequence = [
      { slotId: "upper_a", intent: "UPPER" as const },
      { slotId: "upper_b", intent: "UPPER" as const },
    ];
    const overheadPress = makeProjectedExercise({
      id: "overhead-press",
      name: "Overhead Press",
      movementPatterns: ["vertical_push"],
      primaryMuscles: ["Side Delts"],
      secondaryMuscles: ["Front Delts", "Triceps"],
      sets: 3,
      isMainLift: true,
      stimulusProfile: { side_delts: 1, front_delts: 0.5, triceps: 0.3 },
    });

    const diagnostic = buildWeeklyDemandSlotAllocationDiagnostic({
      activeMesocycle: buildSource() as never,
      slotSequence,
      initialProjectedSlots: [
        makeProjectedSlotWithContributions({
          slotId: "upper_a",
          intent: "UPPER",
          workout: makeProjectedWorkout({}),
        }),
        makeProjectedSlotWithContributions({
          slotId: "upper_b",
          intent: "UPPER",
          workout: makeProjectedWorkout({ mainLifts: [overheadPress] }),
        }),
      ],
      finalProjectedSlots: [
        makeProjectedSlotWithContributions({
          slotId: "upper_a",
          intent: "UPPER",
          workout: makeProjectedWorkout({}),
        }),
        makeProjectedSlotWithContributions({
          slotId: "upper_b",
          intent: "UPPER",
          workout: makeProjectedWorkout({ mainLifts: [overheadPress] }),
        }),
      ],
      weeklyObligationPlan: emptyWeeklyObligationPlan(),
      weeklyObligationEvaluations: [],
      protectedCoverage: {
        muscles: [],
        deficitsBelowMev: [],
        deficitsBelowPracticalFloor: [],
        unresolvedProtectedMuscles: [],
      },
      supportFloorRepairReasons: {},
      programQualityAppliedDiagnostics: [],
      programQualityEvaluation: {
        totalPenalty: 0,
        diagnostics: [],
        constraintCounts: {},
      },
    });

    expect(getClassAlignment(diagnostic, "upper_b", "Side Delts")).toMatchObject({
      initialAlignment: "partial",
      finalAlignment: "partial",
      intendedClasses: expect.arrayContaining(["lateral_raise"]),
      finalSelectedClasses: expect.arrayContaining([
        expect.objectContaining({
          exerciseName: "Overhead Press",
          exerciseClass: "vertical_press_overlap",
        }),
      ]),
    });
    expect(getClassCause(diagnostic, "upper_b", "Side Delts")).toMatchObject({
      owningCause: "selection_blind_spot",
      recommendedOwner: "selection_objective",
      behaviorReadiness: "ready_for_bounded_trial",
    });
  });

  it("classifies support-floor late direct rows as support demand planner ownership", () => {
    const slotSequence = [
      { slotId: "upper_a", intent: "UPPER" as const },
      { slotId: "upper_b", intent: "UPPER" as const },
    ];
    const cableLateralRaise = makeProjectedExercise({
      id: "cable-lateral-raise",
      name: "Cable Lateral Raise",
      movementPatterns: ["isolation"],
      primaryMuscles: ["Side Delts"],
      sets: 2,
      isMainLift: false,
      isCompound: false,
      stimulusProfile: { side_delts: 1 },
    });

    const diagnostic = buildWeeklyDemandSlotAllocationDiagnostic({
      activeMesocycle: buildSource() as never,
      slotSequence,
      initialProjectedSlots: [
        makeProjectedSlotWithContributions({
          slotId: "upper_a",
          intent: "UPPER",
          workout: makeProjectedWorkout({}),
        }),
        makeProjectedSlotWithContributions({
          slotId: "upper_b",
          intent: "UPPER",
          workout: makeProjectedWorkout({}),
        }),
      ],
      finalProjectedSlots: [
        makeProjectedSlotWithContributions({
          slotId: "upper_a",
          intent: "UPPER",
          workout: makeProjectedWorkout({}),
        }),
        makeProjectedSlotWithContributions({
          slotId: "upper_b",
          intent: "UPPER",
          workout: makeProjectedWorkout({ accessories: [cableLateralRaise] }),
        }),
      ],
      weeklyObligationPlan: emptyWeeklyObligationPlan(),
      weeklyObligationEvaluations: [],
      protectedCoverage: {
        muscles: [],
        deficitsBelowMev: [],
        deficitsBelowPracticalFloor: [],
        unresolvedProtectedMuscles: [],
      },
      supportFloorRepairReasons: {
        "Side Delts": ["support_accessory_replacement"],
      },
      programQualityAppliedDiagnostics: [],
      programQualityEvaluation: {
        totalPenalty: 0,
        diagnostics: [],
        constraintCounts: {},
      },
    });

    expect(getClassAlignment(diagnostic, "upper_b", "Side Delts")).toMatchObject({
      initialAlignment: "missing",
      finalAlignment: "satisfied",
    });
    expect(getClassCause(diagnostic, "upper_b", "Side Delts")).toMatchObject({
      owningCause: "support_floor_late_repair",
      recommendedOwner: "support_demand_planner",
      behaviorReadiness: "needs_planner_ownership",
    });
  });

  it("shows duplicate calf isolation variants as class-aligned with a duplicate-policy warning", () => {
    const slotSequence = [
      { slotId: "lower_a", intent: "LOWER" as const },
      { slotId: "lower_b", intent: "LOWER" as const },
    ];
    const standingCalfRaise = makeProjectedExercise({
      id: "standing-calf-raise",
      name: "Standing Calf Raise",
      movementPatterns: ["isolation"],
      primaryMuscles: ["Calves"],
      sets: 2,
      isMainLift: false,
      isCompound: false,
      stimulusProfile: { calves: 1 },
    });
    const seatedCalfRaise = makeProjectedExercise({
      id: "seated-calf-raise",
      name: "Seated Calf Raise",
      movementPatterns: ["isolation"],
      primaryMuscles: ["Calves"],
      sets: 2,
      isMainLift: false,
      isCompound: false,
      stimulusProfile: { calves: 1 },
    });

    const diagnostic = buildWeeklyDemandSlotAllocationDiagnostic({
      activeMesocycle: buildSource() as never,
      slotSequence,
      initialProjectedSlots: [
        makeProjectedSlotWithContributions({
          slotId: "lower_a",
          intent: "LOWER",
          workout: makeProjectedWorkout({}),
        }),
        makeProjectedSlotWithContributions({
          slotId: "lower_b",
          intent: "LOWER",
          workout: makeProjectedWorkout({ accessories: [standingCalfRaise] }),
        }),
      ],
      finalProjectedSlots: [
        makeProjectedSlotWithContributions({
          slotId: "lower_a",
          intent: "LOWER",
          workout: makeProjectedWorkout({}),
        }),
        makeProjectedSlotWithContributions({
          slotId: "lower_b",
          intent: "LOWER",
          workout: makeProjectedWorkout({
            accessories: [standingCalfRaise, seatedCalfRaise],
          }),
        }),
      ],
      weeklyObligationPlan: emptyWeeklyObligationPlan(),
      weeklyObligationEvaluations: [],
      protectedCoverage: {
        muscles: [],
        deficitsBelowMev: [],
        deficitsBelowPracticalFloor: [],
        unresolvedProtectedMuscles: [],
      },
      supportFloorRepairReasons: {},
      programQualityAppliedDiagnostics: [],
      programQualityEvaluation: {
        totalPenalty: 0,
        diagnostics: [],
        constraintCounts: {},
      },
    });

    expect(getClassAlignment(diagnostic, "lower_b", "Calves")).toMatchObject({
      finalAlignment: "satisfied",
      finalSelectedClasses: expect.arrayContaining([
        expect.objectContaining({ exerciseClass: "standing_calf_raise" }),
        expect.objectContaining({ exerciseClass: "seated_calf_raise" }),
      ]),
    });
    expect(
      diagnostic.exerciseClassAlignment.slots.find((slot) => slot.slotId === "lower_b")
        ?.slotWarnings,
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("same_session_duplicate_class:Calves:calf_raise"),
      ]),
    );
    expect(getClassCause(diagnostic, "lower_b", "Calves")).toMatchObject({
      owningCause: "duplicate_continuity_conflict",
      recommendedOwner: "duplicate_continuity_policy",
    });
  });

  it("blocks lower_b calf duplicate cleanup when one retained isolation cannot preserve the support floor under current caps", () => {
    const slotSequence = [
      { slotId: "lower_a", intent: "LOWER" as const },
      { slotId: "lower_b", intent: "LOWER" as const },
    ];
    const lowerAStandingCalfRaise = makeProjectedExercise({
      id: "standing-calf-raise",
      name: "Standing Calf Raise",
      movementPatterns: ["isolation"],
      primaryMuscles: ["Calves"],
      sets: 2,
      isMainLift: false,
      isCompound: false,
      stimulusProfile: { calves: 1 },
    });
    const seatedCalfRaise = makeProjectedExercise({
      id: "seated-calf-raise",
      name: "Seated Calf Raise",
      movementPatterns: ["isolation"],
      primaryMuscles: ["Calves"],
      sets: 3,
      isMainLift: false,
      isCompound: false,
      stimulusProfile: { calves: 1 },
    });
    const legPressCalfRaise = makeProjectedExercise({
      id: "leg-press-calf-raise",
      name: "Leg Press Calf Raise",
      movementPatterns: ["isolation"],
      primaryMuscles: ["Calves"],
      sets: 3,
      isMainLift: false,
      isCompound: false,
      stimulusProfile: { calves: 1 },
    });

    const diagnostic = buildWeeklyDemandSlotAllocationDiagnostic({
      activeMesocycle: buildSource() as never,
      slotSequence,
      initialProjectedSlots: [
        makeProjectedSlotWithContributions({
          slotId: "lower_a",
          intent: "LOWER",
          workout: makeProjectedWorkout({
            accessories: [lowerAStandingCalfRaise],
          }),
        }),
        makeProjectedSlotWithContributions({
          slotId: "lower_b",
          intent: "LOWER",
          workout: makeProjectedWorkout({
            accessories: [seatedCalfRaise, legPressCalfRaise],
          }),
        }),
      ],
      finalProjectedSlots: [
        makeProjectedSlotWithContributions({
          slotId: "lower_a",
          intent: "LOWER",
          workout: makeProjectedWorkout({
            accessories: [lowerAStandingCalfRaise],
          }),
        }),
        makeProjectedSlotWithContributions({
          slotId: "lower_b",
          intent: "LOWER",
          workout: makeProjectedWorkout({
            accessories: [seatedCalfRaise, legPressCalfRaise],
          }),
        }),
      ],
      weeklyObligationPlan: emptyWeeklyObligationPlan(),
      weeklyObligationEvaluations: [],
      protectedCoverage: {
        muscles: [],
        deficitsBelowMev: [],
        deficitsBelowPracticalFloor: [],
        unresolvedProtectedMuscles: [],
      },
      supportFloorRepairReasons: {},
      programQualityAppliedDiagnostics: [],
      programQualityEvaluation: {
        totalPenalty: 0,
        diagnostics: [],
        constraintCounts: {},
      },
    });

    expect(getLowerBCalfCleanupFeasibility(diagnostic)).toMatchObject({
      candidate: "lower_b_calf_duplicate_cleanup",
      slotId: "lower_b",
      muscle: "Calves",
      currentShape: [
        {
          exerciseName: "Seated Calf Raise",
          setCount: 3,
          effectiveSets: 3,
          exerciseClass: "seated_calf_raise",
        },
        {
          exerciseName: "Leg Press Calf Raise",
          setCount: 3,
          effectiveSets: 3,
          exerciseClass: "calf_raise",
        },
      ],
      target: {
        minEffectiveSets: 8,
        preferredEffectiveSets: 8,
        targetStatus: "soft",
      },
      caps: {
        maxSetsPerExercise: 4,
        maxDirectExercises: 1,
      },
      feasibility: "not_feasible_under_current_caps",
      blockingReasons: expect.arrayContaining([
        "single_exercise_cannot_meet_floor",
        "would_exceed_set_cap",
        "would_reduce_below_support_floor",
        "would_require_lower_a_mutation",
        "would_require_specialization_policy",
      ]),
      recommendation: "do_not_trial_behavior",
      readOnly: true,
      affectsScoringOrGeneration: false,
    });
    expect(
      getLowerBCalfCleanupFeasibility(diagnostic)?.proposedCleanerShape,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          exerciseName: "Seated Calf Raise",
          proposedSetCount: 4,
          projectedEffectiveSets: 4,
          reason:
            "needs_6_sets_to_preserve_Calves_floor_but_maxSetsPerExercise_is_4",
        }),
        expect.objectContaining({
          exerciseName: "Leg Press Calf Raise",
          proposedSetCount: 4,
          projectedEffectiveSets: 4,
          reason:
            "needs_6_sets_to_preserve_Calves_floor_but_maxSetsPerExercise_is_4",
        }),
      ]),
    );
  });

  it("allows lower_b calf duplicate cleanup trial when one retained isolation can preserve the support floor within caps", () => {
    const slotSequence = [
      { slotId: "lower_a", intent: "LOWER" as const },
      { slotId: "lower_b", intent: "LOWER" as const },
    ];
    const lowerAStandingCalfRaise = makeProjectedExercise({
      id: "standing-calf-raise",
      name: "Standing Calf Raise",
      movementPatterns: ["isolation"],
      primaryMuscles: ["Calves"],
      sets: 4,
      isMainLift: false,
      isCompound: false,
      stimulusProfile: { calves: 1 },
    });
    const seatedCalfRaise = makeProjectedExercise({
      id: "seated-calf-raise",
      name: "Seated Calf Raise",
      movementPatterns: ["isolation"],
      primaryMuscles: ["Calves"],
      sets: 2,
      isMainLift: false,
      isCompound: false,
      stimulusProfile: { calves: 1 },
    });
    const legPressCalfRaise = makeProjectedExercise({
      id: "leg-press-calf-raise",
      name: "Leg Press Calf Raise",
      movementPatterns: ["isolation"],
      primaryMuscles: ["Calves"],
      sets: 2,
      isMainLift: false,
      isCompound: false,
      stimulusProfile: { calves: 1 },
    });

    const diagnostic = buildWeeklyDemandSlotAllocationDiagnostic({
      activeMesocycle: buildSource() as never,
      slotSequence,
      initialProjectedSlots: [
        makeProjectedSlotWithContributions({
          slotId: "lower_a",
          intent: "LOWER",
          workout: makeProjectedWorkout({
            accessories: [lowerAStandingCalfRaise],
          }),
        }),
        makeProjectedSlotWithContributions({
          slotId: "lower_b",
          intent: "LOWER",
          workout: makeProjectedWorkout({
            accessories: [seatedCalfRaise, legPressCalfRaise],
          }),
        }),
      ],
      finalProjectedSlots: [
        makeProjectedSlotWithContributions({
          slotId: "lower_a",
          intent: "LOWER",
          workout: makeProjectedWorkout({
            accessories: [lowerAStandingCalfRaise],
          }),
        }),
        makeProjectedSlotWithContributions({
          slotId: "lower_b",
          intent: "LOWER",
          workout: makeProjectedWorkout({
            accessories: [seatedCalfRaise, legPressCalfRaise],
          }),
        }),
      ],
      weeklyObligationPlan: emptyWeeklyObligationPlan(),
      weeklyObligationEvaluations: [],
      protectedCoverage: {
        muscles: [],
        deficitsBelowMev: [],
        deficitsBelowPracticalFloor: [],
        unresolvedProtectedMuscles: [],
      },
      supportFloorRepairReasons: {},
      programQualityAppliedDiagnostics: [],
      programQualityEvaluation: {
        totalPenalty: 0,
        diagnostics: [],
        constraintCounts: {},
      },
    });

    expect(getLowerBCalfCleanupFeasibility(diagnostic)).toMatchObject({
      candidate: "lower_b_calf_duplicate_cleanup",
      feasibility: "feasible",
      blockingReasons: [],
      recommendation: "safe_to_trial",
      proposedCleanerShape: expect.arrayContaining([
        expect.objectContaining({
          exerciseName: "Seated Calf Raise",
          proposedSetCount: 4,
          projectedEffectiveSets: 4,
        }),
        expect.objectContaining({
          exerciseName: "Leg Press Calf Raise",
          proposedSetCount: 4,
          projectedEffectiveSets: 4,
        }),
      ]),
      readOnly: true,
      affectsScoringOrGeneration: false,
    });
  });

  it("separates likely avoidable shadow repairs from suspicious downstream repair artifacts", () => {
    const slotSequence = [
      { slotId: "upper_a", intent: "UPPER" as const },
      { slotId: "upper_b", intent: "UPPER" as const },
      { slotId: "lower_b", intent: "LOWER" as const },
    ];
    const emptyUpperB = makeProjectedSlotWithContributions({
      slotId: "upper_b",
      intent: "UPPER",
      workout: makeProjectedWorkout({}),
    });
    const emptyLowerB = makeProjectedSlotWithContributions({
      slotId: "lower_b",
      intent: "LOWER",
      workout: makeProjectedWorkout({}),
    });
    const sideDeltRepair = makeProjectedSlotWithContributions({
      slotId: "upper_b",
      intent: "UPPER",
      workout: makeProjectedWorkout({
        accessories: [
          makeProjectedExercise({
            id: "cable-lateral-raise",
            name: "Cable Lateral Raise",
            movementPatterns: ["isolation"],
            primaryMuscles: ["Side Delts"],
            sets: 3,
            isCompound: false,
            stimulusProfile: { side_delts: 1 },
          }),
        ],
      }),
    });
    const lowerChestRepair = makeProjectedSlotWithContributions({
      slotId: "lower_b",
      intent: "LOWER",
      workout: makeProjectedWorkout({
        accessories: [
          makeProjectedExercise({
            id: "cable-crossover",
            name: "Cable Crossover",
            movementPatterns: ["isolation"],
            primaryMuscles: ["Chest"],
            sets: 3,
            isCompound: false,
            stimulusProfile: { chest: 1 },
          }),
        ],
      }),
    });

    const diagnostic = buildWeeklyDemandSlotAllocationDiagnostic({
      activeMesocycle: buildSource() as never,
      slotSequence,
      initialProjectedSlots: [emptyUpperB, emptyLowerB],
      finalProjectedSlots: [sideDeltRepair, lowerChestRepair],
      weeklyObligationPlan: weeklyObligationPlan({
        Chest: {
          targetSets: 10,
          allocatedSlots: [
            { slotId: "upper_a", minEffectiveSets: 5, priority: "primary" },
          ],
        },
      }),
      weeklyObligationEvaluations: [],
      protectedCoverage: {
        muscles: [],
        deficitsBelowMev: [],
        deficitsBelowPracticalFloor: [],
        unresolvedProtectedMuscles: [],
      },
      supportFloorRepairReasons: {},
      programQualityAppliedDiagnostics: [],
      programQualityEvaluation: {
        totalPenalty: 0,
        diagnostics: [],
        constraintCounts: {},
      },
    });

    expect(diagnostic.shadowRepairSummary).toMatchObject({
      materialRepairCount: 2,
      majorRepairCount: 2,
      likelyAvoidableMaterialRepairCount: 1,
      remainingMaterialRepairCount: 1,
      likelyAvoidableMajorRepairCount: 1,
      remainingMajorRepairCount: 1,
      likelyAvoidableByMuscle: { "Side Delts": 1 },
      remainingByMuscle: { Chest: 1 },
    });
    expect(diagnostic.suspiciousRepairsNotEligibleForPromotion).toEqual([
      expect.objectContaining({
        slotId: "lower_b",
        muscle: "Chest",
        exerciseName: "Cable Crossover",
        repairMechanism: expect.any(String),
        reason: expect.stringContaining("weekly_demand_owned_elsewhere"),
      }),
    ]);
    expect(
      diagnostic.slotPrescriptionIntents.find(
        (intent) => intent.slotId === "lower_b",
      )?.diagnostic.blockedRepairs,
    ).toContain("lower_b:Chest:Cable Crossover:blocked_do_not_train_here");
    expect(
      diagnostic.slotPrescriptionIntents.find(
        (intent) => intent.slotId === "lower_b",
      )?.musclePrescriptions,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          muscle: "Chest",
          targetStatus: "forbidden",
          demandType: "do_not_train_here",
        }),
      ]),
    );
    expect(diagnostic.promotionCandidates).toEqual([
      expect.objectContaining({
        slotId: "upper_b",
        muscle: "Side Delts",
        role: "support",
        targetStatus: "soft",
      }),
    ]);
    expect(
      diagnostic.slotPrescriptionIntents.find(
        (intent) => intent.slotId === "upper_b",
      )?.diagnostic.priorRepairsPrevented,
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("upper_b:Side Delts:soft_direct_allowed"),
      ]),
    );
  });

  it("marks consumed Rear Delts preselection with new suspicious repair burden as worse collateral", () => {
    const slotSequence = [{ slotId: "upper_a", intent: "UPPER" as const }];
    const initialUpper = makeProjectedSlotWithContributions({
      slotId: "upper_a",
      intent: "UPPER",
      workout: makeProjectedWorkout({}),
    });
    const finalUpper = makeProjectedSlotWithContributions({
      slotId: "upper_a",
      intent: "UPPER",
      workout: makeProjectedWorkout({
        accessories: [
          makeProjectedExercise({
            id: "rear-delt-fly",
            name: "Cable Rear Delt Fly",
            movementPatterns: ["isolation"],
            primaryMuscles: ["Rear Delts"],
            sets: 2,
            isCompound: false,
            stimulusProfile: { rear_delts: 1 },
          }),
          makeProjectedExercise({
            id: "concentration-curl",
            name: "Concentration Curl",
            movementPatterns: ["isolation"],
            primaryMuscles: ["Forearms"],
            sets: 3,
            isCompound: false,
            stimulusProfile: { forearms: 1 },
          }),
        ],
      }),
    });

    const diagnostic = buildWeeklyDemandSlotAllocationDiagnostic({
      activeMesocycle: buildSource() as never,
      slotSequence,
      initialProjectedSlots: [initialUpper],
      finalProjectedSlots: [finalUpper],
      weeklyObligationPlan: emptyWeeklyObligationPlan(),
      weeklyObligationEvaluations: [],
      protectedCoverage: {
        muscles: [],
        deficitsBelowMev: [],
        deficitsBelowPracticalFloor: [],
        unresolvedProtectedMuscles: [],
      },
      supportFloorRepairReasons: {},
      programQualityAppliedDiagnostics: [],
      programQualityEvaluation: {
        totalPenalty: 0,
        diagnostics: [],
        constraintCounts: {},
      },
      preselectionDemands: [
        {
          slotId: "upper_a",
          muscle: "Rear Delts",
          selectedEffectiveSets: 2,
          consumedBySelection: true,
          targetMet: true,
        },
      ],
    });

    expect(diagnostic.rearDeltCollateralSummary).toMatchObject({
      directRearDeltStimulusBefore: 0,
      directRearDeltStimulusAfter: 2,
      rearDeltPreselectionConsumed: true,
      suspiciousRepairDelta: 1,
      verdict: "worse_collateral",
    });
    expect(diagnostic.rearDeltCollateralSummary?.reasons).toEqual(
      expect.arrayContaining([
        "REAR_DELT_COLLATERAL_SUSPICIOUS_REPAIR_INCREASE",
        "REAR_DELT_PRESELECTION_CONSUMED_BUT_PROGRAM_WORSE",
        "consumed_preselection_demand_alone_is_not_success",
      ]),
    );
    expect(diagnostic.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining([
        "REAR_DELT_COLLATERAL_SUSPICIOUS_REPAIR_INCREASE",
        "REAR_DELT_PRESELECTION_CONSUMED_BUT_PROGRAM_WORSE",
      ]),
    );
  });

  it("flags material Upper Back collateral when Rear Delts preselection is consumed", () => {
    const slotSequence = [{ slotId: "upper_a", intent: "UPPER" as const }];
    const row = makeProjectedExercise({
      id: "chest-supported-row",
      name: "Chest Supported Row",
      movementPatterns: ["horizontal_pull"],
      primaryMuscles: ["Upper Back"],
      sets: 2,
      isCompound: true,
      stimulusProfile: { upper_back: 1 },
    });
    const initialUpper = makeProjectedSlotWithContributions({
      slotId: "upper_a",
      intent: "UPPER",
      workout: makeProjectedWorkout({ mainLifts: [row] }),
    });
    const finalUpper = makeProjectedSlotWithContributions({
      slotId: "upper_a",
      intent: "UPPER",
      workout: makeProjectedWorkout({
        mainLifts: [
          {
            ...row,
            sets: Array.from({ length: 4 }, (_, index) => ({
              setIndex: index + 1,
              targetReps: 10,
              role: "main" as const,
            })),
          },
        ],
        accessories: [
          makeProjectedExercise({
            id: "rear-delt-fly",
            name: "Cable Rear Delt Fly",
            movementPatterns: ["isolation"],
            primaryMuscles: ["Rear Delts"],
            sets: 2,
            isCompound: false,
            stimulusProfile: { rear_delts: 1 },
          }),
        ],
      }),
    });

    const diagnostic = buildWeeklyDemandSlotAllocationDiagnostic({
      activeMesocycle: buildSource() as never,
      slotSequence,
      initialProjectedSlots: [initialUpper],
      finalProjectedSlots: [finalUpper],
      weeklyObligationPlan: emptyWeeklyObligationPlan(),
      weeklyObligationEvaluations: [],
      protectedCoverage: {
        muscles: [],
        deficitsBelowMev: [],
        deficitsBelowPracticalFloor: [],
        unresolvedProtectedMuscles: [],
      },
      supportFloorRepairReasons: {},
      programQualityAppliedDiagnostics: [],
      programQualityEvaluation: {
        totalPenalty: 0,
        diagnostics: [],
        constraintCounts: {},
      },
      preselectionDemands: [
        {
          slotId: "upper_a",
          muscle: "Rear Delts",
          selectedEffectiveSets: 2,
          consumedBySelection: true,
          targetMet: true,
        },
      ],
    });

    expect(diagnostic.rearDeltCollateralSummary).toMatchObject({
      upperBackCollateralDelta: 2,
      rearDeltPreselectionConsumed: true,
    });
    expect(diagnostic.rearDeltCollateralSummary?.verdict).toMatch(
      /^(mixed|worse)_collateral$/,
    );
    expect(diagnostic.warnings.map((warning) => warning.code)).toContain(
      "REAR_DELT_COLLATERAL_UPPER_BACK_INCREASE",
    );
  });

  it("treats direct Rear Delts closure without collateral burden as a clean improvement", () => {
    const slotSequence = [{ slotId: "upper_a", intent: "UPPER" as const }];
    const initialUpper = makeProjectedSlotWithContributions({
      slotId: "upper_a",
      intent: "UPPER",
      workout: makeProjectedWorkout({}),
    });
    const finalUpper = makeProjectedSlotWithContributions({
      slotId: "upper_a",
      intent: "UPPER",
      workout: makeProjectedWorkout({
        accessories: [
          makeProjectedExercise({
            id: "rear-delt-fly",
            name: "Cable Rear Delt Fly",
            movementPatterns: ["isolation"],
            primaryMuscles: ["Rear Delts"],
            sets: 2,
            isCompound: false,
            stimulusProfile: { rear_delts: 1 },
          }),
        ],
      }),
    });

    const diagnostic = buildWeeklyDemandSlotAllocationDiagnostic({
      activeMesocycle: buildSource() as never,
      slotSequence,
      initialProjectedSlots: [initialUpper],
      finalProjectedSlots: [finalUpper],
      weeklyObligationPlan: emptyWeeklyObligationPlan(),
      weeklyObligationEvaluations: [],
      protectedCoverage: {
        muscles: [],
        deficitsBelowMev: [],
        deficitsBelowPracticalFloor: [],
        unresolvedProtectedMuscles: [],
      },
      supportFloorRepairReasons: {},
      programQualityAppliedDiagnostics: [],
      programQualityEvaluation: {
        totalPenalty: 0,
        diagnostics: [],
        constraintCounts: {},
      },
      preselectionDemands: [
        {
          slotId: "upper_a",
          muscle: "Rear Delts",
          selectedEffectiveSets: 2,
          consumedBySelection: true,
          targetMet: true,
        },
      ],
    });

    expect(diagnostic.rearDeltCollateralSummary).toMatchObject({
      directRearDeltStimulusBefore: 0,
      directRearDeltStimulusAfter: 2,
      upperBackCollateralDelta: 0,
      pullPatternConcentrationDelta: 0,
      suspiciousRepairDelta: 0,
      capTrimOrRemovalDelta: 0,
      verdict: "clean_improvement",
    });
    expect(diagnostic.warnings.map((warning) => warning.code)).not.toContain(
      "REAR_DELT_PRESELECTION_CONSUMED_BUT_PROGRAM_WORSE",
    );
  });

  it("does not emit Rear Delts collateral warnings for non-Rear-Delts promotions", () => {
    const slotSequence = [{ slotId: "upper_b", intent: "UPPER" as const }];
    const initialUpper = makeProjectedSlotWithContributions({
      slotId: "upper_b",
      intent: "UPPER",
      workout: makeProjectedWorkout({}),
    });
    const finalUpper = makeProjectedSlotWithContributions({
      slotId: "upper_b",
      intent: "UPPER",
      workout: makeProjectedWorkout({
        accessories: [
          makeProjectedExercise({
            id: "cable-lateral-raise",
            name: "Cable Lateral Raise",
            movementPatterns: ["isolation"],
            primaryMuscles: ["Side Delts"],
            sets: 2,
            isCompound: false,
            stimulusProfile: { side_delts: 1 },
          }),
        ],
      }),
    });

    const diagnostic = buildWeeklyDemandSlotAllocationDiagnostic({
      activeMesocycle: buildSource() as never,
      slotSequence,
      initialProjectedSlots: [initialUpper],
      finalProjectedSlots: [finalUpper],
      weeklyObligationPlan: emptyWeeklyObligationPlan(),
      weeklyObligationEvaluations: [],
      protectedCoverage: {
        muscles: [],
        deficitsBelowMev: [],
        deficitsBelowPracticalFloor: [],
        unresolvedProtectedMuscles: [],
      },
      supportFloorRepairReasons: {},
      programQualityAppliedDiagnostics: [],
      programQualityEvaluation: {
        totalPenalty: 0,
        diagnostics: [],
        constraintCounts: {},
      },
      preselectionDemands: [
        {
          slotId: "upper_b",
          muscle: "Side Delts",
          selectedEffectiveSets: 2,
          consumedBySelection: true,
          targetMet: true,
        },
      ],
    });

    expect(diagnostic.rearDeltCollateralSummary).toBeUndefined();
    expect(diagnostic.warnings.map((warning) => warning.code)).not.toEqual(
      expect.arrayContaining([
        "REAR_DELT_COLLATERAL_UPPER_BACK_INCREASE",
        "REAR_DELT_COLLATERAL_PULL_CONCENTRATION",
        "REAR_DELT_COLLATERAL_CAP_TRIM",
        "REAR_DELT_COLLATERAL_SUSPICIOUS_REPAIR_INCREASE",
        "REAR_DELT_PRESELECTION_CONSUMED_BUT_PROGRAM_WORSE",
      ]),
    );
  });

  it("flags consumed preselection demand when the target is not met", () => {
    const diagnostic = buildWeeklyDemandSlotAllocationDiagnostic({
      activeMesocycle: buildSource() as never,
      slotSequence: [{ slotId: "upper_b", intent: "UPPER" as const }],
      initialProjectedSlots: [],
      finalProjectedSlots: [],
      weeklyObligationPlan: emptyWeeklyObligationPlan(),
      weeklyObligationEvaluations: [],
      protectedCoverage: {
        muscles: [],
        deficitsBelowMev: [],
        deficitsBelowPracticalFloor: [],
        unresolvedProtectedMuscles: [],
      },
      supportFloorRepairReasons: {},
      programQualityAppliedDiagnostics: [],
      programQualityEvaluation: {
        totalPenalty: 0,
        diagnostics: [],
        constraintCounts: {},
      },
      preselectionDemands: [
        {
          slotId: "upper_b",
          muscle: "Triceps",
          role: "support",
          targetStatus: "soft",
          selectedEffectiveSets: 0.9,
          preferredEffectiveSets: 5,
          minEffectiveSets: 5,
          consumedBySelection: true,
          targetMet: false,
        },
      ],
    });

    expect(diagnostic.weakPreselectionConsumption).toEqual([
      {
        slotId: "upper_b",
        muscle: "Triceps",
        role: "support",
        targetStatus: "soft",
        selectedEffectiveSets: 0.9,
        preferredEffectiveSets: 5,
        minEffectiveSets: 5,
        consumedBySelection: true,
        targetMet: false,
        reason: "consumed_but_target_not_met",
      },
    ]);
  });

  it("does not flag consumed preselection demand when the target is met", () => {
    const diagnostic = buildWeeklyDemandSlotAllocationDiagnostic({
      activeMesocycle: buildSource() as never,
      slotSequence: [{ slotId: "upper_b", intent: "UPPER" as const }],
      initialProjectedSlots: [],
      finalProjectedSlots: [],
      weeklyObligationPlan: emptyWeeklyObligationPlan(),
      weeklyObligationEvaluations: [],
      protectedCoverage: {
        muscles: [],
        deficitsBelowMev: [],
        deficitsBelowPracticalFloor: [],
        unresolvedProtectedMuscles: [],
      },
      supportFloorRepairReasons: {},
      programQualityAppliedDiagnostics: [],
      programQualityEvaluation: {
        totalPenalty: 0,
        diagnostics: [],
        constraintCounts: {},
      },
      preselectionDemands: [
        {
          slotId: "upper_b",
          muscle: "Side Delts",
          role: "support",
          targetStatus: "soft",
          selectedEffectiveSets: 2,
          preferredEffectiveSets: 2,
          minEffectiveSets: 2,
          consumedBySelection: true,
          targetMet: true,
        },
      ],
    });

    expect(diagnostic.weakPreselectionConsumption).toEqual([]);
  });

  it("does not treat non-consumed preselection demand as weak consumption", () => {
    const diagnostic = buildWeeklyDemandSlotAllocationDiagnostic({
      activeMesocycle: buildSource() as never,
      slotSequence: [{ slotId: "upper_b", intent: "UPPER" as const }],
      initialProjectedSlots: [],
      finalProjectedSlots: [],
      weeklyObligationPlan: emptyWeeklyObligationPlan(),
      weeklyObligationEvaluations: [],
      protectedCoverage: {
        muscles: [],
        deficitsBelowMev: [],
        deficitsBelowPracticalFloor: [],
        unresolvedProtectedMuscles: [],
      },
      supportFloorRepairReasons: {},
      programQualityAppliedDiagnostics: [],
      programQualityEvaluation: {
        totalPenalty: 0,
        diagnostics: [],
        constraintCounts: {},
      },
      preselectionDemands: [
        {
          slotId: "upper_b",
          muscle: "Triceps",
          role: "support",
          targetStatus: "soft",
          selectedEffectiveSets: 0,
          preferredEffectiveSets: 5,
          minEffectiveSets: 5,
          consumedBySelection: false,
          targetMet: false,
        },
      ],
    });

    expect(diagnostic.weakPreselectionConsumption).toEqual([]);
  });

  it("keeps successful Side Delts preselection clean", () => {
    const projected = projectSuccessorSlotPlansFromSnapshot({
      userId: "user-1",
      source: buildSource(),
      design: buildDesign(buildRepairSensitiveDraft()),
      snapshot: buildProtectedCoverageSatisfiedSnapshot(),
      now: new Date("2026-03-19T12:00:00.000Z"),
    });

    expect("error" in projected).toBe(false);
    if ("error" in projected) return;

    const sideDeltDemand =
      projected.diagnostics?.preselectionDemands?.find(
        (demand) => demand.slotId === "upper_b" && demand.muscle === "Side Delts",
      );

    expect(sideDeltDemand).toMatchObject({
      consumedBySelection: true,
      targetMet: true,
    });
    expect(
      projected.diagnostics?.planningReality?.weakPreselectionConsumption,
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slotId: "upper_b", muscle: "Side Delts" }),
      ]),
    );
    expect(
      projected.diagnostics?.planningReality?.setDistributionIntents
        .find((intent) => intent.slotId === "upper_b")
        ?.musclePolicies.find((policy) => policy.muscle === "Side Delts"),
    ).toMatchObject({
      targetStatus: "soft",
      demandType: "soft_direct_allowed",
      whenAtLimit: "prefer_alternative",
    });
  });

  it("prevents upper_b from finishing with zero Chest while Chest remains a hard weekly obligation", () => {
    const projected = projectSuccessorSlotPlansFromSnapshot({
      userId: "user-1",
      source: buildSource(),
      design: buildDesign(buildRepairSensitiveDraft()),
      snapshot: buildProtectedCoverageSatisfiedSnapshot(),
      now: new Date("2026-03-19T12:00:00.000Z"),
    });

    const upperBChest =
      projected.diagnostics?.weeklyObligations?.slotEvaluations.find(
        (row) => row.slotId === "upper_b" && row.muscle === "Chest",
      );
    const zeroContributionSlots =
      projected.diagnostics?.weeklyObligations?.zeroContributionSlots ?? [];
    const chest = getCoverageRow(projected, "Chest");

    expect(upperBChest?.projectedEffectiveSets ?? 0).toBeGreaterThan(0);
    expect(zeroContributionSlots).not.toContainEqual(
      expect.objectContaining({ slotId: "upper_b", muscle: "Chest" }),
    );
    expect(chest?.projectedEffectiveSets ?? 0).toBeGreaterThanOrEqual(
      chest?.mev ?? 0,
    );
  });

  it("diagnoses repeated Lat Pulldown accessories when another lat pull alternative exists", () => {
    const pulldown = makeProjectedExercise({
      id: "pulldown",
      name: "Lat Pulldown",
      movementPatterns: ["vertical_pull"],
      primaryMuscles: ["Lats"],
      isCompound: false,
    });
    const seatedRow = makeProjectedExercise({
      id: "seated-row",
      name: "Seated Cable Row",
      movementPatterns: ["horizontal_pull"],
      primaryMuscles: ["Lats"],
      isCompound: false,
    });
    const previousSlot = {
      slotPlan: {
        slotId: "upper_a",
        intent: "UPPER" as const,
        exercises: [],
      },
      workout: makeProjectedWorkout({ accessories: [pulldown] }),
      projectedContributionByMuscle: new Map([["Lats", 3]]),
      repairMuscles: [],
    };

    const reuse = evaluateDuplicateExerciseReuse({
      projectedSlots: [previousSlot],
      workout: makeProjectedWorkout({ accessories: [pulldown] }),
      slotId: "upper_b",
      exerciseLibrary: [pulldown.exercise, seatedRow.exercise] as never,
    });

    expect(reuse.penalty).toBeGreaterThan(0);
    expect(reuse.diagnostics).toContainEqual(
      expect.objectContaining({
        exerciseId: "pulldown",
        repeatedInSlotId: "upper_b",
        previousSlotIds: ["upper_a"],
        role: "accessory",
        hasCompatibleAlternative: true,
        reason: "accessory_repeat_discouraged",
      }),
    );
  });

  it("escalates duplicate main-lift pressure when a compatible alternative exists", () => {
    const incline = makeProjectedExercise({
      id: "incline-db-bench",
      name: "Incline DB Bench",
      movementPatterns: ["horizontal_push"],
      primaryMuscles: ["Chest"],
      sets: 3,
      isMainLift: true,
    });
    const machinePress = makeProjectedExercise({
      id: "machine-press",
      name: "Machine Chest Press",
      movementPatterns: ["horizontal_push"],
      primaryMuscles: ["Chest"],
      sets: 3,
      isMainLift: true,
    });
    const previousSlot = {
      slotPlan: {
        slotId: "upper_a",
        intent: "UPPER" as const,
        exercises: [],
      },
      workout: makeProjectedWorkout({ mainLifts: [incline] }),
      projectedContributionByMuscle: new Map([["Chest", 3]]),
      repairMuscles: [],
    };

    const reuse = evaluateDuplicateExerciseReuse({
      projectedSlots: [previousSlot],
      workout: makeProjectedWorkout({ mainLifts: [incline] }),
      slotId: "upper_b",
      exerciseLibrary: [incline.exercise, machinePress.exercise] as never,
    });

    expect(reuse.penalty).toBeGreaterThanOrEqual(4);
    expect(reuse.diagnostics).toContainEqual(
      expect.objectContaining({
        exerciseId: "incline-db-bench",
        role: "main",
        hasCompatibleAlternative: true,
        reason: "main_lift_duplicate_discouraged",
      }),
    );
  });

  it("requires explicit class-level justification for repeated diagnostic exercises", () => {
    const slotSequence = [
      { slotId: "upper_a", intent: "UPPER" as const },
      { slotId: "upper_b", intent: "UPPER" as const },
      { slotId: "lower_a", intent: "LOWER" as const },
      { slotId: "lower_b", intent: "LOWER" as const },
    ];
    const incline = makeProjectedExercise({
      id: "incline-db-bench",
      name: "Incline DB Bench",
      movementPatterns: ["horizontal_push"],
      primaryMuscles: ["Chest"],
      sets: 3,
      isMainLift: true,
      stimulusProfile: { chest: 1 },
    });
    const latPulldown = makeProjectedExercise({
      id: "lat-pulldown",
      name: "Lat Pulldown",
      movementPatterns: ["vertical_pull"],
      primaryMuscles: ["Lats"],
      sets: 3,
      isCompound: false,
      stimulusProfile: { lats: 1 },
    });
    const sldl = makeProjectedExercise({
      id: "sldl",
      name: "SLDL",
      movementPatterns: ["hinge"],
      primaryMuscles: ["Hamstrings"],
      sets: 3,
      isMainLift: true,
      stimulusProfile: { hamstrings: 1, glutes: 0.6, lower_back: 0.4 },
    });
    const backSquat = makeProjectedExercise({
      id: "back-squat",
      name: "Barbell Back Squat",
      movementPatterns: ["squat"],
      primaryMuscles: ["Quads"],
      sets: 3,
      isMainLift: true,
      stimulusProfile: { quads: 1, glutes: 0.5, core: 0.3 },
    });
    const machinePress = makeProjectedExercise({
      id: "machine-chest-press",
      name: "Machine Chest Press",
      movementPatterns: ["horizontal_push"],
      primaryMuscles: ["Chest"],
      sets: 3,
      isMainLift: true,
      stimulusProfile: { chest: 1 },
    });
    const seatedRow = makeProjectedExercise({
      id: "seated-cable-row",
      name: "Seated Cable Row",
      movementPatterns: ["horizontal_pull"],
      primaryMuscles: ["Lats"],
      sets: 3,
      isCompound: false,
      stimulusProfile: { lats: 1 },
    });
    const legPress = makeProjectedExercise({
      id: "leg-press",
      name: "Leg Press",
      movementPatterns: ["squat"],
      primaryMuscles: ["Quads"],
      sets: 3,
      isMainLift: true,
      stimulusProfile: { quads: 1 },
    });
    const romanianDeadlift = makeProjectedExercise({
      id: "romanian-deadlift",
      name: "Romanian Deadlift",
      movementPatterns: ["hinge"],
      primaryMuscles: ["Hamstrings"],
      sets: 3,
      isMainLift: true,
      stimulusProfile: { hamstrings: 1, glutes: 0.5, lower_back: 0.3 },
    });

    const diagnostic = buildWeeklyDemandSlotAllocationDiagnostic({
      activeMesocycle: buildSource() as never,
      slotSequence,
      exerciseLibrary: [
        incline.exercise,
        latPulldown.exercise,
        sldl.exercise,
        backSquat.exercise,
        machinePress.exercise,
        seatedRow.exercise,
        legPress.exercise,
        romanianDeadlift.exercise,
      ] as never,
      initialProjectedSlots: [
        makeProjectedSlotWithContributions({
          slotId: "upper_a",
          intent: "UPPER",
          workout: makeProjectedWorkout({ mainLifts: [incline], accessories: [latPulldown] }),
        }),
        makeProjectedSlotWithContributions({
          slotId: "upper_b",
          intent: "UPPER",
          workout: makeProjectedWorkout({ mainLifts: [incline], accessories: [latPulldown] }),
        }),
        makeProjectedSlotWithContributions({
          slotId: "lower_a",
          intent: "LOWER",
          workout: makeProjectedWorkout({ mainLifts: [sldl, backSquat] }),
        }),
        makeProjectedSlotWithContributions({
          slotId: "lower_b",
          intent: "LOWER",
          workout: makeProjectedWorkout({ mainLifts: [sldl, backSquat] }),
        }),
      ],
      finalProjectedSlots: [
        makeProjectedSlotWithContributions({
          slotId: "upper_a",
          intent: "UPPER",
          workout: makeProjectedWorkout({ mainLifts: [incline], accessories: [latPulldown] }),
        }),
        makeProjectedSlotWithContributions({
          slotId: "upper_b",
          intent: "UPPER",
          workout: makeProjectedWorkout({ mainLifts: [incline], accessories: [latPulldown] }),
        }),
        makeProjectedSlotWithContributions({
          slotId: "lower_a",
          intent: "LOWER",
          workout: makeProjectedWorkout({ mainLifts: [sldl, backSquat] }),
        }),
        makeProjectedSlotWithContributions({
          slotId: "lower_b",
          intent: "LOWER",
          workout: makeProjectedWorkout({ mainLifts: [sldl, backSquat] }),
        }),
      ],
      weeklyObligationPlan: weeklyObligationPlan({
        Chest: {
          targetSets: 6,
          allocatedSlots: [
            { slotId: "upper_a", minEffectiveSets: 3, priority: "primary" },
            { slotId: "upper_b", minEffectiveSets: 3, priority: "primary" },
          ],
        },
        Lats: {
          targetSets: 6,
          allocatedSlots: [
            { slotId: "upper_a", minEffectiveSets: 3, priority: "primary" },
            { slotId: "upper_b", minEffectiveSets: 3, priority: "primary" },
          ],
        },
        Quads: {
          targetSets: 6,
          allocatedSlots: [
            { slotId: "lower_a", minEffectiveSets: 3, priority: "primary" },
            { slotId: "lower_b", minEffectiveSets: 3, priority: "primary" },
          ],
        },
        Hamstrings: {
          targetSets: 6,
          allocatedSlots: [
            { slotId: "lower_a", minEffectiveSets: 3, priority: "primary" },
            { slotId: "lower_b", minEffectiveSets: 3, priority: "primary" },
          ],
        },
      }),
      weeklyObligationEvaluations: [],
      protectedCoverage: {
        muscles: [],
        deficitsBelowMev: [],
        deficitsBelowPracticalFloor: [],
        unresolvedProtectedMuscles: [],
      },
      supportFloorRepairReasons: {},
      programQualityAppliedDiagnostics: [],
      programQualityEvaluation: {
        totalPenalty: 0,
        diagnostics: [],
        constraintCounts: {},
      },
      duplicateExerciseReuse: [
        {
          exerciseId: "incline-db-bench",
          name: "Incline DB Bench",
          repeatedInSlotId: "upper_b",
          previousSlotIds: ["upper_a"],
          role: "main",
          hasCompatibleAlternative: true,
          reason: "main_lift_duplicate_discouraged",
        },
        {
          exerciseId: "lat-pulldown",
          name: "Lat Pulldown",
          repeatedInSlotId: "upper_b",
          previousSlotIds: ["upper_a"],
          role: "accessory",
          hasCompatibleAlternative: true,
          reason: "accessory_repeat_discouraged",
        },
        {
          exerciseId: "sldl",
          name: "SLDL",
          repeatedInSlotId: "lower_b",
          previousSlotIds: ["lower_a"],
          role: "main",
          hasCompatibleAlternative: true,
          reason: "main_lift_duplicate_discouraged",
        },
        {
          exerciseId: "back-squat",
          name: "Barbell Back Squat",
          repeatedInSlotId: "lower_b",
          previousSlotIds: ["lower_a"],
          role: "main",
          hasCompatibleAlternative: true,
          reason: "main_lift_duplicate_discouraged",
        },
      ],
    });

    const classRows = diagnostic.exerciseClassDistributionBySlot;
    const findDemand = (slotId: string, muscle: string) =>
      classRows
        .find((slot) => slot.week === 1 && slot.slotId === slotId)
        ?.muscleDemands.find((row) => row.muscle === muscle);

    for (const demand of [
      findDemand("upper_b", "Chest"),
      findDemand("upper_b", "Lats"),
      findDemand("lower_b", "Hamstrings"),
      findDemand("lower_b", "Quads"),
    ]) {
      expect(demand).toMatchObject({
        duplicatePolicy: "block_if_clean_alternative_exists",
        duplicateJustifications: [],
        limitations: expect.arrayContaining([
          "duplicate_exercise_class_reuse_requires_explicit_justification",
        ]),
      });
    }
    expect(findDemand("upper_b", "Chest")?.inventoryEvidence).toEqual(
      expect.arrayContaining([
        expect.stringContaining("duplicate:Incline DB Bench"),
      ]),
    );
    expect(findDemand("upper_b", "Lats")?.inventoryEvidence).toEqual(
      expect.arrayContaining([expect.stringContaining("duplicate:Lat Pulldown")]),
    );
    expect(findDemand("lower_b", "Hamstrings")?.inventoryEvidence).toEqual(
      expect.arrayContaining([expect.stringContaining("duplicate:SLDL")]),
    );
    expect(findDemand("lower_b", "Quads")?.inventoryEvidence).toEqual(
      expect.arrayContaining([
        expect.stringContaining("duplicate:Barbell Back Squat"),
      ]),
    );
    const upperBAlignmentWarnings =
      diagnostic.exerciseClassAlignment.slots.find((slot) => slot.slotId === "upper_b")
        ?.slotWarnings ?? [];
    const lowerBAlignmentWarnings =
      diagnostic.exerciseClassAlignment.slots.find((slot) => slot.slotId === "lower_b")
        ?.slotWarnings ?? [];
    expect(upperBAlignmentWarnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Incline DB Bench"),
        expect.stringContaining("Lat Pulldown"),
      ]),
    );
    expect(lowerBAlignmentWarnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("SLDL"),
        expect.stringContaining("Barbell Back Squat"),
      ]),
    );

    const duplicateDiagnostic = diagnostic.duplicateContinuityJustification;
    const duplicateByName = (name: string) =>
      duplicateDiagnostic.duplicates.find((row) => row.exerciseName === name);

    expect(duplicateDiagnostic).toMatchObject({
      version: 1,
      source: "diagnostic_shadow_planner",
      readOnly: true,
      affectsScoringOrGeneration: false,
      summary: expect.objectContaining({
        totalDuplicates: 4,
        cleanAlternativeAvailable: 4,
      }),
    });
    expect(duplicateByName("Incline DB Bench")).toMatchObject({
      duplicateType: "same_exercise_cross_slot",
      duplicatedInSlots: ["upper_a", "upper_b"],
      roleBySlot: { upper_a: "main", upper_b: "main" },
      setCountBySlot: { upper_a: 3, upper_b: 3 },
      primaryMuscles: ["Chest"],
      movementPatterns: ["horizontal_push"],
      exerciseClass: "incline_press",
      justification: "continuity_anchor",
      compatibleAlternativeExists: true,
      policyRecommendation: "block_if_clean_alternative_exists",
      risk: "high",
      compatibleAlternatives: expect.arrayContaining([
        expect.objectContaining({ exerciseName: "Machine Chest Press" }),
      ]),
    });
    expect(duplicateByName("Lat Pulldown")).toMatchObject({
      duplicateType: "same_exercise_cross_slot",
      duplicatedInSlots: ["upper_a", "upper_b"],
      justification: "unjustified",
      compatibleAlternativeExists: true,
      policyRecommendation: "discourage_duplicate",
      risk: "moderate",
    });
    expect(duplicateByName("SLDL")).toMatchObject({
      duplicateType: "same_exercise_cross_slot",
      duplicatedInSlots: ["lower_a", "lower_b"],
      exerciseClass: "stiff_leg_deadlift",
      justification: "exact_demand_fit",
      compatibleAlternativeExists: true,
      policyRecommendation: "requires_planner_decision",
    });
    expect(duplicateByName("Barbell Back Squat")).toMatchObject({
      duplicateType: "same_exercise_cross_slot",
      duplicatedInSlots: ["lower_a", "lower_b"],
      justification: "unjustified",
      compatibleAlternativeExists: true,
      policyRecommendation: "discourage_duplicate",
    });
    expect(JSON.stringify(duplicateDiagnostic).length).toBeLessThan(20000);
    expect(JSON.stringify(diagnostic.finalSlotPlan)).not.toContain(
      "duplicateContinuityJustification",
    );
  });

  it("detects same-session calf variants as duplicate continuity pressure", () => {
    const slotSequence = [{ slotId: "lower_b", intent: "LOWER" as const }];
    const standingCalfRaise = makeProjectedExercise({
      id: "standing-calf-raise",
      name: "Standing Calf Raise",
      movementPatterns: ["isolation"],
      primaryMuscles: ["Calves"],
      sets: 2,
      isCompound: false,
      stimulusProfile: { calves: 1 },
    });
    const seatedCalfRaise = makeProjectedExercise({
      id: "seated-calf-raise",
      name: "Seated Calf Raise",
      movementPatterns: ["isolation"],
      primaryMuscles: ["Calves"],
      sets: 2,
      isCompound: false,
      stimulusProfile: { calves: 1 },
    });

    const diagnostic = buildWeeklyDemandSlotAllocationDiagnostic({
      activeMesocycle: buildSource() as never,
      slotSequence,
      exerciseLibrary: [
        standingCalfRaise.exercise,
        seatedCalfRaise.exercise,
      ] as never,
      initialProjectedSlots: [
        makeProjectedSlotWithContributions({
          slotId: "lower_b",
          intent: "LOWER",
          workout: makeProjectedWorkout({
            accessories: [standingCalfRaise, seatedCalfRaise],
          }),
        }),
      ],
      finalProjectedSlots: [
        makeProjectedSlotWithContributions({
          slotId: "lower_b",
          intent: "LOWER",
          workout: makeProjectedWorkout({
            accessories: [standingCalfRaise, seatedCalfRaise],
          }),
        }),
      ],
      weeklyObligationPlan: emptyWeeklyObligationPlan(),
      weeklyObligationEvaluations: [],
      protectedCoverage: {
        muscles: [],
        deficitsBelowMev: [],
        deficitsBelowPracticalFloor: [],
        unresolvedProtectedMuscles: [],
      },
      supportFloorRepairReasons: {},
      programQualityAppliedDiagnostics: [],
      programQualityEvaluation: {
        totalPenalty: 0,
        diagnostics: [],
        constraintCounts: {},
      },
    });

    expect(diagnostic.duplicateContinuityJustification.duplicates).toContainEqual(
      expect.objectContaining({
        duplicateType: "same_session_variant",
        exerciseName: "Seated Calf Raise + Standing Calf Raise",
        duplicatedInSlots: ["lower_b"],
        primaryMuscles: ["Calves"],
        exerciseClass: "calf_raise",
        justification: "unjustified",
        policyRecommendation: "discourage_duplicate",
      }),
    );
  });

  it("marks duplicate continuity justified when explicit continuity evidence has no clean alternative", () => {
    const slotSequence = [
      { slotId: "lower_a", intent: "LOWER" as const },
      { slotId: "lower_b", intent: "LOWER" as const },
    ];
    const sldl = makeProjectedExercise({
      id: "sldl",
      name: "SLDL",
      movementPatterns: ["hinge"],
      primaryMuscles: ["Hamstrings"],
      sets: 3,
      isMainLift: true,
      stimulusProfile: { hamstrings: 1 },
    });

    const diagnostic = buildWeeklyDemandSlotAllocationDiagnostic({
      activeMesocycle: buildSource() as never,
      slotSequence,
      exerciseLibrary: [sldl.exercise] as never,
      initialProjectedSlots: [
        makeProjectedSlotWithContributions({
          slotId: "lower_a",
          intent: "LOWER",
          workout: makeProjectedWorkout({ mainLifts: [sldl] }),
        }),
        makeProjectedSlotWithContributions({
          slotId: "lower_b",
          intent: "LOWER",
          workout: makeProjectedWorkout({ mainLifts: [sldl] }),
        }),
      ],
      finalProjectedSlots: [
        makeProjectedSlotWithContributions({
          slotId: "lower_a",
          intent: "LOWER",
          workout: makeProjectedWorkout({ mainLifts: [sldl] }),
        }),
        makeProjectedSlotWithContributions({
          slotId: "lower_b",
          intent: "LOWER",
          workout: makeProjectedWorkout({ mainLifts: [sldl] }),
        }),
      ],
      weeklyObligationPlan: weeklyObligationPlan({
        Hamstrings: {
          targetSets: 6,
          allocatedSlots: [
            { slotId: "lower_a", minEffectiveSets: 3, priority: "primary" },
            { slotId: "lower_b", minEffectiveSets: 3, priority: "primary" },
          ],
        },
      }),
      weeklyObligationEvaluations: [],
      protectedCoverage: {
        muscles: [],
        deficitsBelowMev: [],
        deficitsBelowPracticalFloor: [],
        unresolvedProtectedMuscles: [],
      },
      supportFloorRepairReasons: {},
      programQualityAppliedDiagnostics: [],
      programQualityEvaluation: {
        totalPenalty: 0,
        diagnostics: [],
        constraintCounts: {},
      },
      duplicateExerciseReuse: [
        {
          exerciseId: "sldl",
          name: "SLDL",
          repeatedInSlotId: "lower_b",
          previousSlotIds: ["lower_a"],
          role: "main",
          hasCompatibleAlternative: false,
          reason: "main_lift_continuity_allowed",
        },
      ],
    });

    expect(
      diagnostic.duplicateContinuityJustification.duplicates.find(
        (row) => row.exerciseName === "SLDL",
      ),
    ).toMatchObject({
      justification: "no_clean_alternative",
      compatibleAlternativeExists: false,
      policyRecommendation: "allow_duplicate",
    });
  });

  it("forwards protected repair muscles into upper-slot projection candidates", () => {
    composeIntentSessionFromMappedContextSpy.mockClear();

    projectSuccessorSlotPlansFromSnapshot({
      userId: "user-1",
      source: buildSource(),
      design: buildDesign(buildRepairSensitiveDraft()),
      snapshot: buildRepairSensitiveSnapshot(),
      now: new Date("2026-03-19T12:00:00.000Z"),
    });

    const upperRepairCalls = composeIntentSessionFromMappedContextSpy.mock.calls
      .map(([, input]) => input)
      .filter(
        (input) =>
          (input.slotId === "upper_a" || input.slotId === "upper_b") &&
          Array.isArray(input.projectionRepairMuscles) &&
          input.projectionRepairMuscles.length > 0,
      );

    expect(upperRepairCalls.length).toBeGreaterThan(0);
    expect(
      upperRepairCalls.some((input) =>
        ["Chest", "Triceps"].every((muscle) =>
          (input.projectionRepairMuscles ?? []).includes(muscle),
        ),
      ),
    ).toBe(true);
  });

  it("promotes only compatible slot-owned preselection demand before repair", () => {
    composeIntentSessionFromMappedContextSpy.mockClear();

    const projected = projectSuccessorSlotPlansFromSnapshot({
      userId: "user-1",
      source: buildSource(),
      design: buildDesign(buildRepairSensitiveDraft()),
      snapshot: buildProtectedCoverageSatisfiedSnapshot(),
      now: new Date("2026-03-19T12:00:00.000Z"),
    });

    const demandCalls = composeIntentSessionFromMappedContextSpy.mock.calls
      .map(([, input]) => input)
      .filter((input) => Array.isArray(input.slotPreselectionDemands));
    const allDemands = demandCalls.flatMap(
      (input) => input.slotPreselectionDemands ?? [],
    );
    const lowerBDemands = allDemands.filter(
      (demand) => demand.slotId === "lower_b",
    );

    expect(allDemands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slotId: "upper_b",
          muscle: "Side Delts",
          role: "support",
          targetStatus: "soft",
          source: "authored_slot_support",
        }),
      ]),
    );
    expect(lowerBDemands).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ muscle: "Chest" })]),
    );
    expect(allDemands).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ muscle: "Front Delts" }),
        expect.objectContaining({ muscle: "Upper Back" }),
        expect.objectContaining({ muscle: "Lower Back" }),
        expect.objectContaining({ muscle: "Core" }),
        expect.objectContaining({ muscle: "Adductors" }),
        expect.objectContaining({ muscle: "Forearms" }),
      ]),
    );

    expect(projected.diagnostics?.preselectionDemands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slotId: "upper_b",
          muscle: "Side Delts",
          selectedEffectiveSets: expect.any(Number),
          consumedBySelection: expect.any(Boolean),
          targetMet: expect.any(Boolean),
        }),
      ]),
    );
    expect(JSON.stringify(getProjectedSlotPlans(projected))).not.toContain(
      "preselection",
    );
  });

  it("persists lower_b with a hinge-led core anchor when a hinge compound is viable", () => {
    const projected = projectSuccessorSlotPlansFromSnapshot({
      userId: "user-1",
      source: buildSource(),
      design: buildDesign(),
      snapshot: buildSnapshot(),
      now: new Date("2026-03-19T12:00:00.000Z"),
    });

    const lowerB = getProjectedSlotPlans(projected).find(
      (slot) => slot.slotId === "lower_b",
    );
    const firstCoreCompound = lowerB?.exercises.find(
      (exercise) => exercise.role === "CORE_COMPOUND",
    );

    expect(firstCoreCompound?.exerciseId).toBe("rdl");
  });

  it("keeps lower_b hinge-led while adding one meaningful quad-support option without inflating the slot", () => {
    const projected = projectSuccessorSlotPlansFromSnapshot({
      userId: "user-1",
      source: buildSource(),
      design: buildDesign(buildRepairSensitiveDraft()),
      snapshot: buildProtectedCoverageSatisfiedSnapshot(),
      now: new Date("2026-03-19T12:00:00.000Z"),
    });

    const slotPlans = getProjectedSlotPlans(projected);
    const lowerA = slotPlans.find((slot) => slot.slotId === "lower_a");
    const lowerB = slotPlans.find((slot) => slot.slotId === "lower_b");
    const lowerBExerciseIds =
      lowerB?.exercises.map((exercise) => exercise.exerciseId) ?? [];

    expect(lowerBExerciseIds[0]).toBe("rdl");
    expect(
      lowerBExerciseIds.some((exerciseId) =>
        ["hack-squat", "leg-extension"].includes(exerciseId),
      ),
    ).toBe(true);
    expect(lowerBExerciseIds).not.toEqual(
      lowerA?.exercises.map((exercise) => exercise.exerciseId),
    );
    expect(lowerBExerciseIds.length).toBeLessThanOrEqual(6);
  });

  it("closes Week 1 support floors without over-inflating support accessories", () => {
    const projected = projectSuccessorSlotPlansFromSnapshot({
      userId: "user-1",
      source: buildSource(),
      design: buildDesign(buildRepairSensitiveDraft()),
      snapshot: buildProtectedCoverageSatisfiedSnapshot(),
      now: new Date("2026-03-19T12:00:00.000Z"),
    });

    const calves = getCoverageRow(projected, "Calves");
    const sideDelts = getCoverageRow(projected, "Side Delts");
    const biceps = getCoverageRow(projected, "Biceps");
    const triceps = getCoverageRow(projected, "Triceps");
    const rearDelts = getCoverageRow(projected, "Rear Delts");
    const chest = getCoverageRow(projected, "Chest");
    const lats = getCoverageRow(projected, "Lats");
    const quads = getCoverageRow(projected, "Quads");
    const hamstrings = getCoverageRow(projected, "Hamstrings");
    const slotPlans = getProjectedSlotPlans(projected);
    const upperB = slotPlans.find((slot) => slot.slotId === "upper_b");
    const lowerB = slotPlans.find((slot) => slot.slotId === "lower_b");

    for (const row of [chest, lats, quads, hamstrings]) {
      if ((row?.projectedEffectiveSets ?? 0) < (row?.mev ?? 0)) {
        expect(
          projected.diagnostics?.planningReality?.forbiddenCleanupReroute
            ?.unresolvedDemand,
        ).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ muscle: row?.muscle }),
          ]),
        );
      } else {
        expect(row?.projectedEffectiveSets ?? 0).toBeGreaterThanOrEqual(
          row?.mev ?? 0,
        );
      }
    }
    expect(calves?.projectedEffectiveSets).toBeGreaterThanOrEqual(8);
    expect(sideDelts?.projectedEffectiveSets).toBeGreaterThanOrEqual(8);
    expect(biceps?.projectedEffectiveSets).toBeGreaterThanOrEqual(6);
    expect(triceps?.projectedEffectiveSets ?? 0).toBeGreaterThan(0);
    expect(rearDelts?.projectedEffectiveSets ?? 0).toBeGreaterThan(0);
    expect(upperB?.exercises.length ?? 0).toBeLessThanOrEqual(6);
    expect(
      upperB?.exercises.some(
        (exercise) => exercise.exerciseId === "lateral-raise",
      ),
    ).toBe(true);
    expect(
      slotPlans.every((slot) =>
        slot.exercises.every((exercise) =>
          exercise.role === "CORE_COMPOUND"
            ? exercise.setCount <= 5
            : exercise.setCount <= 4,
        ),
      ),
    ).toBe(true);
    expect(
      slotPlans.every((slot) =>
        slot.exercises.every(
          (exercise) =>
            exercise.setCount >= getMinimumViableSetCount(exercise.role),
        ),
      ),
    ).toBe(true);
    expect(
      slotPlans
        .flatMap((slot) => slot.exercises)
        .filter((exercise) =>
          ["lateral-raise", "cable-lateral-raise"].includes(
            exercise.exerciseId,
          ),
        )
        .map((exercise) => exercise.exerciseId),
    ).toEqual(expect.arrayContaining(["lateral-raise", "cable-lateral-raise"]));
    expect(lowerB?.exercises[0]?.exerciseId).toBe("rdl");
  });

  it("closes hamstring protected coverage by bumping existing hinge work without breaking lower_b identity", () => {
    const projected = projectSuccessorSlotPlansFromSnapshot({
      userId: "user-1",
      source: buildSource(),
      design: buildDesign(buildRepairSensitiveDraft()),
      snapshot: buildProtectedCoverageSatisfiedSnapshot(),
      now: new Date("2026-03-19T12:00:00.000Z"),
    });

    const hamstrings = getCoverageRow(projected, "Hamstrings");
    const lowerB = getProjectedSlotPlans(projected).find(
      (slot) => slot.slotId === "lower_b",
    );

    expect(hamstrings?.projectedEffectiveSets ?? 0).toBeGreaterThanOrEqual(
      hamstrings?.practicalFloor ?? 0,
    );
    expect(lowerB?.exercises[0]?.exerciseId).toBe("rdl");
  });

  it("keeps repairing when raw support sets overstate weighted effective coverage", () => {
    const snapshot = buildProtectedCoverageSatisfiedSnapshot();
    const lateralRaise = snapshot.context.exercises.find(
      (exercise) => exercise.id === "lateral-raise",
    ) as { stimulusProfile?: Record<string, number> } | undefined;
    if (lateralRaise) {
      lateralRaise.stimulusProfile = { side_delts: 0.5 };
    }

    const projected = projectSuccessorSlotPlansFromSnapshot({
      userId: "user-1",
      source: buildSource(),
      design: buildDesign(buildRepairSensitiveDraft()),
      snapshot,
      now: new Date("2026-03-19T12:00:00.000Z"),
    });

    expect(
      projected.diagnostics?.protectedCoverage.supportFloorRepairReasons[
        "Side Delts"
      ],
    ).toContain("support_accessory_replacement");
    expect(
      getCoverageRow(projected, "Side Delts")?.projectedEffectiveSets ?? 0,
    ).toBeGreaterThan(5);
    expect(
      getProjectedSlotPlans(projected)
        .flatMap((slot) => slot.exercises)
        .filter((exercise) =>
          ["lateral-raise", "cable-lateral-raise"].includes(
            exercise.exerciseId,
          ),
        )
        .every((exercise) => exercise.setCount <= 4),
    ).toBe(true);
  });

  it("downgrades unresolvable side-delt support to an explicit diagnostic", () => {
    const snapshot = buildProtectedCoverageSatisfiedSnapshot();
    snapshot.context.exercises = snapshot.context.exercises.filter(
      (exercise) =>
        !["lateral-raise", "cable-lateral-raise"].includes(exercise.id),
    );

    const projected = projectSuccessorSlotPlansFromSnapshot({
      userId: "user-1",
      source: buildSource(),
      design: buildDesign(buildRepairSensitiveDraft()),
      snapshot,
      now: new Date("2026-03-19T12:00:00.000Z"),
    });

    expect("error" in projected).toBe(false);
    expect(
      projected.diagnostics?.protectedCoverage.supportFloorRepairReasons[
        "Side Delts"
      ],
    ).toContain("no_compatible_exercise");
    expect(
      projected.diagnostics?.protectedCoverage.unresolvedProtectedMuscles,
    ).toContain("Side Delts");
  });

  it("blocks lower-slot Chest isolation repair and leaves the deficit diagnostic", () => {
    const malformedLowerSlotSequence = [
      {
        slotId: "lower_b",
        intent: "LOWER" as const,
        authoredSemantics: {
          slotArchetype: "lower_standard" as const,
          primaryLaneContract: null,
          continuityScope: "slot" as const,
          supportCoverageContract: {
            preferredAccessoryPrimaryMuscles: ["Chest"],
            protectedWeekOneCoverageMuscles: ["Chest"],
          },
        },
      },
    ];
    const lowerB = makeProjectedSlotWithContributions({
      slotId: "lower_b",
      intent: "LOWER",
      workout: makeProjectedWorkout({}),
    });
    const cableCrossover = makeProjectedExercise({
      id: "cable-crossover",
      name: "Cable Crossover",
      movementPatterns: ["isolation"],
      primaryMuscles: ["Chest"],
      sets: 3,
      isCompound: false,
      fatigueCost: 1,
      stimulusProfile: { chest: 1 },
    });

    const result = applyExistingAccessorySupportFloorBumps({
      workout: lowerB.workout,
      slotPolicy: {
        sessionIntent: "lower",
        slotId: "lower_b",
        sessionShape: {
          id: "malformed_lower_chest_support",
          preferredAccessoryPrimaryMuscles: ["Chest"],
          protectedWeekOneCoverageMuscles: ["Chest"],
        },
      } as never,
      exerciseLibrary: [cableCrossover.exercise] as never,
      projectedSlots: [],
      activeMesocycle: buildSource() as never,
      slotSequence: malformedLowerSlotSequence,
    });
    const projectedSlots = [
      makeProjectedSlotWithContributions({
        slotId: "lower_b",
        intent: "LOWER",
        workout: result.workout,
      }),
    ];

    const finalEvaluation = evaluateProtectedWeekOneCoverage({
      projectedSlots,
      activeMesocycle: buildSource() as never,
      slotSequence: malformedLowerSlotSequence,
    });
    const diagnostic = buildWeeklyDemandSlotAllocationDiagnostic({
      activeMesocycle: buildSource() as never,
      slotSequence: malformedLowerSlotSequence,
      initialProjectedSlots: [lowerB],
      finalProjectedSlots: projectedSlots,
      weeklyObligationPlan: weeklyObligationPlan({
        Chest: {
          targetSets: 10,
          allocatedSlots: [
            { slotId: "upper_a", minEffectiveSets: 5, priority: "primary" },
          ],
        },
      }),
      weeklyObligationEvaluations: [],
      protectedCoverage: finalEvaluation,
      supportFloorRepairReasons: result.reasons,
      programQualityAppliedDiagnostics: [],
      programQualityEvaluation: {
        totalPenalty: 0,
        diagnostics: [],
        constraintCounts: {},
      },
    });

    expect(
      (
        (projectedSlots[0]?.slotPlan.exercises ?? []) as Array<{
          exerciseId: string;
          primaryMuscles: string[];
        }>
      ).some(
        (exercise) =>
          exercise.exerciseId === "cable-crossover" ||
          exercise.primaryMuscles.includes("Chest"),
      ),
    ).toBe(false);
    expect(result.reasons.Chest).toContain("forbidden_slot_blocked");
    expect(finalEvaluation.unresolvedProtectedMuscles).toContain("Chest");
    expect(
      diagnostic.repairMaterialityAfterShadowAllocation.some(
        (row) =>
          row.slotId === "lower_b" &&
          row.muscle === "Chest" &&
          row.exerciseName === "Cable Crossover",
      ),
    ).toBe(false);
    expect(findFinalSlotForbiddenPrescriptionViolations(diagnostic)).toEqual(
      [],
    );

    const diagnosticWithIncidentalChestStimulus = {
      ...diagnostic,
      finalSlotPlan: diagnostic.finalSlotPlan.map((slot) =>
        slot.slotId === "lower_b"
          ? {
              ...slot,
              exercises: [
                ...slot.exercises,
                {
                  exerciseId: "front-squat",
                  exerciseName: "Front Squat",
                  role: "main" as const,
                  setCount: 3,
                  primaryMuscles: ["Quads"],
                  effectiveStimulusByMuscle: { Chest: 0.25, Quads: 3 },
                },
              ],
            }
          : slot,
      ),
    };
    expect(
      findFinalSlotForbiddenPrescriptionViolations(
        diagnosticWithIncidentalChestStimulus,
      ),
    ).toEqual([]);

    const diagnosticWithPriorCableCrossoverBug = {
      ...diagnostic,
      finalSlotPlan: diagnostic.finalSlotPlan.map((slot) =>
        slot.slotId === "lower_b"
          ? {
              ...slot,
              exercises: [
                ...slot.exercises,
                {
                  exerciseId: "cable-crossover",
                  exerciseName: "Cable Crossover",
                  role: "accessory" as const,
                  setCount: 3,
                  primaryMuscles: ["Chest"],
                  effectiveStimulusByMuscle: { Chest: 3 },
                },
              ],
            }
          : slot,
      ),
    };
    expect(
      findFinalSlotForbiddenPrescriptionViolations(
        diagnosticWithPriorCableCrossoverBug,
      ),
    ).toEqual([
      {
        slotId: "lower_b",
        muscle: "Chest",
        exerciseId: "cable-crossover",
        exerciseName: "Cable Crossover",
      },
    ]);
  });

  it("reroutes only hard demand affected by forbidden cleanup into compatible owning slots", () => {
    const slotSequenceEntries = buildSlotSequenceEntries([
      {
        slotId: "upper_a",
        intent: "UPPER",
        authoredSemantics: {
          slotArchetype: "upper_horizontal_balanced",
          primaryLaneContract: null,
          continuityScope: "slot",
          supportCoverageContract: {
            preferredAccessoryPrimaryMuscles: ["Chest"],
            protectedWeekOneCoverageMuscles: ["Chest"],
          },
        },
      },
      {
        slotId: "lower_b",
        intent: "LOWER",
        authoredSemantics: {
          slotArchetype: "lower_hinge_dominant",
          primaryLaneContract: null,
          continuityScope: "slot",
          supportCoverageContract: {
            preferredAccessoryPrimaryMuscles: ["Hamstrings"],
            protectedWeekOneCoverageMuscles: ["Hamstrings"],
          },
        },
      },
    ]);
    const bench = makeProjectedExercise({
      id: "bench",
      name: "Bench Press",
      movementPatterns: ["horizontal_push"],
      primaryMuscles: ["Chest"],
      sets: 2,
      isMainLift: true,
      stimulusProfile: { chest: 1 },
    });
    const cableCrossover = makeProjectedExercise({
      id: "cable-crossover",
      name: "Cable Crossover",
      movementPatterns: ["isolation"],
      primaryMuscles: ["Chest"],
      sets: 3,
      isCompound: false,
      fatigueCost: 1,
      stimulusProfile: { chest: 1 },
    });
    const cableFly = makeProjectedExercise({
      id: "cable-fly",
      name: "Cable Fly",
      movementPatterns: ["isolation"],
      primaryMuscles: ["Chest"],
      sets: 3,
      isCompound: false,
      fatigueCost: 1,
      stimulusProfile: { chest: 1 },
    });
    const gobletSquat = makeProjectedExercise({
      id: "goblet-squat",
      name: "Goblet Squat",
      movementPatterns: ["squat"],
      primaryMuscles: ["Quads", "Glutes"],
      sets: 3,
      isCompound: true,
      fatigueCost: 3,
      stimulusProfile: { quads: 1, glutes: 0.75, adductors: 0.5, core: 0.25 },
    });
    const cleanup = removeForbiddenSlotPrimaryRepairExercises({
      projectedSlots: [
        makeProjectedSlotWithContributions({
          slotId: "upper_a",
          intent: "UPPER",
          workout: makeProjectedWorkout({ mainLifts: [bench] }),
        }),
        makeProjectedSlotWithContributions({
          slotId: "lower_b",
          intent: "LOWER",
          workout: makeProjectedWorkout({ accessories: [cableCrossover] }),
        }),
      ],
      slotSequenceEntries,
    });

    const rerouted = applyPostForbiddenCleanupReroute({
      projectedSlots: cleanup.projectedSlots,
      weeklyObligationPlan: weeklyObligationPlan({
        Chest: {
          targetSets: 5,
          allocatedSlots: [
            { slotId: "upper_a", minEffectiveSets: 5, priority: "primary" },
          ],
        },
        Quads: {
          targetSets: 5,
          allocatedSlots: [
            { slotId: "lower_b", minEffectiveSets: 5, priority: "primary" },
          ],
        },
      }),
      exerciseLibrary: [cableFly.exercise, gobletSquat.exercise] as never,
      slotSequenceEntries,
      removedExercises: cleanup.removedExercises,
    });

    const upperA = rerouted.projectedSlots.find(
      (slot) => slot.slotPlan.slotId === "upper_a",
    )?.slotPlan;
    const lowerB = rerouted.projectedSlots.find(
      (slot) => slot.slotPlan.slotId === "lower_b",
    )?.slotPlan;

    expect(cleanup.removedExercises).toEqual([
      expect.objectContaining({
        slotId: "lower_b",
        exerciseId: "cable-crossover",
        exerciseName: "Cable Crossover",
        forbiddenPrimaryMuscles: ["Chest"],
        effectiveStimulusRemovedByMuscle: { Chest: 3 },
      }),
    ]);
    expect(upperA?.exercises.map((exercise) => exercise.exerciseId)).toEqual(
      expect.arrayContaining(["bench", "cable-fly"]),
    );
    expect(lowerB?.exercises.map((exercise) => exercise.exerciseId)).toEqual(
      [],
    );
    expect(JSON.stringify(rerouted.projectedSlots)).not.toContain(
      "goblet-squat",
    );
    expect(rerouted.diagnostic.reroutedDemand).toEqual([
      expect.objectContaining({
        muscle: "Chest",
        fromSlotId: "lower_b",
        toSlotId: "upper_a",
        action: "add_alternative",
        reason: "clean_compatible_alternative",
      }),
    ]);
    expect(rerouted.diagnostic.reroutedDemand).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ muscle: "Quads" }),
        expect.objectContaining({ muscle: "Hamstrings" }),
        expect.objectContaining({ muscle: "Calves" }),
        expect.objectContaining({ muscle: "Side Delts" }),
      ]),
    );
  });

  it("leaves affected hard demand unresolved instead of inserting collateral-heavy repairs", () => {
    const slotSequenceEntries = buildSlotSequenceEntries([
      {
        slotId: "upper_a",
        intent: "UPPER",
        authoredSemantics: {
          slotArchetype: "upper_horizontal_balanced",
          primaryLaneContract: null,
          continuityScope: "slot",
          supportCoverageContract: {
            preferredAccessoryPrimaryMuscles: ["Chest"],
            protectedWeekOneCoverageMuscles: ["Chest"],
          },
        },
      },
      {
        slotId: "lower_b",
        intent: "LOWER",
        authoredSemantics: {
          slotArchetype: "lower_hinge_dominant",
          primaryLaneContract: null,
          continuityScope: "slot",
          supportCoverageContract: {
            preferredAccessoryPrimaryMuscles: ["Hamstrings"],
            protectedWeekOneCoverageMuscles: ["Hamstrings"],
          },
        },
      },
    ]);
    const fillers = Array.from({ length: 6 }, (_, index) =>
      makeProjectedExercise({
        id: `upper-filler-${index}`,
        name: `Upper Filler ${index}`,
        movementPatterns: ["horizontal_pull"],
        primaryMuscles: ["Lats"],
        sets: 2,
        stimulusProfile: { lats: 1 },
      }),
    );
    const cableCrossover = makeProjectedExercise({
      id: "cable-crossover",
      name: "Cable Crossover",
      movementPatterns: ["isolation"],
      primaryMuscles: ["Chest"],
      sets: 3,
      isCompound: false,
      fatigueCost: 1,
      stimulusProfile: { chest: 1 },
    });
    const gobletSquat = makeProjectedExercise({
      id: "goblet-squat",
      name: "Goblet Squat",
      movementPatterns: ["squat"],
      primaryMuscles: ["Quads", "Glutes"],
      sets: 3,
      isCompound: true,
      fatigueCost: 3,
      stimulusProfile: { quads: 1, glutes: 0.75, adductors: 0.5, core: 0.25 },
    });
    const cleanup = removeForbiddenSlotPrimaryRepairExercises({
      projectedSlots: [
        makeProjectedSlotWithContributions({
          slotId: "upper_a",
          intent: "UPPER",
          workout: makeProjectedWorkout({ accessories: fillers }),
        }),
        makeProjectedSlotWithContributions({
          slotId: "lower_b",
          intent: "LOWER",
          workout: makeProjectedWorkout({ accessories: [cableCrossover] }),
        }),
      ],
      slotSequenceEntries,
    });

    const rerouted = applyPostForbiddenCleanupReroute({
      projectedSlots: cleanup.projectedSlots,
      weeklyObligationPlan: weeklyObligationPlan({
        Chest: {
          targetSets: 5,
          allocatedSlots: [
            { slotId: "upper_a", minEffectiveSets: 5, priority: "primary" },
          ],
        },
        Quads: {
          targetSets: 5,
          allocatedSlots: [
            { slotId: "lower_b", minEffectiveSets: 5, priority: "primary" },
          ],
        },
      }),
      exerciseLibrary: [gobletSquat.exercise] as never,
      slotSequenceEntries,
      removedExercises: cleanup.removedExercises,
    });

    expect(JSON.stringify(rerouted.projectedSlots)).not.toContain(
      "goblet-squat",
    );
    expect(rerouted.diagnostic.reroutedDemand).toEqual([
      expect.objectContaining({
        muscle: "Chest",
        action: "unresolved",
        reason: "no_clean_capacity_for_alternative",
      }),
    ]);
    expect(rerouted.diagnostic.unresolvedDemand).toEqual([
      expect.objectContaining({
        muscle: "Chest",
        amount: 3,
        reason: "affected_hard_demand_not_cleanly_rerouted",
      }),
    ]);
  });

  it("prefers an unused lower_b Hamstrings knee-flexion curl over dirty Back Extension weekly closure", () => {
    const slotSequenceEntries = buildSlotSequenceEntries([
      { slotId: "lower_a", intent: "LOWER" },
      {
        slotId: "lower_b",
        intent: "LOWER",
        authoredSemantics: {
          slotArchetype: "lower_hinge_dominant",
          primaryLaneContract: null,
          continuityScope: "slot",
          supportCoverageContract: {
            preferredAccessoryPrimaryMuscles: ["Hamstrings"],
            protectedWeekOneCoverageMuscles: ["Hamstrings"],
          },
        },
      },
    ]);
    const lyingLegCurl = makeProjectedExercise({
      id: "lying-leg-curl",
      name: "Lying Leg Curl",
      movementPatterns: ["flexion"],
      primaryMuscles: ["Hamstrings"],
      sets: 2,
      isCompound: false,
      fatigueCost: 1,
      stimulusProfile: { hamstrings: 1 },
    });
    const seatedLegCurl = makeProjectedExercise({
      id: "seated-leg-curl",
      name: "Seated Leg Curl",
      movementPatterns: ["flexion"],
      primaryMuscles: ["Hamstrings"],
      sets: 2,
      isCompound: false,
      fatigueCost: 1,
      stimulusProfile: { hamstrings: 1 },
    });
    const nordicHamstringCurl = makeProjectedExercise({
      id: "nordic-hamstring-curl",
      name: "Nordic Hamstring Curl",
      movementPatterns: ["flexion"],
      primaryMuscles: ["Hamstrings"],
      secondaryMuscles: ["Glutes"],
      sets: 2,
      isCompound: false,
      fatigueCost: 3,
      stimulusProfile: { hamstrings: 1 },
    });
    const backExtension = makeProjectedExercise({
      id: "back-extension-45",
      name: "Back Extension (45 Degree)",
      movementPatterns: ["extension"],
      primaryMuscles: ["Glutes", "Hamstrings", "Lower Back"],
      sets: 2,
      isCompound: false,
      fatigueCost: 1,
      stimulusProfile: { hamstrings: 1.2, glutes: 0.65, lower_back: 0.9 },
    });
    const stiffLegDeadlift = makeProjectedExercise({
      id: "stiff-legged-deadlift",
      name: "Stiff-Legged Deadlift",
      movementPatterns: ["hinge"],
      primaryMuscles: ["Hamstrings"],
      secondaryMuscles: ["Glutes", "Lower Back"],
      sets: 3,
      isMainLift: true,
      stimulusProfile: { hamstrings: 1, glutes: 0.75, lower_back: 0.45 },
    });

    const projected = applyFinalWeeklyObligationClosure({
      projectedSlots: [
        makeProjectedSlotWithContributions({
          slotId: "lower_a",
          intent: "LOWER",
          workout: makeProjectedWorkout({
            accessories: [lyingLegCurl, seatedLegCurl],
          }),
        }),
        makeProjectedSlotWithContributions({
          slotId: "lower_b",
          intent: "LOWER",
          workout: makeProjectedWorkout({ mainLifts: [stiffLegDeadlift] }),
        }),
      ],
      weeklyObligationPlan: weeklyObligationPlan({
        Hamstrings: {
          targetSets: 8,
          allocatedSlots: [
            { slotId: "lower_b", minEffectiveSets: 5, priority: "primary" },
          ],
        },
      }),
      exerciseLibrary: [
        lyingLegCurl.exercise,
        seatedLegCurl.exercise,
        backExtension.exercise,
        nordicHamstringCurl.exercise,
      ] as never,
      slotSequenceEntries,
    });

    const lowerB = projected.find((slot) => slot.slotPlan.slotId === "lower_b");
    const lowerBExerciseIds =
      lowerB?.slotPlan.exercises.map((exercise) => exercise.exerciseId) ?? [];

    expect(lowerBExerciseIds).toContain("stiff-legged-deadlift");
    expect(lowerBExerciseIds).toContain("nordic-hamstring-curl");
    expect(lowerBExerciseIds).not.toContain("back-extension-45");
    expect(lowerBExerciseIds).not.toContain("lying-leg-curl");
    expect(lowerBExerciseIds).not.toContain("seated-leg-curl");
    expect(
      getEffectiveMuscleSetTotal(lowerB!.workout, "Lower Back"),
    ).toBeCloseTo(1.35);
  });

  it("keeps the clean curl preference scoped to lower_b Hamstrings", () => {
    const slotSequenceEntries = buildSlotSequenceEntries([
      { slotId: "lower_a", intent: "LOWER" },
    ]);
    const nordicHamstringCurl = makeProjectedExercise({
      id: "nordic-hamstring-curl",
      name: "Nordic Hamstring Curl",
      movementPatterns: ["flexion"],
      primaryMuscles: ["Hamstrings"],
      sets: 2,
      isCompound: true,
      fatigueCost: 3,
      stimulusProfile: { hamstrings: 1 },
    });
    const backExtension = makeProjectedExercise({
      id: "back-extension-45",
      name: "Back Extension (45 Degree)",
      movementPatterns: ["extension"],
      primaryMuscles: ["Glutes", "Hamstrings", "Lower Back"],
      sets: 2,
      isCompound: false,
      fatigueCost: 1,
      stimulusProfile: { hamstrings: 1.2, glutes: 0.65, lower_back: 0.9 },
    });

    const projected = applyFinalWeeklyObligationClosure({
      projectedSlots: [
        makeProjectedSlotWithContributions({
          slotId: "lower_a",
          intent: "LOWER",
          workout: makeProjectedWorkout({}),
        }),
      ],
      weeklyObligationPlan: weeklyObligationPlan({
        Hamstrings: {
          targetSets: 4,
          allocatedSlots: [
            { slotId: "lower_a", minEffectiveSets: 2, priority: "primary" },
          ],
        },
      }),
      exerciseLibrary: [
        backExtension.exercise,
        nordicHamstringCurl.exercise,
      ] as never,
      slotSequenceEntries,
    });

    expect(
      projected[0]?.slotPlan.exercises.map((exercise) => exercise.exerciseId),
    ).toContain("back-extension-45");
  });

  it("uses a clean unused lower_b Hamstrings curl for support-floor repair before dirty Back Extension", () => {
    const slotSequence = [
      {
        slotId: "lower_b",
        intent: "LOWER" as const,
        authoredSemantics: {
          slotArchetype: "lower_hinge_dominant" as const,
          primaryLaneContract: null,
          continuityScope: "slot" as const,
          supportCoverageContract: {
            preferredAccessoryPrimaryMuscles: ["Hamstrings"],
            protectedWeekOneCoverageMuscles: ["Hamstrings"],
          },
        },
      },
    ];
    const slotSequenceEntries = buildSlotSequenceEntries(slotSequence);
    const slotPolicy = resolveSessionSlotPolicy({
      sessionIntent: "lower",
      slotId: "lower_b",
      slotSequence: { slots: slotSequenceEntries },
    }).currentSession;
    const stiffLegDeadlift = makeProjectedExercise({
      id: "stiff-legged-deadlift",
      name: "Stiff-Legged Deadlift",
      movementPatterns: ["hinge"],
      primaryMuscles: ["Hamstrings"],
      sets: 3,
      isMainLift: true,
      stimulusProfile: { hamstrings: 1, glutes: 0.75, lower_back: 0.45 },
    });
    const nordicHamstringCurl = makeProjectedExercise({
      id: "nordic-hamstring-curl",
      name: "Nordic Hamstring Curl",
      movementPatterns: ["flexion"],
      primaryMuscles: ["Hamstrings"],
      sets: 2,
      isCompound: true,
      fatigueCost: 3,
      stimulusProfile: { hamstrings: 1 },
    });
    const backExtension = makeProjectedExercise({
      id: "back-extension-45",
      name: "Back Extension (45 Degree)",
      movementPatterns: ["extension"],
      primaryMuscles: ["Glutes", "Hamstrings", "Lower Back"],
      sets: 2,
      isCompound: false,
      fatigueCost: 1,
      stimulusProfile: { hamstrings: 0.45, glutes: 0.65, lower_back: 0.9 },
    });
    const lowerB = makeProjectedSlotWithContributions({
      slotId: "lower_b",
      intent: "LOWER",
      workout: makeProjectedWorkout({ mainLifts: [stiffLegDeadlift] }),
    });

    const result = applyFinalSupportFloorClosure({
      projectedSlots: [lowerB],
      exerciseLibrary: [
        backExtension.exercise,
        nordicHamstringCurl.exercise,
      ] as never,
      activeMesocycle: buildSource() as never,
      slotSequence,
      slotSequenceEntries,
    });
    const repairedLowerB = result.projectedSlots.find(
      (slot) => slot.slotPlan.slotId === "lower_b",
    );
    const exerciseIds =
      repairedLowerB?.slotPlan.exercises.map((exercise) => exercise.exerciseId) ??
      [];

    expect(
      preservesSlotIdentity({ slotPolicy, workout: repairedLowerB!.workout }),
    ).toBe(true);
    expect(exerciseIds).toContain("stiff-legged-deadlift");
    expect(exerciseIds).toContain("nordic-hamstring-curl");
    expect(exerciseIds).not.toContain("back-extension-45");
    expect(result.distributionGuardActions).toEqual([]);
  });

  it("redistributes lower_b Hamstrings sets from hinge anchor to selected clean curl without breaking hard demand", () => {
    const slotSequenceEntries = buildSlotSequenceEntries([
      {
        slotId: "lower_b",
        intent: "LOWER",
        authoredSemantics: {
          slotArchetype: "lower_hinge_dominant",
          primaryLaneContract: null,
          continuityScope: "slot",
          supportCoverageContract: {
            preferredAccessoryPrimaryMuscles: ["Hamstrings"],
            protectedWeekOneCoverageMuscles: ["Hamstrings"],
          },
        },
      },
    ]);
    const stiffLegDeadlift = makeProjectedExercise({
      id: "stiff-legged-deadlift",
      name: "Stiff-Legged Deadlift",
      movementPatterns: ["hinge"],
      primaryMuscles: ["Hamstrings"],
      sets: 4,
      isMainLift: true,
      stimulusProfile: { hamstrings: 1, glutes: 0.75, lower_back: 0.45 },
    });
    const nordicHamstringCurl = makeProjectedExercise({
      id: "nordic-hamstring-curl",
      name: "Nordic Hamstring Curl",
      movementPatterns: ["flexion"],
      primaryMuscles: ["Hamstrings"],
      sets: 2,
      isCompound: true,
      stimulusProfile: { hamstrings: 1 },
    });

    const projected = applyLowerBCleanCurlSetDistribution({
      projectedSlots: [
        makeProjectedSlotWithContributions({
          slotId: "lower_b",
          intent: "LOWER",
          workout: makeProjectedWorkout({
            mainLifts: [stiffLegDeadlift],
            accessories: [nordicHamstringCurl],
          }),
        }),
      ],
      weeklyObligationPlan: weeklyObligationPlan({
        Hamstrings: {
          targetSets: 6,
          allocatedSlots: [
            { slotId: "lower_b", minEffectiveSets: 6, priority: "primary" },
          ],
        },
      }),
      slotSequenceEntries,
    });

    expect(getExerciseSetCounts(projected[0]!.workout)).toMatchObject({
      "stiff-legged-deadlift": 3,
      "nordic-hamstring-curl": 3,
    });
    expect(
      getEffectiveMuscleSetTotal(projected[0]!.workout, "Lower Back"),
    ).toBeCloseTo(1.35);
  });

  it("blocks a hard-obligation set bump when it would worsen an already concentrated exercise", () => {
    const slotSequenceEntries = buildSlotSequenceEntries([
      {
        slotId: "upper_a",
        intent: "UPPER",
        authoredSemantics: {
          slotArchetype: "upper_horizontal_balanced",
          primaryLaneContract: null,
          continuityScope: "slot",
          supportCoverageContract: {
            preferredAccessoryPrimaryMuscles: ["Chest"],
            protectedWeekOneCoverageMuscles: ["Chest"],
          },
        },
      },
    ]);
    const concentratedFly = makeProjectedExercise({
      id: "concentrated-fly",
      name: "Concentrated Fly",
      movementPatterns: ["isolation"],
      primaryMuscles: ["Chest"],
      sets: 3,
      isCompound: false,
      stimulusProfile: { chest: 1 },
    });
    const fillers = Array.from({ length: 5 }, (_, index) =>
      makeProjectedExercise({
        id: `filler-${index}`,
        name: `Filler ${index}`,
        movementPatterns: ["horizontal_pull"],
        primaryMuscles: ["Lats"],
        sets: 2,
        stimulusProfile: { lats: 1 },
      }),
    );
    const distributionGuardActions: DistributionGuardAction[] = [];

    const projected = applyFinalWeeklyObligationClosure({
      projectedSlots: [
        makeProjectedSlotWithContributions({
          slotId: "upper_a",
          intent: "UPPER",
          workout: makeProjectedWorkout({
            accessories: [concentratedFly, ...fillers],
          }),
        }),
      ],
      weeklyObligationPlan: weeklyObligationPlan({
        Chest: {
          targetSets: 4,
          allocatedSlots: [
            { slotId: "upper_a", minEffectiveSets: 4, priority: "primary" },
          ],
        },
      }),
      exerciseLibrary: [] as never,
      slotSequenceEntries,
      distributionGuardActions,
    });

    expect(getExerciseSetCounts(projected[0]!.workout)).toMatchObject({
      "concentrated-fly": 3,
    });
    expect(distributionGuardActions).toEqual([
      expect.objectContaining({
        slotId: "upper_a",
        exerciseName: "Concentrated Fly",
        muscle: "Chest",
        attemptedAction: "set_bump",
        decision: "left_unresolved",
        reason: "single_exercise_share_limit",
      }),
    ]);
  });

  it("reroutes a blocked set bump to a clean existing compatible alternative", () => {
    const slotSequenceEntries = buildSlotSequenceEntries([
      {
        slotId: "upper_a",
        intent: "UPPER",
        authoredSemantics: {
          slotArchetype: "upper_horizontal_balanced",
          primaryLaneContract: null,
          continuityScope: "slot",
          supportCoverageContract: {
            preferredAccessoryPrimaryMuscles: ["Chest"],
            protectedWeekOneCoverageMuscles: ["Chest"],
          },
        },
      },
    ]);
    const concentratedFly = makeProjectedExercise({
      id: "concentrated-fly",
      name: "A Concentrated Fly",
      movementPatterns: ["isolation"],
      primaryMuscles: ["Chest"],
      sets: 3,
      isCompound: false,
      stimulusProfile: { chest: 1 },
    });
    const cleanPress = makeProjectedExercise({
      id: "clean-press",
      name: "B Clean Press",
      movementPatterns: ["horizontal_push"],
      primaryMuscles: ["Chest"],
      sets: 2,
      isCompound: false,
      stimulusProfile: { chest: 1 },
    });
    const fillers = Array.from({ length: 4 }, (_, index) =>
      makeProjectedExercise({
        id: `reroute-filler-${index}`,
        name: `Reroute Filler ${index}`,
        movementPatterns: ["horizontal_pull"],
        primaryMuscles: ["Lats"],
        sets: 2,
        stimulusProfile: { lats: 1 },
      }),
    );
    const distributionGuardActions: DistributionGuardAction[] = [];

    const projected = applyFinalWeeklyObligationClosure({
      projectedSlots: [
        makeProjectedSlotWithContributions({
          slotId: "upper_a",
          intent: "UPPER",
          workout: makeProjectedWorkout({
            accessories: [concentratedFly, cleanPress, ...fillers],
          }),
        }),
      ],
      weeklyObligationPlan: weeklyObligationPlan({
        Chest: {
          targetSets: 6,
          allocatedSlots: [
            { slotId: "upper_a", minEffectiveSets: 6, priority: "primary" },
          ],
        },
      }),
      exerciseLibrary: [] as never,
      slotSequenceEntries,
      distributionGuardActions,
    });

    expect(getExerciseSetCounts(projected[0]!.workout)).toMatchObject({
      "concentrated-fly": 3,
      "clean-press": 3,
    });
    expect(distributionGuardActions).toEqual([
      expect.objectContaining({
        exerciseName: "A Concentrated Fly",
        muscle: "Chest",
        decision: "rerouted",
        alternativeExerciseName: "B Clean Press",
      }),
    ]);
  });

  it("does not block normal set bumps below the concentration limit", () => {
    const slotSequenceEntries = buildSlotSequenceEntries([
      {
        slotId: "upper_a",
        intent: "UPPER",
        authoredSemantics: {
          slotArchetype: "upper_horizontal_balanced",
          primaryLaneContract: null,
          continuityScope: "slot",
          supportCoverageContract: {
            preferredAccessoryPrimaryMuscles: ["Chest"],
            protectedWeekOneCoverageMuscles: ["Chest"],
          },
        },
      },
    ]);
    const firstPress = makeProjectedExercise({
      id: "first-press",
      name: "A First Press",
      movementPatterns: ["horizontal_push"],
      primaryMuscles: ["Chest"],
      sets: 3,
      isCompound: false,
      stimulusProfile: { chest: 1 },
    });
    const secondPress = makeProjectedExercise({
      id: "second-press",
      name: "B Second Press",
      movementPatterns: ["horizontal_push"],
      primaryMuscles: ["Chest"],
      sets: 3,
      isCompound: false,
      stimulusProfile: { chest: 1 },
    });
    const fillers = Array.from({ length: 4 }, (_, index) =>
      makeProjectedExercise({
        id: `normal-filler-${index}`,
        name: `Normal Filler ${index}`,
        movementPatterns: ["horizontal_pull"],
        primaryMuscles: ["Lats"],
        sets: 2,
        stimulusProfile: { lats: 1 },
      }),
    );
    const distributionGuardActions: DistributionGuardAction[] = [];

    const projected = applyFinalWeeklyObligationClosure({
      projectedSlots: [
        makeProjectedSlotWithContributions({
          slotId: "upper_a",
          intent: "UPPER",
          workout: makeProjectedWorkout({
            accessories: [firstPress, secondPress, ...fillers],
          }),
        }),
      ],
      weeklyObligationPlan: weeklyObligationPlan({
        Chest: {
          targetSets: 7,
          allocatedSlots: [
            { slotId: "upper_a", minEffectiveSets: 7, priority: "primary" },
          ],
        },
      }),
      exerciseLibrary: [] as never,
      slotSequenceEntries,
      distributionGuardActions,
    });

    expect(getExerciseSetCounts(projected[0]!.workout)).toMatchObject({
      "first-press": 4,
      "second-press": 3,
    });
    expect(distributionGuardActions).toEqual([]);
  });

  it("allows lower_b squat fallback when no hinge compound anchor is viable", () => {
    const projected = projectSuccessorSlotPlansFromSnapshot({
      userId: "user-1",
      source: buildSource(),
      design: buildDesign(),
      snapshot: buildNoHingeCompoundSnapshot(),
      now: new Date("2026-03-19T12:00:00.000Z"),
    });

    const lowerB = getProjectedSlotPlans(projected).find(
      (slot) => slot.slotId === "lower_b",
    );
    const lowerBExerciseIds =
      lowerB?.exercises.map((exercise) => exercise.exerciseId) ?? [];

    expect(
      lowerBExerciseIds.some((exerciseId) =>
        ["squat", "hack-squat"].includes(exerciseId),
      ),
    ).toBe(true);
  });

  it("keeps upper_b on a compound horizontal pull when only a supportive accessory shares that pattern", () => {
    const snapshot = buildSnapshot();
    snapshot.context.exercises.push(
      makeRawExercise({
        id: "face-pull",
        name: "Face Pull",
        movementPatterns: ["horizontal_pull"],
        splitTags: ["pull"],
        equipment: ["CABLE"],
        primaryMuscles: ["Rear Delts"],
        secondaryMuscles: ["Upper Back"],
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
      }) as never,
    );

    const projected = projectSuccessorSlotPlansFromSnapshot({
      userId: "user-1",
      source: buildSource(),
      design: buildDesign(),
      snapshot,
      now: new Date("2026-03-19T12:00:00.000Z"),
    });

    const upperB = getProjectedSlotPlans(projected).find(
      (slot) => slot.slotId === "upper_b",
    );
    const upperBExerciseIds =
      upperB?.exercises.map((exercise) => exercise.exerciseId) ?? [];

    expect(
      upperBExerciseIds.some((exerciseId) =>
        ["row", "seated-row"].includes(exerciseId),
      ),
    ).toBe(true);
    expect(
      !upperBExerciseIds.includes("face-pull") ||
        upperBExerciseIds.some((exerciseId) =>
          ["row", "seated-row"].includes(exerciseId),
        ),
    ).toBe(true);
  });

  it("fails clearly for unsupported BODY_PART successor slots", () => {
    const bodyPartDraft: NextCycleSeedDraft = {
      ...buildDraft(),
      structure: {
        splitType: "CUSTOM",
        sessionsPerWeek: 1,
        daysPerWeek: 1,
        sequenceMode: "ordered_flexible",
        slots: [{ slotId: "body_part_a", intent: "BODY_PART" }],
      },
      carryForwardSelections: [],
    };

    const projected = projectSuccessorSlotPlansFromSnapshot({
      userId: "user-1",
      source: buildSource(),
      design: buildDesign(bodyPartDraft),
      snapshot: buildSnapshot(),
      now: new Date("2026-03-19T12:00:00.000Z"),
    });

    expect(projected).toEqual({
      error:
        "MESOCYCLE_HANDOFF_SLOT_PLAN_UNSUPPORTED: BODY_PART slot body_part_a requires target muscles for deterministic projection.",
    });
  });

  it("constructs against protected coverage obligations and improves protected coverage when compatibility is available", async () => {
    const input = {
      userId: "user-1",
      source: buildSource(),
      design: buildDesign(buildRepairSensitiveDraft()),
      snapshot: buildRepairSensitiveSnapshot(),
      now: new Date("2026-03-19T12:00:00.000Z"),
    };

    const repaired = projectSuccessorSlotPlansFromSnapshot(input);

    vi.resetModules();
    vi.doMock("@/lib/planning/session-slot-profile", async (importOriginal) => {
      const original =
        await importOriginal<
          typeof import("@/lib/planning/session-slot-profile")
        >();
      return {
        ...original,
        getProjectionRepairCompatibleMuscles: () => [],
      };
    });
    const {
      projectSuccessorSlotPlansFromSnapshot: projectWithoutRepairCompatibility,
    } = await import("./mesocycle-handoff-slot-plan-projection");
    const unrepaired = projectWithoutRepairCompatibility(input);
    vi.resetModules();
    vi.doUnmock("@/lib/planning/session-slot-profile");

    const repairedDiagnostics = getProtectedCoverageDiagnostics(repaired);
    const unrepairedDiagnostics = getProtectedCoverageDiagnostics(unrepaired);
    expect(repairedDiagnostics?.slotRepairMuscles).toEqual(
      expect.objectContaining({
        upper_a: expect.arrayContaining(["Chest", "Triceps"]),
        lower_b: expect.arrayContaining(["Calves"]),
      }),
    );
    const repairedCalves = repairedDiagnostics?.afterRepair.muscles.find(
      (row) => row.muscle === "Calves",
    );
    const unrepairedCalves = unrepairedDiagnostics?.afterRepair.muscles.find(
      (row) => row.muscle === "Calves",
    );
    expect(repairedCalves?.projectedEffectiveSets ?? 0).toBeGreaterThanOrEqual(
      unrepairedCalves?.projectedEffectiveSets ?? 0,
    );
    expect(
      repairedDiagnostics?.afterRepair.unresolvedProtectedMuscles,
    ).not.toContain("Triceps");

    const repairedSlotPlans = getProjectedSlotPlans(repaired);
    const upperA = repairedSlotPlans.find((slot) => slot.slotId === "upper_a");
    const upperB = repairedSlotPlans.find((slot) => slot.slotId === "upper_b");
    const lowerA = repairedSlotPlans.find((slot) => slot.slotId === "lower_a");
    const lowerB = repairedSlotPlans.find((slot) => slot.slotId === "lower_b");

    expect(
      upperA?.exercises.map((exercise) => exercise.exerciseId),
    ).not.toEqual(upperB?.exercises.map((exercise) => exercise.exerciseId));
    expect(
      lowerA?.exercises.map((exercise) => exercise.exerciseId),
    ).not.toEqual(lowerB?.exercises.map((exercise) => exercise.exerciseId));
    expect(
      upperB?.exercises.some((exercise) =>
        ["row", "seated-row", "pulldown"].includes(exercise.exerciseId),
      ),
    ).toBe(true);
    expect(
      lowerB?.exercises.some((exercise) =>
        ["rdl", "hack-squat", "leg-curl", "hip-thrust"].includes(
          exercise.exerciseId,
        ),
      ),
    ).toBe(true);
  });

  it("keeps unrepairable protected coverage visible as a non-blocking diagnostic", async () => {
    const snapshot = buildSnapshot();
    snapshot.context.exercises = snapshot.context.exercises.filter(
      (exercise) => exercise.id !== "calf-raise",
    );

    const projected = projectSuccessorSlotPlansFromSnapshot({
      userId: "user-1",
      source: buildSource(),
      design: buildDesign(),
      snapshot,
      now: new Date("2026-03-19T12:00:00.000Z"),
    });

    expect("error" in projected).toBe(false);
    if ("error" in projected) return;

    expect(projected.slotPlans.length).toBe(4);
    expect(
      projected.diagnostics?.protectedCoverage.unresolvedProtectedMuscles
        .length,
    ).toBeGreaterThan(0);
  });

  it("closes raised practical-floor hamstring shortfalls when hinge support is present", async () => {
    vi.resetModules();
    vi.doMock("@/lib/engine/volume-landmarks", async (importOriginal) => {
      const original =
        await importOriginal<typeof import("@/lib/engine/volume-landmarks")>();
      return {
        ...original,
        VOLUME_LANDMARKS: {
          ...original.VOLUME_LANDMARKS,
          Chest: { ...original.VOLUME_LANDMARKS.Chest, mev: 2 },
          "Side Delts": { ...original.VOLUME_LANDMARKS["Side Delts"], mev: 1 },
          Triceps: { ...original.VOLUME_LANDMARKS.Triceps, mev: 1 },
          Hamstrings: { ...original.VOLUME_LANDMARKS.Hamstrings, mev: 2 },
          Calves: { ...original.VOLUME_LANDMARKS.Calves, mev: 2 },
        },
      };
    });
    vi.doMock("./mesocycle-lifecycle", async (importOriginal) => {
      const original =
        await importOriginal<typeof import("./mesocycle-lifecycle")>();
      return {
        ...original,
        getWeeklyVolumeTarget: (_mesocycle: unknown, muscle: string) => {
          switch (muscle) {
            case "Chest":
            case "Side Delts":
            case "Triceps":
            case "Hamstrings":
            case "Calves":
              return 8;
            default:
              return 0;
          }
        },
      };
    });
    const { projectSuccessorSlotPlansFromSnapshot: projectWithTargetFloor } =
      await import("./mesocycle-handoff-slot-plan-projection");
    const projected = projectWithTargetFloor({
      userId: "user-1",
      source: buildSource(),
      design: buildDesign(buildRepairSensitiveDraft()),
      snapshot: buildRepairSensitiveSnapshot(),
      now: new Date("2026-03-19T12:00:00.000Z"),
    });
    vi.resetModules();
    vi.doUnmock("@/lib/engine/volume-landmarks");
    vi.doUnmock("./mesocycle-lifecycle");

    expect("error" in projected).toBe(false);
    if ("error" in projected) return;

    const hamstrings =
      projected.diagnostics?.protectedCoverage.afterRepair.muscles.find(
        (row) => row.muscle === "Hamstrings",
      );
    expect(hamstrings?.projectedEffectiveSets ?? 0).toBeGreaterThanOrEqual(
      hamstrings?.mev ?? 0,
    );
    const hamstringPreselection =
      projected.diagnostics?.preselectionDemands?.filter(
        (demand) =>
          demand.muscle === "Hamstrings" && demand.consumedBySelection,
      ) ?? [];
    const closureSignals = [
      ...(projected.diagnostics?.protectedCoverage.supportFloorRepairReasons
        .Hamstrings ?? []),
      ...hamstringPreselection.map(() => "preselection_demand_consumed"),
    ];
    expect(closureSignals).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^(support_accessory_replacement|preselection_demand_consumed)$/,
        ),
      ]),
    );
  });

  it("keeps hamstring capacity limits diagnostic when extra upper options are irrelevant", async () => {
    vi.resetModules();
    vi.doMock("@/lib/engine/volume-landmarks", async (importOriginal) => {
      const original =
        await importOriginal<typeof import("@/lib/engine/volume-landmarks")>();
      return {
        ...original,
        VOLUME_LANDMARKS: {
          ...original.VOLUME_LANDMARKS,
          Chest: { ...original.VOLUME_LANDMARKS.Chest, mev: 6 },
          Triceps: { ...original.VOLUME_LANDMARKS.Triceps, mev: 3 },
          Hamstrings: { ...original.VOLUME_LANDMARKS.Hamstrings, mev: 6 },
          Calves: { ...original.VOLUME_LANDMARKS.Calves, mev: 4 },
        },
      };
    });
    vi.doMock("./mesocycle-lifecycle", async (importOriginal) => {
      const original =
        await importOriginal<typeof import("./mesocycle-lifecycle")>();
      return {
        ...original,
        getWeeklyVolumeTarget: (_mesocycle: unknown, muscle: string) => {
          switch (muscle) {
            case "Chest":
              return 8;
            case "Triceps":
              return 6;
            case "Hamstrings":
              return 10;
            case "Calves":
              return 6;
            default:
              return 0;
          }
        },
      };
    });
    const {
      projectSuccessorSlotPlansFromSnapshot: projectWithLoweredMevTrigger,
    } = await import("./mesocycle-handoff-slot-plan-projection");
    const snapshot = buildProtectedCoverageSatisfiedSnapshot();
    snapshot.context.exercises = snapshot.context.exercises.filter(
      (exercise) => !["leg-curl", "seated-leg-curl"].includes(exercise.id),
    );
    const projected = projectWithLoweredMevTrigger({
      userId: "user-1",
      source: buildSource(),
      design: buildDesign(buildRepairSensitiveDraft()),
      snapshot,
      now: new Date("2026-03-19T12:00:00.000Z"),
    });
    vi.resetModules();
    vi.doUnmock("@/lib/engine/volume-landmarks");
    vi.doUnmock("./mesocycle-lifecycle");

    expect("error" in projected).toBe(false);
    if ("error" in projected) return;

    expect(projected.diagnostics?.protectedCoverage.attemptedRepair).toBe(
      false,
    );
    expect(
      projected.diagnostics?.protectedCoverage.unresolvedProtectedMuscles,
    ).toEqual(expect.arrayContaining(["Hamstrings"]));
  });
});
