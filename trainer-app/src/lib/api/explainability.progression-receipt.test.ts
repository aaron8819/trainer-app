import { beforeEach, describe, expect, it, vi } from "vitest";
import { computeDoubleProgressionDecision } from "@/lib/engine/progression";
import { buildCanonicalProgressionEvaluationInput } from "@/lib/progression/canonical-progression-input";
import { derivePerformedExerciseSemantics } from "@/lib/session-semantics/performed-exercise-semantics";

const mocks = vi.hoisted(() => {
  const workoutFindUnique = vi.fn();
  const readinessFindMany = vi.fn();
  const exerciseFindMany = vi.fn();
  const workoutFindMany = vi.fn();
  const setLogAggregate = vi.fn();
  const workoutExerciseFindFirst = vi.fn();
  const workoutExerciseFindMany = vi.fn();

  return {
    workoutFindUnique,
    readinessFindMany,
    exerciseFindMany,
    workoutFindMany,
    setLogAggregate,
    workoutExerciseFindFirst,
    workoutExerciseFindMany,
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
      findMany: (...args: unknown[]) => mocks.workoutExerciseFindMany(...args),
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

const generatedSemanticsSnapshot = {
  kind: "advancing",
  effectiveSelectionMode: "INTENT",
  isDeload: false,
  isStrictGapFill: false,
  isStrictSupplemental: false,
  advancesLifecycle: true,
  consumesWeeklyScheduleIntent: true,
  countsTowardCompliance: true,
  countsTowardRecentStimulus: true,
  countsTowardWeeklyVolume: true,
  countsTowardProgressionHistory: true,
  countsTowardPerformanceHistory: true,
  updatesProgressionAnchor: true,
  eligibleForUniqueIntentSubtraction: true,
  reasons: [],
  trace: {
    advancesSplitInput: true,
  },
} as const;

function buildGeneratedProgressionTrace(input: {
  anchorLoad: number;
  nextLoad: number;
  anchorSource: "working_set" | "conservative_modal";
  action: "increase" | "hold" | "decrease";
  path: "path_3" | "fallback_hold";
}) {
  return {
    version: 1,
    decisionSource: "double_progression",
    repRange: { min: 8, max: 12 },
    equipment: input.anchorSource === "working_set" ? "barbell" : "cable",
    anchor: {
      source: input.anchorSource,
      workingSetApplied: input.anchorSource === "working_set",
      anchorLoad: input.anchorLoad,
      signalSetCount: 2,
      effectiveSetCount: 2,
      trimmedSetCount: 0,
      highVarianceDetected: false,
      minSignalLoad: input.anchorLoad,
      maxSignalLoad: input.anchorLoad,
      medianSignalLoad: input.anchorLoad,
    },
    confidence: {
      priorSessionCount: 1,
      sampleScale: 1,
      historyScale: 1,
      combinedScale: 1,
      reasons: ["Used direct history"],
    },
    metrics: {
      medianReps: 10,
      modalRpe: 8,
      nextLoad: input.nextLoad,
      loadDelta: input.nextLoad - input.anchorLoad,
    },
    outcome: {
      path: input.path,
      action: input.action,
      reasonCodes: ["test"],
    },
    decisionLog: ["Used direct history"],
  } as const;
}

function buildGeneratedSelectionMetadata(input: {
  exerciseId?: string;
  exerciseName?: string;
  isMainLift?: boolean;
  section?: "main" | "accessory";
  sessionIntent?: string;
  progressionTrace?: Record<string, unknown>;
}) {
  const exerciseId = input.exerciseId ?? "ex1";
  return {
    sessionAuditSnapshot: {
      version: 1,
      generated: {
        selectionMode: "INTENT",
        sessionIntent: input.sessionIntent ?? "push",
        exerciseCount: 1,
        hardSetCount: 3,
        exercises: [
          {
            exerciseId,
            exerciseName: input.exerciseName ?? "Bench Press",
            orderIndex: 0,
            section: input.section ?? "main",
            isMainLift: input.isMainLift ?? true,
            prescribedSetCount: 3,
            prescribedSets: [{ setIndex: 1, targetReps: 8, targetRpe: 8 }],
          },
        ],
        semantics: generatedSemanticsSnapshot,
        traces: {
          progression: input.progressionTrace ?? {},
        },
      },
    },
  };
}

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
    mocks.workoutExerciseFindMany.mockResolvedValue([]);
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

  it("keeps same-intent accessory readout history-backed when the generated trace confirms anchoring", async () => {
    mocks.workoutFindUnique.mockResolvedValueOnce({
      id: "w1",
      userId: "u1",
      scheduledDate: new Date("2026-03-28T00:00:00.000Z"),
      sessionIntent: "UPPER",
      selectionMetadata: buildGeneratedSelectionMetadata({
        isMainLift: false,
        section: "accessory",
        sessionIntent: "upper",
        exerciseName: "Face Pull",
        progressionTrace: {
          ex1: buildGeneratedProgressionTrace({
            anchorLoad: 35,
            nextLoad: 35,
            anchorSource: "conservative_modal",
            action: "hold",
            path: "fallback_hold",
          }),
        },
      }),
      filteredExercises: [],
      exercises: [
        {
          exerciseId: "ex1",
          isMainLift: false,
          exercise: {
            id: "ex1",
            name: "Face Pull",
            movementPatterns: ["HORIZONTAL_PULL"],
            exerciseEquipment: [{ equipment: { type: "CABLE" } }],
            exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Rear Delts" } }],
          },
          sets: [
            {
              setIndex: 1,
              targetReps: 12,
              targetRepMin: 10,
              targetRepMax: 15,
              targetRpe: 8,
              targetLoad: 35,
              restSeconds: 90,
              logs: [],
            },
          ],
        },
      ],
    });
    mocks.workoutExerciseFindFirst.mockResolvedValueOnce({
      workout: {
        scheduledDate: new Date("2026-03-25T00:00:00.000Z"),
        selectionMode: "INTENT",
        sessionIntent: "UPPER",
        selectionMetadata: {},
      },
      sets: [
        {
          setIndex: 1,
          logs: [{ actualReps: 12, actualLoad: 35, actualRpe: 8, wasSkipped: false }],
        },
        {
          setIndex: 2,
          logs: [{ actualReps: 12, actualLoad: 35, actualRpe: 8, wasSkipped: false }],
        },
      ],
    });

    const result = await generateWorkoutExplanation("w1");
    expect("error" in result).toBe(false);
    if ("error" in result) return;

    const receipt = result.progressionReceipts.get("ex1");
    expect(receipt?.lastPerformed?.load).toBe(35);
    expect(receipt?.trigger).toBe("hold");
    expect(receipt?.decisionLog?.length).toBeGreaterThan(0);
  });

  it("does not label a cross-intent accessory estimate path as anchored when the generated trace is absent", async () => {
    mocks.workoutFindUnique.mockResolvedValueOnce({
      id: "w1",
      userId: "u1",
      scheduledDate: new Date("2026-03-28T00:00:00.000Z"),
      sessionIntent: "UPPER",
      selectionMetadata: buildGeneratedSelectionMetadata({
        isMainLift: false,
        section: "accessory",
        sessionIntent: "upper",
        exerciseName: "Chest-Supported Dumbbell Row",
      }),
      filteredExercises: [],
      exercises: [
        {
          exerciseId: "ex1",
          isMainLift: false,
          exercise: {
            id: "ex1",
            name: "Chest-Supported Dumbbell Row",
            movementPatterns: ["HORIZONTAL_PULL"],
            exerciseEquipment: [{ equipment: { type: "DUMBBELL" } }],
            exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Upper Back" } }],
          },
          sets: [
            {
              setIndex: 1,
              targetReps: 10,
              targetRepMin: 8,
              targetRepMax: 12,
              targetRpe: 8,
              targetLoad: 22.5,
              restSeconds: 120,
              logs: [],
            },
          ],
        },
      ],
    });
    mocks.workoutExerciseFindFirst.mockResolvedValueOnce({
      workout: {
        scheduledDate: new Date("2026-02-23T00:00:00.000Z"),
        selectionMode: "INTENT",
        sessionIntent: "PULL",
        selectionMetadata: {},
      },
      sets: [
        {
          setIndex: 1,
          logs: [{ actualReps: 10, actualLoad: 90, actualRpe: 8, wasSkipped: false }],
        },
      ],
    });

    const result = await generateWorkoutExplanation("w1");
    expect("error" in result).toBe(false);
    if ("error" in result) return;

    const receipt = result.progressionReceipts.get("ex1");
    expect(receipt?.lastPerformed).toBeNull();
    expect(receipt?.trigger).toBe("insufficient_data");
    expect(receipt?.decisionLog).toBeUndefined();
  });

  it("does not label a cold/default accessory as double progression just because older cross-intent history exists", async () => {
    mocks.workoutFindUnique.mockResolvedValueOnce({
      id: "w1",
      userId: "u1",
      scheduledDate: new Date("2026-03-28T00:00:00.000Z"),
      sessionIntent: "UPPER",
      selectionMetadata: buildGeneratedSelectionMetadata({
        isMainLift: false,
        section: "accessory",
        sessionIntent: "upper",
        exerciseName: "Machine Lateral Raise",
      }),
      filteredExercises: [],
      exercises: [
        {
          exerciseId: "ex1",
          isMainLift: false,
          exercise: {
            id: "ex1",
            name: "Machine Lateral Raise",
            movementPatterns: ["SHOULDER_ABDUCTION"],
            exerciseEquipment: [{ equipment: { type: "MACHINE" } }],
            exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Side Delts" } }],
          },
          sets: [
            {
              setIndex: 1,
              targetReps: 12,
              targetRepMin: 10,
              targetRepMax: 15,
              targetRpe: 8,
              targetLoad: 60,
              restSeconds: 90,
              logs: [],
            },
          ],
        },
      ],
    });
    mocks.workoutExerciseFindFirst.mockResolvedValueOnce({
      workout: {
        scheduledDate: new Date("2026-03-11T00:00:00.000Z"),
        selectionMode: "INTENT",
        sessionIntent: "PUSH",
        selectionMetadata: {},
      },
      sets: [
        {
          setIndex: 1,
          logs: [{ actualReps: 12, actualLoad: 40, actualRpe: 8, wasSkipped: false }],
        },
      ],
    });

    const result = await generateWorkoutExplanation("w1");
    expect("error" in result).toBe(false);
    if ("error" in result) return;

    const receipt = result.progressionReceipts.get("ex1");
    expect(receipt?.lastPerformed).toBeNull();
    expect(receipt?.trigger).toBe("insufficient_data");
  });

  it("keeps main-lift readout unchanged when a generated progression trace confirms the anchor", async () => {
    mocks.workoutFindUnique.mockResolvedValueOnce({
      id: "w1",
      userId: "u1",
      scheduledDate: new Date("2026-02-21T00:00:00.000Z"),
      sessionIntent: "PUSH",
      selectionMetadata: buildGeneratedSelectionMetadata({
        progressionTrace: {
          ex1: buildGeneratedProgressionTrace({
            anchorLoad: 200,
            nextLoad: 205,
            anchorSource: "working_set",
            action: "increase",
            path: "path_3",
          }),
        },
      }),
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
    mocks.workoutExerciseFindFirst.mockResolvedValueOnce({
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
    expect(receipt?.trigger).toBe("double_progression");
  });

  it("aligns nextExposureDecision to a canonical hold on the audited week-4 pull case", async () => {
    mocks.workoutFindUnique.mockResolvedValueOnce({
      id: "w1",
      userId: "u1",
      scheduledDate: new Date("2026-02-21T00:00:00.000Z"),
      sessionIntent: "PULL",
      selectionMetadata: {},
      filteredExercises: [],
      exercises: [
        {
          exerciseId: "ex1",
          isMainLift: false,
          exercise: {
            id: "ex1",
            name: "Lat Pulldown",
            movementPatterns: ["VERTICAL_PULL"],
            exerciseEquipment: [{ equipment: { type: "CABLE" } }],
            exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Lats" } }],
          },
          sets: [
            {
              setIndex: 1,
              targetReps: 10,
              targetRepMin: 8,
              targetRepMax: 12,
              targetRpe: 8,
              targetLoad: 40,
              restSeconds: 120,
              logs: [{ actualReps: 8, actualLoad: 40, actualRpe: 8, wasSkipped: false }],
            },
            {
              setIndex: 2,
              targetReps: 10,
              targetRepMin: 8,
              targetRepMax: 12,
              targetRpe: 8,
              targetLoad: 40,
              restSeconds: 120,
              logs: [{ actualReps: 8, actualLoad: 40, actualRpe: 8, wasSkipped: false }],
            },
          ],
        },
      ],
    });
    mocks.workoutExerciseFindFirst.mockResolvedValueOnce({
      workout: {
        scheduledDate: new Date("2026-02-18T00:00:00.000Z"),
        selectionMode: "INTENT",
        sessionIntent: "PULL",
        selectionMetadata: {},
      },
      sets: [
        {
          setIndex: 1,
          logs: [{ actualReps: 12, actualLoad: 35, actualRpe: 8, wasSkipped: false }],
        },
        {
          setIndex: 2,
          logs: [{ actualReps: 12, actualLoad: 35, actualRpe: 8, wasSkipped: false }],
        },
      ],
    });

    const result = await generateWorkoutExplanation("w1");
    expect("error" in result).toBe(false);
    if ("error" in result) return;

    const priorContext = result.progressionReceipts.get("ex1");
    const nextExposure = result.nextExposureDecisions.get("ex1");

    expect(priorContext?.trigger).toBe("double_progression");
    expect(nextExposure).toMatchObject({
      action: "hold",
      summary: "Next exposure: hold load.",
      anchorLoad: 40,
      medianReps: 8,
      modalRpe: 8,
    });
  });

  it("does not contradict a hold next-exposure summary even when prior-prescription context shows today's increment", async () => {
    mocks.workoutFindUnique.mockResolvedValueOnce({
      id: "w1",
      userId: "u1",
      scheduledDate: new Date("2026-02-21T00:00:00.000Z"),
      sessionIntent: "PULL",
      selectionMetadata: {},
      filteredExercises: [],
      exercises: [
        {
          exerciseId: "ex1",
          isMainLift: false,
          exercise: {
            id: "ex1",
            name: "Lat Pulldown",
            movementPatterns: ["VERTICAL_PULL"],
            exerciseEquipment: [{ equipment: { type: "CABLE" } }],
            exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Lats" } }],
          },
          sets: [
            {
              setIndex: 1,
              targetReps: 10,
              targetRepMin: 8,
              targetRepMax: 12,
              targetRpe: 8,
              targetLoad: 40,
              restSeconds: 120,
              logs: [{ actualReps: 9, actualLoad: 40, actualRpe: 8, wasSkipped: false }],
            },
          ],
        },
      ],
    });
    mocks.workoutExerciseFindFirst.mockResolvedValueOnce({
      workout: {
        scheduledDate: new Date("2026-02-18T00:00:00.000Z"),
        selectionMode: "INTENT",
        sessionIntent: "PULL",
        selectionMetadata: {},
      },
      sets: [
        {
          setIndex: 1,
          logs: [{ actualReps: 12, actualLoad: 35, actualRpe: 8, wasSkipped: false }],
        },
      ],
    });

    const result = await generateWorkoutExplanation("w1");
    expect("error" in result).toBe(false);
    if ("error" in result) return;

    expect(result.progressionReceipts.get("ex1")?.trigger).toBe("double_progression");
    expect(result.nextExposureDecisions.get("ex1")?.summary).toBe("Next exposure: hold load.");
    expect(result.nextExposureDecisions.get("ex1")?.reason).toContain("keep building reps before adding load");
  });

  it("holds nextExposureDecision when discounted MANUAL history collapses the canonical increment", async () => {
    const currentPerformedSets = [
      { setIndex: 1, actualReps: 12, actualLoad: 40, actualRpe: 7, wasSkipped: false },
      { setIndex: 2, actualReps: 12, actualLoad: 40, actualRpe: 7, wasSkipped: false },
      { setIndex: 3, actualReps: 12, actualLoad: 40, actualRpe: 7, wasSkipped: false },
    ];
    const performedSemantics = derivePerformedExerciseSemantics({
      isMainLiftEligible: false,
      sets: currentPerformedSets,
    });
    const progressionInput = buildCanonicalProgressionEvaluationInput({
      lastSets: performedSemantics?.signalSets ?? [],
      repRange: [8, 12],
      equipment: "cable",
      workingSetLoad: performedSemantics?.workingSetLoad ?? undefined,
      historySessions: [
        {
          selectionMode: "MANUAL",
          confidence: 0.3,
          confidenceNotes: [
            "MANUAL history was heavily discounted because it looked unreliable: every set reported the same RPE.",
          ],
        },
        {
          selectionMode: "MANUAL",
          confidence: 0.3,
          confidenceNotes: [
            "MANUAL history was heavily discounted because it looked unreliable: every set reported the same RPE.",
          ],
        },
        {
          selectionMode: "MANUAL",
          confidence: 0.3,
          confidenceNotes: [
            "MANUAL history was heavily discounted because it looked unreliable: every set reported the same RPE.",
          ],
        },
        {
          selectionMode: "INTENT",
          confidence: 1,
          confidenceNotes: ["Previous INTENT history kept full progression confidence."],
        },
      ],
    });
    const canonicalDecision = computeDoubleProgressionDecision(
      progressionInput.lastSets,
      progressionInput.repRange,
      progressionInput.equipment,
      progressionInput.decisionOptions
    );

    expect(progressionInput.context.priorSessionCount).toBe(4);
    expect(progressionInput.context.historyConfidenceScale).toBe(0.47);
    expect(canonicalDecision?.nextLoad).toBe(40);
    expect(canonicalDecision?.decisionLog.join(" | ")).toContain("Progression confidence scale=0.47");

    mocks.workoutFindUnique.mockResolvedValueOnce({
      id: "w1",
      userId: "u1",
      scheduledDate: new Date("2026-02-21T00:00:00.000Z"),
      selectionMode: "MANUAL",
      sessionIntent: "PULL",
      selectionMetadata: {},
      filteredExercises: [],
      exercises: [
        {
          exerciseId: "ex1",
          isMainLift: false,
          exercise: {
            id: "ex1",
            name: "Lat Pulldown",
            movementPatterns: ["VERTICAL_PULL"],
            exerciseEquipment: [{ equipment: { type: "CABLE" } }],
            exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Lats" } }],
          },
          sets: currentPerformedSets.map((set) => ({
            setIndex: set.setIndex,
            targetReps: 10,
            targetRepMin: 8,
            targetRepMax: 12,
            targetRpe: 8,
            targetLoad: 40,
            restSeconds: 120,
            logs: [
              {
                actualReps: set.actualReps,
                actualLoad: set.actualLoad,
                actualRpe: set.actualRpe,
                wasSkipped: set.wasSkipped,
              },
            ],
          })),
        },
      ],
    });

    const historyEntries = [
      {
        workout: {
          scheduledDate: new Date("2026-02-18T00:00:00.000Z"),
          selectionMode: "MANUAL",
          sessionIntent: "PULL",
          selectionMetadata: {},
        },
        sets: [
          {
            setIndex: 1,
            logs: [{ actualReps: 12, actualLoad: 40, actualRpe: 7, wasSkipped: false }],
          },
          {
            setIndex: 2,
            logs: [{ actualReps: 12, actualLoad: 40, actualRpe: 7, wasSkipped: false }],
          },
        ],
      },
      {
        workout: {
          scheduledDate: new Date("2026-02-14T00:00:00.000Z"),
          selectionMode: "MANUAL",
          sessionIntent: "PULL",
          selectionMetadata: {},
        },
        sets: [
          {
            setIndex: 1,
            logs: [{ actualReps: 12, actualLoad: 40, actualRpe: 7, wasSkipped: false }],
          },
          {
            setIndex: 2,
            logs: [{ actualReps: 12, actualLoad: 40, actualRpe: 7, wasSkipped: false }],
          },
        ],
      },
      {
        workout: {
          scheduledDate: new Date("2026-02-10T00:00:00.000Z"),
          selectionMode: "INTENT",
          sessionIntent: "PULL",
          selectionMetadata: {},
        },
        sets: [
          {
            setIndex: 1,
            logs: [{ actualReps: 12, actualLoad: 40, actualRpe: 7, wasSkipped: false }],
          },
          {
            setIndex: 2,
            logs: [{ actualReps: 12, actualLoad: 40, actualRpe: 7, wasSkipped: false }],
          },
        ],
      },
    ];

    mocks.workoutExerciseFindFirst.mockImplementation(async (args: {
      where?: { workout?: { scheduledDate?: { lt?: Date }; selectionMode?: string } };
    }) => {
      const scheduledBefore = args.where?.workout?.scheduledDate?.lt;
      const requiredSelectionMode = args.where?.workout?.selectionMode;
      return (
        historyEntries.find((entry) => {
          if (
            requiredSelectionMode &&
            entry.workout.selectionMode !== requiredSelectionMode
          ) {
            return false;
          }
          if (scheduledBefore) {
            return entry.workout.scheduledDate.getTime() < scheduledBefore.getTime();
          }
          return true;
        }) ?? null
      );
    });

    const result = await generateWorkoutExplanation("w1");
    expect("error" in result).toBe(false);
    if ("error" in result) return;

    expect(result.nextExposureDecisions.get("ex1")).toMatchObject({
      action: "hold",
      summary: "Next exposure: hold load.",
      anchorLoad: 40,
      medianReps: 12,
      modalRpe: 7,
    });
  });

  it("keeps nextExposureDecision aligned with a standard non-discounted increment", async () => {
    const currentPerformedSets = [
      { setIndex: 1, actualReps: 12, actualLoad: 40, actualRpe: 7, wasSkipped: false },
      { setIndex: 2, actualReps: 12, actualLoad: 40, actualRpe: 7, wasSkipped: false },
    ];
    const performedSemantics = derivePerformedExerciseSemantics({
      isMainLiftEligible: false,
      sets: currentPerformedSets,
    });
    const canonicalDecision = computeDoubleProgressionDecision(
      performedSemantics?.signalSets ?? [],
      [8, 12],
      "cable",
      {
        workingSetLoad: performedSemantics?.workingSetLoad ?? undefined,
        priorSessionCount: 2,
        historyConfidenceScale: 1,
      }
    );

    expect(canonicalDecision?.nextLoad).toBe(42.5);

    mocks.workoutFindUnique.mockResolvedValueOnce({
      id: "w1",
      userId: "u1",
      scheduledDate: new Date("2026-02-21T00:00:00.000Z"),
      selectionMode: "INTENT",
      sessionIntent: "PULL",
      selectionMetadata: {},
      filteredExercises: [],
      exercises: [
        {
          exerciseId: "ex1",
          isMainLift: false,
          exercise: {
            id: "ex1",
            name: "Lat Pulldown",
            movementPatterns: ["VERTICAL_PULL"],
            exerciseEquipment: [{ equipment: { type: "CABLE" } }],
            exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Lats" } }],
          },
          sets: currentPerformedSets.map((set) => ({
            setIndex: set.setIndex,
            targetReps: 10,
            targetRepMin: 8,
            targetRepMax: 12,
            targetRpe: 8,
            targetLoad: 40,
            restSeconds: 120,
            logs: [
              {
                actualReps: set.actualReps,
                actualLoad: set.actualLoad,
                actualRpe: set.actualRpe,
                wasSkipped: set.wasSkipped,
              },
            ],
          })),
        },
      ],
    });
    mocks.workoutExerciseFindFirst.mockImplementation(async (args: {
      where?: { workout?: { scheduledDate?: { lt?: Date }; selectionMode?: string } };
    }) => {
      const scheduledBefore = args.where?.workout?.scheduledDate?.lt;
      const requiredSelectionMode = args.where?.workout?.selectionMode;
      const priorIntent = {
        workout: {
          scheduledDate: new Date("2026-02-18T00:00:00.000Z"),
          selectionMode: "INTENT",
          sessionIntent: "PULL",
          selectionMetadata: {},
        },
        sets: [
          {
            setIndex: 1,
            logs: [{ actualReps: 11, actualLoad: 40, actualRpe: 7.5, wasSkipped: false }],
          },
          {
            setIndex: 2,
            logs: [{ actualReps: 11, actualLoad: 40, actualRpe: 7.5, wasSkipped: false }],
          },
        ],
      };
      if (requiredSelectionMode && requiredSelectionMode !== "INTENT") {
        return null;
      }
      if (scheduledBefore && priorIntent.workout.scheduledDate.getTime() >= scheduledBefore.getTime()) {
        return null;
      }
      return priorIntent;
    });

    const result = await generateWorkoutExplanation("w1");
    expect("error" in result).toBe(false);
    if ("error" in result) return;

    expect(result.nextExposureDecisions.get("ex1")).toMatchObject({
      action: "increase",
      summary: "Next exposure: increase load.",
      anchorLoad: 40,
      medianReps: 12,
      modalRpe: 7,
    });
  });

  it("explains earned next-exposure increases when performed load materially beats prescription", async () => {
    mocks.workoutFindUnique.mockResolvedValueOnce({
      id: "w1",
      userId: "u1",
      scheduledDate: new Date("2026-02-21T00:00:00.000Z"),
      selectionMode: "INTENT",
      sessionIntent: "LEGS",
      selectionMetadata: {},
      filteredExercises: [],
      exercises: [
        {
          exerciseId: "ex1",
          isMainLift: true,
          exercise: {
            id: "ex1",
            name: "Back Squat",
            movementPatterns: ["SQUAT"],
            exerciseEquipment: [{ equipment: { type: "BARBELL" } }],
            exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Quads" } }],
          },
          sets: [
            {
              setIndex: 1,
              targetReps: 8,
              targetRepMin: 6,
              targetRepMax: 10,
              targetRpe: 8,
              targetLoad: 135,
              restSeconds: 150,
              logs: [{ actualReps: 8, actualLoad: 145, actualRpe: 7.5, wasSkipped: false }],
            },
            {
              setIndex: 2,
              targetReps: 8,
              targetRepMin: 6,
              targetRepMax: 10,
              targetRpe: 8,
              targetLoad: 135,
              restSeconds: 150,
              logs: [{ actualReps: 8, actualLoad: 145, actualRpe: 8, wasSkipped: false }],
            },
            {
              setIndex: 3,
              targetReps: 8,
              targetRepMin: 6,
              targetRepMax: 10,
              targetRpe: 8,
              targetLoad: 135,
              restSeconds: 150,
              logs: [{ actualReps: 7, actualLoad: 140, actualRpe: 8, wasSkipped: false }],
            },
          ],
        },
      ],
    });
    mocks.workoutExerciseFindFirst.mockImplementation(async (args: {
      where?: { workout?: { scheduledDate?: { lt?: Date }; selectionMode?: string } };
    }) => {
      const scheduledBefore = args.where?.workout?.scheduledDate?.lt;
      const requiredSelectionMode = args.where?.workout?.selectionMode;
      const priorIntent = {
        workout: {
          scheduledDate: new Date("2026-02-18T00:00:00.000Z"),
          selectionMode: "INTENT",
          sessionIntent: "LEGS",
          selectionMetadata: {},
        },
        sets: [
          {
            setIndex: 1,
            logs: [{ actualReps: 8, actualLoad: 135, actualRpe: 8, wasSkipped: false }],
          },
          {
            setIndex: 2,
            logs: [{ actualReps: 8, actualLoad: 135, actualRpe: 8, wasSkipped: false }],
          },
        ],
      };
      if (requiredSelectionMode && requiredSelectionMode !== "INTENT") {
        return null;
      }
      if (scheduledBefore && priorIntent.workout.scheduledDate.getTime() >= scheduledBefore.getTime()) {
        return null;
      }
      return priorIntent;
    });

    const result = await generateWorkoutExplanation("w1");
    expect("error" in result).toBe(false);
    if ("error" in result) return;

    expect(result.nextExposureDecisions.get("ex1")).toMatchObject({
      action: "increase",
      anchorLoad: 145,
    });
    expect(result.nextExposureDecisions.get("ex1")?.reason).toContain("beat the written load");
    expect(result.nextExposureDecisions.get("ex1")?.decisionLog?.join(" | ")).toContain(
      "Path 5 fired"
    );
  });

  it("surfaces the bounded catch-up lane when same-exercise overshoot shows clear under-translation", async () => {
    mocks.workoutFindUnique.mockResolvedValueOnce({
      id: "w1",
      userId: "u1",
      scheduledDate: new Date("2026-02-21T00:00:00.000Z"),
      selectionMode: "INTENT",
      sessionIntent: "LEGS",
      selectionMetadata: {},
      filteredExercises: [],
      exercises: [
        {
          exerciseId: "ex1",
          isMainLift: true,
          exercise: {
            id: "ex1",
            name: "Back Squat",
            movementPatterns: ["SQUAT"],
            exerciseEquipment: [{ equipment: { type: "BARBELL" } }],
            exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Quads" } }],
          },
          sets: [
            {
              setIndex: 1,
              targetReps: 8,
              targetRepMin: 6,
              targetRepMax: 10,
              targetRpe: 8,
              targetLoad: 145,
              restSeconds: 150,
              logs: [{ actualReps: 8, actualLoad: 155, actualRpe: 7.5, wasSkipped: false }],
            },
            {
              setIndex: 2,
              targetReps: 8,
              targetRepMin: 6,
              targetRepMax: 10,
              targetRpe: 8,
              targetLoad: 145,
              restSeconds: 150,
              logs: [{ actualReps: 8, actualLoad: 155, actualRpe: 7.5, wasSkipped: false }],
            },
            {
              setIndex: 3,
              targetReps: 8,
              targetRepMin: 6,
              targetRepMax: 10,
              targetRpe: 8,
              targetLoad: 145,
              restSeconds: 150,
              logs: [{ actualReps: 7, actualLoad: 155, actualRpe: 8, wasSkipped: false }],
            },
            {
              setIndex: 4,
              targetReps: 8,
              targetRepMin: 6,
              targetRepMax: 10,
              targetRpe: 8,
              targetLoad: 145,
              restSeconds: 150,
              logs: [{ actualReps: 7, actualLoad: 155, actualRpe: 8, wasSkipped: false }],
            },
          ],
        },
      ],
    });
    mocks.workoutExerciseFindFirst.mockImplementation(async (args: {
      where?: { workout?: { scheduledDate?: { lt?: Date }; selectionMode?: string } };
    }) => {
      const scheduledBefore = args.where?.workout?.scheduledDate?.lt;
      const requiredSelectionMode = args.where?.workout?.selectionMode;
      const priorIntent = {
        workout: {
          scheduledDate: new Date("2026-02-18T00:00:00.000Z"),
          selectionMode: "INTENT",
          sessionIntent: "LEGS",
          selectionMetadata: {},
        },
        sets: [
          {
            setIndex: 1,
            targetLoad: 145,
            logs: [{ actualReps: 8, actualLoad: 145, actualRpe: 8, wasSkipped: false }],
          },
          {
            setIndex: 2,
            targetLoad: 145,
            logs: [{ actualReps: 8, actualLoad: 145, actualRpe: 8, wasSkipped: false }],
          },
        ],
      };
      if (requiredSelectionMode && requiredSelectionMode !== "INTENT") {
        return null;
      }
      if (scheduledBefore && priorIntent.workout.scheduledDate.getTime() >= scheduledBefore.getTime()) {
        return null;
      }
      return priorIntent;
    });

    const result = await generateWorkoutExplanation("w1");
    expect("error" in result).toBe(false);
    if ("error" in result) return;

    expect(result.nextExposureDecisions.get("ex1")).toMatchObject({
      action: "increase",
      anchorLoad: 155,
    });
    expect(result.nextExposureDecisions.get("ex1")?.decisionLog?.join(" | ")).toContain(
      "Catch-up lane fired"
    );
  });

  it("explains why 8.5-RPE overshoot still holds when set coverage is not strong enough", async () => {
    mocks.workoutFindUnique.mockResolvedValueOnce({
      id: "w1",
      userId: "u1",
      scheduledDate: new Date("2026-02-21T00:00:00.000Z"),
      selectionMode: "INTENT",
      sessionIntent: "LEGS",
      selectionMetadata: {},
      filteredExercises: [],
      exercises: [
        {
          exerciseId: "ex1",
          isMainLift: true,
          exercise: {
            id: "ex1",
            name: "Back Squat",
            movementPatterns: ["SQUAT"],
            exerciseEquipment: [{ equipment: { type: "BARBELL" } }],
            exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Quads" } }],
          },
          sets: [
            {
              setIndex: 1,
              targetReps: 8,
              targetRepMin: 6,
              targetRepMax: 10,
              targetRpe: 8,
              targetLoad: 135,
              restSeconds: 150,
              logs: [{ actualReps: 6, actualLoad: 145, actualRpe: 8.5, wasSkipped: false }],
            },
            {
              setIndex: 2,
              targetReps: 8,
              targetRepMin: 6,
              targetRepMax: 10,
              targetRpe: 8,
              targetLoad: 135,
              restSeconds: 150,
              logs: [{ actualReps: 7, actualLoad: 145, actualRpe: 8.5, wasSkipped: false }],
            },
            {
              setIndex: 3,
              targetReps: 8,
              targetRepMin: 6,
              targetRepMax: 10,
              targetRpe: 8,
              targetLoad: 120,
              restSeconds: 150,
              logs: [{ actualReps: 7, actualLoad: 135, actualRpe: 8.5, wasSkipped: false }],
            },
            {
              setIndex: 4,
              targetReps: 8,
              targetRepMin: 6,
              targetRepMax: 10,
              targetRpe: 8,
              targetLoad: 120,
              restSeconds: 150,
              logs: [{ actualReps: 7, actualLoad: 120, actualRpe: 8.5, wasSkipped: false }],
            },
            {
              setIndex: 5,
              targetReps: 8,
              targetRepMin: 6,
              targetRepMax: 10,
              targetRpe: 8,
              targetLoad: 120,
              restSeconds: 150,
              logs: [{ actualReps: 7, actualLoad: 120, actualRpe: 8.5, wasSkipped: false }],
            },
          ],
        },
      ],
    });
    mocks.workoutExerciseFindFirst.mockImplementation(async (args: {
      where?: { workout?: { scheduledDate?: { lt?: Date }; selectionMode?: string } };
    }) => {
      const scheduledBefore = args.where?.workout?.scheduledDate?.lt;
      const requiredSelectionMode = args.where?.workout?.selectionMode;
      const priorIntent = {
        workout: {
          scheduledDate: new Date("2026-02-18T00:00:00.000Z"),
          selectionMode: "INTENT",
          sessionIntent: "LEGS",
          selectionMetadata: {},
        },
        sets: [
          {
            setIndex: 1,
            targetLoad: 135,
            logs: [{ actualReps: 8, actualLoad: 135, actualRpe: 8, wasSkipped: false }],
          },
          {
            setIndex: 2,
            targetLoad: 120,
            logs: [{ actualReps: 8, actualLoad: 120, actualRpe: 8, wasSkipped: false }],
          },
        ],
      };
      if (requiredSelectionMode && requiredSelectionMode !== "INTENT") {
        return null;
      }
      if (scheduledBefore && priorIntent.workout.scheduledDate.getTime() >= scheduledBefore.getTime()) {
        return null;
      }
      return priorIntent;
    });

    const result = await generateWorkoutExplanation("w1");
    expect("error" in result).toBe(false);
    if ("error" in result) return;

    expect(result.nextExposureDecisions.get("ex1")).toMatchObject({
      action: "hold",
      anchorLoad: 145,
      modalRpe: 8.5,
    });
    expect(result.nextExposureDecisions.get("ex1")?.reason).toContain(
      "3/5 target-bearing sets beat prescription, but 4 were required"
    );
    expect(result.nextExposureDecisions.get("ex1")?.decisionLog?.join(" | ")).toContain(
      "Overshoot gate:"
    );
  });

  it("keeps anchor-sensitive main-lift decisions aligned to the representative working set", async () => {
    const currentPerformedSets = [
      { setIndex: 1, actualReps: 12, actualLoad: 45, actualRpe: 7, wasSkipped: false },
      { setIndex: 2, actualReps: 12, actualLoad: 40, actualRpe: 7, wasSkipped: false },
      { setIndex: 3, actualReps: 12, actualLoad: 40, actualRpe: 7, wasSkipped: false },
    ];
    const performedSemantics = derivePerformedExerciseSemantics({
      isMainLiftEligible: true,
      sets: currentPerformedSets,
    });
    const canonicalDecision = computeDoubleProgressionDecision(
      performedSemantics?.signalSets ?? [],
      [8, 12],
      "barbell",
      {
        workingSetLoad: performedSemantics?.workingSetLoad ?? undefined,
        priorSessionCount: 2,
        historyConfidenceScale: 1,
      }
    );

    expect(canonicalDecision?.anchorLoad).toBe(45);
    expect(canonicalDecision?.nextLoad).toBeGreaterThan(45);

    mocks.workoutFindUnique.mockResolvedValueOnce({
      id: "w1",
      userId: "u1",
      scheduledDate: new Date("2026-02-21T00:00:00.000Z"),
      selectionMode: "INTENT",
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
          sets: currentPerformedSets.map((set) => ({
            setIndex: set.setIndex,
            targetReps: 10,
            targetRepMin: 8,
            targetRepMax: 12,
            targetRpe: 8,
            targetLoad: set.actualLoad,
            restSeconds: 150,
            logs: [
              {
                actualReps: set.actualReps,
                actualLoad: set.actualLoad,
                actualRpe: set.actualRpe,
                wasSkipped: set.wasSkipped,
              },
            ],
          })),
        },
      ],
    });
    mocks.workoutExerciseFindFirst.mockImplementation(async (args: {
      where?: { workout?: { scheduledDate?: { lt?: Date }; selectionMode?: string } };
    }) => {
      const scheduledBefore = args.where?.workout?.scheduledDate?.lt;
      const requiredSelectionMode = args.where?.workout?.selectionMode;
      const priorIntent = {
        workout: {
          scheduledDate: new Date("2026-02-18T00:00:00.000Z"),
          selectionMode: "INTENT",
          sessionIntent: "PUSH",
          selectionMetadata: {},
        },
        sets: [
          {
            setIndex: 1,
            logs: [{ actualReps: 11, actualLoad: 45, actualRpe: 7.5, wasSkipped: false }],
          },
          {
            setIndex: 2,
            logs: [{ actualReps: 11, actualLoad: 40, actualRpe: 7.5, wasSkipped: false }],
          },
          {
            setIndex: 3,
            logs: [{ actualReps: 11, actualLoad: 40, actualRpe: 7.5, wasSkipped: false }],
          },
        ],
      };
      if (requiredSelectionMode && requiredSelectionMode !== "INTENT") {
        return null;
      }
      if (scheduledBefore && priorIntent.workout.scheduledDate.getTime() >= scheduledBefore.getTime()) {
        return null;
      }
      return priorIntent;
    });

    const result = await generateWorkoutExplanation("w1");
    expect("error" in result).toBe(false);
    if ("error" in result) return;

    expect(result.progressionReceipts.get("ex1")?.decisionLog?.join(" | ")).toContain(
      "Anchor load=45"
    );
    expect(result.nextExposureDecisions.get("ex1")).toMatchObject({
      action: "increase",
      summary: "Next exposure: increase load.",
      anchorLoad: 45,
      medianReps: 12,
      modalRpe: 7,
    });
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

  it("excludes scheduled deload sessions from progression-facing explainability and falls back to accumulation history", async () => {
    mocks.workoutExerciseFindFirst
      .mockResolvedValueOnce({
        workout: {
          scheduledDate: new Date("2026-02-20T00:00:00.000Z"),
          selectionMode: "INTENT",
          sessionIntent: "PUSH",
          mesocyclePhaseSnapshot: "DELOAD",
          selectionMetadata: {
            sessionDecisionReceipt: {
              version: 1,
              cycleContext: {
                weekInMeso: 5,
                weekInBlock: 1,
                phase: "deload",
                blockType: "deload",
                isDeload: true,
                source: "computed",
              },
              lifecycleVolume: { source: "unknown" },
              sorenessSuppressedMuscles: [],
              deloadDecision: {
                mode: "scheduled",
                reason: ["Scheduled deload week."],
                reductionPercent: 50,
                appliedTo: "volume",
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
              exceptions: [],
            },
          },
        },
        sets: [
          {
            setIndex: 1,
            logs: [{ actualReps: 8, actualLoad: 155, actualRpe: 5, wasSkipped: false }],
          },
        ],
      })
      .mockResolvedValueOnce({
        workout: {
          scheduledDate: new Date("2026-02-18T00:00:00.000Z"),
          selectionMode: "INTENT",
          sessionIntent: "PUSH",
          mesocyclePhaseSnapshot: "ACCUMULATION",
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
    expect(receipt?.lastPerformed?.load).not.toBe(155);
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
