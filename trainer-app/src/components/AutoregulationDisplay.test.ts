import { describe, it, expect } from "vitest";

/**
 * Test helper functions for AutoregulationDisplay
 * These functions are defined inline in the component, so we replicate them here for testing
 */

type Modification = {
  type: "intensity_scale" | "volume_reduction" | "deload_trigger";
  exerciseId?: string;
  exerciseName?: string;
  direction?: "up" | "down";
  scalar?: number;
  originalLoad?: number;
  adjustedLoad?: number;
  originalRir?: number;
  adjustedRir?: number;
  setsCut?: number;
  originalSetCount?: number;
  adjustedSetCount?: number;
  reason: string;
};

function groupModificationsByExercise(modifications: Modification[]) {
  const groups = new Map<string, Modification[]>();

  modifications.forEach((mod) => {
    const key = mod.exerciseName || "unknown";
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(mod);
  });

  return Array.from(groups.entries()).map(([exerciseName, mods]) => ({
    exerciseName,
    setCount: mods.length,
    representative: mods[0],
    modifications: mods,
  }));
}

function getUniqueExerciseCount(modifications: Modification[]): number {
  const uniqueExercises = new Set(
    modifications.map((mod) => mod.exerciseName || "unknown")
  );
  return uniqueExercises.size;
}

function extractActionFromReason(reason: string): string {
  const patterns = [
    /^Scaled up .+ (from .+)$/,
    /^Scaled down .+ (from .+)$/,
    /^Reduced .+ (from .+)$/,
    /^Deload: (.+)$/,
  ];

  for (const pattern of patterns) {
    const match = reason.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return reason;
}

describe("AutoregulationDisplay helpers", () => {
  describe("groupModificationsByExercise", () => {
    it("should group multiple sets of the same exercise into one entry", () => {
      const modifications: Modification[] = [
        {
          type: "intensity_scale",
          exerciseId: "1",
          exerciseName: "T-Bar Row",
          direction: "up",
          scalar: 1.05,
          originalLoad: 115.5,
          adjustedLoad: 121.5,
          originalRir: 3,
          adjustedRir: 2.5,
          reason: "Scaled up T-Bar Row from 115.5 lbs to 121.5 lbs (+5%), RPE 7 → 7.5",
        },
        {
          type: "intensity_scale",
          exerciseId: "1",
          exerciseName: "T-Bar Row",
          direction: "up",
          scalar: 1.05,
          originalLoad: 115.5,
          adjustedLoad: 121.5,
          originalRir: 3,
          adjustedRir: 2.5,
          reason: "Scaled up T-Bar Row from 115.5 lbs to 121.5 lbs (+5%), RPE 7 → 7.5",
        },
        {
          type: "intensity_scale",
          exerciseId: "1",
          exerciseName: "T-Bar Row",
          direction: "up",
          scalar: 1.05,
          originalLoad: 115.5,
          adjustedLoad: 121.5,
          originalRir: 3,
          adjustedRir: 2.5,
          reason: "Scaled up T-Bar Row from 115.5 lbs to 121.5 lbs (+5%), RPE 7 → 7.5",
        },
      ];

      const grouped = groupModificationsByExercise(modifications);

      expect(grouped).toHaveLength(1);
      expect(grouped[0].exerciseName).toBe("T-Bar Row");
      expect(grouped[0].setCount).toBe(3);
      expect(grouped[0].representative).toBe(modifications[0]);
    });

    it("should keep different exercises separate", () => {
      const modifications: Modification[] = [
        {
          type: "intensity_scale",
          exerciseName: "T-Bar Row",
          direction: "up",
          scalar: 1.05,
          reason: "Scaled up T-Bar Row from 115.5 lbs to 121.5 lbs (+5%)",
        },
        {
          type: "intensity_scale",
          exerciseName: "Bench Press",
          direction: "up",
          scalar: 1.05,
          reason: "Scaled up Bench Press from 185 lbs to 194.5 lbs (+5%)",
        },
      ];

      const grouped = groupModificationsByExercise(modifications);

      expect(grouped).toHaveLength(2);
      expect(grouped[0].exerciseName).toBe("T-Bar Row");
      expect(grouped[0].setCount).toBe(1);
      expect(grouped[1].exerciseName).toBe("Bench Press");
      expect(grouped[1].setCount).toBe(1);
    });
  });

  describe("getUniqueExerciseCount", () => {
    it("should count unique exercises correctly with duplicate sets", () => {
      const modifications: Modification[] = [
        { type: "intensity_scale", exerciseName: "T-Bar Row", reason: "" },
        { type: "intensity_scale", exerciseName: "T-Bar Row", reason: "" },
        { type: "intensity_scale", exerciseName: "T-Bar Row", reason: "" },
        { type: "intensity_scale", exerciseName: "Bench Press", reason: "" },
        { type: "intensity_scale", exerciseName: "Bench Press", reason: "" },
      ];

      const count = getUniqueExerciseCount(modifications);

      expect(count).toBe(2);
    });

    it("should return 0 for empty modifications", () => {
      const count = getUniqueExerciseCount([]);
      expect(count).toBe(0);
    });
  });

  describe("extractActionFromReason", () => {
    it("should extract scale up action from reason", () => {
      const reason = "Scaled up T-Bar Row from 115.5 lbs to 121.5 lbs (+5%), RPE 7 → 7.5";
      const extracted = extractActionFromReason(reason);
      expect(extracted).toBe("from 115.5 lbs to 121.5 lbs (+5%), RPE 7 → 7.5");
    });

    it("should extract scale down action from reason", () => {
      const reason = "Scaled down Bench Press from 185 lbs to 166.5 lbs (-10%)";
      const extracted = extractActionFromReason(reason);
      expect(extracted).toBe("from 185 lbs to 166.5 lbs (-10%)");
    });

    it("should extract volume reduction from reason", () => {
      const reason = "Reduced Leg Curl from 3 sets to 2 sets (-1 set)";
      const extracted = extractActionFromReason(reason);
      expect(extracted).toBe("from 3 sets to 2 sets (-1 set)");
    });

    it("should extract deload info from reason", () => {
      const reason = "Deload: Squat reduced to 2 sets at 60% intensity, RPE 6";
      const extracted = extractActionFromReason(reason);
      expect(extracted).toBe("Squat reduced to 2 sets at 60% intensity, RPE 6");
    });

    it("should return original reason if no pattern matches", () => {
      const reason = "Some unknown modification format";
      const extracted = extractActionFromReason(reason);
      expect(extracted).toBe("Some unknown modification format");
    });
  });
});
