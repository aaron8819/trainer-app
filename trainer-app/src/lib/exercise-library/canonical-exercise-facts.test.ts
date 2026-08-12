import { describe, expect, it } from "vitest";
import catalog from "../../../prisma/exercises_comprehensive.json";
import { exerciseAliases } from "../../../prisma/exercise-aliases";
import {
  getExplicitStimulusProfileForExercise,
  INITIAL_STIMULUS_PROFILE_BY_NAME,
} from "../engine/stimulus";
import {
  indexCanonicalFactsByCatalogKey,
  parseCanonicalExerciseFactsV1,
  validateCanonicalExerciseFactsV1,
  type CanonicalExerciseFactsV1,
  type CanonicalFactsAuthoringEntry,
} from "./canonical-exercise-facts";
import {
  validateCatalogInvariants,
  type CatalogAliasDefinition,
  type CatalogExerciseDefinition,
  type CanonicalCatalogExerciseDefinition,
} from "./catalog-invariants";

const catalogExercises =
  catalog.exercises as unknown as readonly CanonicalCatalogExerciseDefinition[];

function authoringEntries(
  exercises: readonly CanonicalCatalogExerciseDefinition[] = catalogExercises,
): CanonicalFactsAuthoringEntry[] {
  return exercises.map(({ catalogKey, facts }) => ({ catalogKey, facts }));
}

function factsSnapshot(
  exercises: readonly CanonicalCatalogExerciseDefinition[] = catalogExercises,
): Record<string, CanonicalExerciseFactsV1> {
  return Object.fromEntries(indexCanonicalFactsByCatalogKey(authoringEntries(exercises)));
}

function consumedAliasSnapshot(
  aliases: readonly CatalogAliasDefinition[],
): string[] {
  return aliases
    .map(({ exerciseName, alias }) => JSON.stringify([exerciseName, alias]))
    .sort((left, right) => left.localeCompare(right));
}

function canonicalOwnershipSnapshot(
  exercises: readonly CanonicalCatalogExerciseDefinition[],
  aliases: readonly CatalogAliasDefinition[],
) {
  return {
    consumedAliases: consumedAliasSnapshot(aliases),
    catalogKeyByIdentity: Object.fromEntries(
      exercises.map(({ name, catalogKey }) => [name, catalogKey]),
    ),
    factsByCatalogKey: factsSnapshot(exercises),
  };
}

const validCompleteFacts = {
  version: 1,
  stimulus: {
    disposition: "COMPLETE",
    profile: { chest: 1 },
  },
} as const;

