import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildLogWorkoutExecutionGuidanceByExercise } from "./log-workout-execution-guidance";

const mocks = vi.hoisted(() => ({
  loadActiveMesocycle: vi.fn(),
  deriveCurrentMesocycleSession: vi.fn(),
  getDeloadSessionThreshold: vi.fn(),
  loadNextWorkoutContext: vi.fn(),
  resolveRequestedV4ScheduledGenerationObligation: vi.fn(),
  buildProjectedWeek: vi.fn(),
  buildWeeklyRetro: vi.fn(),
  generateSessionFromIntent: vi.fn(),
  generateDeloadSessionFromIntent: vi.fn(),
  evaluateSeed: vi.fn(),
  loadCurrentIdentity: vi.fn(),
  activateSnapshot: vi.fn(),
}));

vi.mock("@/lib/api/mesocycle-lifecycle", () => ({
  loadActiveMesocycle: (...args: unknown[]) => mocks.loadActiveMesocycle(...args),
  deriveCurrentMesocycleSession: (...args: unknown[]) =>
    mocks.deriveCurrentMesocycleSession(...args),
  getDeloadSessionThreshold: (...args: unknown[]) =>
    mocks.getDeloadSessionThreshold(...args),
}));

vi.mock("@/lib/api/next-session", () => ({
  loadNextWorkoutContext: (...args: unknown[]) =>
    mocks.loadNextWorkoutContext(...args),
  resolveRequestedV4ScheduledGenerationObligation: (...args: unknown[]) =>
    mocks.resolveRequestedV4ScheduledGenerationObligation(...args),
}));

vi.mock("@/lib/api/template-session", () => ({
  generateSessionFromIntent: (...args: unknown[]) =>
    mocks.generateSessionFromIntent(...args),
  generateDeloadSessionFromIntent: (...args: unknown[]) =>
    mocks.generateDeloadSessionFromIntent(...args),
}));

vi.mock("./pre-session-readiness-evidence-builder", () => ({
  buildPreSessionReadinessProjectedWeekEvidence: (...args: unknown[]) =>
    mocks.buildProjectedWeek(...args),
  buildPreSessionReadinessWeeklyRetroEvidence: (...args: unknown[]) =>
    mocks.buildWeeklyRetro(...args),
}));

vi.mock("@/lib/api/accepted-mesocycle-seed-provenance", () => ({
  evaluateAcceptedMesocycleSeedProvenance: (...args: unknown[]) =>
    mocks.evaluateSeed(...args),
}));

vi.mock("./pre-session-readiness-snapshot", () => {
  class PreSessionReadinessSnapshotConflictError extends Error {
    constructor(
      public readonly code:
        | "STALE_PREPARATION"
        | "PAYLOAD_INTEGRITY_CONFLICT"
        | "CONCURRENT_TARGET_CONFLICT",
      message: string,
    ) {
      super(message);
    }
  }

  return {
    loadCurrentPreSessionReadinessSnapshotIdentity: (...args: unknown[]) =>
      mocks.loadCurrentIdentity(...args),
    activatePreSessionReadinessSnapshot: (...args: unknown[]) =>
      mocks.activateSnapshot(...args),
    PreSessionReadinessSnapshotConflictError,
  };
});

vi.mock("./home-pre-session-readiness", () => ({
  loadCurrentHomePreSessionReadinessContractCandidate: vi.fn(),
  resolveHomePreSessionReadinessContract: vi.fn(),
}));

import { preparePreSessionReadinessSnapshot } from "./pre-session-readiness-producer";

type GeneratedOccurrence = {
  placementId: string;
  exerciseId: string;
  exerciseName: string;
  targetLoad: number;
};

type PersistedOccurrence = {
  id: string;
  exerciseId: string;
};

function generatedOccurrence(
  placementId: string,
  exerciseId: string,
  exerciseName: string,
  targetLoad: number,
): GeneratedOccurrence {
  return { placementId, exerciseId, exerciseName, targetLoad };
}

