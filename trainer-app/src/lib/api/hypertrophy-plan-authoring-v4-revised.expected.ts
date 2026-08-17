import type { MeasurementSemantics } from "@/lib/exercise-measurement/semantics";
import type {
  AcceptedHypertrophySeedV4,
  WeeklyPrescriptionV4,
} from "@/lib/engine/hypertrophy-plan-authoring";

export const REVISED_FOUR_DAY_EXPECTED_WEEKS = [
  { week: 1, phase: "ACCUMULATION" as const },
  { week: 2, phase: "ACCUMULATION" as const },
  { week: 3, phase: "ACCUMULATION" as const },
  { week: 4, phase: "ACCUMULATION" as const },
  { week: 5, phase: "DELOAD" as const },
];

const FOUR_BY_FIVE_TO_EIGHT: WeeklyPrescriptionV4[] = [
  { week: 1, status: "PRESCRIBE", setCount: 4, reps: { kind: "RANGE", min: 5, max: 8 }, rir: { kind: "TARGET_RANGE", min: 3, max: 4 } },
  { week: 2, status: "PRESCRIBE", setCount: 4, reps: { kind: "RANGE", min: 5, max: 8 }, rir: { kind: "TARGET_RANGE", min: 3, max: 3 } },
  { week: 3, status: "PRESCRIBE", setCount: 4, reps: { kind: "RANGE", min: 5, max: 8 }, rir: { kind: "TARGET_RANGE", min: 2, max: 3 } },
  { week: 4, status: "PRESCRIBE", setCount: 4, reps: { kind: "RANGE", min: 5, max: 8 }, rir: { kind: "TARGET_RANGE", min: 1, max: 2 } },
  { week: 5, status: "PRESCRIBE", setCount: 2, reps: { kind: "RANGE", min: 5, max: 8 }, rir: { kind: "TARGET_RANGE", min: 4, max: 5 } },
];
const FOUR_BY_FOUR_TO_SIX: WeeklyPrescriptionV4[] = [
  { week: 1, status: "PRESCRIBE", setCount: 4, reps: { kind: "RANGE", min: 4, max: 6 }, rir: { kind: "TARGET_RANGE", min: 3, max: 4 } },
  { week: 2, status: "PRESCRIBE", setCount: 4, reps: { kind: "RANGE", min: 4, max: 6 }, rir: { kind: "TARGET_RANGE", min: 3, max: 3 } },
  { week: 3, status: "PRESCRIBE", setCount: 4, reps: { kind: "RANGE", min: 4, max: 6 }, rir: { kind: "TARGET_RANGE", min: 2, max: 3 } },
  { week: 4, status: "PRESCRIBE", setCount: 4, reps: { kind: "RANGE", min: 4, max: 6 }, rir: { kind: "TARGET_RANGE", min: 1, max: 2 } },
  { week: 5, status: "PRESCRIBE", setCount: 2, reps: { kind: "RANGE", min: 4, max: 6 }, rir: { kind: "TARGET_RANGE", min: 4, max: 5 } },
];
const FOUR_BY_SIX_TO_TEN: WeeklyPrescriptionV4[] = [
  { week: 1, status: "PRESCRIBE", setCount: 4, reps: { kind: "RANGE", min: 6, max: 10 }, rir: { kind: "TARGET_RANGE", min: 3, max: 4 } },
  { week: 2, status: "PRESCRIBE", setCount: 4, reps: { kind: "RANGE", min: 6, max: 10 }, rir: { kind: "TARGET_RANGE", min: 3, max: 3 } },
  { week: 3, status: "PRESCRIBE", setCount: 4, reps: { kind: "RANGE", min: 6, max: 10 }, rir: { kind: "TARGET_RANGE", min: 2, max: 3 } },
  { week: 4, status: "PRESCRIBE", setCount: 4, reps: { kind: "RANGE", min: 6, max: 10 }, rir: { kind: "TARGET_RANGE", min: 1, max: 2 } },
  { week: 5, status: "PRESCRIBE", setCount: 2, reps: { kind: "RANGE", min: 6, max: 10 }, rir: { kind: "TARGET_RANGE", min: 4, max: 5 } },
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
const TWO_BY_EIGHT_TO_TWELVE: WeeklyPrescriptionV4[] = [
  { week: 1, status: "PRESCRIBE", setCount: 2, reps: { kind: "RANGE", min: 8, max: 12 }, rir: { kind: "TARGET_RANGE", min: 3, max: 4 } },
  { week: 2, status: "PRESCRIBE", setCount: 2, reps: { kind: "RANGE", min: 8, max: 12 }, rir: { kind: "TARGET_RANGE", min: 3, max: 3 } },
  { week: 3, status: "PRESCRIBE", setCount: 2, reps: { kind: "RANGE", min: 8, max: 12 }, rir: { kind: "TARGET_RANGE", min: 2, max: 3 } },
  { week: 4, status: "PRESCRIBE", setCount: 2, reps: { kind: "RANGE", min: 8, max: 12 }, rir: { kind: "TARGET_RANGE", min: 1, max: 2 } },
  { week: 5, status: "PRESCRIBE", setCount: 1, reps: { kind: "RANGE", min: 8, max: 12 }, rir: { kind: "TARGET_RANGE", min: 4, max: 5 } },
];
const THREE_BY_TEN_TO_FIFTEEN_DELOAD_TWO: WeeklyPrescriptionV4[] =
  THREE_BY_TEN_TO_FIFTEEN.map((row) =>
    row.week === 5 && row.status === "PRESCRIBE"
      ? { ...row, setCount: 2 }
      : { ...row },
  );
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

export const REVISED_FOUR_DAY_EXPECTED_SLOTS: ReferenceSessionExpectation[] = [
  {
    slotId: "lower-a",
    name: "Lower A",
    focus: "LOWER",
    exercises: [
      { placementId: "lower-a-1", exerciseId: "Barbell Back Squat", role: "CORE_COMPOUND", intent: { userRole: "PRIMARY_LIFT", target: { kind: "movement_pattern", movementPattern: "squat" } }, measurement: BARBELL_TOTAL, prescriptions: FOUR_BY_FIVE_TO_EIGHT },
      { placementId: "lower-a-2", exerciseId: "Leg Press", role: "ACCESSORY", intent: { userRole: "SECONDARY_LIFT", target: { kind: "movement_pattern", movementPattern: "squat" } }, measurement: MACHINE_DISPLAYED, prescriptions: THREE_BY_EIGHT_TO_TWELVE },
      { placementId: "lower-a-3", exerciseId: "Barbell Romanian Deadlift", role: "ACCESSORY", intent: { userRole: "SECONDARY_LIFT", target: { kind: "movement_pattern", movementPattern: "hinge" } }, measurement: BARBELL_TOTAL, prescriptions: THREE_BY_SIX_TO_TEN },
      { placementId: "lower-a-4", exerciseId: "Lying Leg Curl", role: "ACCESSORY", intent: { userRole: "MUSCLE_ISOLATION", target: { kind: "muscle", muscleId: "hamstrings" } }, measurement: MACHINE_DISPLAYED, prescriptions: THREE_BY_TEN_TO_FIFTEEN },
      { placementId: "lower-a-5", exerciseId: "Hip Abduction Machine", role: "ACCESSORY", intent: { userRole: "MUSCLE_ISOLATION", target: { kind: "muscle", muscleId: "abductors" } }, measurement: MACHINE_DISPLAYED, prescriptions: TWO_BY_TWELVE_TO_TWENTY_WITH_OMISSION },
      { placementId: "lower-a-6", exerciseId: "Cable Crunch", role: "ACCESSORY", intent: { userRole: "MUSCLE_ISOLATION", target: { kind: "muscle", muscleId: "abs" } }, measurement: MACHINE_DISPLAYED, prescriptions: THREE_BY_EIGHT_TO_FIFTEEN_WITH_OMISSION },
    ],
  },
  {
    slotId: "upper-a",
    name: "Upper A",
    focus: "UPPER",
    exercises: [
      { placementId: "upper-a-1", exerciseId: "Barbell Bench Press", role: "CORE_COMPOUND", intent: { userRole: "PRIMARY_LIFT", target: { kind: "movement_pattern", movementPattern: "horizontal_push" } }, measurement: BARBELL_TOTAL, prescriptions: FOUR_BY_FIVE_TO_EIGHT },
      { placementId: "upper-a-2", exerciseId: "Pull-Up", role: "ACCESSORY", intent: { userRole: "SECONDARY_LIFT", target: { kind: "movement_pattern", movementPattern: "vertical_pull" } }, measurement: BODYWEIGHT_TOTAL, prescriptions: FOUR_BY_SIX_TO_TEN },
      { placementId: "upper-a-3", exerciseId: "Incline Dumbbell Bench Press", role: "ACCESSORY", intent: { userRole: "SECONDARY_LIFT", target: { kind: "movement_pattern", movementPattern: "horizontal_push" } }, measurement: IMPLEMENT_WEIGHT_TOTAL, prescriptions: THREE_BY_EIGHT_TO_TWELVE },
      { placementId: "upper-a-4", exerciseId: "Chest-Supported Dumbbell Row", role: "ACCESSORY", intent: { userRole: "SECONDARY_LIFT", target: { kind: "movement_pattern", movementPattern: "horizontal_pull" } }, measurement: IMPLEMENT_WEIGHT_TOTAL, prescriptions: THREE_BY_EIGHT_TO_TWELVE },
      { placementId: "upper-a-5", exerciseId: "Dumbbell Lateral Raise", role: "ACCESSORY", intent: { userRole: "MUSCLE_ISOLATION", target: { kind: "muscle", muscleId: "side_delts" } }, measurement: IMPLEMENT_WEIGHT_TOTAL, prescriptions: THREE_BY_TEN_TO_FIFTEEN },
      { placementId: "upper-a-6", exerciseId: "EZ-Bar Curl", role: "ACCESSORY", intent: { userRole: "MUSCLE_ISOLATION", target: { kind: "muscle", muscleId: "biceps" } }, measurement: BARBELL_TOTAL, prescriptions: THREE_BY_TEN_TO_FIFTEEN },
      { placementId: "upper-a-7", exerciseId: "Cable Triceps Pushdown", role: "ACCESSORY", intent: { userRole: "MUSCLE_ISOLATION", target: { kind: "muscle", muscleId: "triceps" } }, measurement: MACHINE_DISPLAYED, prescriptions: THREE_BY_TEN_TO_FIFTEEN },
    ],
  },
  {
    slotId: "lower-b",
    name: "Lower B — Strength Development",
    focus: "LOWER",
    exercises: [
      { placementId: "lower-b-1", exerciseId: "Conventional Deadlift", role: "CORE_COMPOUND", intent: { userRole: "PRIMARY_LIFT", target: { kind: "movement_pattern", movementPattern: "hinge" } }, measurement: BARBELL_TOTAL, prescriptions: FOUR_BY_FOUR_TO_SIX },
      { placementId: "lower-b-2", exerciseId: "Hack Squat", role: "ACCESSORY", intent: { userRole: "SECONDARY_LIFT", target: { kind: "movement_pattern", movementPattern: "squat" } }, measurement: MACHINE_DISPLAYED, prescriptions: FOUR_BY_FIVE_TO_EIGHT },
      { placementId: "lower-b-3", exerciseId: "Bulgarian Split Squat", role: "ACCESSORY", intent: { userRole: "SECONDARY_LIFT", target: { kind: "movement_pattern", movementPattern: "lunge" } }, measurement: IMPLEMENT_WEIGHT_PER_SIDE, prescriptions: TWO_BY_EIGHT_TO_TWELVE },
      { placementId: "lower-b-4", exerciseId: "Seated Leg Curl", role: "ACCESSORY", intent: { userRole: "MUSCLE_ISOLATION", target: { kind: "muscle", muscleId: "hamstrings" } }, measurement: MACHINE_DISPLAYED, prescriptions: THREE_BY_TEN_TO_FIFTEEN },
      { placementId: "lower-b-5", exerciseId: "Seated Calf Raise", role: "ACCESSORY", intent: { userRole: "MUSCLE_ISOLATION", target: { kind: "muscle", muscleId: "calves" } }, measurement: MACHINE_DISPLAYED, prescriptions: THREE_BY_TEN_TO_FIFTEEN_DELOAD_TWO },
      { placementId: "lower-b-6", exerciseId: "Machine Crunch", role: "ACCESSORY", intent: { userRole: "MUSCLE_ISOLATION", target: { kind: "muscle", muscleId: "abs" } }, measurement: MACHINE_DISPLAYED, prescriptions: THREE_BY_EIGHT_TO_FIFTEEN_WITH_OMISSION },
    ],
  },
  {
    slotId: "upper-b",
    name: "Upper B",
    focus: "UPPER",
    exercises: [
      { placementId: "upper-b-1", exerciseId: "Chest-Supported Dumbbell Row", role: "ACCESSORY", intent: { userRole: "SECONDARY_LIFT", target: { kind: "movement_pattern", movementPattern: "horizontal_pull" } }, measurement: IMPLEMENT_WEIGHT_TOTAL, prescriptions: FOUR_BY_SIX_TO_TEN },
      { placementId: "upper-b-2", exerciseId: "Lat Pulldown", role: "ACCESSORY", intent: { userRole: "SECONDARY_LIFT", target: { kind: "movement_pattern", movementPattern: "vertical_pull" } }, measurement: MACHINE_DISPLAYED, prescriptions: THREE_BY_EIGHT_TO_TWELVE },
      { placementId: "upper-b-3", exerciseId: "Dumbbell Overhead Press", role: "CORE_COMPOUND", intent: { userRole: "PRIMARY_LIFT", target: { kind: "movement_pattern", movementPattern: "vertical_push" } }, measurement: IMPLEMENT_WEIGHT_TOTAL, prescriptions: THREE_BY_SIX_TO_TEN },
      { placementId: "upper-b-4", exerciseId: "Dumbbell Bench Press", role: "ACCESSORY", intent: { userRole: "SECONDARY_LIFT", target: { kind: "movement_pattern", movementPattern: "horizontal_push" } }, measurement: IMPLEMENT_WEIGHT_TOTAL, prescriptions: THREE_BY_EIGHT_TO_TWELVE },
      { placementId: "upper-b-5", exerciseId: "Reverse Pec Deck", role: "ACCESSORY", intent: { userRole: "MUSCLE_ISOLATION", target: { kind: "muscle", muscleId: "rear_delts" } }, measurement: MACHINE_DISPLAYED, prescriptions: THREE_BY_TWELVE_TO_TWENTY },
      { placementId: "upper-b-6", exerciseId: "Cable Curl", role: "ACCESSORY", intent: { userRole: "MUSCLE_ISOLATION", target: { kind: "muscle", muscleId: "biceps" } }, measurement: MACHINE_DISPLAYED, prescriptions: THREE_BY_TEN_TO_FIFTEEN },
      { placementId: "upper-b-7", exerciseId: "Overhead Cable Triceps Extension", role: "ACCESSORY", intent: { userRole: "MUSCLE_ISOLATION", target: { kind: "muscle", muscleId: "triceps" } }, measurement: MACHINE_DISPLAYED, prescriptions: THREE_BY_TEN_TO_FIFTEEN },
    ],
  },
];


export const REVISED_FOUR_DAY_STABLE_CANONICAL_HASH =
  "48d34eb7e950a6d0fa564a234ed7e257a8d30681519ba52c019fe47a6066dfef";

type ExpectedRecommendationDose = {
  setCount: number;
  reps: { min: number; max: number };
  deloadSetCount?: number;
  omitDeload?: true;
};

const EXPECTED_RECOMMENDATION_DOSE_BY_PLACEMENT: Record<
  string,
  ExpectedRecommendationDose
> = {
  "lower-a-1": { setCount: 3, reps: { min: 5, max: 8 }, deloadSetCount: 2 },
  "lower-a-2": { setCount: 3, reps: { min: 8, max: 12 }, deloadSetCount: 2 },
  "lower-a-3": { setCount: 3, reps: { min: 6, max: 10 }, deloadSetCount: 2 },
  "lower-a-4": { setCount: 2, reps: { min: 10, max: 15 }, deloadSetCount: 1 },
  "lower-a-5": { setCount: 2, reps: { min: 12, max: 20 }, omitDeload: true },
  "lower-a-6": { setCount: 3, reps: { min: 8, max: 15 }, omitDeload: true },
  "upper-a-1": { setCount: 3, reps: { min: 5, max: 8 }, deloadSetCount: 2 },
  "upper-a-2": { setCount: 3, reps: { min: 6, max: 10 }, deloadSetCount: 2 },
  "upper-a-3": { setCount: 3, reps: { min: 8, max: 12 }, deloadSetCount: 2 },
  "upper-a-4": { setCount: 3, reps: { min: 8, max: 12 }, deloadSetCount: 2 },
  "upper-a-5": { setCount: 3, reps: { min: 10, max: 15 }, deloadSetCount: 1 },
  "upper-a-6": { setCount: 3, reps: { min: 10, max: 15 }, deloadSetCount: 1 },
  "upper-a-7": { setCount: 2, reps: { min: 10, max: 15 }, deloadSetCount: 1 },
  "lower-b-1": { setCount: 3, reps: { min: 5, max: 8 }, deloadSetCount: 2 },
  "lower-b-2": { setCount: 3, reps: { min: 8, max: 12 }, deloadSetCount: 2 },
  "lower-b-3": { setCount: 3, reps: { min: 8, max: 12 }, deloadSetCount: 2 },
  "lower-b-4": { setCount: 2, reps: { min: 10, max: 15 }, deloadSetCount: 1 },
  "lower-b-5": { setCount: 3, reps: { min: 10, max: 15 }, deloadSetCount: 1 },
  "lower-b-6": { setCount: 3, reps: { min: 8, max: 15 }, omitDeload: true },
  "upper-b-1": { setCount: 3, reps: { min: 8, max: 12 }, deloadSetCount: 2 },
  "upper-b-2": { setCount: 3, reps: { min: 8, max: 12 }, deloadSetCount: 2 },
  "upper-b-3": { setCount: 3, reps: { min: 6, max: 10 }, deloadSetCount: 2 },
  "upper-b-4": { setCount: 3, reps: { min: 8, max: 12 }, deloadSetCount: 2 },
  "upper-b-5": { setCount: 3, reps: { min: 12, max: 20 }, deloadSetCount: 1 },
  "upper-b-6": { setCount: 3, reps: { min: 10, max: 15 }, deloadSetCount: 1 },
  "upper-b-7": { setCount: 2, reps: { min: 10, max: 15 }, deloadSetCount: 1 },
};

function expectedRecommendationPrescriptions(
  dose: ExpectedRecommendationDose,
): WeeklyPrescriptionV4[] {
  const accumulationRir = [[3, 4], [3, 3], [2, 3], [1, 2]] as const;
  return [
    ...accumulationRir.map(([min, max], index) => ({
      week: index + 1,
      status: "PRESCRIBE" as const,
      setCount: dose.setCount,
      reps: { kind: "RANGE" as const, ...dose.reps },
      rir: { kind: "TARGET_RANGE" as const, min, max },
    })),
    dose.omitDeload
      ? { week: 5, status: "OMIT" as const }
      : {
          week: 5,
          status: "PRESCRIBE" as const,
          setCount: dose.deloadSetCount!,
          reps: { kind: "RANGE" as const, ...dose.reps },
          rir: { kind: "TARGET_RANGE" as const, min: 4, max: 5 },
        },
  ];
}

export function buildExpectedRevisedRecommendationsByPlacement() {
  return Object.fromEntries(
    REVISED_FOUR_DAY_EXPECTED_SLOTS.flatMap((slot) =>
      slot.exercises.map((exercise) => {
        const prescriptions = expectedRecommendationPrescriptions(
          EXPECTED_RECOMMENDATION_DOSE_BY_PLACEMENT[exercise.placementId],
        );
        return [
          exercise.placementId,
          {
            intent: structuredClone(exercise.intent),
            prescriptions,
            recommendationBaseline: {
              version: 1 as const,
              exerciseId: exercise.exerciseId,
              intent: structuredClone(exercise.intent),
              prescriptions: structuredClone(prescriptions),
            },
          },
        ];
      }),
    ),
  );
}

export function buildExpectedRevisedRecommendationAcceptedSeed(): AcceptedHypertrophySeedV4 {
  const expected = buildExpectedRevisedFourDayAcceptedSeed();
  const recommendations = buildExpectedRevisedRecommendationsByPlacement();
  return {
    ...expected,
    slots: expected.slots.map((slot) => ({
      ...slot,
      exercises: slot.exercises.map((exercise) => ({
        ...exercise,
        intent: recommendations[exercise.placementId]!.intent,
        prescriptions: recommendations[exercise.placementId]!.prescriptions,
      })),
    })),
  };
}

export function buildExpectedRevisedFourDayAcceptedSeed(): AcceptedHypertrophySeedV4 {
  return structuredClone({
    version: 4,
    source: "custom_hypertrophy_plan_v2",
    settings: {
      equipmentProfile: "FULL_GYM",
      sessionDurationMinutes: 60,
    },
    weeks: REVISED_FOUR_DAY_EXPECTED_WEEKS,
    slots: REVISED_FOUR_DAY_EXPECTED_SLOTS,
  });
}
