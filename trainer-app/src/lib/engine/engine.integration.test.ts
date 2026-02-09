import { describe, expect, it } from "vitest";
import { applyLoads, type BaselineInput } from "./apply-loads";
import { generateWorkout } from "./engine";
import { getPeriodizationModifiers } from "./rules";
import type {
  Constraints,
  Exercise,
  Goals,
  SplitDay,
  SplitTag,
  UserProfile,
  WorkoutPlan,
} from "./types";

type SeededExerciseInput = Omit<Exercise, "isMainLiftEligible" | "isCompound" | "fatigueCost" | "stimulusBias" | "primaryMuscles"> & {
  isMainLift: boolean;
  isMainLiftEligible?: boolean;
  isCompound?: boolean;
  fatigueCost?: number;
  stimulusBias?: Exercise["stimulusBias"];
  primaryMuscles?: Exercise["primaryMuscles"];
};

const createExercise = (input: SeededExerciseInput): Exercise => {
  const { isMainLift, ...rest } = input;
  return {
    isMainLiftEligible: input.isMainLiftEligible ?? isMainLift,
    isCompound: input.isCompound ?? isMainLift,
    fatigueCost: input.fatigueCost ?? (isMainLift ? 4 : 2),
    stimulusBias: input.stimulusBias ?? [],
    primaryMuscles: input.primaryMuscles ?? [],
    ...rest,
  };
};

