import { describe, expect, it } from "vitest";
import { generateMacroCycle } from "./generate-macro";
import type { GenerateMacroInput } from "./generate-macro";

describe("generateMacroCycle", () => {
  const baseInput: GenerateMacroInput = {
    userId: "user-123",
    startDate: new Date("2026-03-01"),
    durationWeeks: 12,
    trainingAge: "beginner",
    primaryGoal: "hypertrophy",
  };

  describe("Beginner mesocycle structure", () => {
    it("should generate 3 mesocycles for 12 weeks (4 weeks each)", () => {
      const macro = generateMacroCycle(baseInput);

      expect(macro.mesocycles).toHaveLength(3);
      expect(macro.mesocycles[0].durationWeeks).toBe(4);
      expect(macro.mesocycles[1].durationWeeks).toBe(4);
      expect(macro.mesocycles[2].durationWeeks).toBe(4);
    });

    it("should generate 3 acc + 1 deload block pattern per meso", () => {
      const macro = generateMacroCycle(baseInput);

      const meso1 = macro.mesocycles[0];
      expect(meso1.blocks).toHaveLength(2);
      expect(meso1.blocks[0].blockType).toBe("accumulation");
      expect(meso1.blocks[0].durationWeeks).toBe(3);
      expect(meso1.blocks[1].blockType).toBe("deload");
      expect(meso1.blocks[1].durationWeeks).toBe(1);
    });

    it("should calculate correct week offsets across mesocycles", () => {
      const macro = generateMacroCycle(baseInput);

      expect(macro.mesocycles[0].startWeek).toBe(0);
      expect(macro.mesocycles[1].startWeek).toBe(4);
      expect(macro.mesocycles[2].startWeek).toBe(8);
    });

    it("should calculate correct week offsets for blocks", () => {
      const macro = generateMacroCycle(baseInput);

      const meso1 = macro.mesocycles[0];
      expect(meso1.blocks[0].startWeek).toBe(0); // First acc block starts at week 0
      expect(meso1.blocks[1].startWeek).toBe(3); // Deload starts at week 3

      const meso2 = macro.mesocycles[1];
      expect(meso2.blocks[0].startWeek).toBe(4); // Second meso acc starts at week 4
      expect(meso2.blocks[1].startWeek).toBe(7); // Second meso deload starts at week 7
    });
  });

  describe("Intermediate mesocycle structure", () => {
    it("should generate 3 mesocycles for 15 weeks (5 weeks each)", () => {
      const macro = generateMacroCycle({
        ...baseInput,
        durationWeeks: 15,
        trainingAge: "intermediate",
      });

      expect(macro.mesocycles).toHaveLength(3);
      expect(macro.mesocycles[0].durationWeeks).toBe(5);
      expect(macro.mesocycles[1].durationWeeks).toBe(5);
      expect(macro.mesocycles[2].durationWeeks).toBe(5);
    });

    it("should generate 2 acc + 2 int + 1 deload block pattern per meso", () => {
      const macro = generateMacroCycle({
        ...baseInput,
        durationWeeks: 15,
        trainingAge: "intermediate",
      });

      const meso1 = macro.mesocycles[0];
      expect(meso1.blocks).toHaveLength(3);
      expect(meso1.blocks[0].blockType).toBe("accumulation");
      expect(meso1.blocks[0].durationWeeks).toBe(2);
      expect(meso1.blocks[1].blockType).toBe("intensification");
      expect(meso1.blocks[1].durationWeeks).toBe(2);
      expect(meso1.blocks[2].blockType).toBe("deload");
      expect(meso1.blocks[2].durationWeeks).toBe(1);
    });

    it("should calculate correct week offsets for intermediate blocks", () => {
      const macro = generateMacroCycle({
        ...baseInput,
        durationWeeks: 15,
        trainingAge: "intermediate",
      });

      const meso1 = macro.mesocycles[0];
      expect(meso1.blocks[0].startWeek).toBe(0); // Acc block
      expect(meso1.blocks[1].startWeek).toBe(2); // Int block
      expect(meso1.blocks[2].startWeek).toBe(4); // Deload block

      const meso2 = macro.mesocycles[1];
      expect(meso2.blocks[0].startWeek).toBe(5); // Second meso acc
      expect(meso2.blocks[1].startWeek).toBe(7); // Second meso int
      expect(meso2.blocks[2].startWeek).toBe(9); // Second meso deload
    });
  });

  describe("Advanced mesocycle structure", () => {
    it("should generate 3 mesocycles for 18 weeks (6 weeks each)", () => {
      const macro = generateMacroCycle({
        ...baseInput,
        durationWeeks: 18,
        trainingAge: "advanced",
      });

      expect(macro.mesocycles).toHaveLength(3);
      expect(macro.mesocycles[0].durationWeeks).toBe(6);
      expect(macro.mesocycles[1].durationWeeks).toBe(6);
      expect(macro.mesocycles[2].durationWeeks).toBe(6);
    });

    it("should generate 2 acc + 2 int + 1 real + 1 deload block pattern per meso", () => {
      const macro = generateMacroCycle({
        ...baseInput,
        durationWeeks: 18,
        trainingAge: "advanced",
      });

      const meso1 = macro.mesocycles[0];
      expect(meso1.blocks).toHaveLength(4);
      expect(meso1.blocks[0].blockType).toBe("accumulation");
      expect(meso1.blocks[0].durationWeeks).toBe(2);
      expect(meso1.blocks[1].blockType).toBe("intensification");
      expect(meso1.blocks[1].durationWeeks).toBe(2);
      expect(meso1.blocks[2].blockType).toBe("realization");
      expect(meso1.blocks[2].durationWeeks).toBe(1);
      expect(meso1.blocks[3].blockType).toBe("deload");
      expect(meso1.blocks[3].durationWeeks).toBe(1);
    });

    it("should calculate correct week offsets for advanced blocks", () => {
      const macro = generateMacroCycle({
        ...baseInput,
        durationWeeks: 18,
        trainingAge: "advanced",
      });

      const meso1 = macro.mesocycles[0];
      expect(meso1.blocks[0].startWeek).toBe(0); // Acc block
      expect(meso1.blocks[1].startWeek).toBe(2); // Int block
      expect(meso1.blocks[2].startWeek).toBe(4); // Real block
      expect(meso1.blocks[3].startWeek).toBe(5); // Deload block

      const meso3 = macro.mesocycles[2];
      expect(meso3.blocks[0].startWeek).toBe(12); // Third meso acc
      expect(meso3.blocks[1].startWeek).toBe(14); // Third meso int
      expect(meso3.blocks[2].startWeek).toBe(16); // Third meso real
      expect(meso3.blocks[3].startWeek).toBe(17); // Third meso deload
    });
  });

  describe("Date calculations", () => {
    it("should calculate correct end date for 12 weeks", () => {
      const macro = generateMacroCycle(baseInput);

      const expectedEndDate = new Date("2026-03-01");
      expectedEndDate.setDate(expectedEndDate.getDate() + 12 * 7);

      expect(macro.endDate.toISOString()).toBe(expectedEndDate.toISOString());
    });

    it("should calculate correct end date for 18 weeks", () => {
      const macro = generateMacroCycle({
        ...baseInput,
        durationWeeks: 18,
      });

      const expectedEndDate = new Date("2026-03-01");
      expectedEndDate.setDate(expectedEndDate.getDate() + 18 * 7);

      expect(macro.endDate.toISOString()).toBe(expectedEndDate.toISOString());
    });

    it("should preserve start date", () => {
      const macro = generateMacroCycle(baseInput);

      expect(macro.startDate.toISOString()).toBe(new Date("2026-03-01").toISOString());
    });
  });

  describe("ID generation and relationships", () => {
    it("should generate unique IDs for macro, mesos, and blocks", () => {
      const macro = generateMacroCycle(baseInput);

      expect(macro.id).toBeDefined();
      expect(typeof macro.id).toBe("string");
      expect(macro.id.length).toBeGreaterThan(0);

      const mesoIds = macro.mesocycles.map((m) => m.id);
      expect(new Set(mesoIds).size).toBe(mesoIds.length); // All unique

      const allBlockIds = macro.mesocycles.flatMap((m) => m.blocks.map((b) => b.id));
      expect(new Set(allBlockIds).size).toBe(allBlockIds.length); // All unique
    });

    it("should assign macroCycleId to all mesocycles", () => {
      const macro = generateMacroCycle(baseInput);

      macro.mesocycles.forEach((meso) => {
        expect(meso.macroCycleId).toBe(macro.id);
      });
    });

    it("should assign mesocycleId to all blocks", () => {
      const macro = generateMacroCycle(baseInput);

      macro.mesocycles.forEach((meso) => {
        meso.blocks.forEach((block) => {
          expect(block.mesocycleId).toBe(meso.id);
        });
      });
    });

    it("should assign sequential mesoNumbers", () => {
      const macro = generateMacroCycle(baseInput);

      expect(macro.mesocycles[0].mesoNumber).toBe(1);
      expect(macro.mesocycles[1].mesoNumber).toBe(2);
      expect(macro.mesocycles[2].mesoNumber).toBe(3);
    });

    it("should assign sequential blockNumbers within each meso", () => {
      const macro = generateMacroCycle({
        ...baseInput,
        durationWeeks: 18,
        trainingAge: "advanced",
      });

      macro.mesocycles.forEach((meso) => {
        meso.blocks.forEach((block, idx) => {
          expect(block.blockNumber).toBe(idx + 1);
        });
      });
    });
  });

  describe("Goal and metadata handling", () => {
    it("should preserve userId", () => {
      const macro = generateMacroCycle(baseInput);
      expect(macro.userId).toBe("user-123");
    });

    it("should preserve trainingAge", () => {
      const macro = generateMacroCycle(baseInput);
      expect(macro.trainingAge).toBe("beginner");
    });

    it("should preserve durationWeeks", () => {
      const macro = generateMacroCycle(baseInput);
      expect(macro.durationWeeks).toBe(12);
    });

    it("should preserve primaryGoal for standard goals", () => {
      const macro = generateMacroCycle({ ...baseInput, primaryGoal: "hypertrophy" });
      expect(macro.primaryGoal).toBe("hypertrophy");

      const macro2 = generateMacroCycle({ ...baseInput, primaryGoal: "strength" });
      expect(macro2.primaryGoal).toBe("strength");

      const macro3 = generateMacroCycle({ ...baseInput, primaryGoal: "fat_loss" });
      expect(macro3.primaryGoal).toBe("fat_loss");
    });

    it("should normalize athleticism to general_fitness", () => {
      const macro = generateMacroCycle({ ...baseInput, primaryGoal: "athleticism" });
      expect(macro.primaryGoal).toBe("general_fitness");
    });

    it("should normalize general_health to general_fitness", () => {
      const macro = generateMacroCycle({ ...baseInput, primaryGoal: "general_health" });
      expect(macro.primaryGoal).toBe("general_fitness");
    });
  });

  describe("Meso focus and targets", () => {
    it("should assign focus to each mesocycle", () => {
      const macro = generateMacroCycle(baseInput);

      macro.mesocycles.forEach((meso) => {
        expect(meso.focus).toBeDefined();
        expect(typeof meso.focus).toBe("string");
        expect(meso.focus.length).toBeGreaterThan(0);
      });
    });

    it("should copy volume and intensity from first block to meso", () => {
      const macro = generateMacroCycle({
        ...baseInput,
        trainingAge: "intermediate",
        durationWeeks: 15,
      });

      macro.mesocycles.forEach((meso) => {
        expect(meso.volumeTarget).toBe(meso.blocks[0].volumeTarget);
        expect(meso.intensityBias).toBe(meso.blocks[0].intensityBias);
      });
    });
  });

  describe("Edge cases", () => {
    it("should handle partial mesocycles (floor division)", () => {
      // 14 weeks for beginner = 3 complete mesos (12 weeks), 2 weeks dropped
      const macro = generateMacroCycle({
        ...baseInput,
        durationWeeks: 14,
        trainingAge: "beginner",
      });

      expect(macro.mesocycles).toHaveLength(3); // Only 3 complete mesos
    });

    it("should handle exact mesocycle fit", () => {
      const macro = generateMacroCycle({
        ...baseInput,
        durationWeeks: 12,
        trainingAge: "beginner",
      });

      expect(macro.mesocycles).toHaveLength(3);
      expect(macro.mesocycles[2].startWeek + macro.mesocycles[2].durationWeeks).toBe(12);
    });

    it("should handle different start dates", () => {
      const macro = generateMacroCycle({
        ...baseInput,
        startDate: new Date("2026-06-15"),
      });

      expect(macro.startDate.toISOString()).toBe(new Date("2026-06-15").toISOString());

      const expectedEndDate = new Date("2026-06-15");
      expectedEndDate.setDate(expectedEndDate.getDate() + 12 * 7);
      expect(macro.endDate.toISOString()).toBe(expectedEndDate.toISOString());
    });

    it("should handle different user IDs", () => {
      const macro1 = generateMacroCycle({ ...baseInput, userId: "user-abc" });
      const macro2 = generateMacroCycle({ ...baseInput, userId: "user-xyz" });

      expect(macro1.userId).toBe("user-abc");
      expect(macro2.userId).toBe("user-xyz");
      expect(macro1.id).not.toBe(macro2.id); // Different macros
    });
  });

  describe("Block adaptationType assignment", () => {
    it("should assign appropriate adaptationType for beginner blocks", () => {
      const macro = generateMacroCycle(baseInput);

      const accBlock = macro.mesocycles[0].blocks[0];
      expect(accBlock.adaptationType).toBe("myofibrillar_hypertrophy");

      const deloadBlock = macro.mesocycles[0].blocks[1];
      expect(deloadBlock.adaptationType).toBe("recovery");
    });

    it("should assign appropriate adaptationType for intermediate hypertrophy blocks", () => {
      const macro = generateMacroCycle({
        ...baseInput,
        durationWeeks: 15,
        trainingAge: "intermediate",
        primaryGoal: "hypertrophy",
      });

      const accBlock = macro.mesocycles[0].blocks[0];
      expect(accBlock.adaptationType).toBe("myofibrillar_hypertrophy");

      const intBlock = macro.mesocycles[0].blocks[1];
      expect(intBlock.adaptationType).toBe("myofibrillar_hypertrophy"); // Hypertrophy goal

      const deloadBlock = macro.mesocycles[0].blocks[2];
      expect(deloadBlock.adaptationType).toBe("recovery");
    });

    it("should assign appropriate adaptationType for intermediate strength blocks", () => {
      const macro = generateMacroCycle({
        ...baseInput,
        durationWeeks: 15,
        trainingAge: "intermediate",
        primaryGoal: "strength",
      });

      const accBlock = macro.mesocycles[0].blocks[0];
      expect(accBlock.adaptationType).toBe("myofibrillar_hypertrophy");

      const intBlock = macro.mesocycles[0].blocks[1];
      expect(intBlock.adaptationType).toBe("neural_adaptation"); // Strength goal

      const deloadBlock = macro.mesocycles[0].blocks[2];
      expect(deloadBlock.adaptationType).toBe("recovery");
    });

    it("should assign appropriate adaptationType for advanced blocks", () => {
      const macro = generateMacroCycle({
        ...baseInput,
        durationWeeks: 18,
        trainingAge: "advanced",
      });

      const accBlock = macro.mesocycles[0].blocks[0];
      expect(accBlock.adaptationType).toBe("sarcoplasmic_hypertrophy"); // Advanced acc uses sarcoplasmic

      const intBlock = macro.mesocycles[0].blocks[1];
      expect(intBlock.adaptationType).toBe("myofibrillar_hypertrophy"); // Advanced int uses myofibrillar

      const realBlock = macro.mesocycles[0].blocks[2];
      expect(realBlock.adaptationType).toBe("neural_adaptation");

      const deloadBlock = macro.mesocycles[0].blocks[3];
      expect(deloadBlock.adaptationType).toBe("recovery");
    });
  });
});
