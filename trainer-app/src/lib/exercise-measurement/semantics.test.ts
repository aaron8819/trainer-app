import { describe, expect, it } from "vitest";
import { exerciseAliases } from "../../../prisma/exercise-aliases";
import catalog from "../../../prisma/exercises_comprehensive.json";
import {
  AMBIGUOUS_EXECUTION_IDENTITIES,
  COMPLETE_SUPPORTED_MEASUREMENT_IDENTITIES,
  STEP_2A_AMBIGUOUS_CORRECTIONS,
  STEP_2A_PRESERVED_MEASUREMENT_ASSIGNMENTS,
  STEP_2A_UNSUPPORTED_CORRECTIONS,
  UNSUPPORTED_MEASUREMENT_IDENTITIES,
} from "./catalog-support-manifest";
import {
  measurementComparisonKey,
  measurementLoadLabel,
  measurementRepsLabel,
  parseMeasurementColumns,
  permitsComputedLoadComparison,
  quantizesAsPounds,
} from "./semantics";

const byName = new Map(
  catalog.exercises.map((exercise) => [exercise.name, exercise]),
);

function expectUnclassified(names: readonly string[]) {
  for (const name of names) {
    const exercise = byName.get(name);
    expect(exercise, name).toBeDefined();
    expect(exercise?.measurementProfile, name).toBeUndefined();
    expect(exercise?.loadConvention, name).toBeUndefined();
    expect(exercise?.repBasis, name).toBeUndefined();
  }
}