const seededExerciseLibrary: Exercise[] = [
  createExercise({
    id: "barbell-bench-press",
    name: "Barbell Bench Press",
    movementPatterns: ["horizontal_push"],
    splitTags: ["push"],
    jointStress: "high",
    isMainLift: true,
    equipment: ["barbell", "bench", "rack"],
    primaryMuscles: ["Chest"],
    stimulusBias: ["mechanical"],
  }),
  createExercise({
    id: "overhead-press",
    name: "Overhead Press",
    movementPatterns: ["vertical_push"],
    splitTags: ["push"],
    jointStress: "high",
    isMainLift: true,
    equipment: ["barbell"],
    primaryMuscles: ["Front Delts", "Triceps"],
    stimulusBias: ["mechanical"],
  }),
  createExercise({
    id: "cable-fly",
    name: "Cable Fly",
    movementPatterns: ["horizontal_push"],
    splitTags: ["push"],
    jointStress: "low",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: false,
    fatigueCost: 2,
    equipment: ["cable"],
    primaryMuscles: ["Chest"],
    stimulusBias: ["stretch"],
  }),
  createExercise({
    id: "pec-deck",
    name: "Pec Deck",
    movementPatterns: ["horizontal_push"],
    splitTags: ["push"],
    jointStress: "low",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: false,
    fatigueCost: 2,
    equipment: ["machine"],
    primaryMuscles: ["Chest"],
    stimulusBias: ["stretch"],
  }),
  createExercise({
    id: "lateral-raise",
    name: "Lateral Raise",
    movementPatterns: ["vertical_push"],
    splitTags: ["push"],
    jointStress: "low",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: false,
    fatigueCost: 2,
    equipment: ["dumbbell"],
    primaryMuscles: ["Side Delts"],
    stimulusBias: ["metabolic"],
  }),
  createExercise({
    id: "cable-lateral-raise",
    name: "Cable Lateral Raise",
    movementPatterns: ["vertical_push"],
    splitTags: ["push"],
    jointStress: "low",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: false,
    fatigueCost: 2,
    equipment: ["cable"],
    primaryMuscles: ["Side Delts"],
    stimulusBias: ["metabolic"],
  }),
  createExercise({
    id: "triceps-pushdown",
    name: "Triceps Pushdown",
    movementPatterns: ["horizontal_push"],
    splitTags: ["push"],
    jointStress: "low",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: false,
    fatigueCost: 3,
    equipment: ["cable"],
    primaryMuscles: ["Triceps"],
    stimulusBias: ["metabolic"],
  }),
  createExercise({
    id: "overhead-triceps-extension",
    name: "Overhead Triceps Extension",
    movementPatterns: ["vertical_push"],
    splitTags: ["push"],
    jointStress: "medium",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: false,
    fatigueCost: 3,
    equipment: ["dumbbell"],
    primaryMuscles: ["Triceps"],
    stimulusBias: ["stretch"],
  }),
  createExercise({
    id: "dumbbell-incline-press",
    name: "Dumbbell Incline Press",
    movementPatterns: ["horizontal_push"],
    splitTags: ["push"],
    jointStress: "medium",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: true,
    fatigueCost: 3,
    equipment: ["dumbbell", "bench"],
    primaryMuscles: ["Upper Chest"],
    stimulusBias: ["mechanical", "stretch"],
  }),
  createExercise({
    id: "machine-chest-press",
    name: "Machine Chest Press",
    movementPatterns: ["horizontal_push"],
    splitTags: ["push"],
    jointStress: "medium",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: true,
    fatigueCost: 3,
    equipment: ["machine"],
    primaryMuscles: ["Chest"],
    stimulusBias: ["mechanical"],
  }),
  createExercise({
    id: "lat-pulldown",
    name: "Lat Pulldown",
    movementPatterns: ["vertical_pull"],
    splitTags: ["pull"],
    jointStress: "medium",
    isMainLift: true,
    equipment: ["cable", "machine"],
    primaryMuscles: ["Back"],
    stimulusBias: ["mechanical"],
  }),
  createExercise({
    id: "barbell-row",
    name: "Barbell Row",
    movementPatterns: ["horizontal_pull"],
    splitTags: ["pull"],
    jointStress: "medium",
    isMainLift: true,
    equipment: ["barbell"],
    primaryMuscles: ["Back"],
    stimulusBias: ["mechanical"],
  }),
  createExercise({
    id: "face-pull",
    name: "Face Pull",
    movementPatterns: ["horizontal_pull"],
    splitTags: ["pull"],
    jointStress: "low",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: false,
    fatigueCost: 2,
    equipment: ["cable"],
    primaryMuscles: ["Rear Delts", "Upper Back"],
    stimulusBias: ["metabolic"],
  }),
  createExercise({
    id: "rear-delt-fly-machine",
    name: "Machine Rear Delt Fly",
    movementPatterns: ["horizontal_pull"],
    splitTags: ["pull"],
    jointStress: "low",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: false,
    fatigueCost: 2,
    equipment: ["machine"],
    primaryMuscles: ["Rear Delts"],
    stimulusBias: ["metabolic"],
  }),
  createExercise({
    id: "dumbbell-curl",
    name: "Dumbbell Curl",
    movementPatterns: ["horizontal_pull"],
    splitTags: ["pull"],
    jointStress: "low",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: false,
    fatigueCost: 2,
    equipment: ["dumbbell"],
    primaryMuscles: ["Biceps"],
  }),
  createExercise({
    id: "incline-dumbbell-curl",
    name: "Incline Dumbbell Curl",
    movementPatterns: ["horizontal_pull"],
    splitTags: ["pull"],
    jointStress: "low",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: false,
    fatigueCost: 2,
    equipment: ["dumbbell", "bench"],
    primaryMuscles: ["Biceps"],
    stimulusBias: ["stretch"],
  }),
  createExercise({
    id: "seated-cable-row",
    name: "Seated Cable Row",
    movementPatterns: ["horizontal_pull"],
    splitTags: ["pull"],
    jointStress: "low",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: true,
    fatigueCost: 3,
    equipment: ["cable"],
    primaryMuscles: ["Back"],
  }),
  createExercise({
    id: "chest-supported-row",
    name: "Chest-Supported Row",
    movementPatterns: ["horizontal_pull"],
    splitTags: ["pull"],
    jointStress: "low",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: true,
    fatigueCost: 3,
    equipment: ["dumbbell", "bench"],
    primaryMuscles: ["Upper Back"],
  }),
  createExercise({
    id: "straight-arm-pulldown",
    name: "Straight-Arm Pulldown",
    movementPatterns: ["vertical_pull"],
    splitTags: ["pull"],
    jointStress: "low",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: false,
    fatigueCost: 2,
    equipment: ["cable"],
    primaryMuscles: ["Back"],
  }),
  createExercise({
    id: "one-arm-dumbbell-row",
    name: "One-Arm Dumbbell Row",
    movementPatterns: ["horizontal_pull"],
    splitTags: ["pull"],
    jointStress: "medium",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: true,
    fatigueCost: 3,
    equipment: ["dumbbell", "bench"],
    primaryMuscles: ["Back"],
  }),
  createExercise({
    id: "reverse-fly",
    name: "Reverse Fly",
    movementPatterns: ["horizontal_pull"],
    splitTags: ["pull"],
    jointStress: "low",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: false,
    fatigueCost: 2,
    equipment: ["dumbbell"],
    primaryMuscles: ["Rear Delts"],
    stimulusBias: ["metabolic"],
  }),
  createExercise({
    id: "barbell-back-squat",
    name: "Barbell Back Squat",
    movementPatterns: ["squat"],
    splitTags: ["legs"],
    jointStress: "high",
    isMainLift: true,
    equipment: ["barbell", "rack"],
    primaryMuscles: ["Quads", "Glutes"],
    stimulusBias: ["mechanical"],
  }),
  createExercise({
    id: "romanian-deadlift",
    name: "Romanian Deadlift",
    movementPatterns: ["hinge"],
    splitTags: ["legs"],
    jointStress: "medium",
    isMainLift: true,
    equipment: ["barbell"],
    primaryMuscles: ["Hamstrings", "Glutes"],
    stimulusBias: ["stretch"],
  }),
  createExercise({
    id: "leg-extension",
    name: "Leg Extension",
    movementPatterns: ["squat"],
    splitTags: ["legs"],
    jointStress: "medium",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: false,
    fatigueCost: 2,
    equipment: ["machine"],
    primaryMuscles: ["Quads"],
    stimulusBias: ["metabolic"],
  }),
  createExercise({
    id: "hack-squat",
    name: "Hack Squat",
    movementPatterns: ["squat"],
    splitTags: ["legs"],
    jointStress: "medium",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: false,
    fatigueCost: 3,
    equipment: ["machine"],
    primaryMuscles: ["Quads"],
    stimulusBias: ["mechanical"],
  }),
  createExercise({
    id: "leg-curl",
    name: "Leg Curl",
    movementPatterns: ["hinge"],
    splitTags: ["legs"],
    jointStress: "medium",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: false,
    fatigueCost: 2,
    equipment: ["machine"],
    primaryMuscles: ["Hamstrings"],
    stimulusBias: ["metabolic"],
  }),
  createExercise({
    id: "walking-lunge",
    name: "Walking Lunge",
    movementPatterns: ["lunge"],
    splitTags: ["legs"],
    jointStress: "medium",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: true,
    fatigueCost: 3,
    equipment: ["dumbbell"],
    primaryMuscles: ["Glutes", "Quads"],
    stimulusBias: ["mechanical"],
  }),
  createExercise({
    id: "split-squat",
    name: "Split Squat",
    movementPatterns: ["lunge"],
    splitTags: ["legs"],
    jointStress: "medium",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: true,
    fatigueCost: 3,
    equipment: ["dumbbell"],
    primaryMuscles: ["Glutes", "Quads"],
    stimulusBias: ["mechanical"],
  }),
  createExercise({
    id: "standing-calf-raise",
    name: "Standing Calf Raise",
    movementPatterns: ["carry"],
    splitTags: ["legs"],
    jointStress: "low",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: false,
    fatigueCost: 2,
    equipment: ["machine"],
    primaryMuscles: ["Calves"],
    stimulusBias: ["metabolic"],
  }),
  createExercise({
    id: "seated-calf-raise",
    name: "Seated Calf Raise",
    movementPatterns: ["carry"],
    splitTags: ["legs"],
    jointStress: "low",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: false,
    fatigueCost: 2,
    equipment: ["machine"],
    primaryMuscles: ["Calves"],
    stimulusBias: ["metabolic"],
  }),
  createExercise({
    id: "leg-press",
    name: "Leg Press",
    movementPatterns: ["squat"],
    splitTags: ["legs"],
    jointStress: "medium",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: true,
    fatigueCost: 3,
    equipment: ["machine"],
    primaryMuscles: ["Quads", "Glutes"],
    stimulusBias: ["mechanical"],
  }),
  createExercise({
    id: "hip-abduction-machine",
    name: "Hip Abduction Machine",
    movementPatterns: ["hinge"],
    splitTags: ["legs"],
    jointStress: "low",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: false,
    fatigueCost: 2,
    equipment: ["machine"],
    primaryMuscles: ["Glutes"],
    stimulusBias: ["metabolic"],
  }),
  createExercise({
    id: "glute-bridge",
    name: "Glute Bridge",
    movementPatterns: ["hinge"],
    splitTags: ["legs"],
    jointStress: "low",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: true,
    fatigueCost: 3,
    equipment: ["barbell", "bench"],
    primaryMuscles: ["Glutes"],
    stimulusBias: ["mechanical"],
  }),
];

