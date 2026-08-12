import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import catalog from "../../../prisma/exercises_comprehensive.json";
import { exerciseAliases } from "../../../prisma/exercise-aliases";
import { REVIEWED_STEP_2A_MEASUREMENT_MEMBERSHIP } from "./step-2a-measurement-membership";

const matrixPath = path.resolve(
  process.cwd(),
  "docs/architecture/catalog-facts-stage-2-taxonomy-matrix.json",
);
const matrixText = fs.readFileSync(matrixPath, "utf8");

type MatrixEntry = {
  catalogKey: string;
  displayName: string;
  taxonomy: {
    version: number;
    movementPatterns: { status: string; values: string[] };
    compoundness: { status: string; value: string };
    laterality: { status: string; value: string };
    equipment: { status: string; values: string[] };
  };
  provenance: Record<
    "movementPatterns" | "compoundness" | "laterality" | "equipment",
    { kind: string; sourceField: string; ruleIds: string[] }
  >;
  ambiguityNote: string | null;
  variantDistinctionNote: string;
  validationStatus: string;
};

type Matrix = {
  schema: string;
  version: number;
  baselineSha: string;
  identityCount: number;
  fieldCountPerIdentity: number;
  vocabulary: {
    movementPatterns: string[];
    compoundness: string[];
    laterality: string[];
    equipment: string[];
  };
  valueCounts: Record<string, Record<string, number>>;
  unresolvedCounts: Record<string, number>;
  entries: MatrixEntry[];
};

const matrix = JSON.parse(matrixText) as Matrix;
const exercises = catalog.exercises;

const expectedMovementOrder = [
  "HORIZONTAL_PUSH",
  "VERTICAL_PUSH",
  "HORIZONTAL_PULL",
  "VERTICAL_PULL",
  "SQUAT",
  "HINGE",
  "LUNGE",
  "CARRY",
  "ROTATION",
  "ANTI_ROTATION",
  "FLEXION",
  "EXTENSION",
  "ABDUCTION",
  "ADDUCTION",
  "ISOLATION",
];

const expectedEquipmentOrder = [
  "BARBELL",
  "DUMBBELL",
  "MACHINE",
  "CABLE",
  "BODYWEIGHT",
  "KETTLEBELL",
  "BAND",
  "SLED",
  "BENCH",
  "RACK",
  "EZ_BAR",
  "TRAP_BAR",
  "OTHER",
];

