import { describe, expect, it, vi } from "vitest";
import {
  acceptMesocycleHandoffInTransaction,
  findIncompatibleCarryForwardKeeps,
  formatCarryForwardConflictMessage,
  loadClosedMesocycleArchive,
  readMesocycleHandoffSummary,
  readNextCycleSeedDraft,
  sanitizeNextCycleSeedDraft,
  updateMesocycleHandoffDraftInTransaction,
} from "./mesocycle-handoff";

function buildRecommendedDraft() {
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
      volumePreset: "conservative_productive" as const,
      baselineRule: "peak_accumulation_else_highest_accumulation_else_non_deload" as const,
      excludeDeload: true as const,
    },
    carryForwardSelections: [
      {
        exerciseId: "bench",
        exerciseName: "Bench Press",
        sessionIntent: "UPPER" as const,
        role: "CORE_COMPOUND" as const,
        action: "keep" as const,
      },
      {
        exerciseId: "row",
        exerciseName: "Chest-Supported Row",
        sessionIntent: "UPPER" as const,
        role: "ACCESSORY" as const,
        action: "rotate" as const,
      },
    ],
  };
}

function buildHandoffSummaryJson(draft = buildRecommendedDraft()) {
  return {
    version: 1 as const,
    mesocycleId: "meso-1",
    macroCycleId: "macro-1",
    mesoNumber: 1,
    closedAt: "2026-04-01T00:00:00.000Z",
    lifecycle: {
      terminalState: "AWAITING_HANDOFF" as const,
      durationWeeks: 5,
      accumulationSessionsCompleted: 8,
      deloadSessionsCompleted: 1,
      deloadExcludedFromNextBaseline: true as const,
    },
    training: {
      focus: "Upper Hypertrophy",
      splitType: "UPPER_LOWER" as const,
      sessionsPerWeek: 4,
      daysPerWeek: 4,
      weeklySequence: ["UPPER", "LOWER", "UPPER", "LOWER"] as const,
    },
    carryForwardRecommendations: [
      {
        exerciseId: "bench",
        exerciseName: "Bench Press",
        sessionIntent: "UPPER" as const,
        role: "CORE_COMPOUND" as const,
        recommendation: "keep" as const,
        signalQuality: "high" as const,
        reasonCodes: ["core_compound_continuity"],
      },
      {
        exerciseId: "row",
        exerciseName: "Chest-Supported Row",
        sessionIntent: "UPPER" as const,
        role: "ACCESSORY" as const,
        recommendation: "rotate" as const,
        signalQuality: "medium" as const,
        reasonCodes: ["accessory_rotation_default"],
      },
    ],
    recommendedNextSeed: draft,
  };
}

describe("sanitizeNextCycleSeedDraft", () => {
  it("canonicalizes ordered slots and allows drop actions against the frozen recommendation set", () => {
    const sanitized = sanitizeNextCycleSeedDraft({
      sourceMesocycleId: "meso-1",
      fallbackDraft: buildRecommendedDraft(),
      draft: {
        sourceMesocycleId: "meso-1",
        structure: {
          splitType: "PPL",
          sessionsPerWeek: 3,
          daysPerWeek: 3,
          sequenceMode: "ordered_flexible",
          slots: [
            { slotId: "x", intent: "PULL" },
            { slotId: "y", intent: "PUSH" },
            { slotId: "z", intent: "LEGS" },
          ],
        },
        carryForwardSelections: [
          {
            exerciseId: "bench",
            exerciseName: "ignored",
            sessionIntent: "UPPER",
            role: "CORE_COMPOUND",
            action: "drop",
          },
          {
            exerciseId: "row",
            exerciseName: "ignored",
            sessionIntent: "UPPER",
            role: "ACCESSORY",
            action: "rotate",
          },
        ],
      },
    });

    expect(sanitized.structure.slots).toEqual([
      { slotId: "pull_a", intent: "PULL" },
      { slotId: "push_a", intent: "PUSH" },
      { slotId: "legs_a", intent: "LEGS" },
    ]);
    expect(sanitized.carryForwardSelections).toEqual([
      expect.objectContaining({ exerciseName: "Bench Press", action: "drop" }),
      expect.objectContaining({ exerciseName: "Chest-Supported Row", action: "rotate" }),
    ]);
  });

  it("rejects keep selections whose prior intent no longer exists in the edited split", () => {
    expect(() =>
      sanitizeNextCycleSeedDraft({
        sourceMesocycleId: "meso-1",
        fallbackDraft: buildRecommendedDraft(),
        draft: {
          sourceMesocycleId: "meso-1",
          structure: {
            splitType: "PPL",
            sessionsPerWeek: 3,
            daysPerWeek: 3,
            sequenceMode: "ordered_flexible",
            slots: [
              { slotId: "x", intent: "PUSH" },
              { slotId: "y", intent: "PULL" },
              { slotId: "z", intent: "LEGS" },
            ],
          },
          carryForwardSelections: [
            {
              exerciseId: "bench",
              exerciseName: "ignored",
              sessionIntent: "UPPER",
              role: "CORE_COMPOUND",
              action: "keep",
            },
            {
              exerciseId: "row",
              exerciseName: "ignored",
              sessionIntent: "UPPER",
              role: "ACCESSORY",
              action: "rotate",
            },
          ],
        },
      })
    ).toThrow("MESOCYCLE_HANDOFF_KEEP_SELECTION_CONFLICT:");

    const conflicts = findIncompatibleCarryForwardKeeps({
      slots: [{ intent: "PUSH" }, { intent: "PULL" }, { intent: "LEGS" }],
      carryForwardSelections: buildRecommendedDraft().carryForwardSelections,
    });

    expect(formatCarryForwardConflictMessage(conflicts)).toContain("Bench Press (UPPER)");
  });
});

