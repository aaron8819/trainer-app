import type { MeasurementSemantics } from "@/lib/exercise-measurement/semantics";
import type {
  AcceptedExerciseIntentV2,
  AcceptedHypertrophySeedV4,
  HypertrophyPlanDraftV2,
  HypertrophySessionFocus,
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
  threeByFiveToEight: referencePrescriptions({ setCount: 3, reps: { min: 5, max: 8 } }),
  threeBySixToTen: referencePrescriptions({ setCount: 3, reps: { min: 6, max: 10 } }),
  threeByEightToTwelve: referencePrescriptions({ setCount: 3, reps: { min: 8, max: 12 } }),
  threeByTenToFifteen: referencePrescriptions({ setCount: 3, reps: { min: 10, max: 15 }, deloadSetCount: 1 }),
  twoByTenToFifteen: referencePrescriptions({ setCount: 2, reps: { min: 10, max: 15 } }),
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

export function buildV4CustomPlanReferenceAcceptedSeed(): AcceptedHypertrophySeedV4 {
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
        slotId: "upper-a", name: "Upper A", focus: "UPPER",
        exercises: [
          movementExercise({ placementId: "upper-a-1", exerciseId: "Barbell Bench Press", role: "CORE_COMPOUND", userRole: "PRIMARY_LIFT", movementPattern: "horizontal_push", measurement: m.barbell, prescriptions: p.threeByFiveToEight }),
          movementExercise({ placementId: "upper-a-2", exerciseId: "Pull-Up", role: "ACCESSORY", userRole: "SECONDARY_LIFT", movementPattern: "vertical_pull", measurement: m.bodyweight, prescriptions: p.threeBySixToTen }),
          movementExercise({ placementId: "upper-a-3", exerciseId: "Incline Dumbbell Bench Press", role: "ACCESSORY", userRole: "SECONDARY_LIFT", movementPattern: "horizontal_push", measurement: m.implement, prescriptions: p.threeByEightToTwelve }),
          movementExercise({ placementId: "upper-a-4", exerciseId: "Chest-Supported Dumbbell Row", role: "ACCESSORY", userRole: "SECONDARY_LIFT", movementPattern: "horizontal_pull", measurement: m.implement, prescriptions: p.threeByEightToTwelve }),
          isolationExercise({ placementId: "upper-a-5", exerciseId: "Dumbbell Lateral Raise", muscleId: "side_delts", measurement: m.implement, prescriptions: p.threeByTenToFifteen }),
          isolationExercise({ placementId: "upper-a-6", exerciseId: "EZ-Bar Curl", muscleId: "biceps", measurement: m.barbell, prescriptions: p.threeByTenToFifteen }),
          isolationExercise({ placementId: "upper-a-7", exerciseId: "Cable Triceps Pushdown", muscleId: "triceps", measurement: m.machine, prescriptions: p.twoByTenToFifteen }),
        ],
      },
      {
        slotId: "lower-a", name: "Lower A", focus: "LOWER",
        exercises: [
          movementExercise({ placementId: "lower-a-1", exerciseId: "Barbell Back Squat", role: "CORE_COMPOUND", userRole: "PRIMARY_LIFT", movementPattern: "squat", measurement: m.barbell, prescriptions: p.threeByFiveToEight }),
          movementExercise({ placementId: "lower-a-2", exerciseId: "Leg Press", role: "ACCESSORY", userRole: "SECONDARY_LIFT", movementPattern: "squat", measurement: m.machine, prescriptions: p.threeByEightToTwelve }),
          movementExercise({ placementId: "lower-a-3", exerciseId: "Barbell Romanian Deadlift", role: "ACCESSORY", userRole: "SECONDARY_LIFT", movementPattern: "hinge", measurement: m.barbell, prescriptions: p.threeBySixToTen }),
          isolationExercise({ placementId: "lower-a-4", exerciseId: "Lying Leg Curl", muscleId: "hamstrings", measurement: m.machine, prescriptions: p.twoByTenToFifteen }),
          isolationExercise({ placementId: "lower-a-5", exerciseId: "Hip Abduction Machine", muscleId: "abductors", measurement: m.machine, prescriptions: p.twoByTwelveToTwentyOmit }),
          isolationExercise({ placementId: "lower-a-6", exerciseId: "Cable Crunch", muscleId: "abs", measurement: m.machine, prescriptions: p.threeByEightToFifteenOmit }),
        ],
      },
      {
        slotId: "upper-b", name: "Upper B", focus: "UPPER",
        exercises: [
          movementExercise({ placementId: "upper-b-1", exerciseId: "Chest-Supported Dumbbell Row", role: "ACCESSORY", userRole: "SECONDARY_LIFT", movementPattern: "horizontal_pull", measurement: m.implement, prescriptions: p.threeByEightToTwelve }),
          movementExercise({ placementId: "upper-b-2", exerciseId: "Lat Pulldown", role: "ACCESSORY", userRole: "SECONDARY_LIFT", movementPattern: "vertical_pull", measurement: m.machine, prescriptions: p.threeByEightToTwelve }),
          movementExercise({ placementId: "upper-b-3", exerciseId: "Dumbbell Overhead Press", role: "CORE_COMPOUND", userRole: "PRIMARY_LIFT", movementPattern: "vertical_push", measurement: m.implement, prescriptions: p.threeBySixToTen }),
          isolationExercise({ placementId: "upper-b-4", exerciseId: "Reverse Pec Deck", muscleId: "rear_delts", measurement: m.machine, prescriptions: p.threeByTwelveToTwenty }),
          movementExercise({ placementId: "upper-b-5", exerciseId: "Dumbbell Bench Press", role: "ACCESSORY", userRole: "SECONDARY_LIFT", movementPattern: "horizontal_push", measurement: m.implement, prescriptions: p.threeByEightToTwelve }),
          isolationExercise({ placementId: "upper-b-6", exerciseId: "Cable Curl", muscleId: "biceps", measurement: m.machine, prescriptions: p.threeByTenToFifteen }),
          isolationExercise({ placementId: "upper-b-7", exerciseId: "Overhead Cable Triceps Extension", muscleId: "triceps", measurement: m.machine, prescriptions: p.twoByTenToFifteen }),
        ],
      },
      {
        slotId: "lower-b", name: "Lower B", focus: "LOWER",
        exercises: [
          movementExercise({ placementId: "lower-b-1", exerciseId: "Dumbbell Romanian Deadlift", role: "CORE_COMPOUND", userRole: "PRIMARY_LIFT", movementPattern: "hinge", measurement: m.implement, prescriptions: p.threeBySixToTen }),
          movementExercise({ placementId: "lower-b-2", exerciseId: "Goblet Squat", role: "ACCESSORY", userRole: "SECONDARY_LIFT", movementPattern: "squat", measurement: m.implement, prescriptions: p.threeByEightToTwelve }),
          movementExercise({ placementId: "lower-b-3", exerciseId: "Bulgarian Split Squat", role: "ACCESSORY", userRole: "SECONDARY_LIFT", movementPattern: "lunge", measurement: m.implementPerSide, prescriptions: p.threeByEightToTwelve }),
          isolationExercise({ placementId: "lower-b-4", exerciseId: "Seated Leg Curl", muscleId: "hamstrings", measurement: m.machine, prescriptions: p.twoByTenToFifteen }),
          isolationExercise({ placementId: "lower-b-5", exerciseId: "Machine Crunch", muscleId: "abs", measurement: m.machine, prescriptions: p.threeByEightToFifteenOmit }),
        ],
      },
    ],
  });
}

