import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadPendingMesocycleHandoffById: vi.fn(),
  loadHandoffSourceMesocycle: vi.fn(),
  sanitizeNextCycleSeedDraft: vi.fn(),
  loadPreloadedGenerationSnapshot: vi.fn(),
  projectSuccessorSlotPlansFromSnapshot: vi.fn(),
  toHandoffProjectionSource: vi.fn(),
}));

vi.mock("./mesocycle-handoff", () => ({
  loadPendingMesocycleHandoffById: (...args: unknown[]) =>
    mocks.loadPendingMesocycleHandoffById(...args),
  loadHandoffSourceMesocycle: (...args: unknown[]) =>
    mocks.loadHandoffSourceMesocycle(...args),
  sanitizeNextCycleSeedDraft: (...args: unknown[]) => mocks.sanitizeNextCycleSeedDraft(...args),
  toHandoffProjectionSource: (...args: unknown[]) => mocks.toHandoffProjectionSource(...args),
}));

vi.mock("./template-session/context-loader", () => ({
  loadPreloadedGenerationSnapshot: (...args: unknown[]) =>
    mocks.loadPreloadedGenerationSnapshot(...args),
}));

vi.mock("./mesocycle-handoff-slot-plan-projection", () => ({
  projectSuccessorSlotPlansFromSnapshot: (...args: unknown[]) =>
    mocks.projectSuccessorSlotPlansFromSnapshot(...args),
}));

import {
  loadMesocycleSetupFromPrisma,
  loadMesocycleSetupPreviewFromPrisma,
} from "./mesocycle-setup";

function buildDraft() {
  return {
    version: 1 as const,
    sourceMesocycleId: "meso-1",
    createdAt: "2026-04-01T00:00:00.000Z",
    structure: {
      splitType: "UPPER_LOWER" as const,
      sessionsPerWeek: 4,
      daysPerWeek: 4,
      sequenceMode: "ordered_flexible" as const,
      slots: [
        { slotId: "upper_a", intent: "UPPER" as const },
        { slotId: "lower_a", intent: "LOWER" as const },
        { slotId: "upper_b", intent: "UPPER" as const },
        { slotId: "lower_b", intent: "LOWER" as const },
      ],
    },
    startingPoint: {
      volumeEntry: "conservative" as const,
      baselineSource: "accumulation_preferred" as const,
      allowNonDeloadFallback: true as const,
    },
    carryForwardSelections: [
      {
        exerciseId: "bench",
        exerciseName: "Bench Press",
        sessionIntent: "UPPER" as const,
        role: "CORE_COMPOUND" as const,
        action: "keep" as const,
      },
    ],
  };
}

