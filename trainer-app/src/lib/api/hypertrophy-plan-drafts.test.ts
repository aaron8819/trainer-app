import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import catalog from "../../../prisma/exercises_comprehensive.json";
import {
  parseMeasurementColumns,
  type MeasurementSemantics,
} from "@/lib/exercise-measurement/semantics";
import {
  materializeHypertrophyExerciseRecommendation,
  type AcceptedHypertrophySeedV4,
  type AcceptedExerciseIntentV2,
  type ExecutableSeedProjectionV3,
  type HypertrophyPlanDraftV1,
  type HypertrophyPlanDraftV2,
  type WeeklyPrescriptionV4,
} from "@/lib/engine/hypertrophy-plan-authoring";
import { buildV4CustomPlanReferenceAcceptedSeed } from "@/lib/engine/hypertrophy-plan-authoring-v4.fixture";
import { getMusclePolicyByDisplayName } from "@/lib/engine/muscle-policy";
import { buildHypertrophyPlanHealthAssessment } from "@/lib/engine/hypertrophy-plan-health";

const originalMeasurementRollout = process.env.TRAINER_EXERCISE_MEASUREMENT_ROLLOUT;

afterEach(() => {
  if (originalMeasurementRollout === undefined) {
    delete process.env.TRAINER_EXERCISE_MEASUREMENT_ROLLOUT;
  } else {
    process.env.TRAINER_EXERCISE_MEASUREMENT_ROLLOUT = originalMeasurementRollout;
  }
});

const mocks = vi.hoisted(() => {
  const state = {
    draft: null as null | { payload: unknown; revision: number },
    mesocycles: [] as unknown[],
    revisions: [] as unknown[],
    planUpdates: [] as unknown[],
  };
  const tx = {
    macroCycle: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(async (input: unknown) => {
        state.planUpdates.push(input);
        return input;
      }),
    },
    exercise: { findMany: vi.fn() },
    injury: { findMany: vi.fn() },
    userPreference: { findUnique: vi.fn() },
    hypertrophyPlanDraft: {
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      deleteMany: vi.fn(),
    },
    mesocycle: {
      create: vi.fn(async ({ data }: { data: unknown }) => {
        state.mesocycles.push(data);
        return data;
      }),
    },
  };
  const prisma = {
    ...tx,
    user: { findUnique: vi.fn() },
    $transaction: vi.fn(
      async (callback: (client: typeof tx) => Promise<unknown>) => {
        const snapshot = structuredClone(state);
        try {
          return await callback(tx);
        } catch (error) {
          state.draft = snapshot.draft;
          state.mesocycles.splice(0, state.mesocycles.length, ...snapshot.mesocycles);
          state.revisions.splice(0, state.revisions.length, ...snapshot.revisions);
          state.planUpdates.splice(
            0,
            state.planUpdates.length,
            ...snapshot.planUpdates,
          );
          throw error;
        }
      },
    ),
  };
  const createRevision = vi.fn();
  return { state, tx, prisma, createRevision };
});

vi.mock("@/lib/db/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("./mesocycle-seed-revision", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./mesocycle-seed-revision")>()),
  createInitialAcceptedSeedRevisionInTransaction: mocks.createRevision,
}));

import {
  createCustomHypertrophyPlan,
  createEditableHypertrophyPlanCopy,
  buildHypertrophyPlanHealthConfirmationScope,
  deriveHypertrophyPlanV4Preview,
  safeDraftHealthAssessment,
  loadHypertrophyPlanEditorData,
  makeHypertrophyPlanReady,
  projectSelectedPlanHealthCatalog,
  saveHypertrophyPlanDraft,
  toAuthoringExercise,
  type HypertrophyPlanDraftExerciseRow,
} from "./hypertrophy-plan-drafts";

type CatalogRow = {
  name: string;
  movementPatterns: string[];
  primaryMuscles: string[];
  secondaryMuscles: string[];
  equipment: string[];
  contraindications?: Record<string, boolean> | null;
  isCompound: boolean;
  isMainLiftEligible: boolean;
  fatigueCost: number;
  timePerSetSec: number;
  measurementProfile?: string;
  loadConvention?: string;
  repBasis?: string;
};

function referenceExerciseRow(name: string): HypertrophyPlanDraftExerciseRow {
  const row = (catalog.exercises as CatalogRow[]).find(
    (candidate) => candidate.name === name,
  );
  if (!row) throw new Error(`Missing reference-plan exercise: ${name}`);
  const exerciseMuscles = (
    names: string[],
    role: "PRIMARY" | "SECONDARY",
  ) =>
    names.map((muscleName) => {
      const policy = getMusclePolicyByDisplayName(muscleName);
      if (!policy) throw new Error(`Missing canonical muscle: ${muscleName}`);
      return { role, muscle: { id: policy.id, name: muscleName } };
    });
  return {
    id: row.name,
    name: row.name,
    aliases: [],
    movementPatterns: row.movementPatterns,
    contraindications: row.contraindications ?? Prisma.JsonNull,
    isCompound: row.isCompound,
    isMainLiftEligible: row.isMainLiftEligible,
    fatigueCost: row.fatigueCost,
    timePerSetSec: row.timePerSetSec,
    measurementProfile: row.measurementProfile ?? null,
    loadConvention: row.loadConvention ?? null,
    repBasis: row.repBasis ?? null,
    exerciseEquipment: row.equipment.map((type) => ({ equipment: { type } })),
    exerciseMuscles: [
      ...exerciseMuscles(row.primaryMuscles, "PRIMARY"),
      ...exerciseMuscles(row.secondaryMuscles, "SECONDARY"),
    ],
  } as HypertrophyPlanDraftExerciseRow;
}

const REFERENCE_WEEKS = [
  { week: 1, phase: "ACCUMULATION" as const },
  { week: 2, phase: "ACCUMULATION" as const },
  { week: 3, phase: "ACCUMULATION" as const },
  { week: 4, phase: "ACCUMULATION" as const },
  { week: 5, phase: "DELOAD" as const },
];

const THREE_BY_FIVE_TO_EIGHT: WeeklyPrescriptionV4[] = [
  { week: 1, status: "PRESCRIBE", setCount: 3, reps: { kind: "RANGE", min: 5, max: 8 }, rir: { kind: "TARGET_RANGE", min: 3, max: 4 } },
  { week: 2, status: "PRESCRIBE", setCount: 3, reps: { kind: "RANGE", min: 5, max: 8 }, rir: { kind: "TARGET_RANGE", min: 3, max: 3 } },
  { week: 3, status: "PRESCRIBE", setCount: 3, reps: { kind: "RANGE", min: 5, max: 8 }, rir: { kind: "TARGET_RANGE", min: 2, max: 3 } },
  { week: 4, status: "PRESCRIBE", setCount: 3, reps: { kind: "RANGE", min: 5, max: 8 }, rir: { kind: "TARGET_RANGE", min: 1, max: 2 } },
  { week: 5, status: "PRESCRIBE", setCount: 2, reps: { kind: "RANGE", min: 5, max: 8 }, rir: { kind: "TARGET_RANGE", min: 4, max: 5 } },
];
const THREE_BY_SIX_TO_TEN: WeeklyPrescriptionV4[] = [
  { week: 1, status: "PRESCRIBE", setCount: 3, reps: { kind: "RANGE", min: 6, max: 10 }, rir: { kind: "TARGET_RANGE", min: 3, max: 4 } },
  { week: 2, status: "PRESCRIBE", setCount: 3, reps: { kind: "RANGE", min: 6, max: 10 }, rir: { kind: "TARGET_RANGE", min: 3, max: 3 } },
  { week: 3, status: "PRESCRIBE", setCount: 3, reps: { kind: "RANGE", min: 6, max: 10 }, rir: { kind: "TARGET_RANGE", min: 2, max: 3 } },
  { week: 4, status: "PRESCRIBE", setCount: 3, reps: { kind: "RANGE", min: 6, max: 10 }, rir: { kind: "TARGET_RANGE", min: 1, max: 2 } },
  { week: 5, status: "PRESCRIBE", setCount: 2, reps: { kind: "RANGE", min: 6, max: 10 }, rir: { kind: "TARGET_RANGE", min: 4, max: 5 } },
];
const THREE_BY_EIGHT_TO_TWELVE: WeeklyPrescriptionV4[] = [
  { week: 1, status: "PRESCRIBE", setCount: 3, reps: { kind: "RANGE", min: 8, max: 12 }, rir: { kind: "TARGET_RANGE", min: 3, max: 4 } },
  { week: 2, status: "PRESCRIBE", setCount: 3, reps: { kind: "RANGE", min: 8, max: 12 }, rir: { kind: "TARGET_RANGE", min: 3, max: 3 } },
  { week: 3, status: "PRESCRIBE", setCount: 3, reps: { kind: "RANGE", min: 8, max: 12 }, rir: { kind: "TARGET_RANGE", min: 2, max: 3 } },
  { week: 4, status: "PRESCRIBE", setCount: 3, reps: { kind: "RANGE", min: 8, max: 12 }, rir: { kind: "TARGET_RANGE", min: 1, max: 2 } },
  { week: 5, status: "PRESCRIBE", setCount: 2, reps: { kind: "RANGE", min: 8, max: 12 }, rir: { kind: "TARGET_RANGE", min: 4, max: 5 } },
];
const THREE_BY_TEN_TO_FIFTEEN: WeeklyPrescriptionV4[] = [
  { week: 1, status: "PRESCRIBE", setCount: 3, reps: { kind: "RANGE", min: 10, max: 15 }, rir: { kind: "TARGET_RANGE", min: 3, max: 4 } },
  { week: 2, status: "PRESCRIBE", setCount: 3, reps: { kind: "RANGE", min: 10, max: 15 }, rir: { kind: "TARGET_RANGE", min: 3, max: 3 } },
  { week: 3, status: "PRESCRIBE", setCount: 3, reps: { kind: "RANGE", min: 10, max: 15 }, rir: { kind: "TARGET_RANGE", min: 2, max: 3 } },
  { week: 4, status: "PRESCRIBE", setCount: 3, reps: { kind: "RANGE", min: 10, max: 15 }, rir: { kind: "TARGET_RANGE", min: 1, max: 2 } },
  { week: 5, status: "PRESCRIBE", setCount: 1, reps: { kind: "RANGE", min: 10, max: 15 }, rir: { kind: "TARGET_RANGE", min: 4, max: 5 } },
];
const TWO_BY_TEN_TO_FIFTEEN: WeeklyPrescriptionV4[] = [
  { week: 1, status: "PRESCRIBE", setCount: 2, reps: { kind: "RANGE", min: 10, max: 15 }, rir: { kind: "TARGET_RANGE", min: 3, max: 4 } },
  { week: 2, status: "PRESCRIBE", setCount: 2, reps: { kind: "RANGE", min: 10, max: 15 }, rir: { kind: "TARGET_RANGE", min: 3, max: 3 } },
  { week: 3, status: "PRESCRIBE", setCount: 2, reps: { kind: "RANGE", min: 10, max: 15 }, rir: { kind: "TARGET_RANGE", min: 2, max: 3 } },
  { week: 4, status: "PRESCRIBE", setCount: 2, reps: { kind: "RANGE", min: 10, max: 15 }, rir: { kind: "TARGET_RANGE", min: 1, max: 2 } },
  { week: 5, status: "PRESCRIBE", setCount: 1, reps: { kind: "RANGE", min: 10, max: 15 }, rir: { kind: "TARGET_RANGE", min: 4, max: 5 } },
];
const TWO_BY_TWELVE_TO_TWENTY_WITH_OMISSION: WeeklyPrescriptionV4[] = [
  { week: 1, status: "PRESCRIBE", setCount: 2, reps: { kind: "RANGE", min: 12, max: 20 }, rir: { kind: "TARGET_RANGE", min: 3, max: 4 } },
  { week: 2, status: "PRESCRIBE", setCount: 2, reps: { kind: "RANGE", min: 12, max: 20 }, rir: { kind: "TARGET_RANGE", min: 3, max: 3 } },
  { week: 3, status: "PRESCRIBE", setCount: 2, reps: { kind: "RANGE", min: 12, max: 20 }, rir: { kind: "TARGET_RANGE", min: 2, max: 3 } },
  { week: 4, status: "PRESCRIBE", setCount: 2, reps: { kind: "RANGE", min: 12, max: 20 }, rir: { kind: "TARGET_RANGE", min: 1, max: 2 } },
  { week: 5, status: "OMIT" },
];
const THREE_BY_EIGHT_TO_FIFTEEN_WITH_OMISSION: WeeklyPrescriptionV4[] = [
  { week: 1, status: "PRESCRIBE", setCount: 3, reps: { kind: "RANGE", min: 8, max: 15 }, rir: { kind: "TARGET_RANGE", min: 3, max: 4 } },
  { week: 2, status: "PRESCRIBE", setCount: 3, reps: { kind: "RANGE", min: 8, max: 15 }, rir: { kind: "TARGET_RANGE", min: 3, max: 3 } },
  { week: 3, status: "PRESCRIBE", setCount: 3, reps: { kind: "RANGE", min: 8, max: 15 }, rir: { kind: "TARGET_RANGE", min: 2, max: 3 } },
  { week: 4, status: "PRESCRIBE", setCount: 3, reps: { kind: "RANGE", min: 8, max: 15 }, rir: { kind: "TARGET_RANGE", min: 1, max: 2 } },
  { week: 5, status: "OMIT" },
];
const THREE_BY_TWELVE_TO_TWENTY: WeeklyPrescriptionV4[] = [
  { week: 1, status: "PRESCRIBE", setCount: 3, reps: { kind: "RANGE", min: 12, max: 20 }, rir: { kind: "TARGET_RANGE", min: 3, max: 4 } },
  { week: 2, status: "PRESCRIBE", setCount: 3, reps: { kind: "RANGE", min: 12, max: 20 }, rir: { kind: "TARGET_RANGE", min: 3, max: 3 } },
  { week: 3, status: "PRESCRIBE", setCount: 3, reps: { kind: "RANGE", min: 12, max: 20 }, rir: { kind: "TARGET_RANGE", min: 2, max: 3 } },
  { week: 4, status: "PRESCRIBE", setCount: 3, reps: { kind: "RANGE", min: 12, max: 20 }, rir: { kind: "TARGET_RANGE", min: 1, max: 2 } },
  { week: 5, status: "PRESCRIBE", setCount: 1, reps: { kind: "RANGE", min: 12, max: 20 }, rir: { kind: "TARGET_RANGE", min: 4, max: 5 } },
];

