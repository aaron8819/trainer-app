import { describe, expect, it } from "vitest";
import catalog from "../../../prisma/exercises_comprehensive.json";
import { exerciseAliases } from "../../../prisma/exercise-aliases";
import { MEASUREMENT_SUPPORT_MANIFEST } from "../exercise-measurement/catalog-support-manifest";
import {
  assertCatalogInvariants,
  normalizeCatalogIdentityKey,
  validateCatalogInvariants,
  validateMeasurementSupportManifest,
  type CatalogAliasDefinition,
  type CatalogExerciseDefinition,
  type MeasurementSupportManifest,
} from "./catalog-invariants";
import { REVIEWED_STEP_2A_MEASUREMENT_MEMBERSHIP } from "./step-2a-measurement-membership";
import {
  ALL_MOVEMENT_PATTERNS,
  MOVEMENT_PATTERN_LABELS,
} from "./constants";

function exercise(
  overrides: Partial<CatalogExerciseDefinition> = {},
): CatalogExerciseDefinition {
  return {
    catalogKey: "pec-deck-machine",
    facts: {
      version: 1,
      stimulus: { disposition: "COMPLETE", profile: { chest: 1 } },
    },
    name: "Pec Deck Machine",
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

function supportManifestErrors(
  overrides: Partial<MeasurementSupportManifest>,
): string[] {
  return validateMeasurementSupportManifest({
    manifest: { ...MEASUREMENT_SUPPORT_MANIFEST, ...overrides },
    canonicalNames: catalog.exercises.map(({ name }) => name),
  });
}

function sameCountAmbiguousUnsupportedSwap(
  ambiguousIdentity: string,
  unsupportedIdentity: string,
): string[] {
  const ambiguous: string[] = [
    ...MEASUREMENT_SUPPORT_MANIFEST.AMBIGUOUS_EXECUTION_IDENTITY,
  ];
  const unsupported: string[] = [
    ...MEASUREMENT_SUPPORT_MANIFEST.UNSUPPORTED_MEASUREMENT_SEMANTICS,
  ];
  const ambiguousIndex = ambiguous.indexOf(ambiguousIdentity);
  const unsupportedIndex = unsupported.indexOf(unsupportedIdentity);
  if (ambiguousIndex < 0 || unsupportedIndex < 0) {
    throw new Error(
      `Invalid swap fixture: ${ambiguousIdentity} / ${unsupportedIdentity}`,
    );
  }
  ambiguous[ambiguousIndex] = unsupportedIdentity;
  unsupported[unsupportedIndex] = ambiguousIdentity;
  return supportManifestErrors({
    AMBIGUOUS_EXECUTION_IDENTITY: ambiguous,
    UNSUPPORTED_MEASUREMENT_SEMANTICS: unsupported,
  });
}

describe("exercise catalog invariants", () => {
  it("accepts the production measurement-support manifest", () => {
    expect(
      validateMeasurementSupportManifest({
        manifest: MEASUREMENT_SUPPORT_MANIFEST,
        canonicalNames: catalog.exercises.map(({ name }) => name),
      }),
    ).toEqual([]);
  });

  it("keeps an independent exact reviewed Step 2A membership oracle", () => {
    const names = REVIEWED_STEP_2A_MEASUREMENT_MEMBERSHIP.map(([name]) => name);
    const counts = Object.fromEntries(
      [
        "COMPLETE_SUPPORTED",
        "AMBIGUOUS_EXECUTION_IDENTITY",
        "UNSUPPORTED_MEASUREMENT_SEMANTICS",
      ].map((category) => [
        category,
        REVIEWED_STEP_2A_MEASUREMENT_MEMBERSHIP.filter(
          ([, actualCategory]) => actualCategory === category,
        ).length,
      ]),
    );

    expect(names).toHaveLength(150);
    expect(new Set(names)).toHaveLength(150);
    expect([...names].sort()).toEqual(
      catalog.exercises.map(({ name }) => name).sort(),
    );
    expect(counts).toEqual({
      COMPLETE_SUPPORTED: 91,
      AMBIGUOUS_EXECUTION_IDENTITY: 37,
      UNSUPPORTED_MEASUREMENT_SEMANTICS: 22,
    });
  });

  it("rejects the reviewed back-extension/Copenhagen same-count swap", () => {
    const errors = sameCountAmbiguousUnsupportedSwap(
      "45-Degree Back Extension, Hamstring Bias",
      "Copenhagen Plank",
    );
    expect(errors.filter((error) => error.includes("CATEGORY_COUNT"))).toEqual(
      [],
    );
    expect(errors).toEqual(
      expect.arrayContaining([
        "CATALOG_MEASUREMENT_MEMBERSHIP_MISMATCH:45-Degree Back Extension, Hamstring Bias:expected:AMBIGUOUS_EXECUTION_IDENTITY:actual:UNSUPPORTED_MEASUREMENT_SEMANTICS",
        "CATALOG_MEASUREMENT_MEMBERSHIP_MISMATCH:Copenhagen Plank:expected:UNSUPPORTED_MEASUREMENT_SEMANTICS:actual:AMBIGUOUS_EXECUTION_IDENTITY",
      ]),
    );
  });

  it("rejects an arbitrary same-count Step 2A category swap", () => {
    const errors = sameCountAmbiguousUnsupportedSwap(
      "Barbell Curl",
      "Dead Hang",
    );
    expect(errors.filter((error) => error.includes("CATEGORY_COUNT"))).toEqual(
      [],
    );
    expect(errors).toEqual(
      expect.arrayContaining([
        "CATALOG_MEASUREMENT_MEMBERSHIP_MISMATCH:Barbell Curl:expected:AMBIGUOUS_EXECUTION_IDENTITY:actual:UNSUPPORTED_MEASUREMENT_SEMANTICS",
        "CATALOG_MEASUREMENT_MEMBERSHIP_MISMATCH:Dead Hang:expected:UNSUPPORTED_MEASUREMENT_SEMANTICS:actual:AMBIGUOUS_EXECUTION_IDENTITY",
      ]),
    );
  });

  it.each([
    {
      label: "normalized duplicate canonical names",
      exercises: [exercise(), exercise({ name: " pec deck-machine " })],
      aliases: [],
      diagnostic: "CATALOG_CANONICAL_NAME_DUPLICATE",
    },
    {
      label: "normalized duplicate aliases",
      exercises: [exercise()],
      aliases: [
        { exerciseName: "Pec Deck Machine", alias: "Pec Fly" },
        { exerciseName: "Pec Deck Machine", alias: "pec-fly" },
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
      aliases: [{ exerciseName: "Pec Deck Machine", alias: "barbell-bench press" }],
      diagnostic: "CATALOG_ALIAS_CANONICAL_COLLISION",
    },
    {
      label: "empty primary muscles",
      exercises: [exercise({ primaryMuscles: [] })],
      aliases: [],
      diagnostic: "CATALOG_PRIMARY_MUSCLES_EMPTY:Pec Deck Machine",
    },
    {
      label: "overlapping muscle roles",
      exercises: [exercise({ secondaryMuscles: ["Glutes"] })],
      aliases: [],
      diagnostic: "CATALOG_MUSCLE_ROLE_OVERLAP:Pec Deck Machine:Glutes",
    },
    {
      label: "unknown movement patterns",
      exercises: [exercise({ movementPatterns: ["anti_flexion"] })],
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
      diagnostic: "CATALOG_MEASUREMENT_INVALID:Pec Deck Machine",
    },
    {
      label: "unknown load conventions",
      exercises: [exercise({ loadConvention: "PLATE_COUNT" })],
      aliases: [],
      diagnostic: "CATALOG_MEASUREMENT_INVALID:Pec Deck Machine",
    },
    {
      label: "unknown rep aggregation values",
      exercises: [exercise({ repBasis: "PER_IMPLEMENT" })],
      aliases: [],
      diagnostic: "CATALOG_MEASUREMENT_INVALID:Pec Deck Machine",
    },
    {
      label: "missing tuples for complete-supported identities",
      exercises: [
        exercise({
          loadConvention: undefined,
        }),
      ],
      aliases: [],
      diagnostic: "CATALOG_MEASUREMENT_COMPLETE_TUPLE_MISMATCH:Pec Deck Machine",
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
      label: "generic machine-display tuples for unsupported plate-loaded identities",
      exercises: [exercise({ name: "Chest-Supported T-Bar Row" })],
      aliases: [],
      diagnostic:
        "CATALOG_MEASUREMENT_PARTITION_CONFLICT:Chest-Supported T-Bar Row:UNSUPPORTED_MEASUREMENT_SEMANTICS",
    },
    {
      label: "generic machine-display tuples for ambiguous machine identities",
      exercises: [exercise({ name: "Machine Hip Thrust" })],
      aliases: [],
      diagnostic:
        "CATALOG_MEASUREMENT_PARTITION_CONFLICT:Machine Hip Thrust:AMBIGUOUS_EXECUTION_IDENTITY",
    },
    {
      label: "main-lift-eligible isolation exercises",
      exercises: [exercise({ isCompound: false, isMainLiftEligible: true })],
      aliases: [],
      diagnostic: "CATALOG_MAIN_LIFT_REQUIRES_COMPOUND:Pec Deck Machine",
    },
  ])("rejects $label with an identity-specific diagnostic", ({ exercises, aliases, diagnostic }) => {
    expect(errorsFor({ exercises, aliases })).toEqual(
      expect.arrayContaining([expect.stringContaining(diagnostic)]),
    );
  });

  it("rejects duplicate, unknown, and overlapping manifest identities", () => {
    expect(
      supportManifestErrors({
        AMBIGUOUS_EXECUTION_IDENTITY: [
          ...MEASUREMENT_SUPPORT_MANIFEST.AMBIGUOUS_EXECUTION_IDENTITY,
          "Romanian Deadlift",
        ],
      }),
    ).toEqual(
      expect.arrayContaining([
        "CATALOG_MEASUREMENT_MANIFEST_DUPLICATE:AMBIGUOUS_EXECUTION_IDENTITY:Romanian Deadlift",
      ]),
    );

    expect(
      supportManifestErrors({
        UNSUPPORTED_MEASUREMENT_SEMANTICS: [
          ...MEASUREMENT_SUPPORT_MANIFEST.UNSUPPORTED_MEASUREMENT_SEMANTICS,
          "Unknown Exercise",
        ],
      }),
    ).toEqual(
      expect.arrayContaining([
        "CATALOG_MEASUREMENT_MANIFEST_UNKNOWN:UNSUPPORTED_MEASUREMENT_SEMANTICS:Unknown Exercise",
      ]),
    );

    expect(
      supportManifestErrors({
        AMBIGUOUS_EXECUTION_IDENTITY: [
          ...MEASUREMENT_SUPPORT_MANIFEST.AMBIGUOUS_EXECUTION_IDENTITY,
          "Plank",
        ],
      }),
    ).toEqual(
      expect.arrayContaining(["CATALOG_MEASUREMENT_PARTITION_OVERLAP:Plank"]),
    );
  });

  it("accepts the complete checked-in catalog and resolves the decline alias exactly and after normalization", () => {
    expect(() =>
      assertCatalogInvariants({
        exercises: catalog.exercises as CatalogExerciseDefinition[],
        aliases: exerciseAliases,
      }),
    ).not.toThrow();

    expect(
      catalog.exercises
        .filter((exercise) => exercise.zeroLoadMeaning != null)
        .map((exercise) => [exercise.catalogKey, exercise.zeroLoadMeaning])
        .sort(([left], [right]) => left.localeCompare(right)),
    ).toEqual([
      ["bulgarian-split-squat", "BODYWEIGHT_NO_ADDED_LOAD"],
      ["hack-squat", "MACHINE_DEFAULT_NO_ADDED_LOAD"],
    ]);

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

  it("accepts anti-extension and exposes its library filter label", () => {
    const abWheel = catalog.exercises.find(
      ({ catalogKey }) => catalogKey === "ab-wheel-rollout",
    );

    expect(abWheel?.movementPatterns).toEqual(["anti_extension"]);
    expect(ALL_MOVEMENT_PATTERNS).toContain("anti_extension");
    expect(MOVEMENT_PATTERN_LABELS.anti_extension).toBe("Anti-Extension");
  });
});
