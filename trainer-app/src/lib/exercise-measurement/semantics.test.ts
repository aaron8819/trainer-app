import { describe, expect, it } from "vitest";
import { exerciseAliases } from "../../../prisma/exercise-aliases";
import catalog from "../../../prisma/exercises_comprehensive.json";
import {
  measurementComparisonKey,
  measurementLoadLabel,
  measurementRepsLabel,
  parseMeasurementColumns,
  permitsComputedLoadComparison,
  quantizesAsPounds,
} from "./semantics";

const REVIEWED_MEASUREMENT_MANIFEST = [
  ["Barbell Back Squat", "REPS_EXTERNAL_LOAD", "BARBELL_TOTAL", "TOTAL"],
  ["Barbell Romanian Deadlift", "REPS_EXTERNAL_LOAD", "BARBELL_TOTAL", "TOTAL"],
  ["Goblet Squat", "REPS_EXTERNAL_LOAD", "IMPLEMENT_WEIGHT", "TOTAL"],
  ["Bulgarian Split Squat", "REPS_EXTERNAL_LOAD", "IMPLEMENT_WEIGHT", "PER_SIDE"],
  ["Selectorized Standing Calf Raise", "REPS_EXTERNAL_LOAD", "MACHINE_DISPLAYED", "TOTAL"],
  ["Cable Crunch", "REPS_EXTERNAL_LOAD", "MACHINE_DISPLAYED", "TOTAL"],
  ["Barbell Bench Press", "REPS_EXTERNAL_LOAD", "BARBELL_TOTAL", "TOTAL"],
  ["Chest-Supported Dumbbell Row", "REPS_EXTERNAL_LOAD", "IMPLEMENT_WEIGHT", "TOTAL"],
  ["Incline Dumbbell Bench Press", "REPS_EXTERNAL_LOAD", "IMPLEMENT_WEIGHT", "TOTAL"],
  ["Lat Pulldown", "REPS_EXTERNAL_LOAD", "MACHINE_DISPLAYED", "TOTAL"],
  ["Cable Rear Delt Fly", "REPS_EXTERNAL_LOAD", "MACHINE_DISPLAYED", "TOTAL"],
  ["Cable Curl", "REPS_EXTERNAL_LOAD", "MACHINE_DISPLAYED", "TOTAL"],
  ["Cable Triceps Pushdown", "REPS_EXTERNAL_LOAD", "MACHINE_DISPLAYED", "TOTAL"],
  ["Front Squat", "REPS_EXTERNAL_LOAD", "BARBELL_TOTAL", "TOTAL"],
  ["Barbell Hip Thrust", "REPS_EXTERNAL_LOAD", "BARBELL_TOTAL", "TOTAL"],
  ["Dumbbell Reverse Lunge", "REPS_EXTERNAL_LOAD", "IMPLEMENT_WEIGHT", "PER_SIDE"],
  ["Leg Extension", "REPS_EXTERNAL_LOAD", "MACHINE_DISPLAYED", "TOTAL"],
  ["Seated Leg Curl", "REPS_EXTERNAL_LOAD", "MACHINE_DISPLAYED", "TOTAL"],
  ["Hip Abduction Machine", "REPS_EXTERNAL_LOAD", "MACHINE_DISPLAYED", "TOTAL"],
  ["Hanging Knee Raise", "REPS_BODYWEIGHT", null, "TOTAL"],
  ["Pull-Up", "REPS_BODYWEIGHT", null, "TOTAL"],
  ["Dumbbell Overhead Press", "REPS_EXTERNAL_LOAD", "IMPLEMENT_WEIGHT", "TOTAL"],
  ["Seated Cable Row", "REPS_EXTERNAL_LOAD", "MACHINE_DISPLAYED", "TOTAL"],
  ["One-Arm Dumbbell Row", "REPS_EXTERNAL_LOAD", "IMPLEMENT_WEIGHT", "PER_SIDE"],
  ["Alternating Dumbbell Curl", "REPS_EXTERNAL_LOAD", "IMPLEMENT_WEIGHT", "PER_SIDE"],
  ["Hammer Curl", "REPS_EXTERNAL_LOAD", "IMPLEMENT_WEIGHT", "TOTAL"],
  ["Overhead Cable Triceps Extension", "REPS_EXTERNAL_LOAD", "MACHINE_DISPLAYED", "TOTAL"],
  ["Dumbbell Romanian Deadlift", "REPS_EXTERNAL_LOAD", "IMPLEMENT_WEIGHT", "TOTAL"],
  ["Dumbbell Bench Press", "REPS_EXTERNAL_LOAD", "IMPLEMENT_WEIGHT", "TOTAL"],
  ["Machine Chest Press", "REPS_EXTERNAL_LOAD", "MACHINE_DISPLAYED", "TOTAL"],
  ["Incline Barbell Bench Press", "REPS_EXTERNAL_LOAD", "BARBELL_TOTAL", "TOTAL"],
  ["Close-Grip Lat Pulldown", "REPS_EXTERNAL_LOAD", "MACHINE_DISPLAYED", "TOTAL"],
  ["Weighted Pull-Up", "REPS_BODYWEIGHT_PLUS_LOAD", "ADDED_EXTERNAL_LOAD", "TOTAL"],
  ["Machine-Assisted Pull-Up", "REPS_ASSISTED", "DISPLAYED_ASSISTANCE", "TOTAL"],
  ["Reverse Pec Deck", "REPS_EXTERNAL_LOAD", "MACHINE_DISPLAYED", "TOTAL"],
  ["Face Pull", "REPS_EXTERNAL_LOAD", "MACHINE_DISPLAYED", "TOTAL"],
  ["Dumbbell Rear Delt Fly", "REPS_EXTERNAL_LOAD", "IMPLEMENT_WEIGHT", "TOTAL"],
  ["Barbell Overhead Press", "REPS_EXTERNAL_LOAD", "BARBELL_TOTAL", "TOTAL"],
  ["Machine Shoulder Press", "REPS_EXTERNAL_LOAD", "MACHINE_DISPLAYED", "TOTAL"],
  ["EZ-Bar Curl", "REPS_EXTERNAL_LOAD", "BARBELL_TOTAL", "TOTAL"],
  ["Dumbbell Curl", "REPS_EXTERNAL_LOAD", "IMPLEMENT_WEIGHT", "TOTAL"],
  ["Rope Triceps Pushdown", "REPS_EXTERNAL_LOAD", "MACHINE_DISPLAYED", "TOTAL"],
  ["Lying Leg Curl", "REPS_EXTERNAL_LOAD", "MACHINE_DISPLAYED", "TOTAL"],
  ["Cable Hip Abduction", "REPS_EXTERNAL_LOAD", "MACHINE_DISPLAYED", "PER_SIDE"],
  ["Machine Crunch", "REPS_EXTERNAL_LOAD", "MACHINE_DISPLAYED", "TOTAL"],
  ["Ab Wheel Rollout", "REPS_BODYWEIGHT", null, "TOTAL"],
  ["Hanging Leg Raise", "REPS_BODYWEIGHT", null, "TOTAL"],
] as const;

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
    const newlyClassified = catalog.exercises.find(
      (exercise) => exercise.name === "Lat Pulldown",
    );
    const legacyUnclassified = catalog.exercises.find(
      (exercise) => exercise.name === "Romanian Deadlift",
    );

    expect(parseMeasurementColumns(newlyClassified ?? {})).toEqual({
      profile: "REPS_EXTERNAL_LOAD",
      loadConvention: "MACHINE_DISPLAYED",
      repBasis: "TOTAL",
    });
    expect(parseMeasurementColumns(legacyUnclassified ?? {})).toBeNull();
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

  it("classifies exactly the reviewed 47-identity manifest", () => {
    expect(REVIEWED_MEASUREMENT_MANIFEST).toHaveLength(47);
    expect(new Set(REVIEWED_MEASUREMENT_MANIFEST.map(([name]) => name)).size).toBe(47);
    expect(new Set(catalog.exercises.map((exercise) => exercise.name)).size).toBe(
      catalog.exercises.length,
    );

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
    const expected = [...REVIEWED_MEASUREMENT_MANIFEST].sort(([left], [right]) =>
      left.localeCompare(right),
    );

    expect(classified).toHaveLength(47);
    expect(actual).toEqual(expected);
  });

  it("keeps ambiguous legacy identities unclassified", () => {
    const ambiguousNames = [
      "Romanian Deadlift",
      "Stiff-Legged Deadlift",
      "Reverse Lunge",
      "Walking Lunge",
      "Standing Calf Raise",
      "Seated Calf Raise",
      "Leg Press",
      "Hack Squat",
      "T-Bar Row",
    ];

    for (const name of ambiguousNames) {
      const exercise = catalog.exercises.find((candidate) => candidate.name === name);
      expect(exercise, name).toBeDefined();
      expect(exercise?.measurementProfile, name).toBeUndefined();
      expect(exercise?.loadConvention, name).toBeUndefined();
      expect(exercise?.repBasis, name).toBeUndefined();
    }
  });

  it("keeps exact RDL identities and aliases distinct from the legacy generic identity", () => {
    const byName = new Map(catalog.exercises.map((exercise) => [exercise.name, exercise]));

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

  it("adds the approved exact lunge and selectorized calf identities", () => {
    const byName = new Map(catalog.exercises.map((exercise) => [exercise.name, exercise]));

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
