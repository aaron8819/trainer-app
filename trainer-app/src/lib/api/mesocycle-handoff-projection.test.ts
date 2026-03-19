import { describe, expect, it } from "vitest";
import type { NextCycleSeedDraft } from "./mesocycle-handoff-contract";
import {
  buildSuccessorMesocyclePreview,
  projectSuccessorMesocycle,
} from "./mesocycle-handoff-projection";

function buildDraft(): NextCycleSeedDraft {
  return {
    version: 1,
    sourceMesocycleId: "meso-1",
    createdAt: "2026-04-01T00:00:00.000Z",
    structure: {
      splitType: "UPPER_LOWER",
      sessionsPerWeek: 4,
      daysPerWeek: 4,
      sequenceMode: "ordered_flexible",
      slots: [
        { slotId: "upper_a", intent: "UPPER" },
        { slotId: "lower_a", intent: "LOWER" },
        { slotId: "upper_b", intent: "UPPER" },
        { slotId: "lower_b", intent: "LOWER" },
      ],
    },
    startingPoint: {
      volumePreset: "conservative_productive",
      baselineRule: "peak_accumulation_else_highest_accumulation_else_non_deload",
      excludeDeload: true,
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
        action: "rotate",
      },
      {
        exerciseId: "split-squat",
        exerciseName: "Split Squat",
        sessionIntent: "LOWER",
        role: "ACCESSORY",
        action: "keep",
      },
    ],
  };
}

describe("buildSuccessorMesocyclePreview", () => {
  it("keeps repeated intents honest by sharing intent-level carry-forward pools", () => {
    const preview = buildSuccessorMesocyclePreview({
      currentMesoNumber: 1,
      focus: "Upper Hypertrophy",
      draft: buildDraft(),
    });

    expect(preview.title).toBe("Meso 2 - Upper Hypertrophy");
    expect(preview.slotSequence).toEqual([
      expect.objectContaining({
        slotId: "upper_a",
        carriedForwardExerciseCount: 1,
        sharedWithSlotId: null,
        exercises: [expect.objectContaining({ exerciseName: "Bench Press" })],
      }),
      expect.objectContaining({
        slotId: "lower_a",
        carriedForwardExerciseCount: 1,
        sharedWithSlotId: null,
        exercises: [expect.objectContaining({ exerciseName: "Split Squat" })],
      }),
      expect.objectContaining({
        slotId: "upper_b",
        carriedForwardExerciseCount: 1,
        sharedWithSlotId: "upper_a",
        exercises: [],
      }),
      expect.objectContaining({
        slotId: "lower_b",
        carriedForwardExerciseCount: 1,
        sharedWithSlotId: "lower_a",
        exercises: [],
      }),
    ]);
  });
});

describe("projectSuccessorMesocycle", () => {
  it("builds the persisted successor from the same canonical preview projection", () => {
    const projection = projectSuccessorMesocycle({
      source: {
        macroCycleId: "macro-1",
        mesoNumber: 1,
        startWeek: 0,
        durationWeeks: 5,
        focus: "Upper Hypertrophy",
        volumeTarget: "HIGH",
        intensityBias: "HYPERTROPHY",
        blocks: [
          {
            blockNumber: 1,
            blockType: "ACCUMULATION",
            startWeek: 0,
            durationWeeks: 4,
            volumeTarget: "HIGH",
            intensityBias: "HYPERTROPHY",
            adaptationType: "MYOFIBRILLAR_HYPERTROPHY",
          },
        ],
      },
      draft: buildDraft(),
    });

    expect(projection.preview.title).toBe("Meso 2 - Upper Hypertrophy");
    expect(projection.mesocycle).toMatchObject({
      macroCycleId: "macro-1",
      mesoNumber: 2,
      startWeek: 5,
      durationWeeks: 5,
      splitType: "UPPER_LOWER",
      sessionsPerWeek: 4,
      weeklySchedule: ["UPPER", "LOWER", "UPPER", "LOWER"],
    });
    expect(projection.mesocycle.slotSequence).toEqual({
      version: 1,
      source: "handoff_draft",
      sequenceMode: "ordered_flexible",
      slots: [
        { slotId: "upper_a", intent: "UPPER" },
        { slotId: "lower_a", intent: "LOWER" },
        { slotId: "upper_b", intent: "UPPER" },
        { slotId: "lower_b", intent: "LOWER" },
      ],
    });
    expect(projection.carriedForwardRoles).toEqual([
      {
        exerciseId: "bench",
        sessionIntent: "UPPER",
        role: "CORE_COMPOUND",
        addedInWeek: 1,
      },
      {
        exerciseId: "split-squat",
        sessionIntent: "LOWER",
        role: "ACCESSORY",
        addedInWeek: 1,
      },
    ]);
    expect(projection.trainingBlocks).toEqual([
      {
        blockNumber: 1,
        blockType: "ACCUMULATION",
        startWeek: 5,
        durationWeeks: 4,
        volumeTarget: "HIGH",
        intensityBias: "HYPERTROPHY",
        adaptationType: "MYOFIBRILLAR_HYPERTROPHY",
      },
    ]);
  });
});
