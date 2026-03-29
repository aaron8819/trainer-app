import { describe, expect, it } from "vitest";
import type { NextCycleSeedDraft } from "./mesocycle-handoff-contract";
import { buildFallbackDesignFromDraft } from "./mesocycle-genesis-policy";
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
      volumeEntry: "conservative",
      baselineSource: "accumulation_preferred",
      allowNonDeloadFallback: true,
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

function buildDesign() {
  return buildFallbackDesignFromDraft({
    sourceMesocycleId: "meso-1",
    designedAt: "2026-04-01T00:00:00.000Z",
    profile: {
      focus: "Upper Hypertrophy",
      durationWeeks: 5,
      volumeTarget: "HIGH",
      intensityBias: "HYPERTROPHY",
      blocks: [
        {
          blockNumber: 1,
          blockType: "ACCUMULATION",
          durationWeeks: 4,
          volumeTarget: "HIGH",
          intensityBias: "HYPERTROPHY",
          adaptationType: "MYOFIBRILLAR_HYPERTROPHY",
        },
      ],
    },
    draft: buildDraft(),
  });
}

describe("buildSuccessorMesocyclePreview", () => {
  it("keeps repeated intents honest by sharing intent-level carry-forward pools", () => {
    const preview = buildSuccessorMesocyclePreview({
      currentMesoNumber: 1,
      focus: "Upper Hypertrophy",
      design: buildDesign(),
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

  it("respects explicit repeated-slot targets before falling back to shared intent pools", () => {
    const design = buildDesign();
    design.carryForward.decisions = [
      {
        ...design.carryForward.decisions[0],
        targetIntent: "UPPER",
        targetSlotId: "upper_b",
      },
      design.carryForward.decisions[1],
      {
        exerciseId: "split-squat",
        role: "ACCESSORY",
        priorIntent: "LOWER",
        action: "keep",
        targetIntent: "LOWER",
        targetSlotId: "lower_a",
        signalQuality: "high",
        reasonCodes: ["accessory_continuity_supported_by_receipt_slot"],
      },
    ];

    const preview = buildSuccessorMesocyclePreview({
      currentMesoNumber: 1,
      focus: "Upper Hypertrophy",
      design,
      draft: buildDraft(),
    });

    expect(preview.slotSequence).toEqual([
      expect.objectContaining({
        slotId: "upper_a",
        carriedForwardExerciseCount: 0,
        sharedWithSlotId: null,
        exercises: [],
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
        sharedWithSlotId: null,
        exercises: [expect.objectContaining({ exerciseName: "Bench Press" })],
      }),
      expect.objectContaining({
        slotId: "lower_b",
        carriedForwardExerciseCount: 0,
        sharedWithSlotId: null,
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
      design: buildDesign(),
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
        {
          slotId: "upper_a",
          intent: "UPPER",
          authoredSemantics: {
            slotArchetype: "upper_horizontal_balanced",
            primaryLaneContract: {
              mode: "lane_control",
              lanes: [
                {
                  key: "press",
                  preferredMovementPatterns: ["horizontal_push"],
                  compatibleMovementPatterns: [],
                  fallbackOnlyMovementPatterns: ["vertical_push"],
                  preferredPrimaryMuscles: ["Chest"],
                },
                {
                  key: "pull",
                  preferredMovementPatterns: ["horizontal_pull"],
                  compatibleMovementPatterns: [],
                  fallbackOnlyMovementPatterns: ["vertical_pull"],
                },
              ],
            },
            supportCoverageContract: {
              preferredAccessoryPrimaryMuscles: ["Chest", "Triceps"],
              protectedWeekOneCoverageMuscles: ["Chest", "Triceps"],
              requiredMovementPatterns: ["vertical_pull", "horizontal_pull"],
              avoidDuplicatePatterns: ["horizontal_pull"],
              supportPenaltyPatterns: ["horizontal_pull", "vertical_pull"],
              maxPreferredSupportPerPattern: 1,
            },
            continuityScope: "slot",
          },
        },
        {
          slotId: "lower_a",
          intent: "LOWER",
          authoredSemantics: {
            slotArchetype: "lower_squat_dominant",
            primaryLaneContract: {
              mode: "lane_control",
              lanes: [
                {
                  key: "primary",
                  preferredMovementPatterns: ["squat"],
                  compatibleMovementPatterns: [],
                  fallbackOnlyMovementPatterns: ["hinge"],
                  preferredPrimaryMuscles: ["Quads"],
                },
              ],
            },
            supportCoverageContract: {
              preferredAccessoryPrimaryMuscles: ["Quads", "Calves"],
              protectedWeekOneCoverageMuscles: ["Calves"],
              requiredMovementPatterns: ["hinge"],
              avoidDuplicatePatterns: ["squat"],
              supportPenaltyPatterns: ["hinge"],
              maxPreferredSupportPerPattern: 1,
            },
            continuityScope: "slot",
          },
        },
        {
          slotId: "upper_b",
          intent: "UPPER",
          authoredSemantics: {
            slotArchetype: "upper_vertical_balanced",
            primaryLaneContract: {
              mode: "lane_control",
              lanes: [
                {
                  key: "press",
                  preferredMovementPatterns: ["vertical_push"],
                  compatibleMovementPatterns: [],
                  fallbackOnlyMovementPatterns: ["horizontal_push"],
                  preferredPrimaryMuscles: ["Chest"],
                },
                {
                  key: "pull",
                  preferredMovementPatterns: ["vertical_pull"],
                  compatibleMovementPatterns: [],
                  fallbackOnlyMovementPatterns: ["horizontal_pull"],
                },
              ],
            },
            supportCoverageContract: {
              preferredAccessoryPrimaryMuscles: ["Chest", "Triceps", "Side Delts"],
              protectedWeekOneCoverageMuscles: ["Chest", "Triceps"],
              requiredMovementPatterns: ["horizontal_pull"],
              avoidDuplicatePatterns: ["vertical_pull"],
              supportPenaltyPatterns: ["vertical_push", "vertical_pull"],
              maxPreferredSupportPerPattern: 1,
            },
            continuityScope: "slot",
          },
        },
        {
          slotId: "lower_b",
          intent: "LOWER",
          authoredSemantics: {
            slotArchetype: "lower_hinge_dominant",
            primaryLaneContract: {
              mode: "lane_control",
              lanes: [
                {
                  key: "primary",
                  preferredMovementPatterns: ["hinge"],
                  compatibleMovementPatterns: [],
                  fallbackOnlyMovementPatterns: ["squat"],
                  preferredPrimaryMuscles: ["Hamstrings", "Glutes"],
                },
              ],
            },
            supportCoverageContract: {
              preferredAccessoryPrimaryMuscles: ["Hamstrings", "Calves", "Glutes"],
              protectedWeekOneCoverageMuscles: ["Hamstrings", "Calves"],
              avoidDuplicatePatterns: ["hinge"],
              supportPenaltyPatterns: ["squat"],
              maxPreferredSupportPerPattern: 1,
            },
            continuityScope: "slot",
          },
        },
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
