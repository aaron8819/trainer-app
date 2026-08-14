import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import catalog from "../../../prisma/exercises_comprehensive.json";
import type { MeasurementSemantics } from "@/lib/exercise-measurement/semantics";
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
  deriveHypertrophyPlanV4Preview,
  loadHypertrophyPlanEditorData,
  makeHypertrophyPlanReady,
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
      preview: { status: "ELIGIBLE", hash: expect.stringMatching(/^[a-f0-9]{64}$/) },
    });
    expect(mocks.tx.mesocycle.create).not.toHaveBeenCalled();
    expect(mocks.createRevision).not.toHaveBeenCalled();
    expect(mocks.tx.hypertrophyPlanDraft.updateMany).not.toHaveBeenCalled();
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
        warningsConfirmed: true,
      }),
    ).rejects.toMatchObject({ code: "PLAN_UNSUPPORTED_TOPOLOGY" });
    expect(mocks.tx.mesocycle.create).not.toHaveBeenCalled();
    expect(mocks.createRevision).not.toHaveBeenCalled();
    expect(mocks.tx.hypertrophyPlanDraft.deleteMany).not.toHaveBeenCalled();
    expect(mocks.tx.macroCycle.update).not.toHaveBeenCalled();
  });

  it("atomically accepts the exact five-week reference preview as revision 1", async () => {
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
        warningsConfirmed: true,
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
      warningsConfirmed: true,
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
        warningsConfirmed: true,
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
        warningsConfirmed: true,
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
        warningsConfirmed: true,
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
        warningsConfirmed: true,
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
    ).resolves.toEqual({
      revision: 4,
      updatedAt: "2026-08-05T12:00:00.000Z",
    });
    expect(mocks.tx.hypertrophyPlanDraft.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ payload: constrainedDraft }),
      }),
    );
  });

  it("atomically creates one accepted five-week plan and consumes its draft", async () => {
    const result = await makeHypertrophyPlanReady({
      userId: "user-1",
      planId: "plan-1",
      expectedDraftRevision: 3,
      warningsConfirmed: true,
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
      warningsConfirmed: true,
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
      warningsConfirmed: true,
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
      warningsConfirmed: true,
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
        warningsConfirmed: true,
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