const BARBELL_TOTAL: MeasurementSemantics = {
  profile: "REPS_EXTERNAL_LOAD",
  loadConvention: "BARBELL_TOTAL",
  repBasis: "TOTAL",
};
const IMPLEMENT_WEIGHT_TOTAL: MeasurementSemantics = {
  profile: "REPS_EXTERNAL_LOAD",
  loadConvention: "IMPLEMENT_WEIGHT",
  repBasis: "TOTAL",
};
const IMPLEMENT_WEIGHT_PER_SIDE: MeasurementSemantics = {
  profile: "REPS_EXTERNAL_LOAD",
  loadConvention: "IMPLEMENT_WEIGHT",
  repBasis: "PER_SIDE",
};
const MACHINE_DISPLAYED: MeasurementSemantics = {
  profile: "REPS_EXTERNAL_LOAD",
  loadConvention: "MACHINE_DISPLAYED",
  repBasis: "TOTAL",
};
const BODYWEIGHT_TOTAL: MeasurementSemantics = {
  profile: "REPS_BODYWEIGHT",
  repBasis: "TOTAL",
};

type ReferenceSessionExpectation = AcceptedHypertrophySeedV4["slots"][number];

const REFERENCE_PLAN_EXPECTATIONS: ReferenceSessionExpectation[] = [
  {
    slotId: "upper-a",
    name: "Upper A",
    focus: "UPPER",
    exercises: [
      { placementId: "upper-a-1", exerciseId: "Barbell Bench Press", role: "CORE_COMPOUND", intent: { userRole: "PRIMARY_LIFT", target: { kind: "movement_pattern", movementPattern: "horizontal_push" } }, measurement: BARBELL_TOTAL, prescriptions: THREE_BY_FIVE_TO_EIGHT },
      { placementId: "upper-a-2", exerciseId: "Pull-Up", role: "ACCESSORY", intent: { userRole: "SECONDARY_LIFT", target: { kind: "movement_pattern", movementPattern: "vertical_pull" } }, measurement: BODYWEIGHT_TOTAL, prescriptions: THREE_BY_SIX_TO_TEN },
      { placementId: "upper-a-3", exerciseId: "Incline Dumbbell Bench Press", role: "ACCESSORY", intent: { userRole: "SECONDARY_LIFT", target: { kind: "movement_pattern", movementPattern: "horizontal_push" } }, measurement: IMPLEMENT_WEIGHT_TOTAL, prescriptions: THREE_BY_EIGHT_TO_TWELVE },
      { placementId: "upper-a-4", exerciseId: "Chest-Supported Dumbbell Row", role: "ACCESSORY", intent: { userRole: "SECONDARY_LIFT", target: { kind: "movement_pattern", movementPattern: "horizontal_pull" } }, measurement: IMPLEMENT_WEIGHT_TOTAL, prescriptions: THREE_BY_EIGHT_TO_TWELVE },
      { placementId: "upper-a-5", exerciseId: "Dumbbell Lateral Raise", role: "ACCESSORY", intent: { userRole: "MUSCLE_ISOLATION", target: { kind: "muscle", muscleId: "side_delts" } }, measurement: IMPLEMENT_WEIGHT_TOTAL, prescriptions: THREE_BY_TEN_TO_FIFTEEN },
      { placementId: "upper-a-6", exerciseId: "EZ-Bar Curl", role: "ACCESSORY", intent: { userRole: "MUSCLE_ISOLATION", target: { kind: "muscle", muscleId: "biceps" } }, measurement: BARBELL_TOTAL, prescriptions: THREE_BY_TEN_TO_FIFTEEN },
      { placementId: "upper-a-7", exerciseId: "Cable Triceps Pushdown", role: "ACCESSORY", intent: { userRole: "MUSCLE_ISOLATION", target: { kind: "muscle", muscleId: "triceps" } }, measurement: MACHINE_DISPLAYED, prescriptions: TWO_BY_TEN_TO_FIFTEEN },
    ],
  },
  {
    slotId: "lower-a",
    name: "Lower A",
    focus: "LOWER",
    exercises: [
      { placementId: "lower-a-1", exerciseId: "Barbell Back Squat", role: "CORE_COMPOUND", intent: { userRole: "PRIMARY_LIFT", target: { kind: "movement_pattern", movementPattern: "squat" } }, measurement: BARBELL_TOTAL, prescriptions: THREE_BY_FIVE_TO_EIGHT },
      { placementId: "lower-a-2", exerciseId: "Leg Press", role: "ACCESSORY", intent: { userRole: "SECONDARY_LIFT", target: { kind: "movement_pattern", movementPattern: "squat" } }, measurement: MACHINE_DISPLAYED, prescriptions: THREE_BY_EIGHT_TO_TWELVE },
      { placementId: "lower-a-3", exerciseId: "Barbell Romanian Deadlift", role: "ACCESSORY", intent: { userRole: "SECONDARY_LIFT", target: { kind: "movement_pattern", movementPattern: "hinge" } }, measurement: BARBELL_TOTAL, prescriptions: THREE_BY_SIX_TO_TEN },
      { placementId: "lower-a-4", exerciseId: "Lying Leg Curl", role: "ACCESSORY", intent: { userRole: "MUSCLE_ISOLATION", target: { kind: "muscle", muscleId: "hamstrings" } }, measurement: MACHINE_DISPLAYED, prescriptions: TWO_BY_TEN_TO_FIFTEEN },
      { placementId: "lower-a-5", exerciseId: "Hip Abduction Machine", role: "ACCESSORY", intent: { userRole: "MUSCLE_ISOLATION", target: { kind: "muscle", muscleId: "abductors" } }, measurement: MACHINE_DISPLAYED, prescriptions: TWO_BY_TWELVE_TO_TWENTY_WITH_OMISSION },
      { placementId: "lower-a-6", exerciseId: "Cable Crunch", role: "ACCESSORY", intent: { userRole: "MUSCLE_ISOLATION", target: { kind: "muscle", muscleId: "abs" } }, measurement: MACHINE_DISPLAYED, prescriptions: THREE_BY_EIGHT_TO_FIFTEEN_WITH_OMISSION },
    ],
  },
  {
    slotId: "upper-b",
    name: "Upper B",
    focus: "UPPER",
    exercises: [
      { placementId: "upper-b-1", exerciseId: "Chest-Supported Dumbbell Row", role: "ACCESSORY", intent: { userRole: "SECONDARY_LIFT", target: { kind: "movement_pattern", movementPattern: "horizontal_pull" } }, measurement: IMPLEMENT_WEIGHT_TOTAL, prescriptions: THREE_BY_EIGHT_TO_TWELVE },
      { placementId: "upper-b-2", exerciseId: "Lat Pulldown", role: "ACCESSORY", intent: { userRole: "SECONDARY_LIFT", target: { kind: "movement_pattern", movementPattern: "vertical_pull" } }, measurement: MACHINE_DISPLAYED, prescriptions: THREE_BY_EIGHT_TO_TWELVE },
      { placementId: "upper-b-3", exerciseId: "Dumbbell Overhead Press", role: "CORE_COMPOUND", intent: { userRole: "PRIMARY_LIFT", target: { kind: "movement_pattern", movementPattern: "vertical_push" } }, measurement: IMPLEMENT_WEIGHT_TOTAL, prescriptions: THREE_BY_SIX_TO_TEN },
      { placementId: "upper-b-4", exerciseId: "Reverse Pec Deck", role: "ACCESSORY", intent: { userRole: "MUSCLE_ISOLATION", target: { kind: "muscle", muscleId: "rear_delts" } }, measurement: MACHINE_DISPLAYED, prescriptions: THREE_BY_TWELVE_TO_TWENTY },
      { placementId: "upper-b-5", exerciseId: "Dumbbell Bench Press", role: "ACCESSORY", intent: { userRole: "SECONDARY_LIFT", target: { kind: "movement_pattern", movementPattern: "horizontal_push" } }, measurement: IMPLEMENT_WEIGHT_TOTAL, prescriptions: THREE_BY_EIGHT_TO_TWELVE },
      { placementId: "upper-b-6", exerciseId: "Cable Curl", role: "ACCESSORY", intent: { userRole: "MUSCLE_ISOLATION", target: { kind: "muscle", muscleId: "biceps" } }, measurement: MACHINE_DISPLAYED, prescriptions: THREE_BY_TEN_TO_FIFTEEN },
      { placementId: "upper-b-7", exerciseId: "Overhead Cable Triceps Extension", role: "ACCESSORY", intent: { userRole: "MUSCLE_ISOLATION", target: { kind: "muscle", muscleId: "triceps" } }, measurement: MACHINE_DISPLAYED, prescriptions: TWO_BY_TEN_TO_FIFTEEN },
    ],
  },
  {
    slotId: "lower-b",
    name: "Lower B",
    focus: "LOWER",
    exercises: [
      { placementId: "lower-b-1", exerciseId: "Dumbbell Romanian Deadlift", role: "CORE_COMPOUND", intent: { userRole: "PRIMARY_LIFT", target: { kind: "movement_pattern", movementPattern: "hinge" } }, measurement: IMPLEMENT_WEIGHT_TOTAL, prescriptions: THREE_BY_SIX_TO_TEN },
      { placementId: "lower-b-2", exerciseId: "Goblet Squat", role: "ACCESSORY", intent: { userRole: "SECONDARY_LIFT", target: { kind: "movement_pattern", movementPattern: "squat" } }, measurement: IMPLEMENT_WEIGHT_TOTAL, prescriptions: THREE_BY_EIGHT_TO_TWELVE },
      { placementId: "lower-b-3", exerciseId: "Bulgarian Split Squat", role: "ACCESSORY", intent: { userRole: "SECONDARY_LIFT", target: { kind: "movement_pattern", movementPattern: "lunge" } }, measurement: IMPLEMENT_WEIGHT_PER_SIDE, prescriptions: THREE_BY_EIGHT_TO_TWELVE },
      { placementId: "lower-b-4", exerciseId: "Seated Leg Curl", role: "ACCESSORY", intent: { userRole: "MUSCLE_ISOLATION", target: { kind: "muscle", muscleId: "hamstrings" } }, measurement: MACHINE_DISPLAYED, prescriptions: TWO_BY_TEN_TO_FIFTEEN },
      { placementId: "lower-b-5", exerciseId: "Machine Crunch", role: "ACCESSORY", intent: { userRole: "MUSCLE_ISOLATION", target: { kind: "muscle", muscleId: "abs" } }, measurement: MACHINE_DISPLAYED, prescriptions: THREE_BY_EIGHT_TO_FIFTEEN_WITH_OMISSION },
    ],
  },
];

function expectedAcceptedReferencePlan(): AcceptedHypertrophySeedV4 {
  return buildV4CustomPlanReferenceAcceptedSeed();
}

function expectedExecutableReferencePlan(): ExecutableSeedProjectionV3 {
  const accepted = expectedAcceptedReferencePlan();
  return structuredClone({
    version: 3,
    weeks: accepted.weeks,
    // Executable V3 intentionally drops authoring-only session name and focus.
    slots: accepted.slots.map(({ slotId, exercises }) => ({
      slotId,
      exercises,
    })),
  });
}

function assertReferenceProjections(input: {
  accepted: AcceptedHypertrophySeedV4;
  executable: ExecutableSeedProjectionV3;
}) {
  expect(input.accepted).toEqual(expectedAcceptedReferencePlan());
  expect(input.executable).toEqual(expectedExecutableReferencePlan());
  expect(JSON.stringify(input.accepted)).not.toContain("recommendationBaseline");
  expect(JSON.stringify(input.executable)).not.toContain("recommendationBaseline");
}

function draft(): HypertrophyPlanDraftV1 {
  return {
    version: 1 as const,
    settings: {
      equipmentProfile: "FULL_GYM" as const,
      sessionDurationMinutes: 60 as const,
    },
    sessions: [
      {
        slotId: "upper",
        name: "Upper",
        focus: "UPPER" as const,
        exercises: [
          {
            exerciseId: "bench",
            workingSets: 4,
            intent: {
              userRole: "PRIMARY_LIFT" as const,
              target: {
                kind: "movement_pattern" as const,
                movementPattern: "horizontal_push" as const,
              },
            },
          },
        ],
      },
      {
        slotId: "lower",
        name: "Lower",
        focus: "LOWER" as const,
        exercises: [
          {
            exerciseId: "curl",
            workingSets: 3,
            intent: {
              userRole: "MUSCLE_ISOLATION" as const,
              target: { kind: "muscle" as const, muscleId: "hamstrings" as const },
            },
          },
        ],
      },
    ],
  };
}

function lowAxialDraft() {
  const value = structuredClone(draft());
  value.sessions[1]!.exercises[0] = {
    exerciseId: "hip-thrust",
    workingSets: 3,
    intent: {
      userRole: "PRIMARY_LIFT",
      target: { kind: "movement_pattern", movementPattern: "hinge" },
      requiredExerciseClass: "low_axial_hip_extension_anchor",
    },
  };
  return value;
}

