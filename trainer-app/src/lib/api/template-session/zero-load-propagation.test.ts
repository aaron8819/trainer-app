import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
import catalog from "../../../../prisma/exercises_comprehensive.json";
import { mapExercises } from "../workout-context";
import { generateWorkoutFromTemplate } from "@/lib/engine/template-session";
import type { MeasurementSemantics } from "@/lib/exercise-measurement/semantics";
import type { MappedGenerationContext } from "./types";
import { resolveRequiredSeededSlotPlan } from "./slot-plan-seed";

type CatalogExercise = (typeof catalog.exercises)[number];

function catalogExercise(name: string): CatalogExercise {
  const exercise = catalog.exercises.find((entry) => entry.name === name);
  if (!exercise) throw new Error(`Missing catalog exercise: ${name}`);
  return exercise;
}

function mapCatalogExercises(names: string[]) {
  return mapExercises(
    names.map((name) => {
      const exercise = catalogExercise(name);
      return {
        id: exercise.catalogKey,
        name: exercise.name,
        movementPatterns: exercise.movementPatterns,
        splitTags: [exercise.splitTag],
        jointStress: exercise.jointStress,
        isMainLiftEligible: exercise.isMainLiftEligible,
        isCompound: exercise.isCompound,
        fatigueCost: exercise.fatigueCost,
        stimulusBias: exercise.stimulusBias,
        contraindications: exercise.contraindications,
        timePerSetSec: exercise.timePerSetSec ?? null,
        sfrScore: exercise.sfrScore,
        lengthPositionScore: exercise.lengthPositionScore,
        difficulty: exercise.difficulty,
        isUnilateral: exercise.unilateral,
        repRangeMin: exercise.repRangeRecommendation.min,
        repRangeMax: exercise.repRangeRecommendation.max,
        measurementProfile: exercise.measurementProfile ?? null,
        loadConvention: exercise.loadConvention ?? null,
        repBasis: exercise.repBasis ?? null,
        zeroLoadMeaning: exercise.zeroLoadMeaning ?? null,
        exerciseEquipment: exercise.equipment.map((type) => ({
          equipment: { type: type.toUpperCase() },
        })),
        exerciseMuscles: [
          ...exercise.primaryMuscles.map((muscle) => ({
            role: "PRIMARY",
            muscle: { name: muscle },
          })),
          ...exercise.secondaryMuscles.map((muscle) => ({
            role: "SECONDARY",
            muscle: { name: muscle },
          })),
        ],
        aliases: [],
      };
    }) as never,
  );
}

function acceptedIntent() {
  return {
    userRole: "PRIMARY_LIFT" as const,
    target: {
      kind: "movement_pattern" as const,
      movementPattern: "squat" as const,
    },
  };
}

function acceptedSeed(
  version: 3 | 4,
  exerciseId: string,
  measurement: MeasurementSemantics,
) {
  const slots = ["lower_a", "lower_b"].map((slotId) => ({
    slotId,
    name: slotId === "lower_a" ? "Lower A" : "Lower B",
    focus: "LOWER" as const,
    exercises:
      version === 3
        ? [
            {
              exerciseId,
              role: "CORE_COMPOUND" as const,
              setCount: 3,
              intent: acceptedIntent(),
              measurement,
            },
          ]
        : [
            {
              placementId: `${slotId}-placement`,
              exerciseId,
              role: "CORE_COMPOUND" as const,
              intent: acceptedIntent(),
              measurement,
              prescriptions: [
                {
                  week: 1,
                  status: "PRESCRIBE" as const,
                  setCount: 3,
                  reps: { kind: "RANGE" as const, min: 8, max: 10 },
                  rir: { kind: "TARGET_RANGE" as const, min: 2, max: 3 },
                },
              ],
            },
          ],
  }));

  return version === 3
    ? {
        version: 3 as const,
        source: "custom_hypertrophy_plan_v1" as const,
        settings: {
          equipmentProfile: "FULL_GYM" as const,
          sessionDurationMinutes: 60 as const,
        },
        slots,
      }
    : {
        version: 4 as const,
        source: "custom_hypertrophy_plan_v2" as const,
        settings: {
          equipmentProfile: "FULL_GYM" as const,
          sessionDurationMinutes: 60 as const,
        },
        weeks: [{ week: 1, phase: "ACCUMULATION" as const }],
        slots,
      };
}