function configureScenario(input: {
  generated: GeneratedOccurrence[];
  persisted?: PersistedOccurrence[];
  correlations?: unknown;
}) {
  const isSaved = input.persisted !== undefined;
  const existingWorkoutId = isSaved ? "workout-saved" : null;
  mocks.loadNextWorkoutContext.mockResolvedValue({
    activeMesocycleId: "meso-1",
    intent: "upper",
    slotId: "upper_a",
    slotSequenceIndex: 0,
    slotSequenceLength: 1,
    slotSource: "mesocycle_slot_sequence",
    existingWorkoutId,
    isExisting: isSaved,
    source: isSaved ? "existing_incomplete" : "rotation",
    weekInMeso: 1,
    sessionInWeek: 1,
    derivationTrace: [],
    selectedIncompleteStatus: isSaved ? "planned" : null,
    selectedIncompleteReadiness: null,
  });

  const generatedExercises = input.generated.map((exercise, orderIndex) => ({
    placementId: exercise.placementId,
    exerciseId: exercise.exerciseId,
    exerciseName: exercise.exerciseName,
    orderIndex,
    section: orderIndex === 0 ? "main" : "accessory",
    isMainLift: orderIndex === 0,
    prescribedSetCount: 1,
    prescribedSets: [{ setIndex: 0, targetReps: 8, targetLoad: exercise.targetLoad }],
  }));
  const savedWorkoutEvidence = isSaved
    ? {
        sessionSnapshot: {
          version: 1,
          generated: {
            selectionMode: "AUTO",
            sessionIntent: "UPPER",
            semantics: { kind: "standard" },
            exerciseCount: generatedExercises.length,
            hardSetCount: generatedExercises.length,
            exercises: generatedExercises,
            traces: { progression: {} },
          },
          saved: {
            workoutId: "workout-saved",
            status: "PLANNED",
            advancesSplit: true,
            semantics: { kind: "standard" },
            ...(input.correlations === undefined
              ? {}
              : { placementCorrelations: input.correlations }),
          },
        },
        persistedExercises: input.persisted,
      }
    : null;

  mocks.loadCurrentIdentity.mockResolvedValue({
    userId: "user-1",
    activeMesocycleId: "meso-1",
    mesocycleState: "ACTIVE_ACCUMULATION",
    weekInMeso: 1,
    sessionInWeek: 1,
    slotId: "upper_a",
    slotIntent: "upper",
    plannedWorkoutId: existingWorkoutId,
    plannedWorkoutRevision: isSaved ? 1 : null,
    contractVersion: 1,
    identity: { identityContractVersion: 1 },
    identityHash: "identity-hash",
    targetHash: "target-hash",
    readinessEvidenceFingerprint: "readiness-hash",
    projectionFingerprint: "projection-hash",
    slotPlanSeedHash: null,
    slotSequenceHash: "sequence-hash",
    seedRevisionId: null,
    seedRevisionNumber: null,
    seedPayloadHash: null,
    prescriptionFingerprint: isSaved ? "prescription-hash" : null,
    savedWorkoutEvidence,
  });

  const workoutExercises = input.generated.map((exercise, orderIndex) => ({
    id: exercise.placementId,
    exercise: {
      id: exercise.exerciseId,
      name: exercise.exerciseName,
      movementPatterns: [],
      splitTags: [],
      jointStress: "low",
      equipment: [],
    },
    orderIndex,
    isMainLift: orderIndex === 0,
    sets: [{ setIndex: 0, targetReps: 8, targetLoad: exercise.targetLoad }],
  }));
  mocks.generateSessionFromIntent.mockResolvedValue({
    workout: {
      id: "generated-workout",
      scheduledDate: "2026-08-25",
      warmup: [],
      mainLifts: workoutExercises.slice(0, 1),
      accessories: workoutExercises.slice(1),
      estimatedMinutes: 45,
    },
    selectionMode: "AUTO",
    sessionIntent: "upper",
    sraWarnings: [],
    substitutions: [],
    volumePlanByMuscle: {},
    selection: {
      selectedExerciseIds: input.generated.map((exercise) => exercise.exerciseId),
      mainLiftIds: input.generated.slice(0, 1).map((exercise) => exercise.exerciseId),
      accessoryIds: input.generated.slice(1).map((exercise) => exercise.exerciseId),
      perExerciseSetTargets: {},
      rationale: {},
      volumePlanByMuscle: {},
    },
    prescriptionReadouts: input.generated.map((exercise) => ({
      placementId: exercise.placementId,
      exerciseId: exercise.exerciseId,
      exerciseName: exercise.exerciseName,
      setCount: 1,
      targetLoad: exercise.targetLoad,
      targetReps: 8,
      repRange: { min: 6, max: 10 },
      targetRpe: 7,
      targetRir: 3,
      prescriptionKind: "numeric",
      loadSource: "exact_history",
      confidence: "high",
      measurementProfile: null,
      loadConvention: null,
      repBasis: null,
      zeroLoadMeaning: null,
      cautionLevel: "none",
      cautionReason: null,
    })),
    audit: {},
  });
}

