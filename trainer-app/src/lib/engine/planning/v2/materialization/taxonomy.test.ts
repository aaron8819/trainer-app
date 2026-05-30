import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
  matchV2ExerciseClasses,
  resolveV2ExerciseClassIds,
} from "./taxonomy";
import type { V2MaterializationExercise } from "./types";

function exercise(
  input: Partial<V2MaterializationExercise> & {
    exerciseId: string;
    name: string;
    primaryMuscles: string[];
  },
): V2MaterializationExercise {
  return {
    aliases: [],
    movementPatterns: [],
    secondaryMuscles: [],
    equipment: [],
    isCompound: false,
    isMainLiftEligible: false,
    fatigueCost: 1,
    stimulusByMusclePerSet: {},
    ...input,
  };
}

function classIds(input: V2MaterializationExercise): string[] {
  return matchV2ExerciseClasses(input).map((match) => match.classId);
}

describe("V2 exercise class taxonomy", () => {
  it("matches one positive fixture per supported class", () => {
    const fixtures: Array<[string, V2MaterializationExercise]> = [
      [
        "knee_flexion_curl",
        exercise({
          exerciseId: "leg-curl",
          name: "Seated Leg Curl",
          primaryMuscles: ["Hamstrings"],
          movementPatterns: ["flexion", "isolation"],
        }),
      ],
      [
        "distinct_chest_press_or_fly",
        exercise({
          exerciseId: "machine-press",
          name: "Machine Chest Press",
          primaryMuscles: ["Chest"],
          movementPatterns: ["press"],
          isCompound: true,
        }),
      ],
      [
        "vertical_press",
        exercise({
          exerciseId: "shoulder-press",
          name: "Machine Shoulder Press",
          aliases: ["OHP"],
          primaryMuscles: ["Front Delts", "Side Delts"],
          movementPatterns: ["vertical_press"],
          isCompound: true,
        }),
      ],
      [
        "low_axial_hip_extension_anchor",
        exercise({
          exerciseId: "hip-thrust",
          name: "Barbell Hip Thrust",
          primaryMuscles: ["Glutes", "Hamstrings"],
          stimulusByMusclePerSet: { "Lower Back": 0.25 },
          isCompound: true,
        }),
      ],
      [
        "calf_isolation",
        exercise({
          exerciseId: "calf-raise",
          name: "Standing Calf Raise",
          primaryMuscles: ["Calves"],
          movementPatterns: ["isolation"],
        }),
      ],
      [
        "lateral_raise",
        exercise({
          exerciseId: "lateral-raise",
          name: "Cable Lateral Raise",
          primaryMuscles: ["Side Delts"],
          movementPatterns: ["isolation"],
        }),
      ],
      [
        "rear_delt_isolation",
        exercise({
          exerciseId: "rear-delt-fly",
          name: "Rear Delt Reverse Fly",
          primaryMuscles: ["Rear Delts"],
          movementPatterns: ["isolation"],
        }),
      ],
      [
        "triceps_isolation",
        exercise({
          exerciseId: "pressdown",
          name: "Rope Pressdown",
          primaryMuscles: ["Triceps"],
        }),
      ],
      [
        "biceps_isolation",
        exercise({
          exerciseId: "curl",
          name: "Incline Dumbbell Curl",
          primaryMuscles: ["Biceps"],
        }),
      ],
      [
        "horizontal_pull_support",
        exercise({
          exerciseId: "supported-row",
          name: "Chest Supported Row",
          primaryMuscles: ["Upper Back", "Lats"],
          movementPatterns: ["row"],
          isCompound: true,
        }),
      ],
      [
        "vertical_pull",
        exercise({
          exerciseId: "pulldown",
          name: "Neutral Grip Pulldown",
          primaryMuscles: ["Lats"],
          movementPatterns: ["vertical_pull"],
          isCompound: true,
        }),
      ],
      [
        "hinge_compound",
        exercise({
          exerciseId: "rdl",
          name: "Romanian Deadlift",
          primaryMuscles: ["Hamstrings", "Glutes"],
          movementPatterns: ["hinge"],
          isCompound: true,
          isMainLiftEligible: true,
        }),
      ],
      [
        "quad_isolation",
        exercise({
          exerciseId: "leg-extension",
          name: "Leg Extension",
          primaryMuscles: ["Quads"],
          movementPatterns: ["isolation"],
        }),
      ],
      [
        "squat_pattern",
        exercise({
          exerciseId: "leg-press",
          name: "Leg Press",
          primaryMuscles: ["Quads"],
          movementPatterns: ["leg_press"],
          isCompound: true,
        }),
      ],
    ];

    for (const [classId, fixture] of fixtures) {
      expect(classIds(fixture)).toContain(classId);
    }
  });

  it("keeps explicit negative fixtures out of direct classes", () => {
    expect(
      classIds(
        exercise({
          exerciseId: "back-extension",
          name: "Back Extension",
          primaryMuscles: ["Hamstrings", "Lower Back"],
          movementPatterns: ["hinge"],
          isCompound: true,
        }),
      ),
    ).not.toContain("knee_flexion_curl");
    expect(
      classIds(
        exercise({
          exerciseId: "glute-bridge",
          name: "Glute Bridge",
          primaryMuscles: ["Glutes", "Hamstrings"],
          stimulusByMusclePerSet: { "Lower Back": 0.1 },
          isCompound: true,
        }),
      ),
    ).not.toContain("hinge_compound");
    expect(
      classIds(
        exercise({
          exerciseId: "bench-press",
          name: "Bench Press",
          primaryMuscles: ["Chest"],
          secondaryMuscles: ["Triceps"],
          movementPatterns: ["press"],
          isCompound: true,
        }),
      ),
    ).not.toContain("triceps_isolation");
    expect(
      classIds(
        exercise({
          exerciseId: "chin-up",
          name: "Chin Up",
          primaryMuscles: ["Biceps", "Lats"],
          movementPatterns: ["vertical_pull"],
          isCompound: true,
        }),
      ),
    ).not.toContain("biceps_isolation");
    expect(
      classIds(
        exercise({
          exerciseId: "cable-pullover",
          name: "Cable Pullover",
          primaryMuscles: ["Lats"],
          movementPatterns: ["vertical_pull"],
        }),
      ),
    ).not.toContain("vertical_pull");
    expect(
      classIds(
        exercise({
          exerciseId: "t-bar-row",
          name: "Chest-Supported T-Bar Row",
          primaryMuscles: ["Upper Back", "Lats"],
          movementPatterns: ["row"],
          isCompound: true,
        }),
      ),
    ).not.toContain("vertical_pull");
    expect(
      classIds(
        exercise({
          exerciseId: "goblet-squat",
          name: "Goblet Squat",
          primaryMuscles: ["Quads"],
          movementPatterns: ["squat"],
          isCompound: true,
        }),
      ),
    ).not.toContain("quad_isolation");
    expect(
      classIds(
        exercise({
          exerciseId: "cable-pull-through",
          name: "Cable Pull-Through",
          primaryMuscles: ["Hamstrings", "Glutes"],
          movementPatterns: ["hinge"],
          stimulusByMusclePerSet: { Hamstrings: 0.8, Glutes: 0.8, "Lower Back": 0.1 },
          isCompound: true,
        }),
      ),
    ).not.toContain("hinge_compound");
    expect(
      classIds(
        exercise({
          exerciseId: "cable-pull-through",
          name: "Cable Pull-Through",
          primaryMuscles: ["Hamstrings", "Glutes"],
          movementPatterns: ["hinge"],
          stimulusByMusclePerSet: { Hamstrings: 0.8, Glutes: 0.8, "Lower Back": 0.1 },
          isCompound: true,
        }),
      ),
    ).toContain("low_axial_hip_extension_anchor");
  });

  it("keeps true RDL and SLDL hinges eligible for hinge compound anchors", () => {
    const hingeVariants = [
      exercise({
        exerciseId: "rdl",
        name: "Romanian Deadlift",
        primaryMuscles: ["Hamstrings", "Glutes"],
        movementPatterns: ["hinge"],
        isCompound: true,
        isMainLiftEligible: true,
      }),
      exercise({
        exerciseId: "sldl",
        name: "Stiff-Legged Deadlift",
        primaryMuscles: ["Hamstrings", "Glutes"],
        movementPatterns: ["hinge"],
        isCompound: true,
        isMainLiftEligible: true,
      }),
    ];

    for (const fixture of hingeVariants) {
      expect(classIds(fixture)).toContain("hinge_compound");
    }
  });

  it("classifies newly available machine variants without crossing guarded lanes", () => {
    expect(
      classIds(
        exercise({
          exerciseId: "machine-hip-thrust",
          name: "Machine Hip Thrust",
          aliases: ["Glute Drive"],
          primaryMuscles: ["Glutes"],
          secondaryMuscles: ["Hamstrings"],
          stimulusByMusclePerSet: { Glutes: 1, Hamstrings: 0.2 },
          isCompound: true,
          equipment: ["machine"],
        }),
      ),
    ).toEqual(["low_axial_hip_extension_anchor"]);
    expect(
      classIds(
        exercise({
          exerciseId: "iso-front-pulldown",
          name: "Iso-Lateral Front Lat Pulldown",
          primaryMuscles: ["Lats"],
          movementPatterns: ["vertical_pull"],
          isCompound: true,
          equipment: ["machine"],
        }),
      ),
    ).toContain("vertical_pull");
    for (const row of [
      exercise({
        exerciseId: "iso-high-row",
        name: "Iso-Lateral High Row",
        primaryMuscles: ["Upper Back", "Lats"],
        movementPatterns: ["horizontal_pull"],
        isCompound: true,
        equipment: ["machine"],
      }),
      exercise({
        exerciseId: "iso-low-row",
        name: "Iso-Lateral Low Row",
        primaryMuscles: ["Lats", "Upper Back"],
        movementPatterns: ["horizontal_pull"],
        isCompound: true,
        equipment: ["machine"],
      }),
    ]) {
      expect(classIds(row)).toContain("horizontal_pull_support");
      expect(classIds(row)).not.toContain("vertical_pull");
    }
    for (const row of [
      exercise({
        exerciseId: "iso-incline-press",
        name: "Iso-Lateral Incline Press",
        primaryMuscles: ["Chest"],
        secondaryMuscles: ["Front Delts", "Triceps"],
        movementPatterns: ["horizontal_push"],
        isCompound: true,
        equipment: ["machine"],
      }),
      exercise({
        exerciseId: "iso-decline-press",
        name: "Iso-Lateral Decline Press",
        primaryMuscles: ["Chest"],
        secondaryMuscles: ["Triceps", "Front Delts"],
        movementPatterns: ["horizontal_push"],
        isCompound: true,
        equipment: ["machine"],
      }),
    ]) {
      expect(classIds(row)).toContain("distinct_chest_press_or_fly");
    }
  });

  it("keeps added accessories out of primary materializer lanes", () => {
    const backExtensionClasses = classIds(
      exercise({
        exerciseId: "hamstring-back-extension",
        name: "45-Degree Back Extension, Hamstring Bias",
        primaryMuscles: ["Hamstrings", "Glutes"],
        secondaryMuscles: ["Lower Back"],
        movementPatterns: ["extension"],
        stimulusByMusclePerSet: {
          Hamstrings: 0.75,
          Glutes: 0.65,
          "Lower Back": 0.35,
        },
        isCompound: true,
      }),
    );
    expect(backExtensionClasses).not.toContain("knee_flexion_curl");
    expect(backExtensionClasses).not.toContain("hinge_compound");
    expect(
      classIds(
        exercise({
          exerciseId: "machine-shrug",
          name: "Seated Machine Shrug",
          primaryMuscles: ["Upper Back"],
          movementPatterns: ["isolation"],
          equipment: ["machine"],
        }),
      ),
    ).not.toContain("horizontal_pull_support");
    expect(
      classIds(
        exercise({
          exerciseId: "seated-dip",
          name: "Seated Dip Machine",
          primaryMuscles: ["Triceps"],
          secondaryMuscles: ["Chest", "Front Delts"],
          movementPatterns: ["vertical_push"],
          isCompound: true,
          equipment: ["machine"],
        }),
      ),
    ).not.toContain("distinct_chest_press_or_fly");
    expect(
      classIds(
        exercise({
          exerciseId: "oblique-crunch",
          name: "Oblique Crunch Machine",
          primaryMuscles: ["Abs", "Core"],
          movementPatterns: ["flexion", "rotation"],
          equipment: ["machine"],
        }),
      ),
    ).toEqual([]);
  });

  it("resolves leg extension aliases to quad isolation without collapsing into squat", () => {
    expect(
      resolveV2ExerciseClassIds(DEFAULT_V2_EXERCISE_CLASS_TAXONOMY, [
        "quad_isolation",
        "leg_extension",
      ]),
    ).toEqual(["quad_isolation"]);
  });

  it("resolves vertical press aliases to the canonical class", () => {
    expect(
      resolveV2ExerciseClassIds(DEFAULT_V2_EXERCISE_CLASS_TAXONOMY, [
        "vertical_press",
        "overhead_press",
        "shoulder_press",
        "ohp",
      ]),
    ).toEqual(["vertical_press"]);
  });

  it("keeps vertical press distinct from nearby press, pull, and isolation classes", () => {
    const negativeFixtures = [
      exercise({
        exerciseId: "chest-press",
        name: "Machine Chest Press",
        primaryMuscles: ["Chest"],
        secondaryMuscles: ["Front Delts", "Triceps"],
        movementPatterns: ["press"],
        isCompound: true,
      }),
      exercise({
        exerciseId: "pressdown",
        name: "Rope Pressdown",
        primaryMuscles: ["Triceps"],
      }),
      exercise({
        exerciseId: "lateral-raise",
        name: "Cable Lateral Raise",
        primaryMuscles: ["Side Delts"],
        movementPatterns: ["isolation"],
      }),
      exercise({
        exerciseId: "pulldown",
        name: "Neutral Grip Pulldown",
        primaryMuscles: ["Lats"],
        movementPatterns: ["vertical_pull"],
        isCompound: true,
      }),
      exercise({
        exerciseId: "triceps-extension",
        name: "Overhead Triceps Extension",
        primaryMuscles: ["Triceps"],
      }),
    ];

    for (const fixture of negativeFixtures) {
      expect(classIds(fixture)).not.toContain("vertical_press");
    }
  });

  it("returns deterministic class and rank output", () => {
    const fixture = exercise({
      exerciseId: "assisted-pullup",
      name: "Assisted Pull Up",
      primaryMuscles: ["Lats"],
      movementPatterns: ["vertical_pull"],
      isCompound: true,
    });

    expect(matchV2ExerciseClasses(fixture)).toEqual(
      matchV2ExerciseClasses({ ...fixture, aliases: ["Pullup"] }),
    );
    expect(matchV2ExerciseClasses(fixture)).toEqual([
      {
        classId: "vertical_pull",
        directMuscles: ["Lats"],
        duplicateFamily: "vertical_pull:assisted pull up",
        rank: DEFAULT_V2_EXERCISE_CLASS_TAXONOMY.classOrder.indexOf("vertical_pull"),
      },
    ]);
  });

  it("keeps materialization modules free of forbidden imports", () => {
    const dir = path.join(process.cwd(), "src", "lib", "engine", "planning", "v2", "materialization");
    const forbidden =
      /from\s+["'][^"']*(api|planning-reality|audit|workout-audit|repair|seed|runtime|Prisma|selection-v2|ui|receipt)[^"']*["']/i;
    const violations = fs
      .readdirSync(dir)
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
      .flatMap((file) => {
        const text = fs.readFileSync(path.join(dir, file), "utf8");
        return text
          .split(/\r?\n/)
          .filter((line) => forbidden.test(line))
          .map((line) => `${file}: ${line.trim()}`);
      });

    expect(violations).toEqual([]);
  });
});
