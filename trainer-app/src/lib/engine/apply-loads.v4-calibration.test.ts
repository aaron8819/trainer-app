import { describe, expect, it } from "vitest";
import { applyLoadsWithAudit } from "./apply-loads";
import type {
  Exercise,
  WorkoutHistoryEntry,
  WorkoutPlan,
} from "./types";
import type { MeasurementSemantics } from "@/lib/exercise-measurement/semantics";

const barbellMeasurement = {
  profile: "REPS_EXTERNAL_LOAD",
  loadConvention: "BARBELL_TOTAL",
  repBasis: "TOTAL",
} as const satisfies MeasurementSemantics;

const bench: Exercise = {
  id: "bench",
  name: "Barbell Bench Press",
  movementPatterns: ["horizontal_push"],
  splitTags: ["push"],
  jointStress: "medium",
  isMainLiftEligible: true,
  isCompound: true,
  fatigueCost: 3,
  equipment: ["barbell"],
  primaryMuscles: ["Chest"],
};

function workoutFor(
  exercise: Exercise = bench,
  measurement: MeasurementSemantics = barbellMeasurement,
): WorkoutPlan {
  return {
    id: "next-workout",
    scheduledDate: "2026-08-10T00:00:00.000Z",
    warmup: [],
    mainLifts: [
      {
        id: `workout-exercise-${exercise.id}`,
        exercise,
        orderIndex: 0,
        isMainLift: true,
        measurement,
        sets: [1, 2, 3, 4].map((setIndex) => ({
          setIndex,
          targetReps: 5,
          targetRepRange: { min: 5, max: 8 },
          targetRpe: 6.5,
        })),
      },
    ],
    accessories: [],
    estimatedMinutes: 30,
  };
}

function history(input: {
  exerciseId?: string;
  measurement?: MeasurementSemantics;
  status?: WorkoutHistoryEntry["status"];
  load?: number;
  reps?: number;
  rpe?: number;
  sets?: WorkoutHistoryEntry["exercises"][number]["sets"];
} = {}): WorkoutHistoryEntry {
  const status = input.status ?? "COMPLETED";
  return {
    workoutId: "prior-workout",
    date: "2026-08-03T00:00:00.000Z",
    completed: status === "COMPLETED",
    status,
    progressionEligible: true,
    performanceEligible: true,
    selectionMode: "INTENT",
    sessionIntent: "upper",
    confidence: 1,
    exercises: [
      {
        exerciseId: input.exerciseId ?? "bench",
        ...(input.measurement ? { measurement: input.measurement } : {}),
        plannedWorkingSetCount: input.sets?.length ?? 3,
        sets: input.sets ?? [1, 2, 3].map((setIndex) => ({
            exerciseId: input.exerciseId ?? "bench",
            setIndex,
            reps: input.reps ?? 8,
            ...(input.rpe === undefined ? {} : { rpe: input.rpe }),
            load: input.load ?? 135,
          })),
      },
    ],
  };
}

const reproducedBenchSets: WorkoutHistoryEntry["exercises"][number]["sets"] = [
  { exerciseId: "bench", setIndex: 1, reps: 8, rpe: 8, load: 135, targetLoad: 135, targetReps: 6, targetRepMin: 6, targetRepMax: 10, targetRpe: 8.5 },
  { exerciseId: "bench", setIndex: 2, reps: 6, rpe: 8, load: 145, targetLoad: 135, targetReps: 6, targetRepMin: 6, targetRepMax: 10, targetRpe: 8.5 },
  { exerciseId: "bench", setIndex: 3, reps: 6, rpe: 9, load: 155, targetLoad: 135, targetReps: 6, targetRepMin: 6, targetRepMax: 10, targetRpe: 8.5 },
  { exerciseId: "bench", setIndex: 4, reps: 6, rpe: 9, load: 160, targetLoad: 135, targetReps: 6, targetRepMin: 6, targetRepMax: 10, targetRpe: 8.5 },
];