async function prepareScenario() {
  const result = await preparePreSessionReadinessSnapshot("user-1");
  expect(result.status).toBe("prepared");
  if (result.status !== "prepared") {
    throw new Error(`Expected prepared result, received ${result.reason}`);
  }
  return {
    contract: result.contract,
    guidance: buildLogWorkoutExecutionGuidanceByExercise(result.gymCard),
  };
}

describe("production readiness placement-correlation handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadActiveMesocycle.mockResolvedValue({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      accumulationSessionsCompleted: 0,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 1,
      durationWeeks: 4,
      slotPlanSeedJson: null,
      blocks: [],
    });
    mocks.deriveCurrentMesocycleSession.mockReturnValue({
      week: 1,
      session: 1,
      phase: "ACCUMULATION",
    });
    mocks.getDeloadSessionThreshold.mockReturnValue(1);
    mocks.buildProjectedWeek.mockResolvedValue({
      version: 1,
      currentWeek: {
        mesocycleId: "meso-1",
        week: 1,
        phase: "accumulation",
        blockType: null,
      },
      projectionNotes: [],
      completedVolumeByMuscle: {},
      projectedSessions: [],
      fullWeekByMuscle: [],
      currentWeekAudit: {
        belowMEV: [],
        overMAV: [],
        underTargetClusters: [],
        belowPreferred: [],
        fatigueRisks: [],
      },
      interventionHints: [],
      sessionRisks: [],
      runtimeDoseAdjustmentDiagnostics: [],
    });
    mocks.activateSnapshot.mockImplementation(async ({ contract }) => ({
      outcome: "created",
      invalidatedSnapshotCount: 0,
      snapshot: { id: "snapshot-1", contractJson: contract },
    }));
  });

  it("carries a saved A-to-X mapping through the real builder, resolver, and log guidance", async () => {
    configureScenario({
      generated: [generatedOccurrence("generated-a", "bench", "Bench Press", 105)],
      persisted: [{ id: "row-x", exerciseId: "bench" }],
      correlations: [
        {
          generatedPlacementId: "generated-a",
          persistedWorkoutExerciseId: "row-x",
        },
      ],
    });

    const { contract, guidance } = await prepareScenario();

    expect(contract.placementCorrelation).toMatchObject({
      state: "resolved",
      explicitPairCount: 1,
      provenPairCount: 1,
    });
    expect(contract.workoutPreview?.exercises).toEqual([
      expect.objectContaining({
        placementId: "row-x",
        placementCorrelationSource: "explicit",
      }),
    ]);
    expect(contract.workoutPreview?.exercises).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ placementId: "generated-a" })]),
    );
    expect(guidance.byPlacementId).toEqual({
      "row-x": [
        expect.objectContaining({
          title: "Prescription guidance",
          message: expect.stringContaining("105 lb"),
        }),
      ],
    });
  });

  it("fails closed for an invalid persisted target", async () => {
    configureScenario({
      generated: [generatedOccurrence("generated-a", "bench", "Bench Press", 105)],
      persisted: [{ id: "row-x", exerciseId: "bench" }],
      correlations: [
        {
          generatedPlacementId: "generated-a",
          persistedWorkoutExerciseId: "NOPE",
        },
      ],
    });

    const { contract, guidance } = await prepareScenario();
    expect(contract.placementCorrelation?.state).toBe("invalid_explicit_correlation");
    expect(contract.workoutPreview?.exercises).toEqual([]);
    expect(guidance.byPlacementId).toEqual({});
  });

  it("fails closed for a distinct-canonical many-to-one map", async () => {
    configureScenario({
      generated: [
        generatedOccurrence("generated-a", "bench", "Bench Press", 105),
        generatedOccurrence("generated-b", "row", "Cable Row", 95),
      ],
      persisted: [
        { id: "row-x", exerciseId: "bench" },
        { id: "row-y", exerciseId: "row" },
      ],
      correlations: [
        { generatedPlacementId: "generated-a", persistedWorkoutExerciseId: "row-x" },
        { generatedPlacementId: "generated-b", persistedWorkoutExerciseId: "row-x" },
      ],
    });

    const { contract, guidance } = await prepareScenario();
    expect(contract.placementCorrelation?.state).toBe("invalid_explicit_correlation");
    expect(contract.workoutPreview?.exercises).toEqual([]);
    expect(guidance.byPlacementId).toEqual({});
  });

  it("keeps a valid exact A-to-X and B-to-Y pair set independent", async () => {
    configureScenario({
      generated: [
        generatedOccurrence("generated-a", "bench", "Bench Press", 105),
        generatedOccurrence("generated-b", "bench", "Bench Press", 95),
      ],
      persisted: [
        { id: "row-x", exerciseId: "bench" },
        { id: "row-y", exerciseId: "bench" },
      ],
      correlations: [
        { generatedPlacementId: "generated-a", persistedWorkoutExerciseId: "row-x" },
        { generatedPlacementId: "generated-b", persistedWorkoutExerciseId: "row-y" },
      ],
    });

    const { contract, guidance } = await prepareScenario();
    expect(contract.placementCorrelation).toMatchObject({
      state: "resolved",
      explicitPairCount: 2,
      provenPairCount: 2,
    });
    expect(contract.workoutPreview?.exercises.map((exercise) => exercise.placementId)).toEqual([
      "row-x",
      "row-y",
    ]);
    expect(guidance.byPlacementId).toEqual({
      "row-x": [expect.objectContaining({ message: expect.stringContaining("105 lb") })],
      "row-y": [expect.objectContaining({ message: expect.stringContaining("95 lb") })],
    });
  });

  it("allows only resolver-owned unique legacy correlation", async () => {
    configureScenario({
      generated: [generatedOccurrence("generated-a", "bench", "Bench Press", 105)],
      persisted: [{ id: "row-x", exerciseId: "bench" }],
    });

    const { contract, guidance } = await prepareScenario();
    expect(contract.placementCorrelation).toMatchObject({
      state: "resolved",
      legacyUniquePairCount: 1,
    });
    expect(contract.workoutPreview?.exercises).toEqual([
      expect.objectContaining({
        placementId: "row-x",
        placementCorrelationSource: "legacy_unique",
      }),
    ]);
    expect(Object.keys(guidance.byPlacementId)).toEqual(["row-x"]);
  });

  it("keeps duplicate legacy occurrences ambiguous", async () => {
    configureScenario({
      generated: [
        generatedOccurrence("generated-a", "bench", "Bench Press", 105),
        generatedOccurrence("generated-b", "bench", "Bench Press", 95),
      ],
      persisted: [
        { id: "row-x", exerciseId: "bench" },
        { id: "row-y", exerciseId: "bench" },
      ],
    });

    const { contract, guidance } = await prepareScenario();
    expect(contract.placementCorrelation?.state).toBe("ambiguous_legacy_correlation");
    expect(contract.workoutPreview?.exercises).toEqual([]);
    expect(guidance.byPlacementId).toEqual({});
  });

  it("keeps genuinely unsaved preview identity generated-only", async () => {
    configureScenario({
      generated: [generatedOccurrence("generated-a", "bench", "Bench Press", 105)],
    });

    const { contract } = await prepareScenario();
    expect(contract.placementCorrelation?.state).toBe("generated_only");
    expect(contract.workoutPreview?.exercises).toEqual([
      expect.objectContaining({
        placementId: "generated-a",
        placementCorrelationSource: "generated_only",
      }),
    ]);
  });
});
