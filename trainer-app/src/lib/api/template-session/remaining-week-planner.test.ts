import { describe, expect, it } from "vitest";
import {
  buildRemainingScheduleAfterPerformed,
  buildRemainingWeekVolumeContext,
} from "./remaining-week-planner";
import type { MappedGenerationContext } from "./types";
import type { SessionSlotPolicy } from "@/lib/planning/session-slot-profile";

describe("buildRemainingScheduleAfterPerformed", () => {
  it("preserves unresolved earlier slots for off-order sessions", () => {
    expect(
      buildRemainingScheduleAfterPerformed(["pull", "push", "legs"], ["pull", "legs"])
    ).toEqual(["push"]);
  });

  it("falls back to consuming the oldest unresolved slot when the performed intent is unexpected", () => {
    expect(
      buildRemainingScheduleAfterPerformed(["pull", "push", "legs"], ["full_body" as never])
    ).toEqual(["push", "legs"]);
  });
});

describe("buildRemainingWeekVolumeContext", () => {
  function makeMappedContext(): MappedGenerationContext {
    return {
      mappedProfile: {
        id: "user-1",
        trainingAge: "intermediate",
        injuries: [],
        weightKg: 80,
      },
      mappedGoals: {
        primary: "hypertrophy",
        secondary: "none",
        isHypertrophyFocused: true,
        isStrengthFocused: false,
      },
      mappedConstraints: {
        daysPerWeek: 4,
        splitType: "upper_lower",
        weeklySchedule: ["upper", "lower", "upper", "lower"],
      },
      mappedCheckIn: undefined,
      mappedPreferences: undefined,
      exerciseLibrary: [] as MappedGenerationContext["exerciseLibrary"],
      history: [],
      rawExercises: [],
      rawWorkouts: [],
      weekInBlock: 2,
      lifecycleWeek: 2,
      lifecycleRirTarget: { min: 2, max: 3 },
      lifecycleVolumeTargets: {
        Quads: 10,
        Hamstrings: 10,
        Glutes: 10,
      },
      sorenessSuppressedMuscles: [],
      activeMesocycle: null,
      mesocycleLength: 4,
      effectivePeriodization: {
        setMultiplier: 1.1,
        rpeOffset: 0,
        isDeload: false,
        backOffMultiplier: 0.9,
        lifecycleSetTargets: { main: 4, accessory: 3 },
      },
      adaptiveDeload: false,
      deloadDecision: {
        mode: "none",
        reason: [],
        reductionPercent: 0,
        appliedTo: "none",
      },
      blockContext: null,
      rotationContext: new Map(),
      cycleContext: {
        weekInMeso: 2,
        weekInBlock: 2,
        phase: "accumulation",
        blockType: "accumulation",
        isDeload: false,
        source: "computed",
      },
      mesocycleRoleMapByIntent: {
        push: new Map(),
        pull: new Map(),
        legs: new Map(),
        upper: new Map(),
        lower: new Map(),
        full_body: new Map(),
        body_part: new Map(),
      },
    };
  }

  it("applies a minimal future-slot primary-muscle bias from canonical slot policy", () => {
    const slotPolicy: SessionSlotPolicy = {
      currentSession: {
        sessionIntent: "lower",
        slotId: "lower_a",
        sequenceIndex: 1,
        continuityScope: "slot",
        repeatedSlot: {
          occurrenceIndex: 0,
          totalSlots: 2,
        },
        compoundBias: {
          preferredMovementPatterns: ["squat"],
          preferredPrimaryMuscles: ["Quads"],
        },
      },
      futurePlanning: {
        futureSlots: [
          {
            sessionIntent: "lower",
            slotId: "lower_b",
            sequenceIndex: 3,
            continuityScope: "slot",
            repeatedSlot: {
              occurrenceIndex: 1,
              totalSlots: 2,
            },
            compoundBias: {
              preferredMovementPatterns: ["hinge"],
              preferredPrimaryMuscles: ["Hamstrings", "Glutes"],
            },
          },
        ],
      },
    };

    const remainingWeek = buildRemainingWeekVolumeContext({
      mapped: makeMappedContext(),
      sessionIntent: "lower",
      slotPolicy,
      weeklyTarget: new Map([
        ["Quads", 10],
        ["Hamstrings", 10],
        ["Glutes", 10],
      ]),
      effectiveActual: new Map(),
      fatigueState: {
        readinessScore: 4,
        missedLastSession: false,
        painFlags: {},
      },
    });

    expect(remainingWeek).toBeDefined();
    if (!remainingWeek) {
      return;
    }

    expect(remainingWeek.futureSlots).toEqual(["lower"]);
    expect(
      remainingWeek.futureOpportunityUnits?.get("Hamstrings")
    ).toBeGreaterThan(remainingWeek.futureOpportunityUnits?.get("Quads") ?? 0);
    expect(
      remainingWeek.futureCapacity.get("Hamstrings")
    ).toBeGreaterThan(remainingWeek.futureCapacity.get("Quads") ?? 0);
  });
});