describe("handoff readers", () => {
  it("rejects version-only JSON that does not satisfy the handoff contract shape", () => {
    expect(readNextCycleSeedDraft({ version: 1 })).toBeNull();
    expect(readMesocycleHandoffSummary({ version: 1 })).toBeNull();
  });

  it("loads completed archives as reviewable but not editable handoff state", async () => {
    const result = await loadClosedMesocycleArchive(
      {
        mesocycle: {
          findFirst: vi.fn().mockResolvedValue({
            id: "meso-1",
            state: "COMPLETED",
            mesoNumber: 1,
            focus: "Upper Hypertrophy",
            closedAt: new Date("2026-04-01T00:00:00.000Z"),
            handoffSummaryJson: {
              ...buildHandoffSummaryJson(buildRecommendedDraft()),
            },
            nextSeedDraftJson: {
              version: 1,
            },
          }),
        },
      } as never,
      { userId: "user-1", mesocycleId: "meso-1" }
    );

    expect(result).toMatchObject({
      mesocycleId: "meso-1",
      currentState: "COMPLETED",
      reviewState: "historical_closeout",
      isEditableHandoff: false,
      draft: null,
    });
  });
});

describe("handoff draft persistence", () => {
  it("updates the mutable draft and returns the pending handoff record", async () => {
    const draft = buildRecommendedDraft();
    const findUnique = vi.fn().mockResolvedValue({
      id: "meso-1",
      state: "AWAITING_HANDOFF",
      mesoNumber: 1,
      focus: "Upper Hypertrophy",
      closedAt: new Date("2026-04-01T00:00:00.000Z"),
      handoffSummaryJson: buildHandoffSummaryJson(draft),
      nextSeedDraftJson: draft,
    });
    const update = vi.fn().mockResolvedValue({
      id: "meso-1",
      state: "AWAITING_HANDOFF",
      mesoNumber: 1,
      focus: "Upper Hypertrophy",
      closedAt: new Date("2026-04-01T00:00:00.000Z"),
      handoffSummaryJson: buildHandoffSummaryJson(draft),
      nextSeedDraftJson: {
        ...draft,
        updatedAt: "2026-04-02T00:00:00.000Z",
      },
    });

    const result = await updateMesocycleHandoffDraftInTransaction(
      {
        mesocycle: {
          findUnique,
          update,
        },
      } as never,
      {
        mesocycleId: "meso-1",
        draft: {
          sourceMesocycleId: "meso-1",
          structure: {
            splitType: "UPPER_LOWER",
            sessionsPerWeek: 4,
            daysPerWeek: 4,
            sequenceMode: "ordered_flexible",
            slots: draft.structure.slots,
          },
          carryForwardSelections: [
            {
              exerciseId: "bench",
              exerciseName: "Bench Press",
              sessionIntent: "UPPER",
              role: "CORE_COMPOUND",
              action: "keep",
            },
            {
              exerciseId: "row",
              exerciseName: "Chest-Supported Row",
              sessionIntent: "UPPER",
              role: "ACCESSORY",
              action: "drop",
            },
          ],
        },
      }
    );

    expect(result.draft).toMatchObject({
      updatedAt: "2026-04-02T00:00:00.000Z",
    });
    expect(update).toHaveBeenCalledOnce();
  });

  it("accepts the edited draft, persists slot metadata, and only carries kept exercises forward", async () => {
    const recommendedDraft = buildRecommendedDraft();
    const editedDraft = {
      ...recommendedDraft,
      structure: {
        ...recommendedDraft.structure,
        splitType: "PPL" as const,
        sessionsPerWeek: 3,
        daysPerWeek: 3,
        slots: [
          { slotId: "ignore-1", intent: "PUSH" as const },
          { slotId: "ignore-2", intent: "PULL" as const },
          { slotId: "ignore-3", intent: "LEGS" as const },
        ],
      },
      carryForwardSelections: [
        { ...recommendedDraft.carryForwardSelections[0], action: "drop" as const },
        { ...recommendedDraft.carryForwardSelections[1], action: "drop" as const },
      ],
    };

    const mesocycleFindUnique = vi
      .fn()
      .mockResolvedValueOnce({
        id: "meso-1",
        macroCycleId: "macro-1",
        mesoNumber: 1,
        startWeek: 0,
        durationWeeks: 5,
        focus: "Upper Hypertrophy",
        volumeTarget: "HIGH",
        intensityBias: "HYPERTROPHY",
        sessionsPerWeek: 4,
        daysPerWeek: 4,
        splitType: "UPPER_LOWER",
        accumulationSessionsCompleted: 8,
        deloadSessionsCompleted: 1,
        blocks: [],
        macroCycle: { userId: "user-1" },
      })
      .mockResolvedValueOnce({
        id: "meso-1",
        state: "AWAITING_HANDOFF",
        handoffSummaryJson: buildHandoffSummaryJson(recommendedDraft),
        nextSeedDraftJson: editedDraft,
        closedAt: new Date("2026-04-01T00:00:00.000Z"),
      });
    const mesocycleCreate = vi.fn().mockResolvedValue({
      id: "meso-2",
      state: "ACTIVE_ACCUMULATION",
      mesoNumber: 2,
    });
    const exerciseRoleCreateMany = vi.fn();
    const constraintsUpsert = vi.fn();
    const mesocycleUpdate = vi.fn();

    await acceptMesocycleHandoffInTransaction(
      {
        mesocycle: {
          findUnique: mesocycleFindUnique,
          create: mesocycleCreate,
          update: mesocycleUpdate,
        },
        trainingBlock: {
          createMany: vi.fn(),
        },
        mesocycleExerciseRole: {
          createMany: exerciseRoleCreateMany,
        },
        constraints: {
          upsert: constraintsUpsert,
        },
      } as never,
      "meso-1"
    );

    expect(mesocycleCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          splitType: "PPL",
          sessionsPerWeek: 3,
          daysPerWeek: 3,
          slotSequenceJson: {
            version: 1,
            source: "handoff_draft",
            sequenceMode: "ordered_flexible",
            slots: [
              { slotId: "push_a", intent: "PUSH" },
              { slotId: "pull_a", intent: "PULL" },
              { slotId: "legs_a", intent: "LEGS" },
            ],
          },
        }),
      })
    );
    expect(exerciseRoleCreateMany).not.toHaveBeenCalled();
    expect(constraintsUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          weeklySchedule: ["PUSH", "PULL", "LEGS"],
        }),
      })
    );
  });

  it("rejects acceptance when a kept selection no longer matches the edited split", async () => {
    const recommendedDraft = buildRecommendedDraft();
    const incompatibleDraft = {
      ...recommendedDraft,
      structure: {
        ...recommendedDraft.structure,
        splitType: "PPL" as const,
        sessionsPerWeek: 3,
        daysPerWeek: 3,
        slots: [
          { slotId: "ignore-1", intent: "PUSH" as const },
          { slotId: "ignore-2", intent: "PULL" as const },
          { slotId: "ignore-3", intent: "LEGS" as const },
        ],
      },
    };

    const mesocycleFindUnique = vi
      .fn()
      .mockResolvedValueOnce({
        id: "meso-1",
        macroCycleId: "macro-1",
        mesoNumber: 1,
        startWeek: 0,
        durationWeeks: 5,
        focus: "Upper Hypertrophy",
        volumeTarget: "HIGH",
        intensityBias: "HYPERTROPHY",
        sessionsPerWeek: 4,
        daysPerWeek: 4,
        splitType: "UPPER_LOWER",
        accumulationSessionsCompleted: 8,
        deloadSessionsCompleted: 1,
        blocks: [],
        macroCycle: { userId: "user-1" },
      })
      .mockResolvedValueOnce({
        id: "meso-1",
        state: "AWAITING_HANDOFF",
        handoffSummaryJson: buildHandoffSummaryJson(recommendedDraft),
        nextSeedDraftJson: incompatibleDraft,
        closedAt: new Date("2026-04-01T00:00:00.000Z"),
      });

    await expect(
      acceptMesocycleHandoffInTransaction(
        {
          mesocycle: {
            findUnique: mesocycleFindUnique,
            create: vi.fn(),
            update: vi.fn(),
          },
          trainingBlock: {
            createMany: vi.fn(),
          },
          mesocycleExerciseRole: {
            createMany: vi.fn(),
          },
          constraints: {
            upsert: vi.fn(),
          },
        } as never,
        "meso-1"
      )
    ).rejects.toThrow("MESOCYCLE_HANDOFF_KEEP_SELECTION_CONFLICT:");
  });
});
