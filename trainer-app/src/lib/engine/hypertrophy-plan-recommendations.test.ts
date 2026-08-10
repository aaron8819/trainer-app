import { describe, expect, it } from "vitest";
import catalog from "../../../prisma/exercises_comprehensive.json";
import { parseMeasurementColumns } from "@/lib/exercise-measurement/semantics";
import { getMusclePolicyByDisplayName } from "./muscle-policy";
import {
  buildHypertrophyExerciseRecommendation,
  classifyHypertrophyRecommendation,
  inferHypertrophyExerciseIntent,
  isHypertrophyRecommendationCustomized,
  materializeHypertrophyExerciseRecommendation,
  parseHypertrophyPlanDraftV2,
  type AcceptedExerciseIntentV2,
  type HypertrophyAuthoringExercise,
  type HypertrophyPlanWeekV4,
} from "./hypertrophy-plan-authoring";
import type { MovementPatternV2 } from "./types";

type CatalogRow = {
  name: string;
  movementPatterns: string[];
  primaryMuscles: string[];
  secondaryMuscles: string[];
  equipment: string[];
  contraindications?: Record<string, boolean> | null;
  isCompound: boolean;
  isMainLiftEligible: boolean;
  timePerSetSec: number;
  measurementProfile?: string;
  loadConvention?: string;
  repBasis?: string;
};

const weeks: HypertrophyPlanWeekV4[] = [
  { week: 1, phase: "ACCUMULATION" },
  { week: 2, phase: "ACCUMULATION" },
  { week: 3, phase: "ACCUMULATION" },
  { week: 4, phase: "ACCUMULATION" },
  { week: 5, phase: "DELOAD" },
];

function authoringExercise(name: string): HypertrophyAuthoringExercise {
  const row = (catalog.exercises as CatalogRow[]).find(
    (candidate) => candidate.name === name,
  );
  if (!row) throw new Error(`Missing fixture exercise: ${name}`);
  const muscleIds = (names: string[]) =>
    names.flatMap((muscleName) => {
      const policy = getMusclePolicyByDisplayName(muscleName);
      return policy ? [policy.id] : [];
    });
  return {
    id: row.name,
    name: row.name,
    movementPatterns: row.movementPatterns as MovementPatternV2[],
    primaryMuscleIds: muscleIds(row.primaryMuscles),
    secondaryMuscleIds: muscleIds(row.secondaryMuscles),
    equipment: row.equipment.map((item) => item.toLowerCase()),
    contraindicationKeys: Object.entries(row.contraindications ?? {}).flatMap(
      ([key, enabled]) => (enabled ? [key] : []),
    ),
    isCompound: row.isCompound,
    isMainLiftEligible: row.isMainLiftEligible,
    measurement: parseMeasurementColumns(row),
    timePerSetSec: row.timePerSetSec,
  };
}

function intent(
  userRole: AcceptedExerciseIntentV2["userRole"],
  exercise: HypertrophyAuthoringExercise,
): AcceptedExerciseIntentV2 {
  if (userRole === "PRIMARY_LIFT" || userRole === "SECONDARY_LIFT") {
    return {
      userRole,
      target: {
        kind: "movement_pattern",
        movementPattern: exercise.movementPatterns[0]!,
      },
    };
  }
  return {
    userRole,
    target: {
      kind: exercise.isCompound ? "movement_pattern" : "muscle",
      ...(exercise.isCompound
        ? { movementPattern: exercise.movementPatterns[0]! }
        : { muscleId: exercise.primaryMuscleIds[0]! }),
    } as AcceptedExerciseIntentV2["target"],
  };
}

