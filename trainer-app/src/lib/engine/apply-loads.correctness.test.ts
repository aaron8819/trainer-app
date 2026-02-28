/**
 * Protects: Progression/load assignment correctness (performed-history-driven decisions).
 * Why it matters: Load progression must reward actual performance and ignore unperformed/planned history.
 */
import { describe, expect, it } from "vitest";
import { applyLoads } from "./apply-loads";
import type { Exercise, WorkoutHistoryEntry, WorkoutPlan } from "./types";

const bench: Exercise = {
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
  repRangeMin: 3,
  repRangeMax: 12,
};

const cableCurl: Exercise = {
  id: "cable-curl",
  name: "Cable Curl",
  movementPatterns: ["flexion"],
  splitTags: ["pull"],
  jointStress: "low",
  isMainLiftEligible: false,
  isCompound: false,
  fatigueCost: 1,
  equipment: ["cable"],
  primaryMuscles: ["Biceps"],
  repRangeMin: 8,
  repRangeMax: 15,
};

const bayesianCurl: Exercise = {
  id: "bayesian-curl",
  name: "Bayesian Curl",
  movementPatterns: ["flexion"],
  splitTags: ["pull"],
  jointStress: "low",
  isMainLiftEligible: false,
  isCompound: false,
  fatigueCost: 1,
  equipment: ["cable"],
  primaryMuscles: ["Biceps"],
  repRangeMin: 8,
  repRangeMax: 15,
};

const baseWorkout: WorkoutPlan = {
  id: "w1",
  scheduledDate: "2026-02-20T00:00:00.000Z",
  warmup: [],
  mainLifts: [
    {
      id: "we1",
      exercise: bench,
      orderIndex: 0,
      isMainLift: true,
      sets: [
        { setIndex: 1, targetReps: 10, targetRpe: 8 },
        { setIndex: 2, targetReps: 10, targetRpe: 8 },
      ],
    },
  ],
  accessories: [],
  estimatedMinutes: 45,
};

const accessorySwapWorkout: WorkoutPlan = {
  id: "w2",
  scheduledDate: "2026-02-20T00:00:00.000Z",
  warmup: [],
  mainLifts: [],
  accessories: [
    {
      id: "we2",
      exercise: bayesianCurl,
      orderIndex: 0,
      isMainLift: false,
      sets: [
        { setIndex: 1, targetReps: 12, targetRpe: 8 },
        { setIndex: 2, targetReps: 12, targetRpe: 8 },
        { setIndex: 3, targetReps: 12, targetRpe: 8 },
      ],
    },
  ],
  estimatedMinutes: 30,
};

function makeHistory(completed: boolean): WorkoutHistoryEntry[] {
  return [
    {
      date: "2026-02-19T00:00:00.000Z",
      completed,
      status: completed ? "COMPLETED" : "PLANNED",
      exercises: [
        {
          exerciseId: "bench",
          sets: [
            { exerciseId: "bench", setIndex: 1, reps: 10, rpe: 7.5, load: 200 },
            { exerciseId: "bench", setIndex: 2, reps: 10, rpe: 8, load: 200 },
          ],
        },
      ],
    },
  ];
}

function makePartialHistory(): WorkoutHistoryEntry[] {
  return [
    {
      date: "2026-02-19T00:00:00.000Z",
      completed: false,
      status: "PARTIAL",
      exercises: [
        {
          exerciseId: "bench",
          sets: [
            { exerciseId: "bench", setIndex: 1, reps: 10, rpe: 7.5, load: 200 },
            { exerciseId: "bench", setIndex: 2, reps: 10, rpe: 8, load: 200 },
          ],
        },
      ],
    },
  ];
}

