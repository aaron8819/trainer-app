import { describe, expect, it } from "vitest";
import { resolvePlacementCorrelations } from "./placement-correlation";

type Occurrence = { id: string; exerciseId: string };

function resolve(input: {
  generated: Occurrence[];
  persisted: Occurrence[];
  correlations?: unknown;
}) {
  return resolvePlacementCorrelations({
    generatedOccurrences: input.generated.map((occurrence) => ({
      occurrenceId: occurrence.id,
      exerciseId: occurrence.exerciseId,
      value: occurrence,
    })),
    persistedOccurrences: input.persisted.map((occurrence) => ({
      occurrenceId: occurrence.id,
      exerciseId: occurrence.exerciseId,
      value: occurrence,
    })),
    rawCorrelations: input.correlations,
  });
}

function resolvedIds(
  result: ReturnType<typeof resolve>,
): Array<[string | undefined, string | undefined, "explicit" | "legacy_unique"]> {
  return result.pairs.map((pair) => [
    pair.generated.occurrenceId,
    pair.persisted.occurrenceId,
    pair.source,
  ]);
}

const generatedBench = [
  { id: "A", exerciseId: "bench" },
  { id: "B", exerciseId: "bench" },
];
const persistedBench = [
  { id: "X", exerciseId: "bench" },
  { id: "Y", exerciseId: "bench" },
];