describe("custom-plan authoring recommendations", () => {
  it("infers intent once, materializes five weeks atomically, and permits multiple primaries", () => {
    const bench = authoringExercise("Barbell Bench Press");
    const pullUp = authoringExercise("Pull-Up");
    const first = materializeHypertrophyExerciseRecommendation({
      exercise: bench,
      weeks,
      existingIntents: [],
    });
    const second = materializeHypertrophyExerciseRecommendation({
      exercise: pullUp,
      weeks,
      existingIntents: [first.intent],
    });

    expect(first.intent.userRole).toBe("PRIMARY_LIFT");
    expect(second.intent.userRole).toBe("SECONDARY_LIFT");
    expect(first.prescriptions).toHaveLength(5);
    expect(first.recommendationBaseline).toEqual({
      version: 1,
      exerciseId: bench.id,
      intent: first.intent,
      prescriptions: first.prescriptions,
    });

    const reordered = [second, first];
    expect(reordered[0]!.intent).toEqual(second.intent);
    expect(reordered[0]!.prescriptions).toEqual(second.prescriptions);

    const promoted = { ...second.intent, userRole: "PRIMARY_LIFT" as const };
    expect(() =>
      parseHypertrophyPlanDraftV2({
        version: 2,
        settings: {
          equipmentProfile: "FULL_GYM",
          sessionDurationMinutes: 60,
        },
        weeks,
        sessions: [
          {
            slotId: "upper",
            name: "Upper",
            focus: "UPPER",
            exercises: [
              {
                placementId: "bench",
                exerciseId: bench.id,
                ...first,
              },
              {
                placementId: "pull-up",
                exerciseId: pullUp.id,
                ...second,
                intent: promoted,
                recommendationBaseline: undefined,
              },
            ],
          },
          {
            slotId: "lower",
            name: "Lower",
            focus: "LOWER",
            exercises: [],
          },
        ],
      }),
    ).not.toThrow();
  });

  it.each([
    ["Barbell Bench Press", "PRIMARY_LIFT", "PRIMARY_STRENGTH_ANCHOR", 3, 5, 8, 2, false],
    ["Chest-Supported Dumbbell Row", "PRIMARY_LIFT", "PRIMARY_COMPOUND", 3, 6, 10, 2, false],
    ["Pull-Up", "SECONDARY_LIFT", "BODYWEIGHT_OR_ASSISTED_COMPOUND", 3, 6, 10, 2, false],
    ["Machine-Assisted Pull-Up", "SECONDARY_LIFT", "BODYWEIGHT_OR_ASSISTED_COMPOUND", 3, 6, 10, 2, false],
    ["Incline Dumbbell Bench Press", "SECONDARY_LIFT", "OTHER_COMPOUND", 3, 8, 12, 2, false],
    ["Dumbbell Bench Press", "ACCESSORY", "SUPPORTING_COMPOUND", 2, 8, 12, 1, false],
    ["Dumbbell Lateral Raise", "MUSCLE_ISOLATION", "ISOLATION", 3, 10, 15, 1, false],
    ["Lying Leg Curl", "MUSCLE_ISOLATION", "ISOLATION", 2, 10, 15, 1, false],
    ["Cable Crunch", "MUSCLE_ISOLATION", "CORE", 3, 8, 15, 0, true],
    ["Hip Abduction Machine", "MUSCLE_ISOLATION", "HIP_SUPPORT", 2, 12, 20, 0, true],
  ] as const)(
    "%s/%s resolves the approved %s dose and deload",
    (name, role, expectedClass, sets, minReps, maxReps, deloadSets, omitted) => {
      const exercise = authoringExercise(name);
      const exerciseIntent = intent(role, exercise);
      const prescriptions = buildHypertrophyExerciseRecommendation({
        exercise,
        intent: exerciseIntent,
        weeks,
      });

      expect(
        classifyHypertrophyRecommendation({
          exercise,
          intent: exerciseIntent,
        }),
      ).toBe(expectedClass);
      expect(prescriptions.slice(0, 4)).toEqual(
        [
          [3, 4],
          [3, 3],
          [2, 3],
          [1, 2],
        ].map(([min, max], index) => ({
          week: index + 1,
          status: "PRESCRIBE",
          setCount: sets,
          reps: { kind: "RANGE", min: minReps, max: maxReps },
          rir: { kind: "TARGET_RANGE", min, max },
        })),
      );
      expect(prescriptions[4]).toEqual(
        omitted
          ? { week: 5, status: "OMIT" }
          : {
              week: 5,
              status: "PRESCRIBE",
              setCount: deloadSets,
              reps: { kind: "RANGE", min: minReps, max: maxReps },
              rir: { kind: "TARGET_RANGE", min: 4, max: 5 },
            },
      );
    },
  );

  it("treats baseline-free rows as manual and detects only changes from a frozen baseline", () => {
    const exercise = authoringExercise("Barbell Bench Press");
    const recommendation = materializeHypertrophyExerciseRecommendation({
      exercise,
      weeks,
      existingIntents: [],
    });

    expect(
      isHypertrophyRecommendationCustomized({
        exerciseId: exercise.id,
        intent: recommendation.intent,
        prescriptions: recommendation.prescriptions,
      }),
    ).toBe(false);
    expect(
      isHypertrophyRecommendationCustomized({
        exerciseId: exercise.id,
        ...recommendation,
      }),
    ).toBe(false);
    expect(
      isHypertrophyRecommendationCustomized({
        exerciseId: exercise.id,
        ...recommendation,
        prescriptions: recommendation.prescriptions.map((entry, index) =>
          index === 0 && entry.status === "PRESCRIBE"
            ? { ...entry, setCount: 5 }
            : entry,
        ),
      }),
    ).toBe(true);
  });

  it("infers Supporting for isolation without exposing an invalid compound role", () => {
    const lateralRaise = authoringExercise("Dumbbell Lateral Raise");
    expect(
      inferHypertrophyExerciseIntent({
        exercise: lateralRaise,
        existingIntents: [],
      }),
    ).toEqual({
      userRole: "MUSCLE_ISOLATION",
      target: { kind: "muscle", muscleId: "side_delts" },
    });
  });
});
