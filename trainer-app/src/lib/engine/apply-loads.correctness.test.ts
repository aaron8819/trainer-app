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
});
