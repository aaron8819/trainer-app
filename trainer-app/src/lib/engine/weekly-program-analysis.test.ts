import { describe, expect, it } from "vitest";
import {
  analyzeWeeklyProgram,
  type WeeklyProgramAnalysis,
  type WeeklyProgramExerciseInput,
  type WeeklyProgramSessionInput,
} from "./weekly-program-analysis";
import { INDIRECT_SET_MULTIPLIER } from "./volume-constants";

function ex(
  setCount: number,
  movementPatterns: string[],
  primaryMuscles: string[],
  secondaryMuscles: string[] = []
): WeeklyProgramExerciseInput {
  return {
    setCount,
    movementPatterns,
    muscles: [
      ...primaryMuscles.map((name) => ({ name, role: "primary" as const })),
      ...secondaryMuscles.map((name) => ({ name, role: "secondary" as const })),
    ],
  };
}

function volumeSnapshot(
  result: WeeklyProgramAnalysis,
  muscles: string[]
) {
  return muscles.map((muscle) => {
    const check = result.weeklyVolumeChecks.checks.find(
      (entry) => entry.muscle === muscle
    );
    expect(check).toBeDefined();
    return {
      muscle,
      directSets: check!.directSets,
      indirectSets: check!.indirectSets,
      indirectSetMultiplier: check!.indirectSetMultiplier,
      effectiveSets: check!.effectiveSets,
      zone: check!.zone,
    };
  });
}

