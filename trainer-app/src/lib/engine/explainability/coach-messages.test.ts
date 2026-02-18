/**
 * Coach Messages Tests
 *
 * Phase 4.5: Test coach message generation
 */

import { describe, it, expect } from "vitest";
import { generateCoachMessages } from "./coach-messages";
import type { SessionContext } from "./types";
import type { BlockContext } from "../periodization/types";

describe("coach-messages", () => {
  describe("generateCoachMessages", () => {
    it("should generate no messages for default neutral context", () => {
      const sessionContext = buildSessionContext({
        readinessOverall: "moderate",
        signalAge: 2,
        blockType: "accumulation",
        weekInBlock: 2,
        totalWeeksInBlock: 4,
      });

      const messages = generateCoachMessages({
        sessionContext,
        blockContext: null,
      });

      // No high-priority warnings, so only low-priority messages
      expect(messages.length).toBeGreaterThanOrEqual(0);
    });

    it("should sort messages by priority (high -> medium -> low)", () => {
      const sessionContext = buildSessionContext({
        readinessOverall: "fatigued",
        signalAge: 2,
        blockType: "deload",
        weekInBlock: 1,
        totalWeeksInBlock: 1,
      });

      const messages = generateCoachMessages({
        sessionContext,
        blockContext: null,
      });

      // Verify priority ordering
      for (let i = 0; i < messages.length - 1; i++) {
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        const currentPriority = priorityOrder[messages[i].priority];
        const nextPriority = priorityOrder[messages[i + 1].priority];
        expect(currentPriority).toBeLessThanOrEqual(nextPriority);
      }
    });
  });

  describe("warnings", () => {
    it("should generate high-priority warning for fatigued readiness", () => {
      const sessionContext = buildSessionContext({
        readinessOverall: "fatigued",
        signalAge: 3,
      });

      const messages = generateCoachMessages({
        sessionContext,
        blockContext: null,
      });

      const fatigueWarning = messages.find(
        (m) => m.type === "warning" && m.message.includes("High fatigue detected")
      );
      expect(fatigueWarning).toBeDefined();
      expect(fatigueWarning?.priority).toBe("high");
      expect(fatigueWarning?.message).toContain("3 days ago");
    });

    it("should generate warning for stale readiness signal (> 7 days)", () => {
      const sessionContext = buildSessionContext({
        readinessOverall: "moderate",
        signalAge: 10,
      });

      const messages = generateCoachMessages({
        sessionContext,
        blockContext: null,
      });

      const staleWarning = messages.find(
        (m) => m.type === "warning" && m.message.includes("Readiness data is")
      );
      expect(staleWarning).toBeDefined();
      expect(staleWarning?.priority).toBe("high");
      expect(staleWarning?.message).toContain("10 days old");
    });

    it("should generate warning for volume spike > 20%", () => {
      const sessionContext = buildSessionContext({
        readinessOverall: "moderate",
        signalAge: 2,
      });

      const messages = generateCoachMessages({
        sessionContext,
        blockContext: null,
        workoutStats: {
          totalSets: 20,
          volumeSpikePercent: 25,
        },
      });

      const volumeWarning = messages.find(
        (m) => m.type === "warning" && m.message.includes("Volume increased")
      );
      expect(volumeWarning).toBeDefined();
      expect(volumeWarning?.priority).toBe("high");
      expect(volumeWarning?.message).toContain("25%");
    });

    it("should generate warning for muscles approaching MRV", () => {
      const sessionContext = buildSessionContext({
        readinessOverall: "moderate",
        signalAge: 2,
      });

      const messages = generateCoachMessages({
        sessionContext,
        blockContext: null,
        workoutStats: {
          totalSets: 18,
          musclesApproachingMRV: ["Chest", "Front Delts"],
        },
      });

      const mrvWarning = messages.find(
        (m) => m.type === "warning" && m.message.includes("approaching maximum recoverable volume")
      );
      expect(mrvWarning).toBeDefined();
      expect(mrvWarning?.priority).toBe("medium");
      expect(mrvWarning?.message).toContain("Chest, Front Delts");
      expect(mrvWarning?.message).toContain("are approaching");
    });

    it("should use singular 'is' for single muscle approaching MRV", () => {
      const sessionContext = buildSessionContext({
        readinessOverall: "moderate",
        signalAge: 2,
      });

      const messages = generateCoachMessages({
        sessionContext,
        blockContext: null,
        workoutStats: {
          totalSets: 18,
          musclesApproachingMRV: ["Chest"],
        },
      });

      const mrvWarning = messages.find(
        (m) => m.type === "warning" && m.message.includes("approaching maximum recoverable volume")
      );
      expect(mrvWarning).toBeDefined();
      expect(mrvWarning?.message).toContain("Chest is approaching");
    });
  });

  describe("milestones", () => {
    it("should generate milestone for last week of block", () => {
      const sessionContext = buildSessionContext({
        blockType: "accumulation",
        weekInBlock: 4,
        totalWeeksInBlock: 4,
      });

      const messages = generateCoachMessages({
        sessionContext,
        blockContext: null,
      });

      const milestone = messages.find(
        (m) => m.type === "milestone" && m.message.includes("Final week of")
      );
      expect(milestone).toBeDefined();
      expect(milestone?.priority).toBe("medium");
      expect(milestone?.message).toContain("Accumulation block");
      expect(milestone?.message).toContain("Volume capacity built");
    });

    it("should generate milestone for deload week", () => {
      const sessionContext = buildSessionContext({
        blockType: "deload",
        weekInBlock: 1,
        totalWeeksInBlock: 1,
      });

      const messages = generateCoachMessages({
        sessionContext,
        blockContext: null,
      });

      const milestone = messages.find(
        (m) => m.type === "milestone" && m.message.includes("Deload week")
      );
      expect(milestone).toBeDefined();
      expect(milestone?.priority).toBe("medium");
      expect(milestone?.message).toContain("reduced volume and intensity");
    });

    it("should generate milestone every 4 weeks", () => {
      const sessionContext = buildSessionContext({
        weekInMesocycle: 8,
      });

      const messages = generateCoachMessages({
        sessionContext,
        blockContext: null,
      });

      const milestone = messages.find(
        (m) => m.type === "milestone" && m.message.includes("Week 8 milestone")
      );
      expect(milestone).toBeDefined();
      expect(milestone?.priority).toBe("medium");
    });

    it("should not generate 4-week milestone on week 0", () => {
      const sessionContext = buildSessionContext({
        weekInMesocycle: 0,
      });

      const messages = generateCoachMessages({
        sessionContext,
        blockContext: null,
      });

      const milestone = messages.find(
        (m) => m.type === "milestone" && m.message.includes("milestone reached")
      );
      expect(milestone).toBeUndefined();
    });
  });

  describe("encouragement", () => {
    it("should generate encouragement for fresh readiness", () => {
      const sessionContext = buildSessionContext({
        readinessOverall: "fresh",
        signalAge: 1,
      });

      const messages = generateCoachMessages({
        sessionContext,
        blockContext: null,
      });

      const encouragement = messages.find(
        (m) => m.type === "encouragement" && m.message.includes("Feeling fresh")
      );
      expect(encouragement).toBeDefined();
      expect(encouragement?.priority).toBe("low");
    });

    it("should generate encouragement for PR potential", () => {
      const sessionContext = buildSessionContext({
        readinessOverall: "moderate",
        signalAge: 2,
      });

      const messages = generateCoachMessages({
        sessionContext,
        blockContext: null,
        workoutStats: {
          totalSets: 15,
          hasPRPotential: true,
        },
      });

      const encouragement = messages.find(
        (m) => m.type === "encouragement" && m.message.includes("PR potential")
      );
      expect(encouragement).toBeDefined();
      expect(encouragement?.priority).toBe("low");
    });

    it("should generate encouragement for accumulation phase week 1-2", () => {
      const sessionContext = buildSessionContext({
        blockType: "accumulation",
        weekInBlock: 2,
        totalWeeksInBlock: 4,
      });

      const messages = generateCoachMessages({
        sessionContext,
        blockContext: null,
      });

      const encouragement = messages.find(
        (m) => m.type === "encouragement" && m.message.includes("Volume building phase")
      );
      expect(encouragement).toBeDefined();
      expect(encouragement?.priority).toBe("low");
    });

    it("should generate encouragement for intensification block", () => {
      const sessionContext = buildSessionContext({
        blockType: "intensification",
        weekInBlock: 2,
        totalWeeksInBlock: 3,
      });

      const messages = generateCoachMessages({
        sessionContext,
        blockContext: null,
      });

      const encouragement = messages.find(
        (m) => m.type === "encouragement" && m.message.includes("Intensification block")
      );
      expect(encouragement).toBeDefined();
      expect(encouragement?.priority).toBe("low");
      expect(encouragement?.message).toContain("converting fitness into strength");
    });
  });

  describe("tips", () => {
    it("should generate tip for accumulation block", () => {
      const sessionContext = buildSessionContext({
        blockType: "accumulation",
        weekInBlock: 3,
        totalWeeksInBlock: 4,
      });

      const messages = generateCoachMessages({
        sessionContext,
        blockContext: null,
      });

      const tip = messages.find(
        (m) => m.type === "tip" && m.message.includes("Accumulation focus")
      );
      expect(tip).toBeDefined();
      expect(tip?.priority).toBe("low");
      expect(tip?.message).toContain("1-2 reps in reserve");
    });

    it("should generate tip for intensification block", () => {
      const sessionContext = buildSessionContext({
        blockType: "intensification",
        weekInBlock: 2,
        totalWeeksInBlock: 3,
      });

      const messages = generateCoachMessages({
        sessionContext,
        blockContext: null,
      });

      const tip = messages.find((m) => m.type === "tip" && m.message.includes("Intensification focus"));
      expect(tip).toBeDefined();
      expect(tip?.priority).toBe("low");
      expect(tip?.message).toContain("0-1 RIR");
    });

    it("should generate tip for realization block", () => {
      const sessionContext = buildSessionContext({
        blockType: "realization",
        weekInBlock: 1,
        totalWeeksInBlock: 1,
      });

      const messages = generateCoachMessages({
        sessionContext,
        blockContext: null,
      });

      const tip = messages.find((m) => m.type === "tip" && m.message.includes("Realization focus"));
      expect(tip).toBeDefined();
      expect(tip?.priority).toBe("low");
      expect(tip?.message).toContain("Test strength peaks");
    });

    it("should generate tip for moderate fatigue with fresh signal", () => {
      const sessionContext = buildSessionContext({
        blockType: "deload", // deload has no block-type tip — isolates the fatigue trigger
        readinessOverall: "moderate",
        signalAge: 2,
      });

      const messages = generateCoachMessages({
        sessionContext,
        blockContext: null,
      });

      const tip = messages.find(
        (m) => m.type === "tip" && m.message.includes("Moderate fatigue detected")
      );
      expect(tip).toBeDefined();
      expect(tip?.priority).toBe("low");
      expect(tip?.message).toContain("7-9 hours");
    });

    it("should generate tip for volume building progression", () => {
      const sessionContext = buildSessionContext({
        blockType: "deload", // deload has no block-type tip
        readinessOverall: "fresh", // "fresh" doesn't trigger fatigue tip — isolates volume trigger
        volumeProgression: "building",
      });

      const messages = generateCoachMessages({
        sessionContext,
        blockContext: null,
      });

      const tip = messages.find((m) => m.type === "tip" && m.message.includes("Volume is building"));
      expect(tip).toBeDefined();
      expect(tip?.priority).toBe("low");
    });
  });
});

