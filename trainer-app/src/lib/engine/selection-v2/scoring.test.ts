/**
 * Tests for scoring.ts - All scoring functions
 */

import { describe, it, expect } from "vitest";
import {
  scoreDeficitFill,
  scoreRotationNovelty,
  scoreSFR,
  scoreLengthened,
  scoreMovementNovelty,
  scoreSRAAlignment,
  scoreUserPreference,
} from "./scoring";
import { INDIRECT_SET_MULTIPLIER } from "../volume-constants";
import type { Muscle } from "../types";
import type { VolumeContext, VolumeContribution, RotationContext } from "./types";

describe("scoreDeficitFill", () => {
  it("should return 1.0 when filling entire deficit", () => {
    const contribution: VolumeContribution = new Map([
      ["Chest" as Muscle, { direct: 4, indirect: 0 }],
    ]);

    const volumeContext: VolumeContext = {
      weeklyTarget: new Map([["Chest" as Muscle, 12]]),
      weeklyActual: new Map([["Chest" as Muscle, 8]]),
      effectiveActual: new Map([["Chest" as Muscle, 8]]),
    };

    const score = scoreDeficitFill(contribution, volumeContext);

    // Deficit = 12 - 8 = 4
    // Contribution = 4 direct
    // Score = 4 / 4 = 1.0
    expect(score).toBe(1.0);
  });

  it("should return partial score when filling part of deficit", () => {
    const contribution: VolumeContribution = new Map([
      ["Chest" as Muscle, { direct: 2, indirect: 0 }],
    ]);

    const volumeContext: VolumeContext = {
      weeklyTarget: new Map([["Chest" as Muscle, 12]]),
      weeklyActual: new Map([["Chest" as Muscle, 8]]),
      effectiveActual: new Map([["Chest" as Muscle, 8]]),
    };

    const score = scoreDeficitFill(contribution, volumeContext);

    // Deficit = 4, Contribution = 2
    // Score = 2 / 4 = 0.5
    expect(score).toBe(0.5);
  });

  it("should use effective volume from indirect contributions", () => {
    const contribution: VolumeContribution = new Map([
      ["Front Delts" as Muscle, { direct: 0, indirect: 8 }], // From bench press
    ]);

    const volumeContext: VolumeContext = {
      weeklyTarget: new Map([["Front Delts" as Muscle, 8]]),
      weeklyActual: new Map([["Front Delts" as Muscle, 0]]),
      effectiveActual: new Map([["Front Delts" as Muscle, 0]]),
    };

    const score = scoreDeficitFill(contribution, volumeContext);

    // Deficit = 8 - 0 = 8
    // Effective contribution = 8 × 0.3 = 2.4
    // Score = 2.4 / 8 = 0.3
    expect(score).toBeCloseTo(0.3, 2);
  });

  it("should combine direct and indirect volume correctly", () => {
    const contribution: VolumeContribution = new Map([
      ["Chest" as Muscle, { direct: 4, indirect: 0 }],
      ["Front Delts" as Muscle, { direct: 0, indirect: 4 }],
      ["Triceps" as Muscle, { direct: 0, indirect: 4 }],
    ]);

    const volumeContext: VolumeContext = {
      weeklyTarget: new Map([
        ["Chest" as Muscle, 12],
        ["Front Delts" as Muscle, 8],
        ["Triceps" as Muscle, 12],
      ]),
      weeklyActual: new Map([
        ["Chest" as Muscle, 0],
        ["Front Delts" as Muscle, 0],
        ["Triceps" as Muscle, 0],
      ]),
      effectiveActual: new Map([
        ["Chest" as Muscle, 0],
        ["Front Delts" as Muscle, 0],
        ["Triceps" as Muscle, 0],
      ]),
    };

    const score = scoreDeficitFill(contribution, volumeContext);

    // Total deficit = 12 + 8 + 12 = 32
    // Filled:
    //   Chest: 4 direct = 4
    //   Front Delts: 4 × 0.3 = 1.2
    //   Triceps: 4 × 0.3 = 1.2
    // Total filled = 4 + 1.2 + 1.2 = 6.4
    // Score = 6.4 / 32 = 0.2
    expect(score).toBeCloseTo(0.2, 2);
  });

  it("should return 0 when no deficit exists", () => {
    const contribution: VolumeContribution = new Map([
      ["Chest" as Muscle, { direct: 4, indirect: 0 }],
    ]);

    const volumeContext: VolumeContext = {
      weeklyTarget: new Map([["Chest" as Muscle, 12]]),
      weeklyActual: new Map([["Chest" as Muscle, 12]]),
      effectiveActual: new Map([["Chest" as Muscle, 12]]),
    };

    const score = scoreDeficitFill(contribution, volumeContext);

    expect(score).toBe(0);
  });

  it("should cap contribution at deficit size", () => {
    const contribution: VolumeContribution = new Map([
      ["Chest" as Muscle, { direct: 10, indirect: 0 }], // Overfills
    ]);

    const volumeContext: VolumeContext = {
      weeklyTarget: new Map([["Chest" as Muscle, 12]]),
      weeklyActual: new Map([["Chest" as Muscle, 8]]),
      effectiveActual: new Map([["Chest" as Muscle, 8]]),
    };

    const score = scoreDeficitFill(contribution, volumeContext);

    // Deficit = 4, but contribution = 10
    // Capped at 4
    // Score = 4 / 4 = 1.0
    expect(score).toBe(1.0);
  });

  it("should handle multiple muscles with varying deficits", () => {
    const contribution: VolumeContribution = new Map([
      ["Chest" as Muscle, { direct: 4, indirect: 0 }], // Fills entire chest deficit
      ["Front Delts" as Muscle, { direct: 2, indirect: 0 }], // Fills half of delts deficit
    ]);

    const volumeContext: VolumeContext = {
      weeklyTarget: new Map([
        ["Chest" as Muscle, 12],
        ["Front Delts" as Muscle, 8],
      ]),
      weeklyActual: new Map([
        ["Chest" as Muscle, 8],
        ["Front Delts" as Muscle, 4],
      ]),
      effectiveActual: new Map([
        ["Chest" as Muscle, 8],
        ["Front Delts" as Muscle, 4],
      ]),
    };

    const score = scoreDeficitFill(contribution, volumeContext);

    // Chest deficit = 4, filled = 4
    // Front Delts deficit = 4, filled = 2
    // Total deficit = 8, total filled = 6
    // Score = 6 / 8 = 0.75
    expect(score).toBe(0.75);
  });
});