describe("analyzeWeeklyProgram", () => {
  it("scores a balanced weekly rotation above a push-only rotation", () => {
    const balanced: WeeklyProgramSessionInput[] = [
      {
        sessionId: "s1",
        exercises: [
          ex(4, ["horizontal_push"], ["Chest", "Triceps"], ["Front Delts"]),
          ex(4, ["horizontal_pull"], ["Lats", "Upper Back"], ["Biceps", "Rear Delts"]),
          ex(4, ["squat"], ["Quads", "Glutes"], ["Hamstrings", "Core"]),
        ],
      },
      {
        sessionId: "s2",
        exercises: [
          ex(3, ["vertical_push"], ["Front Delts", "Triceps"], ["Chest"]),
          ex(3, ["vertical_pull"], ["Lats"], ["Biceps"]),
          ex(3, ["hinge"], ["Hamstrings", "Glutes"], ["Lower Back"]),
        ],
      },
      {
        sessionId: "s3",
        exercises: [
          ex(3, ["lunge"], ["Quads", "Glutes"], ["Hamstrings"]),
          ex(3, ["carry"], ["Forearms", "Core"], ["Upper Back"]),
          ex(3, ["anti_rotation"], ["Abs"]),
        ],
      },
    ];

    const pushOnly: WeeklyProgramSessionInput[] = [
      {
        sessionId: "p1",
        exercises: [ex(4, ["horizontal_push"], ["Chest", "Triceps"], ["Front Delts"])],
      },
      {
        sessionId: "p2",
        exercises: [ex(4, ["vertical_push"], ["Front Delts", "Triceps"], ["Chest"])],
      },
      {
        sessionId: "p3",
        exercises: [ex(4, ["horizontal_push"], ["Chest"], ["Triceps"])],
      },
    ];

    const balancedResult = analyzeWeeklyProgram(balanced);
    const pushOnlyResult = analyzeWeeklyProgram(pushOnly);

    expect(balancedResult.weeklyPushPullBalance.score).toBeGreaterThan(
      pushOnlyResult.weeklyPushPullBalance.score
    );
    expect(balancedResult.weeklyMovementPatternDiversity.score).toBeGreaterThan(
      pushOnlyResult.weeklyMovementPatternDiversity.score
    );
    expect(balancedResult.overallScore).toBeGreaterThan(pushOnlyResult.overallScore);
  });

  it("reports landmark violations for low and excessive weekly volume", () => {
    const result = analyzeWeeklyProgram([
      {
        sessionId: "low-high",
        exercises: [
          ex(2, ["horizontal_push"], ["Chest"], ["Triceps"]),
          ex(30, ["horizontal_pull"], ["Biceps"], ["Forearms"]),
        ],
      },
    ]);

    const chestCheck = result.weeklyVolumeChecks.checks.find(
      (check) => check.muscle === "Chest"
    );
    const bicepsCheck = result.weeklyVolumeChecks.checks.find(
      (check) => check.muscle === "Biceps"
    );

    expect(chestCheck?.zone).toBe("below_mv");
    expect(bicepsCheck?.zone).toBe("above_mrv");
    expect(result.weeklyVolumeChecks.belowMevCritical).toContain("Chest");
    expect(result.weeklyVolumeChecks.aboveMrvCritical).toContain("Biceps");
  });

  it("uses updated biceps and hamstrings landmark boundaries", () => {
    const result = analyzeWeeklyProgram([
      {
        sessionId: "boundary-check",
        exercises: [
          ex(24, ["horizontal_pull"], ["Biceps"]),
          ex(6, ["hinge"], ["Hamstrings"]),
        ],
      },
    ]);

    const bicepsCheck = result.weeklyVolumeChecks.checks.find(
      (check) => check.muscle === "Biceps"
    );
    const hamstringsCheck = result.weeklyVolumeChecks.checks.find(
      (check) => check.muscle === "Hamstrings"
    );

    expect(bicepsCheck?.zone).toBe("mav_to_mrv");
    expect(hamstringsCheck?.zone).toBe("mev_to_mav");
  });

  it("handles empty weekly programs", () => {
    const result = analyzeWeeklyProgram([]);

    expect(result.overallScore).toBe(0);
    expect(result.weeklyMuscleCoverage.score).toBe(0);
    expect(result.suggestions.length).toBeGreaterThan(0);
  });

  it("uses calibrated indirect volume in a high pressing overlap week", () => {
    const result = analyzeWeeklyProgram([
      {
        sessionId: "press-1",
        exercises: [
          ex(5, ["horizontal_push"], ["Chest"], ["Triceps", "Front Delts"]),
          ex(4, ["vertical_push"], ["Front Delts", "Triceps"], ["Chest"]),
          ex(3, ["horizontal_push"], ["Chest", "Triceps"], ["Front Delts"]),
        ],
      },
      {
        sessionId: "press-2",
        exercises: [
          ex(4, ["horizontal_push"], ["Chest", "Triceps"], ["Front Delts"]),
          ex(3, ["vertical_push"], ["Front Delts"], ["Triceps", "Chest"]),
        ],
      },
    ]);

    expect(
      volumeSnapshot(result, ["Chest", "Triceps", "Front Delts"])
    ).toMatchInlineSnapshot(`
      [
        {
          "directSets": 12,
          "effectiveSets": 14.1,
          "indirectSetMultiplier": 0.3,
          "indirectSets": 7,
          "muscle": "Chest",
          "zone": "mev_to_mav",
        },
        {
          "directSets": 11,
          "effectiveSets": 13.4,
          "indirectSetMultiplier": 0.3,
          "indirectSets": 8,
          "muscle": "Triceps",
          "zone": "mav_to_mrv",
        },
        {
          "directSets": 7,
          "effectiveSets": 10.6,
          "indirectSetMultiplier": 0.3,
          "indirectSets": 12,
          "muscle": "Front Delts",
          "zone": "mav_to_mrv",
        },
      ]
    `);
  });

  it("uses calibrated indirect volume in a mixed push/pull week", () => {
    const result = analyzeWeeklyProgram([
      {
        sessionId: "mix-1",
        exercises: [
          ex(4, ["horizontal_push"], ["Chest", "Triceps"], ["Front Delts"]),
          ex(4, ["horizontal_pull"], ["Lats", "Upper Back"], ["Biceps", "Rear Delts"]),
        ],
      },
      {
        sessionId: "mix-2",
        exercises: [
          ex(3, ["vertical_push"], ["Front Delts", "Triceps"], ["Chest"]),
          ex(3, ["vertical_pull"], ["Lats"], ["Biceps"]),
          ex(3, ["horizontal_pull"], ["Biceps"]),
          ex(3, ["horizontal_pull"], ["Rear Delts"], ["Upper Back"]),
        ],
      },
    ]);

    expect(
      volumeSnapshot(result, ["Chest", "Lats", "Biceps", "Upper Back"])
    ).toMatchInlineSnapshot(`
      [
        {
          "directSets": 4,
          "effectiveSets": 4.9,
          "indirectSetMultiplier": 0.3,
          "indirectSets": 3,
          "muscle": "Chest",
          "zone": "below_mv",
        },
        {
          "directSets": 7,
          "effectiveSets": 7,
          "indirectSetMultiplier": 0.3,
          "indirectSets": 0,
          "muscle": "Lats",
          "zone": "mv_to_mev",
        },
        {
          "directSets": 3,
          "effectiveSets": 5.1,
          "indirectSetMultiplier": 0.3,
          "indirectSets": 7,
          "muscle": "Biceps",
          "zone": "below_mv",
        },
        {
          "directSets": 4,
          "effectiveSets": 4.9,
          "indirectSetMultiplier": 0.3,
          "indirectSets": 3,
          "muscle": "Upper Back",
          "zone": "below_mv",
        },
      ]
    `);
  });

  it("uses calibrated indirect volume in a lower-body dominant week", () => {
    const result = analyzeWeeklyProgram([
      {
        sessionId: "legs-1",
        exercises: [
          ex(5, ["squat"], ["Quads", "Glutes"], ["Hamstrings", "Core"]),
          ex(4, ["hinge"], ["Hamstrings", "Glutes"], ["Lower Back"]),
        ],
      },
      {
        sessionId: "legs-2",
        exercises: [
          ex(4, ["lunge"], ["Quads", "Glutes"], ["Hamstrings", "Adductors"]),
          ex(4, ["hinge"], ["Hamstrings"], ["Calves"]),
        ],
      },
      {
        sessionId: "legs-3",
        exercises: [
          ex(4, ["carry"], ["Calves"]),
          ex(3, ["anti_rotation"], ["Abs", "Core"]),
        ],
      },
    ]);

    expect(
      volumeSnapshot(result, ["Quads", "Hamstrings", "Glutes", "Calves"])
    ).toMatchInlineSnapshot(`
      [
        {
          "directSets": 9,
          "effectiveSets": 9,
          "indirectSetMultiplier": 0.3,
          "indirectSets": 0,
          "muscle": "Quads",
          "zone": "mev_to_mav",
        },
        {
          "directSets": 8,
          "effectiveSets": 10.7,
          "indirectSetMultiplier": 0.3,
          "indirectSets": 9,
          "muscle": "Hamstrings",
          "zone": "mev_to_mav",
        },
        {
          "directSets": 13,
          "effectiveSets": 13,
          "indirectSetMultiplier": 0.3,
          "indirectSets": 0,
          "muscle": "Glutes",
          "zone": "mav_to_mrv",
        },
        {
          "directSets": 4,
          "effectiveSets": 5.2,
          "indirectSetMultiplier": 0.3,
          "indirectSets": 4,
          "muscle": "Calves",
          "zone": "below_mv",
        },
      ]
    `);
  });

  it("uses muscle-class frequency targets for weekly coverage scoring", () => {
    const result = analyzeWeeklyProgram([
      {
        sessionId: "freq-1",
        exercises: [
          ex(4, ["horizontal_push"], ["Chest", "Triceps"]),
          ex(4, ["squat"], ["Quads"]),
        ],
      },
      {
        sessionId: "freq-2",
        exercises: [ex(4, ["vertical_push"], ["Chest", "Triceps"])],
      },
    ]);

    expect(result.weeklyMuscleCoverage.coveredCritical).toContain("Chest");
    expect(result.weeklyMuscleCoverage.coveredCritical).not.toContain("Triceps");
    expect(result.weeklyMuscleCoverage.underHitCritical).toContain("Triceps");
    expect(result.weeklyMuscleCoverage.underHitCritical).toContain("Quads");
    expect(result.weeklyMuscleCoverage.missingCritical).not.toContain("Quads");

    const tricepsTarget = result.weeklyMuscleCoverage.targetWeeklyHitsByMuscle.find(
      (entry) => entry.muscle === "Triceps"
    );
    const chestTarget = result.weeklyMuscleCoverage.targetWeeklyHitsByMuscle.find(
      (entry) => entry.muscle === "Chest"
    );
    const quadsTarget = result.weeklyMuscleCoverage.targetWeeklyHitsByMuscle.find(
      (entry) => entry.muscle === "Quads"
    );

    expect(tricepsTarget).toMatchObject({
      muscleClass: "small",
      targetHitRange: [3, 4],
      fullCreditMinHits: 3,
      partialCreditMinHits: 2,
    });
    expect(chestTarget).toMatchObject({
      muscleClass: "medium",
      targetHitRange: [2, 3],
      fullCreditMinHits: 2,
      partialCreditMinHits: 1,
    });
    expect(quadsTarget).toMatchObject({
      muscleClass: "large",
      targetHitRange: [1.5, 2],
      fullCreditMinHits: 2,
      partialCreditMinHits: 1,
    });
  });

  it("references muscle-specific weekly hit targets in suggestions", () => {
    const result = analyzeWeeklyProgram([
      {
        sessionId: "freq-suggestions",
        exercises: [ex(4, ["horizontal_push"], ["Chest"])],
      },
    ]);

    expect(result.suggestions.length).toBeGreaterThan(0);
    const frequencySuggestion = result.suggestions[0];
    expect(frequencySuggestion).toContain("x/week");
    expect(frequencySuggestion).toContain("3-4x/week");
    expect(frequencySuggestion).toContain("1.5-2x/week");
  });

  it("reports shared indirect multiplier across volume checks", () => {
    const result = analyzeWeeklyProgram([
      {
        sessionId: "shared-multiplier",
        exercises: [
          ex(4, ["horizontal_push"], ["Chest"], ["Triceps"]),
          ex(4, ["horizontal_pull"], ["Lats"], ["Biceps"]),
        ],
      },
    ]);

    expect(result.weeklyVolumeChecks.checks.length).toBeGreaterThan(0);
    for (const check of result.weeklyVolumeChecks.checks) {
      expect(check.indirectSetMultiplier).toBe(INDIRECT_SET_MULTIPLIER);
    }
  });
});