function generateFromAcceptedSeed(input: {
  version: 3 | 4;
  exerciseName: string;
  measurement: MeasurementSemantics;
}) {
  const exerciseLibrary = mapCatalogExercises([input.exerciseName]);
  const exerciseId = catalogExercise(input.exerciseName).catalogKey;
  const seed = acceptedSeed(input.version, exerciseId, input.measurement);
  const mapped = {
    activeMesocycle: {
      slotPlanSeedJson: seed,
      currentSeedRevision: { seedPayload: seed },
      slotSequenceJson: {
        version: 1,
        source: "custom_hypertrophy_plan_v2",
        sequenceMode: "ordered_flexible",
        slots: [
          { slotId: "lower_a", intent: "LOWER" },
          { slotId: "lower_b", intent: "LOWER" },
        ],
      },
    },
    mappedConstraints: { weeklySchedule: ["lower", "lower"] },
    exerciseLibrary,
    history: [],
    lifecycleWeek: 1,
  } as unknown as MappedGenerationContext;
  const resolved = resolveRequiredSeededSlotPlan({
    mapped,
    sessionIntent: "lower",
    slotId: "lower_a",
  });
  if (!resolved || "error" in resolved) {
    throw new Error(resolved?.error ?? "Seeded slot did not resolve");
  }
  const generated = generateWorkoutFromTemplate(resolved.templateExercises, {
    profile: { id: "user-1", trainingAge: "intermediate", injuries: [] },
    goals: { primary: "hypertrophy", secondary: "none" },
    history: [],
    exerciseLibrary,
    setCountOverrides: resolved.setCountOverrides,
  });
  return { seed, resolved, generated };
}

describe("ordinary measurement-aware generation zero-load capability", () => {
  it.each([
    [
      "Bulgarian Split Squat",
      {
        profile: "REPS_EXTERNAL_LOAD" as const,
        loadConvention: "IMPLEMENT_WEIGHT" as const,
        repBasis: "PER_SIDE" as const,
      },
      "BODYWEIGHT_NO_ADDED_LOAD" as const,
    ],
    [
      "Hack Squat",
      {
        profile: "REPS_EXTERNAL_LOAD" as const,
        loadConvention: "MACHINE_DISPLAYED" as const,
        repBasis: "TOTAL" as const,
      },
      "MACHINE_DEFAULT_NO_ADDED_LOAD" as const,
    ],
    [
      "Leg Extension",
      {
        profile: "REPS_EXTERNAL_LOAD" as const,
        loadConvention: "MACHINE_DISPLAYED" as const,
        repBasis: "TOTAL" as const,
      },
      null,
    ],
  ])(
    "preserves %s proposal semantics from the real catalog through V3 and V4 generation",
    (exerciseName, measurement, expectedZeroLoadMeaning) => {
      for (const version of [3, 4] as const) {
        const { seed, resolved, generated } = generateFromAcceptedSeed({
          version,
          exerciseName,
          measurement,
        });
        const proposed = generated.workout.mainLifts[0];

        expect(resolved.templateExercises[0]).toMatchObject({ measurement });
        expect(resolved.templateExercises[0]?.zeroLoadMeaning ?? null).toBe(
          expectedZeroLoadMeaning,
        );
        expect(proposed).toMatchObject({ measurement });
        expect(proposed?.zeroLoadMeaning ?? null).toBe(expectedZeroLoadMeaning);
        expect(JSON.stringify(seed)).not.toContain("zeroLoadMeaning");
      }
    },
  );

  it("rejects an incompatible catalog capability before template construction", () => {
    const exerciseLibrary = mapCatalogExercises(["Hack Squat"]);
    exerciseLibrary[0]!.zeroLoadMeaning = "BODYWEIGHT_NO_ADDED_LOAD";
    const seed = acceptedSeed(3, "hack-squat", {
      profile: "REPS_EXTERNAL_LOAD",
      loadConvention: "MACHINE_DISPLAYED",
      repBasis: "TOTAL",
    });
    const mapped = {
      activeMesocycle: {
        slotPlanSeedJson: seed,
        slotSequenceJson: {
          version: 1,
          source: "custom_hypertrophy_plan_v1",
          sequenceMode: "ordered_flexible",
          slots: [
            { slotId: "lower_a", intent: "LOWER" },
            { slotId: "lower_b", intent: "LOWER" },
          ],
        },
      },
      mappedConstraints: { weeklySchedule: ["lower", "lower"] },
      exerciseLibrary,
      history: [],
      lifecycleWeek: 1,
    } as unknown as MappedGenerationContext;

    expect(() =>
      resolveRequiredSeededSlotPlan({
        mapped,
        sessionIntent: "lower",
        slotId: "lower_a",
      }),
    ).toThrow("ZERO_LOAD_MEANING_MEASUREMENT_MISMATCH");
  });
});