describe("applyLoads correctness", () => {
  it("progresses load from performed history but does not from unperformed history", () => {
    const withPerformed = applyLoads(baseWorkout, {
      history: makeHistory(true),
      baselines: [{ exerciseId: "bench", context: "volume", topSetWeight: 200 }],
      exerciseById: { bench },
      primaryGoal: "hypertrophy",
      profile: { trainingAge: "intermediate" },
    });

    const withUnperformed = applyLoads(baseWorkout, {
      history: makeHistory(false),
      baselines: [{ exerciseId: "bench", context: "volume", topSetWeight: 200 }],
      exerciseById: { bench },
      primaryGoal: "hypertrophy",
      profile: { trainingAge: "intermediate" },
    });

    const performedTop = withPerformed.mainLifts[0].sets[0].targetLoad ?? 0;
    const unperformedTop = withUnperformed.mainLifts[0].sets[0].targetLoad ?? 0;

    expect(performedTop).toBeGreaterThan(200);
    expect(unperformedTop).toBe(200);
  });

  it("treats PARTIAL status as performed history for progression", () => {
    const withPartial = applyLoads(baseWorkout, {
      history: makePartialHistory(),
      baselines: [{ exerciseId: "bench", context: "volume", topSetWeight: 200 }],
      exerciseById: { bench },
      primaryGoal: "hypertrophy",
      profile: { trainingAge: "intermediate" },
    });

    const partialTop = withPartial.mainLifts[0].sets[0].targetLoad ?? 0;
    expect(partialTop).toBeGreaterThan(200);
  });

  it("uses same-pattern performed donor load for non-avoided swap instead of cold defaults", () => {
    const swapped = applyLoads(accessorySwapWorkout, {
      history: [
        {
          date: "2026-02-19T00:00:00.000Z",
          completed: true,
          status: "COMPLETED",
          sessionIntent: "pull",
          exercises: [
            {
              exerciseId: "cable-curl",
              sets: [
                { exerciseId: "cable-curl", setIndex: 1, reps: 10, rpe: 7.5, load: 30 },
                { exerciseId: "cable-curl", setIndex: 2, reps: 10, rpe: 8, load: 30 },
              ],
            },
          ],
        },
      ],
      baselines: [],
      exerciseById: {
        "cable-curl": cableCurl,
        "bayesian-curl": bayesianCurl,
      },
      primaryGoal: "hypertrophy",
      profile: { trainingAge: "intermediate" },
    });

    const swappedLoad = swapped.accessories[0].sets[0].targetLoad ?? 0;
    expect(swappedLoad).toBeGreaterThanOrEqual(18);
    expect(swappedLoad).toBeLessThanOrEqual(21);
    expect(swappedLoad).not.toBe(40);
  });

  it("anchors progression to the modal performed load in the latest session", () => {
    const cablePullover: Exercise = {
      id: "cable-pullover",
      name: "Cable Pullover",
      movementPatterns: ["vertical_pull"],
      splitTags: ["pull"],
      jointStress: "low",
      isMainLiftEligible: false,
      isCompound: false,
      fatigueCost: 2,
      equipment: ["cable"],
      primaryMuscles: ["Lats"],
      repRangeMin: 8,
      repRangeMax: 15,
    };

    const workout: WorkoutPlan = {
      id: "w3",
      scheduledDate: "2026-02-20T00:00:00.000Z",
      warmup: [],
      mainLifts: [],
      accessories: [
        {
          id: "we3",
          exercise: cablePullover,
          orderIndex: 0,
          isMainLift: false,
          sets: [
            { setIndex: 1, targetReps: 10, targetRpe: 8 },
            { setIndex: 2, targetReps: 10, targetRpe: 8 },
            { setIndex: 3, targetReps: 10, targetRpe: 8 },
            { setIndex: 4, targetReps: 10, targetRpe: 8 },
            { setIndex: 5, targetReps: 10, targetRpe: 8 },
          ],
        },
      ],
      estimatedMinutes: 30,
    };

    const result = applyLoads(workout, {
      history: [
        {
          date: "2026-02-19T00:00:00.000Z",
          completed: true,
          status: "COMPLETED",
          sessionIntent: "pull",
          exercises: [
            {
              exerciseId: "cable-pullover",
              sets: [
                { exerciseId: "cable-pullover", setIndex: 1, reps: 10, rpe: 7.5, load: 35 },
                { exerciseId: "cable-pullover", setIndex: 2, reps: 10, rpe: 8, load: 40 },
                { exerciseId: "cable-pullover", setIndex: 3, reps: 10, rpe: 8, load: 40 },
                { exerciseId: "cable-pullover", setIndex: 4, reps: 10, rpe: 8, load: 40 },
                { exerciseId: "cable-pullover", setIndex: 5, reps: 10, rpe: 8, load: 40 },
              ],
            },
          ],
        },
      ],
      baselines: [],
      exerciseById: { "cable-pullover": cablePullover },
      primaryGoal: "hypertrophy",
      profile: { trainingAge: "intermediate" },
    });

    expect(result.accessories[0].sets[0].targetLoad).toBe(40);
  });

  it("scopes modal load anchoring to the most recent same-intent session", () => {
    const row: Exercise = {
      id: "row",
      name: "Row",
      movementPatterns: ["horizontal_pull"],
      splitTags: ["pull"],
      jointStress: "medium",
      isMainLiftEligible: true,
      isCompound: true,
      fatigueCost: 3,
      equipment: ["machine"],
      primaryMuscles: ["Upper Back"],
      repRangeMin: 6,
      repRangeMax: 12,
    };
    const workout: WorkoutPlan = {
      id: "w4",
      scheduledDate: "2026-02-20T00:00:00.000Z",
      warmup: [],
      mainLifts: [
        {
          id: "we4",
          exercise: row,
          orderIndex: 0,
          isMainLift: true,
          sets: [{ setIndex: 1, targetReps: 8, targetRpe: 8 }],
        },
      ],
      accessories: [],
      estimatedMinutes: 30,
    };

    const result = applyLoads(workout, {
      history: [
        {
          date: "2026-02-19T00:00:00.000Z",
          completed: true,
          status: "COMPLETED",
          sessionIntent: "push",
          exercises: [{ exerciseId: "row", sets: [{ exerciseId: "row", setIndex: 1, reps: 8, rpe: 8, load: 80 }] }],
        },
        {
          date: "2026-02-18T00:00:00.000Z",
          completed: true,
          status: "COMPLETED",
          sessionIntent: "pull",
          exercises: [{ exerciseId: "row", sets: [{ exerciseId: "row", setIndex: 1, reps: 8, rpe: 8, load: 60 }] }],
        },
      ],
      baselines: [],
      exerciseById: { row },
      primaryGoal: "hypertrophy",
      profile: { trainingAge: "intermediate" },
      sessionIntent: "pull",
    });

    expect(result.mainLifts[0].sets[0].targetLoad).toBe(60);
  });

  it("holds load when latest same-intent modal RPE is >= 9", () => {
    const row: Exercise = {
      id: "row",
      name: "Row",
      movementPatterns: ["horizontal_pull"],
      splitTags: ["pull"],
      jointStress: "medium",
      isMainLiftEligible: true,
      isCompound: true,
      fatigueCost: 3,
      equipment: ["machine"],
      primaryMuscles: ["Upper Back"],
      repRangeMin: 6,
      repRangeMax: 12,
    };
    const workout: WorkoutPlan = {
      id: "w5",
      scheduledDate: "2026-02-20T00:00:00.000Z",
      warmup: [],
      mainLifts: [
        {
          id: "we5",
          exercise: row,
          orderIndex: 0,
          isMainLift: true,
          sets: [{ setIndex: 1, targetReps: 10, targetRpe: 8 }],
        },
      ],
      accessories: [],
      estimatedMinutes: 30,
    };

    const result = applyLoads(workout, {
      history: [
        {
          date: "2026-02-19T00:00:00.000Z",
          completed: true,
          status: "COMPLETED",
          sessionIntent: "pull",
          exercises: [
            {
              exerciseId: "row",
              sets: [
                { exerciseId: "row", setIndex: 1, reps: 12, rpe: 9.5, load: 70 },
                { exerciseId: "row", setIndex: 2, reps: 12, rpe: 9.5, load: 70 },
              ],
            },
          ],
        },
      ],
      baselines: [],
      exerciseById: { row },
      primaryGoal: "hypertrophy",
      profile: { trainingAge: "intermediate" },
      sessionIntent: "pull",
    });

    expect(result.mainLifts[0].sets[0].targetLoad).toBe(70);
  });

  it("applies load increment when reps hit top of range at submaximal RPE (double progression)", () => {
    const inclineBarbell: Exercise = {
      id: "incline-barbell",
      name: "Incline Barbell Press",
      movementPatterns: ["horizontal_push"],
      splitTags: ["push"],
      jointStress: "medium",
      isMainLiftEligible: true,
      isCompound: true,
      fatigueCost: 4,
      equipment: ["barbell", "bench"],
      primaryMuscles: ["Chest"],
      repRangeMin: 6,
      repRangeMax: 10,
    };
    const workout: WorkoutPlan = {
      id: "w7",
      scheduledDate: "2026-02-20T00:00:00.000Z",
      warmup: [],
      mainLifts: [
        {
          id: "we7",
          exercise: inclineBarbell,
          orderIndex: 0,
          isMainLift: true,
          sets: [{ setIndex: 1, targetReps: 10, targetRpe: 8 }],
        },
      ],
      accessories: [],
      estimatedMinutes: 30,
    };

    const result = applyLoads(workout, {
      history: [
        {
          date: "2026-02-19T00:00:00.000Z",
          completed: true,
          status: "COMPLETED",
          sessionIntent: "push",
          exercises: [
            {
              exerciseId: "incline-barbell",
              sets: [
                { exerciseId: "incline-barbell", setIndex: 1, reps: 10, rpe: 7.5, load: 185 },
                { exerciseId: "incline-barbell", setIndex: 2, reps: 10, rpe: 8, load: 185 },
                { exerciseId: "incline-barbell", setIndex: 3, reps: 10, rpe: 8, load: 185 },
              ],
            },
          ],
        },
      ],
      baselines: [],
      exerciseById: { "incline-barbell": inclineBarbell },
      primaryGoal: "hypertrophy",
      profile: { trainingAge: "intermediate" },
      sessionIntent: "push",
    });

    expect(result.mainLifts[0].sets[0].targetLoad).toBe(189);
  });

  it("uses conservative modal anchor when prior session has high load variance", () => {
    const inclineDb: Exercise = {
      id: "incline-db",
      name: "Incline DB Press",
      movementPatterns: ["horizontal_push"],
      splitTags: ["push"],
      jointStress: "medium",
      isMainLiftEligible: false,
      isCompound: false,
      fatigueCost: 2,
      equipment: ["dumbbell", "bench"],
      primaryMuscles: ["Chest"],
      repRangeMin: 8,
      repRangeMax: 12,
    };
    const workout: WorkoutPlan = {
      id: "w8",
      scheduledDate: "2026-02-20T00:00:00.000Z",
      warmup: [],
      mainLifts: [],
      accessories: [
        {
          id: "we8",
          exercise: inclineDb,
          orderIndex: 0,
          isMainLift: false,
          sets: [{ setIndex: 1, targetReps: 12, targetRpe: 8 }],
        },
      ],
      estimatedMinutes: 30,
    };

    const result = applyLoads(workout, {
      history: [
        {
          date: "2026-02-19T00:00:00.000Z",
          completed: true,
          status: "COMPLETED",
          sessionIntent: "push",
          exercises: [
            {
              exerciseId: "incline-db",
              sets: [
                { exerciseId: "incline-db", setIndex: 1, reps: 12, rpe: 7.5, load: 45 },
                { exerciseId: "incline-db", setIndex: 2, reps: 12, rpe: 8, load: 50 },
                { exerciseId: "incline-db", setIndex: 3, reps: 12, rpe: 8, load: 50 },
                { exerciseId: "incline-db", setIndex: 4, reps: 8, rpe: 9, load: 60 },
              ],
            },
          ],
        },
      ],
      baselines: [],
      exerciseById: { "incline-db": inclineDb },
      primaryGoal: "hypertrophy",
      profile: { trainingAge: "intermediate" },
      sessionIntent: "push",
    });

    expect(result.accessories[0].sets[0].targetLoad).toBe(50);
  });

  it("ignores RPE < 6 warmup sets when anchoring modal progression load", () => {
    const rearDelt: Exercise = {
      id: "rear-delt-fly",
      name: "Cable Rear Delt Fly",
      movementPatterns: ["horizontal_pull", "isolation"],
      splitTags: ["pull"],
      jointStress: "low",
      isMainLiftEligible: false,
      isCompound: false,
      fatigueCost: 1,
      equipment: ["cable"],
      primaryMuscles: ["Rear Delts"],
      repRangeMin: 12,
      repRangeMax: 20,
    };
    const workout: WorkoutPlan = {
      id: "w9",
      scheduledDate: "2026-02-20T00:00:00.000Z",
      warmup: [],
      mainLifts: [],
      accessories: [
        {
          id: "we9",
          exercise: rearDelt,
          orderIndex: 0,
          isMainLift: false,
          sets: [{ setIndex: 1, targetReps: 15, targetRpe: 8 }],
        },
      ],
      estimatedMinutes: 25,
    };

    const result = applyLoads(workout, {
      history: [
        {
          date: "2026-02-19T00:00:00.000Z",
          completed: true,
          status: "COMPLETED",
          sessionIntent: "pull",
          exercises: [
            {
              exerciseId: "rear-delt-fly",
              sets: [
                { exerciseId: "rear-delt-fly", setIndex: 1, reps: 15, rpe: 5, load: 10 },
                { exerciseId: "rear-delt-fly", setIndex: 2, reps: 15, rpe: 8, load: 20 },
                { exerciseId: "rear-delt-fly", setIndex: 3, reps: 15, rpe: 8, load: 20 },
              ],
            },
          ],
        },
      ],
      baselines: [],
      exerciseById: { "rear-delt-fly": rearDelt },
      primaryGoal: "hypertrophy",
      profile: { trainingAge: "intermediate" },
      sessionIntent: "pull",
    });

    expect(result.accessories[0].sets[0].targetLoad).toBe(22);
  });

  it("treats 0 lb performed load as valid for bodyweight continuity anchors", () => {
    const dip: Exercise = {
      id: "dip-chest",
      name: "Dip (Chest Emphasis)",
      movementPatterns: ["horizontal_push"],
      splitTags: ["push"],
      jointStress: "medium",
      isMainLiftEligible: false,
      isCompound: false,
      fatigueCost: 2,
      equipment: ["bodyweight"],
      primaryMuscles: ["Chest", "Triceps"],
      repRangeMin: 6,
      repRangeMax: 15,
    };

    const workout: WorkoutPlan = {
      id: "w6",
      scheduledDate: "2026-02-20T00:00:00.000Z",
      warmup: [],
      mainLifts: [],
      accessories: [
        {
          id: "we6",
          exercise: dip,
          orderIndex: 0,
          isMainLift: false,
          sets: [
            { setIndex: 1, targetReps: 10, targetRpe: 8 },
            { setIndex: 2, targetReps: 10, targetRpe: 8 },
            { setIndex: 3, targetReps: 10, targetRpe: 8 },
          ],
        },
      ],
      estimatedMinutes: 30,
    };

    const result = applyLoads(workout, {
      history: [
        {
          date: "2026-02-18T00:00:00.000Z",
          completed: true,
          status: "COMPLETED",
          sessionIntent: "push",
          exercises: [
            {
              exerciseId: "dip-chest",
              sets: [
                { exerciseId: "dip-chest", setIndex: 1, reps: 10, rpe: 7, load: 0 },
                { exerciseId: "dip-chest", setIndex: 2, reps: 10, rpe: 8, load: 0 },
                { exerciseId: "dip-chest", setIndex: 3, reps: 10, rpe: 8, load: 0 },
              ],
            },
          ],
        },
      ],
      baselines: [{ exerciseId: "dip-chest", context: "volume", topSetWeight: 93.5 }],
      exerciseById: { "dip-chest": dip },
      primaryGoal: "hypertrophy",
      profile: { trainingAge: "intermediate" },
      sessionIntent: "push",
    });

    expect(result.accessories[0].sets[0].targetLoad).toBe(0);
  });

  it("weights MANUAL modal history at 0.7 vs INTENT when both exist", () => {
    const cableRaise: Exercise = {
      id: "cable-raise",
      name: "Cable Raise",
      movementPatterns: ["abduction"],
      splitTags: ["push"],
      jointStress: "low",
      isMainLiftEligible: false,
      isCompound: false,
      fatigueCost: 1,
      equipment: ["cable"],
      primaryMuscles: ["Side Delts"],
      repRangeMin: 8,
      repRangeMax: 15,
    };
    const workout: WorkoutPlan = {
      id: "w10",
      scheduledDate: "2026-02-20T00:00:00.000Z",
      warmup: [],
      mainLifts: [],
      accessories: [
        {
          id: "we10",
          exercise: cableRaise,
          orderIndex: 0,
          isMainLift: false,
          sets: [{ setIndex: 1, targetReps: 12, targetRpe: 8 }],
        },
      ],
      estimatedMinutes: 20,
    };

    const result = applyLoads(workout, {
      history: [
        {
          date: "2026-02-19T00:00:00.000Z",
          completed: true,
          status: "COMPLETED",
          selectionMode: "MANUAL",
          exercises: [{ exerciseId: "cable-raise", sets: [{ exerciseId: "cable-raise", setIndex: 1, reps: 12, rpe: 8, load: 30 }] }],
        },
        {
          date: "2026-02-18T00:00:00.000Z",
          completed: true,
          status: "COMPLETED",
          selectionMode: "INTENT",
          exercises: [{ exerciseId: "cable-raise", sets: [{ exerciseId: "cable-raise", setIndex: 1, reps: 12, rpe: 8, load: 40 }] }],
        },
      ],
      baselines: [],
      exerciseById: { "cable-raise": cableRaise },
      primaryGoal: "hypertrophy",
      profile: { trainingAge: "intermediate" },
    });

    expect(result.accessories[0].sets[0].targetLoad).toBe(40);
  });

  it("uses MANUAL-only history at full weight when no INTENT history exists", () => {
    const cableRaise: Exercise = {
      id: "manual-only-raise",
      name: "Manual Only Raise",
      movementPatterns: ["abduction"],
      splitTags: ["push"],
      jointStress: "low",
      isMainLiftEligible: false,
      isCompound: false,
      fatigueCost: 1,
      equipment: ["cable"],
      primaryMuscles: ["Side Delts"],
      repRangeMin: 8,
      repRangeMax: 15,
    };
    const workout: WorkoutPlan = {
      id: "w11",
      scheduledDate: "2026-02-20T00:00:00.000Z",
      warmup: [],
      mainLifts: [],
      accessories: [
        {
          id: "we11",
          exercise: cableRaise,
          orderIndex: 0,
          isMainLift: false,
          sets: [{ setIndex: 1, targetReps: 15, targetRpe: 8 }],
        },
      ],
      estimatedMinutes: 20,
    };

    const result = applyLoads(workout, {
      history: [
        {
          date: "2026-02-19T00:00:00.000Z",
          completed: true,
          status: "COMPLETED",
          selectionMode: "MANUAL",
          exercises: [{ exerciseId: "manual-only-raise", sets: [{ exerciseId: "manual-only-raise", setIndex: 1, reps: 15, rpe: 7, load: 40 }] }],
        },
        {
          date: "2026-02-18T00:00:00.000Z",
          completed: true,
          status: "COMPLETED",
          selectionMode: "MANUAL",
          exercises: [{ exerciseId: "manual-only-raise", sets: [{ exerciseId: "manual-only-raise", setIndex: 1, reps: 15, rpe: 7, load: 35 }] }],
        },
      ],
      baselines: [],
      exerciseById: { "manual-only-raise": cableRaise },
      primaryGoal: "hypertrophy",
      profile: { trainingAge: "intermediate" },
    });

    expect(result.accessories[0].sets[0].targetLoad).toBe(42.5);
  });

  it("uses W4 accumulation history (not deload history) as baseline source on a new mesocycle start", () => {
    const result = applyLoads(baseWorkout, {
      history: [
        {
          date: "2026-02-25T00:00:00.000Z",
          completed: true,
          status: "COMPLETED",
          sessionIntent: "push",
          mesocyclePhaseSnapshot: "DELOAD",
          mesocycleWeekSnapshot: 5,
          exercises: [
            {
              exerciseId: "bench",
              sets: [{ exerciseId: "bench", setIndex: 1, reps: 10, rpe: 8, load: 95 }],
            },
          ],
        } as WorkoutHistoryEntry,
        {
          date: "2026-02-20T00:00:00.000Z",
          completed: true,
          status: "COMPLETED",
          sessionIntent: "push",
          mesocyclePhaseSnapshot: "ACCUMULATION",
          mesocycleWeekSnapshot: 4,
          exercises: [
            {
              exerciseId: "bench",
              sets: [{ exerciseId: "bench", setIndex: 1, reps: 10, rpe: 8, load: 200 }],
            },
          ],
        } as WorkoutHistoryEntry,
      ],
      baselines: [],
      exerciseById: { bench },
      primaryGoal: "hypertrophy",
      profile: { trainingAge: "intermediate" },
      sessionIntent: "push",
      accumulationSessionsCompleted: 0,
    });

    expect(result.mainLifts[0].sets[0].targetLoad).toBe(204);
  });

  it("falls back from missing W4 to highest accumulation week, then to non-deload performed history", () => {
    const w4MissingResult = applyLoads(baseWorkout, {
      history: [
        {
          date: "2026-02-25T00:00:00.000Z",
          completed: true,
          status: "COMPLETED",
          sessionIntent: "push",
          mesocyclePhaseSnapshot: "DELOAD",
          mesocycleWeekSnapshot: 5,
          exercises: [
            {
              exerciseId: "bench",
              sets: [{ exerciseId: "bench", setIndex: 1, reps: 10, rpe: 8, load: 95 }],
            },
          ],
        } as WorkoutHistoryEntry,
        {
          date: "2026-02-22T00:00:00.000Z",
          completed: true,
          status: "COMPLETED",
          sessionIntent: "push",
          mesocyclePhaseSnapshot: "ACCUMULATION",
          mesocycleWeekSnapshot: 3,
          exercises: [
            {
              exerciseId: "bench",
              sets: [{ exerciseId: "bench", setIndex: 1, reps: 10, rpe: 8, load: 170 }],
            },
          ],
        } as WorkoutHistoryEntry,
        {
          date: "2026-02-18T00:00:00.000Z",
          completed: true,
          status: "COMPLETED",
          sessionIntent: "push",
          mesocyclePhaseSnapshot: "ACCUMULATION",
          mesocycleWeekSnapshot: 2,
          exercises: [
            {
              exerciseId: "bench",
              sets: [{ exerciseId: "bench", setIndex: 1, reps: 10, rpe: 8, load: 150 }],
            },
          ],
        } as WorkoutHistoryEntry,
      ],
      baselines: [],
      exerciseById: { bench },
      primaryGoal: "hypertrophy",
      profile: { trainingAge: "intermediate" },
      sessionIntent: "push",
      accumulationSessionsCompleted: 0,
    });

    const noAccumulationSnapshotResult = applyLoads(baseWorkout, {
      history: [
        {
          date: "2026-02-25T00:00:00.000Z",
          completed: true,
          status: "COMPLETED",
          sessionIntent: "push",
          mesocyclePhaseSnapshot: "ACTIVE_DELOAD",
          mesocycleWeekSnapshot: 5,
          exercises: [
            {
              exerciseId: "bench",
              sets: [{ exerciseId: "bench", setIndex: 1, reps: 10, rpe: 8, load: 90 }],
            },
          ],
        } as WorkoutHistoryEntry,
        {
          date: "2026-02-21T00:00:00.000Z",
          completed: true,
          status: "COMPLETED",
          sessionIntent: "push",
          exercises: [
            {
              exerciseId: "bench",
              sets: [{ exerciseId: "bench", setIndex: 1, reps: 10, rpe: 8, load: 160 }],
            },
          ],
        } as WorkoutHistoryEntry,
      ],
      baselines: [],
      exerciseById: { bench },
      primaryGoal: "hypertrophy",
      profile: { trainingAge: "intermediate" },
      sessionIntent: "push",
      accumulationSessionsCompleted: 0,
    });

    expect(w4MissingResult.mainLifts[0].sets[0].targetLoad).toBe(174);
    expect(noAccumulationSnapshotResult.mainLifts[0].sets[0].targetLoad).toBe(164);
  });

  it("getTopSessionLoad returns same result for 0-based and 1-based setIndex history", () => {
    // Regression: MANUAL backfill scripts historically wrote setIndex starting at 0.
    // applyLoads must anchor progression from the first (top) set regardless of whether
    // history uses 0-based or 1-based setIndex.
    const zeroBased = applyLoads(baseWorkout, {
      history: [
        {
          date: "2026-02-19T00:00:00.000Z",
          completed: true,
          status: "COMPLETED",
          exercises: [
            {
              exerciseId: "bench",
              sets: [
                { exerciseId: "bench", setIndex: 0, reps: 10, rpe: 7.5, load: 200 },
                { exerciseId: "bench", setIndex: 1, reps: 10, rpe: 8, load: 200 },
              ],
            },
          ],
        },
      ],
      baselines: [{ exerciseId: "bench", context: "volume", topSetWeight: 200 }],
      exerciseById: { bench },
      primaryGoal: "hypertrophy",
      profile: { trainingAge: "intermediate" },
    });

    const oneBased = applyLoads(baseWorkout, {
      history: [
        {
          date: "2026-02-19T00:00:00.000Z",
          completed: true,
          status: "COMPLETED",
          exercises: [
            {
              exerciseId: "bench",
              sets: [
                { exerciseId: "bench", setIndex: 1, reps: 10, rpe: 7.5, load: 200 },
                { exerciseId: "bench", setIndex: 2, reps: 10, rpe: 8, load: 200 },
              ],
            },
          ],
        },
      ],
      baselines: [{ exerciseId: "bench", context: "volume", topSetWeight: 200 }],
      exerciseById: { bench },
      primaryGoal: "hypertrophy",
      profile: { trainingAge: "intermediate" },
    });

    const zeroBasedTop = zeroBased.mainLifts[0].sets[0].targetLoad;
    const oneBasedTop = oneBased.mainLifts[0].sets[0].targetLoad;
    // Both should progress above 200 (top set RPE 7.5 → double progression)
    expect(zeroBasedTop).toBeGreaterThan(200);
    expect(zeroBasedTop).toBe(oneBasedTop);
  });
});