function codePointSort(values: string[]): string[] {
  return [...values].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

function normalizeToken(value: string): string {
  return value.trim().replace(/[ -]+/g, "_").toUpperCase();
}

function normalizeMovement(value: string): string {
  return value === "calf_raise_extended" || value === "calf_raise_flexed"
    ? "ISOLATION"
    : normalizeToken(value);
}

function orderedUnique(values: string[], order: string[]): string[] {
  return [...new Set(values)].sort(
    (left, right) => order.indexOf(left) - order.indexOf(right),
  );
}

function countValues(
  entries: MatrixEntry[],
  values: string[],
  select: (entry: MatrixEntry) => string[],
): Record<string, number> {
  return Object.fromEntries(
    values.map((value) => [
      value,
      entries.filter((entry) => select(entry).includes(value)).length,
    ]),
  );
}

describe("Catalog Facts Stage 2 taxonomy design contract", () => {
  it("keeps the matrix byte-canonical and bound to the authoritative baseline", () => {
    expect(matrixText.includes("\r")).toBe(false);
    expect(matrixText).toBe(`${JSON.stringify(matrix, null, 2)}\n`);
    expect(matrix.schema).toBe(
      "trainer-catalog-facts-stage-2-taxonomy-matrix",
    );
    expect(matrix.version).toBe(1);
    expect(matrix.baselineSha).toBe(
      "96c722d503708c3bad4d3f9c9ba259afe561de54",
    );
    expect(matrix.fieldCountPerIdentity).toBe(4);
  });

  it("covers each of the 149 canonical identities exactly once and no aliases", () => {
    const matrixKeys = matrix.entries.map((entry) => entry.catalogKey);
    const catalogKeys = exercises.map((exercise) => exercise.catalogKey);

    expect(matrix.identityCount).toBe(149);
    expect(matrixKeys).toHaveLength(149);
    expect(new Set(matrixKeys)).toHaveLength(149);
    expect(matrixKeys).toEqual(codePointSort(matrixKeys));
    expect(matrixKeys).toEqual(codePointSort(catalogKeys));
    expect(exerciseAliases).toHaveLength(54);

    const aliases = new Set(exerciseAliases.map(({ alias }) => alias));
    expect(matrixKeys.filter((key) => aliases.has(key))).toEqual([]);
  });

  it("derives every proposed value from the four approved baseline fields", () => {
    const byKey = new Map(
      matrix.entries.map((entry) => [entry.catalogKey, entry]),
    );

    for (const exercise of exercises) {
      const entry = byKey.get(exercise.catalogKey);
      expect(entry, exercise.catalogKey).toBeDefined();
      expect(entry?.displayName).toBe(exercise.name);
      expect(entry?.taxonomy).toEqual({
        version: 1,
        movementPatterns: {
          status: "KNOWN",
          values: orderedUnique(
            exercise.movementPatterns.map(normalizeMovement),
            expectedMovementOrder,
          ),
        },
        compoundness: {
          status: "KNOWN",
          value: exercise.isCompound ? "COMPOUND" : "NON_COMPOUND",
        },
        laterality: {
          status: "KNOWN",
          value: exercise.unilateral ? "UNILATERAL" : "NON_UNILATERAL",
        },
        equipment: {
          status: "KNOWN",
          values: orderedUnique(
            exercise.equipment.map(normalizeToken),
            expectedEquipmentOrder,
          ),
        },
      });
      expect(entry?.validationStatus).toBe("VALID");
      expect(entry?.variantDistinctionNote).toContain(
        "taxonomy equality does not authorize merging",
      );
      expect(entry?.provenance.compoundness).toMatchObject({
        kind: "EXISTING_CANONICAL_FIELD",
        sourceField: "isCompound",
        ruleIds: ["COMPOUNDNESS_BOOLEAN_V1"],
      });
      expect(entry?.provenance.laterality).toMatchObject({
        kind: "EXISTING_CANONICAL_FIELD",
        sourceField: "unilateral",
        ruleIds: ["LATERALITY_BOOLEAN_V1"],
      });
      expect(entry?.provenance.equipment).toMatchObject({
        kind: "EXISTING_CANONICAL_FIELD",
        sourceField: "equipment",
        ruleIds: ["EQUIPMENT_TOKEN_NORMALIZATION_V1"],
      });
    }
  });

  it("uses bounded vocabularies, valid ordered sets, and no unresolved values", () => {
    expect(matrix.vocabulary).toEqual({
      movementPatterns: expectedMovementOrder,
      compoundness: ["COMPOUND", "NON_COMPOUND"],
      laterality: ["UNILATERAL", "NON_UNILATERAL"],
      equipment: expectedEquipmentOrder,
    });
    expect(matrix.unresolvedCounts).toEqual({
      movementPatterns: 0,
      compoundness: 0,
      laterality: 0,
      equipment: 0,
      total: 0,
    });

    for (const entry of matrix.entries) {
      const patterns = entry.taxonomy.movementPatterns.values;
      const equipment = entry.taxonomy.equipment.values;
      expect(patterns.length, entry.catalogKey).toBeGreaterThan(0);
      expect(equipment.length, entry.catalogKey).toBeGreaterThan(0);
      expect(patterns).toEqual(
        orderedUnique(patterns, expectedMovementOrder),
      );
      expect(equipment).toEqual(
        orderedUnique(equipment, expectedEquipmentOrder),
      );
      if (patterns.includes("ISOLATION")) {
        expect(patterns, entry.catalogKey).toEqual(["ISOLATION"]);
        expect(entry.taxonomy.compoundness.value, entry.catalogKey).toBe(
          "NON_COMPOUND",
        );
      }
    }
  });

  it("records exact controlled-vocabulary counts", () => {
    expect(matrix.valueCounts).toEqual({
      movementPatterns: countValues(
        matrix.entries,
        expectedMovementOrder,
        (entry) => entry.taxonomy.movementPatterns.values,
      ),
      compoundness: countValues(
        matrix.entries,
        ["COMPOUND", "NON_COMPOUND"],
        (entry) => [entry.taxonomy.compoundness.value],
      ),
      laterality: countValues(
        matrix.entries,
        ["UNILATERAL", "NON_UNILATERAL"],
        (entry) => [entry.taxonomy.laterality.value],
      ),
      equipment: countValues(
        matrix.entries,
        expectedEquipmentOrder,
        (entry) => entry.taxonomy.equipment.values,
      ),
    });
  });

  it("keeps taxonomy unimplemented and preserves Stage 1 facts", () => {
    expect(
      exercises.filter((exercise) =>
        Object.prototype.hasOwnProperty.call(exercise.facts, "taxonomy"),
      ),
    ).toEqual([]);
    expect(
      exercises.filter(
        (exercise) => exercise.facts.stimulus.disposition === "COMPLETE",
      ),
    ).toHaveLength(148);
    expect(
      exercises
        .filter(
          (exercise) => exercise.facts.stimulus.disposition !== "COMPLETE",
        )
        .map((exercise) => [
          exercise.catalogKey,
          exercise.facts.stimulus.disposition,
        ]),
    ).toEqual([["machine-assisted-pull-up", "MISSING"]]);

    const measurementCounts = Object.fromEntries(
      [
        "COMPLETE_SUPPORTED",
        "AMBIGUOUS_EXECUTION_IDENTITY",
        "UNSUPPORTED_MEASUREMENT_SEMANTICS",
      ].map((category) => [
        category,
        REVIEWED_STEP_2A_MEASUREMENT_MEMBERSHIP.filter(
          ([, value]) => value === category,
        ).length,
      ]),
    );
    expect(measurementCounts).toEqual({
      COMPLETE_SUPPORTED: 88,
      AMBIGUOUS_EXECUTION_IDENTITY: 39,
      UNSUPPORTED_MEASUREMENT_SEMANTICS: 22,
    });
  });

  it("contains every adversarial pair and the complete four-day fixture", () => {
    const adversarialPairs = [
      ["barbell-bench-press", "dumbbell-bench-press"],
      ["incline-barbell-bench-press", "incline-dumbbell-bench-press"],
      ["cable-fly", "dumbbell-fly"],
      ["cable-lateral-raise", "dumbbell-lateral-raise"],
      ["machine-lateral-raise", "cable-lateral-raise"],
      ["barbell-overhead-press", "seated-barbell-overhead-press"],
      ["barbell-row", "chest-supported-dumbbell-row"],
      ["chest-supported-dumbbell-row", "chest-supported-t-bar-row"],
      ["seated-cable-row", "close-grip-seated-cable-row"],
      ["pull-up", "weighted-pull-up"],
      ["pull-up", "machine-assisted-pull-up"],
      ["weighted-pull-up", "machine-assisted-pull-up"],
      ["pull-up", "neutral-grip-pull-up"],
      ["chin-up", "pull-up"],
      ["lat-pulldown", "iso-lateral-front-lat-pulldown"],
      ["lat-pulldown", "straight-arm-pulldown"],
      ["romanian-deadlift", "barbell-romanian-deadlift"],
      ["barbell-romanian-deadlift", "dumbbell-romanian-deadlift"],
      ["walking-lunge", "dumbbell-reverse-lunge"],
      ["single-leg-hip-thrust", "barbell-hip-thrust"],
      ["standing-calf-raise", "seated-calf-raise"],
      ["dip-chest-emphasis", "dip-triceps-emphasis"],
      ["one-arm-dumbbell-row", "dumbbell-row"],
      ["machine-chest-press", "barbell-bench-press"],
    ];
    const keys = new Set(matrix.entries.map((entry) => entry.catalogKey));
    for (const [left, right] of adversarialPairs) {
      expect(left).not.toBe(right);
      expect(keys.has(left), left).toBe(true);
      expect(keys.has(right), right).toBe(true);
    }

    const fourDayFixture = [
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
    const names = new Set(matrix.entries.map((entry) => entry.displayName));
    expect(fourDayFixture.filter((name) => !names.has(name))).toEqual([]);
  });
});