function weeklyDraft({ emptyUpper = false } = {}): HypertrophyPlanDraftV2 {
  return {
    version: 2,
    settings: draft().settings,
    weeks: [
      { week: 1, phase: "ACCUMULATION" },
      { week: 2, phase: "DELOAD" },
    ],
    sessions: [
      {
        slotId: "upper",
        name: "Upper",
        focus: "UPPER",
        exercises: emptyUpper
          ? []
          : [
              {
                placementId: "placement-bench",
                exerciseId: "bench",
                intent: draft().sessions[0]!.exercises[0]!.intent,
                prescriptions: [
                  {
                    week: 1,
                    status: "PRESCRIBE",
                    setCount: 4,
                    reps: { kind: "RANGE", min: 6, max: 8 },
                    rir: { kind: "TARGET_RANGE", min: 2, max: 3 },
                  },
                  {
                    week: 2,
                    status: "PRESCRIBE",
                    setCount: 4,
                    reps: { kind: "EXACT", reps: 6 },
                    rir: { kind: "TARGET_RANGE", min: 4, max: 5 },
                  },
                ],
              },
            ],
      },
      {
        slotId: "lower",
        name: "Lower",
        focus: "LOWER",
        exercises: [
          {
            placementId: "placement-curl",
            exerciseId: "curl",
            intent: draft().sessions[1]!.exercises[0]!.intent,
            prescriptions: [
              {
                week: 1,
                status: "PRESCRIBE",
                setCount: 3,
                reps: { kind: "EXACT", reps: 10 },
                rir: { kind: "NOT_APPLICABLE" },
              },
              { week: 2, status: "OMIT" },
            ],
          },
        ],
      },
    ],
  };
}

const exerciseRows = [
  {
    id: "bench",
    name: "Bench Press",
    movementPatterns: ["HORIZONTAL_PUSH"],
    contraindications: {},
    isCompound: true,
    isMainLiftEligible: true,
    fatigueCost: 3,
    timePerSetSec: 180,
    measurementProfile: "REPS_EXTERNAL_LOAD",
    loadConvention: "BARBELL_TOTAL",
    repBasis: "TOTAL",
    aliases: [],
    exerciseEquipment: [{ equipment: { type: "BARBELL" } }],
    exerciseMuscles: [
      { role: "PRIMARY", muscle: { id: "chest", name: "Chest" } },
    ],
  },
  {
    id: "curl",
    name: "Leg Curl",
    movementPatterns: ["FLEXION"],
    contraindications: {},
    isCompound: false,
    isMainLiftEligible: false,
    fatigueCost: 1,
    timePerSetSec: 90,
    measurementProfile: "REPS_EXTERNAL_LOAD",
    loadConvention: "MACHINE_DISPLAYED",
    repBasis: "TOTAL",
    aliases: [],
    exerciseEquipment: [{ equipment: { type: "MACHINE" } }],
    exerciseMuscles: [
      {
        role: "PRIMARY",
        muscle: { id: "hamstrings", name: "Hamstrings" },
      },
    ],
  },
  {
    id: "hip-thrust",
    name: "Machine Hip Thrust",
    movementPatterns: ["HINGE"],
    contraindications: {},
    isCompound: true,
    isMainLiftEligible: true,
    fatigueCost: 2,
    timePerSetSec: 120,
    measurementProfile: "REPS_EXTERNAL_LOAD",
    loadConvention: "MACHINE_DISPLAYED",
    repBasis: "TOTAL",
    aliases: [],
    exerciseEquipment: [{ equipment: { type: "MACHINE" } }],
    exerciseMuscles: [
      { role: "PRIMARY", muscle: { id: "glutes", name: "Glutes" } },
      {
        role: "SECONDARY",
        muscle: { id: "hamstrings", name: "Hamstrings" },
      },
    ],
  },
];

