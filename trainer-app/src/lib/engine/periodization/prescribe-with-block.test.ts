import { describe, expect, it } from "vitest";
import { prescribeWithBlock, type BasePrescription } from "./prescribe-with-block";
import { generateMacroCycle } from "./generate-macro";
import { deriveBlockContext } from "./block-context";

describe("prescribeWithBlock", () => {
  const basePrescription: BasePrescription = {
    sets: 4,
    reps: 8,
    rir: 2,
    restSec: 120,
  };

  describe("Null block context (backward compatibility)", () => {
    it("should return base prescription unchanged when blockContext is null", () => {
      const result = prescribeWithBlock({
        basePrescription,
        blockContext: null,
      });

      expect(result).toEqual(basePrescription);
    });
  });

  describe("Accumulation block modifiers", () => {
    it("should increase volume and reduce intensity in week 1", () => {
      const macro = generateMacroCycle({
        userId: "user-123",
        startDate: new Date("2026-03-01"),
        durationWeeks: 12,
        trainingAge: "beginner",
        primaryGoal: "hypertrophy",
      });

      // Week 1 - accumulation block
      const blockContext = deriveBlockContext(macro, new Date("2026-03-02"));

      const result = prescribeWithBlock({
        basePrescription,
        blockContext,
      });

      // Accumulation: volumeMultiplier = 1.0 → 1.2, rirAdjustment = +2
      expect(result.sets).toBe(4); // 4 * 1.0 (week 1 progress = 0) = 4
      expect(result.reps).toBe(8); // Unchanged
      expect(result.rir).toBe(4); // 2 + 2 = 4
      expect(result.restSec).toBeLessThan(120); // restMultiplier = 0.9
    });

    it("should progressively increase volume through accumulation block", () => {
      const macro = generateMacroCycle({
        userId: "user-123",
        startDate: new Date("2026-03-01"),
        durationWeeks: 12,
        trainingAge: "beginner",
        primaryGoal: "hypertrophy",
      });

      // Week 3 - end of accumulation (higher volume)
      const blockContext = deriveBlockContext(macro, new Date("2026-03-16"));

      const result = prescribeWithBlock({
        basePrescription,
        blockContext,
      });

      // Week 3 progress = (3-1)/(3-1) = 1.0, volumeMultiplier = 1.0 + 1.0 * 0.2 = 1.2
      expect(result.sets).toBe(5); // 4 * 1.2 = 4.8 → 5
      expect(result.rir).toBe(4); // 2 + 2 = 4
    });

    it("should maintain RIR +2 adjustment throughout accumulation", () => {
      const macro = generateMacroCycle({
        userId: "user-123",
        startDate: new Date("2026-03-01"),
        durationWeeks: 12,
        trainingAge: "beginner",
        primaryGoal: "hypertrophy",
      });

      const contexts = [
        deriveBlockContext(macro, new Date("2026-03-02")), // Week 1
        deriveBlockContext(macro, new Date("2026-03-09")), // Week 2
        deriveBlockContext(macro, new Date("2026-03-16")), // Week 3
      ];

      contexts.forEach((ctx) => {
        const result = prescribeWithBlock({
          basePrescription,
          blockContext: ctx,
        });
        expect(result.rir).toBe(4); // Always RIR +2 in accumulation
      });
    });
  });

  describe("Intensification block modifiers", () => {
    it("should reduce volume and increase intensity", () => {
      const macro = generateMacroCycle({
        userId: "user-123",
        startDate: new Date("2026-03-01"),
        durationWeeks: 15,
        trainingAge: "intermediate",
        primaryGoal: "hypertrophy",
      });

      // Week 3 - start of intensification block
      const blockContext = deriveBlockContext(macro, new Date("2026-03-16"));

      const result = prescribeWithBlock({
        basePrescription,
        blockContext,
      });

      // Intensification week 1: volumeMultiplier = 1.0, rirAdjustment = +1
      expect(result.sets).toBe(4); // 4 * 1.0 = 4
      expect(result.rir).toBe(3); // 2 + 1 = 3
      expect(result.restSec).toBe(120); // restMultiplier = 1.0
    });

    it("should progressively reduce volume through intensification block", () => {
      const macro = generateMacroCycle({
        userId: "user-123",
        startDate: new Date("2026-03-01"),
        durationWeeks: 15,
        trainingAge: "intermediate",
        primaryGoal: "hypertrophy",
      });

      // Week 4 - end of intensification
      const blockContext = deriveBlockContext(macro, new Date("2026-03-23"));

      const result = prescribeWithBlock({
        basePrescription,
        blockContext,
      });

      // Week 2 of int, progress = 1.0, volumeMultiplier = 1.0 - 1.0 * 0.2 = 0.8
      expect(result.sets).toBe(3); // 4 * 0.8 = 3.2 → 3
      expect(result.rir).toBe(3); // 2 + 1 = 3
    });
  });

  describe("Realization block modifiers", () => {
    it("should minimize volume and maximize intensity", () => {
      const macro = generateMacroCycle({
        userId: "user-123",
        startDate: new Date("2026-03-01"),
        durationWeeks: 18,
        trainingAge: "advanced",
        primaryGoal: "strength",
      });

      // Week 5 - realization block
      const blockContext = deriveBlockContext(macro, new Date("2026-03-30"));

      const result = prescribeWithBlock({
        basePrescription,
        blockContext,
      });

      // Realization: volumeMultiplier = 0.6 → 0.7, rirAdjustment = 0
      expect(result.sets).toBe(2); // 4 * 0.6 = 2.4 → 2
      expect(result.rir).toBe(2); // 2 + 0 = 2 (close to failure)
      expect(result.restSec).toBeGreaterThan(120); // restMultiplier = 1.2 (longer rest)
    });

    it("should not adjust RIR (go close to failure)", () => {
      const macro = generateMacroCycle({
        userId: "user-123",
        startDate: new Date("2026-03-01"),
        durationWeeks: 18,
        trainingAge: "advanced",
        primaryGoal: "strength",
      });

      const blockContext = deriveBlockContext(macro, new Date("2026-03-30"));

      const result = prescribeWithBlock({
        basePrescription: { ...basePrescription, rir: 1 },
        blockContext,
      });

      expect(result.rir).toBe(1); // No RIR adjustment in realization
    });

    it("should increase rest periods for max efforts", () => {
      const macro = generateMacroCycle({
        userId: "user-123",
        startDate: new Date("2026-03-01"),
        durationWeeks: 18,
        trainingAge: "advanced",
        primaryGoal: "strength",
      });

      const blockContext = deriveBlockContext(macro, new Date("2026-03-30"));

      const result = prescribeWithBlock({
        basePrescription,
        blockContext,
      });

      expect(result.restSec).toBe(144); // 120 * 1.2 = 144
    });
  });

  describe("Deload block modifiers", () => {
    it("should reduce volume and intensity significantly", () => {
      const macro = generateMacroCycle({
        userId: "user-123",
        startDate: new Date("2026-03-01"),
        durationWeeks: 12,
        trainingAge: "beginner",
        primaryGoal: "hypertrophy",
      });

      // Week 4 - deload block
      const blockContext = deriveBlockContext(macro, new Date("2026-03-22"));

      const result = prescribeWithBlock({
        basePrescription,
        blockContext,
      });

      // Deload: volumeMultiplier = 0.5, rirAdjustment = +3
      expect(result.sets).toBe(2); // 4 * 0.5 = 2
      expect(result.rir).toBe(4); // 2 + 3 = 5 → clamped to 4 (max RIR)
      expect(result.restSec).toBeLessThan(120); // restMultiplier = 0.8 (active recovery)
    });

    it("should clamp RIR to maximum of 4", () => {
      const macro = generateMacroCycle({
        userId: "user-123",
        startDate: new Date("2026-03-01"),
        durationWeeks: 12,
        trainingAge: "beginner",
        primaryGoal: "hypertrophy",
      });

      const blockContext = deriveBlockContext(macro, new Date("2026-03-22"));

      const result = prescribeWithBlock({
        basePrescription: { ...basePrescription, rir: 3 },
        blockContext,
      });

      expect(result.rir).toBe(4); // 3 + 3 = 6 → clamped to 4
    });

    it("should reduce rest periods for active recovery", () => {
      const macro = generateMacroCycle({
        userId: "user-123",
        startDate: new Date("2026-03-01"),
        durationWeeks: 12,
        trainingAge: "beginner",
        primaryGoal: "hypertrophy",
      });

      const blockContext = deriveBlockContext(macro, new Date("2026-03-22"));

      const result = prescribeWithBlock({
        basePrescription,
        blockContext,
      });

      expect(result.restSec).toBe(96); // 120 * 0.8 = 96
    });
  });

  describe("RIR clamping", () => {
    it("should clamp RIR to minimum of 0", () => {
      const macro = generateMacroCycle({
        userId: "user-123",
        startDate: new Date("2026-03-01"),
        durationWeeks: 18,
        trainingAge: "advanced",
        primaryGoal: "strength",
      });

      // Realization block (RIR +0)
      const blockContext = deriveBlockContext(macro, new Date("2026-03-30"));

      const result = prescribeWithBlock({
        basePrescription: { ...basePrescription, rir: 0 },
        blockContext,
      });

      expect(result.rir).toBe(0); // Can't go below 0
    });

    it("should clamp RIR to maximum of 4", () => {
      const macro = generateMacroCycle({
        userId: "user-123",
        startDate: new Date("2026-03-01"),
        durationWeeks: 12,
        trainingAge: "beginner",
        primaryGoal: "hypertrophy",
      });

      // Deload block (RIR +3)
      const blockContext = deriveBlockContext(macro, new Date("2026-03-22"));

      const result = prescribeWithBlock({
        basePrescription: { ...basePrescription, rir: 4 },
        blockContext,
      });

      expect(result.rir).toBe(4); // Can't go above 4
    });
  });

  describe("Volume rounding", () => {
    it("should round sets to nearest integer", () => {
      const macro = generateMacroCycle({
        userId: "user-123",
        startDate: new Date("2026-03-01"),
        durationWeeks: 18,
        trainingAge: "advanced",
        primaryGoal: "strength",
      });

      const blockContext = deriveBlockContext(macro, new Date("2026-03-30"));

      const result = prescribeWithBlock({
        basePrescription: { ...basePrescription, sets: 3 },
        blockContext,
      });

      // 3 * 0.6 = 1.8 → 2
      expect(result.sets).toBe(2);
    });

    it("should ensure minimum of 1 set", () => {
      const macro = generateMacroCycle({
        userId: "user-123",
        startDate: new Date("2026-03-01"),
        durationWeeks: 12,
        trainingAge: "beginner",
        primaryGoal: "hypertrophy",
      });

      // Deload block
      const blockContext = deriveBlockContext(macro, new Date("2026-03-22"));

      const result = prescribeWithBlock({
        basePrescription: { ...basePrescription, sets: 1 },
        blockContext,
      });

      // 1 * 0.5 = 0.5 → 1 (minimum)
      expect(result.sets).toBe(1);
    });
  });

  describe("Rest period rounding", () => {
    it("should round rest seconds to nearest integer", () => {
      const macro = generateMacroCycle({
        userId: "user-123",
        startDate: new Date("2026-03-01"),
        durationWeeks: 12,
        trainingAge: "beginner",
        primaryGoal: "hypertrophy",
      });

      // Accumulation block (restMultiplier = 0.9)
      const blockContext = deriveBlockContext(macro, new Date("2026-03-02"));

      const result = prescribeWithBlock({
        basePrescription,
        blockContext,
      });

      expect(result.restSec).toBe(108); // 120 * 0.9 = 108
    });
  });

  describe("Reps preservation", () => {
    it("should not modify rep targets", () => {
      const macro = generateMacroCycle({
        userId: "user-123",
        startDate: new Date("2026-03-01"),
        durationWeeks: 12,
        trainingAge: "beginner",
        primaryGoal: "hypertrophy",
      });

      const blockContext = deriveBlockContext(macro, new Date("2026-03-02"));

      const result = prescribeWithBlock({
        basePrescription: { ...basePrescription, reps: 10 },
        blockContext,
      });

      expect(result.reps).toBe(10); // Reps unchanged
    });
  });
});
