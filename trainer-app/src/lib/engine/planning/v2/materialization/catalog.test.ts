import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getEffectiveStimulusByMuscle } from "@/lib/engine/stimulus";
import {
  evaluateV2AnchorLaneQuality,
  matchV2ExerciseClasses,
  normalizeV2MaterializationText,
} from "./taxonomy";
import type { V2MaterializationExercise } from "./types";

type CatalogExercise = {
  name: string;
  movementPatterns: string[];
  splitTag: string;
  isCompound: boolean;
  isMainLiftEligible: boolean;
  jointStress: string;
  equipment: string[];
  fatigueCost: number;
  primaryMuscles: string[];
  secondaryMuscles: string[];
};

const catalogPath = path.join(process.cwd(), "prisma", "exercises_comprehensive.json");
const aliasSeedPath = path.join(process.cwd(), "prisma", "exercise-aliases.ts");

function loadCatalog(): CatalogExercise[] {
  return JSON.parse(fs.readFileSync(catalogPath, "utf8")).exercises;
}

function byName(name: string): CatalogExercise {
  const found = loadCatalog().find((exercise) => exercise.name === name);
  if (!found) {
    throw new Error(`Missing catalog exercise: ${name}`);
  }
  return found;
}

function materializationExercise(name: string): V2MaterializationExercise {
  const row = byName(name);
  return {
    exerciseId: normalizeV2MaterializationText(name).replace(/\s+/g, "-"),
    name: row.name,
    aliases: [],
    movementPatterns: row.movementPatterns.map((pattern) => pattern.toLowerCase()),
    primaryMuscles: row.primaryMuscles,
    secondaryMuscles: row.secondaryMuscles,
    equipment: row.equipment.map((equipment) => equipment.toLowerCase()),
    isCompound: row.isCompound,
    isMainLiftEligible: row.isMainLiftEligible,
    fatigueCost: row.fatigueCost,
    stimulusByMusclePerSet: Object.fromEntries(
      getEffectiveStimulusByMuscle(
        {
          id: normalizeV2MaterializationText(name).replace(/\s+/g, "-"),
          name: row.name,
          aliases: [],
          primaryMuscles: row.primaryMuscles,
          secondaryMuscles: row.secondaryMuscles,
        },
        1,
        { logFallback: false },
      ),
    ),
  };
}

function classIdsForCatalogExercise(name: string): string[] {
  return matchV2ExerciseClasses(materializationExercise(name)).map(
    (match) => match.classId,
  );
}

describe("V2 materialization exercise catalog coverage", () => {
  it("keeps exercise names unique while adding user-observed machines", () => {
    const names = loadCatalog().map((exercise) => exercise.name);

    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(
      expect.arrayContaining([
        "Machine Hip Thrust",
        "Iso-Lateral High Row",
        "Iso-Lateral Low Row",
        "Iso-Lateral Front Lat Pulldown",
        "Iso-Lateral Incline Press",
        "Iso-Lateral Decline Press",
        "45-Degree Back Extension, Hamstring Bias",
        "Seated Machine Shrug",
        "Seated Dip Machine",
        "Oblique Crunch Machine",
        "Torso Rotation Machine",
      ]),
    );
    expect(names.filter((name) => name === "Torso Rotation Machine")).toHaveLength(1);
  });

  it("stores conservative taxonomy metadata for added machines", () => {
    expect(byName("Machine Hip Thrust")).toMatchObject({
      movementPatterns: ["hinge"],
      equipment: ["Machine"],
      primaryMuscles: ["Glutes"],
      secondaryMuscles: ["Hamstrings"],
      jointStress: "low",
      fatigueCost: 2,
      isMainLiftEligible: false,
    });
    expect(byName("Iso-Lateral Front Lat Pulldown")).toMatchObject({
      movementPatterns: ["vertical_pull"],
      primaryMuscles: ["Lats"],
      equipment: ["Machine"],
    });
    expect(byName("45-Degree Back Extension, Hamstring Bias")).toMatchObject({
      movementPatterns: ["extension"],
      primaryMuscles: ["Hamstrings", "Glutes"],
      secondaryMuscles: ["Lower Back"],
    });
    expect(byName("Seated Dip Machine")).toMatchObject({
      movementPatterns: ["vertical_push"],
      primaryMuscles: ["Triceps"],
      secondaryMuscles: ["Chest", "Front Delts"],
      jointStress: "medium",
    });
    expect(byName("Seated Machine Shrug")).toMatchObject({
      movementPatterns: ["isolation"],
      primaryMuscles: ["Upper Back"],
      equipment: ["Machine"],
    });
  });

  it("declares aliases for user-observed names without adding duplicate rows", () => {
    const seedText = fs.readFileSync(aliasSeedPath, "utf8");

    for (const alias of [
      "Glute Drive",
      "Glute Trainer",
      "Bridge Glute Lifts",
      "Front Lat Pulldown",
      "Hamstring-Focused Back Extension",
      "Standing Machine Shrug",
      "Seated Dip",
      "Oblique Crunch",
      "Torso Rotation",
      "Rotary Torso",
    ]) {
      expect(seedText).toContain(`alias: "${alias}"`);
    }
  });

  it("keeps named catalog rows aligned with V2 materialization taxonomy guards", () => {
    expect(classIdsForCatalogExercise("Pec Deck Machine")).toContain(
      "distinct_chest_press_or_fly",
    );
    expect(classIdsForCatalogExercise("Cable Crossover")).toContain(
      "distinct_chest_press_or_fly",
    );
    expect(classIdsForCatalogExercise("Straight-Arm Pulldown")).not.toContain(
      "vertical_pull",
    );
    expect(classIdsForCatalogExercise("Cable Pullover")).not.toContain(
      "vertical_pull",
    );
    expect(classIdsForCatalogExercise("Preacher Curl")).toContain(
      "biceps_isolation",
    );

    const landminePress = materializationExercise("Landmine Press");
    const landmineChestClass = matchV2ExerciseClasses(landminePress).find(
      (match) => match.classId === "distinct_chest_press_or_fly",
    );
    expect(
      evaluateV2AnchorLaneQuality(
        "chest_anchor",
        landminePress,
        landmineChestClass,
      ),
    ).toMatchObject({
      tier: "ineligible",
      reasons: ["missing_direct_chest"],
    });
  });
});
