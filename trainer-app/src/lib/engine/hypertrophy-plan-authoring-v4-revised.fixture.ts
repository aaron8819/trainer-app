import type { MeasurementSemantics } from "@/lib/exercise-measurement/semantics";
import type {
  AcceptedHypertrophySeedV4,
  HypertrophyPlanDraftV2,
  WeeklyPrescriptionV4,
} from "./hypertrophy-plan-authoring";

const referenceMeasurements = {
  barbell: {
    profile: "REPS_EXTERNAL_LOAD",
    loadConvention: "BARBELL_TOTAL",
    repBasis: "TOTAL",
  },
  implement: {
    profile: "REPS_EXTERNAL_LOAD",
    loadConvention: "IMPLEMENT_WEIGHT",
    repBasis: "TOTAL",
  },
  implementPerSide: {
    profile: "REPS_EXTERNAL_LOAD",
    loadConvention: "IMPLEMENT_WEIGHT",
    repBasis: "PER_SIDE",
  },
  machine: {
    profile: "REPS_EXTERNAL_LOAD",
    loadConvention: "MACHINE_DISPLAYED",
    repBasis: "TOTAL",
  },
  bodyweight: {
    profile: "REPS_BODYWEIGHT",
    repBasis: "TOTAL",
  },
} as const satisfies Record<string, MeasurementSemantics>;

type ReferencePrescription = {
  setCount: number;
  reps: { min: number; max: number };
  deloadSetCount?: number;
  omitDeload?: boolean;
};

function referencePrescriptions(input: ReferencePrescription): WeeklyPrescriptionV4[] {
  const accumulationRir = [[3, 4], [3, 3], [2, 3], [1, 2]] as const;
  const prescriptions: WeeklyPrescriptionV4[] = accumulationRir.map(([min, max], index) => ({
    week: index + 1,
    status: "PRESCRIBE",
    setCount: input.setCount,
    reps: { kind: "RANGE", ...input.reps },
    rir: { kind: "TARGET_RANGE", min, max },
  }));
  prescriptions.push(input.omitDeload
    ? { week: 5, status: "OMIT" }
    : {
        week: 5,
        status: "PRESCRIBE",
        setCount: input.deloadSetCount ?? Math.max(1, input.setCount - 1),
        reps: { kind: "RANGE", ...input.reps },
        rir: { kind: "TARGET_RANGE", min: 4, max: 5 },
      });
  return prescriptions;
}
const referencePrescription = {
  fourByFourToSix: referencePrescriptions({ setCount: 4, reps: { min: 4, max: 6 }, deloadSetCount: 2 }),
  fourByFiveToEight: referencePrescriptions({ setCount: 4, reps: { min: 5, max: 8 }, deloadSetCount: 2 }),
  fourBySixToTen: referencePrescriptions({ setCount: 4, reps: { min: 6, max: 10 }, deloadSetCount: 2 }),
  threeByFiveToEight: referencePrescriptions({ setCount: 3, reps: { min: 5, max: 8 }, deloadSetCount: 2 }),
  threeBySixToTen: referencePrescriptions({ setCount: 3, reps: { min: 6, max: 10 } }),
  threeByEightToTwelve: referencePrescriptions({ setCount: 3, reps: { min: 8, max: 12 } }),
  threeByTenToFifteen: referencePrescriptions({ setCount: 3, reps: { min: 10, max: 15 }, deloadSetCount: 1 }),
  threeByTenToFifteenDeloadTwo: referencePrescriptions({ setCount: 3, reps: { min: 10, max: 15 }, deloadSetCount: 2 }),
  twoByEightToTwelve: referencePrescriptions({ setCount: 2, reps: { min: 8, max: 12 }, deloadSetCount: 1 }),
  twoByTwelveToTwentyOmit: referencePrescriptions({ setCount: 2, reps: { min: 12, max: 20 }, omitDeload: true }),
  threeByEightToFifteenOmit: referencePrescriptions({ setCount: 3, reps: { min: 8, max: 15 }, omitDeload: true }),
  threeByTwelveToTwenty: referencePrescriptions({ setCount: 3, reps: { min: 12, max: 20 }, deloadSetCount: 1 }),
} as const;

type ReferenceExercise = AcceptedHypertrophySeedV4["slots"][number]["exercises"][number];

