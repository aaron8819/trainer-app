import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const workoutFindUnique = vi.fn();
  const readinessFindMany = vi.fn();
  const exerciseFindMany = vi.fn();
  const workoutFindMany = vi.fn();
  const setLogAggregate = vi.fn();
  const workoutExerciseFindFirst = vi.fn();
  const mesocleFindUnique = vi.fn();

  return {
    workoutFindUnique,
    readinessFindMany,
    exerciseFindMany,
    workoutFindMany,
    setLogAggregate,
    workoutExerciseFindFirst,
    mesocleFindUnique,
  };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    workout: {
      findUnique: (...args: unknown[]) => mocks.workoutFindUnique(...args),
      findMany: (...args: unknown[]) => mocks.workoutFindMany(...args),
    },
    readinessSignal: {
      findMany: (...args: unknown[]) => mocks.readinessFindMany(...args),
    },
    exercise: {
      findMany: (...args: unknown[]) => mocks.exerciseFindMany(...args),
    },
    setLog: {
      aggregate: (...args: unknown[]) => mocks.setLogAggregate(...args),
    },
    workoutExercise: {
      findFirst: (...args: unknown[]) => mocks.workoutExerciseFindFirst(...args),
    },
    mesocycle: {
      findUnique: (...args: unknown[]) => mocks.mesocleFindUnique(...args),
    },
  },
}));

vi.mock("@/lib/engine/explainability", () => ({
  explainSessionContext: () => ({
    blockPhase: { blockType: "accumulation", weekInBlock: 1, totalWeeksInBlock: 4, primaryGoal: "build" },
    volumeStatus: { muscleStatuses: new Map(), overallSummary: "ok" },
    readinessStatus: {
      overall: "moderate",
      signalAge: 0,
      availability: "recent",
      label: "Recent readiness",
      perMuscleFatigue: new Map(),
      adaptations: [],
    },
    progressionContext: {
      weekInMesocycle: 1,
      volumeProgression: "building",
      intensityProgression: "ramping",
      nextMilestone: "next",
    },
    cycleSource: "computed",
    narrative: "narrative",
  }),
  explainExerciseRationale: () => ({
    exerciseName: "Bench Press",
    primaryReasons: ["reason"],
    selectionFactors: {
      deficitFill: { score: 0.5, explanation: "x" },
      rotationNovelty: { score: 0.5, explanation: "x" },
      sfrEfficiency: { score: 0.5, explanation: "x" },
      lengthenedPosition: { score: 0.5, explanation: "x" },
      sraAlignment: { score: 0.5, explanation: "x" },
      userPreference: { score: 0.5, explanation: "x" },
      movementNovelty: { score: 0.5, explanation: "x" },
    },
    citations: [],
    alternatives: [],
    volumeContribution: "3 sets",
  }),
  explainPrescriptionRationale: () => ({
    exerciseName: "Bench Press",
    sets: { count: 3, reason: "x", blockContext: "x" },
    reps: { target: 8, reason: "x" },
    load: { load: 205, progressionType: "double", reason: "x" },
    rir: { target: 2, reason: "x" },
    rest: { seconds: 150, reason: "x", exerciseType: "moderate_compound" },
    overallNarrative: "x",
  }),
  generateCoachMessages: () => [],
}));

vi.mock("./periodization", () => ({
  loadCurrentBlockContext: vi.fn().mockResolvedValue({ blockContext: null, weekInMeso: 1 }),
}));

vi.mock("./workout-context", () => ({
  mapExercises: vi.fn().mockReturnValue([
    {
      id: "ex1",
      name: "Bench Press",
      movementPatterns: ["horizontal_push"],
      splitTags: ["push"],
      jointStress: "medium",
      equipment: ["barbell"],
      primaryMuscles: ["Chest"],
      secondaryMuscles: ["Triceps"],
      isCompound: true,
      repRangeMin: 3,
      repRangeMax: 12,
    },
    {
      id: "ex2",
      name: "Barbell Curl",
      movementPatterns: ["elbow_flexion"],
      splitTags: ["pull"],
      jointStress: "low",
      equipment: ["barbell"],
      primaryMuscles: ["Biceps"],
      secondaryMuscles: [],
      isCompound: false,
      repRangeMin: 8,
      repRangeMax: 15,
    },
  ]),
}));

import { generateWorkoutExplanation } from "./explainability";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSet(setIndex: number, logs: { wasSkipped: boolean }[] = []) {
  return {
    setIndex,
    targetReps: 8,
    targetRepMin: null,
    targetRepMax: null,
    targetRpe: 8,
    targetLoad: 205,
    restSeconds: 150,
    logs,
  };
}

