import { describe, expect, it } from "vitest";
import { applyLoads, type BaselineInput } from "./apply-loads";
import { estimateWorkoutMinutes } from "./timeboxing";
import type { Exercise, WorkoutHistoryEntry, WorkoutPlan } from "./types";

const exercises: Record<string, Exercise> = {
  bench: {
    id: "bench",
    name: "Bench Press",
    movementPatterns: ["horizontal_push"],
    splitTags: ["push"],
    jointStress: "high",
    isMainLiftEligible: true,
    isCompound: true,
    fatigueCost: 4,
    equipment: ["barbell", "bench", "rack"],
    primaryMuscles: ["Chest"],
  },
  row: {
    id: "row",
    name: "Barbell Row",
    movementPatterns: ["horizontal_pull"],
    splitTags: ["pull"],
    jointStress: "medium",
    isMainLiftEligible: true,
    isCompound: true,
    fatigueCost: 4,
    equipment: ["barbell"],
    primaryMuscles: ["Lats", "Rear Delts"],
  },
  facePull: {
    id: "face-pull",
    name: "Face Pull",
    movementPatterns: ["horizontal_pull"],
    splitTags: ["pull"],
    jointStress: "low",
    isMainLiftEligible: false,
    isCompound: false,
    fatigueCost: 2,
    equipment: ["cable"],
    primaryMuscles: ["Rear Delts"],
  },
  lateralRaise: {
    id: "lateral-raise",
    name: "Lateral Raise",
    movementPatterns: ["vertical_push"],
    splitTags: ["push"],
    jointStress: "low",
    isMainLiftEligible: false,
    isCompound: false,
    fatigueCost: 2,
    equipment: ["dumbbell"],
    primaryMuscles: ["Side Delts"],
  },
  legPress: {
    id: "leg-press",
    name: "Leg Press",
    movementPatterns: ["squat"],
    splitTags: ["legs"],
    jointStress: "medium",
    isMainLiftEligible: false,
    isCompound: true,
    fatigueCost: 3,
    equipment: ["machine"],
    primaryMuscles: ["Quads"],
  },
};

const baseWorkout: WorkoutPlan = {
  id: "w1",
  scheduledDate: new Date("2026-02-05T10:00:00Z").toISOString(),
  warmup: [],
  mainLifts: [
    {
      id: "we-bench",
      exercise: exercises.bench,
      orderIndex: 0,
      isMainLift: true,
      sets: [
        { setIndex: 1, targetReps: 12, targetRpe: 7.5 },
        { setIndex: 2, targetReps: 12, targetRpe: 7.5 },
      ],
    },
  ],
  accessories: [
    {
      id: "we-face",
      exercise: exercises.facePull,
      orderIndex: 1,
      isMainLift: false,
      sets: [
        { setIndex: 1, targetReps: 12, targetRpe: 7 },
        { setIndex: 2, targetReps: 12, targetRpe: 7 },
      ],
    },
    {
      id: "we-lat",
      exercise: exercises.lateralRaise,
      orderIndex: 2,
      isMainLift: false,
      sets: [
        { setIndex: 1, targetReps: 12, targetRpe: 7 },
        { setIndex: 2, targetReps: 12, targetRpe: 7 },
      ],
    },
    {
      id: "we-leg",
      exercise: exercises.legPress,
      orderIndex: 3,
      isMainLift: false,
      sets: [
        { setIndex: 1, targetReps: 10, targetRpe: 7 },
        { setIndex: 2, targetReps: 10, targetRpe: 7 },
      ],
    },
  ],
  estimatedMinutes: 45,
};