function movementExercise(input: {
  placementId: string;
  exerciseId: string;
  role: ReferenceExercise["role"];
  userRole: "PRIMARY_LIFT" | "SECONDARY_LIFT";
  movementPattern: Extract<ReferenceExercise["intent"]["target"], { kind: "movement_pattern" }>["movementPattern"];
  measurement: MeasurementSemantics;
  prescriptions: WeeklyPrescriptionV4[];
}): ReferenceExercise {
  return {
    placementId: input.placementId,
    exerciseId: input.exerciseId,
    role: input.role,
    intent: {
      userRole: input.userRole,
      target: { kind: "movement_pattern", movementPattern: input.movementPattern },
    },
    measurement: input.measurement,
    prescriptions: input.prescriptions,
  };
}

function isolationExercise(input: {
  placementId: string;
  exerciseId: string;
  muscleId: Extract<ReferenceExercise["intent"]["target"], { kind: "muscle" }>["muscleId"];
  measurement: MeasurementSemantics;
  prescriptions: WeeklyPrescriptionV4[];
}): ReferenceExercise {
  return {
    placementId: input.placementId,
    exerciseId: input.exerciseId,
    role: "ACCESSORY",
    intent: {
      userRole: "MUSCLE_ISOLATION",
      target: { kind: "muscle", muscleId: input.muscleId },
    },
    measurement: input.measurement,
    prescriptions: input.prescriptions,
  };
}

