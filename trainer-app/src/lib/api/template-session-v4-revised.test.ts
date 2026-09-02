import { beforeEach, describe, expect, it, vi } from "vitest";
import { exampleExerciseLibrary, exampleGoals, exampleUser } from "../engine/sample-data";
import * as selectionV2 from "@/lib/engine/selection-v2";
import { buildRevisedFourDayPlanAcceptedSeed } from "@/lib/engine/hypertrophy-plan-authoring-v4-revised.fixture";
import {
  EXPECTED_V4_REVISED_REFERENCE_CASES,
  V4_REVISED_REFERENCE_CANONICAL_HASH,
  V4_REVISED_REFERENCE_PLACEMENT_IDS_BY_SLOT,
} from "@/lib/api/template-session-v4-revised-reference.expected";
import {
  assertV4ReferenceCase,
  buildActualV4ReferenceCase,
  buildV4ReferenceExerciseLibrary,
  buildV4ReferenceMesocycle,
  primeV4ReferenceGeneration,
  primeV4ReferenceWeek,
  type V4ReferenceHarnessMocks,
} from "@/lib/api/template-session-v4-reference.test-helper";

const mesocycleRoleFindManyMock = vi.fn();
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    mesocycleExerciseRole: {
      findMany: (...args: unknown[]) => mesocycleRoleFindManyMock(...args),
    },
  },
}));

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
const loadPrescriptionAnchorHistoryForExercisesMock = vi.fn();
const mergePrescriptionAnchorHistoryMock = vi.fn();
const mergePrescriptionAnchorHistoryWithEvidenceMock = vi.fn();
const loadActiveMesocycleMock = vi.fn();
const loadExerciseRotationContextMock = vi.fn();
const getCurrentMesoWeekMock = vi.fn();
const getRirTargetMock = vi.fn();
const getWeeklyVolumeTargetMock = vi.fn();
const loadGenerationPhaseBlockContextMock = vi.fn();

vi.mock("./templates", () => ({
  loadTemplateDetail: (...args: unknown[]) => loadTemplateDetailMock(...args),
}));

vi.mock("./workout-context", () => ({
  loadWorkoutContext: (...args: unknown[]) => loadWorkoutContextMock(...args),
  mapProfile: (...args: unknown[]) => mapProfileMock(...args),
  mapGoals: (...args: unknown[]) => mapGoalsMock(...args),
  mapConstraints: (...args: unknown[]) => mapConstraintsMock(...args),
  mapExercises: (...args: unknown[]) => mapExercisesMock(...args),
  mapHistory: (...args: unknown[]) => mapHistoryMock(...args),
  mapPreferences: (...args: unknown[]) => mapPreferencesMock(...args),
  mapCheckIn: (...args: unknown[]) => mapCheckInMock(...args),
  applyLoads: (...args: unknown[]) => applyLoadsMock(...args),
  loadPrescriptionAnchorHistoryForExercises: (...args: unknown[]) =>
    loadPrescriptionAnchorHistoryForExercisesMock(...args),
  mergePrescriptionAnchorHistory: (...args: unknown[]) =>
    mergePrescriptionAnchorHistoryMock(...args),
  mergePrescriptionAnchorHistoryWithEvidence: (...args: unknown[]) =>
    mergePrescriptionAnchorHistoryWithEvidenceMock(...args),
}));