const seededBaselines: BaselineInput[] = [
  { exerciseId: "barbell-back-squat", context: "strength", topSetWeight: 185 },
  { exerciseId: "barbell-bench-press", context: "strength", topSetWeight: 175 },
  { exerciseId: "overhead-press", context: "default", topSetWeight: 85 },
  { exerciseId: "romanian-deadlift", context: "default", topSetWeight: 165 },
  { exerciseId: "barbell-row", context: "default", topSetWeight: 135 },
  { exerciseId: "lat-pulldown", context: "volume", workingWeightMin: 115, workingWeightMax: 130 },
  { exerciseId: "dumbbell-incline-press", context: "default", workingWeightMin: 55, workingWeightMax: 55 },
  { exerciseId: "lateral-raise", context: "default", workingWeightMin: 12.5, workingWeightMax: 12.5 },
  { exerciseId: "triceps-pushdown", context: "default", workingWeightMin: 35, workingWeightMax: 35 },
  { exerciseId: "face-pull", context: "default", workingWeightMin: 40, workingWeightMax: 40 },
  { exerciseId: "rear-delt-fly-machine", context: "default", workingWeightMin: 80, workingWeightMax: 80 },
  { exerciseId: "incline-dumbbell-curl", context: "default", workingWeightMin: 20, workingWeightMax: 20 },
  { exerciseId: "one-arm-dumbbell-row", context: "default", workingWeightMin: 60, workingWeightMax: 60 },
  { exerciseId: "straight-arm-pulldown", context: "default", workingWeightMin: 45, workingWeightMax: 50 },
  { exerciseId: "leg-press", context: "default", workingWeightMin: 180, workingWeightMax: 180 },
];

