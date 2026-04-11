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

  it("renders sissy squat as a quad near-isolation", () => {
    expect(
      buildExerciseMuscleDisplayGroups(
        exerciseInput({
          id: "sissy-squat",
          name: "Sissy Squat",
          primaryMuscles: ["Quads"],
        })
      )
    ).toEqual({
      primaryMuscles: ["Quads"],
      secondaryMuscles: [],
      muscleTags: ["Quads"],
    });
  });

  it("keeps supported seated rows from displaying lower-back noise", () => {
    for (const name of ["Seated Cable Row", "Close-Grip Seated Cable Row"]) {
      expect(
        buildExerciseMuscleDisplayGroups(
          exerciseInput({
            id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
            name,
            primaryMuscles: ["Lats", "Upper Back"],
            secondaryMuscles: ["Biceps", "Forearms"],
          })
        )
      ).toEqual({
        primaryMuscles: ["Upper Back", "Lats"],
        secondaryMuscles: ["Biceps", "Rear Delts"],
        muscleTags: ["Upper Back", "Lats", "Biceps", "Rear Delts"],
      });
    }
  });

  it("renders reverse hyperextension as glute and hamstring dominant with lower back secondary", () => {
    expect(
      buildExerciseMuscleDisplayGroups(
        exerciseInput({
          id: "reverse-hyperextension",
          name: "Reverse Hyperextension",
          primaryMuscles: ["Glutes", "Hamstrings"],
          secondaryMuscles: ["Lower Back"],
        })
      )
    ).toEqual({
      primaryMuscles: ["Glutes", "Hamstrings"],
      secondaryMuscles: ["Lower Back"],
      muscleTags: ["Glutes", "Hamstrings", "Lower Back"],
    });
  });
});