describe("scoreRotationNovelty", () => {
  // CRITICAL: createExercise must set BOTH id AND name
  // (RotationContext is keyed by name, not id)
  const createExercise = (id: string): any => ({ id, name: id });

  it("should return 1.0 for never-used exercises", () => {
    const rotationContext: RotationContext = new Map();
    const exercise = createExercise("exercise_id");

    const score = scoreRotationNovelty(exercise, rotationContext);

    expect(score).toBe(1.0);
  });

  it("should return ~0.33 for exercises used 1 week ago", () => {
    const exercise = createExercise("exercise_id");
    const rotationContext: RotationContext = new Map([
      [
        "exercise_id",
        {
          lastUsed: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          weeksAgo: 1,
          usageCount: 5,
          trend: "improving",
        },
      ],
    ]);

    const score = scoreRotationNovelty(exercise, rotationContext);

    // weeksAgo = 1, targetCadence = 3
    // Score = min(1.0, 1 / 3) = 0.33
    expect(score).toBeCloseTo(0.33, 2);
  });

  it("should return ~0.67 for exercises used 2 weeks ago", () => {
    const exercise = createExercise("exercise_id");
    const rotationContext: RotationContext = new Map([
      [
        "exercise_id",
        {
          lastUsed: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
          weeksAgo: 2,
          usageCount: 5,
          trend: "improving",
        },
      ],
    ]);

    const score = scoreRotationNovelty(exercise, rotationContext);

    // weeksAgo = 2, targetCadence = 3
    // Score = min(1.0, 2 / 3) = 0.67
    expect(score).toBeCloseTo(0.67, 2);
  });

  it("should cap at 1.0 for exercises used 3+ weeks ago", () => {
    const exercise = createExercise("exercise_id");
    const rotationContext: RotationContext = new Map([
      [
        "exercise_id",
        {
          lastUsed: new Date(Date.now() - 28 * 24 * 60 * 60 * 1000),
          weeksAgo: 4,
          usageCount: 5,
          trend: "improving",
        },
      ],
    ]);

    const score = scoreRotationNovelty(exercise, rotationContext);

    // weeksAgo = 4, targetCadence = 3
    // Score = min(1.0, 4 / 3) = 1.0
    expect(score).toBe(1.0);
  });
});

describe("scoreSFR", () => {
  const createExercise = (sfrScore: number | undefined): any => ({
    id: "test",
    sfrScore,
  });

  it("should return 1.0 for perfect SFR score (5/5)", () => {
    const score = scoreSFR(createExercise(5));
    expect(score).toBe(1.0);
  });

  it("should return 0.8 for SFR score of 4", () => {
    const score = scoreSFR(createExercise(4));
    expect(score).toBe(0.8);
  });

  it("should return 0.6 for SFR score of 3", () => {
    const score = scoreSFR(createExercise(3));
    expect(score).toBe(0.6);
  });

  it("should return 0.4 for SFR score of 2", () => {
    const score = scoreSFR(createExercise(2));
    expect(score).toBe(0.4);
  });

  it("should return 0.2 for SFR score of 1", () => {
    const score = scoreSFR(createExercise(1));
    expect(score).toBe(0.2);
  });

  it("should handle undefined SFR score (default to 3)", () => {
    const score = scoreSFR(createExercise(undefined));
    expect(score).toBe(0.6); // 3/5 = 0.6
  });
});

