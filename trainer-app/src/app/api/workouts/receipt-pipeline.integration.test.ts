import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildSessionDecisionReceipt } from "@/lib/evidence/session-decision-receipt";
import { attachSupplementalSessionMetadata } from "@/lib/ui/selection-metadata";

const state = vi.hoisted(() => ({
  persistedSelectionMetadata: null as Record<string, unknown> | null,
}));

const mocks = vi.hoisted(() => {
  const resolveOwner = vi.fn();
  const loadActiveMesocycle = vi.fn();
  const generateSessionFromIntent = vi.fn();
  const generateDeloadSessionFromIntent = vi.fn();
  const applyAutoregulation = vi.fn();
  const loadCurrentBlockContext = vi.fn();
  const workoutFindUnique = vi.fn();
  const workoutFindMany = vi.fn();
  const constraintsFindUnique = vi.fn();
  const readinessFindMany = vi.fn();
  const exerciseFindMany = vi.fn();
  const setLogAggregate = vi.fn();
  const workoutExerciseFindFirst = vi.fn();
  const workoutExerciseFindMany = vi.fn();
  const mesocycleFindFirst = vi.fn();
  const txWorkoutFindUnique = vi.fn();
  const txWorkoutUpsert = vi.fn();
  const txWorkoutExerciseFindMany = vi.fn();
  const txWorkoutExerciseCreate = vi.fn();
  const txExerciseFindUnique = vi.fn();
  const getCurrentMesoWeek = vi.fn();
  const transitionMesocycleStateInTransaction = vi.fn();

  const tx = {
    workout: {
      findUnique: txWorkoutFindUnique,
      upsert: txWorkoutUpsert,
    },
    workoutTemplate: {
      findFirst: vi.fn(),
    },
    mesocycle: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    workoutExercise: {
      findMany: txWorkoutExerciseFindMany,
      deleteMany: vi.fn(),
      create: txWorkoutExerciseCreate,
    },
    workoutSet: {
      deleteMany: vi.fn(),
    },
    exercise: {
      findUnique: txExerciseFindUnique,
    },
    filteredExercise: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    mesocycleWeekClose: {
      findFirst: vi.fn(),
      upsert: vi.fn(),
    },
  };

  const prisma = {
    $transaction: vi.fn(async (callback: (trx: typeof tx) => Promise<void>) => callback(tx)),
    workout: {
      findUnique: (...args: unknown[]) => workoutFindUnique(...args),
      findMany: (...args: unknown[]) => workoutFindMany(...args),
    },
    constraints: {
      findUnique: (...args: unknown[]) => constraintsFindUnique(...args),
    },
    readinessSignal: {
      findMany: (...args: unknown[]) => readinessFindMany(...args),
    },
    exercise: {
      findMany: (...args: unknown[]) => exerciseFindMany(...args),
    },
    setLog: {
      aggregate: (...args: unknown[]) => setLogAggregate(...args),
    },
    workoutExercise: {
      findFirst: (...args: unknown[]) => workoutExerciseFindFirst(...args),
      findMany: (...args: unknown[]) => workoutExerciseFindMany(...args),
    },
    mesocycle: {
      findFirst: (...args: unknown[]) => mesocycleFindFirst(...args),
      findUnique: vi.fn(),
    },
  };

  return {
    resolveOwner,
    loadActiveMesocycle,
    generateSessionFromIntent,
    generateDeloadSessionFromIntent,
    applyAutoregulation,
    loadCurrentBlockContext,
    workoutFindUnique,
    workoutFindMany,
    constraintsFindUnique,
    readinessFindMany,
    exerciseFindMany,
    setLogAggregate,
    workoutExerciseFindFirst,
    workoutExerciseFindMany,
    mesocycleFindFirst,
    txWorkoutFindUnique,
    txWorkoutUpsert,
    txWorkoutExerciseFindMany,
    txWorkoutExerciseCreate,
    txExerciseFindUnique,
    getCurrentMesoWeek,
    transitionMesocycleStateInTransaction,
    tx,
    prisma,
  };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/lib/api/workout-context", () => ({
  resolveOwner: (...args: unknown[]) => mocks.resolveOwner(...args),
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

vi.mock("@/lib/api/mesocycle-lifecycle", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/mesocycle-lifecycle")>();
  return {
    ...actual,
    loadActiveMesocycle: (...args: unknown[]) => mocks.loadActiveMesocycle(...args),
    getCurrentMesoWeek: (...args: unknown[]) => mocks.getCurrentMesoWeek(...args),
  };
});

vi.mock("@/lib/api/mesocycle-lifecycle-state", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/mesocycle-lifecycle-state")>();
  return {
    ...actual,
    transitionMesocycleStateInTransaction: (...args: unknown[]) => mocks.transitionMesocycleStateInTransaction(...args),
  };
});