const seededUser: UserProfile = {
  id: "seeded-user",
  trainingAge: "intermediate",
  injuries: [],
  age: 30,
  heightCm: 180,
  weightKg: 82,
};

const seededGoals: Goals = {
  primary: "hypertrophy",
  secondary: "conditioning",
};

const seededConstraints: Constraints = {
  daysPerWeek: 3,
  sessionMinutes: 80,
  splitType: "ppl",
  availableEquipment: [
    "barbell",
    "dumbbell",
    "machine",
    "cable",
    "bodyweight",
    "bench",
    "rack",
  ],
};

const exerciseById = Object.fromEntries(
  seededExerciseLibrary.map((exercise) => [exercise.id, exercise])
) as Record<string, Exercise>;

function runFixture(split: SplitTag, randomSeed: number): WorkoutPlan {
  const generated = generateWorkout(
    seededUser,
    seededGoals,
    seededConstraints,
    [],
    seededExerciseLibrary,
    undefined,
    { forcedSplit: split, randomSeed }
  );

  return applyLoads(generated, {
    history: [],
    baselines: seededBaselines,
    exerciseById,
    primaryGoal: seededGoals.primary,
    profile: { weightKg: seededUser.weightKg },
    sessionMinutes: seededConstraints.sessionMinutes,
  });
}

