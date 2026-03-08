import { beforeEach, describe, expect, it, vi } from "vitest";
import { exampleExerciseLibrary, exampleGoals, exampleUser } from "@/lib/engine/sample-data";
import type { SessionIntent } from "@/lib/engine/session-types";
import { buildWorkoutAuditContext } from "./context-builder";
import { runWorkoutAuditGeneration } from "./generation-runner";
import { buildWorkoutAuditArtifact, serializeWorkoutAuditArtifact } from "./serializer";

const mesocycleRoleFindManyMock = vi.fn();
const userFindUniqueMock = vi.fn();
const loadNextWorkoutContextMock = vi.fn();
const loadTemplateDetailMock = vi.fn();
const loadWorkoutContextMock = vi.fn();
const mapProfileMock = vi.fn();
const mapGoalsMock = vi.fn();
const mapConstraintsMock = vi.fn();
const mapExercisesMock = vi.fn();
const mapHistoryMock = vi.fn();
const mapPreferencesMock = vi.fn();
const mapCheckInMock = vi.fn();
const applyLoadsMock = vi.fn();
const loadExerciseExposureMock = vi.fn();
const loadActiveMesocycleMock = vi.fn();
const getCurrentMesoWeekMock = vi.fn();
const getRirTargetMock = vi.fn();
const getWeeklyVolumeTargetMock = vi.fn();
const loadGenerationPhaseBlockContextMock = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => userFindUniqueMock(...args),
    },
    mesocycleExerciseRole: {
      findMany: (...args: unknown[]) => mesocycleRoleFindManyMock(...args),
    },
  },
}));

vi.mock("@/lib/api/next-session", () => ({
  loadNextWorkoutContext: (...args: unknown[]) => loadNextWorkoutContextMock(...args),
}));

vi.mock("@/lib/api/templates", () => ({
  loadTemplateDetail: (...args: unknown[]) => loadTemplateDetailMock(...args),
}));

vi.mock("@/lib/api/workout-context", () => ({
  loadWorkoutContext: (...args: unknown[]) => loadWorkoutContextMock(...args),
  mapProfile: (...args: unknown[]) => mapProfileMock(...args),
  mapGoals: (...args: unknown[]) => mapGoalsMock(...args),
  mapConstraints: (...args: unknown[]) => mapConstraintsMock(...args),
  mapExercises: (...args: unknown[]) => mapExercisesMock(...args),
  mapHistory: (...args: unknown[]) => mapHistoryMock(...args),
  mapPreferences: (...args: unknown[]) => mapPreferencesMock(...args),
  mapCheckIn: (...args: unknown[]) => mapCheckInMock(...args),
  applyLoads: (...args: unknown[]) => applyLoadsMock(...args),
}));

vi.mock("@/lib/api/exercise-exposure", () => ({
  loadExerciseExposure: (...args: unknown[]) => loadExerciseExposureMock(...args),
}));

vi.mock("@/lib/api/generation-phase-block-context", () => ({
  loadGenerationPhaseBlockContext: (...args: unknown[]) =>
    loadGenerationPhaseBlockContextMock(...args),
  resolveGenerationPhaseBlockContext: (...args: unknown[]) =>
    loadGenerationPhaseBlockContextMock(...args),
}));

vi.mock("@/lib/api/mesocycle-lifecycle", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api/mesocycle-lifecycle")>();
  return {
    ...original,
    loadActiveMesocycle: (...args: unknown[]) => loadActiveMesocycleMock(...args),
    getCurrentMesoWeek: (...args: unknown[]) => getCurrentMesoWeekMock(...args),
    getRirTarget: (...args: unknown[]) => getRirTargetMock(...args),
    getWeeklyVolumeTarget: (...args: unknown[]) => getWeeklyVolumeTargetMock(...args),
  };
});

const MATRIX_INTENTS: SessionIntent[] = ["push", "pull", "legs", "upper", "lower", "full_body"];

function getClosureCandidates(value: unknown): unknown {
  return (value as { plannerDiagnostics?: { closure?: { firstIterationCandidates?: unknown } } } | undefined)
    ?.plannerDiagnostics?.closure?.firstIterationCandidates;
}

function getClosureRecord(value: unknown): unknown {
  return (value as { plannerDiagnostics?: { closure?: unknown } } | undefined)?.plannerDiagnostics?.closure;
}

async function runNextSessionAudit(intent: SessionIntent, plannerDiagnosticsMode: "standard" | "debug") {
  loadNextWorkoutContextMock.mockResolvedValueOnce({
    intent,
    existingWorkoutId: null,
    isExisting: false,
    source: "rotation",
    weekInMeso: 2,
    sessionInWeek: 2,
    derivationTrace: [],
    selectedIncompleteStatus: null,
  });

  const context = await buildWorkoutAuditContext({
    mode: "next-session",
    userId: "user-1",
    plannerDiagnosticsMode,
  });
  const run = await runWorkoutAuditGeneration(context);
  const artifact = buildWorkoutAuditArtifact(
    {
      mode: "next-session",
      userId: "user-1",
      plannerDiagnosticsMode,
    },
    run
  );
  const serialized = JSON.parse(serializeWorkoutAuditArtifact(artifact)) as {
    generation?: { selection?: { sessionDecisionReceipt?: unknown } };
  };
  return {
    run,
    resolvedIntent: context.generationInput.intent,
    receipt:
      "error" in run.generationResult ? undefined : run.generationResult.selection.sessionDecisionReceipt,
    artifactReceipt: serialized.generation?.selection?.sessionDecisionReceipt,
  };
}

