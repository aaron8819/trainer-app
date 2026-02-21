import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const workoutFindUnique = vi.fn();
  const readinessFindMany = vi.fn();
  const exerciseFindMany = vi.fn();
  const workoutFindMany = vi.fn();
  const setLogAggregate = vi.fn();
  const workoutExerciseFindFirst = vi.fn();

  return {
    workoutFindUnique,
    readinessFindMany,
    exerciseFindMany,
    workoutFindMany,
    setLogAggregate,
    workoutExerciseFindFirst,
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
  },
}));

vi.mock("@/lib/engine/explainability", () => ({
  explainSessionContext: () => ({
    blockPhase: { blockType: "accumulation", weekInBlock: 1, totalWeeksInBlock: 4, primaryGoal: "build" },
    volumeStatus: { muscleStatuses: new Map(), overallSummary: "ok" },
    readinessStatus: { overall: "moderate", signalAge: 0, perMuscleFatigue: new Map(), adaptations: [] },
    progressionContext: {
      weekInMesocycle: 1,
      volumeProgression: "building",
      intensityProgression: "ramping",
      nextMilestone: "next",
    },
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
  ]),
}));

import { generateWorkoutExplanation } from "./explainability";

describe("generateWorkoutExplanation progression receipt", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.workoutFindUnique.mockResolvedValue({
      id: "w1",
      userId: "u1",
      scheduledDate: new Date("2026-02-21T00:00:00.000Z"),
      sessionIntent: "PUSH",
      selectionMetadata: {},
      autoregulationLog: null,
      filteredExercises: [],
      exercises: [
        {
          exerciseId: "ex1",
          isMainLift: true,
          exercise: {
            id: "ex1",
            name: "Bench Press",
            movementPatterns: ["HORIZONTAL_PUSH"],
            exerciseEquipment: [{ equipment: { type: "BARBELL" } }],
            exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Chest" } }],
          },
          sets: [
            {
              setIndex: 1,
              targetReps: 8,
              targetRepMin: null,
              targetRepMax: null,
              targetRpe: 8,
              targetLoad: 205,
              restSeconds: 150,
              logs: [],
            },
          ],
        },
      ],
    });
    mocks.readinessFindMany.mockResolvedValue([]);
    mocks.exerciseFindMany.mockResolvedValue([]);
    mocks.workoutFindMany.mockResolvedValue([]);
    mocks.setLogAggregate.mockResolvedValue({ _max: { actualLoad: null, actualReps: null } });
    mocks.workoutExerciseFindFirst.mockResolvedValue({
      sets: [
        {
          setIndex: 1,
          logs: [{ actualReps: 8, actualLoad: 200, actualRpe: 8, wasSkipped: false }],
        },
      ],
    });
  });

  it("includes per-exercise progressionReceipts when performed history exists", async () => {
    const result = await generateWorkoutExplanation("w1");
    expect("error" in result).toBe(false);
    if ("error" in result) return;

    const receipt = result.progressionReceipts.get("ex1");
    expect(receipt).toBeDefined();
    expect(receipt?.lastPerformed?.load).toBe(200);
    expect(receipt?.todayPrescription?.load).toBe(205);
  });
});