describe("resolvePlacementCorrelations", () => {
  it("resolves valid exact duplicate-exercise placements independent of persisted order", () => {
    const result = resolve({
      generated: generatedBench,
      persisted: [...persistedBench].reverse(),
      correlations: [
        { generatedPlacementId: "A", persistedWorkoutExerciseId: "X" },
        { generatedPlacementId: "B", persistedWorkoutExerciseId: "Y" },
      ],
    });

    expect(result.state).toBe("resolved");
    expect(resolvedIds(result)).toEqual([
      ["A", "X", "explicit"],
      ["B", "Y", "explicit"],
    ]);
    expect(result.pairs.every((pair) => pair.source === "explicit")).toBe(true);
  });

  it("does not canonically fall back after an explicit target fails validation", () => {
    const result = resolve({
      generated: generatedBench,
      persisted: persistedBench,
      correlations: [
        { generatedPlacementId: "A", persistedWorkoutExerciseId: "NOPE" },
        { generatedPlacementId: "B", persistedWorkoutExerciseId: "Y" },
      ],
    });

    expect(result.state).toBe("invalid_explicit_correlation");
    expect(resolvedIds(result)).toEqual([["B", "Y", "explicit"]]);
    expect(result.unresolvedGenerated.map((entry) => entry.occurrenceId)).toContain("A");
    expect(result.invalidExplicitMappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "invalid_explicit_target", generatedPlacementId: "A" }),
      ]),
    );
  });

  it("rejects many-to-one explicit targets without attaching either source", () => {
    const result = resolve({
      generated: generatedBench,
      persisted: persistedBench,
      correlations: [
        { generatedPlacementId: "A", persistedWorkoutExerciseId: "X" },
        { generatedPlacementId: "B", persistedWorkoutExerciseId: "X" },
      ],
    });

    expect(result.state).toBe("invalid_explicit_correlation");
    expect(result.pairs).toEqual([]);
    expect(result.invalidExplicitMappings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "duplicate_explicit_target" })]),
    );
  });

  it("rejects many-to-one explicit targets across distinct canonical exercises", () => {
    const result = resolve({
      generated: [
        { id: "A", exerciseId: "bench" },
        { id: "B", exerciseId: "row" },
      ],
      persisted: [
        { id: "X", exerciseId: "bench" },
        { id: "Y", exerciseId: "row" },
      ],
      correlations: [
        { generatedPlacementId: "A", persistedWorkoutExerciseId: "X" },
        { generatedPlacementId: "B", persistedWorkoutExerciseId: "X" },
      ],
    });

    expect(result.state).toBe("invalid_explicit_correlation");
    expect(result.pairs).toEqual([]);
  });

  it("rejects one source mapped to conflicting targets", () => {
    const result = resolve({
      generated: [{ id: "A", exerciseId: "bench" }],
      persisted: persistedBench,
      correlations: [
        { generatedPlacementId: "A", persistedWorkoutExerciseId: "X" },
        { generatedPlacementId: "A", persistedWorkoutExerciseId: "Y" },
      ],
    });

    expect(result.state).toBe("invalid_explicit_correlation");
    expect(result.pairs).toEqual([]);
    expect(result.invalidExplicitMappings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "duplicate_explicit_source" })]),
    );
  });

  it("deterministically rejects duplicate-identical explicit records", () => {
    const result = resolve({
      generated: [{ id: "A", exerciseId: "bench" }],
      persisted: [{ id: "X", exerciseId: "bench" }],
      correlations: [
        { generatedPlacementId: "A", persistedWorkoutExerciseId: "X" },
        { generatedPlacementId: "A", persistedWorkoutExerciseId: "X" },
      ],
    });

    expect(result.state).toBe("invalid_explicit_correlation");
    expect(result.pairs).toEqual([]);
    expect(result.invalidExplicitMappings.map((issue) => issue.code)).toEqual([
      "duplicate_explicit_source",
      "duplicate_explicit_target",
    ]);
  });

  it("reports an unknown generated source without letting it claim the target", () => {
    const result = resolve({
      generated: [{ id: "A", exerciseId: "bench" }],
      persisted: [{ id: "X", exerciseId: "bench" }],
      correlations: [
        { generatedPlacementId: "NOPE", persistedWorkoutExerciseId: "X" },
      ],
    });

    expect(result.state).toBe("invalid_explicit_correlation");
    expect(resolvedIds(result)).toEqual([["A", "X", "legacy_unique"]]);
    expect(result.invalidExplicitMappings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "unknown_generated_source" })]),
    );
  });

  it("keeps valid exact pairs in a mixed valid and malformed set while quarantining the bad source", () => {
    const result = resolve({
      generated: [
        { id: "A", exerciseId: "bench" },
        { id: "B", exerciseId: "row" },
        { id: "C", exerciseId: "curl" },
      ],
      persisted: [
        { id: "X", exerciseId: "bench" },
        { id: "Y", exerciseId: "row" },
        { id: "Z", exerciseId: "curl" },
      ],
      correlations: [
        { generatedPlacementId: "A", persistedWorkoutExerciseId: "X" },
        { generatedPlacementId: "B", persistedWorkoutExerciseId: "NOPE" },
        { generatedPlacementId: "C", persistedWorkoutExerciseId: "Z" },
      ],
    });

    expect(result.state).toBe("invalid_explicit_correlation");
    expect(resolvedIds(result)).toEqual([
      ["A", "X", "explicit"],
      ["C", "Z", "explicit"],
    ]);
    expect(result.unresolvedPersisted.map((entry) => entry.occurrenceId)).toContain("Y");
  });

  it("retains safe unique legacy fallback only when each canonical side is unique", () => {
    const unique = resolve({
      generated: [{ id: "A", exerciseId: "bench" }],
      persisted: [{ id: "X", exerciseId: "bench" }],
    });
    expect(unique.state).toBe("resolved");
    expect(resolvedIds(unique)).toEqual([["A", "X", "legacy_unique"]]);
    expect(unique.pairs[0]?.source).toBe("legacy_unique");

    const duplicate = resolve({
      generated: generatedBench,
      persisted: persistedBench,
    });
    expect(duplicate.state).toBe("ambiguous_legacy_correlation");
    expect(duplicate.pairs).toEqual([]);
    expect(duplicate.ambiguousExerciseIds).toEqual(["bench"]);
  });

  it("treats structurally malformed metadata as explicit invalid data", () => {
    const result = resolve({
      generated: [{ id: "A", exerciseId: "bench" }],
      persisted: [{ id: "X", exerciseId: "bench" }],
      correlations: [{ generatedPlacementId: "A" }],
    });

    expect(result.state).toBe("invalid_explicit_correlation");
    expect(result.pairs).toEqual([]);
    expect(result.invalidExplicitMappings[0]?.code).toBe(
      "malformed_explicit_correlation",
    );
  });

  it("blocks all legacy fallback when a malformed record has no generated source", () => {
    const result = resolve({
      generated: [{ id: "A", exerciseId: "bench" }],
      persisted: [{ id: "X", exerciseId: "bench" }],
      correlations: [{ persistedWorkoutExerciseId: "NOPE" }],
    });

    expect(result.state).toBe("invalid_explicit_correlation");
    expect(result.pairs).toEqual([]);
    expect(result.unresolvedGenerated.map((entry) => entry.occurrenceId)).toEqual(["A"]);
    expect(result.invalidExplicitMappings).toEqual([
      expect.objectContaining({
        code: "malformed_explicit_correlation",
        persistedWorkoutExerciseId: "NOPE",
      }),
    ]);
  });

  it("rejects duplicate generated occurrence IDs before resolving any pair", () => {
    const result = resolve({
      generated: [
        { id: "A", exerciseId: "bench" },
        { id: "A", exerciseId: "bench" },
      ],
      persisted: [
        { id: "X", exerciseId: "bench" },
        { id: "Y", exerciseId: "bench" },
      ],
      correlations: [{ generatedPlacementId: "A", persistedWorkoutExerciseId: "X" }],
    });

    expect(result.state).toBe("invalid_occurrence_cardinality");
    expect(result.pairs).toEqual([]);
    expect(result.invalidExplicitMappings).toEqual([
      expect.objectContaining({
        code: "duplicate_generated_occurrence_id",
        generatedPlacementId: "A",
        occurrenceIndexes: [0, 1],
      }),
    ]);
  });

  it("rejects duplicate persisted occurrence IDs before resolving any pair", () => {
    const result = resolve({
      generated: [
        { id: "A", exerciseId: "bench" },
        { id: "B", exerciseId: "bench" },
      ],
      persisted: [
        { id: "X", exerciseId: "bench" },
        { id: "X", exerciseId: "bench" },
      ],
      correlations: [{ generatedPlacementId: "A", persistedWorkoutExerciseId: "X" }],
    });

    expect(result.state).toBe("invalid_occurrence_cardinality");
    expect(result.pairs).toEqual([]);
    expect(result.invalidExplicitMappings).toEqual([
      expect.objectContaining({
        code: "duplicate_persisted_occurrence_id",
        persistedWorkoutExerciseId: "X",
        occurrenceIndexes: [0, 1],
      }),
    ]);
  });
});
