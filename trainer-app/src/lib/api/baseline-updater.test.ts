import { describe, expect, it } from "vitest";
import {
  evaluateExerciseForBaseline,
  filterQualifyingSets,
  selectTopSet,
  shouldUpdateBaseline,
  resolveBaselineContext,
  type SetData,
} from "./baseline-updater";
import { PrimaryGoal } from "@prisma/client";

describe("evaluateExerciseForBaseline", () => {
  it("returns candidate with best qualifying set", () => {
    const sets: SetData[] = [
      { targetReps: 8, targetRpe: 8, actualReps: 8, actualLoad: 185, actualRpe: 7.5, wasSkipped: false, hasLog: true },
      { targetReps: 8, targetRpe: 8, actualReps: 8, actualLoad: 175, actualRpe: 8, wasSkipped: false, hasLog: true },
      { targetReps: 8, targetRpe: 8, actualReps: 8, actualLoad: 165, actualRpe: 8, wasSkipped: false, hasLog: true },
    ];

    const result = evaluateExerciseForBaseline(sets);
    expect(result.status).toBe("candidate");
    if (result.status === "candidate") {
      expect(result.topSetWeight).toBe(185);
      expect(result.topSetReps).toBe(8);
    }
  });

  it("skips when all sets are marked skipped", () => {
    const sets: SetData[] = [
      { targetReps: 8, wasSkipped: true, hasLog: true },
      { targetReps: 8, wasSkipped: true, hasLog: true },
    ];

    const result = evaluateExerciseForBaseline(sets);
    expect(result).toEqual({ status: "skipped", reason: "All sets marked skipped." });
  });

  it("skips when no sets have logged performance", () => {
    const sets: SetData[] = [
      { targetReps: 8, wasSkipped: false, hasLog: false },
      { targetReps: 8, wasSkipped: false, hasLog: false },
    ];

    const result = evaluateExerciseForBaseline(sets);
    expect(result).toEqual({ status: "skipped", reason: "No logged sets." });
  });

  it("skips when logs exist but missing reps or load", () => {
    const sets: SetData[] = [
      { targetReps: 8, actualReps: 8, wasSkipped: false, hasLog: true },
      { targetReps: 8, actualLoad: 175, wasSkipped: false, hasLog: true },
    ];

    const result = evaluateExerciseForBaseline(sets);
    expect(result).toEqual({ status: "skipped", reason: "Missing logged reps or load." });
  });

  it("skips when no sets meet qualifying criteria", () => {
    const sets: SetData[] = [
      { targetReps: 10, targetRpe: 8, actualReps: 7, actualLoad: 185, actualRpe: 9, wasSkipped: false, hasLog: true },
      { targetReps: 10, targetRpe: 8, actualReps: 6, actualLoad: 175, actualRpe: 9, wasSkipped: false, hasLog: true },
    ];

    const result = evaluateExerciseForBaseline(sets);
    expect(result).toEqual({ status: "skipped", reason: "Targets not met (reps or RPE)." });
  });

  it("ignores skipped sets and evaluates remaining", () => {
    const sets: SetData[] = [
      { targetReps: 8, targetRpe: 8, actualReps: 8, actualLoad: 185, actualRpe: 7, wasSkipped: false, hasLog: true },
      { targetReps: 8, wasSkipped: true, hasLog: true },
      { targetReps: 8, wasSkipped: true, hasLog: true },
    ];

    const result = evaluateExerciseForBaseline(sets);
    expect(result.status).toBe("candidate");
    if (result.status === "candidate") {
      expect(result.topSetWeight).toBe(185);
    }
  });
});