function makeChestExercise(setCount: number) {
  return {
    exerciseId: "ex1",
    isMainLift: true,
    exercise: {
      id: "ex1",
      name: "Bench Press",
      movementPatterns: ["HORIZONTAL_PUSH"],
      exerciseEquipment: [{ equipment: { type: "BARBELL" } }],
      exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Chest" } }],
    },
    sets: Array.from({ length: setCount }, (_, i) => makeSet(i + 1)),
  };
}

function makeBicepsExercise(setCount: number) {
  return {
    exerciseId: "ex2",
    isMainLift: false,
    exercise: {
      id: "ex2",
      name: "Barbell Curl",
      movementPatterns: ["ELBOW_FLEXION"],
      exerciseEquipment: [{ equipment: { type: "BARBELL" } }],
      exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Biceps" } }],
    },
    sets: Array.from({ length: setCount }, (_, i) => makeSet(i + 1)),
  };
}

function makePriorWorkoutWithSets(muscleName: string, setCount: number) {
  return {
    exercises: [
      {
        exercise: {
          exerciseMuscles: [{ role: "PRIMARY", muscle: { name: muscleName } }],
        },
        sets: Array.from({ length: setCount }, () => ({
          logs: [{ wasSkipped: false }],
        })),
      },
    ],
  };
}