function runFixtureWithPeriodization(split: SplitTag, weekInBlock: number): WorkoutPlan {
  const periodization = getPeriodizationModifiers(weekInBlock, seededGoals.primary);
  const generated = generateWorkout(
    seededUser,
    seededGoals,
    seededConstraints,
    [],
    seededExerciseLibrary,
    undefined,
    { forcedSplit: split, randomSeed: 101, periodization }
  );

  return applyLoads(generated, {
    history: [],
    baselines: seededBaselines,
    exerciseById,
    primaryGoal: seededGoals.primary,
    profile: { weightKg: seededUser.weightKg },
    sessionMinutes: seededConstraints.sessionMinutes,
    periodization,
  });
}

function assertPplWorkout(workout: WorkoutPlan, dayTag: SplitTag) {
  const allExercises = [...workout.mainLifts, ...workout.accessories];
  expect(allExercises.length).toBeGreaterThan(0);

  for (const entry of allExercises) {
    expect(entry.exercise.splitTags).toContain(dayTag);
  }

  const ids = allExercises.map((entry) => entry.exercise.id);
  expect(new Set(ids).size).toBe(ids.length);

  for (const main of workout.mainLifts) {
    expect(main.sets.length).toBeGreaterThan(1);
    const topLoad = main.sets[0].targetLoad;
    const backOff = main.sets[1].targetLoad;
    expect(topLoad).toBeDefined();
    expect(backOff).toBeDefined();
    expect(topLoad).not.toBe(backOff);
  }

  for (const accessory of workout.accessories) {
    for (const set of accessory.sets) {
      expect(set.targetLoad).toBeDefined();
    }
  }

  const restValues = allExercises
    .flatMap((entry) => entry.sets.map((set) => set.restSeconds))
    .filter((value): value is number => value !== undefined);
  expect(new Set(restValues).size).toBeGreaterThan(1);

  expect(workout.estimatedMinutes).toBeLessThanOrEqual(
    seededConstraints.sessionMinutes
  );
}

function getAccessoryNames(workout: WorkoutPlan) {
  return workout.accessories.map((entry) => entry.exercise.name).sort();
}

function hasMainLiftPattern(workout: WorkoutPlan, pattern: string) {
  return workout.mainLifts.some((lift) => lift.exercise.movementPatterns?.includes(pattern));
}

function hasAccessoryPrimaryMuscle(workout: WorkoutPlan, muscles: string[]) {
  const targets = new Set(muscles.map((muscle) => muscle.toLowerCase()));
  return workout.accessories.some((entry) =>
    (entry.exercise.primaryMuscles ?? []).some((muscle) =>
      targets.has(muscle.toLowerCase())
    )
  );
}

describe("engine end-to-end fixtures", () => {
  it("builds a complete push workout with deterministic variation", () => {
    const workout = runFixture("push", 101);
    assertPplWorkout(workout, "push");

    expect(hasMainLiftPattern(workout, "horizontal_push")).toBe(true);
    expect(hasMainLiftPattern(workout, "vertical_push")).toBe(true);

    const altWorkout = runFixture("push", 202);
    expect(getAccessoryNames(workout)).not.toEqual(getAccessoryNames(altWorkout));
  });

  it("builds a complete pull workout with deterministic variation", () => {
    const workout = runFixture("pull", 303);
    assertPplWorkout(workout, "pull");

    expect(hasMainLiftPattern(workout, "vertical_pull")).toBe(true);
    expect(hasMainLiftPattern(workout, "horizontal_pull")).toBe(true);
    expect(
      hasAccessoryPrimaryMuscle(workout, ["Rear Delts", "Upper Back"])
    ).toBe(true);

    const altWorkout = runFixture("pull", 404);
    expect(getAccessoryNames(workout)).not.toEqual(getAccessoryNames(altWorkout));
  });

  it("builds a complete legs workout with deterministic variation", () => {
    const workout = runFixture("legs", 505);
    assertPplWorkout(workout, "legs");

    const altWorkout = runFixture("legs", 606);
    expect(getAccessoryNames(workout)).not.toEqual(getAccessoryNames(altWorkout));
  });

  it("applies periodization modifiers across week 1 and week 4", () => {
    const week1 = runFixtureWithPeriodization("push", 0);
    const week4 = runFixtureWithPeriodization("push", 3);

    const week1Main = week1.mainLifts[0];
    const week4Main = week4.mainLifts[0];

    expect(week4Main.sets.length).toBeLessThan(week1Main.sets.length);
    expect(week4Main.sets[0].targetRpe).toBeLessThan(week1Main.sets[0].targetRpe ?? 99);
    expect(week4Main.sets[0].targetRpe).toBeLessThanOrEqual(6);
    expect(week4Main.sets[0].targetLoad).toBeLessThan(week1Main.sets[0].targetLoad ?? 0);
    expect(week4Main.sets[1].targetLoad).toBe(week4Main.sets[0].targetLoad);
  });
});