describe("mesocycle setup preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const draft = buildDraft();

    mocks.loadPendingMesocycleHandoffById.mockResolvedValue({
      mesocycleId: "meso-1",
      mesoNumber: 1,
      focus: "Upper Hypertrophy",
      closedAt: "2026-04-01T00:00:00.000Z",
      summary: {
        recommendedNextSeed: draft,
        carryForwardRecommendations: [
          {
            exerciseId: "bench",
            exerciseName: "Bench Press",
            sessionIntent: "UPPER",
            role: "CORE_COMPOUND",
            recommendation: "keep",
            signalQuality: "high",
            reasonCodes: ["core_compound_continuity"],
          },
        ],
      },
      draft,
    });
    mocks.sanitizeNextCycleSeedDraft.mockImplementation(({ draft }: { draft: unknown }) => draft);
    mocks.loadHandoffSourceMesocycle.mockResolvedValue({
      macroCycleId: "macro-1",
      mesoNumber: 1,
      startWeek: 0,
      durationWeeks: 5,
      focus: "Upper Hypertrophy",
      volumeTarget: "HIGH",
      intensityBias: "HYPERTROPHY",
      blocks: [],
    });
    mocks.toHandoffProjectionSource.mockImplementation((source: unknown) => source);
    mocks.loadPreloadedGenerationSnapshot.mockResolvedValue({
      context: {
        exercises: [
          { id: "bench", name: "Bench Press" },
          { id: "row", name: "Chest-Supported Row" },
          { id: "squat", name: "Back Squat" },
        ],
      },
    });
    mocks.projectSuccessorSlotPlansFromSnapshot.mockReturnValue({
      slotPlans: [
        {
          slotId: "upper_primary",
          intent: "UPPER",
          exercises: [
            { exerciseId: "bench", role: "CORE_COMPOUND" },
            { exerciseId: "row", role: "ACCESSORY" },
          ],
        },
        {
          slotId: "lower_primary",
          intent: "LOWER",
          exercises: [{ exerciseId: "squat", role: "CORE_COMPOUND" }],
        },
        {
          slotId: "upper_repeat",
          intent: "UPPER",
          exercises: [{ exerciseId: "bench", role: "CORE_COMPOUND" }],
        },
      ],
    });
  });

  it("keeps the canonical slot-plan projection narrow and decorates it separately for display", async () => {
    const preview = await loadMesocycleSetupPreviewFromPrisma({
      userId: "user-1",
      mesocycleId: "meso-1",
    });

    expect(preview).toMatchObject({
      summary: {
        title: "Meso 2 - Upper Hypertrophy",
      },
      slotPlanProjection: {
        slotPlans: [
          {
            slotId: "upper_primary",
            intent: "UPPER",
            exercises: [
              { exerciseId: "bench", role: "CORE_COMPOUND" },
              { exerciseId: "row", role: "ACCESSORY" },
            ],
          },
          {
            slotId: "lower_primary",
            intent: "LOWER",
            exercises: [{ exerciseId: "squat", role: "CORE_COMPOUND" }],
          },
          {
            slotId: "upper_repeat",
            intent: "UPPER",
            exercises: [{ exerciseId: "bench", role: "CORE_COMPOUND" }],
          },
        ],
      },
      display: {
        projectedSlotPlans: [
          {
            slotId: "upper_primary",
            label: "Upper 1",
            exercises: [
              { exerciseName: "Bench Press", role: "CORE_COMPOUND" },
              { exerciseName: "Chest-Supported Row", role: "ACCESSORY" },
            ],
          },
          {
            slotId: "lower_primary",
            label: "Lower 1",
          },
          {
            slotId: "upper_repeat",
            label: "Upper 2",
          },
        ],
      },
      slotPlanError: null,
    });
    expect(preview?.slotPlanProjection?.slotPlans[0]).toEqual({
      slotId: "upper_primary",
      intent: "UPPER",
      exercises: [
        { exerciseId: "bench", role: "CORE_COMPOUND" },
        { exerciseId: "row", role: "ACCESSORY" },
      ],
    });
  });

  it("derives repeated-slot labels from canonical slot ordering rather than slot-id suffix parsing", async () => {
    const preview = await loadMesocycleSetupPreviewFromPrisma({
      userId: "user-1",
      mesocycleId: "meso-1",
    });

    expect(preview).toMatchObject({
      display: {
        projectedSlotPlans: [
          {
            slotId: "upper_primary",
            label: "Upper 1",
          },
          {
            slotId: "lower_primary",
            label: "Lower 1",
          },
          {
            slotId: "upper_repeat",
            label: "Upper 2",
          },
        ],
      },
    });
  });

  it("uses the shared handoff projection-source loader for setup preview composition", async () => {
    await loadMesocycleSetupPreviewFromPrisma({
      userId: "user-1",
      mesocycleId: "meso-1",
    });

    expect(mocks.loadHandoffSourceMesocycle).toHaveBeenCalledWith(
      expect.anything(),
      "meso-1"
    );
    expect(mocks.toHandoffProjectionSource).toHaveBeenCalledTimes(1);
  });

  it("embeds the canonical preview in the setup read model", async () => {
    const setup = await loadMesocycleSetupFromPrisma({
      userId: "user-1",
      mesocycleId: "meso-1",
    });

    expect(setup).toMatchObject({
      mesocycleId: "meso-1",
      preview: {
        display: {
          projectedSlotPlans: [
            { label: "Upper 1" },
            { label: "Lower 1" },
            { label: "Upper 2" },
          ],
        },
      },
    });
  });
});