const BASE_WORKOUT = {
  id: "w1",
  userId: "u1",
  scheduledDate: new Date("2026-02-21T00:00:00.000Z"),
  sessionIntent: "PUSH",
  selectionMetadata: {},
  autoregulationLog: null,
  filteredExercises: [],
  mesocycleId: "meso1",
  mesocycleWeekSnapshot: 2,
  exercises: [makeChestExercise(3)],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("generateWorkoutExplanation – volumeCompliance", () => {
  // Capture the prior workouts to return from the compliance query per-test
  let compliancePriorWorkouts: unknown[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    compliancePriorWorkouts = [];

    mocks.workoutFindUnique.mockResolvedValue(BASE_WORKOUT);
    mocks.readinessFindMany.mockResolvedValue([]);
    mocks.exerciseFindMany.mockResolvedValue([]);
    mocks.setLogAggregate.mockResolvedValue({ _max: { actualLoad: null, actualReps: null } });
    mocks.workoutExerciseFindFirst.mockResolvedValue(null);

    // Default mesocycle: 4-week accumulation
    mocks.mesocleFindUnique.mockResolvedValue({
      durationWeeks: 4,
      state: "ACTIVE_ACCUMULATION",
    });

    // Route workout.findMany: compliance query (has mesocycleId) vs. other queries
    mocks.workoutFindMany.mockImplementation(
      (args: { where?: Record<string, unknown> }) => {
        if (args?.where?.mesocycleId) {
          return Promise.resolve(compliancePriorWorkouts);
        }
        return Promise.resolve([]);
      }
    );
  });

  it("returns correct projectedTotal when prior sessions exist in the same meso week", async () => {
    // Prior workout: 3 chest sets performed
    compliancePriorWorkouts = [makePriorWorkoutWithSets("Chest", 3)];

    const result = await generateWorkoutExplanation("w1");
    expect("error" in result).toBe(false);
    if ("error" in result) return;

    const chestRow = result.volumeCompliance.find((r) => r.muscle === "Chest");
    expect(chestRow).toBeDefined();
    expect(chestRow?.setsLoggedBeforeSession).toBe(3);
    expect(chestRow?.setsPrescribedThisSession).toBe(3);
    expect(chestRow?.projectedTotal).toBe(6);
    // Chest MEV=10, projectedTotal=6 < MEV → UNDER_MEV
    expect(chestRow?.status).toBe("UNDER_MEV");
  });

  it("prior sessions from a different meso week are excluded from the query", async () => {
    // compliancePriorWorkouts stays [] — simulates DB filtered by mesocycleWeekSnapshot
    const result = await generateWorkoutExplanation("w1");
    expect("error" in result).toBe(false);
    if ("error" in result) return;

    const chestRow = result.volumeCompliance.find((r) => r.muscle === "Chest");
    expect(chestRow?.setsLoggedBeforeSession).toBe(0);

    // Verify the query was issued with the correct week snapshot
    const complianceCall = mocks.workoutFindMany.mock.calls.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (call: any[]) => call[0]?.where?.mesocycleId === "meso1"
    );
    expect(complianceCall?.[0]?.where?.mesocycleWeekSnapshot).toBe(2);
  });

  it("current workout is excluded from prior-session count via id filter", async () => {
    await generateWorkoutExplanation("w1");

    const complianceCall = mocks.workoutFindMany.mock.calls.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (call: any[]) => call[0]?.where?.mesocycleId === "meso1"
    );
    expect(complianceCall?.[0]?.where?.id).toEqual({ not: "w1" });
  });

  it("computes OVER_MAV when projectedTotal exceeds MAV", async () => {
    // Chest MAV=16; prior=14 + current=3 = 17 > 16
    compliancePriorWorkouts = [makePriorWorkoutWithSets("Chest", 14)];

    const result = await generateWorkoutExplanation("w1");
    if ("error" in result) return;

    const chestRow = result.volumeCompliance.find((r) => r.muscle === "Chest");
    expect(chestRow?.projectedTotal).toBe(17);
    expect(chestRow?.status).toBe("OVER_MAV");
  });

  it("computes UNDER_MEV when projectedTotal is below MEV", async () => {
    // Only 1 set prescribed, no prior → projectedTotal=1 < Chest MEV=10
    mocks.workoutFindUnique.mockResolvedValue({
      ...BASE_WORKOUT,
      exercises: [makeChestExercise(1)],
    });

    const result = await generateWorkoutExplanation("w1");
    if ("error" in result) return;

    const chestRow = result.volumeCompliance.find((r) => r.muscle === "Chest");
    expect(chestRow?.projectedTotal).toBe(1);
    expect(chestRow?.status).toBe("UNDER_MEV");
  });

  it("computes ON_TARGET when projectedTotal equals weeklyTarget", async () => {
    // Week 2 of 4 for Chest: target = MEV + 0.5*(MAV-MEV) = 10 + 3 = 13
    // prior=10, current=3 → projectedTotal=13 = weeklyTarget
    compliancePriorWorkouts = [makePriorWorkoutWithSets("Chest", 10)];

    const result = await generateWorkoutExplanation("w1");
    if ("error" in result) return;

    const chestRow = result.volumeCompliance.find((r) => r.muscle === "Chest");
    expect(chestRow?.projectedTotal).toBe(13);
    expect(chestRow?.weeklyTarget).toBe(13);
    expect(chestRow?.status).toBe("ON_TARGET");
  });

  it("APPROACHING_MAV takes priority over OVER_TARGET at the boundary (projectedTotal > 0.85*MAV)", async () => {
    // Chest: MAV=16, 0.85*MAV=13.6; prior=11, current=3 → projectedTotal=14 > 13.6
    // weeklyTarget=13, projectedTotal=14 > weeklyTarget → would be OVER_TARGET
    // BUT projectedTotal=14 > 0.85*16=13.6 → APPROACHING_MAV takes priority
    compliancePriorWorkouts = [makePriorWorkoutWithSets("Chest", 11)];

    const result = await generateWorkoutExplanation("w1");
    if ("error" in result) return;

    const chestRow = result.volumeCompliance.find((r) => r.muscle === "Chest");
    expect(chestRow?.projectedTotal).toBe(14);
    expect(chestRow?.status).toBe("APPROACHING_MAV");
  });

  it("returns empty array without throwing when mesocycleId is null", async () => {
    mocks.workoutFindUnique.mockResolvedValue({
      ...BASE_WORKOUT,
      mesocycleId: null,
      mesocycleWeekSnapshot: null,
    });

    const result = await generateWorkoutExplanation("w1");
    expect("error" in result).toBe(false);
    if ("error" in result) return;

    expect(result.volumeCompliance).toEqual([]);
    // mesocycle should not be queried
    expect(mocks.mesocleFindUnique).not.toHaveBeenCalled();
  });

  it("sorts results by severity descending: OVER_MAV first, UNDER_MEV last", async () => {
    // Two exercises: Chest (OVER_MAV) and Biceps (UNDER_MEV)
    // Chest MAV=16; prior=14 + current=3 = 17 → OVER_MAV
    // Biceps MEV=8; prior=0 + current=1 = 1 → UNDER_MEV
    mocks.workoutFindUnique.mockResolvedValue({
      ...BASE_WORKOUT,
      exercises: [makeChestExercise(3), makeBicepsExercise(1)],
    });
    compliancePriorWorkouts = [makePriorWorkoutWithSets("Chest", 14)];

    const result = await generateWorkoutExplanation("w1");
    if ("error" in result) return;

    expect(result.volumeCompliance.length).toBeGreaterThanOrEqual(2);
    const statuses = result.volumeCompliance.map((r) => r.status);
    expect(statuses[0]).toBe("OVER_MAV");
    expect(statuses[statuses.length - 1]).toBe("UNDER_MEV");
  });
});