function calibrate(input: {
  workout?: WorkoutPlan;
  history?: WorkoutHistoryEntry[];
  exerciseById?: Record<string, Exercise>;
  loadIncrementByExerciseId?: Record<string, number>;
}) {
  return applyLoadsWithAudit(input.workout ?? workoutFor(), {
    history: input.history ?? [],
    baselines: [],
    exerciseById: input.exerciseById ?? { bench },
    primaryGoal: "hypertrophy",
    profile: { trainingAge: "intermediate" },
    sessionIntent: "upper",
    acceptedV4Calibration: true,
    accumulationSessionsCompleted: 1,
    isFirstSessionInMesocycle: false,
    loadIncrementByExerciseId: input.loadIncrementByExerciseId,
  });
}

describe("accepted V4 load calibration", () => {
  it("bridges the reproduced 135 x 8 @ RPE 8 Bench history to 140 lb", () => {
    const result = calibrate({
      history: [history({ sets: reproducedBenchSets })],
    });

    expect(result.workout.mainLifts[0].sets.map((set) => set.targetLoad)).toEqual([
      140, 140, 140, 140,
    ]);
    expect(result.audit.resolvedLoads["workout-exercise-bench"]).toMatchObject({
      source: "legacy_measurement_history",
      canonicalSourceLoad: 140,
      historyEvidence: {
        source: "legacy_measurement_bridge",
        date: "2026-08-03T00:00:00.000Z",
        load: 135,
        reps: 8,
        rpe: 8,
      },
    });
  });

  it("uses exact classified history ahead of legacy-null history", () => {
    const result = calibrate({
      history: [
        history({ load: 135, rpe: 8 }),
        {
          ...history({
            measurement: barbellMeasurement,
            sets: reproducedBenchSets,
          }),
          workoutId: "exact-workout",
          date: "2026-08-04T00:00:00.000Z",
        },
      ],
    });

    expect(result.audit.resolvedLoads["workout-exercise-bench"]?.source).toBe("history");
    expect(
      result.audit.resolvedLoads["workout-exercise-bench"]?.historyEvidence?.source,
    ).toBe("exact_compatible_history");
    expect(result.workout.mainLifts[0].sets[0].targetLoad).toBe(140);
  });

  it("uses the bridge when classified rows have no usable load evidence", () => {
    const result = calibrate({
      history: [
        history({ measurement: barbellMeasurement, load: 0, rpe: 8 }),
        {
          ...history({ sets: reproducedBenchSets }),
          workoutId: "legacy-workout",
          date: "2026-08-02T00:00:00.000Z",
        },
      ],
    });

    expect(result.workout.mainLifts[0].sets[0].targetLoad).toBe(140);
    expect(result.audit.resolvedLoads["workout-exercise-bench"]?.source).toBe(
      "legacy_measurement_history",
    );
  });

  it.each(["COMPLETED", "PARTIAL"] as const)(
    "admits usable %s performed evidence",
    (status) => {
      const result = calibrate({
        history: [history({ status, sets: reproducedBenchSets })],
      });
      expect(result.workout.mainLifts[0].sets[0].targetLoad).toBe(140);
    },
  );

  it("excludes skipped or otherwise unperformed work", () => {
    const result = calibrate({ history: [history({ status: "SKIPPED", rpe: 8 })] });
    expect(result.workout.mainLifts[0].sets[0].targetLoad).toBeUndefined();
    expect(result.audit.resolvedLoads["workout-exercise-bench"]?.source).toBe("none");
  });

  it("holds the historical anchor when legacy evidence has no RPE", () => {
    const result = calibrate({ history: [history()] });
    expect(result.workout.mainLifts[0].sets[0].targetLoad).toBe(135);
    expect(result.audit.progressionTraces["workout-exercise-bench"]).toBeUndefined();
  });

  it("returns no target instead of an equipment default without defensible evidence", () => {
    const result = calibrate({ history: [] });
    expect(result.workout.mainLifts[0].sets[0].targetLoad).toBeUndefined();
    expect(result.audit.resolvedLoads["workout-exercise-bench"]).toMatchObject({
      source: "none",
      canonicalSourceLoad: null,
    });
    expect(result.audit.prescriptions["workout-exercise-bench"]).toMatchObject({
      kind: "unavailable",
      blockingFields: ["evidence"],
      reasonCodes: ["no_comparable_history"],
    });
  });

  it("keeps explicit semantic zero distinct from absent evidence", () => {
    const zeroWorkout = workoutFor(bench, {
      profile: "REPS_EXTERNAL_LOAD",
      loadConvention: "MACHINE_DISPLAYED",
      repBasis: "TOTAL",
    });
    zeroWorkout.mainLifts[0].zeroLoadMeaning = "MACHINE_DEFAULT_NO_ADDED_LOAD";
    zeroWorkout.mainLifts[0].sets = zeroWorkout.mainLifts[0].sets.map((set) => ({
      ...set,
      targetLoad: 0,
    }));

    const result = calibrate({ workout: zeroWorkout, history: [] });
    expect(result.workout.mainLifts[0].sets.map((set) => set.targetLoad)).toEqual([0, 0, 0, 0]);
    expect(result.audit.prescriptions["workout-exercise-bench"]).toMatchObject({
      kind: "semantic_zero",
      value: 0,
      zeroLoadMeaning: "MACHINE_DEFAULT_NO_ADDED_LOAD",
      reasonCodes: ["machine_default_no_added_load"],
    });

    const absent = calibrate({
      workout: workoutFor(bench, zeroWorkout.mainLifts[0].measurement),
      history: [],
    });
    expect(absent.audit.prescriptions["workout-exercise-bench"].kind).toBe("unavailable");
  });

  it("rejects legacy history for a different exercise identity", () => {
    const result = calibrate({ history: [history({ exerciseId: "incline-bench", rpe: 8 })] });
    expect(result.workout.mainLifts[0].sets[0].targetLoad).toBeUndefined();
  });

  it.each([
    {
      name: "machine displayed",
      measurement: {
        profile: "REPS_EXTERNAL_LOAD",
        loadConvention: "MACHINE_DISPLAYED",
        repBasis: "TOTAL",
      } as const,
    },
    {
      name: "per-implement dumbbell",
      measurement: {
        profile: "REPS_EXTERNAL_LOAD",
        loadConvention: "IMPLEMENT_WEIGHT",
        repBasis: "TOTAL",
      } as const,
    },
    {
      name: "bodyweight-only",
      measurement: {
        profile: "REPS_BODYWEIGHT",
        repBasis: "TOTAL",
      } as const,
    },
    {
      name: "displayed assistance",
      measurement: {
        profile: "REPS_ASSISTED",
        loadConvention: "DISPLAYED_ASSISTANCE",
        repBasis: "TOTAL",
      } as const,
    },
  ])("does not bridge $name semantics", ({ measurement }) => {
    const result = calibrate({ workout: workoutFor(bench, measurement), history: [history({ rpe: 8 })] });
    expect(result.workout.mainLifts[0].sets[0].targetLoad).toBeUndefined();
  });

  it("keeps exact compatible dumbbell history and its 2.5-lb quantization", () => {
    const dumbbellMeasurement = {
      profile: "REPS_EXTERNAL_LOAD",
      loadConvention: "IMPLEMENT_WEIGHT",
      repBasis: "TOTAL",
    } as const satisfies MeasurementSemantics;
    const dumbbellPress: Exercise = {
      ...bench,
      id: "dumbbell-press",
      name: "Dumbbell Bench Press",
      equipment: ["dumbbell"],
    };
    const result = calibrate({
      workout: workoutFor(dumbbellPress, dumbbellMeasurement),
      history: [
        history({
          exerciseId: "dumbbell-press",
          measurement: dumbbellMeasurement,
          load: 40,
          reps: 8,
          rpe: 8,
        }),
      ],
      exerciseById: { "dumbbell-press": dumbbellPress },
    });
    const target = result.workout.mainLifts[0].sets[0].targetLoad;
    expect(target).toBeDefined();
    expect((target as number) % 2.5).toBe(0);
    expect((target as number) - 40).toBeLessThanOrEqual(2.5);
  });

  it("retains the existing one-step bound with a coarser supplied increment", () => {
    const result = calibrate({
      history: [history({ sets: reproducedBenchSets })],
      loadIncrementByExerciseId: { bench: 10 },
    });
    const target = result.workout.mainLifts[0].sets[0].targetLoad;
    expect(target).toBe(135);
    expect((target as number) - 135).toBeLessThanOrEqual(10);
  });
});