vi.mock("./exercise-rotation-history", () => ({
  loadExerciseRotationContext: (...args: unknown[]) =>
    loadExerciseRotationContextMock(...args),
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

import { generateSessionFromIntent } from "./template-session";

const v4ReferenceMocks: V4ReferenceHarnessMocks = {
  mapExercises: mapExercisesMock,
  mapConstraints: mapConstraintsMock,
  loadWorkoutContext: loadWorkoutContextMock,
  getCurrentMesoWeek: getCurrentMesoWeekMock,
  loadGenerationPhaseBlockContext: loadGenerationPhaseBlockContextMock,
};

describe("generateSessionFromIntent revised V4 reference proof", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadTemplateDetailMock.mockResolvedValue(null);
    loadWorkoutContextMock.mockResolvedValue({
      profile: { id: "profile" },
      goals: { primaryGoal: "HYPERTROPHY", secondaryGoal: "NONE" },
      constraints: {
        daysPerWeek: 4,
        splitType: "UPPER_LOWER",
        weeklySchedule: ["UPPER", "LOWER"],
      },
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
    loadPrescriptionAnchorHistoryForExercisesMock.mockResolvedValue([]);
    mergePrescriptionAnchorHistoryMock.mockImplementation(
      (history: unknown[], anchorHistory: unknown[]) => [...history, ...anchorHistory],
    );
    mergePrescriptionAnchorHistoryWithEvidenceMock.mockImplementation(
      (history: unknown[], anchorHistory: unknown[]) => ({
        history: [...history, ...anchorHistory],
        selectedAnchorEvidence: {},
      }),
    );
    getRirTargetMock.mockReturnValue({ min: 2, max: 3 });
    getWeeklyVolumeTargetMock.mockReturnValue(12);
    loadExerciseRotationContextMock.mockResolvedValue(new Map());
    mesocycleRoleFindManyMock.mockResolvedValue([]);
  });

  async function generateRevisedReferenceCase() {
    const expected = EXPECTED_V4_REVISED_REFERENCE_CASES.find(
      ({ week, slotId }) => week === 5 && slotId === "lower-a",
    );
    if (!expected) throw new Error("Missing revised Week 5 Lower A reference case");

    const seed = buildRevisedFourDayPlanAcceptedSeed();
    const library = buildV4ReferenceExerciseLibrary(seed);
    const slotSequenceJson = primeV4ReferenceGeneration(
      seed,
      library,
      v4ReferenceMocks,
    );
    primeV4ReferenceWeek(expected, v4ReferenceMocks);
    loadActiveMesocycleMock.mockResolvedValue(
      buildV4ReferenceMesocycle(expected, seed, slotSequenceJson, {
        revisionId: "v4-revised-reference-revision-1",
        hash: V4_REVISED_REFERENCE_CANONICAL_HASH,
      }),
    );
    const result = await generateSessionFromIntent("user-1", {
      generationMode: { kind: "explicit_preview", weekInMeso: expected.week, slotId: expected.slotId },
      intent: expected.focus,
      slotId: expected.slotId,
    });
    if ("error" in result) {
      throw new Error(`Revised reference generation failed: ${result.error}`);
    }
    return { expected, result, seed };
  }

  it("replays the exact independent 26-placement revised V4 reference across all 20 week-slot combinations", async () => {
    const seed = buildRevisedFourDayPlanAcceptedSeed();
    const library = buildV4ReferenceExerciseLibrary(seed);
    const slotSequenceJson = primeV4ReferenceGeneration(
      seed,
      library,
      v4ReferenceMocks,
    );
    const selectSpy = vi.spyOn(selectionV2, "selectExercisesOptimized");
    try {
      expect(EXPECTED_V4_REVISED_REFERENCE_CASES).toHaveLength(20);
      expect(
        new Set(EXPECTED_V4_REVISED_REFERENCE_CASES.map(({ week }) => week)),
      ).toEqual(new Set([1, 2, 3, 4, 5]));
      expect(
        new Set(EXPECTED_V4_REVISED_REFERENCE_CASES.map(({ slotId }) => slotId)),
      ).toEqual(new Set(["lower-a", "upper-a", "lower-b", "upper-b"]));
      expect(
        new Set(
          EXPECTED_V4_REVISED_REFERENCE_CASES.map(
            ({ week, slotId }) => `${week}:${slotId}`,
          ),
        ),
      ).toHaveLength(20);
      expect(
        seed.slots.map((slot) => ({
          slotId: slot.slotId,
          placementIds: slot.exercises.map((exercise) => exercise.placementId),
        })),
      ).toEqual(
        Object.entries(V4_REVISED_REFERENCE_PLACEMENT_IDS_BY_SLOT).map(
          ([slotId, placementIds]) => ({ slotId, placementIds }),
        ),
      );

      for (const expected of EXPECTED_V4_REVISED_REFERENCE_CASES) {
        primeV4ReferenceWeek(expected, v4ReferenceMocks);
        loadActiveMesocycleMock.mockResolvedValue(
          buildV4ReferenceMesocycle(expected, seed, slotSequenceJson, {
            revisionId: "v4-revised-reference-revision-1",
            hash: V4_REVISED_REFERENCE_CANONICAL_HASH,
          }),
        );
        const fallbackCallsBefore = selectSpy.mock.calls.length;
        const result = await generateSessionFromIntent("user-1", {
      generationMode: { kind: "explicit_preview", weekInMeso: expected.week, slotId: expected.slotId },
      intent: expected.focus,
      slotId: expected.slotId,
        });
        const label = `revised week=${expected.week} slot=${expected.slotId}`;
        expect("error" in result, label).toBe(false);
        if ("error" in result) continue;

        const actual = buildActualV4ReferenceCase({
          week: expected.week,
          slotId: expected.slotId,
          seed,
          result,
          selectionFallbackUsed:
            selectSpy.mock.calls.length > fallbackCallsBefore,
        });
        assertV4ReferenceCase(actual, expected, label);
      }
      expect(selectSpy).not.toHaveBeenCalled();
    } finally {
      selectSpy.mockRestore();
    }
  });

  it("preserves valid PRESCRIBE and OMIT projection behavior", async () => {
    const { expected, result, seed } = await generateRevisedReferenceCase();
    const actual = buildActualV4ReferenceCase({
      week: expected.week,
      slotId: expected.slotId,
      seed,
      result,
      selectionFallbackUsed: false,
    });

    assertV4ReferenceCase(actual, expected, "valid status projection");
    expect(actual.exercises.length).toBeGreaterThan(0);
    expect(actual.omittedPlacementIds.length).toBeGreaterThan(0);
  });

  it("rejects a duplicate placement ID before comparison", async () => {
    const { expected, result, seed } = await generateRevisedReferenceCase();
    const malformedSeed = structuredClone(seed);
    const slot = malformedSeed.slots.find(({ slotId }) => slotId === expected.slotId);
    if (!slot || slot.exercises.length < 2) {
      throw new Error("Missing duplicate-placement regression fixture rows");
    }
    slot.exercises[1]!.placementId = slot.exercises[0]!.placementId;

    expect(() =>
      buildActualV4ReferenceCase({
        week: expected.week,
        slotId: expected.slotId,
        seed: malformedSeed,
        result,
        selectionFallbackUsed: false,
      }),
    ).toThrowError(`Duplicate authored placement ID ${slot.exercises[0]!.placementId}`);
  });

  it("rejects a missing weekly status", async () => {
    const { expected, result, seed } = await generateRevisedReferenceCase();
    const malformedSeed = structuredClone(seed);
    const placement = malformedSeed.slots
      .find(({ slotId }) => slotId === expected.slotId)
      ?.exercises[0];
    const prescription = placement?.prescriptions.find(
      ({ week }) => week === expected.week,
    );
    if (!placement || !prescription) {
      throw new Error("Missing status regression fixture row");
    }
    delete (prescription as { status?: unknown }).status;

    expect(() =>
      buildActualV4ReferenceCase({
        week: expected.week,
        slotId: expected.slotId,
        seed: malformedSeed,
        result,
        selectionFallbackUsed: false,
      }),
    ).toThrowError(
      `Unexpected authored prescription status for ${placement.placementId} week ${expected.week}: undefined`,
    );
  });

  it("rejects an unknown weekly status", async () => {
    const { expected, result, seed } = await generateRevisedReferenceCase();
    const malformedSeed = structuredClone(seed);
    const placement = malformedSeed.slots
      .find(({ slotId }) => slotId === expected.slotId)
      ?.exercises[0];
    const prescription = placement?.prescriptions.find(
      ({ week }) => week === expected.week,
    );
    if (!placement || !prescription) {
      throw new Error("Missing status regression fixture row");
    }
    (prescription as { status: unknown }).status = "UNKNOWN";

    expect(() =>
      buildActualV4ReferenceCase({
        week: expected.week,
        slotId: expected.slotId,
        seed: malformedSeed,
        result,
        selectionFallbackUsed: false,
      }),
    ).toThrowError(
      `Unexpected authored prescription status for ${placement.placementId} week ${expected.week}: UNKNOWN`,
    );
  });

  it("rejects independent actual-side mutations at the revised V4 comparison boundary", async () => {
    const expected = EXPECTED_V4_REVISED_REFERENCE_CASES.find(
      ({ week, slotId }) => week === 5 && slotId === "lower-a",
    );
    expect(expected).toBeDefined();
    if (!expected) return;

    const seed = buildRevisedFourDayPlanAcceptedSeed();
    const library = buildV4ReferenceExerciseLibrary(seed);
    const slotSequenceJson = primeV4ReferenceGeneration(
      seed,
      library,
      v4ReferenceMocks,
    );
    primeV4ReferenceWeek(expected, v4ReferenceMocks);
    loadActiveMesocycleMock.mockResolvedValue(
      buildV4ReferenceMesocycle(expected, seed, slotSequenceJson, {
        revisionId: "v4-revised-reference-revision-1",
        hash: V4_REVISED_REFERENCE_CANONICAL_HASH,
      }),
    );
    const selectSpy = vi.spyOn(selectionV2, "selectExercisesOptimized");
    try {
      const fallbackCallsBefore = selectSpy.mock.calls.length;
      const result = await generateSessionFromIntent("user-1", {
      generationMode: { kind: "explicit_preview", weekInMeso: expected.week, slotId: expected.slotId },
      intent: expected.focus,
      slotId: expected.slotId,
      });
      expect("error" in result).toBe(false);
      if ("error" in result) return;

      const validActual = buildActualV4ReferenceCase({
        week: expected.week,
        slotId: expected.slotId,
        seed,
        result,
        selectionFallbackUsed: selectSpy.mock.calls.length > fallbackCallsBefore,
      });
      assertV4ReferenceCase(validActual, expected, "revised sentinel control");

      const mutations: Array<{
        name: string;
        mutate: (value: typeof validActual) => void;
      }> = [
        { name: "wrong week", mutate: (value) => { value.week = 4; } },
        { name: "wrong slot", mutate: (value) => { value.slotId = "lower-b"; } },
        { name: "set count", mutate: (value) => { value.exercises[0]!.setCount += 1; } },
        {
          name: "rep range",
          mutate: (value) => {
            const reps = value.exercises[0]!.sets[0]!.reps;
            if (typeof reps === "object") reps.min += 1;
          },
        },
        {
          name: "derived RPE",
          mutate: (value) => { value.exercises[0]!.sets[0]!.targetRpe! += 0.5; },
        },
        {
          name: "exercise order",
          mutate: (value) => {
            [value.exercises[0], value.exercises[1]] = [
              value.exercises[1]!,
              value.exercises[0]!,
            ];
          },
        },
        {
          name: "exercise identity",
          mutate: (value) => { value.exercises[0]!.exerciseId = "mutated-exercise"; },
        },
        {
          name: "placement identity",
          mutate: (value) => { value.exercises[0]!.placementId = "mutated-placement"; },
        },
        {
          name: "Week 5 omission",
          mutate: (value) => {
            value.omittedPlacementIds = value.omittedPlacementIds.slice(1);
          },
        },
        {
          name: "included omitted placement",
          mutate: (value) => {
            const omittedPlacementId = value.omittedPlacementIds[0];
            if (!omittedPlacementId) throw new Error("Missing omission sentinel");
            value.exercises.push({
              ...structuredClone(value.exercises[0]!),
              placementId: omittedPlacementId,
            });
            value.exerciseCount = value.exercises.length;
          },
        },
        {
          name: "omitted required placement",
          mutate: (value) => {
            value.exercises.splice(0, 1);
            value.exerciseCount = value.exercises.length;
          },
        },
        {
          name: "measurement tuple",
          mutate: (value) => {
            value.exercises[0]!.measurement = {
              profile: "REPS_EXTERNAL_LOAD",
              loadConvention: "BARBELL_TOTAL",
              repBasis: "PER_SIDE",
            };
          },
        },
        {
          name: "provenance",
          mutate: (value) => {
            if (!value.provenance) throw new Error("Missing provenance");
            value.provenance.hash = "f".repeat(64);
          },
        },
        {
          name: "selection fallback",
          mutate: (value) => { value.composition.selectionFallbackUsed = true; },
        },
        {
          name: "unintended composition",
          mutate: (value) => {
            value.composition.warmup.push({ source: "unintended" });
          },
        },
      ];

      for (const mutation of mutations) {
        const mutated = structuredClone(validActual);
        mutation.mutate(mutated);
        expect(
          () => assertV4ReferenceCase(mutated, expected, mutation.name),
          mutation.name,
        ).toThrowError();
      }
    } finally {
      selectSpy.mockRestore();
    }
  });
});