describe("exercise measurement semantics", () => {
  it("accepts only all-null or complete supported tuples", () => {
    expect(
      parseMeasurementColumns({
        measurementProfile: null,
        loadConvention: null,
        repBasis: null,
      }),
    ).toBeNull();
    expect(
      parseMeasurementColumns({
        measurementProfile: "REPS_BODYWEIGHT",
        loadConvention: null,
        repBasis: "TOTAL",
      }),
    ).toEqual({ profile: "REPS_BODYWEIGHT", repBasis: "TOTAL" });
    expect(() =>
      parseMeasurementColumns({
        measurementProfile: "REPS_EXTERNAL_LOAD",
        loadConvention: null,
        repBasis: "TOTAL",
      }),
    ).toThrow();
    expect(() =>
      parseMeasurementColumns({
        measurementProfile: "REPS_ASSISTED",
        loadConvention: "ADDED_EXTERNAL_LOAD",
        repBasis: "TOTAL",
      }),
    ).toThrow();
    expect(() =>
      parseMeasurementColumns({
        measurementProfile: "UNSUPPORTED_PROFILE",
        loadConvention: null,
        repBasis: "TOTAL",
      }),
    ).toThrow();
  });

  it("derives classified safety from supported tuples instead of pilot names", () => {
    expect(parseMeasurementColumns(byName.get("Lat Pulldown") ?? {})).toEqual({
      profile: "REPS_EXTERNAL_LOAD",
      loadConvention: "MACHINE_DISPLAYED",
      repBasis: "TOTAL",
    });
    expect(parseMeasurementColumns(byName.get("Romanian Deadlift") ?? {})).toBeNull();
  });

  it("derives labels, quantization, and fail-closed comparison behavior", () => {
    const assisted = parseMeasurementColumns({
      measurementProfile: "REPS_ASSISTED",
      loadConvention: "DISPLAYED_ASSISTANCE",
      repBasis: "TOTAL",
    });
    expect(measurementLoadLabel(assisted)).toBe(
      "Displayed assistance (less is harder)",
    );
    expect(quantizesAsPounds(assisted)).toBe(false);
    expect(permitsComputedLoadComparison(assisted)).toBe(false);
    expect(
      measurementRepsLabel({
        profile: "REPS_EXTERNAL_LOAD",
        loadConvention: "IMPLEMENT_WEIGHT",
        repBasis: "PER_SIDE",
      }),
    ).toBe("Reps per side");
    expect(
      measurementComparisonKey({ exerciseId: "pull-up", measurement: assisted }),
    ).not.toBe(
      measurementComparisonKey({ exerciseId: "pull-up", measurement: null }),
    );
  });

  it.each([
    ["REPS_EXTERNAL_LOAD", "BARBELL_TOTAL", "Total bar load"],
    ["REPS_EXTERNAL_LOAD", "IMPLEMENT_WEIGHT", "Weight per implement (lb)"],
    ["REPS_EXTERNAL_LOAD", "MACHINE_DISPLAYED", "Machine displayed value"],
    ["REPS_BODYWEIGHT_PLUS_LOAD", "ADDED_EXTERNAL_LOAD", "Added load (lb)"],
    ["REPS_ASSISTED", "DISPLAYED_ASSISTANCE", "Displayed assistance (less is harder)"],
  ] as const)("labels %s/%s from frozen semantics", (profile, loadConvention, label) => {
    expect(
      measurementLoadLabel(
        parseMeasurementColumns({
          measurementProfile: profile,
          loadConvention,
          repBasis: "TOTAL",
        }),
      ),
    ).toBe(label);
  });

  it("matches the catalog to the production-owned 89-tuple complete manifest", () => {
    expect(COMPLETE_SUPPORTED_MEASUREMENT_IDENTITIES).toHaveLength(89);
    expect(
      new Set(COMPLETE_SUPPORTED_MEASUREMENT_IDENTITIES.map(([name]) => name)).size,
    ).toBe(89);

    const classified = catalog.exercises.filter(
      (exercise) => exercise.measurementProfile != null,
    );
    const actual = classified
      .map((exercise) => [
        exercise.name,
        exercise.measurementProfile,
        exercise.loadConvention,
        exercise.repBasis,
      ] as const)
      .sort(([left], [right]) => left.localeCompare(right));
    const expected = [...COMPLETE_SUPPORTED_MEASUREMENT_IDENTITIES].sort(
      ([left], [right]) => left.localeCompare(right),
    );

    expect(classified).toHaveLength(89);
    expect(actual).toEqual(expected);
  });

  it("partitions all 150 canonical identities as 89 complete, 39 ambiguous, and 22 unsupported", () => {
    const complete = new Set(
      COMPLETE_SUPPORTED_MEASUREMENT_IDENTITIES.map(([name]) => name),
    );
    const ambiguous = new Set<string>(AMBIGUOUS_EXECUTION_IDENTITIES);
    const unsupported = new Set<string>(UNSUPPORTED_MEASUREMENT_IDENTITIES);
    const allNames = catalog.exercises.map((exercise) => exercise.name);
    const memberships = allNames.map((name) =>
      [complete, ambiguous, unsupported].filter((category) => category.has(name)).length,
    );

    expect(complete.size).toBe(89);
    expect(ambiguous.size).toBe(39);
    expect(unsupported.size).toBe(22);
    expect(allNames).toHaveLength(150);
    expect(exerciseAliases).toHaveLength(54);
    expect(memberships.filter((count) => count === 0)).toHaveLength(0);
    expect(memberships.filter((count) => count > 1)).toHaveLength(0);
  });

  it("preserves exactly the 39 approved Step 2A tuple assignments", () => {
    expect(STEP_2A_PRESERVED_MEASUREMENT_ASSIGNMENTS).toHaveLength(39);
    for (const [name, measurementProfile, loadConvention, repBasis] of
      STEP_2A_PRESERVED_MEASUREMENT_ASSIGNMENTS) {
      expect(byName.get(name), name).toMatchObject({
        measurementProfile,
        loadConvention,
        repBasis,
      });
    }
  });

  it("moves exactly the 13 disputed identities to ambiguous and seven to unsupported", () => {
    expect(STEP_2A_AMBIGUOUS_CORRECTIONS).toHaveLength(13);
    expect(STEP_2A_UNSUPPORTED_CORRECTIONS).toHaveLength(7);
    expectUnclassified(STEP_2A_AMBIGUOUS_CORRECTIONS);
    expectUnclassified(STEP_2A_UNSUPPORTED_CORRECTIONS);
    expect(AMBIGUOUS_EXECUTION_IDENTITIES).toEqual(
      expect.arrayContaining([...STEP_2A_AMBIGUOUS_CORRECTIONS]),
    );
    expect(UNSUPPORTED_MEASUREMENT_IDENTITIES).toEqual(
      expect.arrayContaining([...STEP_2A_UNSUPPORTED_CORRECTIONS]),
    );
  });

  it("keeps Dumbbell Row and Incline Dumbbell Curl ambiguous instead of forcing implement-total semantics", () => {
    expectUnclassified(["Dumbbell Row", "Incline Dumbbell Curl"]);
    expect(AMBIGUOUS_EXECUTION_IDENTITIES).toEqual(
      expect.arrayContaining(["Dumbbell Row", "Incline Dumbbell Curl"]),
    );
  });

  it("keeps Torso Rotation Machine and Wood Chop ambiguous across side and cable-display conventions", () => {
    expectUnclassified(["Torso Rotation Machine", "Wood Chop"]);
    expect(AMBIGUOUS_EXECUTION_IDENTITIES).toEqual(
      expect.arrayContaining(["Torso Rotation Machine", "Wood Chop"]),
    );
  });

  it("keeps Reverse Curl and Trap Bar Deadlift as reviewed barbell-total tuples", () => {
    expect(byName.get("Reverse Curl")).toMatchObject({
      measurementProfile: "REPS_EXTERNAL_LOAD",
      loadConvention: "BARBELL_TOTAL",
      repBasis: "TOTAL",
    });
    expect(byName.get("Trap Bar Deadlift")).toMatchObject({
      measurementProfile: "REPS_EXTERNAL_LOAD",
      loadConvention: "BARBELL_TOTAL",
      repBasis: "TOTAL",
    });
  });

  it("keeps Chest-Supported T-Bar Row unsupported when loading configuration is not inferable", () => {
    expectUnclassified(["Chest-Supported T-Bar Row"]);
    expect(UNSUPPORTED_MEASUREMENT_IDENTITIES).toContain(
      "Chest-Supported T-Bar Row",
    );
  });

  it("keeps Bayesian Curl ambiguous when the identity cannot freeze load semantics", () => {
    expectUnclassified(["Bayesian Curl"]);
    expect(AMBIGUOUS_EXECUTION_IDENTITIES).toContain("Bayesian Curl");
  });

  it("keeps Incline Machine Press and Machine Hip Thrust ambiguous across selectorized and plate-loaded variants", () => {
    expectUnclassified(["Incline Machine Press", "Machine Hip Thrust"]);
    expect(AMBIGUOUS_EXECUTION_IDENTITIES).toEqual(
      expect.arrayContaining(["Incline Machine Press", "Machine Hip Thrust"]),
    );
  });

  it("keeps iso-lateral machines and Reverse Hyperextension unsupported instead of assigning generic machine-display semantics", () => {
    expectUnclassified(STEP_2A_UNSUPPORTED_CORRECTIONS.filter((name) =>
      name.startsWith("Iso-Lateral") || name === "Reverse Hyperextension",
    ));
  });

  it("keeps ambiguous legacy identities unclassified", () => {
    expectUnclassified([
      "Romanian Deadlift",
      "Stiff-Legged Deadlift",
      "Reverse Lunge",
      "Walking Lunge",
      "Standing Calf Raise",
      "Seated Calf Raise",
      "Hack Squat",
      "T-Bar Row",
    ]);
  });

  it("keeps exact RDL identities and aliases distinct from the legacy generic identity", () => {
    expect(byName.get("Romanian Deadlift")?.measurementProfile).toBeUndefined();
    expect(byName.get("Barbell Romanian Deadlift")).toMatchObject({
      measurementProfile: "REPS_EXTERNAL_LOAD",
      loadConvention: "BARBELL_TOTAL",
      repBasis: "TOTAL",
      equipment: ["Barbell"],
    });
    expect(byName.get("Dumbbell Romanian Deadlift")).toMatchObject({
      measurementProfile: "REPS_EXTERNAL_LOAD",
      loadConvention: "IMPLEMENT_WEIGHT",
      repBasis: "TOTAL",
      equipment: ["Dumbbell"],
    });

    const rdlAliases = exerciseAliases.filter((entry) =>
      entry.alias.toLowerCase().includes("romanian deadlift"),
    );
    expect(rdlAliases).toEqual([
      { exerciseName: "Barbell Romanian Deadlift", alias: "Romanian Deadlift (BB)" },
      { exerciseName: "Barbell Romanian Deadlift", alias: "Romanian Deadlift (Barbell)" },
      { exerciseName: "Dumbbell Romanian Deadlift", alias: "DB Romanian Deadlift" },
    ]);
  });

  it("keeps the selected four-day authoring fixture measurement-eligible", () => {
    const selectedIdentities = [
      "Barbell Bench Press",
      "Pull-Up",
      "Machine-Assisted Pull-Up",
      "Incline Dumbbell Bench Press",
      "Chest-Supported Dumbbell Row",
      "Dumbbell Lateral Raise",
      "EZ-Bar Curl",
      "Cable Triceps Pushdown",
      "Barbell Back Squat",
      "Leg Press",
      "Barbell Romanian Deadlift",
      "Lying Leg Curl",
      "Hip Abduction Machine",
      "Cable Crunch",
      "Lat Pulldown",
      "Dumbbell Overhead Press",
      "Reverse Pec Deck",
      "Dumbbell Bench Press",
      "Cable Curl",
      "Overhead Cable Triceps Extension",
      "Goblet Squat",
      "Bulgarian Split Squat",
    ];

    for (const name of selectedIdentities) {
      expect(parseMeasurementColumns(byName.get(name) ?? {}), name).not.toBeNull();
    }
  });

  it("keeps the approved exact lunge and selectorized calf identities", () => {
    expect(byName.get("Dumbbell Reverse Lunge")).toMatchObject({
      measurementProfile: "REPS_EXTERNAL_LOAD",
      loadConvention: "IMPLEMENT_WEIGHT",
      repBasis: "PER_SIDE",
      equipment: ["Dumbbell"],
      unilateral: true,
    });
    expect(byName.get("Selectorized Standing Calf Raise")).toMatchObject({
      measurementProfile: "REPS_EXTERNAL_LOAD",
      loadConvention: "MACHINE_DISPLAYED",
      repBasis: "TOTAL",
      equipment: ["Machine"],
      unilateral: false,
    });
  });
});