describe("canonical exercise authoring facts", () => {
  it("stores one unique key for every identity with exact reviewed membership", () => {
    const keys = catalogExercises.map(({ catalogKey }) => catalogKey);
    expect(keys).toHaveLength(150);
    expect(new Set(keys)).toHaveLength(150);
    expect([...keys].sort()).toEqual([
      "45-degree-back-extension-hamstring-bias",
      "ab-wheel-rollout",
      "alternating-dumbbell-curl",
      "arnold-press",
      "back-extension-45-degree",
      "barbell-back-squat",
      "barbell-bench-press",
      "barbell-curl",
      "barbell-hip-thrust",
      "barbell-overhead-press",
      "barbell-romanian-deadlift",
      "barbell-row",
      "barbell-shrug",
      "bayesian-curl",
      "belt-squat",
      "bicycle-crunch",
      "bulgarian-split-squat",
      "cable-crossover",
      "cable-crunch",
      "cable-curl",
      "cable-fly",
      "cable-front-raise",
      "cable-hip-abduction",
      "cable-lateral-raise",
      "cable-pallof-press",
      "cable-pull-through",
      "cable-pullover",
      "cable-rear-delt-fly",
      "cable-triceps-pushdown",
      "chest-supported-dumbbell-row",
      "chest-supported-t-bar-row",
      "chin-up",
      "close-grip-bench-press",
      "close-grip-lat-pulldown",
      "close-grip-seated-cable-row",
      "concentration-curl",
      "conventional-deadlift",
      "copenhagen-plank",
      "cross-body-hammer-curl",
      "dead-hang",
      "decline-barbell-bench-press",
      "decline-dumbbell-bench-press",
      "decline-sit-up",
      "deficit-push-up",
      "diamond-push-up",
      "dip-chest-emphasis",
      "dip-triceps-emphasis",
      "dragon-flag",
      "dumbbell-bench-press",
      "dumbbell-curl",
      "dumbbell-fly",
      "dumbbell-front-raise",
      "dumbbell-lateral-raise",
      "dumbbell-overhead-press",
      "dumbbell-pullover",
      "dumbbell-rear-delt-fly",
      "dumbbell-reverse-lunge",
      "dumbbell-romanian-deadlift",
      "dumbbell-row",
      "dumbbell-shrug",
      "ez-bar-curl",
      "face-pull",
      "farmers-walk",
      "front-squat",
      "glute-bridge",
      "goblet-squat",
      "good-morning",
      "hack-squat",
      "hammer-curl",
      "hanging-knee-raise",
      "hanging-leg-raise",
      "hip-abduction-machine",
      "hip-adduction-machine",
      "incline-barbell-bench-press",
      "incline-dumbbell-bench-press",
      "incline-dumbbell-curl",
      "incline-dumbbell-fly",
      "incline-machine-press",
      "inverted-row",
      "iso-lateral-decline-press",
      "iso-lateral-front-lat-pulldown",
      "iso-lateral-high-row",
      "iso-lateral-incline-press",
      "iso-lateral-low-row",
      "landmine-press",
      "landmine-rotation",
      "lat-pulldown",
      "leg-extension",
      "leg-press",
      "leg-press-calf-raise",
      "low-to-high-cable-fly",
      "lying-leg-curl",
      "lying-triceps-extension-skull-crusher",
      "machine-assisted-pull-up",
      "machine-chest-press",
      "machine-crunch",
      "machine-hip-thrust",
      "machine-lateral-raise",
      "machine-shoulder-press",
      "meadows-row",
      "neutral-grip-pull-up",
      "nordic-hamstring-curl",
      "oblique-crunch-machine",
      "one-arm-dumbbell-row",
      "overhead-cable-triceps-extension",
      "overhead-carry",
      "overhead-dumbbell-extension",
      "pallof-press",
      "pec-deck-machine",
      "pendlay-row",
      "plank",
      "preacher-curl",
      "pull-up",
      "push-up",
      "reverse-crunch",
      "reverse-curl",
      "reverse-hyperextension",
      "reverse-lunge",
      "reverse-pec-deck",
      "reverse-wrist-curl",
      "rkc-plank",
      "romanian-deadlift",
      "rope-triceps-pushdown",
      "russian-twist",
      "seated-barbell-overhead-press",
      "seated-cable-row",
      "seated-calf-raise",
      "seated-dip-machine",
      "seated-leg-curl",
      "seated-machine-shrug",
      "selectorized-standing-calf-raise",
      "side-plank",
      "single-leg-hip-thrust",
      "sissy-squat",
      "sled-drag",
      "sled-pull",
      "sled-push",
      "spider-curl",
      "standing-calf-raise",
      "stiff-legged-deadlift",
      "straight-arm-pulldown",
      "suitcase-carry",
      "sumo-deadlift",
      "t-bar-row",
      "torso-rotation-machine",
      "trap-bar-deadlift",
      "walking-lunge",
      "weighted-pull-up",
      "wood-chop",
      "wrist-curl",
    ]);
  });

  it("adds an execution-distinct Cable Pallof Press without changing the legacy identity", () => {
    const cablePallofPress = catalogExercises.find(
      ({ catalogKey }) => catalogKey === "cable-pallof-press",
    );
    const legacyPallofPress = catalogExercises.find(
      ({ catalogKey }) => catalogKey === "pallof-press",
    );

    expect(cablePallofPress).toEqual({
      name: "Cable Pallof Press",
      catalogKey: "cable-pallof-press",
      facts: {
        version: 1,
        stimulus: { disposition: "COMPLETE", profile: { core: 1 } },
      },
      measurementProfile: "REPS_EXTERNAL_LOAD",
      loadConvention: "MACHINE_DISPLAYED",
      repBasis: "PER_SIDE",
      movementPatterns: ["anti_rotation"],
      splitTag: "core",
      isCompound: false,
      isMainLiftEligible: false,
      jointStress: "low",
      equipment: ["Cable"],
      fatigueCost: 1,
      sfrScore: 4,
      lengthPositionScore: 1,
      stimulusBias: ["stability"],
      contraindications: null,
      primaryMuscles: ["Core"],
      secondaryMuscles: [],
      difficulty: "beginner",
      unilateral: false,
      repRangeRecommendation: { min: 8, max: 20 },
      timePerSetSec: 35,
    });
    expect(legacyPallofPress).toEqual({
      name: "Pallof Press",
      catalogKey: "pallof-press",
      facts: {
        version: 1,
        stimulus: { disposition: "COMPLETE", profile: { core: 1 } },
      },
      movementPatterns: ["anti_rotation"],
      splitTag: "core",
      isCompound: false,
      isMainLiftEligible: false,
      jointStress: "low",
      equipment: ["Cable", "Band"],
      fatigueCost: 1,
      sfrScore: 4,
      lengthPositionScore: 1,
      stimulusBias: ["stability"],
      contraindications: null,
      primaryMuscles: ["Core"],
      secondaryMuscles: [],
      difficulty: "beginner",
      unilateral: false,
      repRangeRecommendation: { min: 8, max: 20 },
      timePerSetSec: 35,
    });
    expect(
      exerciseAliases.filter(
        ({ exerciseName, alias }) =>
          /pallof/i.test(exerciseName) || /pallof/i.test(alias),
      ),
    ).toEqual([]);
  });

  it("stores an explicit stimulus disposition for every identity", () => {
    const dispositions = catalogExercises.map(
      ({ facts }) => parseCanonicalExerciseFactsV1(facts).stimulus.disposition,
    );
    expect(dispositions).toHaveLength(150);
    expect(dispositions.filter((value) => value === "COMPLETE")).toHaveLength(149);
    expect(dispositions.filter((value) => value === "MISSING")).toHaveLength(1);
    expect(
      dispositions.filter(
        (value) => value !== "COMPLETE" && value !== "MISSING",
      ),
    ).toEqual([]);
  });

  it("preserves all explicit production vectors exactly", () => {
    const aliasesByName = new Map<string, string[]>();
    for (const { exerciseName, alias } of exerciseAliases) {
      aliasesByName.set(exerciseName, [
        ...(aliasesByName.get(exerciseName) ?? []),
        alias,
      ]);
    }

    const directCanonicalProfiles = catalogExercises.filter(
      ({ name }) =>
        INITIAL_STIMULUS_PROFILE_BY_NAME[
          name.trim().toLowerCase().replace(/\s+/g, " ")
        ] != null,
    );
    expect(directCanonicalProfiles).toHaveLength(148);

    for (const exercise of catalogExercises) {
      const authored = parseCanonicalExerciseFactsV1(exercise.facts).stimulus;
      const production = getExplicitStimulusProfileForExercise({
        name: exercise.name,
        aliases: aliasesByName.get(exercise.name),
      });
      if (exercise.catalogKey === "machine-assisted-pull-up") {
        expect(authored).toEqual({ disposition: "MISSING" });
        expect(production).toBeUndefined();
        continue;
      }
      expect(authored.disposition).toBe("COMPLETE");
      if (authored.disposition === "COMPLETE") {
        expect(authored.profile).toEqual(production);
      }
    }
  });

  it("gives Farmer's Walk exact canonical ownership", () => {
    const farmerFacts = factsSnapshot()["farmers-walk"];
    expect(farmerFacts.stimulus).toEqual({
      disposition: "COMPLETE",
      profile: {
        forearms: 1,
        core: 0.6,
        upper_back: 0.35,
      },
    });
  });

  it("classifies only Machine-Assisted Pull-Up as missing", () => {
    const nonComplete = catalogExercises
      .filter(({ facts }) => facts.stimulus.disposition !== "COMPLETE")
      .map(({ catalogKey, facts }) => [catalogKey, facts.stimulus.disposition]);
    expect(nonComplete).toEqual([["machine-assisted-pull-up", "MISSING"]]);
  });

  it("keeps facts stable when every display label is renamed", () => {
    const renamed = catalogExercises.map((exercise, index) => ({
      ...structuredClone(exercise),
      name: `Renamed display label ${index + 1}`,
    }));
    expect(factsSnapshot(renamed)).toEqual(factsSnapshot());
  });

  it.each([
    {
      label: "adds a managed alias",
      expectedAliasCount: 55,
      aliases: [
        ...exerciseAliases,
        { exerciseName: "Barbell Back Squat", alias: "Semantic Squat Alias" },
      ],
    },
    {
      label: "removes a managed alias",
      expectedAliasCount: 53,
      aliases: exerciseAliases.filter(
        ({ alias }) => alias !== "Farmer's Carry",
      ),
    },
    {
      label: "changes an existing managed alias",
      expectedAliasCount: 54,
      aliases: exerciseAliases.map((alias, index) =>
        index === 0 ? { ...alias, alias: "Changed Alias" } : alias,
      ),
    },
    {
      label: "adds an alias matching another canonical identity",
      expectedAliasCount: 55,
      aliases: [
        ...exerciseAliases,
        { exerciseName: "Barbell Back Squat", alias: "Copenhagen Plank" },
      ],
    },
    {
      label: "adds an alias matching a legacy stimulus-registry key",
      expectedAliasCount: 55,
      aliases: [
        ...exerciseAliases,
        {
          exerciseName: "Machine-Assisted Pull-Up",
          alias: "Farmer's Carry",
        },
      ],
    },
  ])(
    "$label without changing canonical ownership",
    ({ aliases, expectedAliasCount }) => {
      const baseline = canonicalOwnershipSnapshot(
        catalogExercises,
        exerciseAliases,
      );
      const mutated = canonicalOwnershipSnapshot(catalogExercises, aliases);

      expect(aliases).toHaveLength(expectedAliasCount);
      expect(mutated.consumedAliases).toEqual(consumedAliasSnapshot(aliases));
      expect(mutated.consumedAliases).not.toEqual(baseline.consumedAliases);
      expect(mutated.catalogKeyByIdentity).toEqual(baseline.catalogKeyByIdentity);
      expect(mutated.factsByCatalogKey).toEqual(baseline.factsByCatalogKey);
      expect(mutated.catalogKeyByIdentity["Farmer's Walk"]).toBe("farmers-walk");
      expect(mutated.factsByCatalogKey["farmers-walk"].stimulus).toEqual({
        disposition: "COMPLETE",
        profile: { forearms: 1, core: 0.6, upper_back: 0.35 },
      });
      expect(mutated.catalogKeyByIdentity["Machine-Assisted Pull-Up"]).toBe(
        "machine-assisted-pull-up",
      );
      expect(
        mutated.factsByCatalogKey["machine-assisted-pull-up"].stimulus,
      ).toEqual({ disposition: "MISSING" });
    },
  );

  it("rejects a new identity without a stored key and with empty stimulus facts", () => {
    const unreviewed = {
      ...structuredClone(catalogExercises[0]),
      name: "Unreviewed Exercise",
      catalogKey: undefined,
      facts: { version: 1, stimulus: {} },
    } as unknown as CanonicalCatalogExerciseDefinition;
    const errors = validateCatalogInvariants({
      exercises: [...catalogExercises, unreviewed],
      aliases: exerciseAliases,
    });
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("CATALOG_KEY_INVALID:Unreviewed Exercise"),
        expect.stringContaining(
          "CATALOG_CANONICAL_STIMULUS_DISPOSITION_INVALID",
        ),
      ]),
    );
  });

  it("rejects a catalog entry with the entire facts property absent", () => {
    const withoutFacts = structuredClone(
      catalogExercises[0],
    ) as CatalogExerciseDefinition;
    delete withoutFacts.facts;
    expect(Object.prototype.hasOwnProperty.call(withoutFacts, "facts")).toBe(
      false,
    );

    const errors = validateCatalogInvariants({
      exercises: [withoutFacts, ...catalogExercises.slice(1)],
      aliases: exerciseAliases,
    });
    expect(errors).toContain(
      "CATALOG_CANONICAL_FACTS_NOT_OBJECT:barbell-back-squat",
    );
  });

  it("rejects duplicate and malformed catalog keys", () => {
    expect(() =>
      indexCanonicalFactsByCatalogKey([
        { catalogKey: "valid-key", facts: validCompleteFacts },
        { catalogKey: "valid-key", facts: validCompleteFacts },
      ]),
    ).toThrow("Duplicate catalog key: valid-key");
    for (const catalogKey of [
      "",
      "Uppercase-key",
      "contains spaces",
      "leading-",
      "-trailing",
      "double--hyphen",
      "underscore_key",
    ]) {
      expect(() =>
        indexCanonicalFactsByCatalogKey([
          { catalogKey, facts: validCompleteFacts },
        ]),
      ).toThrow(`Invalid catalog key: ${catalogKey}`);
    }
  });

  it.each([
    ["missing profile", { version: 1, stimulus: { disposition: "COMPLETE" } }],
    [
      "empty profile",
      { version: 1, stimulus: { disposition: "COMPLETE", profile: {} } },
    ],
    [
      "malformed profile",
      { version: 1, stimulus: { disposition: "COMPLETE", profile: "chest" } },
    ],
    [
      "unknown muscle",
      {
        version: 1,
        stimulus: { disposition: "COMPLETE", profile: { traps: 1 } },
      },
    ],
    [
      "nonfinite weight",
      {
        version: 1,
        stimulus: { disposition: "COMPLETE", profile: { chest: Infinity } },
      },
    ],
    [
      "zero weight",
      {
        version: 1,
        stimulus: { disposition: "COMPLETE", profile: { chest: 0 } },
      },
    ],
    [
      "negative weight",
      {
        version: 1,
        stimulus: { disposition: "COMPLETE", profile: { chest: -0.1 } },
      },
    ],
  ])("rejects a complete disposition with a %s", (_label, facts) => {
    expect(validateCanonicalExerciseFactsV1(facts)).not.toEqual([]);
    expect(() => parseCanonicalExerciseFactsV1(facts)).toThrow();
  });

  it.each(["NOT_APPLICABLE", "AMBIGUOUS", "UNSUPPORTED", "MISSING"])(
    "rejects a profile attached to %s",
    (disposition) => {
      const facts = {
        version: 1,
        stimulus: { disposition, profile: { chest: 1 } },
      };
      expect(validateCanonicalExerciseFactsV1(facts)).toEqual(
        expect.arrayContaining([
          "CANONICAL_STIMULUS_FIELD_INCOMPATIBLE:profile",
        ]),
      );
    },
  );

  it("rejects invalid versions, dispositions, fields, and populated taxonomy", () => {
    expect(
      validateCanonicalExerciseFactsV1({
        version: 2,
        stimulus: { disposition: "NEUTRAL" },
        fallback: "primary-secondary",
        taxonomy: {},
      }),
    ).toEqual(
      expect.arrayContaining([
        "CANONICAL_FACTS_UNKNOWN_FIELD:fallback",
        "CANONICAL_FACTS_VERSION_INVALID",
        "CANONICAL_FACTS_TAXONOMY_DEFERRED",
        "CANONICAL_STIMULUS_DISPOSITION_INVALID",
      ]),
    );
  });

  it("never synthesizes a generic authoring fallback", () => {
    expect(() =>
      parseCanonicalExerciseFactsV1({
        version: 1,
        stimulus: { disposition: "COMPLETE" },
        primaryMuscles: ["Quads"],
        secondaryMuscles: ["Glutes"],
      }),
    ).toThrow("CANONICAL_STIMULUS_COMPLETE_PROFILE_INVALID");
  });

  it("forbids aliases from owning canonical keys or facts", () => {
    const aliasWithFacts = {
      exerciseName: "Barbell Back Squat",
      alias: "Squat Facts Owner",
      catalogKey: "alias-owned-key",
      facts: validCompleteFacts,
    };
    const errors = validateCatalogInvariants({
      exercises: catalogExercises,
      aliases: [
        ...exerciseAliases,
        aliasWithFacts as unknown as CatalogAliasDefinition,
      ],
    });
    expect(errors).toContain(
      "CATALOG_ALIAS_FACTS_OWNER_FORBIDDEN:Squat Facts Owner",
    );
  });

  it("keeps taxonomy absent from every Stage 1 entry", () => {
    expect(
      catalogExercises.filter(({ facts }) =>
        Object.prototype.hasOwnProperty.call(facts, "taxonomy"),
      ),
    ).toEqual([]);
  });
});