const measurement: MeasurementSemantics = {
  profile: "REPS_EXTERNAL_LOAD",
  loadConvention: "MACHINE_DISPLAYED",
  repBasis: "TOTAL",
};

function intentForSession(index: number): AcceptedExerciseIntentV2 {
  return index % 2 === 0
    ? {
        userRole: "PRIMARY_LIFT",
        target: {
          kind: "movement_pattern",
          movementPattern: index === 0 ? "horizontal_push" : "squat",
        },
      }
    : {
        userRole: "MUSCLE_ISOLATION",
        target: {
          kind: "muscle",
          muscleId: index === 1 ? "upper_back" : "hamstrings",
        },
      };
}

function prescriptionsForSession(index: number): WeeklyPrescriptionV4[] {
  return [
    {
      week: 1,
      status: "PRESCRIBE",
      setCount: 3 + (index % 2),
      reps:
        index % 2 === 0
          ? { kind: "RANGE", min: 6, max: 8 }
          : { kind: "EXACT", reps: 10 },
      rir: { kind: "TARGET_RANGE", min: 3, max: 4 },
    },
    {
      week: 2,
      status: "PRESCRIBE",
      setCount: 4,
      reps:
        index % 2 === 0
          ? { kind: "EXACT", reps: 7 }
          : { kind: "RANGE", min: 10, max: 12 },
      rir: { kind: "TARGET_RANGE", min: 2, max: 3 },
    },
    {
      week: 3,
      status: "PRESCRIBE",
      setCount: 5 - (index % 2),
      reps: { kind: "RANGE", min: 8, max: 10 },
      rir:
        index === 3
          ? { kind: "NOT_APPLICABLE" }
          : { kind: "TARGET_RANGE", min: 1, max: 2 },
    },
    ...(index === 3
      ? [{ week: 4, status: "OMIT" as const }]
      : [
          {
            week: 4,
            status: "PRESCRIBE" as const,
            setCount: 3 + (index % 2),
            reps: { kind: "EXACT" as const, reps: 8 },
            rir: { kind: "TARGET_RANGE" as const, min: 4, max: 5 },
          },
        ]),
  ];
}

export function buildFourDayV4ExpressivenessFixture(): {
  draft: HypertrophyPlanDraftV2;
  measurementByExerciseId: Map<string, MeasurementSemantics>;
} {
  const sessions = [
    ["fixture-slot-a", "Session A", "UPPER"],
    ["fixture-slot-b", "Session B", "UPPER"],
    ["fixture-slot-c", "Session C", "LOWER"],
    ["fixture-slot-d", "Session D", "LOWER"],
  ] as const satisfies ReadonlyArray<
    readonly [string, string, HypertrophySessionFocus]
  >;
  const exerciseIds = sessions.map((_, index) => `fixture-exercise-${index + 1}`);
  return {
    draft: {
      version: 2,
      settings: {
        equipmentProfile: "FULL_GYM",
        sessionDurationMinutes: 60,
      },
      weeks: [
        { week: 1, phase: "ACCUMULATION" },
        { week: 2, phase: "ACCUMULATION" },
        { week: 3, phase: "ACCUMULATION" },
        { week: 4, phase: "DELOAD" },
      ],
      sessions: sessions.map(([slotId, name, focus], index) => ({
        slotId,
        name,
        focus,
        exercises: [
          {
            placementId: `fixture-placement-${index + 1}`,
            exerciseId: exerciseIds[index]!,
            intent: intentForSession(index),
            prescriptions: prescriptionsForSession(index),
          },
        ],
      })),
    },
    measurementByExerciseId: new Map(
      exerciseIds.map((exerciseId) => [exerciseId, measurement]),
    ),
  };
}
