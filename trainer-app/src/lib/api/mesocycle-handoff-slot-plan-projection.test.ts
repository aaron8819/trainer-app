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
  projectSuccessorSlotPlansFromSnapshot,
} from "./mesocycle-handoff-slot-plan-projection";
import {
  applyExistingAccessorySupportFloorBumps,
  applyFinalMinimumViableSetRedistribution,
  MIN_PROJECTED_ACCESSORY_SETS_PER_EXERCISE,
  MIN_PROJECTED_MAIN_LIFT_SETS_PER_EXERCISE,
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
      secondaryMuscles: [],
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
    const slotPrescriptionIntents = diagnostic?.slotPrescriptionIntents ?? [];
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
    expect(upperBSideDelts).toMatchObject({
      targetStatus: "soft",
      demandType: "soft_direct_allowed",
    });
    expect(upperBSideDelts?.reasons).toEqual(
      expect.arrayContaining([
        "cap_duplicate_lateral_raise_identities_and_set_stacking",
      ]),
    );
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
    expect(["overlap_preferred", "direct_if_under_floor"]).toContain(
      upperATriceps?.demandType,
    );
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
      expect(row?.projectedEffectiveSets ?? 0).toBeGreaterThanOrEqual(
        row?.mev ?? 0,
      );
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
