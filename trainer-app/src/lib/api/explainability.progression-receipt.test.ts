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
    readinessStatus: {
      overall: "moderate",
      signalAge: 0,
      availability: "recent",
      label: "Recent readiness",
      perMuscleFatigue: new Map(),
      sorenessSuppressedMuscles: [],
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

const loadCurrentBlockContextMock = vi.fn().mockResolvedValue({ blockContext: null, weekInMeso: 1 });

vi.mock("./periodization", () => ({
  loadCurrentBlockContext: (...args: unknown[]) => loadCurrentBlockContextMock(...args),
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
      stimulusProfile: {
        chest: 1,
        triceps: 0.35,
      },
      isCompound: true,
      repRangeMin: 3,
      repRangeMax: 12,
    },
  ]),
}));

import {
  generateWorkoutExplanation,
  normalizeStoredSelectionRationaleComponents,
} from "./explainability";

describe("generateWorkoutExplanation progression receipt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadCurrentBlockContextMock.mockResolvedValue({ blockContext: null, weekInMeso: 1 });

    mocks.workoutFindUnique.mockResolvedValue({
      id: "w1",
      userId: "u1",
      scheduledDate: new Date("2026-02-21T00:00:00.000Z"),
      sessionIntent: "PUSH",
      selectionMetadata: {},
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
      workout: {
        scheduledDate: new Date("2026-02-18T00:00:00.000Z"),
        selectionMode: "INTENT",
        sessionIntent: "PUSH",
        selectionMetadata: {},
      },
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
    expect(receipt?.decisionLog?.length).toBeGreaterThan(0);
  });

  it("summarizes latest performed load using modal load across sets", async () => {
    mocks.workoutFindUnique.mockResolvedValueOnce({
      id: "w1",
      userId: "u1",
      scheduledDate: new Date("2026-02-21T00:00:00.000Z"),
      sessionIntent: "PUSH",
      selectionMetadata: {},
      filteredExercises: [],
      exercises: [
        {
          exerciseId: "ex1",
          isMainLift: false,
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
    mocks.workoutExerciseFindFirst.mockResolvedValueOnce({
      workout: { scheduledDate: new Date("2026-02-18T00:00:00.000Z") },
      sets: [
        {
          setIndex: 1,
          logs: [{ actualReps: 10, actualLoad: 35, actualRpe: 7.5, wasSkipped: false }],
        },
        {
          setIndex: 2,
          logs: [{ actualReps: 10, actualLoad: 40, actualRpe: 8, wasSkipped: false }],
        },
        {
          setIndex: 3,
          logs: [{ actualReps: 10, actualLoad: 40, actualRpe: 8, wasSkipped: false }],
        },
        {
          setIndex: 4,
          logs: [{ actualReps: 10, actualLoad: 40, actualRpe: 8, wasSkipped: false }],
        },
        {
          setIndex: 5,
          logs: [{ actualReps: 10, actualLoad: 40, actualRpe: 8, wasSkipped: false }],
        },
      ],
    });

    const result = await generateWorkoutExplanation("w1");
    expect("error" in result).toBe(false);
    if ("error" in result) return;

    const receipt = result.progressionReceipts.get("ex1");
    expect(receipt?.lastPerformed?.load).toBe(40);
  });

  it("labels hold when prescribed load equals prior performed anchor load", async () => {
    mocks.workoutFindUnique.mockResolvedValueOnce({
      id: "w1",
      userId: "u1",
      scheduledDate: new Date("2026-02-21T00:00:00.000Z"),
      sessionIntent: "PUSH",
      selectionMetadata: {},
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
              targetLoad: 200,
              restSeconds: 150,
              logs: [],
            },
          ],
        },
      ],
    });
    mocks.workoutExerciseFindFirst.mockResolvedValueOnce({
      workout: { scheduledDate: new Date("2026-02-18T00:00:00.000Z") },
      sets: [
        {
          setIndex: 1,
          logs: [{ actualReps: 8, actualLoad: 200, actualRpe: 8, wasSkipped: false }],
        },
        {
          setIndex: 2,
          logs: [{ actualReps: 8, actualLoad: 180, actualRpe: 8, wasSkipped: false }],
        },
      ],
    });

    const result = await generateWorkoutExplanation("w1");
    expect("error" in result).toBe(false);
    if ("error" in result) return;

    const receipt = result.progressionReceipts.get("ex1");
    expect(receipt?.todayPrescription?.load).toBe(200);
    expect(receipt?.lastPerformed?.load).toBe(200);
    expect(receipt?.trigger).toBe("hold");
  });

  it("does not treat old history as current progression evidence", async () => {
    mocks.workoutExerciseFindFirst.mockResolvedValueOnce({
      workout: { scheduledDate: new Date("2025-10-01T00:00:00.000Z") },
      sets: [
        {
          setIndex: 1,
          logs: [{ actualReps: 8, actualLoad: 200, actualRpe: 8, wasSkipped: false }],
        },
      ],
    });

    const result = await generateWorkoutExplanation("w1");
    expect("error" in result).toBe(false);
    if ("error" in result) return;

    const receipt = result.progressionReceipts.get("ex1");
    expect(receipt?.lastPerformed).toBeNull();
  });

  it("queries performed volume using PARTIAL + COMPLETED statuses", async () => {
    await generateWorkoutExplanation("w1");

    const firstWorkoutFindManyCall = mocks.workoutFindMany.mock.calls[0]?.[0] as
      | { where?: { status?: { in?: string[] } } }
      | undefined;

    expect(firstWorkoutFindManyCall?.where?.status?.in).toEqual(["COMPLETED", "PARTIAL"]);
  });

  it("excludes supplemental sessions from progression-facing explainability and falls back to the latest eligible history", async () => {
    mocks.workoutExerciseFindFirst
      .mockResolvedValueOnce({
        workout: {
          scheduledDate: new Date("2026-02-20T00:00:00.000Z"),
          selectionMode: "INTENT",
          sessionIntent: "BODY_PART",
          selectionMetadata: {
            sessionDecisionReceipt: {
              version: 1,
              cycleContext: {
                weekInMeso: 4,
                weekInBlock: 4,
                phase: "accumulation",
                blockType: "accumulation",
                isDeload: false,
                source: "computed",
              },
              lifecycleVolume: { source: "unknown" },
              sorenessSuppressedMuscles: [],
              deloadDecision: {
                mode: "none",
                reason: [],
                reductionPercent: 0,
                appliedTo: "none",
              },
              readiness: {
                wasAutoregulated: false,
                signalAgeHours: null,
                fatigueScoreOverall: null,
                intensityScaling: {
                  applied: false,
                  exerciseIds: [],
                  scaledUpCount: 0,
                  scaledDownCount: 0,
                },
              },
              exceptions: [
                {
                  code: "supplemental_deficit_session",
                  message: "Marked as supplemental deficit session.",
                },
              ],
            },
          },
        },
        sets: [
          {
            setIndex: 1,
            logs: [{ actualReps: 8, actualLoad: 240, actualRpe: 8, wasSkipped: false }],
          },
        ],
      })
      .mockResolvedValueOnce({
        workout: {
          scheduledDate: new Date("2026-02-18T00:00:00.000Z"),
          selectionMode: "INTENT",
          sessionIntent: "PUSH",
          selectionMetadata: {},
        },
        sets: [
          {
            setIndex: 1,
            logs: [{ actualReps: 8, actualLoad: 200, actualRpe: 8, wasSkipped: false }],
          },
        ],
      });

    const result = await generateWorkoutExplanation("w1");
    expect("error" in result).toBe(false);
    if ("error" in result) return;

    const receipt = result.progressionReceipts.get("ex1");
    expect(receipt?.lastPerformed?.load).toBe(200);
    expect(receipt?.lastPerformed?.load).not.toBe(240);
  });

  it("does not drift optional gap-fill progression explainability behavior", async () => {
    mocks.workoutExerciseFindFirst.mockResolvedValueOnce({
      workout: {
        scheduledDate: new Date("2026-02-18T00:00:00.000Z"),
        selectionMode: "INTENT",
        sessionIntent: "BODY_PART",
        selectionMetadata: {
          sessionDecisionReceipt: {
            version: 1,
            cycleContext: {
              weekInMeso: 4,
              weekInBlock: 4,
              phase: "accumulation",
              blockType: "accumulation",
              isDeload: false,
              source: "computed",
            },
            lifecycleVolume: { source: "unknown" },
            sorenessSuppressedMuscles: [],
            deloadDecision: {
              mode: "none",
              reason: [],
              reductionPercent: 0,
              appliedTo: "none",
            },
            readiness: {
              wasAutoregulated: false,
              signalAgeHours: null,
              fatigueScoreOverall: null,
              intensityScaling: {
                applied: false,
                exerciseIds: [],
                scaledUpCount: 0,
                scaledDownCount: 0,
              },
            },
            exceptions: [
              {
                code: "optional_gap_fill",
                message: "Marked as optional gap-fill session.",
              },
            ],
          },
        },
      },
      sets: [
        {
          setIndex: 1,
          logs: [{ actualReps: 8, actualLoad: 200, actualRpe: 8, wasSkipped: false }],
        },
      ],
    });

    const result = await generateWorkoutExplanation("w1");
    expect("error" in result).toBe(false);
    if ("error" in result) return;

    const receipt = result.progressionReceipts.get("ex1");
    expect(receipt?.lastPerformed?.load).toBe(200);
  });

  it("keeps non-progression volume queries scoped to performed status only", async () => {
    await generateWorkoutExplanation("w1");

    const volumeQuery = mocks.workoutFindMany.mock.calls[0]?.[0] as
      | { where?: Record<string, unknown> }
      | undefined;

    expect(volumeQuery?.where?.status).toEqual({ in: ["COMPLETED", "PARTIAL"] });
    expect(volumeQuery?.where?.selectionMode).toBeUndefined();
    expect(volumeQuery?.where?.sessionIntent).toBeUndefined();
  });

  it("excludes RPE < 6 sets from progression anchor summaries", async () => {
    mocks.workoutExerciseFindFirst.mockResolvedValueOnce({
      workout: { scheduledDate: new Date("2026-02-18T00:00:00.000Z") },
      sets: [
        {
          setIndex: 1,
          logs: [{ actualReps: 12, actualLoad: 10, actualRpe: 5, wasSkipped: false }],
        },
        {
          setIndex: 2,
          logs: [{ actualReps: 12, actualLoad: 20, actualRpe: 8, wasSkipped: false }],
        },
        {
          setIndex: 3,
          logs: [{ actualReps: 12, actualLoad: 20, actualRpe: 8, wasSkipped: false }],
        },
      ],
    });

    const result = await generateWorkoutExplanation("w1");
    expect("error" in result).toBe(false);
    if ("error" in result) return;

    const receipt = result.progressionReceipts.get("ex1");
    expect(receipt?.lastPerformed?.load).toBe(20);
  });

  it("ignores non-exercise rationale keys when assessing persisted selection evidence", async () => {
    mocks.workoutFindUnique.mockResolvedValueOnce({
      id: "w1",
      userId: "u1",
      scheduledDate: new Date("2026-02-21T00:00:00.000Z"),
      sessionIntent: "PUSH",
      selectionMetadata: {
        rationale: {
          overallStrategy: {
            score: 1,
            components: { pinned: 1 },
          },
        },
      },
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

    const result = await generateWorkoutExplanation("w1");
    expect("error" in result).toBe(false);
    if ("error" in result) return;

    expect(result.confidence.missingSignals).toContain("stored exercise selection reasons");
  });

  it("does not require active block context when a canonical session decision receipt exists", async () => {
    loadCurrentBlockContextMock.mockResolvedValueOnce({ blockContext: null, weekInMeso: 1 });
    mocks.workoutFindUnique.mockResolvedValueOnce({
      id: "w1",
      userId: "u1",
      scheduledDate: new Date("2026-02-21T00:00:00.000Z"),
      sessionIntent: "PUSH",
      selectionMetadata: {
        sessionDecisionReceipt: {
          version: 1,
          cycleContext: {
            weekInMeso: 2,
            weekInBlock: 2,
            mesocycleLength: 5,
            phase: "accumulation",
            blockType: "accumulation",
            isDeload: false,
            source: "computed",
          },
          lifecycleRirTarget: { min: 2, max: 3 },
          lifecycleVolume: {
            targets: { Chest: 13 },
            source: "lifecycle",
          },
          sorenessSuppressedMuscles: [],
          deloadDecision: {
            mode: "none",
            reason: [],
            reductionPercent: 0,
            appliedTo: "none",
          },
          readiness: {
            wasAutoregulated: false,
            signalAgeHours: 12,
            fatigueScoreOverall: null,
            intensityScaling: {
              applied: false,
              exerciseIds: [],
              scaledUpCount: 0,
              scaledDownCount: 0,
            },
          },
          exceptions: [],
        },
      },
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

    const result = await generateWorkoutExplanation("w1");
    expect("error" in result).toBe(false);
    if ("error" in result) return;

    expect(result.confidence.missingSignals).not.toContain("receipt-backed cycle context");
  });

  it("does not treat live readiness rows as session evidence when the canonical receipt is missing", async () => {
    mocks.readinessFindMany.mockResolvedValueOnce([
      {
        timestamp: new Date("2026-02-20T12:00:00.000Z"),
        subjectiveReadiness: 4,
      },
    ]);

    const result = await generateWorkoutExplanation("w1");
    expect("error" in result).toBe(false);
    if ("error" in result) return;

    expect(result.confidence.missingSignals).toContain("same-day readiness check-in");
  });
});

describe("normalizeStoredSelectionRationaleComponents", () => {
  it("keeps canonical rationale component keys", () => {
    expect(
      normalizeStoredSelectionRationaleComponents({
        deficitFill: 0.8,
        rotationNovelty: 0.4,
        sfrScore: 0.6,
        extra: 99,
      })
    ).toEqual({
      deficitFill: 0.8,
      rotationNovelty: 0.4,
      sfrScore: 0.6,
    });
  });

  it("drops legacy-only rationale component aliases", () => {
    expect(
      normalizeStoredSelectionRationaleComponents({
        volumeDeficitFill: 0.8,
        sfrEfficiency: 0.6,
        lengthenedBias: 0.7,
        movementDiversity: 0.5,
        sraReadiness: 0.4,
      })
    ).toBeUndefined();
  });
});