describe("custom hypertrophy draft persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.TRAINER_EXERCISE_MEASUREMENT_ROLLOUT;
    mocks.state.draft = { payload: draft(), revision: 3 };
    mocks.state.mesocycles.length = 0;
    mocks.state.revisions.length = 0;
    mocks.state.planUpdates.length = 0;
    mocks.tx.exercise.findMany.mockResolvedValue(exerciseRows);
    mocks.tx.injury.findMany.mockResolvedValue([]);
    mocks.tx.userPreference.findUnique.mockResolvedValue(null);
    mocks.tx.macroCycle.findFirst.mockResolvedValue({
      id: "plan-1",
      trainingAge: "INTERMEDIATE",
      hypertrophyDraft: mocks.state.draft,
      mesocycles: [],
    });
    mocks.tx.hypertrophyPlanDraft.deleteMany.mockImplementation(async () => {
      mocks.state.draft = null;
      return { count: 1 };
    });
    mocks.createRevision.mockImplementation(async (_tx, input) => {
      const revision = { id: "revision-1", seedPayload: input.seedPayload };
      mocks.state.revisions.push(revision);
      return revision;
    });
  });

  it("rejects stale autosave writes without changing the plan name", async () => {
    mocks.tx.hypertrophyPlanDraft.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      saveHypertrophyPlanDraft({
        userId: "user-1",
        planId: "plan-1",
        expectedRevision: 2,
        name: "Stale name",
        draft: draft(),
      }),
    ).rejects.toMatchObject({ code: "PLAN_MUTATION_CONFLICT" });
    expect(mocks.tx.macroCycle.update).not.toHaveBeenCalled();
  });

  it("creates a generic V4 weekly draft in the existing JSON draft row", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({
      profile: { trainingAge: "INTERMEDIATE" },
    });
    mocks.prisma.macroCycle.create.mockResolvedValue({});

    await createCustomHypertrophyPlan({
      userId: "user-1",
      name: "Weekly plan",
      sessionsPerWeek: 4,
      equipmentProfile: "FULL_GYM",
      sessionDurationMinutes: 60,
      authorMethod: "WEEKLY",
      preset: "UPPER_LOWER_4",
    });

    const createInput = mocks.prisma.macroCycle.create.mock.calls[0]![0];
    expect(createInput.data.hypertrophyDraft.create.payload).toMatchObject({
      version: 2,
      weeks: [
        { week: 1, phase: "ACCUMULATION" },
        { week: 2, phase: "ACCUMULATION" },
        { week: 3, phase: "ACCUMULATION" },
        { week: 4, phase: "ACCUMULATION" },
        { week: 5, phase: "DELOAD" },
      ],
    });
    expect(createInput.data.hypertrophyDraft.create.payload.sessions).toHaveLength(4);
    expect(createInput.data.hypertrophyDraft.create.payload.sessions[0].exercises).toEqual([]);
    expect(createInput.data).not.toHaveProperty("mesocycles");
  });

  it("replays concurrent identical custom-plan creates by server-enforced creation identity", async () => {
    const creationId = "00000000-0000-4000-8000-000000000123";
    let persistedPlanId: string | null = null;
    let persisted: {
      name: string;
      hypertrophyDraft: { payload: unknown; revision: number };
    } | null = null;
    mocks.prisma.user.findUnique.mockResolvedValue({
      profile: { trainingAge: "INTERMEDIATE" },
    });
    mocks.prisma.macroCycle.create
      .mockImplementationOnce(async ({ data }) => {
        persistedPlanId = data.id;
        persisted = {
          name: data.name,
          hypertrophyDraft: {
            payload: data.hypertrophyDraft.create.payload,
            revision: 1,
          },
        };
        return {};
      })
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError("duplicate", {
          code: "P2002",
          clientVersion: "test",
        }),
      );
    mocks.prisma.macroCycle.findFirst.mockImplementation(async ({ where }) =>
      where.id === persistedPlanId && where.userId === "user-1"
        ? persisted
        : null,
    );
    const input = {
      userId: "user-1",
      name: "Weekly plan",
      sessionsPerWeek: 4,
      equipmentProfile: "FULL_GYM" as const,
      sessionDurationMinutes: 60 as const,
      authorMethod: "WEEKLY" as const,
      preset: "UPPER_LOWER_4" as const,
      creationId,
    };

    const results = await Promise.all([
      createCustomHypertrophyPlan(input),
      createCustomHypertrophyPlan(input),
    ]);

    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toEqual({ planId: persistedPlanId, draftRevision: 1 });
    expect(persistedPlanId).not.toBe(creationId);
  });

  it("rejects reuse of one creation identity with a different canonical payload", async () => {
    const creationId = "00000000-0000-4000-8000-000000000133";
    const persisted = new Map<string, {
      userId: string;
      name: string;
      hypertrophyDraft: { payload: unknown; revision: number };
    }>();
    mocks.prisma.user.findUnique.mockResolvedValue({
      profile: { trainingAge: "INTERMEDIATE" },
    });
    mocks.prisma.macroCycle.create.mockImplementation(async ({ data }) => {
      if (persisted.has(data.id)) {
        throw new Prisma.PrismaClientKnownRequestError("duplicate", {
          code: "P2002",
          clientVersion: "test",
        });
      }
      persisted.set(data.id, {
        userId: data.userId,
        name: data.name,
        hypertrophyDraft: {
          payload: structuredClone(data.hypertrophyDraft.create.payload),
          revision: 1,
        },
      });
      return {};
    });
    mocks.prisma.macroCycle.findFirst.mockImplementation(async ({ where }) => {
      const existing = persisted.get(where.id);
      return existing?.userId === where.userId ? existing : null;
    });
    const base = {
      userId: "user-1",
      name: "Weekly plan",
      sessionsPerWeek: 4,
      equipmentProfile: "FULL_GYM" as const,
      authorMethod: "WEEKLY" as const,
      preset: "UPPER_LOWER_4" as const,
      creationId,
    };

    const created = await createCustomHypertrophyPlan({
      ...base,
      sessionDurationMinutes: 60,
    });
    const original = structuredClone(persisted.get(created.planId));
    await expect(
      createCustomHypertrophyPlan({
        ...base,
        sessionDurationMinutes: 75,
      }),
    ).rejects.toMatchObject({ code: "PLAN_CREATION_ID_CONFLICT" });

    expect(persisted).toHaveLength(1);
    expect(persisted.get(created.planId)).toEqual(original);
    expect(mocks.prisma.macroCycle.create).toHaveBeenCalledTimes(2);
  });

  it("namespaces one creation identity by owner and keeps replay lookup owner-scoped", async () => {
    const creationId = "00000000-0000-4000-8000-000000000143";
    const persisted = new Map<string, {
      userId: string;
      name: string;
      hypertrophyDraft: { payload: unknown; revision: number };
    }>();
    mocks.prisma.user.findUnique.mockResolvedValue({
      profile: { trainingAge: "INTERMEDIATE" },
    });
    mocks.prisma.macroCycle.create.mockImplementation(async ({ data }) => {
      if (persisted.has(data.id)) {
        throw new Prisma.PrismaClientKnownRequestError("duplicate", {
          code: "P2002",
          clientVersion: "test",
        });
      }
      persisted.set(data.id, {
        userId: data.userId,
        name: data.name,
        hypertrophyDraft: {
          payload: structuredClone(data.hypertrophyDraft.create.payload),
          revision: 1,
        },
      });
      return {};
    });
    mocks.prisma.macroCycle.findFirst.mockImplementation(async ({ where }) => {
      const existing = persisted.get(where.id);
      return existing?.userId === where.userId ? existing : null;
    });
    const input = {
      name: "Weekly plan",
      sessionsPerWeek: 4,
      equipmentProfile: "FULL_GYM" as const,
      sessionDurationMinutes: 60 as const,
      authorMethod: "WEEKLY" as const,
      preset: "UPPER_LOWER_4" as const,
      creationId,
    };

    const ownerOne = await createCustomHypertrophyPlan({
      ...input,
      userId: "user-1",
    });
    const ownerTwo = await createCustomHypertrophyPlan({
      ...input,
      userId: "user-2",
    });
    await expect(
      createCustomHypertrophyPlan({ ...input, userId: "user-1" }),
    ).resolves.toEqual(ownerOne);
    await expect(
      createCustomHypertrophyPlan({ ...input, userId: "user-2" }),
    ).resolves.toEqual(ownerTwo);

    expect(ownerOne.planId).not.toBe(ownerTwo.planId);
    expect(persisted).toHaveLength(2);
    expect([...persisted.values()].map((entry) => entry.userId).sort()).toEqual([
      "user-1",
      "user-2",
    ]);
    expect(mocks.prisma.macroCycle.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ownerOne.planId, userId: "user-1" },
      }),
    );
    expect(mocks.prisma.macroCycle.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ownerTwo.planId, userId: "user-2" },
      }),
    );
  });

  it("keeps separate intentional create identities separate", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({
      profile: { trainingAge: "INTERMEDIATE" },
    });
    mocks.prisma.macroCycle.create.mockResolvedValue({});
    const base = {
      userId: "user-1",
      name: "Weekly plan",
      sessionsPerWeek: 4,
      equipmentProfile: "FULL_GYM" as const,
      sessionDurationMinutes: 60 as const,
      authorMethod: "WEEKLY" as const,
      preset: "UPPER_LOWER_4" as const,
    };

    const created = await Promise.all([
      createCustomHypertrophyPlan({
        ...base,
        creationId: "00000000-0000-4000-8000-000000000123",
      }),
      createCustomHypertrophyPlan({
        ...base,
        creationId: "00000000-0000-4000-8000-000000000124",
      }),
    ]);

    expect(created[0].planId).not.toBe(created[1].planId);
    expect(created.map((result) => result.planId)).not.toContain(
      "00000000-0000-4000-8000-000000000123",
    );
    expect(created.map((result) => result.planId)).not.toContain(
      "00000000-0000-4000-8000-000000000124",
    );
  });

  it("autosaves a structurally valid but preview-incomplete V4 draft", async () => {
    const incomplete = weeklyDraft({ emptyUpper: true });
    const recommended = incomplete.sessions[1]!.exercises[0]!;
    recommended.recommendationBaseline = {
      version: 1,
      exerciseId: recommended.exerciseId,
      intent: structuredClone(recommended.intent),
      prescriptions: structuredClone(recommended.prescriptions),
    };
    mocks.tx.hypertrophyPlanDraft.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.hypertrophyPlanDraft.findUniqueOrThrow.mockResolvedValue({
      revision: 4,
      updatedAt: new Date("2026-08-06T12:00:00.000Z"),
    });

    await expect(
      saveHypertrophyPlanDraft({
        userId: "user-1",
        planId: "plan-1",
        expectedRevision: 3,
        name: "Weekly draft",
        draft: incomplete,
      }),
    ).resolves.toMatchObject({
      revision: 4,
      health: {
        status: "AVAILABLE",
        draftId: "plan-1",
        draftRevision: 4,
        summary: { blockingSafety: 3 },
      },
      preview: {
        status: "INELIGIBLE",
        reasons: [expect.objectContaining({ code: "EMPTY_SESSION", slotId: "upper" })],
      },
    });
    expect(mocks.tx.hypertrophyPlanDraft.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ payload: incomplete }),
      }),
    );
    expect(mocks.tx.mesocycle.create).not.toHaveBeenCalled();
    expect(mocks.createRevision).not.toHaveBeenCalled();
  });

  it("rejects a public PATCH-shaped client-introduced measurement before any save write", async () => {
    const current = weeklyDraft();
    const submitted = structuredClone(current);
    submitted.sessions[0]!.exercises[0]!.preservedMeasurement = {
      exerciseId: "bench",
      measurement: BARBELL_TOTAL,
    };
    mocks.state.draft = { payload: current, revision: 3 };
    mocks.tx.macroCycle.findFirst.mockResolvedValue({
      id: "plan-1",
      hypertrophyDraft: mocks.state.draft,
      mesocycles: [],
    });

    await expect(
      saveHypertrophyPlanDraft({
        userId: "user-1",
        planId: "plan-1",
        expectedRevision: 3,
        name: "Untrusted snapshot",
        draft: submitted,
      }),
    ).rejects.toMatchObject({
      code: "PLAN_DRAFT_MEASUREMENT_PROVENANCE_INVALID",
    });
    expect(mocks.tx.hypertrophyPlanDraft.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.macroCycle.update).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "modification",
      mutate: (submitted: HypertrophyPlanDraftV2) => {
        submitted.sessions[0]!.exercises[0]!.preservedMeasurement = {
          exerciseId: "bench",
          measurement: MACHINE_DISPLAYED,
        };
      },
    },
    {
      name: "removal",
      mutate: (submitted: HypertrophyPlanDraftV2) => {
        delete submitted.sessions[0]!.exercises[0]!.preservedMeasurement;
      },
    },
    {
      name: "transfer to a replacement exercise",
      mutate: (submitted: HypertrophyPlanDraftV2) => {
        const exercise = submitted.sessions[0]!.exercises[0]!;
        exercise.exerciseId = "curl";
        exercise.preservedMeasurement = {
          exerciseId: "curl",
          measurement: BARBELL_TOTAL,
        };
      },
    },
  ])("rejects trusted snapshot $name before any save write", async ({ mutate }) => {
    const current = weeklyDraft();
    current.sessions[0]!.exercises[0]!.preservedMeasurement = {
      exerciseId: "bench",
      measurement: BARBELL_TOTAL,
    };
    const submitted = structuredClone(current);
    mutate(submitted);
    mocks.state.draft = { payload: current, revision: 3 };
    mocks.tx.macroCycle.findFirst.mockResolvedValue({
      id: "plan-1",
      hypertrophyDraft: mocks.state.draft,
      mesocycles: [],
    });

    await expect(
      saveHypertrophyPlanDraft({
        userId: "user-1",
        planId: "plan-1",
        expectedRevision: 3,
        name: "Untrusted snapshot edit",
        draft: submitted,
      }),
    ).rejects.toMatchObject({
      code: "PLAN_DRAFT_MEASUREMENT_PROVENANCE_INVALID",
    });
    expect(mocks.tx.hypertrophyPlanDraft.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.macroCycle.update).not.toHaveBeenCalled();
  });

  it("uses current catalog measurement when a copied placement changes exercise", async () => {
    const current = weeklyDraft();
    current.sessions[0]!.exercises[0]!.preservedMeasurement = {
      exerciseId: "bench",
      measurement: BARBELL_TOTAL,
    };
    const submitted = structuredClone(current);
    const replacement = submitted.sessions[0]!.exercises[0]!;
    replacement.exerciseId = "curl";
    delete replacement.preservedMeasurement;
    mocks.state.draft = { payload: current, revision: 3 };
    mocks.tx.macroCycle.findFirst.mockResolvedValue({
      id: "plan-1",
      hypertrophyDraft: mocks.state.draft,
      mesocycles: [],
    });
    mocks.tx.hypertrophyPlanDraft.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.hypertrophyPlanDraft.findUniqueOrThrow.mockResolvedValue({
      revision: 4,
      updatedAt: new Date("2026-08-07T12:00:00.000Z"),
    });

    const saved = await saveHypertrophyPlanDraft({
      userId: "user-1",
      planId: "plan-1",
      expectedRevision: 3,
      name: "Replacement",
      draft: submitted,
    });

    expect(saved.preview).toMatchObject({
      status: "ELIGIBLE",
      normalizedPlan: {
        slots: [
          {
            exercises: [
              expect.objectContaining({
                exerciseId: "curl",
                measurement: MACHINE_DISPLAYED,
              }),
            ],
          },
          expect.anything(),
        ],
      },
    });
  });

  it("keeps a server-copied measurement stable across catalog drift", async () => {
    const current = weeklyDraft();
    current.sessions[0]!.exercises[0]!.preservedMeasurement = {
      exerciseId: "bench",
      measurement: BARBELL_TOTAL,
    };
    const submitted = structuredClone(current);
    mocks.state.draft = { payload: current, revision: 3 };
    mocks.tx.macroCycle.findFirst.mockResolvedValue({
      id: "plan-1",
      hypertrophyDraft: mocks.state.draft,
      mesocycles: [],
    });
    mocks.tx.exercise.findMany.mockResolvedValue(
      exerciseRows.map((row) =>
        row.id === "bench"
          ? {
              ...row,
              loadConvention: "MACHINE_DISPLAYED",
            }
          : row,
      ),
    );
    mocks.tx.hypertrophyPlanDraft.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.hypertrophyPlanDraft.findUniqueOrThrow.mockResolvedValue({
      revision: 4,
      updatedAt: new Date("2026-08-07T12:00:00.000Z"),
    });

    const saved = await saveHypertrophyPlanDraft({
      userId: "user-1",
      planId: "plan-1",
      expectedRevision: 3,
      name: "Trusted copy",
      draft: submitted,
    });

    expect(saved.preview).toMatchObject({
      status: "ELIGIBLE",
      normalizedPlan: {
        slots: [
          {
            exercises: [
              expect.objectContaining({ measurement: BARBELL_TOTAL }),
            ],
          },
          expect.anything(),
        ],
      },
    });
  });

  it("rejects a malformed V4 placement before persistence", async () => {
    const malformed = weeklyDraft();
    const prescription = malformed.sessions[0]!.exercises[0]!.prescriptions[0];
    if (prescription?.status !== "PRESCRIBE") throw new Error("fixture");
    prescription.setCount = 0;

    await expect(
      saveHypertrophyPlanDraft({
        userId: "user-1",
        planId: "plan-1",
        expectedRevision: 3,
        name: "Malformed weekly draft",
        draft: malformed,
      }),
    ).rejects.toThrow();
    expect(mocks.tx.hypertrophyPlanDraft.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.macroCycle.update).not.toHaveBeenCalled();
  });

  it("restores the exact saved V4 draft and derives preview without downstream writes", async () => {
    const saved = weeklyDraft();
    mocks.prisma.macroCycle.findFirst.mockResolvedValueOnce({
      id: "plan-1",
      name: "Weekly draft",
      hypertrophyDraft: {
        payload: structuredClone(saved),
        revision: 7,
        updatedAt: new Date("2026-08-06T12:00:00.000Z"),
      },
    });

    const restored = await loadHypertrophyPlanEditorData("user-1", "plan-1");

    expect(restored).toMatchObject({
      draft: saved,
      revision: 7,
      health: {
        status: "AVAILABLE",
        draftId: "plan-1",
        draftRevision: 7,
        evaluatedFacts: {
          catalogExerciseCount: exerciseRows.length,
          equipmentProfile: "FULL_GYM",
          recognizedLimitationCount: 0,
          unrecognizedLimitationsPresent: false,
        },
      },
      preview: { status: "ELIGIBLE", hash: expect.stringMatching(/^[a-f0-9]{64}$/) },
    });
    expect(mocks.tx.mesocycle.create).not.toHaveBeenCalled();
    expect(mocks.createRevision).not.toHaveBeenCalled();
    expect(mocks.tx.hypertrophyPlanDraft.updateMany).not.toHaveBeenCalled();
  });

  it("surfaces an unrecognized current limitation as a generic saved-revision blocker", async () => {
    const saved = weeklyDraft();
    mocks.prisma.macroCycle.findFirst.mockResolvedValueOnce({
      id: "plan-1",
      name: "Weekly draft",
      hypertrophyDraft: {
        payload: saved,
        revision: 9,
        updatedAt: new Date("2026-08-06T12:00:00.000Z"),
      },
    });
    mocks.prisma.injury.findMany.mockResolvedValueOnce([
      { bodyPart: "private unsupported limitation text" },
    ]);

    const restored = await loadHypertrophyPlanEditorData("user-1", "plan-1");

    expect(restored?.health).toMatchObject({
      status: "AVAILABLE",
      draftRevision: 9,
      summary: { blockingSafety: 3 },
      evaluatedFacts: { unrecognizedLimitationsPresent: true },
    });
    if (restored?.health.status !== "AVAILABLE") throw new Error("Health unavailable");
    const limitationIssue = restored.health.issues.find(
      (issue) => issue.code === "LIMITATION_UNRECOGNIZED",
    );
    expect(limitationIssue).toMatchObject({
      tier: "BLOCKING_SAFETY",
      blocksFinalization: true,
    });
    expect(JSON.stringify(limitationIssue)).not.toContain("private unsupported");
  });

  it("returns clear deterministic preview reasons for unresolved measurement identity", () => {
    const candidate = weeklyDraft();
    const measurement = {
      profile: "REPS_EXTERNAL_LOAD" as const,
      loadConvention: "BARBELL_TOTAL" as const,
      repBasis: "TOTAL" as const,
    };
    const input = {
      draft: candidate,
      knownExerciseIds: new Set(["bench", "curl"]),
      measurementByExerciseId: new Map([["bench", measurement]]),
    };

    expect(deriveHypertrophyPlanV4Preview(input)).toEqual(
      deriveHypertrophyPlanV4Preview(input),
    );
    expect(deriveHypertrophyPlanV4Preview(input)).toEqual({
      status: "INELIGIBLE",
      reasons: [
        {
          code: "MEASUREMENT_UNRESOLVED",
          message:
            "Lower has an exercise without a supported measurement identity.",
          slotId: "lower",
          placementId: "placement-curl",
        },
      ],
    });
  });

  function buildReferencePlanPreview() {
    const resolvedExercises = new Map<
      string,
      ReturnType<typeof toAuthoringExercise>
    >();
    const candidate: HypertrophyPlanDraftV2 = {
      version: 2,
      settings: {
        equipmentProfile: "FULL_GYM",
        sessionDurationMinutes: 60,
      },
      weeks: REFERENCE_WEEKS,
      sessions: REFERENCE_PLAN_EXPECTATIONS.map((session) => {
        const existingIntents: AcceptedExerciseIntentV2[] = [];
        return {
          slotId: session.slotId,
          name: session.name,
          focus: session.focus,
          exercises: session.exercises.map((expected) => {
            const exercise = toAuthoringExercise(
              referenceExerciseRow(expected.exerciseId),
            );
            const recommendation = materializeHypertrophyExerciseRecommendation({
              exercise,
              weeks: REFERENCE_WEEKS,
              existingIntents,
            });
            existingIntents.push(recommendation.intent);
            resolvedExercises.set(exercise.id, exercise);

            // These checks pin the catalog-shaped fixture to the API-owned mapper
            // before recommendation inference or either projection can mask it.
            expect(exercise.id, expected.placementId).toBe(expected.exerciseId);
            expect(exercise.measurement, expected.placementId).toEqual(
              expected.measurement,
            );
            expect(recommendation.intent, expected.placementId).toEqual(
              expected.intent,
            );
            expect(recommendation.prescriptions, expected.placementId).toEqual(
              expected.prescriptions,
            );
            expect(recommendation.recommendationBaseline, expected.placementId).toEqual(
              {
                version: 1,
                exerciseId: expected.exerciseId,
                intent: expected.intent,
                prescriptions: expected.prescriptions,
              },
            );

            return {
              placementId: expected.placementId,
              exerciseId: exercise.id,
              ...recommendation,
            };
          }),
        };
      }),
    };
    const measurementByExerciseId = new Map(
      [...resolvedExercises.values()].map((exercise) => {
        if (!exercise.measurement) {
          throw new Error(`Missing reference-plan measurement: ${exercise.name}`);
        }
        return [exercise.id, exercise.measurement] as const;
      }),
    );
    const preview = deriveHypertrophyPlanV4Preview({
      draft: candidate,
      knownExerciseIds: new Set(resolvedExercises.keys()),
      measurementByExerciseId,
    });
    expect(preview.status).toBe("ELIGIBLE");
    if (preview.status !== "ELIGIBLE") {
      throw new Error("Reference plan is ineligible");
    }
    return {
      ...preview,
      draft: candidate,
      rows: [...resolvedExercises.keys()].map(referenceExerciseRow),
    };
  }

  it("materializes the complete four-day reference plan through the API adapter, recommendation, and both projections", () => {
    const preview = buildReferencePlanPreview();

    assertReferenceProjections({
      accepted: preview.normalizedPlan,
      executable: preview.executablePlan,
    });
    expect(
      (catalog.exercises as CatalogRow[]).filter((exercise) =>
        [...exercise.primaryMuscles, ...exercise.secondaryMuscles].some(
          (muscle) => muscle.toLowerCase().includes("hip flexor"),
        ),
      ),
    ).toEqual([]);
  });

  it("rejects representative accepted and executable projection mutations", () => {
    const preview = buildReferencePlanPreview();
    const mutations: Array<{
      name: string;
      mutate: (projection: {
        accepted: AcceptedHypertrophySeedV4;
        executable: ExecutableSeedProjectionV3;
      }) => void;
    }> = [
      {
        name: "swapped accepted exercise order",
        mutate: ({ accepted }) => {
          [accepted.slots[0]!.exercises[0], accepted.slots[0]!.exercises[1]] = [
            accepted.slots[0]!.exercises[1]!,
            accepted.slots[0]!.exercises[0]!,
          ];
        },
      },
      {
        name: "replaced executable exercise identity",
        mutate: ({ executable }) => {
          executable.slots[0]!.exercises[0]!.exerciseId = "Dumbbell Bench Press";
        },
      },
      {
        name: "changed executable role and intent",
        mutate: ({ executable }) => {
          const exercise = executable.slots[0]!.exercises[0]!;
          exercise.role = "ACCESSORY";
          exercise.intent = {
            userRole: "SECONDARY_LIFT",
            target: exercise.intent.target,
          };
        },
      },
      {
        name: "changed executable measurement semantics",
        mutate: ({ executable }) => {
          executable.slots[0]!.exercises[4]!.measurement = MACHINE_DISPLAYED;
        },
      },
      {
        name: "changed an accumulation prescription",
        mutate: ({ executable }) => {
          const prescription = executable.slots[1]!.exercises[1]!.prescriptions[0];
          if (prescription?.status !== "PRESCRIBE") {
            throw new Error("Expected prescribed Week 1 work");
          }
          prescription.setCount = 4;
        },
      },
      {
        name: "changed a retained Week 5 set count",
        mutate: ({ executable }) => {
          const prescription = executable.slots[0]!.exercises[0]!.prescriptions[4];
          if (prescription?.status !== "PRESCRIBE") {
            throw new Error("Expected retained Week 5 work");
          }
          prescription.setCount = 3;
        },
      },
      {
        name: "replaced an explicit Week 5 omission with work",
        mutate: ({ executable }) => {
          executable.slots[3]!.exercises[4]!.prescriptions[4] = {
            week: 5,
            status: "PRESCRIBE",
            setCount: 1,
            reps: { kind: "RANGE", min: 8, max: 15 },
            rir: { kind: "TARGET_RANGE", min: 4, max: 5 },
          };
        },
      },
    ];

    for (const mutation of mutations) {
      const projection = structuredClone({
        accepted: preview.normalizedPlan,
        executable: preview.executablePlan,
      });
      mutation.mutate(projection);
      expect(() => assertReferenceProjections(projection), mutation.name).toThrow();
    }
  });

  it("rejects unsupported V4 topology before accepted-plan or materialization writes", async () => {
    mocks.state.draft = { payload: weeklyDraft(), revision: 3 };
    mocks.tx.macroCycle.findFirst.mockResolvedValue({
      id: "plan-1",
      trainingAge: "INTERMEDIATE",
      hypertrophyDraft: mocks.state.draft,
      mesocycles: [],
    });

    await expect(
      makeHypertrophyPlanReady({
        userId: "user-1",
        planId: "plan-1",
        expectedDraftRevision: 3,
      }),
    ).rejects.toMatchObject({ code: "PLAN_UNSUPPORTED_TOPOLOGY" });
    expect(mocks.tx.mesocycle.create).not.toHaveBeenCalled();
    expect(mocks.createRevision).not.toHaveBeenCalled();
    expect(mocks.tx.hypertrophyPlanDraft.deleteMany).not.toHaveBeenCalled();
    expect(mocks.tx.macroCycle.update).not.toHaveBeenCalled();
  });

  it("atomically accepts the exact five-week reference preview as revision 1", async () => {
    const fixture = buildReferencePlanPreview();
    const prescriptionBeforeHealth = structuredClone(fixture.draft);
    mocks.state.draft = { payload: fixture.draft, revision: 7 };
    mocks.tx.exercise.findMany.mockResolvedValue(fixture.rows);
    mocks.tx.macroCycle.findFirst.mockResolvedValue({
      id: "plan-1",
      trainingAge: "INTERMEDIATE",
      hypertrophyDraft: mocks.state.draft,
      mesocycles: [],
    });
    mocks.prisma.macroCycle.findFirst.mockResolvedValueOnce({
      id: "plan-1",
      name: "Five-week V4 reference",
      hypertrophyDraft: {
        payload: fixture.draft,
        revision: 7,
        updatedAt: new Date("2026-08-15T12:00:00.000Z"),
      },
    });
    mocks.prisma.exercise.findMany.mockResolvedValueOnce(fixture.rows);

    const loaded = await loadHypertrophyPlanEditorData("user-1", "plan-1");
    expect(loaded?.health).toMatchObject({
      status: "AVAILABLE",
      draftRevision: 7,
      summary: {
        blockingSafety: 0,
        importantWarnings: 0,
      },
    });
    if (loaded?.health.status !== "AVAILABLE") throw new Error("Health unavailable");
    expect(
      loaded.health.issues
        .filter((issue) => issue.tier === "COACHING_OBSERVATION")
        .map((issue) => issue.affected?.muscle),
    ).toEqual(expect.arrayContaining([
      "Chest",
      "Side Delts",
      "Lats",
      "Upper Back",
      "Rear Delts",
      "Biceps",
      "Triceps",
      "Calves",
    ]));
    expect(fixture.draft).toEqual(prescriptionBeforeHealth);

    await expect(
      makeHypertrophyPlanReady({
        userId: "user-1",
        planId: "plan-1",
        expectedDraftRevision: 7,
        confirmedPreviewHash: fixture.hash,
      }),
    ).resolves.toMatchObject({
      planId: "plan-1",
      revisionId: "revision-1",
    });
    expect(mocks.state.draft).toBeNull();
    expect(mocks.state.mesocycles).toHaveLength(1);
    expect(mocks.state.mesocycles[0]).toMatchObject({
      durationWeeks: 5,
      sessionsPerWeek: 4,
      blocks: { create: [{ durationWeeks: 4 }, { durationWeeks: 1 }] },
    });
    expect(mocks.state.revisions).toEqual([
      expect.objectContaining({
        seedPayload: expect.objectContaining({
          version: 4,
          weeks: REFERENCE_WEEKS,
          slots: fixture.normalizedPlan.slots,
        }),
      }),
    ]);
  });

  it("keeps above-reference Draft V2 volume informational without changing preview, V4 payload, or canonical hash", () => {
    const fixture = buildReferencePlanPreview();
    const highVolumeDraft = structuredClone(fixture.draft);
    for (const session of highVolumeDraft.sessions) {
      for (const exercise of session.exercises) {
        exercise.prescriptions = exercise.prescriptions.map((prescription) =>
          prescription.status === "PRESCRIBE"
            ? { ...prescription, setCount: 10 }
            : prescription,
        );
      }
    }
    const fastRows = fixture.rows.map((row) => ({ ...row, timePerSetSec: 0 }));
    const rows = fastRows as HypertrophyPlanDraftExerciseRow[];
    const previewBefore = deriveHypertrophyPlanV4Preview({
      draft: highVolumeDraft,
      knownExerciseIds: new Set(rows.map((row) => row.id)),
      measurementByExerciseId: new Map(
        rows.flatMap((row) => {
          const measurement = parseMeasurementColumns(row);
          return measurement ? [[row.id, measurement] as const] : [];
        }),
      ),
    });
    if (previewBefore.status !== "ELIGIBLE") {
      throw new Error("Expected eligible high-volume preview fixture");
    }
    const draftBeforeHealth = structuredClone(highVolumeDraft);
    const health = safeDraftHealthAssessment({
      draftId: "plan-1",
      draftRevision: 7,
      draft: highVolumeDraft,
      rows,
      exercises: rows.map((row) => toAuthoringExercise(row)),
      limitations: { recognizedTags: [], unrecognizedTexts: [] },
      preview: previewBefore,
    });
    const previewAfter = deriveHypertrophyPlanV4Preview({
      draft: highVolumeDraft,
      knownExerciseIds: new Set(rows.map((row) => row.id)),
      measurementByExerciseId: new Map(
        rows.flatMap((row) => {
          const measurement = parseMeasurementColumns(row);
          return measurement ? [[row.id, measurement] as const] : [];
        }),
      ),
    });

    expect(health.status).toBe("AVAILABLE");
    if (health.status !== "AVAILABLE") throw new Error("Health unavailable");
    expect(
      health.volumeEstimates.some(
        (estimate) =>
          estimate.referenceRange != null &&
          estimate.effectiveSets > estimate.referenceRange.max,
      ),
    ).toBe(true);
    expect(health.summary.importantWarnings).toBe(0);
    expect(health.issues.map((issue) => issue.code)).not.toContain("VOLUME_HIGH");
    expect(highVolumeDraft).toEqual(draftBeforeHealth);
    expect(previewAfter).toEqual(previewBefore);
    if (previewAfter.status !== "ELIGIBLE") throw new Error("Preview changed");
    expect(previewAfter.normalizedPlan).toEqual(previewBefore.normalizedPlan);
    expect(previewAfter.executablePlan).toEqual(previewBefore.executablePlan);
    expect(previewAfter.hash).toBe(previewBefore.hash);
  });

  it("compiles the same trusted copied measurement in preview and finalization after catalog drift", async () => {
    const reference = buildReferencePlanPreview();
    const draft = structuredClone(reference.draft);
    const copied = draft.sessions[0]!.exercises[0]!;
    copied.preservedMeasurement = {
      exerciseId: copied.exerciseId,
      measurement: BARBELL_TOTAL,
    };
    const driftedRows = reference.rows.map((row) =>
      row.id === copied.exerciseId
        ? { ...row, loadConvention: "MACHINE_DISPLAYED" as const }
        : row,
    );
    const measurementByExerciseId = new Map(
      driftedRows.map((row) => {
        const exercise = toAuthoringExercise(row);
        if (!exercise.measurement) throw new Error(`Missing measurement: ${row.id}`);
        return [exercise.id, exercise.measurement] as const;
      }),
    );
    const preview = deriveHypertrophyPlanV4Preview({
      draft,
      knownExerciseIds: new Set(driftedRows.map((row) => row.id)),
      measurementByExerciseId,
    });
    expect(preview.status).toBe("ELIGIBLE");
    if (preview.status !== "ELIGIBLE") return;
    expect(preview.normalizedPlan.slots[0]!.exercises[0]!.measurement)
      .toEqual(BARBELL_TOTAL);

    mocks.state.draft = { payload: draft, revision: 8 };
    mocks.tx.exercise.findMany.mockResolvedValue(driftedRows);
    mocks.tx.macroCycle.findFirst.mockResolvedValue({
      id: "plan-1",
      trainingAge: "INTERMEDIATE",
      hypertrophyDraft: mocks.state.draft,
      mesocycles: [],
    });

    await expect(makeHypertrophyPlanReady({
      userId: "user-1",
      planId: "plan-1",
      expectedDraftRevision: 8,
      confirmedPreviewHash: preview.hash,
    })).resolves.toMatchObject({ revisionId: "revision-1" });
    expect(mocks.state.revisions).toEqual([
      expect.objectContaining({
        seedPayload: expect.objectContaining({
          slots: preview.normalizedPlan.slots,
        }),
      }),
    ]);
  });

  it("rejects a stale V4 preview hash without consuming the draft", async () => {
    const fixture = buildReferencePlanPreview();
    mocks.state.draft = { payload: fixture.draft, revision: 7 };
    mocks.tx.exercise.findMany.mockResolvedValue(fixture.rows);
    mocks.tx.macroCycle.findFirst.mockResolvedValue({
      id: "plan-1",
      trainingAge: "INTERMEDIATE",
      hypertrophyDraft: mocks.state.draft,
      mesocycles: [],
    });

    await expect(
      makeHypertrophyPlanReady({
        userId: "user-1",
        planId: "plan-1",
        expectedDraftRevision: 7,
        confirmedPreviewHash: "0".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "PLAN_PREVIEW_HASH_MISMATCH" });
    expect(mocks.state.draft).not.toBeNull();
    expect(mocks.state.mesocycles).toHaveLength(0);
    expect(mocks.state.revisions).toHaveLength(0);
  });

  it("rolls back V4 mesocycle and revision writes when the final draft CAS misses", async () => {
    const fixture = buildReferencePlanPreview();
    const persistedDraft = { payload: fixture.draft, revision: 7 };
    mocks.state.draft = structuredClone(persistedDraft);
    mocks.tx.exercise.findMany.mockResolvedValue(fixture.rows);
    mocks.tx.macroCycle.findFirst.mockResolvedValue({
      id: "plan-1",
      trainingAge: "INTERMEDIATE",
      hypertrophyDraft: mocks.state.draft,
      mesocycles: [],
    });
    mocks.tx.hypertrophyPlanDraft.deleteMany.mockResolvedValue({ count: 0 });

    await expect(
      makeHypertrophyPlanReady({
        userId: "user-1",
        planId: "plan-1",
        expectedDraftRevision: 7,
        confirmedPreviewHash: fixture.hash,
      }),
    ).rejects.toMatchObject({ code: "PLAN_MUTATION_CONFLICT" });
    expect(mocks.state.draft).toEqual(persistedDraft);
    expect(mocks.state.mesocycles).toHaveLength(0);
    expect(mocks.state.revisions).toHaveLength(0);
    expect(mocks.state.planUpdates).toHaveLength(0);
  });

  it("revalidates current limitations and blocks V4 acceptance before writes", async () => {
    const fixture = buildReferencePlanPreview();
    mocks.state.draft = { payload: fixture.draft, revision: 7 };
    mocks.tx.exercise.findMany.mockResolvedValue(fixture.rows.map((row, index) =>
      index === 0 ? { ...row, contraindications: { shoulder: true } } : row,
    ));
    mocks.tx.injury.findMany.mockResolvedValue([{ bodyPart: "shoulder" }]);
    mocks.tx.macroCycle.findFirst.mockResolvedValue({
      id: "plan-1",
      trainingAge: "INTERMEDIATE",
      hypertrophyDraft: mocks.state.draft,
      mesocycles: [],
    });

    await expect(
      makeHypertrophyPlanReady({
        userId: "user-1",
        planId: "plan-1",
        expectedDraftRevision: 7,
        confirmedPreviewHash: fixture.hash,
      }),
    ).rejects.toMatchObject({ code: "PLAN_DRAFT_BLOCKED" });
    expect(mocks.state.mesocycles).toHaveLength(0);
    expect(mocks.state.revisions).toHaveLength(0);
    expect(mocks.tx.hypertrophyPlanDraft.deleteMany).not.toHaveBeenCalled();
  });

  it("fails V4 finalization closed on an unrecognized active limitation", async () => {
    const fixture = buildReferencePlanPreview();
    const persistedDraft = { payload: fixture.draft, revision: 7 };
    mocks.state.draft = structuredClone(persistedDraft);
    mocks.tx.exercise.findMany.mockResolvedValue(fixture.rows);
    mocks.tx.injury.findMany.mockResolvedValue([
      { bodyPart: "unsupported active area" },
    ]);
    mocks.tx.macroCycle.findFirst.mockResolvedValue({
      id: "plan-1",
      trainingAge: "INTERMEDIATE",
      hypertrophyDraft: mocks.state.draft,
      mesocycles: [],
    });

    await expect(
      makeHypertrophyPlanReady({
        userId: "user-1",
        planId: "plan-1",
        expectedDraftRevision: 7,
        confirmedPreviewHash: fixture.hash,
      }),
    ).rejects.toMatchObject({
      code: "PLAN_LIMITATION_UNRECOGNIZED",
      details: { scope: "custom_hypertrophy" },
    });
    expect(mocks.state.draft).toEqual(persistedDraft);
    expect(mocks.state.mesocycles).toEqual([]);
    expect(mocks.state.revisions).toEqual([]);
    expect(mocks.state.planUpdates).toEqual([]);
    expect(mocks.tx.mesocycle.create).not.toHaveBeenCalled();
    expect(mocks.createRevision).not.toHaveBeenCalled();
    expect(mocks.tx.hypertrophyPlanDraft.deleteMany).not.toHaveBeenCalled();
    expect(mocks.tx.macroCycle.update).not.toHaveBeenCalled();
  });

  it("preserves the low-axial semantic through draft validation and autosave", async () => {
    const constrainedDraft = lowAxialDraft();
    mocks.tx.hypertrophyPlanDraft.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.hypertrophyPlanDraft.findUniqueOrThrow.mockResolvedValue({
      revision: 4,
      updatedAt: new Date("2026-08-05T12:00:00.000Z"),
    });

    await expect(
      saveHypertrophyPlanDraft({
        userId: "user-1",
        planId: "plan-1",
        expectedRevision: 3,
        name: "Low axial plan",
        draft: constrainedDraft,
      }),
    ).resolves.toMatchObject({
      revision: 4,
      updatedAt: "2026-08-05T12:00:00.000Z",
      health: {
        status: "AVAILABLE",
        draftId: "plan-1",
        draftRevision: 4,
      },
    });
    expect(mocks.tx.hypertrophyPlanDraft.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ payload: constrainedDraft }),
      }),
    );
  });

  it("finalizes coaching-only and informational-only Health without confirmation", async () => {
    const result = await makeHypertrophyPlanReady({
      userId: "user-1",
      planId: "plan-1",
      expectedDraftRevision: 3,
    });
    expect(result).toEqual({
      planId: "plan-1",
      mesocycleId: expect.any(String),
      revisionId: "revision-1",
    });
    expect(mocks.state.draft).toBeNull();
    expect(mocks.state.mesocycles).toHaveLength(1);
    expect(mocks.state.revisions).toHaveLength(1);
    expect(mocks.state.mesocycles[0]).toMatchObject({
      durationWeeks: 5,
      sessionsPerWeek: 2,
      blocks: {
        create: [
          { durationWeeks: 4 },
          { durationWeeks: 1 },
        ],
      },
    });
    expect(mocks.state.revisions[0]).toMatchObject({
      seedPayload: {
        version: 2,
        slots: [
          {
            exercises: [
              {
                role: "CORE_COMPOUND",
                intent: draft().sessions[0]!.exercises[0]!.intent,
              },
            ],
          },
          {
            exercises: [
              {
                role: "ACCESSORY",
                intent: draft().sessions[1]!.exercises[0]!.intent,
              },
            ],
          },
        ],
      },
    });
  });

  it("degrades explicitly when the evaluator throws or returns a malformed result", () => {
    const candidate = draft();
    const typedRows = exerciseRows as HypertrophyPlanDraftExerciseRow[];
    const exercises = typedRows.map((row) => toAuthoringExercise(row));
    const base: Omit<
      Parameters<typeof safeDraftHealthAssessment>[0],
      "evaluateHealth"
    > = {
      draftId: "plan-1",
      draftRevision: 8,
      draft: candidate,
      rows: typedRows,
      exercises,
      limitations: { recognizedTags: [], unrecognizedTexts: [] },
      preview: null,
    };

    expect(
      safeDraftHealthAssessment({
        ...base,
        evaluateHealth: () => {
          throw new Error("fixture evaluator failure");
        },
      }),
    ).toEqual({
      status: "UNAVAILABLE",
      policyVersion: "draft-plan-health.v2",
      draftId: "plan-1",
      draftRevision: 8,
      reason: "EVALUATION_FAILED",
    });
    expect(
      safeDraftHealthAssessment({
        ...base,
        evaluateHealth: () =>
          ({ blockers: null, warnings: [], muscles: [], sessions: [] }) as never,
      }),
    ).toMatchObject({
      status: "UNAVAILABLE",
      draftRevision: 8,
      reason: "RESULT_INVALID",
    });
    expect(candidate).toEqual(draft());
  });

  function availableHealthFor(
    candidate: HypertrophyPlanDraftV1,
    rows: HypertrophyPlanDraftExerciseRow[] = exerciseRows as HypertrophyPlanDraftExerciseRow[],
    limitations = { recognizedTags: [], unrecognizedTexts: [] },
  ) {
    const health = safeDraftHealthAssessment({
      draftId: "plan-1",
      draftRevision: 3,
      draft: candidate,
      rows,
      exercises: rows.map((row) => toAuthoringExercise(row)),
      limitations,
      preview: null,
    });
    if (health.status !== "AVAILABLE") {
      throw new Error("Expected available Health fixture");
    }
    return health;
  }

  it("binds confirmation scope to policy, identity, prescription, warnings, catalog, equipment, limitations, and preview", () => {
    const duplicateDraft = draft();
    duplicateDraft.sessions[0]!.exercises.push(
      structuredClone(duplicateDraft.sessions[0]!.exercises[0]!),
    );
    const rows = exerciseRows as HypertrophyPlanDraftExerciseRow[];
    const exercises = rows.map((row) => toAuthoringExercise(row));
    const health = availableHealthFor(duplicateDraft);
    const warning = health.issues.find(
      (issue) => issue.tier === "IMPORTANT_WARNING",
    );
    if (!warning) throw new Error("Expected important warning fixture");
    const eligiblePreview = {
      status: "ELIGIBLE" as const,
      reasons: [] as [],
      hash: "a".repeat(64),
      hashAlgorithm: "sha256" as const,
      normalizedPlan: {} as never,
      executablePlan: {} as never,
    };
    const base: Parameters<
      typeof buildHypertrophyPlanHealthConfirmationScope
    >[0] = {
      policyVersion: "draft-plan-health.v2",
      draftId: "plan-1",
      draftRevision: 3,
      draft: duplicateDraft,
      preview: eligiblePreview,
      importantWarnings: [warning],
      exercises,
      limitations: { recognizedTags: [], unrecognizedTexts: [] },
    };
    const scope = (
      overrides: Partial<typeof base>,
    ) => buildHypertrophyPlanHealthConfirmationScope({ ...base, ...overrides });
    const changedPrescription = structuredClone(duplicateDraft);
    changedPrescription.sessions[0]!.exercises[0]!.workingSets += 1;
    const changedEquipment = structuredClone(duplicateDraft);
    changedEquipment.settings.equipmentProfile = "BARBELL_HOME";
    const changedWarning = {
      ...warning,
      code: "SESSION_DURATION_HIGH",
      title: "Session may run long",
      explanation: "Upper is estimated at about 91 minutes.",
    };

    const original = scope({});
    const changed = [
      scope({ policyVersion: "draft-plan-health.v3" }),
      scope({ draftId: "plan-2" }),
      scope({ draftRevision: 4 }),
      scope({ draft: changedPrescription }),
      scope({ draft: changedEquipment }),
      scope({ importantWarnings: [changedWarning] }),
      scope({ exercises: exercises.map((exercise, index) =>
        index === 0 ? { ...exercise, timePerSetSec: exercise.timePerSetSec + 1 } : exercise,
      ) }),
      scope({
        limitations: { recognizedTags: ["wrist"], unrecognizedTexts: [] },
      }),
      scope({ preview: { ...eligiblePreview, hash: "b".repeat(64) } }),
    ];

    expect(new Set(changed)).toHaveLength(changed.length);
    expect(changed).not.toContain(original);
    expect(changedWarning.code).not.toBe(warning.code);
    expect([changedWarning]).toHaveLength(base.importantWarnings.length);
  });

  it("projects only selected Health-relevant catalog facts with explicit absence", () => {
    const candidate = draft();
    const exercises = (exerciseRows as HypertrophyPlanDraftExerciseRow[]).map((row) =>
      toAuthoringExercise(row),
    );

    expect(projectSelectedPlanHealthCatalog(candidate, exercises)).toEqual([
      {
        exerciseId: "bench",
        availability: "PRESENT",
        facts: expect.objectContaining({
          name: "Bench Press",
          aliases: [],
          movementPatterns: ["horizontal_push"],
          primaryMuscleIds: ["chest"],
          equipment: ["barbell"],
          contraindicationKeys: [],
          isCompound: true,
          isMainLiftEligible: true,
          timePerSetSec: 180,
        }),
      },
      {
        exerciseId: "curl",
        availability: "PRESENT",
        facts: expect.objectContaining({
          name: "Leg Curl",
          movementPatterns: ["flexion"],
          primaryMuscleIds: ["hamstrings"],
          equipment: ["machine"],
          timePerSetSec: 90,
        }),
      },
    ]);
    expect(
      projectSelectedPlanHealthCatalog(
        candidate,
        exercises.filter((exercise) => exercise.id !== "curl"),
      ),
    ).toEqual([
      expect.objectContaining({ exerciseId: "bench", availability: "PRESENT" }),
      { exerciseId: "curl", availability: "MISSING" },
    ]);
  });

  it("keeps confirmation stable across unused catalog changes and reordered inputs", () => {
    const candidate = draft();
    candidate.sessions[0]!.exercises.push(
      structuredClone(candidate.sessions[0]!.exercises[0]!),
    );
    const exercises = (exerciseRows as HypertrophyPlanDraftExerciseRow[]).map((row) =>
      toAuthoringExercise(row),
    );
    const health = availableHealthFor(candidate);
    const warning = health.issues.find((issue) => issue.tier === "IMPORTANT_WARNING")!;
    const input = {
      policyVersion: health.policyVersion,
      draftId: health.draftId,
      draftRevision: health.draftRevision,
      draft: candidate,
      preview: null,
      importantWarnings: [warning],
      exercises,
      limitations: {
        recognizedTags: ["wrist", "ankle", "lower_back"],
        unrecognizedTexts: ["é", "A", "10", "-", "2", "_", "a", "A"],
      },
    } satisfies Parameters<typeof buildHypertrophyPlanHealthConfirmationScope>[0];
    const original = buildHypertrophyPlanHealthConfirmationScope(input);
    const secondWarning = {
      ...warning,
      code: "SESSION_DURATION_HIGH",
      title: "É duration",
      explanation: "10 minutes over.",
    };
    expect(
      buildHypertrophyPlanHealthConfirmationScope({
        ...input,
        importantWarnings: [warning, secondWarning],
      }),
    ).toBe(
      buildHypertrophyPlanHealthConfirmationScope({
        ...input,
        importantWarnings: [secondWarning, warning],
      }),
    );
    const unusedIndex = exercises.findIndex((exercise) => exercise.id === "hip-thrust");
    expect(unusedIndex).toBeGreaterThanOrEqual(0);
    const mutateUnused = (
      update: (exercise: (typeof exercises)[number]) => (typeof exercises)[number],
    ) => exercises.map((exercise, index) => (index === unusedIndex ? update(exercise) : exercise));
    const unusedChanges = [
      mutateUnused((exercise) => ({ ...exercise, name: "Unused renamed" })),
      mutateUnused((exercise) => ({ ...exercise, aliases: ["unused alias"] })),
      mutateUnused((exercise) => ({ ...exercise, movementPatterns: ["squat"] })),
      mutateUnused((exercise) => ({ ...exercise, primaryMuscleIds: ["quads"] })),
      mutateUnused((exercise) => ({ ...exercise, secondaryMuscleIds: ["calves"] })),
      mutateUnused((exercise) => ({ ...exercise, stimulusByMuscleId: { quads: 0.25 } })),
      mutateUnused((exercise) => ({ ...exercise, equipment: ["band"] })),
      mutateUnused((exercise) => ({ ...exercise, contraindicationKeys: ["wrist"] })),
      mutateUnused((exercise) => ({ ...exercise, isCompound: !exercise.isCompound })),
      mutateUnused((exercise) => ({
        ...exercise,
        isMainLiftEligible: !exercise.isMainLiftEligible,
      })),
      mutateUnused((exercise) => ({ ...exercise, measurement: null })),
      mutateUnused((exercise) => ({ ...exercise, timePerSetSec: exercise.timePerSetSec + 1 })),
      exercises.filter((exercise) => exercise.id !== "hip-thrust"),
      [
        ...exercises,
        { ...exercises[unusedIndex]!, id: "unrelated-added", name: "Unrelated added" },
      ],
    ];

    for (const changedExercises of unusedChanges) {
      expect(
        buildHypertrophyPlanHealthConfirmationScope({
          ...input,
          exercises: [...changedExercises].reverse(),
          limitations: {
            recognizedTags: [...input.limitations.recognizedTags].reverse(),
            unrecognizedTexts: [...input.limitations.unrecognizedTexts].reverse(),
          },
        }),
      ).toBe(original);
    }
  });

  it("changes confirmation for each selected evaluator-consumed catalog fact", () => {
    const candidate = draft();
    candidate.sessions[0]!.exercises.push(
      structuredClone(candidate.sessions[0]!.exercises[0]!),
    );
    const exercises = (exerciseRows as HypertrophyPlanDraftExerciseRow[]).map((row) =>
      toAuthoringExercise(row),
    );
    const health = availableHealthFor(candidate);
    const warning = health.issues.find((issue) => issue.tier === "IMPORTANT_WARNING")!;
    const input = {
      policyVersion: health.policyVersion,
      draftId: health.draftId,
      draftRevision: health.draftRevision,
      draft: candidate,
      preview: null,
      importantWarnings: [warning],
      exercises,
      limitations: { recognizedTags: [], unrecognizedTexts: [] },
    } satisfies Parameters<typeof buildHypertrophyPlanHealthConfirmationScope>[0];
    const original = buildHypertrophyPlanHealthConfirmationScope(input);
    const changeSelected = (
      update: (exercise: (typeof exercises)[number]) => (typeof exercises)[number],
    ) => exercises.map((exercise) => (exercise.id === "bench" ? update(exercise) : exercise));
    const changes = [
      exercises.filter((exercise) => exercise.id !== "bench"),
      changeSelected((exercise) => ({ ...exercise, name: "Selected renamed" })),
      changeSelected((exercise) => ({ ...exercise, aliases: ["selected alias"] })),
      changeSelected((exercise) => ({ ...exercise, movementPatterns: ["vertical_push"] })),
      changeSelected((exercise) => ({ ...exercise, primaryMuscleIds: ["side_delts"] })),
      changeSelected((exercise) => ({ ...exercise, secondaryMuscleIds: ["triceps"] })),
      changeSelected((exercise) => ({ ...exercise, stimulusByMuscleId: { chest: 0.75 } })),
      changeSelected((exercise) => ({ ...exercise, equipment: ["dumbbell"] })),
      changeSelected((exercise) => ({ ...exercise, contraindicationKeys: ["shoulder"] })),
      changeSelected((exercise) => ({ ...exercise, isCompound: false })),
      changeSelected((exercise) => ({ ...exercise, isMainLiftEligible: false })),
      changeSelected((exercise) => ({ ...exercise, measurement: null })),
      changeSelected((exercise) => ({ ...exercise, timePerSetSec: 181 })),
    ];

    expect(new Set(changes.map((changedExercises) =>
      buildHypertrophyPlanHealthConfirmationScope({ ...input, exercises: changedExercises }),
    ))).toHaveLength(changes.length);
    for (const changedExercises of changes) {
      expect(
        buildHypertrophyPlanHealthConfirmationScope({ ...input, exercises: changedExercises }),
      ).not.toBe(original);
    }
  });

  it("independently binds every warning, identity, preview, policy, and context field", () => {
    const candidate = draft();
    candidate.sessions[0]!.exercises.push(
      structuredClone(candidate.sessions[0]!.exercises[0]!),
    );
    const exercises = (exerciseRows as HypertrophyPlanDraftExerciseRow[]).map((row) =>
      toAuthoringExercise(row),
    );
    const health = availableHealthFor(candidate);
    const warning = health.issues.find((issue) => issue.tier === "IMPORTANT_WARNING")!;
    const eligiblePreview = {
      status: "ELIGIBLE" as const,
      reasons: [] as [],
      hash: "a".repeat(64),
      hashAlgorithm: "sha256" as const,
      normalizedPlan: {} as never,
      executablePlan: {} as never,
    };
    const base: Parameters<typeof buildHypertrophyPlanHealthConfirmationScope>[0] = {
      policyVersion: health.policyVersion as string,
      draftId: "plan-1",
      draftRevision: 3,
      draft: candidate,
      preview: eligiblePreview,
      importantWarnings: [warning],
      exercises,
      limitations: { recognizedTags: [], unrecognizedTexts: [] },
    };
    const original = buildHypertrophyPlanHealthConfirmationScope(base);
    const warningChange = (
      update: Partial<(typeof base.importantWarnings)[number]>,
    ) => [{ ...warning, ...update }];
    const changedDraft = structuredClone(candidate);
    changedDraft.sessions[0]!.exercises[0]!.workingSets += 1;
    const changedSettings = structuredClone(candidate);
    changedSettings.settings.sessionDurationMinutes = 75;
    const selectedCatalog = exercises.map((exercise) =>
      exercise.id === "bench" ? { ...exercise, timePerSetSec: 181 } : exercise,
    );
    const cases: Array<[string, Partial<typeof base>]> = [
      ["warning code", { importantWarnings: warningChange({ code: "OTHER_WARNING" }) }],
      ["warning tier", { importantWarnings: warningChange({ tier: "COACHING_OBSERVATION" }) }],
      ["warning title", { importantWarnings: warningChange({ title: "Other title" }) }],
      ["warning explanation", { importantWarnings: warningChange({ explanation: "Other explanation" }) }],
      ["recommended action", { importantWarnings: warningChange({ suggestedAction: "Other action" }) }],
      ["affected session", { importantWarnings: warningChange({ affected: { session: "Lower" } }) }],
      ["affected exercise", { importantWarnings: warningChange({ affected: { exercise: "Leg Curl" } }) }],
      ["affected muscle", { importantWarnings: warningChange({ affected: { muscle: "Chest" } }) }],
      ["blocks flag", { importantWarnings: warningChange({ blocksFinalization: true }) }],
      ["acknowledgment flag", { importantWarnings: warningChange({ requiresAcknowledgment: false }) }],
      ["plan identity / cross-plan replay", { draftId: "plan-2" }],
      ["persisted revision", { draftRevision: 4 }],
      ["prescription hash", { draft: changedDraft }],
      ["settings hash", { draft: changedSettings }],
      ["preview eligibility", { preview: { status: "INELIGIBLE", reasons: [{ code: "MEASUREMENT_UNRESOLVED", message: "x", slotId: "upper" }] } }],
      ["preview hash", { preview: { ...eligiblePreview, hash: "b".repeat(64) } }],
      ["preview algorithm", { preview: { ...eligiblePreview, hashAlgorithm: "sha512" } as never }],
      ["policy version", { policyVersion: "draft-plan-health.v3" }],
      ["equipment", { draft: { ...candidate, settings: { ...candidate.settings, equipmentProfile: "BARBELL_HOME" } } }],
      ["recognized limitations", { limitations: { recognizedTags: ["wrist"], unrecognizedTexts: [] } }],
      ["unrecognized limitations", { limitations: { recognizedTags: [], unrecognizedTexts: ["private free text"] } }],
      ["selected catalog", { exercises: selectedCatalog }],
      ["same warning count, different content", { importantWarnings: warningChange({ code: "SAME_COUNT_OTHER" }) }],
    ];

    for (const [label, change] of cases) {
      expect(
        buildHypertrophyPlanHealthConfirmationScope({ ...base, ...change }),
        label,
      ).not.toBe(original);
    }

    const ineligibleReason = {
      code: "MEASUREMENT_UNRESOLVED" as const,
      message: "x",
      slotId: "upper",
      placementId: "placement-a",
    };
    const ineligibleBase: Parameters<
      typeof buildHypertrophyPlanHealthConfirmationScope
    >[0] = {
      ...base,
      preview: {
        status: "INELIGIBLE" as const,
        reasons: [ineligibleReason],
      },
    };
    expect(
      buildHypertrophyPlanHealthConfirmationScope({
        ...ineligibleBase,
        preview: {
          status: "INELIGIBLE",
          reasons: [{ ...ineligibleReason, placementId: "placement-b" }],
        },
      }),
    ).not.toBe(buildHypertrophyPlanHealthConfirmationScope(ineligibleBase));
  });

  it("keeps fallback warning scopes distinct across muscle identities", () => {
    const candidate = draft();
    const exercises = (exerciseRows as HypertrophyPlanDraftExerciseRow[]).map((row) =>
      toAuthoringExercise(row),
    );
    const warningFor = (muscleId: "chest" | "triceps") => {
      const assessment = buildHypertrophyPlanHealthAssessment({
        draftId: "plan-1",
        draftRevision: 3,
        evaluatedWeek: 1,
        health: {
          blockers: [],
          warnings: [{ code: "UNKNOWN_ADVISORY", message: "Review coverage.", muscleId }],
          muscles: [],
          sessions: [],
        },
        catalogExerciseCount: exercises.length,
        equipmentProfile: candidate.settings.equipmentProfile,
        recognizedLimitationCount: 0,
        unrecognizedLimitationsPresent: false,
        sessionNameBySlotId: new Map(),
        exerciseNameById: new Map(),
      });
      return assessment.issues.filter((issue) => issue.tier === "IMPORTANT_WARNING");
    };
    const scopeFor = (muscleId: "chest" | "triceps") =>
      buildHypertrophyPlanHealthConfirmationScope({
        policyVersion: "draft-plan-health.v2",
        draftId: "plan-1",
        draftRevision: 3,
        draft: candidate,
        preview: null,
        importantWarnings: warningFor(muscleId),
        exercises,
        limitations: { recognizedTags: [], unrecognizedTexts: [] },
      });

    expect(scopeFor("chest")).not.toBe(scopeFor("triceps"));
  });

  it("rejects a missing warning scope with zero writes and returns current Health", async () => {
    const duplicateDraft = draft();
    duplicateDraft.sessions[0]!.exercises.push(
      structuredClone(duplicateDraft.sessions[0]!.exercises[0]!),
    );
    mocks.state.draft = { payload: duplicateDraft, revision: 3 };
    mocks.tx.macroCycle.findFirst.mockResolvedValue({
      id: "plan-1",
      trainingAge: "INTERMEDIATE",
      hypertrophyDraft: mocks.state.draft,
      mesocycles: [],
    });

    await expect(
      makeHypertrophyPlanReady({
        userId: "user-1",
        planId: "plan-1",
        expectedDraftRevision: 3,
      }),
    ).rejects.toMatchObject({
      code: "PLAN_WARNING_CONFIRMATION_REQUIRED",
      details: { warningCount: "1", confirmationStatus: "MISSING" },
      responseData: {
        health: {
          status: "AVAILABLE",
          draftId: "plan-1",
          draftRevision: 3,
          confirmationScope: expect.stringMatching(
            /^plan-health-confirmation\.v1\.[a-f0-9]{64}$/,
          ),
        },
      },
    });
    expect(mocks.state.draft).toEqual({ payload: duplicateDraft, revision: 3 });
    expect(mocks.state.mesocycles).toEqual([]);
    expect(mocks.state.revisions).toEqual([]);
    expect(mocks.state.planUpdates).toEqual([]);
  });

  it("accepts only the matching authoritative warning scope", async () => {
    const duplicateDraft = draft();
    duplicateDraft.sessions[0]!.exercises.push(
      structuredClone(duplicateDraft.sessions[0]!.exercises[0]!),
    );
    mocks.state.draft = { payload: duplicateDraft, revision: 3 };
    mocks.tx.macroCycle.findFirst.mockResolvedValue({
      id: "plan-1",
      trainingAge: "INTERMEDIATE",
      hypertrophyDraft: mocks.state.draft,
      mesocycles: [],
    });
    const health = availableHealthFor(duplicateDraft);

    await expect(
      makeHypertrophyPlanReady({
        userId: "user-1",
        planId: "plan-1",
        expectedDraftRevision: 3,
        warningConfirmationScope: health.confirmationScope,
      }),
    ).resolves.toMatchObject({ revisionId: "revision-1" });
  });

  it("rejects random and catalog-stale warning scopes with current Health and zero writes", async () => {
    const duplicateDraft = draft();
    duplicateDraft.sessions[0]!.exercises.push(
      structuredClone(duplicateDraft.sessions[0]!.exercises[0]!),
    );
    mocks.state.draft = { payload: duplicateDraft, revision: 3 };
    mocks.tx.macroCycle.findFirst.mockResolvedValue({
      id: "plan-1",
      trainingAge: "INTERMEDIATE",
      hypertrophyDraft: mocks.state.draft,
      mesocycles: [],
    });
    const presented = availableHealthFor(duplicateDraft);
    const driftedRows = (exerciseRows as HypertrophyPlanDraftExerciseRow[]).map(
      (row, index) =>
        index === 0 ? { ...row, timePerSetSec: row.timePerSetSec + 1 } : row,
    );
    mocks.tx.exercise.findMany.mockResolvedValue(driftedRows);

    for (const warningConfirmationScope of [
      `plan-health-confirmation.v1.${"f".repeat(64)}`,
      presented.confirmationScope,
    ]) {
      await expect(
        makeHypertrophyPlanReady({
          userId: "user-1",
          planId: "plan-1",
          expectedDraftRevision: 3,
          warningConfirmationScope,
        }),
      ).rejects.toMatchObject({
        code: "PLAN_WARNING_CONFIRMATION_REQUIRED",
        details: { confirmationStatus: "MISMATCH" },
        responseData: {
          health: {
            confirmationScope: expect.not.stringMatching(
              new RegExp(presented.confirmationScope),
            ),
          },
        },
      });
      expect(mocks.state.mesocycles).toEqual([]);
      expect(mocks.state.revisions).toEqual([]);
      expect(mocks.state.planUpdates).toEqual([]);
      expect(mocks.state.draft).toEqual({ payload: duplicateDraft, revision: 3 });
    }
  });

  it("rejects each independently stale scope through finalization with current Health and zero writes", async () => {
    const duplicateDraft = draft();
    duplicateDraft.sessions[0]!.exercises.push(
      structuredClone(duplicateDraft.sessions[0]!.exercises[0]!),
    );
    mocks.state.draft = { payload: duplicateDraft, revision: 3 };
    mocks.tx.macroCycle.findFirst.mockResolvedValue({
      id: "plan-1",
      trainingAge: "INTERMEDIATE",
      hypertrophyDraft: mocks.state.draft,
      mesocycles: [],
    });
    const rows = exerciseRows as HypertrophyPlanDraftExerciseRow[];
    const exercises = rows.map((row) => toAuthoringExercise(row));
    const current = availableHealthFor(duplicateDraft);
    const warning = current.issues.find((issue) => issue.tier === "IMPORTANT_WARNING")!;
    const base = {
      policyVersion: current.policyVersion as string,
      draftId: "plan-1",
      draftRevision: 3,
      draft: duplicateDraft,
      preview: null,
      importantWarnings: [warning],
      exercises,
      limitations: { recognizedTags: [], unrecognizedTexts: [] },
    } satisfies Parameters<typeof buildHypertrophyPlanHealthConfirmationScope>[0];
    const changedDraft = structuredClone(duplicateDraft);
    changedDraft.sessions[0]!.exercises[0]!.workingSets += 1;
    const changedWarning = [{ ...warning, explanation: "Stale warning explanation" }];
    const changedCatalog = exercises.map((exercise) =>
      exercise.id === "bench" ? { ...exercise, timePerSetSec: 181 } : exercise,
    );
    const staleScopes = [
      buildHypertrophyPlanHealthConfirmationScope({ ...base, policyVersion: "draft-plan-health.v1" }),
      buildHypertrophyPlanHealthConfirmationScope({ ...base, draftId: "plan-2" }),
      buildHypertrophyPlanHealthConfirmationScope({ ...base, draftRevision: 2 }),
      buildHypertrophyPlanHealthConfirmationScope({ ...base, draft: changedDraft }),
      buildHypertrophyPlanHealthConfirmationScope({ ...base, importantWarnings: changedWarning }),
      buildHypertrophyPlanHealthConfirmationScope({ ...base, exercises: changedCatalog }),
      buildHypertrophyPlanHealthConfirmationScope({
        ...base,
        limitations: { recognizedTags: ["wrist"], unrecognizedTexts: [] },
      }),
      buildHypertrophyPlanHealthConfirmationScope({
        ...base,
        limitations: { recognizedTags: [], unrecognizedTexts: ["stale private text"] },
      }),
    ];

    for (const warningConfirmationScope of staleScopes) {
      expect(warningConfirmationScope).not.toBe(current.confirmationScope);
      await expect(
        makeHypertrophyPlanReady({
          userId: "user-1",
          planId: "plan-1",
          expectedDraftRevision: 3,
          warningConfirmationScope,
        }),
      ).rejects.toMatchObject({
        code: "PLAN_WARNING_CONFIRMATION_REQUIRED",
        details: { confirmationStatus: "MISMATCH" },
        responseData: {
          health: {
            draftId: "plan-1",
            draftRevision: 3,
            confirmationScope: current.confirmationScope,
          },
        },
      });
      expect(mocks.state.draft).toEqual({ payload: duplicateDraft, revision: 3 });
      expect(mocks.state.mesocycles).toEqual([]);
      expect(mocks.state.revisions).toEqual([]);
      expect(mocks.state.planUpdates).toEqual([]);
    }
  });

  it("invalidates a warning scope when authoritative limitation context drifts", async () => {
    const duplicateDraft = draft();
    duplicateDraft.sessions[0]!.exercises.push(
      structuredClone(duplicateDraft.sessions[0]!.exercises[0]!),
    );
    mocks.state.draft = { payload: duplicateDraft, revision: 3 };
    mocks.tx.macroCycle.findFirst.mockResolvedValue({
      id: "plan-1",
      trainingAge: "INTERMEDIATE",
      hypertrophyDraft: mocks.state.draft,
      mesocycles: [],
    });
    const presented = availableHealthFor(duplicateDraft);
    mocks.tx.injury.findMany.mockResolvedValue([{ bodyPart: "wrist" }]);

    await expect(
      makeHypertrophyPlanReady({
        userId: "user-1",
        planId: "plan-1",
        expectedDraftRevision: 3,
        warningConfirmationScope: presented.confirmationScope,
      }),
    ).rejects.toMatchObject({
      code: "PLAN_WARNING_CONFIRMATION_REQUIRED",
      details: { confirmationStatus: "MISMATCH" },
      responseData: {
        health: {
          summary: { importantWarnings: 1 },
          confirmationScope: expect.not.stringMatching(
            new RegExp(presented.confirmationScope),
          ),
        },
      },
    });
    expect(mocks.state.mesocycles).toEqual([]);
    expect(mocks.state.revisions).toEqual([]);
    expect(mocks.state.planUpdates).toEqual([]);
    expect(mocks.state.draft).toEqual({ payload: duplicateDraft, revision: 3 });
  });

  it("emits V3 only when the gate is enabled and every selected exercise is classified", async () => {
    process.env.TRAINER_EXERCISE_MEASUREMENT_ROLLOUT = "enabled";
    mocks.tx.exercise.findMany.mockResolvedValue(
      exerciseRows.map((row) => ({
        ...row,
        measurementProfile: "REPS_EXTERNAL_LOAD",
        loadConvention: row.id === "bench" ? "BARBELL_TOTAL" : "MACHINE_DISPLAYED",
        repBasis: "TOTAL",
      })),
    );

    await makeHypertrophyPlanReady({
      userId: "user-1",
      planId: "plan-1",
      expectedDraftRevision: 3,
    });

    expect(mocks.state.revisions[0]).toMatchObject({
      seedPayload: {
        version: 3,
        settings: draft().settings,
        slots: [
          {
            name: "Upper",
            focus: "UPPER",
            exercises: [
              {
                measurement: {
                  profile: "REPS_EXTERNAL_LOAD",
                  loadConvention: "BARBELL_TOTAL",
                  repBasis: "TOTAL",
                },
              },
            ],
          },
          {
            name: "Lower",
            focus: "LOWER",
            exercises: [
              {
                measurement: {
                  profile: "REPS_EXTERNAL_LOAD",
                  loadConvention: "MACHINE_DISPLAYED",
                  repBasis: "TOTAL",
                },
              },
            ],
          },
        ],
      },
    });
  });

  it("keeps a mixed classified plan on accepted V2 even when the gate is enabled", async () => {
    process.env.TRAINER_EXERCISE_MEASUREMENT_ROLLOUT = "enabled";
    mocks.tx.exercise.findMany.mockResolvedValue(
      exerciseRows.map((row) =>
        row.id === "bench"
          ? {
              ...row,
              measurementProfile: "REPS_EXTERNAL_LOAD",
              loadConvention: "BARBELL_TOTAL",
              repBasis: "TOTAL",
            }
          : {
              ...row,
              measurementProfile: null,
              loadConvention: null,
              repBasis: null,
            },
      ),
    );

    await makeHypertrophyPlanReady({
      userId: "user-1",
      planId: "plan-1",
      expectedDraftRevision: 3,
    });

    expect(mocks.state.revisions[0]).toMatchObject({
      seedPayload: { version: 2 },
    });
  });

  it("preserves the low-axial semantic through make-ready acceptance", async () => {
    const constrainedDraft = lowAxialDraft();
    mocks.state.draft = { payload: constrainedDraft, revision: 3 };
    mocks.tx.macroCycle.findFirst.mockResolvedValue({
      id: "plan-1",
      trainingAge: "INTERMEDIATE",
      hypertrophyDraft: mocks.state.draft,
      mesocycles: [],
    });

    await makeHypertrophyPlanReady({
      userId: "user-1",
      planId: "plan-1",
      expectedDraftRevision: 3,
    });

    expect(mocks.state.revisions[0]).toMatchObject({
      seedPayload: {
        slots: [
          expect.anything(),
          {
            exercises: [
              {
                intent: {
                  requiredExerciseClass: "low_axial_hip_extension_anchor",
                },
              },
            ],
          },
        ],
      },
    });
  });

  it("rolls back accepted writes and preserves the exact draft after a delete CAS miss", async () => {
    const before = structuredClone(mocks.state.draft);
    mocks.tx.hypertrophyPlanDraft.deleteMany.mockResolvedValue({ count: 0 });
    await expect(
      makeHypertrophyPlanReady({
        userId: "user-1",
        planId: "plan-1",
        expectedDraftRevision: 3,
      }),
    ).rejects.toMatchObject({ code: "PLAN_MUTATION_CONFLICT" });
    expect(mocks.state.draft).toEqual(before);
    expect(mocks.state.mesocycles).toEqual([]);
    expect(mocks.state.revisions).toEqual([]);
    expect(mocks.state.planUpdates).toEqual([]);
  });

  it("reconstructs editable-copy intent only from the accepted revision", async () => {
    const copiedDraft = lowAxialDraft();
    const accepted = {
      version: 2,
      source: "custom_hypertrophy_plan_v1",
      settings: copiedDraft.settings,
      slots: copiedDraft.sessions.map((session) => ({
        slotId: session.slotId,
        name: session.name,
        focus: session.focus,
        exercises: session.exercises.map((exercise) => ({
          exerciseId: exercise.exerciseId,
          role:
            exercise.intent.userRole === "PRIMARY_LIFT"
              ? "CORE_COMPOUND"
              : "ACCESSORY",
          setCount: exercise.workingSets,
          intent: exercise.intent,
        })),
      })),
    };
    mocks.prisma.macroCycle.findFirst.mockResolvedValueOnce({
      trainingAge: "INTERMEDIATE",
      mesocycles: [{ currentSeedRevision: { seedPayload: accepted } }],
    });
    mocks.prisma.macroCycle.create.mockResolvedValue({});
    await createEditableHypertrophyPlanCopy({
      userId: "user-1",
      sourcePlanId: "source-plan",
      name: "Editable copy",
    });
    const createInput = mocks.prisma.macroCycle.create.mock.calls[0]![0];
    expect(createInput.data.hypertrophyDraft.create.payload).toEqual(copiedDraft);
    expect(createInput.data.hypertrophyDraft.create.payload.sessions[0].exercises[0].intent)
      .toEqual(copiedDraft.sessions[0]!.exercises[0]!.intent);
    expect(
      createInput.data.hypertrophyDraft.create.payload.sessions[1].exercises[0]
        .intent.requiredExerciseClass,
    ).toBe("low_axial_hip_extension_anchor");
    expect(createInput.data).not.toHaveProperty("mesocycles");
  });

  it("preserves the complete editable envelope when copying accepted V3", async () => {
    const copiedDraft = lowAxialDraft();
    const accepted = {
      version: 3,
      source: "custom_hypertrophy_plan_v1",
      settings: copiedDraft.settings,
      slots: copiedDraft.sessions.map((session) => ({
        slotId: session.slotId,
        name: session.name,
        focus: session.focus,
        exercises: session.exercises.map((exercise) => ({
          exerciseId: exercise.exerciseId,
          role:
            exercise.intent.userRole === "PRIMARY_LIFT"
              ? "CORE_COMPOUND"
              : "ACCESSORY",
          setCount: exercise.workingSets,
          intent: exercise.intent,
          measurement: {
            profile: "REPS_EXTERNAL_LOAD",
            loadConvention: "BARBELL_TOTAL",
            repBasis: "TOTAL",
          },
        })),
      })),
    };
    mocks.prisma.macroCycle.findFirst.mockResolvedValueOnce({
      trainingAge: "INTERMEDIATE",
      mesocycles: [{ currentSeedRevision: { seedPayload: accepted } }],
    });
    mocks.prisma.macroCycle.create.mockResolvedValue({});

    await createEditableHypertrophyPlanCopy({
      userId: "user-1",
      sourcePlanId: "source-plan",
      name: "Editable V3 copy",
    });

    const createInput = mocks.prisma.macroCycle.create.mock.calls[0]![0];
    expect(createInput.data.hypertrophyDraft.create.payload).toEqual(copiedDraft);
    expect(createInput.data.hypertrophyDraft.create.payload.settings).toEqual(
      copiedDraft.settings,
    );
    expect(
      createInput.data.hypertrophyDraft.create.payload.sessions.map(
        (session: { slotId: string; name: string; focus: string }) => ({
          slotId: session.slotId,
          name: session.name,
          focus: session.focus,
        }),
      ),
    ).toEqual(
      copiedDraft.sessions.map((session) => ({
        slotId: session.slotId,
        name: session.name,
        focus: session.focus,
      })),
    );
    expect(
      createInput.data.hypertrophyDraft.create.payload.sessions[1].exercises[0]
        .intent.requiredExerciseClass,
    ).toBe("low_axial_hip_extension_anchor");
  });

  it.each([
    { version: 3, source: "custom_hypertrophy_plan_v1", slots: [] },
    { version: 4, source: "custom_hypertrophy_plan_v1", slots: [] },
  ])("rejects an invalid accepted copy source before creating a draft", async (seedPayload) => {
    mocks.prisma.macroCycle.findFirst.mockResolvedValueOnce({
      trainingAge: "INTERMEDIATE",
      mesocycles: [{ currentSeedRevision: { seedPayload } }],
    });

    await expect(
      createEditableHypertrophyPlanCopy({
        userId: "user-1",
        sourcePlanId: "source-plan",
        name: "Invalid copy",
      }),
    ).rejects.toMatchObject({ code: "PLAN_COPY_UNAVAILABLE" });
    expect(mocks.prisma.macroCycle.create).not.toHaveBeenCalled();
  });
});