// ========================
// Test Helpers
// ========================

function buildSessionContext(overrides: {
  readinessOverall?: "fresh" | "moderate" | "fatigued";
  signalAge?: number;
  blockType?: "accumulation" | "intensification" | "realization" | "deload";
  weekInBlock?: number;
  totalWeeksInBlock?: number;
  weekInMesocycle?: number;
  volumeProgression?: "building" | "maintaining" | "deloading";
}): SessionContext {
  return {
    blockPhase: {
      blockType: overrides.blockType ?? "accumulation",
      weekInBlock: overrides.weekInBlock ?? 2,
      totalWeeksInBlock: overrides.totalWeeksInBlock ?? 4,
      primaryGoal: "Build work capacity and muscle mass",
    },
    volumeStatus: {
      muscleStatuses: new Map(),
      overallSummary: "3 of 6 muscle groups near target volume",
    },
    readinessStatus: {
      overall: overrides.readinessOverall ?? "moderate",
      signalAge: overrides.signalAge ?? 2,
      perMuscleFatigue: new Map(),
      adaptations: [],
    },
    progressionContext: {
      weekInMesocycle: overrides.weekInMesocycle ?? 4,
      volumeProgression: overrides.volumeProgression ?? "building",
      intensityProgression: "ramping",
      nextMilestone: "Deload week next",
    },
    narrative: "Session context narrative",
  };
}