// --- Non-PPL split tests ---

const upperLowerConstraints: Constraints = {
  ...seededConstraints,
  daysPerWeek: 4,
  splitType: "upper_lower",
};

const fullBodyConstraints: Constraints = {
  ...seededConstraints,
  daysPerWeek: 3,
  splitType: "full_body",
};

// Add a rotate exercise for full_body coverage
const nonPplLibrary: Exercise[] = [
  ...seededExerciseLibrary,
  createExercise({
    id: "wood-chop",
    name: "Cable Wood Chop",
    movementPatterns: ["rotation"],
    splitTags: ["core"],
    jointStress: "low",
    isMainLift: false,
    isMainLiftEligible: false,
    isCompound: false,
    fatigueCost: 2,
    equipment: ["cable"],
    primaryMuscles: ["Core"],
  }),
];

const nonPplExerciseById = Object.fromEntries(
  nonPplLibrary.map((exercise) => [exercise.id, exercise])
) as Record<string, Exercise>;

function runNonPplFixture(
  split: SplitDay,
  constraints: Constraints,
  randomSeed: number
): WorkoutPlan {
  const generated = generateWorkout(
    seededUser,
    seededGoals,
    constraints,
    [],
    nonPplLibrary,
    undefined,
    { forcedSplit: split, randomSeed }
  );

  return applyLoads(generated, {
    history: [],
    baselines: seededBaselines,
    exerciseById: nonPplExerciseById,
    primaryGoal: seededGoals.primary,
    profile: { weightKg: seededUser.weightKg },
    sessionMinutes: constraints.sessionMinutes,
  });
}

