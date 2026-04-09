import { describe, expect, it } from "vitest";
import {
  rankExerciseSearchResults,
  type ExerciseSearchCandidate,
} from "./search";

function rankIds(candidates: ExerciseSearchCandidate[], query: string): string[] {
  return rankExerciseSearchResults(candidates, query, 5).map((result) => result.id);
}

describe("rankExerciseSearchResults", () => {
  it("prefers alias matches over broader muscle matches", () => {
    const candidates: ExerciseSearchCandidate[] = [
      {
        id: "lying-triceps-extension",
        name: "Lying Triceps Extension",
        aliases: ["Skullcrusher", "EZ Bar Skull Crusher"],
        primaryMuscles: ["Triceps"],
        secondaryMuscles: [],
        equipment: ["EZ_BAR"],
      },
      {
        id: "cable-pressdown",
        name: "Cable Triceps Pressdown",
        aliases: ["Tricep Pushdown"],
        primaryMuscles: ["Triceps"],
        secondaryMuscles: [],
        equipment: ["CABLE"],
      },
    ];

    expect(rankIds(candidates, "skullcrusher")[0]).toBe("lying-triceps-extension");
  });

  it("combines equipment and muscle hints for more relevant ranking", () => {
    const candidates: ExerciseSearchCandidate[] = [
      {
        id: "cable-fly",
        name: "Cable Fly",
        aliases: ["Cable Chest Fly"],
        primaryMuscles: ["Chest"],
        secondaryMuscles: ["Front Delts"],
        equipment: ["CABLE"],
      },
      {
        id: "push-up",
        name: "Push Up",
        aliases: [],
        primaryMuscles: ["Chest"],
        secondaryMuscles: ["Triceps"],
        equipment: ["BODYWEIGHT"],
      },
      {
        id: "cable-row",
        name: "Cable Row",
        aliases: [],
        primaryMuscles: ["Lats", "Upper Back"],
        secondaryMuscles: ["Biceps"],
        equipment: ["CABLE"],
      },
    ];

    const rankedIds = rankIds(candidates, "cable chest");
    expect(rankedIds[0]).toBe("cable-fly");
    expect(rankedIds).toContain("push-up");
    expect(rankedIds).toContain("cable-row");
  });

  it("recognizes common shorthand equipment queries", () => {
    const candidates: ExerciseSearchCandidate[] = [
      {
        id: "dumbbell-row",
        name: "One-Arm Row",
        aliases: ["One Arm Dumbbell Row"],
        primaryMuscles: ["Lats"],
        secondaryMuscles: ["Biceps"],
        equipment: ["DUMBBELL"],
      },
      {
        id: "barbell-row",
        name: "Barbell Row",
        aliases: [],
        primaryMuscles: ["Lats"],
        secondaryMuscles: ["Biceps"],
        equipment: ["BARBELL"],
      },
      {
        id: "cable-row",
        name: "Cable Row",
        aliases: [],
        primaryMuscles: ["Lats"],
        secondaryMuscles: ["Biceps"],
        equipment: ["CABLE"],
      },
    ];

    expect(rankIds(candidates, "db row")).toEqual([
      "dumbbell-row",
      "barbell-row",
      "cable-row",
    ]);
  });
});
