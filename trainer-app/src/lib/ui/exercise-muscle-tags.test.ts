import { describe, expect, it } from "vitest";

import { buildExerciseMuscleDisplayGroups } from "./exercise-muscle-tags";

function exerciseInput(input: {
  id: string;
  name: string;
  primaryMuscles?: string[];
  secondaryMuscles?: string[];
}) {
  return {
    id: input.id,
    name: input.name,
    exerciseMuscles: [
      ...(input.primaryMuscles ?? []).map((name) => ({
        role: "PRIMARY",
        muscle: { name },
      })),
      ...(input.secondaryMuscles ?? []).map((name) => ({
        role: "SECONDARY",
        muscle: { name },
      })),
    ],
  };
}

describe("exercise muscle display groups", () => {
  it("derives an isolation primary group from canonical stimulus coverage", () => {
    expect(
      buildExerciseMuscleDisplayGroups(
        exerciseInput({
          id: "seated-leg-curl",
          name: "Seated Leg Curl",
          primaryMuscles: ["Hamstrings"],
        })
      )
    ).toEqual({
      primaryMuscles: ["Hamstrings"],
      secondaryMuscles: [],
      muscleTags: ["Hamstrings"],
    });
  });

  it("splits compound contributors into primary and secondary display groups", () => {
    expect(
      buildExerciseMuscleDisplayGroups(
        exerciseInput({
          id: "barbell-back-squat",
          name: "Barbell Back Squat",
          primaryMuscles: ["Quads", "Glutes"],
          secondaryMuscles: ["Hamstrings", "Core", "Lower Back", "Adductors"],
        })
      )
    ).toEqual({
      primaryMuscles: ["Quads"],
      secondaryMuscles: ["Glutes", "Adductors", "Core"],
      muscleTags: ["Quads", "Glutes", "Adductors", "Core"],
    });
  });

  it("keeps carry display primary to the highest stimulus contributor", () => {
    expect(
      buildExerciseMuscleDisplayGroups(
        exerciseInput({
          id: "suitcase-carry",
          name: "Suitcase Carry",
          primaryMuscles: ["Core", "Forearms"],
          secondaryMuscles: ["Upper Back"],
        })
      )
    ).toEqual({
      primaryMuscles: ["Core"],
      secondaryMuscles: ["Forearms", "Upper Back"],
      muscleTags: ["Core", "Forearms", "Upper Back"],
    });
  });

  it("keeps mixed adductor and core stability work grouped by stimulus tier", () => {
    expect(
      buildExerciseMuscleDisplayGroups(
        exerciseInput({
          id: "copenhagen-plank",
          name: "Copenhagen Plank",
          primaryMuscles: ["Adductors"],
          secondaryMuscles: ["Core"],
        })
      )
    ).toEqual({
      primaryMuscles: ["Adductors"],
      secondaryMuscles: ["Core"],
      muscleTags: ["Adductors", "Core"],
    });
  });
});