describe("upper_lower split end-to-end", () => {
  it("upper day selects only push/pull movement pattern exercises", () => {
    const workout = runNonPplFixture("upper", upperLowerConstraints, 701);
    const allExercises = [...workout.mainLifts, ...workout.accessories];

    const upperV2 = [
      "horizontal_push", "vertical_push", "horizontal_pull", "vertical_pull",
      "flexion", "extension",
    ];
    expect(allExercises.length).toBeGreaterThan(0);
    for (const entry of allExercises) {
      const hasUpper = (entry.exercise.movementPatterns ?? []).some(
        (p) => upperV2.includes(p)
      );
      expect(hasUpper).toBe(true);
    }
  });

  it("upper day has at least 2 main lifts and 3 accessories", () => {
    const workout = runNonPplFixture("upper", upperLowerConstraints, 702);

    expect(workout.mainLifts.length).toBeGreaterThanOrEqual(2);
    expect(workout.accessories.length).toBeGreaterThanOrEqual(3);
  });

  it("lower day selects only squat/hinge/lunge/carry movement pattern exercises", () => {
    const workout = runNonPplFixture("lower", upperLowerConstraints, 703);
    const allExercises = [...workout.mainLifts, ...workout.accessories];

    const lowerV2 = ["squat", "hinge", "lunge", "carry"];
    expect(allExercises.length).toBeGreaterThan(0);
    for (const entry of allExercises) {
      const hasLower = (entry.exercise.movementPatterns ?? []).some(
        (p) => lowerV2.includes(p)
      );
      expect(hasLower).toBe(true);
    }
  });

  it("lower day has at least 2 main lifts (squat + hinge)", () => {
    const workout = runNonPplFixture("lower", upperLowerConstraints, 704);

    expect(workout.mainLifts.length).toBeGreaterThanOrEqual(2);
    const patterns = workout.mainLifts.flatMap((l) => l.exercise.movementPatterns ?? []);
    expect(patterns).toContain("squat");
    expect(patterns).toContain("hinge");
  });

  it("respects equipment constraints for upper_lower", () => {
    const limitedEquip: Constraints = {
      ...upperLowerConstraints,
      availableEquipment: ["dumbbell", "bodyweight", "bench"],
    };
    const workout = runNonPplFixture("upper", limitedEquip, 705);
    const allExercises = [...workout.mainLifts, ...workout.accessories];

    for (const entry of allExercises) {
      const hasAllowed = entry.exercise.equipment.some((eq) =>
        limitedEquip.availableEquipment.includes(eq)
      );
      expect(hasAllowed).toBe(true);
    }
  });

  it("timeboxes accessories to fit session budget", () => {
    const fullWorkout = runNonPplFixture("upper", upperLowerConstraints, 706);
    const shortSession: Constraints = {
      ...upperLowerConstraints,
      sessionMinutes: 40,
    };
    const trimmedWorkout = runNonPplFixture("upper", shortSession, 706);

    expect(trimmedWorkout.estimatedMinutes).toBeLessThanOrEqual(40);
    expect(trimmedWorkout.accessories.length).toBeLessThan(fullWorkout.accessories.length);
    // Should still have main lifts even with tight budget
    expect(trimmedWorkout.mainLifts.length).toBeGreaterThan(0);
  });
});

describe("full_body split end-to-end", () => {
  it("includes exercises from multiple movement patterns", () => {
    const workout = runNonPplFixture("full_body", fullBodyConstraints, 801);
    const allExercises = [...workout.mainLifts, ...workout.accessories];
    const patterns = new Set(allExercises.flatMap((e) => e.exercise.movementPatterns ?? []));

    // full_body targets push, pull, squat, hinge, rotate V2 equivalents
    // Should have at least 3 distinct V2 patterns
    expect(patterns.size).toBeGreaterThanOrEqual(3);
    expect(allExercises.length).toBeGreaterThan(0);
  });

  it("has at least 2 main lifts from different patterns", () => {
    const workout = runNonPplFixture("full_body", fullBodyConstraints, 802);

    expect(workout.mainLifts.length).toBeGreaterThanOrEqual(2);
    const mainPatterns = new Set(
      workout.mainLifts.flatMap((l) => l.exercise.movementPatterns ?? [])
    );
    expect(mainPatterns.size).toBeGreaterThanOrEqual(2);
  });

  it("all exercises have loads assigned", () => {
    const workout = runNonPplFixture("full_body", fullBodyConstraints, 803);
    const allExercises = [...workout.mainLifts, ...workout.accessories];

    for (const entry of allExercises) {
      for (const set of entry.sets) {
        expect(set.targetLoad).toBeDefined();
      }
    }
  });

  it("fits within session time budget", () => {
    const workout = runNonPplFixture("full_body", fullBodyConstraints, 804);

    expect(workout.estimatedMinutes).toBeLessThanOrEqual(
      fullBodyConstraints.sessionMinutes
    );
  });

  it("no duplicate exercises in the workout", () => {
    const workout = runNonPplFixture("full_body", fullBodyConstraints, 805);
    const allIds = [
      ...workout.mainLifts.map((e) => e.exercise.id),
      ...workout.accessories.map((e) => e.exercise.id),
    ];
    expect(new Set(allIds).size).toBe(allIds.length);
  });
});