describe("scoreLengthened", () => {
  const createExercise = (lengthPositionScore: number | undefined): any => ({
    id: "test",
    lengthPositionScore,
  });

  it("should return 1.0 for perfect lengthened position score (5/5)", () => {
    const score = scoreLengthened(createExercise(5));
    expect(score).toBe(1.0);
  });

  it("should return 0.8 for lengthened score of 4", () => {
    const score = scoreLengthened(createExercise(4));
    expect(score).toBe(0.8);
  });

  it("should return 0.6 for lengthened score of 3", () => {
    const score = scoreLengthened(createExercise(3));
    expect(score).toBe(0.6);
  });

  it("should return 0.4 for lengthened score of 2", () => {
    const score = scoreLengthened(createExercise(2));
    expect(score).toBe(0.4);
  });

  it("should return 0.2 for lengthened score of 1", () => {
    const score = scoreLengthened(createExercise(1));
    expect(score).toBe(0.2);
  });

  it("should handle undefined lengthened score (default to 3)", () => {
    const score = scoreLengthened(createExercise(undefined));
    expect(score).toBe(0.6); // 3/5 = 0.6
  });
});

describe("scoreMovementNovelty", () => {
  const createExercise = (): any => ({ id: "test" });
  const createObjective = (): any => ({ constraints: {}, weights: {} });

  it("should return 0.5 (stub implementation for Week 2)", () => {
    const exercise = createExercise();
    const objective = createObjective();

    const score = scoreMovementNovelty(exercise, objective);

    // Stub implementation - will be fully implemented in Week 2
    expect(score).toBe(0.5);
  });
});

describe("scoreSRAAlignment", () => {
  const createExercise = (primaryMuscles: Muscle[]): any => ({
    id: "test",
    primaryMuscles,
  });

  it("should return average SRA readiness for primary muscles", () => {
    const exercise = createExercise(["Chest" as Muscle, "Front Delts" as Muscle]);
    const sraContext = new Map<Muscle, number>([
      ["Chest" as Muscle, 1.0], // Fully recovered
      ["Front Delts" as Muscle, 0.6], // Partially recovered
    ]);

    const score = scoreSRAAlignment(exercise, sraContext);

    // Average = (1.0 + 0.6) / 2 = 0.8
    expect(score).toBe(0.8);
  });

  it("should return 1.0 for fully recovered muscles", () => {
    const exercise = createExercise(["Chest" as Muscle, "Lats" as Muscle]);
    const sraContext = new Map<Muscle, number>([
      ["Chest" as Muscle, 1.0],
      ["Lats" as Muscle, 1.0],
    ]);

    const score = scoreSRAAlignment(exercise, sraContext);

    expect(score).toBe(1.0);
  });

  it("should return 0.5 for half-recovered muscles", () => {
    const exercise = createExercise(["Quads" as Muscle]);
    const sraContext = new Map<Muscle, number>([
      ["Quads" as Muscle, 0.5],
    ]);

    const score = scoreSRAAlignment(exercise, sraContext);

    expect(score).toBe(0.5);
  });

  it("should default to 1.0 for muscles not in SRA context", () => {
    const exercise = createExercise(["Chest" as Muscle]);
    const sraContext = new Map<Muscle, number>(); // Empty

    const score = scoreSRAAlignment(exercise, sraContext);

    expect(score).toBe(1.0); // Default: fully recovered
  });

  it("should handle mix of tracked and untracked muscles", () => {
    const exercise = createExercise(["Chest" as Muscle, "Lats" as Muscle]);
    const sraContext = new Map<Muscle, number>([
      ["Chest" as Muscle, 0.6], // Tracked
      // Lats not tracked → defaults to 1.0
    ]);

    const score = scoreSRAAlignment(exercise, sraContext);

    // Average = (0.6 + 1.0) / 2 = 0.8
    expect(score).toBe(0.8);
  });
});

describe("scoreUserPreference", () => {
  // User preference uses exercise.id, not name (unlike rotation)
  const createExercise = (id: string): any => ({ id, name: id });
  const createPreferences = (favoriteIds: Set<string>, avoidIds: Set<string>): any => ({
    favoriteExerciseIds: favoriteIds,
    avoidExerciseIds: avoidIds,
  });

  it("should return 1.0 for favorite exercises", () => {
    const exercise = createExercise("bench_press");
    const preferences = createPreferences(new Set(["bench_press"]), new Set());

    const score = scoreUserPreference(exercise, preferences);

    expect(score).toBe(1.0);
  });

  it("should return 0.0 for avoided exercises", () => {
    const exercise = createExercise("leg_extensions");
    const preferences = createPreferences(new Set(), new Set(["leg_extensions"]));

    const score = scoreUserPreference(exercise, preferences);

    expect(score).toBe(0.0);
  });

  it("should return 0.5 for neutral exercises", () => {
    const exercise = createExercise("any_exercise");
    const preferences = createPreferences(new Set(), new Set());

    const score = scoreUserPreference(exercise, preferences);

    expect(score).toBe(0.5);
  });

  it("should prioritize avoid over favorite if both set", () => {
    const exercise = createExercise("exercise_id");
    const preferences = createPreferences(new Set(["exercise_id"]), new Set(["exercise_id"]));

    const score = scoreUserPreference(exercise, preferences);

    expect(score).toBe(0.0); // Avoid wins
  });
});
