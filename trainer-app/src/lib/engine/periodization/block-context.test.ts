import { describe, expect, it } from "vitest";
import { deriveBlockContext } from "./block-context";
import { generateMacroCycle } from "./generate-macro";
import type { GenerateMacroInput } from "./generate-macro";

describe("deriveBlockContext", () => {
  const baseInput: GenerateMacroInput = {
    userId: "user-123",
    startDate: new Date("2026-03-01"), // Sunday
    durationWeeks: 12,
    trainingAge: "beginner",
    primaryGoal: "hypertrophy",
  };

  describe("Week calculations", () => {
    it("should derive context for week 1 (first week of macro)", () => {
      const macro = generateMacroCycle(baseInput);
      const workoutDate = new Date("2026-03-02"); // Monday of week 1

      const context = deriveBlockContext(macro, workoutDate);

      expect(context).not.toBeNull();
      expect(context!.weekInMacro).toBe(1);
      expect(context!.weekInMeso).toBe(1);
      expect(context!.weekInBlock).toBe(1);
    });

    it("should derive context for week 2", () => {
      const macro = generateMacroCycle(baseInput);
      const workoutDate = new Date("2026-03-09"); // Week 2 (8 days later)

      const context = deriveBlockContext(macro, workoutDate);

      expect(context).not.toBeNull();
      expect(context!.weekInMacro).toBe(2);
      expect(context!.weekInMeso).toBe(2);
      expect(context!.weekInBlock).toBe(2);
    });

    it("should derive context for week 4 (deload week for beginner)", () => {
      const macro = generateMacroCycle(baseInput);
      const workoutDate = new Date("2026-03-23"); // Week 4 (22 days later)

      const context = deriveBlockContext(macro, workoutDate);

      expect(context).not.toBeNull();
      expect(context!.weekInMacro).toBe(4);
      expect(context!.weekInMeso).toBe(4);
      expect(context!.weekInBlock).toBe(1); // First (and only) week of deload block
      expect(context!.block.blockType).toBe("deload");
    });

    it("should derive context for last week of macro", () => {
      const macro = generateMacroCycle(baseInput);
      const workoutDate = new Date("2026-05-18"); // Week 12 (last week)

      const context = deriveBlockContext(macro, workoutDate);

      expect(context).not.toBeNull();
      expect(context!.weekInMacro).toBe(12);
    });
  });

  describe("Mesocycle and block identification", () => {
    it("should identify correct mesocycle for beginner (meso 1)", () => {
      const macro = generateMacroCycle(baseInput);
      const workoutDate = new Date("2026-03-02"); // Week 1

      const context = deriveBlockContext(macro, workoutDate);

      expect(context).not.toBeNull();
      expect(context!.mesocycle.mesoNumber).toBe(1);
      expect(context!.mesocycle.startWeek).toBe(0);
      expect(context!.mesocycle.durationWeeks).toBe(4);
    });

    it("should identify correct mesocycle for beginner (meso 2)", () => {
      const macro = generateMacroCycle(baseInput);
      const workoutDate = new Date("2026-03-30"); // Week 5

      const context = deriveBlockContext(macro, workoutDate);

      expect(context).not.toBeNull();
      expect(context!.mesocycle.mesoNumber).toBe(2);
      expect(context!.mesocycle.startWeek).toBe(4);
    });

    it("should identify correct mesocycle for beginner (meso 3)", () => {
      const macro = generateMacroCycle(baseInput);
      const workoutDate = new Date("2026-04-27"); // Week 9

      const context = deriveBlockContext(macro, workoutDate);

      expect(context).not.toBeNull();
      expect(context!.mesocycle.mesoNumber).toBe(3);
      expect(context!.mesocycle.startWeek).toBe(8);
    });

    it("should identify accumulation block", () => {
      const macro = generateMacroCycle(baseInput);
      const workoutDate = new Date("2026-03-02"); // Week 1

      const context = deriveBlockContext(macro, workoutDate);

      expect(context).not.toBeNull();
      expect(context!.block.blockType).toBe("accumulation");
      expect(context!.block.blockNumber).toBe(1);
    });

    it("should identify deload block", () => {
      const macro = generateMacroCycle(baseInput);
      const workoutDate = new Date("2026-03-23"); // Week 4 (deload week)

      const context = deriveBlockContext(macro, workoutDate);

      expect(context).not.toBeNull();
      expect(context!.block.blockType).toBe("deload");
      expect(context!.block.blockNumber).toBe(2);
    });
  });

  describe("Intermediate and advanced", () => {
    it("should derive context for intermediate week 1 (acc block)", () => {
      const macro = generateMacroCycle({
        ...baseInput,
        durationWeeks: 15,
        trainingAge: "intermediate",
      });
      const workoutDate = new Date("2026-03-02"); // Week 1

      const context = deriveBlockContext(macro, workoutDate);

      expect(context).not.toBeNull();
      expect(context!.weekInMacro).toBe(1);
      expect(context!.weekInBlock).toBe(1);
      expect(context!.block.blockType).toBe("accumulation");
    });

    it("should derive context for intermediate week 3 (int block)", () => {
      const macro = generateMacroCycle({
        ...baseInput,
        durationWeeks: 15,
        trainingAge: "intermediate",
      });
      const workoutDate = new Date("2026-03-16"); // Week 3

      const context = deriveBlockContext(macro, workoutDate);

      expect(context).not.toBeNull();
      expect(context!.weekInMacro).toBe(3);
      expect(context!.weekInBlock).toBe(1); // First week of int block
      expect(context!.block.blockType).toBe("intensification");
    });

    it("should derive context for intermediate week 5 (deload)", () => {
      const macro = generateMacroCycle({
        ...baseInput,
        durationWeeks: 15,
        trainingAge: "intermediate",
      });
      const workoutDate = new Date("2026-03-30"); // Week 5

      const context = deriveBlockContext(macro, workoutDate);

      expect(context).not.toBeNull();
      expect(context!.weekInMacro).toBe(5);
      expect(context!.weekInBlock).toBe(1);
      expect(context!.block.blockType).toBe("deload");
    });

    it("should derive context for advanced week 5 (realization block)", () => {
      const macro = generateMacroCycle({
        ...baseInput,
        durationWeeks: 18,
        trainingAge: "advanced",
      });
      const workoutDate = new Date("2026-03-30"); // Week 5

      const context = deriveBlockContext(macro, workoutDate);

      expect(context).not.toBeNull();
      expect(context!.weekInMacro).toBe(5);
      expect(context!.weekInBlock).toBe(1); // First (and only) week of realization
      expect(context!.block.blockType).toBe("realization");
    });

    it("should derive context for advanced week 6 (deload)", () => {
      const macro = generateMacroCycle({
        ...baseInput,
        durationWeeks: 18,
        trainingAge: "advanced",
      });
      const workoutDate = new Date("2026-04-06"); // Week 6

      const context = deriveBlockContext(macro, workoutDate);

      expect(context).not.toBeNull();
      expect(context!.weekInMacro).toBe(6);
      expect(context!.weekInBlock).toBe(1);
      expect(context!.block.blockType).toBe("deload");
    });
  });

  describe("Edge cases and out-of-range", () => {
    it("should return null for date before macro starts", () => {
      const macro = generateMacroCycle(baseInput);
      const workoutDate = new Date("2026-02-20"); // Before start date

      const context = deriveBlockContext(macro, workoutDate);

      expect(context).toBeNull();
    });

    it("should return null for date after macro ends", () => {
      const macro = generateMacroCycle(baseInput);
      const workoutDate = new Date("2026-06-01"); // After 12 weeks

      const context = deriveBlockContext(macro, workoutDate);

      expect(context).toBeNull();
    });

    it("should return null for date exactly at end boundary", () => {
      const macro = generateMacroCycle(baseInput);
      // End date is 12 weeks after start, so week 13 should be out of range
      const workoutDate = new Date("2026-05-25"); // Week 13

      const context = deriveBlockContext(macro, workoutDate);

      expect(context).toBeNull();
    });

    it("should handle date on first day of macro", () => {
      const macro = generateMacroCycle(baseInput);
      const workoutDate = new Date("2026-03-01"); // Exactly at start

      const context = deriveBlockContext(macro, workoutDate);

      expect(context).not.toBeNull();
      expect(context!.weekInMacro).toBe(1);
    });

    it("should handle different start dates", () => {
      const macro = generateMacroCycle({
        ...baseInput,
        startDate: new Date("2026-06-15"),
      });
      const workoutDate = new Date("2026-06-20"); // Week 1

      const context = deriveBlockContext(macro, workoutDate);

      expect(context).not.toBeNull();
      expect(context!.weekInMacro).toBe(1);
    });
  });

  describe("Context completeness", () => {
    it("should return complete context with all fields", () => {
      const macro = generateMacroCycle(baseInput);
      const workoutDate = new Date("2026-03-02");

      const context = deriveBlockContext(macro, workoutDate);

      expect(context).not.toBeNull();
      expect(context).toHaveProperty("block");
      expect(context).toHaveProperty("weekInBlock");
      expect(context).toHaveProperty("weekInMeso");
      expect(context).toHaveProperty("weekInMacro");
      expect(context).toHaveProperty("mesocycle");
      expect(context).toHaveProperty("macroCycle");
    });

    it("should include correct block metadata", () => {
      const macro = generateMacroCycle(baseInput);
      const workoutDate = new Date("2026-03-02");

      const context = deriveBlockContext(macro, workoutDate);

      expect(context).not.toBeNull();
      expect(context!.block.id).toBeDefined();
      expect(context!.block.mesocycleId).toBeDefined();
      expect(context!.block.blockType).toBeDefined();
      expect(context!.block.volumeTarget).toBeDefined();
      expect(context!.block.intensityBias).toBeDefined();
      expect(context!.block.adaptationType).toBeDefined();
    });

    it("should include correct mesocycle metadata", () => {
      const macro = generateMacroCycle(baseInput);
      const workoutDate = new Date("2026-03-02");

      const context = deriveBlockContext(macro, workoutDate);

      expect(context).not.toBeNull();
      expect(context!.mesocycle.id).toBeDefined();
      expect(context!.mesocycle.macroCycleId).toBe(macro.id);
      expect(context!.mesocycle.mesoNumber).toBeGreaterThan(0);
      expect(context!.mesocycle.focus).toBeDefined();
    });

    it("should include correct macro metadata", () => {
      const macro = generateMacroCycle(baseInput);
      const workoutDate = new Date("2026-03-02");

      const context = deriveBlockContext(macro, workoutDate);

      expect(context).not.toBeNull();
      expect(context!.macroCycle.id).toBe(macro.id);
      expect(context!.macroCycle.userId).toBe("user-123");
      expect(context!.macroCycle.trainingAge).toBe("beginner");
      expect(context!.macroCycle.primaryGoal).toBe("hypertrophy");
    });
  });

  describe("Transition points", () => {
    it("should correctly transition from acc to deload (beginner)", () => {
      const macro = generateMacroCycle(baseInput);

      // Last day of week 3 (last day of acc block)
      // Start: 2026-03-01 (Sun), Week 3 ends on 2026-03-21 (Sat)
      const lastDayAcc = new Date("2026-03-21");
      const contextAcc = deriveBlockContext(macro, lastDayAcc);
      expect(contextAcc!.block.blockType).toBe("accumulation");
      expect(contextAcc!.weekInBlock).toBe(3);

      // First day of week 4 (first day of deload)
      // Week 4 starts on 2026-03-22 (Sun)
      const firstDayDeload = new Date("2026-03-22");
      const contextDeload = deriveBlockContext(macro, firstDayDeload);
      expect(contextDeload!.block.blockType).toBe("deload");
      expect(contextDeload!.weekInBlock).toBe(1);
    });

    it("should correctly transition between mesocycles", () => {
      const macro = generateMacroCycle(baseInput);

      // Last day of meso 1 (week 4, deload)
      // Meso 1: weeks 1-4, ends on 2026-03-28 (Sat)
      const lastDayMeso1 = new Date("2026-03-28");
      const context1 = deriveBlockContext(macro, lastDayMeso1);
      expect(context1!.mesocycle.mesoNumber).toBe(1);
      expect(context1!.weekInMeso).toBe(4);

      // First day of meso 2 (week 5)
      // Week 5 starts on 2026-03-29 (Sun)
      const firstDayMeso2 = new Date("2026-03-29");
      const context2 = deriveBlockContext(macro, firstDayMeso2);
      expect(context2!.mesocycle.mesoNumber).toBe(2);
      expect(context2!.weekInMeso).toBe(1);
      expect(context2!.block.blockType).toBe("accumulation"); // New meso starts with acc
    });
  });
});
