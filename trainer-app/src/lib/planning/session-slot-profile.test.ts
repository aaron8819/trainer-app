import { describe, expect, it } from "vitest";

import {
  resolveMesocycleSlotContract,
} from "@/lib/api/mesocycle-slot-contract";
import {
  classifyExerciseForCompoundLane,
  doesExerciseSatisfyRequiredSessionShapePattern,
  getFutureSlotOpportunityBias,
  getProjectionRepairCompatibleMuscles,
  isExerciseAllowedForAnyCompoundLaneSatisfaction,
  isExerciseAllowedForCompoundLaneSatisfaction,
  resolveSessionSlotCompoundLaneState,
  resolveSessionSlotPolicy,
} from "./session-slot-profile";
import type { MovementPatternV2 } from "@/lib/engine/types";

describe("resolveSessionSlotPolicy", () => {
  const makeCompoundCandidate = (input: {
    id: string;
    movementPatterns: MovementPatternV2[];
    primaryMuscles: string[];
    isCompound?: boolean;
  }) => ({
    ...input,
    isCompound: input.isCompound ?? true,
  });

  const slotSequence = {
    slots: [
      { slotId: "upper_a", intent: "upper", sequenceIndex: 0 },
      { slotId: "lower_a", intent: "lower", sequenceIndex: 1 },
      { slotId: "upper_b", intent: "upper", sequenceIndex: 2 },
      { slotId: "lower_b", intent: "lower", sequenceIndex: 3 },
    ],
  };

  it("resolves horizontal versus vertical upper-slot profiles from canonical slot order", () => {
    expect(
      resolveSessionSlotPolicy({
        sessionIntent: "upper",
        slotId: "upper_a",
        slotSequence,
      }).currentSession
    ).toEqual({
      sessionIntent: "upper",
      slotId: "upper_a",
      sequenceIndex: 0,
      slotArchetype: "upper_horizontal_balanced",
      continuityScope: "slot",
      repeatedSlot: {
        occurrenceIndex: 0,
        totalSlots: 2,
      },
      compoundBias: {
        preferredMovementPatterns: ["horizontal_push", "horizontal_pull"],
        preferredPrimaryMuscles: ["Chest"],
      },
      sessionShape: {
        id: "upper_horizontal_balanced",
        preferredAccessoryPrimaryMuscles: ["Chest", "Triceps", "Rear Delts"],
        protectedWeekOneCoverageMuscles: ["Chest", "Triceps", "Rear Delts"],
        requiredMovementPatterns: ["vertical_pull", "horizontal_pull"],
        avoidDuplicatePatterns: ["vertical_pull"],
        supportPenaltyPatterns: ["horizontal_pull", "vertical_pull"],
        maxPreferredSupportPerPattern: 1,
      },
      compoundControl: {
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
    });

    expect(
      resolveSessionSlotPolicy({
        sessionIntent: "upper",
        slotId: "upper_b",
        slotSequence,
      }).currentSession
    ).toEqual({
      sessionIntent: "upper",
      slotId: "upper_b",
      sequenceIndex: 2,
      slotArchetype: "upper_vertical_balanced",
      continuityScope: "slot",
      repeatedSlot: {
        occurrenceIndex: 1,
        totalSlots: 2,
      },
      compoundBias: {
        preferredMovementPatterns: ["vertical_push", "vertical_pull"],
        preferredPrimaryMuscles: ["Chest"],
      },
      sessionShape: {
        id: "upper_vertical_balanced",
        preferredAccessoryPrimaryMuscles: ["Chest", "Triceps", "Side Delts"],
        protectedWeekOneCoverageMuscles: ["Chest", "Triceps", "Side Delts"],
        requiredMovementPatterns: ["horizontal_pull"],
        avoidDuplicatePatterns: ["vertical_push", "vertical_pull"],
        supportPenaltyPatterns: ["vertical_push", "vertical_pull"],
        maxPreferredSupportPerPattern: 1,
      },
      compoundControl: {
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
    });
  });

  it("resolves squat versus hinge lower-slot profiles from canonical slot order", () => {
    expect(
      resolveSessionSlotPolicy({
        sessionIntent: "lower",
        slotId: "lower_a",
        slotSequence,
      }).currentSession
    ).toEqual({
      sessionIntent: "lower",
      slotId: "lower_a",
      sequenceIndex: 1,
      slotArchetype: "lower_squat_dominant",
      continuityScope: "slot",
      repeatedSlot: {
        occurrenceIndex: 0,
        totalSlots: 2,
      },
      compoundBias: {
        preferredMovementPatterns: ["squat"],
        preferredPrimaryMuscles: ["Quads"],
      },
      sessionShape: {
        id: "lower_squat_dominant",
        preferredAccessoryPrimaryMuscles: ["Quads", "Calves"],
        protectedWeekOneCoverageMuscles: ["Calves"],
        requiredMovementPatterns: ["hinge"],
        avoidDuplicatePatterns: ["squat"],
        supportPenaltyPatterns: ["hinge"],
        maxPreferredSupportPerPattern: 1,
      },
      compoundControl: {
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
    });

    expect(
      resolveSessionSlotPolicy({
        sessionIntent: "lower",
        slotId: "lower_b",
        slotSequence,
      }).currentSession
    ).toEqual({
      sessionIntent: "lower",
      slotId: "lower_b",
      sequenceIndex: 3,
      slotArchetype: "lower_hinge_dominant",
      continuityScope: "slot",
      repeatedSlot: {
        occurrenceIndex: 1,
        totalSlots: 2,
      },
      compoundBias: {
        preferredMovementPatterns: ["hinge"],
        preferredPrimaryMuscles: ["Hamstrings"],
      },
      sessionShape: {
        id: "lower_hinge_dominant",
        preferredAccessoryPrimaryMuscles: ["Quads", "Calves"],
        protectedWeekOneCoverageMuscles: ["Hamstrings", "Calves"],
        requiredMovementPatterns: ["squat"],
        avoidDuplicatePatterns: ["hinge"],
        supportPenaltyPatterns: ["squat"],
        maxPreferredSupportPerPattern: 1,
      },
      compoundControl: {
        lanes: [
          {
            key: "primary",
            preferredMovementPatterns: ["hinge"],
            compatibleMovementPatterns: [],
            fallbackOnlyMovementPatterns: ["squat"],
            preferredPrimaryMuscles: ["Hamstrings"],
          },
        ],
      },
    });
  });

  it("returns null when current slot identity is absent and keeps unsupported intents un-biased", () => {
    expect(
      resolveSessionSlotPolicy({
        sessionIntent: "upper",
        slotSequence,
      }).currentSession
    ).toBeNull();

    expect(
      resolveSessionSlotPolicy({
        sessionIntent: "full_body",
        slotId: "full_body_a",
        slotSequence: {
          slots: [{ slotId: "full_body_a", intent: "full_body", sequenceIndex: 0 }],
        },
      }).currentSession
    ).toEqual({
      sessionIntent: "full_body",
      slotId: "full_body_a",
      sequenceIndex: 0,
      slotArchetype: "full_body_standard",
      continuityScope: "slot",
    });
  });

  it("resolves canonical future slots into the same policy seam", () => {
    const policy = resolveSessionSlotPolicy({
      sessionIntent: "upper",
      slotId: "upper_a",
      slotSequence,
      futureSlots: [
        { slotId: "lower_a", intent: "lower", sequenceIndex: 1 },
        { slotId: "upper_b", intent: "upper", sequenceIndex: 2 },
      ],
    });

    expect(policy.futurePlanning.futureSlots).toEqual([
      {
        sessionIntent: "lower",
        slotId: "lower_a",
        sequenceIndex: 1,
        slotArchetype: "lower_squat_dominant",
        continuityScope: "slot",
        repeatedSlot: {
          occurrenceIndex: 0,
          totalSlots: 2,
        },
        compoundBias: {
          preferredMovementPatterns: ["squat"],
          preferredPrimaryMuscles: ["Quads"],
        },
        sessionShape: {
          id: "lower_squat_dominant",
          preferredAccessoryPrimaryMuscles: ["Quads", "Calves"],
          protectedWeekOneCoverageMuscles: ["Calves"],
          requiredMovementPatterns: ["hinge"],
          avoidDuplicatePatterns: ["squat"],
          supportPenaltyPatterns: ["hinge"],
          maxPreferredSupportPerPattern: 1,
        },
        compoundControl: {
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
      },
      {
        sessionIntent: "upper",
        slotId: "upper_b",
        sequenceIndex: 2,
        slotArchetype: "upper_vertical_balanced",
        continuityScope: "slot",
        repeatedSlot: {
          occurrenceIndex: 1,
          totalSlots: 2,
        },
        compoundBias: {
          preferredMovementPatterns: ["vertical_push", "vertical_pull"],
          preferredPrimaryMuscles: ["Chest"],
        },
        sessionShape: {
          id: "upper_vertical_balanced",
          preferredAccessoryPrimaryMuscles: ["Chest", "Triceps", "Side Delts"],
          protectedWeekOneCoverageMuscles: ["Chest", "Triceps", "Side Delts"],
          requiredMovementPatterns: ["horizontal_pull"],
          avoidDuplicatePatterns: ["vertical_push", "vertical_pull"],
          supportPenaltyPatterns: ["vertical_push", "vertical_pull"],
          maxPreferredSupportPerPattern: 1,
        },
        compoundControl: {
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
      },
    ]);
  });

  it("applies only a minimal future opportunity bias from preferred primary muscles", () => {
    const lowerB = resolveSessionSlotPolicy({
      sessionIntent: "lower",
      slotId: "lower_b",
      slotSequence,
    }).currentSession;

    expect(lowerB).not.toBeNull();
    if (!lowerB) {
      return;
    }

    expect(getFutureSlotOpportunityBias("Hamstrings", lowerB)).toBeGreaterThan(1);
    expect(getFutureSlotOpportunityBias("Glutes", lowerB)).toBe(1);
    expect(getFutureSlotOpportunityBias("Quads", lowerB)).toBe(1);
  });

  it("exposes only slot-compatible protected repair muscles", () => {
    const upperA = resolveSessionSlotPolicy({
      sessionIntent: "upper",
      slotId: "upper_a",
      slotSequence,
    }).currentSession;
    const upperB = resolveSessionSlotPolicy({
      sessionIntent: "upper",
      slotId: "upper_b",
      slotSequence,
    }).currentSession;
    const lowerA = resolveSessionSlotPolicy({
      sessionIntent: "lower",
      slotId: "lower_a",
      slotSequence,
    }).currentSession;
    const lowerB = resolveSessionSlotPolicy({
      sessionIntent: "lower",
      slotId: "lower_b",
      slotSequence,
    }).currentSession;

    expect(
      getProjectionRepairCompatibleMuscles(
        upperA,
        ["Chest", "Rear Delts", "Side Delts", "Triceps", "Hamstrings", "Calves"]
      )
    ).toEqual(["Chest", "Triceps", "Rear Delts"]);
    expect(
      getProjectionRepairCompatibleMuscles(upperB, ["Chest", "Rear Delts", "Side Delts", "Triceps", "Hamstrings", "Calves"])
    ).toEqual(["Chest", "Triceps", "Side Delts"]);
    expect(
      getProjectionRepairCompatibleMuscles(lowerA, ["Chest", "Triceps", "Hamstrings", "Calves"])
    ).toEqual(["Hamstrings", "Calves"]);
    expect(
      getProjectionRepairCompatibleMuscles(lowerB, ["Chest", "Triceps", "Hamstrings", "Calves"])
    ).toEqual(["Hamstrings", "Calves"]);
  });

  it("falls back to stronger protected coverage by archetype when authored support coverage is sparse", () => {
    const legacyLikeSlotSequence = {
      slots: [
        {
          slotId: "upper_a",
          intent: "upper",
          sequenceIndex: 0,
          authoredSemantics: {
            slotArchetype: "upper_horizontal_balanced" as const,
            continuityScope: "slot" as const,
            primaryLaneContract: null,
            supportCoverageContract: {
              preferredAccessoryPrimaryMuscles: ["Chest", "Upper Back", "Rear Delts"],
            },
          },
        },
        {
          slotId: "lower_a",
          intent: "lower",
          sequenceIndex: 1,
          authoredSemantics: {
            slotArchetype: "lower_squat_dominant" as const,
            continuityScope: "slot" as const,
            primaryLaneContract: null,
            supportCoverageContract: {
              preferredAccessoryPrimaryMuscles: ["Quads"],
            },
          },
        },
        {
          slotId: "upper_b",
          intent: "upper",
          sequenceIndex: 2,
          authoredSemantics: {
            slotArchetype: "upper_vertical_balanced" as const,
            continuityScope: "slot" as const,
            primaryLaneContract: null,
            supportCoverageContract: {
              preferredAccessoryPrimaryMuscles: ["Lats", "Front Delts", "Side Delts"],
            },
          },
        },
        {
          slotId: "lower_b",
          intent: "lower",
          sequenceIndex: 3,
          authoredSemantics: {
            slotArchetype: "lower_hinge_dominant" as const,
            continuityScope: "slot" as const,
            primaryLaneContract: null,
            supportCoverageContract: {
              preferredAccessoryPrimaryMuscles: ["Hamstrings", "Glutes"],
            },
          },
        },
      ],
    };

    const upperB = resolveSessionSlotPolicy({
      sessionIntent: "upper",
      slotId: "upper_b",
      slotSequence: legacyLikeSlotSequence,
    }).currentSession;
    const lowerB = resolveSessionSlotPolicy({
      sessionIntent: "lower",
      slotId: "lower_b",
      slotSequence: legacyLikeSlotSequence,
    }).currentSession;

    expect(
      getProjectionRepairCompatibleMuscles(
        upperB,
        ["Chest", "Side Delts", "Triceps", "Hamstrings", "Calves"]
      )
    ).toEqual(["Chest", "Triceps", "Side Delts"]);
    expect(
      getProjectionRepairCompatibleMuscles(
        lowerB,
        ["Chest", "Side Delts", "Triceps", "Hamstrings", "Calves"]
      )
    ).toEqual(["Hamstrings", "Calves"]);
  });

  it("normalizes persisted lower_b primary semantics to hamstring-led hinge", () => {
    const persistedSlotContract = resolveMesocycleSlotContract({
      slotSequenceJson: {
        version: 1,
        source: "handoff_draft",
        sequenceMode: "ordered_flexible",
        slots: [
          { slotId: "lower_a", intent: "LOWER" },
          {
            slotId: "lower_b",
            intent: "LOWER",
            authoredSemantics: {
              slotArchetype: "lower_hinge_dominant",
              continuityScope: "slot",
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
              supportCoverageContract: null,
            },
          },
        ],
      },
    });

    const lowerB = resolveSessionSlotPolicy({
      sessionIntent: "lower",
      slotId: "lower_b",
      slotSequence: persistedSlotContract,
    }).currentSession;

    expect(lowerB?.compoundBias?.preferredPrimaryMuscles).toEqual(["Hamstrings"]);
    expect(lowerB?.compoundControl?.lanes[0]?.preferredPrimaryMuscles).toEqual(["Hamstrings"]);
  });

  it("prioritizes protected coverage muscles on the current slot session shape only when requested", () => {
    const policy = resolveSessionSlotPolicy({
      sessionIntent: "upper",
      slotId: "upper_b",
      projectionRepairMuscles: ["Chest", "Triceps", "Hamstrings", "Calves"],
      slotSequence,
      futureSlots: [{ slotId: "lower_b", intent: "lower", sequenceIndex: 3 }],
    });

    expect(policy.currentSession?.sessionShape?.preferredAccessoryPrimaryMuscles).toEqual([
      "Chest",
      "Triceps",
      "Side Delts",
    ]);
    expect(
      policy.futurePlanning.futureSlots[0]?.sessionShape?.preferredAccessoryPrimaryMuscles
    ).toEqual(["Quads", "Calves"]);
  });

  it("resolves per-lane active tiers and allowed exercises from the canonical contract", () => {
    const slot = resolveSessionSlotPolicy({
      sessionIntent: "upper",
      slotId: "upper_b",
      slotSequence,
    }).currentSession;

    expect(slot).not.toBeNull();
    if (!slot) {
      return;
    }

    const compoundControl = resolveSessionSlotCompoundLaneState({
      slot,
      candidates: [
        makeCompoundCandidate({
          id: "ohp",
          movementPatterns: ["vertical_push"],
          primaryMuscles: ["Chest", "Front Delts"],
        }),
        makeCompoundCandidate({
          id: "bench",
          movementPatterns: ["horizontal_push"],
          primaryMuscles: ["Chest"],
        }),
        makeCompoundCandidate({
          id: "pulldown",
          movementPatterns: ["vertical_pull"],
          primaryMuscles: ["Lats"],
        }),
      ],
      getExercise: (candidate) => candidate,
      isCandidateViable: () => true,
    });

    expect(compoundControl).not.toBeNull();
    expect(compoundControl?.lanes).toEqual([
      {
        key: "press",
        preferredMovementPatterns: ["vertical_push"],
        compatibleMovementPatterns: [],
        fallbackOnlyMovementPatterns: ["horizontal_push"],
        preferredPrimaryMuscles: ["Chest"],
        activeTier: "preferred",
        viableCandidateCountByTier: {
          preferred: 1,
          compatible: 0,
          fallback_only: 1,
        },
      },
      {
        key: "pull",
        preferredMovementPatterns: ["vertical_pull"],
        compatibleMovementPatterns: [],
        fallbackOnlyMovementPatterns: ["horizontal_pull"],
        activeTier: "preferred",
        viableCandidateCountByTier: {
          preferred: 1,
          compatible: 0,
          fallback_only: 0,
        },
      },
    ]);

    expect(
      isExerciseAllowedForCompoundLaneSatisfaction(compoundControl, "press", {
        movementPatterns: ["vertical_push"],
        primaryMuscles: ["Chest"],
        isCompound: true,
      })
    ).toBe(true);
    expect(
      isExerciseAllowedForCompoundLaneSatisfaction(compoundControl, "press", {
        movementPatterns: ["horizontal_push"],
        primaryMuscles: ["Chest"],
        isCompound: true,
      })
    ).toBe(false);
    expect(
      isExerciseAllowedForAnyCompoundLaneSatisfaction(compoundControl, {
        movementPatterns: ["vertical_pull"],
        primaryMuscles: ["Lats"],
        isCompound: true,
      })
    ).toBe(true);
  });

  it("falls back per lane when higher tiers are not viable", () => {
    const slot = resolveSessionSlotPolicy({
      sessionIntent: "upper",
      slotId: "upper_b",
      slotSequence,
    }).currentSession;

    expect(slot).not.toBeNull();
    if (!slot) {
      return;
    }

    const compoundControl = resolveSessionSlotCompoundLaneState({
      slot,
      candidates: [
        makeCompoundCandidate({
          id: "bench",
          movementPatterns: ["horizontal_push"],
          primaryMuscles: ["Chest"],
        }),
        makeCompoundCandidate({
          id: "pulldown",
          movementPatterns: ["vertical_pull"],
          primaryMuscles: ["Lats"],
        }),
      ],
      getExercise: (candidate) => candidate,
      isCandidateViable: () => true,
    });

    expect(compoundControl?.lanes).toEqual([
      {
        key: "press",
        preferredMovementPatterns: ["vertical_push"],
        compatibleMovementPatterns: [],
        fallbackOnlyMovementPatterns: ["horizontal_push"],
        preferredPrimaryMuscles: ["Chest"],
        activeTier: "fallback_only",
        viableCandidateCountByTier: {
          preferred: 0,
          compatible: 0,
          fallback_only: 1,
        },
      },
      {
        key: "pull",
        preferredMovementPatterns: ["vertical_pull"],
        compatibleMovementPatterns: [],
        fallbackOnlyMovementPatterns: ["horizontal_pull"],
        activeTier: "preferred",
        viableCandidateCountByTier: {
          preferred: 1,
          compatible: 0,
          fallback_only: 0,
        },
      },
    ]);
  });

  it("classifies exercises into preferred and fallback-only tiers", () => {
    const slot = resolveSessionSlotPolicy({
      sessionIntent: "lower",
      slotId: "lower_b",
      slotSequence,
    }).currentSession;

    expect(slot?.compoundControl?.lanes[0]).toBeDefined();
    const lane = slot?.compoundControl?.lanes[0];
    if (!lane) {
      return;
    }

    expect(
      classifyExerciseForCompoundLane(
        {
          movementPatterns: ["hinge"],
          primaryMuscles: ["Hamstrings"],
          isCompound: true,
        },
        lane
      )
    ).toBe("preferred");
    expect(
      classifyExerciseForCompoundLane(
        {
          movementPatterns: ["squat"],
          primaryMuscles: ["Quads"],
          isCompound: true,
        },
        lane
      )
    ).toBe("fallback_only");
  });

  it("demotes preferred-pattern compounds when they miss the lane's preferred primary muscle", () => {
    const slot = resolveSessionSlotPolicy({
      sessionIntent: "upper",
      slotId: "upper_b",
      slotSequence,
    }).currentSession;

    expect(slot?.compoundControl?.lanes[0]).toBeDefined();
    const lane = slot?.compoundControl?.lanes[0];
    if (!lane) {
      return;
    }

    expect(
      classifyExerciseForCompoundLane(
        {
          movementPatterns: ["vertical_push"],
          primaryMuscles: ["Front Delts"],
          isCompound: true,
        },
        lane
      )
    ).toBe("compatible");
    expect(
      classifyExerciseForCompoundLane(
        {
          movementPatterns: ["vertical_push"],
          primaryMuscles: ["Chest", "Front Delts"],
          isCompound: true,
        },
        lane
      )
    ).toBe("preferred");
  });

  it("treats only compound exercises as required session-shape coverage satisfiers", () => {
    expect(
      doesExerciseSatisfyRequiredSessionShapePattern(
        {
          movementPatterns: ["horizontal_pull"],
          isCompound: true,
        },
        "horizontal_pull"
      )
    ).toBe(true);

    expect(
      doesExerciseSatisfyRequiredSessionShapePattern(
        {
          movementPatterns: ["horizontal_pull"],
          isCompound: false,
        },
        "horizontal_pull"
      )
    ).toBe(false);
  });
});