describe("workout audit next-session diagnostics matrix", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    loadTemplateDetailMock.mockResolvedValue(null);
    loadWorkoutContextMock.mockResolvedValue({
      profile: { id: "profile" },
      goals: { primaryGoal: "HYPERTROPHY", secondaryGoal: "NONE" },
      constraints: { daysPerWeek: 4, splitType: "UPPER_LOWER", weeklySchedule: ["UPPER", "LOWER"] },
      injuries: [],
      exercises: exampleExerciseLibrary.map((exercise) => ({ id: exercise.id })),
      workouts: [],
      preferences: null,
      checkIns: [],
    });
    mapProfileMock.mockReturnValue(exampleUser);
    mapGoalsMock.mockReturnValue(exampleGoals);
    mapConstraintsMock.mockReturnValue({
      daysPerWeek: 4,
      splitType: "upper_lower",
      weeklySchedule: ["upper", "lower"],
    });
    mapExercisesMock.mockReturnValue(exampleExerciseLibrary);
    mapHistoryMock.mockReturnValue([]);
    mapPreferencesMock.mockReturnValue(undefined);
    mapCheckInMock.mockReturnValue(undefined);
    applyLoadsMock.mockImplementation((workout: unknown) => workout);
    loadExerciseExposureMock.mockResolvedValue(new Map());
    loadActiveMesocycleMock.mockResolvedValue({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      accumulationSessionsCompleted: 3,
      durationWeeks: 5,
    });
    getCurrentMesoWeekMock.mockReturnValue(2);
    getRirTargetMock.mockReturnValue({ min: 2, max: 3 });
    getWeeklyVolumeTargetMock.mockImplementation(() => 12);
    loadGenerationPhaseBlockContextMock.mockResolvedValue({
      blockContext: {
        block: {
          id: "block-1",
          mesocycleId: "meso-1",
          blockNumber: 1,
          blockType: "accumulation",
          startWeek: 0,
          durationWeeks: 2,
          volumeTarget: "high",
          intensityBias: "hypertrophy",
          adaptationType: "myofibrillar_hypertrophy",
        },
        weekInBlock: 2,
        weekInMeso: 2,
        weekInMacro: 2,
        mesocycle: {
          id: "meso-1",
          macroCycleId: "macro-1",
          mesoNumber: 1,
          startWeek: 0,
          durationWeeks: 5,
          focus: "Hypertrophy",
          volumeTarget: "high",
          intensityBias: "hypertrophy",
          blocks: [],
        },
        macroCycle: {
          id: "macro-1",
          userId: "user-1",
          startDate: new Date("2026-03-01T00:00:00.000Z"),
          endDate: new Date("2026-04-05T00:00:00.000Z"),
          durationWeeks: 5,
          trainingAge: "intermediate",
          primaryGoal: "hypertrophy",
          mesocycles: [],
        },
      },
      profile: {
        blockType: "accumulation",
        weekInBlock: 2,
        blockDurationWeeks: 2,
        isDeload: false,
      },
      cycleContext: {
        weekInMeso: 2,
        weekInBlock: 2,
        mesocycleLength: 5,
        phase: "accumulation",
        blockType: "accumulation",
        isDeload: false,
        source: "computed",
      },
      weekInMeso: 2,
      weekInBlock: 2,
      mesocycleLength: 5,
    });
    mesocycleRoleFindManyMock.mockResolvedValue([]);
  });

  it.each(MATRIX_INTENTS)(
    "keeps planning output stable and gates closure candidates by diagnostics mode for next-session %s",
    async (intent) => {
      const standard = await runNextSessionAudit(intent, "standard");
      const debug = await runNextSessionAudit(intent, "debug");

      expect(standard.resolvedIntent).toBe(intent);
      expect(debug.resolvedIntent).toBe(intent);

      expect("error" in standard.run.generationResult).toBe(false);
      expect("error" in debug.run.generationResult).toBe(false);
      if ("error" in standard.run.generationResult || "error" in debug.run.generationResult) {
        return;
      }

      expect(standard.run.generationResult.selection.selectedExerciseIds.length).toBe(
        debug.run.generationResult.selection.selectedExerciseIds.length
      );
      expect(
        [...standard.run.generationResult.selection.selectedExerciseIds].sort()
      ).toEqual([...debug.run.generationResult.selection.selectedExerciseIds].sort());

      const standardReceiptClosure = getClosureRecord(standard.receipt);
      const debugReceiptClosure = getClosureRecord(debug.receipt);
      const standardArtifactClosure = getClosureRecord(standard.artifactReceipt);
      const debugArtifactClosure = getClosureRecord(debug.artifactReceipt);

      if (standardReceiptClosure) {
        expect(getClosureCandidates(standard.receipt)).toBeUndefined();
      }
      if (standardArtifactClosure) {
        expect(getClosureCandidates(standard.artifactReceipt)).toBeUndefined();
      }

      if (debugReceiptClosure) {
        expect(Array.isArray(getClosureCandidates(debug.receipt))).toBe(true);
      }
      if (debugArtifactClosure) {
        expect(Array.isArray(getClosureCandidates(debug.artifactReceipt))).toBe(true);
      }
    }
  );
});
