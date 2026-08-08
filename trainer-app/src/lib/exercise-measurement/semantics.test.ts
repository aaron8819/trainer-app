import { describe, expect, it } from "vitest";
import catalog from "../../../prisma/exercises_comprehensive.json";
import {
  isMeasurementPilotExerciseName,
  MEASUREMENT_PILOT_EXERCISE_NAMES,
  measurementComparisonKey,
  measurementLoadLabel,
  measurementRepsLabel,
  parseMeasurementColumns,
  permitsComputedLoadComparison,
  quantizesAsPounds,
} from "./semantics";

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
    ["REPS_EXTERNAL_LOAD", "BARBELL_TOTAL", "Total barbell load (lb)"],
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

  it("classifies exactly the reviewed eight-exercise pilot", () => {
    const classified = catalog.exercises.filter(
      (exercise) => exercise.measurementProfile != null,
    );
    expect(
      classified.map((exercise) => [
        exercise.name,
        exercise.measurementProfile,
        exercise.loadConvention,
        exercise.repBasis,
      ]),
    ).toEqual([
      ["Barbell Back Squat", "REPS_EXTERNAL_LOAD", "BARBELL_TOTAL", "TOTAL"],
      ["Goblet Squat", "REPS_EXTERNAL_LOAD", "IMPLEMENT_WEIGHT", "TOTAL"],
      ["Dumbbell Bench Press", "REPS_EXTERNAL_LOAD", "IMPLEMENT_WEIGHT", "TOTAL"],
      ["Pull-Up", "REPS_BODYWEIGHT", null, "TOTAL"],
      ["Weighted Pull-Up", "REPS_BODYWEIGHT_PLUS_LOAD", "ADDED_EXTERNAL_LOAD", "TOTAL"],
      ["Machine-Assisted Pull-Up", "REPS_ASSISTED", "DISPLAYED_ASSISTANCE", "TOTAL"],
      ["Seated Cable Row", "REPS_EXTERNAL_LOAD", "MACHINE_DISPLAYED", "TOTAL"],
      ["Alternating Dumbbell Curl", "REPS_EXTERNAL_LOAD", "IMPLEMENT_WEIGHT", "PER_SIDE"],
    ]);
    expect(classified.map((exercise) => exercise.name).sort()).toEqual(
      [...MEASUREMENT_PILOT_EXERCISE_NAMES].sort(),
    );
    expect(isMeasurementPilotExerciseName("Pull-Up")).toBe(true);
    expect(isMeasurementPilotExerciseName("Lat Pulldown")).toBe(false);
  });
});