vi.mock("@/lib/api/template-session", () => ({
  generateSessionFromIntent: (...args: unknown[]) => mocks.generateSessionFromIntent(...args),
  generateDeloadSessionFromIntent: (...args: unknown[]) =>
    mocks.generateDeloadSessionFromIntent(...args),
}));

vi.mock("@/lib/api/autoregulation", () => ({
  applyAutoregulation: (...args: unknown[]) => mocks.applyAutoregulation(...args),
}));

vi.mock("@/lib/api/exercise-exposure", () => ({
  updateExerciseExposure: vi.fn(async () => undefined),
}));

vi.mock("@/lib/api/periodization", () => ({
  loadCurrentBlockContext: (...args: unknown[]) => mocks.loadCurrentBlockContext(...args),
}));

vi.mock("@/lib/engine/explainability", () => ({
  explainSessionContext: () => ({
    blockPhase: { blockType: "accumulation", weekInBlock: 2, totalWeeksInBlock: 4, primaryGoal: "build" },
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
      weekInMesocycle: 2,
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

import { POST as generateFromIntent } from "./generate-from-intent/route";
import { POST as saveWorkout } from "./save/route";
import { generateWorkoutExplanation } from "@/lib/api/explainability";

describe("canonical session decision receipt pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.persistedSelectionMetadata = null;

    const initialReceipt = buildSessionDecisionReceipt({
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
      lifecycleVolumeTargets: { Chest: 12 },
      sorenessSuppressedMuscles: [],
      deloadDecision: {
        mode: "none",
        reason: [],
        reductionPercent: 0,
        appliedTo: "none",
      },
    });

    mocks.resolveOwner.mockResolvedValue({ id: "user-1" });
    mocks.loadActiveMesocycle.mockResolvedValue(null);
    mocks.generateDeloadSessionFromIntent.mockResolvedValue({ error: "unexpected" });
    mocks.generateSessionFromIntent.mockResolvedValue({
      workout: {
        id: "workout-1",
        scheduledDate: new Date("2026-03-03T00:00:00.000Z").toISOString(),
        warmup: [],
        mainLifts: [
          {
            id: "we-1",
            orderIndex: 0,
            isMainLift: true,
            exercise: { id: "ex1", name: "Bench Press", equipment: ["barbell"] },
            sets: [{ setIndex: 1, targetReps: 8, targetLoad: 205, targetRpe: 8 }],
          },
        ],
        accessories: [],
        estimatedMinutes: 45,
      },
      selectionMode: "INTENT",
      sessionIntent: "push",
      sraWarnings: [],
      substitutions: [],
      volumePlanByMuscle: { Chest: 3 },
      selection: {
        selectedExerciseIds: ["ex1"],
        perExerciseSetTargets: { ex1: 3 },
        rationale: {
          ex1: {
            score: 0.9,
            components: { pinned: 1 },
            hardFilterPass: true,
            selectedStep: "pin",
          },
        },
        cycleContext: initialReceipt.cycleContext,
        sessionDecisionReceipt: initialReceipt,
      },
      filteredExercises: [],
    });
    mocks.applyAutoregulation.mockImplementation(async (_userId, workout) => ({
      original: workout,
      adjusted: workout,
      modifications: [
        {
          type: "intensity_scale",
          exerciseId: "ex1",
          direction: "down",
          reason: "Fatigue score elevated",
        },
      ],
      fatigueScore: { overall: 0.44 },
      rationale: "Scaled pressing work from recent readiness.",
      wasAutoregulated: true,
      applied: true,
      reason: "Scaled pressing work from recent readiness.",
      signalAgeHours: 6,
    }));
    mocks.loadCurrentBlockContext.mockResolvedValue({
      blockContext: null,
      weekInMeso: 1,
    });
    mocks.txWorkoutFindUnique.mockResolvedValue(null);
    mocks.txWorkoutExerciseFindMany.mockResolvedValue([]);
    mocks.txExerciseFindUnique.mockResolvedValue({ movementPatterns: [] });
    mocks.txWorkoutExerciseCreate.mockResolvedValue({ id: "we-1" });
    mocks.txWorkoutUpsert.mockImplementation(async (args: { create: { selectionMetadata: Record<string, unknown> } }) => {
      state.persistedSelectionMetadata = args.create.selectionMetadata;
      return { id: "workout-1", revision: 1 };
    });
    mocks.getCurrentMesoWeek.mockReturnValue(1);
    mocks.transitionMesocycleStateInTransaction.mockResolvedValue({
      mesocycle: { id: "meso-1", state: "ACTIVE_ACCUMULATION" },
      advanced: false,
    });

    mocks.workoutFindUnique.mockImplementation(async () => ({
      id: "workout-1",
      userId: "user-1",
      scheduledDate: new Date("2026-03-03T00:00:00.000Z"),
      sessionIntent: "PUSH",
      selectionMetadata: state.persistedSelectionMetadata ?? {},
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
    }));
    mocks.workoutFindMany.mockResolvedValue([]);
    mocks.constraintsFindUnique.mockResolvedValue(null);
    mocks.mesocycleFindFirst.mockResolvedValue(null);
    mocks.readinessFindMany.mockResolvedValue([]);
    mocks.exerciseFindMany.mockResolvedValue([]);
    mocks.setLogAggregate.mockResolvedValue({ _max: { actualLoad: null, actualReps: null } });
    mocks.workoutExerciseFindFirst.mockResolvedValue(null);
    mocks.workoutExerciseFindMany.mockResolvedValue([]);
  });

  it("keeps the receipt canonical across generate, save, and explainability", async () => {
    const generateResponse = await generateFromIntent(
      new Request("http://localhost/api/workouts/generate-from-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "push" }),
      })
    );
    expect(generateResponse.status).toBe(200);

    const generatedBody = await generateResponse.json();
    const generatedSelectionMetadata = generatedBody.selectionMetadata as Record<string, unknown>;
    const generatedReceipt = generatedSelectionMetadata.sessionDecisionReceipt as Record<string, unknown>;
    const generatedReadiness = generatedReceipt.readiness as Record<string, unknown>;
    const generatedIntensityScaling = generatedReadiness.intensityScaling as Record<string, unknown>;

    expect(generatedSelectionMetadata.cycleContext).toBeUndefined();
    expect(generatedReceipt.version).toBe(1);
    expect((generatedReceipt.cycleContext as Record<string, unknown>).weekInMeso).toBe(2);
    expect(generatedReadiness.wasAutoregulated).toBe(true);
    expect(generatedIntensityScaling.exerciseIds).toEqual(["ex1"]);

    const saveResponse = await saveWorkout(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          selectionMode: "INTENT",
          sessionIntent: "PUSH",
          selectionMetadata: generatedSelectionMetadata,
          exercises: [
            {
              section: "MAIN",
              exerciseId: "ex1",
              sets: [{ setIndex: 1, targetReps: 8, targetLoad: 205, targetRpe: 8 }],
            },
          ],
        }),
      })
    );
    expect(saveResponse.status).toBe(200);

    const persistedSelectionMetadata = state.persistedSelectionMetadata ?? {};
    const persistedReceipt = persistedSelectionMetadata.sessionDecisionReceipt as Record<string, unknown>;
    expect(persistedSelectionMetadata.cycleContext).toBeUndefined();
    expect((persistedReceipt.cycleContext as Record<string, unknown>).weekInMeso).toBe(2);
    expect(((persistedReceipt.readiness as Record<string, unknown>).intensityScaling as Record<string, unknown>).exerciseIds).toEqual(["ex1"]);

    const explanation = await generateWorkoutExplanation("workout-1");
    expect("error" in explanation).toBe(false);
    if ("error" in explanation) {
      return;
    }

    expect(explanation.confidence.missingSignals).not.toContain("receipt-backed cycle context");
  });

  it("keeps the supplemental deficit marker canonical across save and resave", async () => {
    const generatedSelectionMetadata = attachSupplementalSessionMetadata(
      {
        selectedExerciseIds: ["ex1"],
        sessionDecisionReceipt: buildSessionDecisionReceipt({
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
          lifecycleVolumeTargets: { Chest: 12 },
          sorenessSuppressedMuscles: [],
          deloadDecision: {
            mode: "none",
            reason: [],
            reductionPercent: 0,
            appliedTo: "none",
          },
        }),
      },
      {
        enabled: true,
        targetMuscles: ["Chest"],
        anchorWeek: 2,
      }
    );

    const firstSave = await saveWorkout(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          selectionMode: "INTENT",
          sessionIntent: "BODY_PART",
          selectionMetadata: generatedSelectionMetadata,
          exercises: [
            {
              section: "MAIN",
              exerciseId: "ex1",
              sets: [{ setIndex: 1, targetReps: 8, targetLoad: 205, targetRpe: 8 }],
            },
          ],
        }),
      })
    );
    expect(firstSave.status).toBe(200);

    const resave = await saveWorkout(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          selectionMode: "INTENT",
          sessionIntent: "BODY_PART",
          selectionMetadata: state.persistedSelectionMetadata,
          exercises: [
            {
              section: "MAIN",
              exerciseId: "ex1",
              sets: [{ setIndex: 1, targetReps: 8, targetLoad: 205, targetRpe: 8 }],
            },
          ],
        }),
      })
    );
    expect(resave.status).toBe(200);

    const persistedSelectionMetadata = state.persistedSelectionMetadata ?? {};
    const persistedReceipt = persistedSelectionMetadata.sessionDecisionReceipt as Record<
      string,
      unknown
    >;
    expect((persistedReceipt.exceptions as Array<{ code: string }>).map((entry) => entry.code)).toContain(
      "supplemental_deficit_session"
    );
  });
});
