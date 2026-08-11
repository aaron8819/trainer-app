import { describe, expect, it } from "vitest";
import catalog from "../../../prisma/exercises_comprehensive.json";
import { exerciseAliases } from "../../../prisma/exercise-aliases";
import {
  assertCatalogInvariants,
  normalizeCatalogIdentityKey,
  validateCatalogInvariants,
  type CatalogAliasDefinition,
  type CatalogExerciseDefinition,
} from "./catalog-invariants";

function exercise(
  overrides: Partial<CatalogExerciseDefinition> = {},
): CatalogExerciseDefinition {
  return {
    name: "Machine Hip Thrust",
    movementPatterns: ["hinge"],
    splitTag: "legs",
    isCompound: true,
    isMainLiftEligible: true,
    jointStress: "low",
    equipment: ["Machine"],
    fatigueCost: 2,
    sfrScore: 4,
    lengthPositionScore: 4,
    stimulusBias: ["mechanical"],
    contraindications: null,
    primaryMuscles: ["Glutes"],
    secondaryMuscles: ["Hamstrings"],
    difficulty: "beginner",
    unilateral: false,
    repRangeRecommendation: { min: 8, max: 15 },
    measurementProfile: "REPS_EXTERNAL_LOAD",
    loadConvention: "MACHINE_DISPLAYED",
    repBasis: "TOTAL",
    ...overrides,
  };
}

function errorsFor(input: {
  exercises?: CatalogExerciseDefinition[];
  aliases?: CatalogAliasDefinition[];
}): string[] {
  return validateCatalogInvariants({
    exercises: input.exercises ?? [exercise()],
    aliases: input.aliases ?? [],
  });
}

