import { describe, expect, it } from "vitest";
import {
  buildExerciseStimulusSnapshot,
  getEffectiveStimulusFromSnapshot,
  parseExerciseStimulusSnapshot,
  resolveHistoricalStimulusAccounting,
} from "./snapshot";

const bench = {
  id: "bench",
  name: "Bench Press",
  primaryMuscles: ["Chest"],
  secondaryMuscles: ["Triceps", "Front Delts"],
};

describe("exercise stimulus accounting snapshot", () => {
  it("normalizes and hashes the complete per-muscle contribution vector deterministically", () => {
    const first = buildExerciseStimulusSnapshot(bench, "exact");
    const second = buildExerciseStimulusSnapshot(
      {
        ...bench,
        primaryMuscles: [...bench.primaryMuscles].reverse(),
        secondaryMuscles: [...bench.secondaryMuscles].reverse(),
      },
      "exact"
    );

    expect(first).toEqual(second);
    expect(first.contributions).toEqual([
      { muscleId: "chest", effectiveSetsPerQualifyingSet: 1 },
      { muscleId: "front_delts", effectiveSetsPerQualifyingSet: 0.3 },
      { muscleId: "triceps", effectiveSetsPerQualifyingSet: 0.45 },
    ]);
    expect(first.policyHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects duplicate muscles, invalid values, and corrupted hashes", () => {
    const snapshot = buildExerciseStimulusSnapshot(bench, "exact");

    expect(
      parseExerciseStimulusSnapshot({
        ...snapshot,
        contributions: [...snapshot.contributions, snapshot.contributions[0]],
      })
    ).toBeUndefined();
    expect(
      parseExerciseStimulusSnapshot({
        ...snapshot,
        contributions: [
          { muscleId: "chest", effectiveSetsPerQualifyingSet: Number.NaN },
        ],
      })
    ).toBeUndefined();
    expect(
      parseExerciseStimulusSnapshot({ ...snapshot, policyHash: "0".repeat(64) })
    ).toBeUndefined();
  });

  it("uses persisted accounting after current policy inputs change", () => {
    const snapshot = buildExerciseStimulusSnapshot(bench, "exact");
    const historical = resolveHistoricalStimulusAccounting({
      persistedSnapshot: snapshot,
      exercise: {
        ...bench,
        name: "Renamed Exercise",
        primaryMuscles: ["Quads"],
        secondaryMuscles: [],
        stimulusProfile: { quads: 1 },
      },
    });

    expect(historical.integrity).toBe("verified");
    expect(
      Object.fromEntries(getEffectiveStimulusFromSnapshot(historical.snapshot!, 2))
    ).toEqual({ Chest: 2, "Front Delts": 0.6, Triceps: 0.9 });
  });

  it("labels null legacy rows as derived and never falls back for corrupted stored data", () => {
    const derived = resolveHistoricalStimulusAccounting({
      persistedSnapshot: null,
      exercise: bench,
    });
    expect(derived).toMatchObject({
      provenance: "legacy_derived",
      integrity: "derived_current_policy",
    });

    const exact = buildExerciseStimulusSnapshot(bench, "exact");
    const corrupted = resolveHistoricalStimulusAccounting({
      persistedSnapshot: { ...exact, policyHash: "f".repeat(64) },
      exercise: bench,
    });
    expect(corrupted).toEqual({
      snapshot: null,
      provenance: "legacy_unknown",
      integrity: "invalid",
    });

    const wrongSource = resolveHistoricalStimulusAccounting({
      persistedSnapshot: exact,
      exercise: { ...bench, id: "different-exercise" },
    });
    expect(wrongSource.integrity).toBe("invalid");
  });
});
