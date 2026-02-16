/**
 * Session Context Explanation Tests
 *
 * Phase 4.2: Test session context generation
 */

import { describe, it, expect } from "vitest";
import {
  explainSessionContext,
  describeBlockGoal,
  describeVolumeProgress,
  describeReadinessStatus,
  describeProgressionContext,
} from "./session-context";
import type { BlockContext } from "../periodization/types";
import type { FatigueScore, AutoregulationModification } from "../readiness/types";

describe("session-context", () => {
  describe("describeBlockGoal", () => {
    it("should return default accumulation for null block context", () => {
      const result = describeBlockGoal(null);

      expect(result.blockType).toBe("accumulation");
      expect(result.weekInBlock).toBe(1);
      expect(result.totalWeeksInBlock).toBe(4);
      expect(result.primaryGoal).toContain("Build work capacity");
    });

    it("should describe accumulation block correctly", () => {
      const blockContext: BlockContext = {
        block: {
          id: "block1",
          mesocycleId: "meso1",
          blockNumber: 1,
          blockType: "accumulation",
          startWeek: 0,
          durationWeeks: 4,
          volumeTarget: "moderate",
          intensityBias: "hypertrophy",
          adaptationType: "myofibrillar_hypertrophy",
        },
        weekInBlock: 2,
        weekInMeso: 2,
        weekInMacro: 2,
        mesocycle: {
          id: "meso1",
          macroCycleId: "macro1",
          mesoNumber: 1,
          startWeek: 0,
          durationWeeks: 8,
          focus: "Full Body Hypertrophy",
          volumeTarget: "moderate",
          intensityBias: "hypertrophy",
          blocks: [],
        },
        macroCycle: {
          id: "macro1",
          userId: "user1",
          startDate: new Date("2026-01-01"),
          endDate: new Date("2026-03-01"),
          durationWeeks: 8,
          trainingAge: "intermediate",
          primaryGoal: "hypertrophy",
          mesocycles: [],
        },
      };

      const result = describeBlockGoal(blockContext);

      expect(result.blockType).toBe("accumulation");
      expect(result.weekInBlock).toBe(2);
      expect(result.totalWeeksInBlock).toBe(4);
      expect(result.primaryGoal).toContain("Build work capacity");
    });

    it("should describe intensification block correctly", () => {
      const blockContext: BlockContext = {
        block: {
          id: "block2",
          mesocycleId: "meso1",
          blockNumber: 2,
          blockType: "intensification",
          startWeek: 4,
          durationWeeks: 2,
          volumeTarget: "moderate",
          intensityBias: "strength",
          adaptationType: "neural_adaptation",
        },
        weekInBlock: 1,
        weekInMeso: 5,
        weekInMacro: 5,
        mesocycle: {
          id: "meso1",
          macroCycleId: "macro1",
          mesoNumber: 1,
          startWeek: 0,
          durationWeeks: 8,
          focus: "Strength Development",
          volumeTarget: "moderate",
          intensityBias: "strength",
          blocks: [],
        },
        macroCycle: {
          id: "macro1",
          userId: "user1",
          startDate: new Date("2026-01-01"),
          endDate: new Date("2026-03-01"),
          durationWeeks: 8,
          trainingAge: "intermediate",
          primaryGoal: "strength",
          mesocycles: [],
        },
      };

      const result = describeBlockGoal(blockContext);

      expect(result.blockType).toBe("intensification");
      expect(result.primaryGoal).toContain("Convert fitness into strength");
    });

    it("should describe realization block correctly", () => {
      const blockContext: BlockContext = {
        block: {
          id: "block3",
          mesocycleId: "meso1",
          blockNumber: 3,
          blockType: "realization",
          startWeek: 6,
          durationWeeks: 1,
          volumeTarget: "low",
          intensityBias: "strength",
          adaptationType: "neural_adaptation",
        },
        weekInBlock: 1,
        weekInMeso: 7,
        weekInMacro: 7,
        mesocycle: {
          id: "meso1",
          macroCycleId: "macro1",
          mesoNumber: 1,
          startWeek: 0,
          durationWeeks: 8,
          focus: "Peak Strength",
          volumeTarget: "low",
          intensityBias: "strength",
          blocks: [],
        },
        macroCycle: {
          id: "macro1",
          userId: "user1",
          startDate: new Date("2026-01-01"),
          endDate: new Date("2026-03-01"),
          durationWeeks: 8,
          trainingAge: "advanced",
          primaryGoal: "strength",
          mesocycles: [],
        },
      };

      const result = describeBlockGoal(blockContext);

      expect(result.blockType).toBe("realization");
      expect(result.primaryGoal).toContain("Peak strength");
    });

    it("should describe deload block correctly", () => {
      const blockContext: BlockContext = {
        block: {
          id: "block4",
          mesocycleId: "meso1",
          blockNumber: 4,
          blockType: "deload",
          startWeek: 7,
          durationWeeks: 1,
          volumeTarget: "low",
          intensityBias: "hypertrophy",
          adaptationType: "recovery",
        },
        weekInBlock: 1,
        weekInMeso: 8,
        weekInMacro: 8,
        mesocycle: {
          id: "meso1",
          macroCycleId: "macro1",
          mesoNumber: 1,
          startWeek: 0,
          durationWeeks: 8,
          focus: "Recovery",
          volumeTarget: "low",
          intensityBias: "hypertrophy",
          blocks: [],
        },
        macroCycle: {
          id: "macro1",
          userId: "user1",
          startDate: new Date("2026-01-01"),
          endDate: new Date("2026-03-01"),
          durationWeeks: 8,
          trainingAge: "intermediate",
          primaryGoal: "hypertrophy",
          mesocycles: [],
        },
      };

      const result = describeBlockGoal(blockContext);

      expect(result.blockType).toBe("deload");
      expect(result.primaryGoal).toContain("Recover and dissipate fatigue");
    });
  });

  describe("describeVolumeProgress", () => {
    it("should classify volume below MEV correctly", () => {
      const volumeByMuscle = new Map([
        ["Chest", 5], // MEV = 10, so below MEV
        ["Biceps", 4], // MEV = 8, so below MEV
      ]);

      const result = describeVolumeProgress(volumeByMuscle);

      const chestStatus = result.muscleStatuses.get("Chest");
      expect(chestStatus?.status).toBe("below_mev");
      expect(chestStatus?.currentSets).toBe(5);
      expect(chestStatus?.targetRange.min).toBe(10); // MEV

      const bicepsStatus = result.muscleStatuses.get("Biceps");
      expect(bicepsStatus?.status).toBe("below_mev");
    });

    it("should classify volume at MEV correctly", () => {
      const volumeByMuscle = new Map([
        ["Chest", 10], // Exactly at MEV
        ["Biceps", 8], // Exactly at MEV
      ]);

      const result = describeVolumeProgress(volumeByMuscle);

      expect(result.muscleStatuses.get("Chest")?.status).toBe("at_mev");
      expect(result.muscleStatuses.get("Biceps")?.status).toBe("at_mev");
      expect(result.overallSummary).toContain("2 of 2");
    });

    it("should classify optimal volume correctly", () => {
      const volumeByMuscle = new Map([
        ["Chest", 13], // Between MEV (10) and MAV (16)
        ["Biceps", 12], // Between MEV (8) and MAV (17)
      ]);

      const result = describeVolumeProgress(volumeByMuscle);

      expect(result.muscleStatuses.get("Chest")?.status).toBe("optimal");
      expect(result.muscleStatuses.get("Biceps")?.status).toBe("optimal");
      expect(result.overallSummary).toContain("2 of 2");
    });

    it("should classify approaching MRV correctly", () => {
      const volumeByMuscle = new Map([
        ["Chest", 18], // Between MAV (16) and MRV (22)
        ["Biceps", 20], // Between MAV (17) and MRV (26)
      ]);

      const result = describeVolumeProgress(volumeByMuscle);

      expect(result.muscleStatuses.get("Chest")?.status).toBe("approaching_mrv");
      expect(result.muscleStatuses.get("Biceps")?.status).toBe("approaching_mrv");
    });

    it("should classify at MRV correctly", () => {
      const volumeByMuscle = new Map([
        ["Chest", 22], // At MRV
        ["Biceps", 26], // At MRV
      ]);

      const result = describeVolumeProgress(volumeByMuscle);

      expect(result.muscleStatuses.get("Chest")?.status).toBe("at_mrv");
      expect(result.muscleStatuses.get("Biceps")?.status).toBe("at_mrv");
    });

    it("should handle empty volume map", () => {
      const volumeByMuscle = new Map<string, number>();

      const result = describeVolumeProgress(volumeByMuscle);

      expect(result.muscleStatuses.size).toBe(0);
      expect(result.overallSummary).toBe("No volume data available");
    });

    it("should skip unknown muscles", () => {
      const volumeByMuscle = new Map([
        ["Chest", 12],
        ["UnknownMuscle", 10],
      ]);

      const result = describeVolumeProgress(volumeByMuscle);

      expect(result.muscleStatuses.has("Chest")).toBe(true);
      expect(result.muscleStatuses.has("UnknownMuscle")).toBe(false);
    });
  });

  describe("describeReadinessStatus", () => {
    it("should return moderate readiness when no fatigue score provided", () => {
      const result = describeReadinessStatus({});

      expect(result.overall).toBe("moderate");
      expect(result.signalAge).toBe(0);
      expect(result.perMuscleFatigue.size).toBe(0);
      expect(result.adaptations).toEqual([]);
    });

    it("should classify fresh readiness correctly", () => {
      const fatigueScore: FatigueScore = {
        overall: 0.85, // >= 0.75 → fresh
        perMuscle: {
          Chest: 0.9,
          Biceps: 0.8,
        },
        weights: { whoop: 0, subjective: 0.6, performance: 0.4 },
        components: { whoopContribution: 0, subjectiveContribution: 0.51, performanceContribution: 0.34 },
      };

      const result = describeReadinessStatus({ fatigueScore });

      expect(result.overall).toBe("fresh");
      expect(result.perMuscleFatigue.get("Chest")).toBe(1); // (1 - 0.9) * 10 = 1
      expect(result.perMuscleFatigue.get("Biceps")).toBe(2); // (1 - 0.8) * 10 = 2
    });

    it("should classify moderate readiness correctly", () => {
      const fatigueScore: FatigueScore = {
        overall: 0.6, // >= 0.5 and < 0.75 → moderate
        perMuscle: { Chest: 0.6 },
        weights: { whoop: 0, subjective: 0.6, performance: 0.4 },
        components: { whoopContribution: 0, subjectiveContribution: 0.36, performanceContribution: 0.24 },
      };

      const result = describeReadinessStatus({ fatigueScore });

      expect(result.overall).toBe("moderate");
    });

    it("should classify fatigued readiness correctly", () => {
      const fatigueScore: FatigueScore = {
        overall: 0.4, // < 0.5 → fatigued
        perMuscle: { Chest: 0.3 },
        weights: { whoop: 0, subjective: 0.6, performance: 0.4 },
        components: { whoopContribution: 0, subjectiveContribution: 0.24, performanceContribution: 0.16 },
      };

      const result = describeReadinessStatus({ fatigueScore });

      expect(result.overall).toBe("fatigued");
    });

    it("should summarize volume reduction modifications", () => {
      const fatigueScore: FatigueScore = {
        overall: 0.5,
        perMuscle: {},
        weights: { whoop: 0, subjective: 0.6, performance: 0.4 },
        components: { whoopContribution: 0, subjectiveContribution: 0.3, performanceContribution: 0.2 },
      };

      const modifications: AutoregulationModification[] = [
        {
          type: "volume_reduction",
          exerciseId: "ex1",
          exerciseName: "Bench Press",
          setsCut: 2,
          originalSetCount: 4,
          adjustedSetCount: 2,
          reason: "Elevated fatigue",
        },
        {
          type: "volume_reduction",
          exerciseId: "ex2",
          exerciseName: "Cable Fly",
          setsCut: 1,
          originalSetCount: 3,
          adjustedSetCount: 2,
          reason: "Elevated fatigue",
        },
      ];

      const result = describeReadinessStatus({ fatigueScore, modifications });

      expect(result.adaptations).toContain("Reduced volume by 3 sets");
    });

    it("should summarize intensity scaling modifications", () => {
      const fatigueScore: FatigueScore = {
        overall: 0.5,
        perMuscle: {},
        weights: { whoop: 0, subjective: 0.6, performance: 0.4 },
        components: { whoopContribution: 0, subjectiveContribution: 0.3, performanceContribution: 0.2 },
      };

      const modifications: AutoregulationModification[] = [
        {
          type: "intensity_scale",
          exerciseId: "ex1",
          exerciseName: "Squat",
          direction: "down",
          scalar: 0.9,
          originalLoad: 100,
          adjustedLoad: 90,
          reason: "Elevated fatigue",
        },
        {
          type: "intensity_scale",
          exerciseId: "ex2",
          exerciseName: "Deadlift",
          direction: "up",
          scalar: 1.05,
          originalLoad: 100,
          adjustedLoad: 105,
          reason: "Feeling strong",
        },
      ];

      const result = describeReadinessStatus({ fatigueScore, modifications });

      expect(result.adaptations).toContain("Scaled down 1 exercise");
      expect(result.adaptations).toContain("Scaled up 1 exercise");
    });

    it("should summarize deload trigger", () => {
      const fatigueScore: FatigueScore = {
        overall: 0.2,
        perMuscle: {},
        weights: { whoop: 0, subjective: 0.6, performance: 0.4 },
        components: { whoopContribution: 0, subjectiveContribution: 0.12, performanceContribution: 0.08 },
      };

      const modifications: AutoregulationModification[] = [
        {
          type: "deload_trigger",
          reason: "Fatigue score below threshold",
        },
      ];

      const result = describeReadinessStatus({ fatigueScore, modifications });

      expect(result.adaptations).toContain("Triggered deload due to elevated fatigue");
    });

    it("should include signal age", () => {
      const fatigueScore: FatigueScore = {
        overall: 0.7,
        perMuscle: {},
        weights: { whoop: 0, subjective: 0.6, performance: 0.4 },
        components: { whoopContribution: 0, subjectiveContribution: 0.42, performanceContribution: 0.28 },
      };

      const result = describeReadinessStatus({ fatigueScore, signalAge: 3 });

      expect(result.signalAge).toBe(3);
    });
  });

  describe("describeProgressionContext", () => {
    it("should return default progression for null block context", () => {
      const result = describeProgressionContext(null);

      expect(result.weekInMesocycle).toBe(1);
      expect(result.volumeProgression).toBe("building");
      expect(result.intensityProgression).toBe("ramping");
      expect(result.nextMilestone).toContain("Continue building");
    });

    it("should describe accumulation progression correctly", () => {
      const blockContext: BlockContext = {
        block: {
          id: "block1",
          mesocycleId: "meso1",
          blockNumber: 1,
          blockType: "accumulation",
          startWeek: 0,
          durationWeeks: 4,
          volumeTarget: "moderate",
          intensityBias: "hypertrophy",
          adaptationType: "myofibrillar_hypertrophy",
        },
        weekInBlock: 2,
        weekInMeso: 2,
        weekInMacro: 2,
        mesocycle: {
          id: "meso1",
          macroCycleId: "macro1",
          mesoNumber: 1,
          startWeek: 0,
          durationWeeks: 8,
          focus: "Hypertrophy",
          volumeTarget: "moderate",
          intensityBias: "hypertrophy",
          blocks: [],
        },
        macroCycle: {
          id: "macro1",
          userId: "user1",
          startDate: new Date("2026-01-01"),
          endDate: new Date("2026-03-01"),
          durationWeeks: 8,
          trainingAge: "intermediate",
          primaryGoal: "hypertrophy",
          mesocycles: [],
        },
      };

      const result = describeProgressionContext(blockContext);

      expect(result.weekInMesocycle).toBe(2);
      expect(result.volumeProgression).toBe("building");
      expect(result.intensityProgression).toBe("ramping");
      expect(result.nextMilestone).toContain("2 more weeks");
    });

    it("should describe deload progression correctly", () => {
      const blockContext: BlockContext = {
        block: {
          id: "block4",
          mesocycleId: "meso1",
          blockNumber: 4,
          blockType: "deload",
          startWeek: 7,
          durationWeeks: 1,
          volumeTarget: "low",
          intensityBias: "hypertrophy",
          adaptationType: "recovery",
        },
        weekInBlock: 1,
        weekInMeso: 8,
        weekInMacro: 8,
        mesocycle: {
          id: "meso1",
          macroCycleId: "macro1",
          mesoNumber: 1,
          startWeek: 0,
          durationWeeks: 8,
          focus: "Recovery",
          volumeTarget: "low",
          intensityBias: "hypertrophy",
          blocks: [],
        },
        macroCycle: {
          id: "macro1",
          userId: "user1",
          startDate: new Date("2026-01-01"),
          endDate: new Date("2026-03-01"),
          durationWeeks: 8,
          trainingAge: "intermediate",
          primaryGoal: "hypertrophy",
          mesocycles: [],
        },
      };

      const result = describeProgressionContext(blockContext);

      expect(result.volumeProgression).toBe("deloading");
      expect(result.intensityProgression).toBe("reduced");
      expect(result.nextMilestone).toContain("New training block");
    });
  });

  describe("explainSessionContext (integration)", () => {
    it("should generate complete session context", () => {
      const blockContext: BlockContext = {
        block: {
          id: "block1",
          mesocycleId: "meso1",
          blockNumber: 1,
          blockType: "accumulation",
          startWeek: 0,
          durationWeeks: 4,
          volumeTarget: "moderate",
          intensityBias: "hypertrophy",
          adaptationType: "myofibrillar_hypertrophy",
        },
        weekInBlock: 2,
        weekInMeso: 2,
        weekInMacro: 2,
        mesocycle: {
          id: "meso1",
          macroCycleId: "macro1",
          mesoNumber: 1,
          startWeek: 0,
          durationWeeks: 8,
          focus: "Hypertrophy",
          volumeTarget: "moderate",
          intensityBias: "hypertrophy",
          blocks: [],
        },
        macroCycle: {
          id: "macro1",
          userId: "user1",
          startDate: new Date("2026-01-01"),
          endDate: new Date("2026-03-01"),
          durationWeeks: 8,
          trainingAge: "intermediate",
          primaryGoal: "hypertrophy",
          mesocycles: [],
        },
      };

      const volumeByMuscle = new Map([
        ["Chest", 12],
        ["Biceps", 10],
      ]);

      const result = explainSessionContext({ blockContext, volumeByMuscle });

      expect(result.blockPhase.blockType).toBe("accumulation");
      expect(result.volumeStatus.muscleStatuses.size).toBe(2);
      expect(result.readinessStatus.overall).toBe("moderate");
      expect(result.progressionContext.volumeProgression).toBe("building");
      expect(result.narrative).toContain("Accumulation");
      expect(result.narrative).toContain("Week 2 of 4");
    });

    it("should include autoregulation adaptations in narrative", () => {
      const volumeByMuscle = new Map([["Chest", 12]]);

      const fatigueScore: FatigueScore = {
        overall: 0.4,
        perMuscle: { Chest: 0.3 },
        weights: { whoop: 0, subjective: 0.6, performance: 0.4 },
        components: { whoopContribution: 0, subjectiveContribution: 0.24, performanceContribution: 0.16 },
      };

      const modifications: AutoregulationModification[] = [
        {
          type: "volume_reduction",
          exerciseId: "ex1",
          exerciseName: "Bench Press",
          setsCut: 2,
          originalSetCount: 4,
          adjustedSetCount: 2,
          reason: "Elevated fatigue",
        },
      ];

      const result = explainSessionContext({
        blockContext: null,
        volumeByMuscle,
        fatigueScore,
        modifications,
      });

      expect(result.narrative).toContain("Reduced volume by 2 sets");
    });
  });
});