describe("filterQualifyingSets", () => {
  it("passes sets that meet rep target", () => {
    const sets: SetData[] = [
      { targetReps: 8, actualReps: 10, actualLoad: 175, wasSkipped: false, hasLog: true },
      { targetReps: 8, actualReps: 8, actualLoad: 175, wasSkipped: false, hasLog: true },
    ];
    expect(filterQualifyingSets(sets)).toHaveLength(2);
  });

  it("rejects sets below rep target", () => {
    const sets: SetData[] = [
      { targetReps: 8, actualReps: 6, actualLoad: 175, wasSkipped: false, hasLog: true },
    ];
    expect(filterQualifyingSets(sets)).toHaveLength(0);
  });

  it("rejects sets where actual RPE exceeds target RPE", () => {
    const sets: SetData[] = [
      { targetReps: 8, targetRpe: 8, actualReps: 8, actualLoad: 175, actualRpe: 9, wasSkipped: false, hasLog: true },
    ];
    expect(filterQualifyingSets(sets)).toHaveLength(0);
  });

  it("passes sets when RPE is at or below target", () => {
    const sets: SetData[] = [
      { targetReps: 8, targetRpe: 8, actualReps: 8, actualLoad: 175, actualRpe: 7.5, wasSkipped: false, hasLog: true },
      { targetReps: 8, targetRpe: 8, actualReps: 8, actualLoad: 175, actualRpe: 8, wasSkipped: false, hasLog: true },
    ];
    expect(filterQualifyingSets(sets)).toHaveLength(2);
  });

  it("passes sets when no RPE target is defined", () => {
    const sets: SetData[] = [
      { targetReps: 8, actualReps: 8, actualLoad: 175, wasSkipped: false, hasLog: true },
    ];
    expect(filterQualifyingSets(sets)).toHaveLength(1);
  });

  it("passes sets when no actual RPE is logged (RPE target present)", () => {
    const sets: SetData[] = [
      { targetReps: 8, targetRpe: 8, actualReps: 8, actualLoad: 175, wasSkipped: false, hasLog: true },
    ];
    expect(filterQualifyingSets(sets)).toHaveLength(1);
  });
});

describe("selectTopSet", () => {
  it("selects the set with the highest actual load", () => {
    const sets: SetData[] = [
      { actualLoad: 175, actualReps: 8, wasSkipped: false, hasLog: true },
      { actualLoad: 185, actualReps: 6, wasSkipped: false, hasLog: true },
      { actualLoad: 165, actualReps: 10, wasSkipped: false, hasLog: true },
    ];

    const best = selectTopSet(sets);
    expect(best.actualLoad).toBe(185);
    expect(best.actualReps).toBe(6);
  });

  it("returns first when loads are equal", () => {
    const sets: SetData[] = [
      { actualLoad: 175, actualReps: 10, wasSkipped: false, hasLog: true },
      { actualLoad: 175, actualReps: 8, wasSkipped: false, hasLog: true },
    ];

    const best = selectTopSet(sets);
    expect(best.actualReps).toBe(10);
  });
});

describe("shouldUpdateBaseline", () => {
  it("returns true when no existing baseline", () => {
    expect(shouldUpdateBaseline(185)).toBe(true);
    expect(shouldUpdateBaseline(185, null)).toBe(true);
    expect(shouldUpdateBaseline(185, undefined)).toBe(true);
  });

  it("returns true when candidate exceeds existing", () => {
    expect(shouldUpdateBaseline(190, 185)).toBe(true);
  });

  it("returns false when candidate equals existing", () => {
    expect(shouldUpdateBaseline(185, 185)).toBe(false);
  });

  it("returns false when candidate is below existing", () => {
    expect(shouldUpdateBaseline(180, 185)).toBe(false);
  });
});

describe("resolveBaselineContext", () => {
  it("returns 'strength' for STRENGTH goal", () => {
    expect(resolveBaselineContext(PrimaryGoal.STRENGTH)).toBe("strength");
  });

  it("returns 'volume' for non-STRENGTH goals", () => {
    expect(resolveBaselineContext(PrimaryGoal.HYPERTROPHY)).toBe("volume");
    expect(resolveBaselineContext(PrimaryGoal.FAT_LOSS)).toBe("volume");
    expect(resolveBaselineContext(null)).toBe("volume");
    expect(resolveBaselineContext(undefined)).toBe("volume");
  });
});
