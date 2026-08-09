import type { MeasurementSemantics } from "@/lib/exercise-measurement/semantics";
import type {
  AcceptedExerciseIntentV2,
  HypertrophyPlanDraftV2,
  HypertrophySessionFocus,
  WeeklyPrescriptionV4,
} from "./hypertrophy-plan-authoring";

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
