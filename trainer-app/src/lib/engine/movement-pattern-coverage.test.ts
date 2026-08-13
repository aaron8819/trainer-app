import { describe, expect, it } from "vitest";
import exerciseCatalog from "../../../prisma/exercises_comprehensive.json";

import { scoreMovementDiversity } from "./template-analysis";
import { analyzeWeeklyProgram } from "./weekly-program-analysis";

function shippedExercise(name: string) {
  const exercise = exerciseCatalog.exercises.find(
    (candidate) => candidate.name === name,
  );
  if (!exercise) throw new Error(`Missing shipped exercise: ${name}`);
  return exercise;
}

describe("movement-pattern coverage", () => {
  it("tracks anti-extension separately from anti-rotation at template and weekly boundaries", () => {
    const abWheel = shippedExercise("Ab Wheel Rollout");
    const cablePallof = shippedExercise("Cable Pallof Press");
    const analysisExercise = (exercise: typeof abWheel) => ({
      isCompound: exercise.isCompound,
      movementPatterns: exercise.movementPatterns,
      muscles: exercise.primaryMuscles.map((name) => ({
        name,
        role: "primary" as const,
      })),
    });

    const abWheelTemplate = scoreMovementDiversity(
      [analysisExercise(abWheel)],
      { intent: "CUSTOM", scopeBuckets: [] },
    );
    const bothTemplate = scoreMovementDiversity(
      [analysisExercise(abWheel), analysisExercise(cablePallof)],
      { intent: "CUSTOM", scopeBuckets: [] },
    );
    const weekly = analyzeWeeklyProgram([
      {
        sessionId: "core",
        exercises: [abWheel, cablePallof].map((exercise) => ({
          movementPatterns: exercise.movementPatterns,
          muscles: exercise.primaryMuscles.map((name) => ({
            name,
            role: "primary" as const,
          })),
          setCount: 3,
        })),
      },
    ]);

    expect(abWheelTemplate.coveredPatterns).toEqual(["anti_extension"]);
    expect(abWheelTemplate.coveredPatterns).not.toContain("anti_rotation");
    expect(bothTemplate.coveredPatterns).toEqual([
      "anti_rotation",
      "anti_extension",
    ]);
    expect(weekly.weeklyMovementPatternDiversity.coveredBonusPatterns).toEqual([
      "anti_rotation",
      "anti_extension",
    ]);
  });
});