export function buildRevisedFourDayPlanAcceptedSeed(): AcceptedHypertrophySeedV4 {
  const m = referenceMeasurements;
  const p = referencePrescription;
  return structuredClone({
    version: 4,
    source: "custom_hypertrophy_plan_v2",
    settings: { equipmentProfile: "FULL_GYM", sessionDurationMinutes: 60 },
    weeks: [1, 2, 3, 4, 5].map((week) => ({
      week,
      phase: week === 5 ? "DELOAD" as const : "ACCUMULATION" as const,
    })),
    slots: [
      {
        slotId: "lower-a", name: "Lower A", focus: "LOWER",
        exercises: [
          movementExercise({ placementId: "lower-a-1", exerciseId: "Barbell Back Squat", role: "CORE_COMPOUND", userRole: "PRIMARY_LIFT", movementPattern: "squat", measurement: m.barbell, prescriptions: p.fourByFiveToEight }),
          movementExercise({ placementId: "lower-a-2", exerciseId: "Leg Press", role: "ACCESSORY", userRole: "SECONDARY_LIFT", movementPattern: "squat", measurement: m.machine, prescriptions: p.threeByEightToTwelve }),
          movementExercise({ placementId: "lower-a-3", exerciseId: "Barbell Romanian Deadlift", role: "ACCESSORY", userRole: "SECONDARY_LIFT", movementPattern: "hinge", measurement: m.barbell, prescriptions: p.threeBySixToTen }),
          isolationExercise({ placementId: "lower-a-4", exerciseId: "Lying Leg Curl", muscleId: "hamstrings", measurement: m.machine, prescriptions: p.threeByTenToFifteen }),
          isolationExercise({ placementId: "lower-a-5", exerciseId: "Hip Abduction Machine", muscleId: "abductors", measurement: m.machine, prescriptions: p.twoByTwelveToTwentyOmit }),
          isolationExercise({ placementId: "lower-a-6", exerciseId: "Cable Crunch", muscleId: "abs", measurement: m.machine, prescriptions: p.threeByEightToFifteenOmit }),
        ],
      },
      {
        slotId: "upper-a", name: "Upper A", focus: "UPPER",
        exercises: [
          movementExercise({ placementId: "upper-a-1", exerciseId: "Barbell Bench Press", role: "CORE_COMPOUND", userRole: "PRIMARY_LIFT", movementPattern: "horizontal_push", measurement: m.barbell, prescriptions: p.fourByFiveToEight }),
          movementExercise({ placementId: "upper-a-2", exerciseId: "Pull-Up", role: "ACCESSORY", userRole: "SECONDARY_LIFT", movementPattern: "vertical_pull", measurement: m.bodyweight, prescriptions: p.fourBySixToTen }),
          movementExercise({ placementId: "upper-a-3", exerciseId: "Incline Dumbbell Bench Press", role: "ACCESSORY", userRole: "SECONDARY_LIFT", movementPattern: "horizontal_push", measurement: m.implement, prescriptions: p.threeByEightToTwelve }),
          movementExercise({ placementId: "upper-a-4", exerciseId: "Chest-Supported Dumbbell Row", role: "ACCESSORY", userRole: "SECONDARY_LIFT", movementPattern: "horizontal_pull", measurement: m.implement, prescriptions: p.threeByEightToTwelve }),
          isolationExercise({ placementId: "upper-a-5", exerciseId: "Dumbbell Lateral Raise", muscleId: "side_delts", measurement: m.implement, prescriptions: p.threeByTenToFifteen }),
          isolationExercise({ placementId: "upper-a-6", exerciseId: "EZ-Bar Curl", muscleId: "biceps", measurement: m.barbell, prescriptions: p.threeByTenToFifteen }),
          isolationExercise({ placementId: "upper-a-7", exerciseId: "Cable Triceps Pushdown", muscleId: "triceps", measurement: m.machine, prescriptions: p.threeByTenToFifteen }),
        ],
      },
      {
        slotId: "lower-b", name: "Lower B — Strength Development", focus: "LOWER",
        exercises: [
          movementExercise({ placementId: "lower-b-1", exerciseId: "Conventional Deadlift", role: "CORE_COMPOUND", userRole: "PRIMARY_LIFT", movementPattern: "hinge", measurement: m.barbell, prescriptions: p.fourByFourToSix }),
          movementExercise({ placementId: "lower-b-2", exerciseId: "Hack Squat", role: "ACCESSORY", userRole: "SECONDARY_LIFT", movementPattern: "squat", measurement: m.machine, prescriptions: p.fourByFiveToEight }),
          movementExercise({ placementId: "lower-b-3", exerciseId: "Bulgarian Split Squat", role: "ACCESSORY", userRole: "SECONDARY_LIFT", movementPattern: "lunge", measurement: m.implementPerSide, prescriptions: p.twoByEightToTwelve }),
          isolationExercise({ placementId: "lower-b-4", exerciseId: "Seated Leg Curl", muscleId: "hamstrings", measurement: m.machine, prescriptions: p.threeByTenToFifteen }),
          isolationExercise({ placementId: "lower-b-5", exerciseId: "Seated Calf Raise", muscleId: "calves", measurement: m.machine, prescriptions: p.threeByTenToFifteenDeloadTwo }),
          isolationExercise({ placementId: "lower-b-6", exerciseId: "Machine Crunch", muscleId: "abs", measurement: m.machine, prescriptions: p.threeByEightToFifteenOmit }),
        ],
      },
      {
        slotId: "upper-b", name: "Upper B", focus: "UPPER",
        exercises: [
          movementExercise({ placementId: "upper-b-1", exerciseId: "Chest-Supported Dumbbell Row", role: "ACCESSORY", userRole: "SECONDARY_LIFT", movementPattern: "horizontal_pull", measurement: m.implement, prescriptions: p.fourBySixToTen }),
          movementExercise({ placementId: "upper-b-2", exerciseId: "Lat Pulldown", role: "ACCESSORY", userRole: "SECONDARY_LIFT", movementPattern: "vertical_pull", measurement: m.machine, prescriptions: p.threeByEightToTwelve }),
          movementExercise({ placementId: "upper-b-3", exerciseId: "Dumbbell Overhead Press", role: "CORE_COMPOUND", userRole: "PRIMARY_LIFT", movementPattern: "vertical_push", measurement: m.implement, prescriptions: p.threeBySixToTen }),
          movementExercise({ placementId: "upper-b-4", exerciseId: "Dumbbell Bench Press", role: "ACCESSORY", userRole: "SECONDARY_LIFT", movementPattern: "horizontal_push", measurement: m.implement, prescriptions: p.threeByEightToTwelve }),
          isolationExercise({ placementId: "upper-b-5", exerciseId: "Reverse Pec Deck", muscleId: "rear_delts", measurement: m.machine, prescriptions: p.threeByTwelveToTwenty }),
          isolationExercise({ placementId: "upper-b-6", exerciseId: "Cable Curl", muscleId: "biceps", measurement: m.machine, prescriptions: p.threeByTenToFifteen }),
          isolationExercise({ placementId: "upper-b-7", exerciseId: "Overhead Cable Triceps Extension", muscleId: "triceps", measurement: m.machine, prescriptions: p.threeByTenToFifteen }),
        ],
      },
    ],
  });
}

export function buildRevisedFourDayPlanSubmittedDraft(): HypertrophyPlanDraftV2 {
  const input = buildRevisedFourDayPlanAcceptedSeed();
  return structuredClone({
    version: 2,
    settings: input.settings,
    weeks: input.weeks,
    sessions: input.slots.map(({ slotId, name, focus, exercises }) => ({
      slotId,
      name,
      focus,
      exercises: exercises.map(
        ({ placementId, exerciseId, intent, prescriptions }) => ({
          placementId,
          exerciseId,
          intent,
          prescriptions,
        }),
      ),
    })),
  });
}