describe("applyLoads", () => {
  it("uses history-derived load when available and applies back-off multiplier", () => {
    const history: WorkoutHistoryEntry[] = [
      {
        date: new Date("2026-02-04T10:00:00Z").toISOString(),
        completed: true,
        exercises: [
          {
            exerciseId: "bench",
            movementPattern: "push",
            sets: [
              { exerciseId: "bench", setIndex: 1, reps: 12, rpe: 7, load: 100 },
              { exerciseId: "bench", setIndex: 2, reps: 12, rpe: 7, load: 100 },
            ],
          },
        ],
      },
    ];

    const result = applyLoads(baseWorkout, {
      history,
      baselines: [],
      exerciseById: exercises,
      primaryGoal: "hypertrophy",
      profile: { weightKg: 80, trainingAge: "intermediate" },
    });

    expect(result.mainLifts[0].sets[0].targetLoad).toBe(102.5);
    expect(result.mainLifts[0].sets[1].targetLoad).toBe(90);
    expect(result.mainLifts[0].sets.every((set) => set.role === "main")).toBe(true);
    expect(result.accessories.every((exercise) => exercise.role === "accessory")).toBe(true);
    expect(result.accessories.every((exercise) => exercise.sets.every((set) => set.role === "accessory"))).toBe(true);
  });

  it("ignores non-completed history entries when deriving next load", () => {
    const history: WorkoutHistoryEntry[] = [
      {
        date: new Date("2026-02-05T10:00:00Z").toISOString(),
        completed: false,
        status: "PLANNED",
        exercises: [
          {
            exerciseId: "bench",
            movementPattern: "push",
            sets: [
              { exerciseId: "bench", setIndex: 1, reps: 12, rpe: 10, load: 300 },
            ],
          },
        ],
      },
      {
        date: new Date("2026-02-04T10:00:00Z").toISOString(),
        completed: true,
        status: "COMPLETED",
        exercises: [
          {
            exerciseId: "bench",
            movementPattern: "push",
            sets: [
              { exerciseId: "bench", setIndex: 1, reps: 12, rpe: 7, load: 100 },
              { exerciseId: "bench", setIndex: 2, reps: 12, rpe: 7, load: 100 },
            ],
          },
        ],
      },
    ];

    const result = applyLoads(baseWorkout, {
      history,
      baselines: [],
      exerciseById: exercises,
      primaryGoal: "hypertrophy",
      profile: { weightKg: 80, trainingAge: "intermediate" },
    });

    expect(result.mainLifts[0].sets[0].targetLoad).toBe(102.5);
    expect(result.mainLifts[0].sets[1].targetLoad).toBe(90);
  });

  it("uses a strength back-off multiplier of 0.90 for main lifts", () => {
    const history: WorkoutHistoryEntry[] = [
      {
        date: new Date("2026-02-04T10:00:00Z").toISOString(),
        completed: true,
        exercises: [
          {
            exerciseId: "bench",
            movementPattern: "push",
            sets: [
              { exerciseId: "bench", setIndex: 1, reps: 4, rpe: 8, load: 200 },
              { exerciseId: "bench", setIndex: 2, reps: 4, rpe: 8, load: 200 },
            ],
          },
        ],
      },
    ];

    const result = applyLoads(baseWorkout, {
      history,
      baselines: [],
      exerciseById: exercises,
      primaryGoal: "strength",
      profile: { weightKg: 80, trainingAge: "intermediate" },
    });

    expect(result.mainLifts[0].sets[0].targetLoad).toBe(200);
    expect(result.mainLifts[0].sets[1].targetLoad).toBe(180);
  });

  it("falls back to baseline load when history is missing", () => {
    const baselines: BaselineInput[] = [
      {
        exerciseId: "leg-press",
        workingWeightMin: 180,
        workingWeightMax: 200,
        context: "volume",
      },
    ];

    const result = applyLoads(baseWorkout, {
      history: [],
      baselines,
      exerciseById: exercises,
      primaryGoal: "hypertrophy",
      profile: { weightKg: 80, trainingAge: "intermediate" },
    });

    const legPress = result.accessories.find((item) => item.exercise.id === "leg-press");
    expect(legPress?.sets[0].targetLoad).toBe(190);
  });

  it("estimates from same-muscle donor with fatigue scaling", () => {
    const baselines: BaselineInput[] = [
      {
        exerciseId: "row",
        topSetWeight: 180,
        context: "volume",
      },
    ];

    const result = applyLoads(baseWorkout, {
      history: [],
      baselines,
      exerciseById: exercises,
      primaryGoal: "hypertrophy",
      profile: { weightKg: 80, trainingAge: "intermediate" },
    });

    const facePull = result.accessories.find((item) => item.exercise.id === "face-pull");
    expect(facePull?.sets[0].targetLoad).toBe(36);
  });

  it("falls back to bodyweight ratio when no donors exist", () => {
    const result = applyLoads(baseWorkout, {
      history: [],
      baselines: [],
      exerciseById: exercises,
      primaryGoal: "hypertrophy",
      profile: { weightKg: 100, trainingAge: "intermediate" },
    });

    const lateralRaise = result.accessories.find((item) => item.exercise.id === "lateral-raise");
    expect(lateralRaise?.sets[0].targetLoad).toBe(22);
  });

  it("prefers donors with movement pattern overlap", () => {
    // Two donors both overlap on "Chest" muscle with the target (bench press).
    // "machine-press" shares horizontal_push pattern; "chest-fly" does not.
    // Pattern overlap should boost machine-press as donor.
    const extraExercises: Record<string, Exercise> = {
      ...exercises,
      "machine-press": {
        id: "machine-press",
        name: "Machine Chest Press",
        movementPatterns: ["horizontal_push"],
        splitTags: ["push"],
        jointStress: "medium",
        isCompound: true,
        fatigueCost: 3,
        equipment: ["machine"],
        primaryMuscles: ["Chest"],
      },
      "chest-fly": {
        id: "chest-fly",
        name: "Cable Chest Fly",
        movementPatterns: ["vertical_push"],
        splitTags: ["push"],
        jointStress: "low",
        isCompound: false,
        fatigueCost: 2,
        equipment: ["cable"],
        primaryMuscles: ["Chest"],
      },
    };

    const baselines: BaselineInput[] = [
      { exerciseId: "machine-press", topSetWeight: 120, context: "default" },
      { exerciseId: "chest-fly", topSetWeight: 60, context: "default" },
    ];

    const workout: WorkoutPlan = {
      ...baseWorkout,
      mainLifts: [baseWorkout.mainLifts[0]],
      accessories: [],
    };

    const result = applyLoads(workout, {
      history: [],
      baselines,
      exerciseById: extraExercises,
      primaryGoal: "hypertrophy",
      profile: { weightKg: 80, trainingAge: "intermediate" },
    });

    // Bench press (barbell, horizontal_push, compound, chest) should pick
    // machine-press as donor (higher pattern overlap score) over chest-fly.
    // machine-press: muscleOverlap=1*4 + patternOverlap=1*3 + equip=0 + compound=1 = 8
    // chest-fly:     muscleOverlap=1*4 + patternOverlap=0*3 + equip=0 + compound=0 = 4
    const benchLoad = result.mainLifts[0].sets[0].targetLoad;
    expect(benchLoad).toBeDefined();
    // machine-press donor: 120 * equipScale(machine→barbell=1.1) * compoundScale(1.0)
    //   * isolationPenalty(1.0) * fatigueScale(clamp(4/3, 0.45, 0.9)=0.9) = 120*1.1*0.9 = 118.8 → 119
    expect(benchLoad).toBe(119);
  });

  it("adds warmup ramp-up sets for main lifts with resolved load", () => {
    const baselines: BaselineInput[] = [
      { exerciseId: "bench", context: "default", topSetWeight: 200 },
    ];

    const result = applyLoads(baseWorkout, {
      history: [],
      baselines,
      exerciseById: exercises,
      primaryGoal: "hypertrophy",
      profile: { weightKg: 80, trainingAge: "beginner" },
    });

    const warmupSets = result.mainLifts[0].warmupSets;
    expect(warmupSets).toHaveLength(2);
    expect(warmupSets?.[0]).toMatchObject({
      role: "warmup",
      targetReps: 8,
      targetLoad: 120,
      restSeconds: 60,
    });
    expect(warmupSets?.[1]).toMatchObject({
      role: "warmup",
      targetReps: 3,
      targetLoad: 160,
      restSeconds: 90,
    });
  });

  it("uses post-load trim as a safety net when warmup ramps push duration over budget", () => {
    const preLoadMinutes = estimateWorkoutMinutes([
      ...baseWorkout.warmup,
      ...baseWorkout.mainLifts,
      ...baseWorkout.accessories,
    ]);

    const result = applyLoads(baseWorkout, {
      history: [],
      baselines: [{ exerciseId: "bench", context: "default", topSetWeight: 200 }],
      exerciseById: exercises,
      primaryGoal: "hypertrophy",
      profile: { weightKg: 80, trainingAge: "intermediate" },
      sessionMinutes: preLoadMinutes,
    });

    expect(result.accessories.length).toBeLessThan(baseWorkout.accessories.length);
    expect(result.estimatedMinutes).toBeLessThanOrEqual(preLoadMinutes);
  });
});