describe("exercise catalog invariants", () => {
  it("accepts a structurally valid focused fixture", () => {
    expect(() =>
      assertCatalogInvariants({
        exercises: [exercise()],
        aliases: [{ exerciseName: "Machine Hip Thrust", alias: "Glute Drive" }],
      }),
    ).not.toThrow();
  });

  it.each([
    {
      label: "normalized duplicate canonical names",
      exercises: [exercise(), exercise({ name: " machine   hip-thrust " })],
      aliases: [],
      diagnostic: "CATALOG_CANONICAL_NAME_DUPLICATE",
    },
    {
      label: "normalized duplicate aliases",
      exercises: [exercise()],
      aliases: [
        { exerciseName: "Machine Hip Thrust", alias: "Glute Drive" },
        { exerciseName: "Machine Hip Thrust", alias: "glute-drive" },
      ],
      diagnostic: "CATALOG_ALIAS_DUPLICATE",
    },
    {
      label: "missing alias targets",
      exercises: [exercise()],
      aliases: [{ exerciseName: "Missing Exercise", alias: "Missing Alias" }],
      diagnostic: "CATALOG_ALIAS_TARGET_MISSING:Missing Alias:Missing Exercise",
    },
    {
      label: "aliases colliding with another canonical identity",
      exercises: [exercise(), exercise({ name: "Barbell Bench Press" })],
      aliases: [{ exerciseName: "Machine Hip Thrust", alias: "barbell-bench press" }],
      diagnostic: "CATALOG_ALIAS_CANONICAL_COLLISION",
    },
    {
      label: "empty primary muscles",
      exercises: [exercise({ primaryMuscles: [] })],
      aliases: [],
      diagnostic: "CATALOG_PRIMARY_MUSCLES_EMPTY:Machine Hip Thrust",
    },
    {
      label: "overlapping muscle roles",
      exercises: [exercise({ secondaryMuscles: ["Glutes"] })],
      aliases: [],
      diagnostic: "CATALOG_MUSCLE_ROLE_OVERLAP:Machine Hip Thrust:Glutes",
    },
    {
      label: "unknown movement patterns",
      exercises: [exercise({ movementPatterns: ["anti_extension"] })],
      aliases: [],
      diagnostic: "CATALOG_MOVEMENT_PATTERN_UNKNOWN",
    },
    {
      label: "unknown muscles",
      exercises: [exercise({ primaryMuscles: ["Hip Flexors"] })],
      aliases: [],
      diagnostic: "CATALOG_PRIMARY_MUSCLE_UNKNOWN",
    },
    {
      label: "unknown equipment",
      exercises: [exercise({ equipment: ["Smith Machine"] })],
      aliases: [],
      diagnostic: "CATALOG_EQUIPMENT_UNKNOWN",
    },
    {
      label: "unknown split tags",
      exercises: [exercise({ splitTag: "rehab" })],
      aliases: [],
      diagnostic: "CATALOG_SPLIT_TAG_UNKNOWN",
    },
    {
      label: "unknown joint stress values",
      exercises: [exercise({ jointStress: "very_low" })],
      aliases: [],
      diagnostic: "CATALOG_JOINT_STRESS_UNKNOWN",
    },
    {
      label: "unknown stimulus bias values",
      exercises: [exercise({ stimulusBias: ["power"] })],
      aliases: [],
      diagnostic: "CATALOG_STIMULUS_BIAS_UNKNOWN",
    },
    {
      label: "unknown difficulty values",
      exercises: [exercise({ difficulty: "expert" })],
      aliases: [],
      diagnostic: "CATALOG_DIFFICULTY_UNKNOWN",
    },
    {
      label: "incompatible measurement tuples",
      exercises: [
        exercise({
          measurementProfile: "REPS_BODYWEIGHT",
          loadConvention: "MACHINE_DISPLAYED",
        }),
      ],
      aliases: [],
      diagnostic: "CATALOG_MEASUREMENT_INVALID:Machine Hip Thrust",
    },
    {
      label: "unknown load conventions",
      exercises: [exercise({ loadConvention: "PLATE_COUNT" })],
      aliases: [],
      diagnostic: "CATALOG_MEASUREMENT_INVALID:Machine Hip Thrust",
    },
    {
      label: "unknown rep aggregation values",
      exercises: [exercise({ repBasis: "PER_IMPLEMENT" })],
      aliases: [],
      diagnostic: "CATALOG_MEASUREMENT_INVALID:Machine Hip Thrust",
    },
    {
      label: "unreviewed null measurement tuples",
      exercises: [
        exercise({
          name: "Unreviewed Exercise",
          measurementProfile: undefined,
          loadConvention: undefined,
          repBasis: undefined,
        }),
      ],
      aliases: [],
      diagnostic: "CATALOG_MEASUREMENT_PARTITION_GAP:Unreviewed Exercise",
    },
    {
      label: "populated tuples for ambiguous execution identities",
      exercises: [exercise({ name: "Romanian Deadlift" })],
      aliases: [],
      diagnostic:
        "CATALOG_MEASUREMENT_PARTITION_CONFLICT:Romanian Deadlift:AMBIGUOUS_EXECUTION_IDENTITY",
    },
    {
      label: "populated tuples for unsupported measurement semantics",
      exercises: [exercise({ name: "Plank" })],
      aliases: [],
      diagnostic:
        "CATALOG_MEASUREMENT_PARTITION_CONFLICT:Plank:UNSUPPORTED_MEASUREMENT_SEMANTICS",
    },
    {
      label: "main-lift-eligible isolation exercises",
      exercises: [exercise({ isCompound: false, isMainLiftEligible: true })],
      aliases: [],
      diagnostic: "CATALOG_MAIN_LIFT_REQUIRES_COMPOUND:Machine Hip Thrust",
    },
  ])("rejects $label with an identity-specific diagnostic", ({ exercises, aliases, diagnostic }) => {
    expect(errorsFor({ exercises, aliases })).toEqual(
      expect.arrayContaining([expect.stringContaining(diagnostic)]),
    );
  });

  it("accepts the complete checked-in catalog and resolves the decline alias exactly and after normalization", () => {
    expect(() =>
      assertCatalogInvariants({
        exercises: catalog.exercises as CatalogExerciseDefinition[],
        aliases: exerciseAliases,
      }),
    ).not.toThrow();

    const exact = exerciseAliases.find(
      (alias) => alias.alias === "Decline Barbell Bench",
    );
    const normalized = exerciseAliases.find(
      (alias) =>
        normalizeCatalogIdentityKey(alias.alias) ===
        normalizeCatalogIdentityKey("  decline-barbell   bench  "),
    );
    expect(exact?.exerciseName).toBe("Decline Barbell Bench Press");
    expect(normalized).toEqual(exact);
  });
});
