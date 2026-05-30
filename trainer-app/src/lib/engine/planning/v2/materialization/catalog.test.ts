import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

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
const seedPath = path.join(process.cwd(), "prisma", "seed.ts");

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
    const seedText = fs.readFileSync(seedPath, "utf8");

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
});
