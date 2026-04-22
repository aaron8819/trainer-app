/**
 * Protects: Progression/load assignment correctness (performed-history-driven decisions).
 * Why it matters: Load progression must reward actual performance and ignore unperformed/planned history.
 */
import { describe, expect, it } from "vitest";
import { applyLoads, applyLoadsWithAudit } from "./apply-loads";
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

const cableMachineCurl: Exercise = {
  ...cableCurl,
  id: "cable-machine-curl",
  name: "Cable Machine Curl",
  equipment: ["machine", "cable"],
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

const dumbbellOverheadPress: Exercise = {
  id: "db-ohp",
  name: "Dumbbell Overhead Press",
  movementPatterns: ["vertical_push"],
  splitTags: ["push"],
  jointStress: "medium",
  isMainLiftEligible: true,
  isCompound: true,
  fatigueCost: 3,
  equipment: ["dumbbell", "bench"],
  primaryMuscles: ["Front Delts", "Triceps"],
  repRangeMin: 6,
  repRangeMax: 10,
};

const beltSquat: Exercise = {
  id: "belt-squat",
  name: "Belt Squat",
  movementPatterns: ["squat"],
  splitTags: ["legs"],
  jointStress: "medium",
  isMainLiftEligible: true,
  isCompound: true,
  fatigueCost: 3,
  equipment: ["machine"],
  primaryMuscles: ["Quads", "Glutes"],
  repRangeMin: 6,
  repRangeMax: 12,
};

const backSquat: Exercise = {
  id: "back-squat",
  name: "Barbell Back Squat",
  movementPatterns: ["squat"],
  splitTags: ["legs"],
  jointStress: "high",
  isMainLiftEligible: true,
  isCompound: true,
  fatigueCost: 4,
  equipment: ["barbell", "rack"],
  primaryMuscles: ["Quads", "Glutes"],
  repRangeMin: 5,
  repRangeMax: 10,
};

const latPulldown: Exercise = {
  id: "lat-pulldown",
  name: "Lat Pulldown",
  movementPatterns: ["vertical_pull"],
  splitTags: ["pull"],
  jointStress: "medium",
  isMainLiftEligible: true,
  isCompound: true,
  fatigueCost: 3,
  equipment: ["cable"],
  primaryMuscles: ["Lats", "Upper Back"],
  repRangeMin: 6,
  repRangeMax: 12,
};

const stiffLegDeadlift: Exercise = {
  id: "sldl",
  name: "Stiff-Leg Deadlift",
  movementPatterns: ["hinge"],
  splitTags: ["legs"],
  jointStress: "high",
  isMainLiftEligible: true,
  isCompound: true,
  fatigueCost: 4,
  equipment: ["barbell"],
  primaryMuscles: ["Hamstrings", "Glutes"],
  repRangeMin: 6,
  repRangeMax: 10,
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

const upperMainLiftWorkout: WorkoutPlan = {
  id: "w-upper-main",
  scheduledDate: "2026-03-28T00:00:00.000Z",
  warmup: [],
  mainLifts: [
    {
      id: "we-upper-main",
      exercise: dumbbellOverheadPress,
      orderIndex: 0,
      isMainLift: true,
      sets: [
        { setIndex: 1, targetReps: 10, targetRpe: 6.5 },
        { setIndex: 2, targetReps: 10, targetRpe: 6.5 },
        { setIndex: 3, targetReps: 10, targetRpe: 6.5 },
      ],
    },
  ],
  accessories: [],
  estimatedMinutes: 35,
};

const upperAccessoryWorkout: WorkoutPlan = {
  id: "w-upper-accessory",
  scheduledDate: "2026-03-28T00:00:00.000Z",
  warmup: [],
  mainLifts: [],
  accessories: [
    {
      id: "we-upper-accessory",
      exercise: cableCurl,
      orderIndex: 0,
      isMainLift: false,
      sets: [
        { setIndex: 1, targetReps: 12, targetRpe: 8 },
        { setIndex: 2, targetReps: 12, targetRpe: 8 },
      ],
    },
  ],
  estimatedMinutes: 20,
};

const lowerMainLiftWorkout: WorkoutPlan = {
  id: "w-lower-main",
  scheduledDate: "2026-03-26T00:00:00.000Z",
  warmup: [],
  mainLifts: [
    {
      id: "we-lower-main",
      exercise: beltSquat,
      orderIndex: 0,
      isMainLift: true,
      sets: [
        { setIndex: 1, targetReps: 10, targetRpe: 6.5 },
        { setIndex: 2, targetReps: 10, targetRpe: 6.5 },
        { setIndex: 3, targetReps: 10, targetRpe: 6.5 },
      ],
    },
  ],
  accessories: [],
  estimatedMinutes: 35,
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

  it("ignores supplemental deficit sessions for progression anchors", () => {
    const result = applyLoads(baseWorkout, {
      history: [
        {
          date: "2026-02-20T00:00:00.000Z",
          completed: true,
          status: "COMPLETED",
          progressionEligible: false,
          sessionIntent: "push",
          exercises: [
            {
              exerciseId: "bench",
              sets: [
                { exerciseId: "bench", setIndex: 1, reps: 10, rpe: 8, load: 240 },
                { exerciseId: "bench", setIndex: 2, reps: 10, rpe: 8, load: 240 },
              ],
            },
          ],
        },
        {
          date: "2026-02-18T00:00:00.000Z",
          completed: true,
          status: "COMPLETED",
          progressionEligible: true,
          sessionIntent: "push",
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
      sessionIntent: "push",
    });

    expect(result.mainLifts[0].sets[0].targetLoad).toBe(205);
  });

  it("falls back to canonical deload load reduction when no accumulation history exists", () => {
    const deloadWorkout: WorkoutPlan = {
      id: "w-deload",
      scheduledDate: "2026-02-27T00:00:00.000Z",
      warmup: [],
      mainLifts: [
        {
          id: "we-deload-main",
          exercise: bench,
          orderIndex: 0,
          isMainLift: true,
          sets: [
            { setIndex: 1, targetReps: 8, targetRpe: 5 },
            { setIndex: 2, targetReps: 8, targetRpe: 5 },
          ],
        },
      ],
      accessories: [
        {
          id: "we-deload-accessory",
          exercise: cableCurl,
          orderIndex: 1,
          isMainLift: false,
          sets: [{ setIndex: 1, targetReps: 12, targetRpe: 5 }],
        },
      ],
      estimatedMinutes: 30,
    };

    const result = applyLoads(deloadWorkout, {
      history: [
        {
          date: "2026-02-20T00:00:00.000Z",
          completed: true,
          status: "COMPLETED",
          sessionIntent: "push",
          exercises: [
            {
              exerciseId: "bench",
              sets: [
                { exerciseId: "bench", setIndex: 1, reps: 10, rpe: 8, load: 200 },
                { exerciseId: "bench", setIndex: 2, reps: 10, rpe: 8, load: 180 },
              ],
            },
            {
              exerciseId: "cable-curl",
              sets: [
                { exerciseId: "cable-curl", setIndex: 1, reps: 12, rpe: 8, load: 40 },
                { exerciseId: "cable-curl", setIndex: 2, reps: 12, rpe: 8, load: 40 },
              ],
            },
          ],
        },
      ],
      baselines: [],
      exerciseById: { bench, "cable-curl": cableCurl },
      primaryGoal: "hypertrophy",
      profile: { trainingAge: "intermediate" },
      sessionIntent: "push",
      periodization: {
        rpeOffset: -2,
        setMultiplier: 0.5,
        backOffMultiplier: 0.75,
        isDeload: true,
      },
    });

    expect(result.mainLifts[0].sets.map((set) => set.targetLoad)).toEqual([155, 155]);
    expect(result.accessories[0].sets[0].targetLoad).toBe(30);
  });

  it("anchors deload load-down to the last performed accumulation load instead of the progression candidate", () => {
    const deloadWorkout: WorkoutPlan = {
      id: "w-deload-accumulation-anchor",
      scheduledDate: "2026-02-27T00:00:00.000Z",
      warmup: [],
      mainLifts: [
        {
          id: "we-deload-anchor-main",
          exercise: bench,
          orderIndex: 0,
          isMainLift: true,
          sets: [
            { setIndex: 1, targetReps: 8, targetRpe: 5 },
            { setIndex: 2, targetReps: 8, targetRpe: 5 },
          ],
        },
      ],
      accessories: [
        {
          id: "we-deload-anchor-accessory",
          exercise: cableCurl,
          orderIndex: 1,
          isMainLift: false,
          sets: [{ setIndex: 1, targetReps: 12, targetRpe: 5 }],
        },
      ],
      estimatedMinutes: 30,
    };

    const result = applyLoads(deloadWorkout, {
      history: [
        {
          date: "2026-02-22T00:00:00.000Z",
          completed: true,
          status: "COMPLETED",
          sessionIntent: "push",
          mesocycleSnapshot: { phase: "ACCUMULATION", week: 4 },
          exercises: [
            {
              exerciseId: "bench",
              sets: [
                { exerciseId: "bench", setIndex: 1, reps: 10, rpe: 8, load: 200 },
                { exerciseId: "bench", setIndex: 2, reps: 10, rpe: 8, load: 180 },
              ],
            },
          ],
        },
        {
          date: "2026-02-18T00:00:00.000Z",
          completed: true,
          status: "COMPLETED",
          sessionIntent: "push",
          mesocycleSnapshot: { phase: "ACCUMULATION", week: 3 },
          exercises: [
            {
              exerciseId: "cable-curl",
              sets: [
                { exerciseId: "cable-curl", setIndex: 1, reps: 12, rpe: 8, load: 42 },
                { exerciseId: "cable-curl", setIndex: 2, reps: 12, rpe: 8, load: 42 },
              ],
            },
          ],
        },
      ],
      baselines: [],
      exerciseById: { bench, "cable-curl": cableCurl },
      primaryGoal: "hypertrophy",
      profile: { trainingAge: "intermediate" },
      sessionIntent: "push",
      periodization: {
        rpeOffset: -2,
        setMultiplier: 0.5,
        backOffMultiplier: 0.75,
        isDeload: true,
      },
    });

    expect(result.mainLifts[0].sets.map((set) => set.targetLoad)).toEqual([150, 150]);
    expect(result.accessories[0].sets[0].targetLoad).toBe(32.5);
  });

  it("overrides prefilled target loads during deload so upstream callers cannot bypass the accumulation-anchored load-down", () => {
    const prefilledDeload: WorkoutPlan = {
      id: "w-prefilled-deload",
      scheduledDate: "2026-02-27T00:00:00.000Z",
      warmup: [],
      mainLifts: [
        {
          id: "we-prefilled-deload",
          exercise: bench,
          orderIndex: 0,
          isMainLift: true,
          sets: [{ setIndex: 1, targetReps: 8, targetRpe: 5, targetLoad: 200 }],
        },
      ],
      accessories: [],
      estimatedMinutes: 20,
    };

    const result = applyLoads(prefilledDeload, {
      history: [
        {
          date: "2026-02-20T00:00:00.000Z",
          completed: true,
          status: "COMPLETED",
          mesocycleSnapshot: { phase: "ACCUMULATION", week: 4 },
          exercises: [
            {
              exerciseId: "bench",
              sets: [
                { exerciseId: "bench", setIndex: 1, reps: 10, rpe: 8, load: 200 },
                { exerciseId: "bench", setIndex: 2, reps: 10, rpe: 8, load: 180 },
              ],
            },
          ],
        },
      ],
      baselines: [],
      exerciseById: { bench },
      primaryGoal: "hypertrophy",
      profile: { trainingAge: "intermediate" },
      periodization: {
        rpeOffset: -2,
        setMultiplier: 0.5,
        backOffMultiplier: 0.75,
        isDeload: true,
      },
    });

    expect(result.mainLifts[0].sets[0].targetLoad).toBe(150);
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
    expect(swappedLoad).toBeGreaterThanOrEqual(16);
    expect(swappedLoad).toBeLessThanOrEqual(18);
    expect(swappedLoad).not.toBe(40);
  });

  it("reduces early cable progression confidence without changing the modal history anchor", () => {
    const result = applyLoadsWithAudit(upperAccessoryWorkout, {
      history: [
        {
          date: "2026-03-20T00:00:00.000Z",
          completed: true,
          status: "COMPLETED",
          sessionIntent: "upper",
          selectionMode: "INTENT",
          confidence: 1,
          confidenceNotes: ["Previous INTENT history kept full progression confidence."],
          exercises: [
            {
              exerciseId: "cable-curl",
              sets: [
                { exerciseId: "cable-curl", setIndex: 1, reps: 15, rpe: 7, load: 40 },
                { exerciseId: "cable-curl", setIndex: 2, reps: 15, rpe: 7, load: 40 },
              ],
            },
          ],
        },
      ],
      baselines: [],
      exerciseById: { "cable-curl": cableCurl },
      primaryGoal: "hypertrophy",
      profile: { trainingAge: "intermediate" },
      sessionIntent: "upper",
    });

    const trace = result.audit.progressionTraces["cable-curl"];
    expect(trace.anchor.anchorLoad).toBe(40);
    expect(trace.confidence.priorSessionCount).toBe(1);
    expect(trace.confidence.historyScale).toBe(0.85);
    expect(trace.confidence.combinedScale).toBe(0.68);
    expect(trace.confidence.reasons).toContain(
      "low load-reliability equipment scaled during early exposure."
    );
  });

  it("does not apply cable calibration confidence after three prior sessions", () => {
    const result = applyLoadsWithAudit(upperAccessoryWorkout, {
      history: [1, 2, 3].map((index) => ({
        date: `2026-03-${20 - index}T00:00:00.000Z`,
        completed: true,
        status: "COMPLETED" as const,
        sessionIntent: "upper" as const,
        selectionMode: "INTENT" as const,
        confidence: 1,
        confidenceNotes: ["Previous INTENT history kept full progression confidence."],
        exercises: [
          {
            exerciseId: "cable-curl",
            sets: [
              { exerciseId: "cable-curl", setIndex: 1, reps: 15, rpe: 7, load: 40 },
              { exerciseId: "cable-curl", setIndex: 2, reps: 15, rpe: 7, load: 40 },
            ],
          },
        ],
      })),
      baselines: [],
      exerciseById: { "cable-curl": cableCurl },
      primaryGoal: "hypertrophy",
      profile: { trainingAge: "intermediate" },
      sessionIntent: "upper",
    });

    const trace = result.audit.progressionTraces["cable-curl"];
    expect(trace.confidence.priorSessionCount).toBe(3);
    expect(trace.confidence.historyScale).toBe(1);
    expect(trace.confidence.combinedScale).toBe(1);
    expect(trace.confidence.reasons).not.toContain(
      "low load-reliability equipment scaled during early exposure."
    );
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

    expect(result.mainLifts[0].sets[0].targetLoad).toBe(190);
  });

  it("promotes the next written load when prior performed sets materially overshot prescription", () => {
    const squat: Exercise = {
      id: "back-squat",
      name: "Back Squat",
      movementPatterns: ["squat"],
      splitTags: ["legs"],
      jointStress: "high",
      isMainLiftEligible: true,
      isCompound: true,
      fatigueCost: 4,
      equipment: ["barbell", "rack"],
      primaryMuscles: ["Quads"],
      repRangeMin: 5,
      repRangeMax: 10,
    };
    const workout: WorkoutPlan = {
      id: "w-overshoot",
      scheduledDate: "2026-02-20T00:00:00.000Z",
      warmup: [],
      mainLifts: [
        {
          id: "we-overshoot",
          exercise: squat,
          orderIndex: 0,
          isMainLift: true,
          sets: [{ setIndex: 1, targetReps: 8, targetRpe: 8 }],
        },
      ],
      accessories: [],
      estimatedMinutes: 35,
    };

    const result = applyLoads(workout, {
      history: [
        {
          date: "2026-02-19T00:00:00.000Z",
          completed: true,
          status: "COMPLETED",
          sessionIntent: "legs",
          exercises: [
            {
              exerciseId: "back-squat",
              sets: [
                { exerciseId: "back-squat", setIndex: 1, reps: 8, rpe: 7.5, load: 145, targetLoad: 135 },
                { exerciseId: "back-squat", setIndex: 2, reps: 8, rpe: 8, load: 145, targetLoad: 135 },
                { exerciseId: "back-squat", setIndex: 3, reps: 7, rpe: 8, load: 140, targetLoad: 135 },
              ],
            },
          ],
        },
      ],
      baselines: [],
      exerciseById: { "back-squat": squat },
      primaryGoal: "hypertrophy",
      profile: { trainingAge: "intermediate" },
      sessionIntent: "legs",
    });

    expect(result.mainLifts[0].sets[0].targetLoad).toBe(150);
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

    expect(result.accessories[0].sets[0].targetLoad).toBe(22.5);
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

  it("ignores 0 lb bodyweight donors when estimating first-time external machine loads", () => {
    const dip: Exercise = {
      id: "dip-bodyweight",
      name: "Dip",
      movementPatterns: ["vertical_push"],
      splitTags: ["push"],
      jointStress: "medium",
      isMainLiftEligible: false,
      isCompound: true,
      fatigueCost: 3,
      equipment: ["bodyweight", "machine"],
      primaryMuscles: ["Chest", "Triceps", "Shoulders"],
      repRangeMin: 6,
      repRangeMax: 15,
    };
    const machineShoulderPress: Exercise = {
      id: "machine-shoulder-press",
      name: "Machine Shoulder Press",
      movementPatterns: ["vertical_push"],
      splitTags: ["push"],
      jointStress: "medium",
      isMainLiftEligible: false,
      isCompound: true,
      fatigueCost: 3,
      equipment: ["machine"],
      primaryMuscles: ["Shoulders", "Triceps"],
      repRangeMin: 8,
      repRangeMax: 15,
    };
    const workout: WorkoutPlan = {
      id: "w13",
      scheduledDate: "2026-02-20T00:00:00.000Z",
      warmup: [],
      mainLifts: [],
      accessories: [
        {
          id: "we13",
          exercise: machineShoulderPress,
          orderIndex: 0,
          isMainLift: false,
          sets: [{ setIndex: 1, targetReps: 10, targetRpe: 8.5 }],
        },
      ],
      estimatedMinutes: 20,
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
              exerciseId: "dip-bodyweight",
              sets: [
                { exerciseId: "dip-bodyweight", setIndex: 1, reps: 12, rpe: 8, load: 0 },
                { exerciseId: "dip-bodyweight", setIndex: 2, reps: 10, rpe: 9, load: 0 },
              ],
            },
          ],
        },
      ],
      baselines: [],
      exerciseById: {
        "dip-bodyweight": dip,
        "machine-shoulder-press": machineShoulderPress,
      },
      primaryGoal: "hypertrophy",
      profile: { trainingAge: "intermediate" },
      sessionIntent: "push",
    });

    expect(result.accessories[0].sets[0].targetLoad).toBe(57.5);
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

  it("keeps same-intent exact main-lift history as the winning source over cross-intent fallback", () => {
    const result = applyLoadsWithAudit(upperMainLiftWorkout, {
      history: [
        {
          date: "2026-03-27T00:00:00.000Z",
          completed: true,
          status: "COMPLETED",
          sessionIntent: "upper",
          exercises: [
            {
              exerciseId: "db-ohp",
              sets: [
                { exerciseId: "db-ohp", setIndex: 1, reps: 10, rpe: 7, load: 40 },
                { exerciseId: "db-ohp", setIndex: 2, reps: 10, rpe: 7, load: 40 },
                { exerciseId: "db-ohp", setIndex: 3, reps: 10, rpe: 7, load: 40 },
              ],
            },
          ],
        },
        {
          date: "2026-03-20T00:00:00.000Z",
          completed: true,
          status: "COMPLETED",
          sessionIntent: "push",
          exercises: [
            {
              exerciseId: "db-ohp",
              sets: [
                { exerciseId: "db-ohp", setIndex: 1, reps: 7, rpe: 8.5, load: 55 },
                { exerciseId: "db-ohp", setIndex: 2, reps: 7, rpe: 8.5, load: 55 },
              ],
            },
          ],
        },
      ],
      baselines: [],
      exerciseById: { "db-ohp": dumbbellOverheadPress },
      primaryGoal: "hypertrophy",
      profile: { trainingAge: "intermediate" },
      sessionIntent: "upper",
    });

    expect(result.audit.resolvedLoads["db-ohp"]?.source).toBe("history");
    expect(result.workout.mainLifts[0].sets[0].targetLoad).toBe(42.5);
    expect(result.workout.mainLifts[0].sets[1].targetLoad).toBe(42.5);
  });

  it("corrects DB OHP undercalling on exact cross-intent fallback without jumping past prior performance", () => {
    const result = applyLoadsWithAudit(upperMainLiftWorkout, {
      history: [
        {
          date: "2026-03-20T00:00:00.000Z",
          completed: true,
          status: "COMPLETED",
          sessionIntent: "push",
          exercises: [
            {
              exerciseId: "db-ohp",
              sets: [
                { exerciseId: "db-ohp", setIndex: 1, reps: 7, rpe: 8.5, load: 45 },
                { exerciseId: "db-ohp", setIndex: 2, reps: 7, rpe: 8, load: 45 },
                { exerciseId: "db-ohp", setIndex: 3, reps: 7, rpe: 8, load: 45 },
                { exerciseId: "db-ohp", setIndex: 4, reps: 7, rpe: 8.5, load: 45 },
              ],
            },
          ],
        },
      ],
      baselines: [],
      exerciseById: { "db-ohp": dumbbellOverheadPress },
      primaryGoal: "hypertrophy",
      profile: { trainingAge: "intermediate" },
      sessionIntent: "upper",
    });

    const topLoad = result.workout.mainLifts[0].sets[0].targetLoad ?? 0;
    expect(result.audit.resolvedLoads["db-ohp"]?.source).toBe("history");
    expect(topLoad).toBe(37.5);
    expect(topLoad).toBeGreaterThan(25);
    expect(topLoad).toBeLessThan(45);
    expect(result.workout.mainLifts[0].sets[1].targetLoad).toBe(37.5);
    expect(result.workout.mainLifts[0].sets[0].targetRpe).toBe(6.5);
  });

  it("corrects back squat undercalling on exact cross-intent fallback", () => {
    const workout: WorkoutPlan = {
      id: "w-back-squat-fallback",
      scheduledDate: "2026-03-28T00:00:00.000Z",
      warmup: [],
      mainLifts: [
        {
          id: "we-back-squat-fallback",
          exercise: backSquat,
          orderIndex: 0,
          isMainLift: true,
          sets: [
            { setIndex: 1, targetReps: 10, targetRpe: 6.5 },
            { setIndex: 2, targetReps: 10, targetRpe: 6.5 },
            { setIndex: 3, targetReps: 10, targetRpe: 6.5 },
          ],
        },
      ],
      accessories: [],
      estimatedMinutes: 40,
    };

    const result = applyLoadsWithAudit(workout, {
      history: [
        {
          date: "2026-03-20T00:00:00.000Z",
          completed: true,
          status: "COMPLETED",
          sessionIntent: "legs",
          exercises: [
            {
              exerciseId: "back-squat",
              sets: [
                { exerciseId: "back-squat", setIndex: 1, reps: 8, rpe: 7.5, load: 185 },
                { exerciseId: "back-squat", setIndex: 2, reps: 8, rpe: 7.5, load: 185 },
              ],
            },
          ],
        },
      ],
      baselines: [],
      exerciseById: { "back-squat": backSquat },
      primaryGoal: "hypertrophy",
      profile: { trainingAge: "intermediate" },
      sessionIntent: "lower",
    });

    expect(result.audit.resolvedLoads["back-squat"]?.source).toBe("history");
    expect(result.workout.mainLifts[0].sets[0].targetLoad).toBe(160);
    expect(result.workout.mainLifts[0].sets[1].targetLoad).toBe(160);
  });

  it("improves belt squat exact cross-intent fallback while keeping it bounded below the prior working load", () => {
    const result = applyLoadsWithAudit(lowerMainLiftWorkout, {
      history: [
        {
          date: "2026-03-20T00:00:00.000Z",
          completed: true,
          status: "COMPLETED",
          sessionIntent: "legs",
          exercises: [
            {
              exerciseId: "belt-squat",
              sets: [
                { exerciseId: "belt-squat", setIndex: 1, reps: 8, rpe: 7.5, load: 180 },
                { exerciseId: "belt-squat", setIndex: 2, reps: 8, rpe: 7.5, load: 180 },
                { exerciseId: "belt-squat", setIndex: 3, reps: 8, rpe: 8, load: 180 },
              ],
            },
          ],
        },
      ],
      baselines: [],
      exerciseById: { "belt-squat": beltSquat },
      primaryGoal: "hypertrophy",
      profile: { trainingAge: "intermediate" },
      sessionIntent: "lower",
    });

    expect(result.audit.resolvedLoads["belt-squat"]?.source).toBe("history");
    expect(result.workout.mainLifts[0].sets[0].targetLoad).toBe(150);
    expect(result.workout.mainLifts[0].sets[0].targetLoad).toBeLessThan(180);
    expect(result.workout.mainLifts[0].sets[1].targetLoad).toBe(150);
  });

  it("does not broaden donor pooling globally when only cross-intent non-exact history exists", () => {
    const result = applyLoadsWithAudit(lowerMainLiftWorkout, {
      history: [
        {
          date: "2026-03-20T00:00:00.000Z",
          completed: true,
          status: "COMPLETED",
          sessionIntent: "legs",
          exercises: [
            {
              exerciseId: "back-squat",
              sets: [
                { exerciseId: "back-squat", setIndex: 1, reps: 8, rpe: 7.5, load: 185 },
                { exerciseId: "back-squat", setIndex: 2, reps: 8, rpe: 7.5, load: 185 },
              ],
            },
          ],
        },
      ],
      baselines: [],
      exerciseById: {
        "belt-squat": beltSquat,
        "back-squat": backSquat,
      },
      primaryGoal: "hypertrophy",
      profile: { trainingAge: "intermediate" },
      sessionIntent: "lower",
    });

    expect(result.audit.resolvedLoads["belt-squat"]?.source).toBe("estimate");
    expect(result.workout.mainLifts[0].sets[0].targetLoad).toBe(57.5);
  });

  it("keeps pulldown fallback on the default conservative path", () => {
    const workout: WorkoutPlan = {
      id: "w-pulldown-fallback",
      scheduledDate: "2026-03-28T00:00:00.000Z",
      warmup: [],
      mainLifts: [
        {
          id: "we-pulldown-fallback",
          exercise: latPulldown,
          orderIndex: 0,
          isMainLift: true,
          sets: [
            { setIndex: 1, targetReps: 10, targetRpe: 6.5 },
            { setIndex: 2, targetReps: 10, targetRpe: 6.5 },
          ],
        },
      ],
      accessories: [],
      estimatedMinutes: 30,
    };

    const result = applyLoadsWithAudit(workout, {
      history: [
        {
          date: "2026-03-20T00:00:00.000Z",
          completed: true,
          status: "COMPLETED",
          sessionIntent: "pull",
          exercises: [
            {
              exerciseId: "lat-pulldown",
              sets: [
                { exerciseId: "lat-pulldown", setIndex: 1, reps: 8, rpe: 7.5, load: 120 },
                { exerciseId: "lat-pulldown", setIndex: 2, reps: 8, rpe: 7.5, load: 120 },
              ],
            },
          ],
        },
      ],
      baselines: [],
      exerciseById: { "lat-pulldown": latPulldown },
      primaryGoal: "hypertrophy",
      profile: { trainingAge: "intermediate" },
      sessionIntent: "upper",
    });

    expect(result.audit.resolvedLoads["lat-pulldown"]?.source).toBe("history");
    expect(result.workout.mainLifts[0].sets[0].targetLoad).toBe(50);
  });

  it("keeps SLDL on the previous conservative fallback behavior", () => {
    const workout: WorkoutPlan = {
      id: "w-sldl-fallback",
      scheduledDate: "2026-03-28T00:00:00.000Z",
      warmup: [],
      mainLifts: [
        {
          id: "we-sldl-fallback",
          exercise: stiffLegDeadlift,
          orderIndex: 0,
          isMainLift: true,
          sets: [
            { setIndex: 1, targetReps: 10, targetRpe: 6.5 },
            { setIndex: 2, targetReps: 10, targetRpe: 6.5 },
          ],
        },
      ],
      accessories: [],
      estimatedMinutes: 35,
    };

    const result = applyLoadsWithAudit(workout, {
      history: [
        {
          date: "2026-03-20T00:00:00.000Z",
          completed: true,
          status: "COMPLETED",
          sessionIntent: "legs",
          exercises: [
            {
              exerciseId: "sldl",
              sets: [
                { exerciseId: "sldl", setIndex: 1, reps: 8, rpe: 7.5, load: 185 },
                { exerciseId: "sldl", setIndex: 2, reps: 8, rpe: 7.5, load: 185 },
              ],
            },
          ],
        },
      ],
      baselines: [],
      exerciseById: { sldl: stiffLegDeadlift },
      primaryGoal: "hypertrophy",
      profile: { trainingAge: "intermediate" },
      sessionIntent: "lower",
    });

    expect(result.audit.resolvedLoads["sldl"]?.source).toBe("history");
    expect(result.workout.mainLifts[0].sets[0].targetLoad).toBe(82.5);
  });

  it("keeps accessories on the existing estimate path when only cross-intent exact history exists", () => {
    const result = applyLoadsWithAudit(upperAccessoryWorkout, {
      history: [
        {
          date: "2026-03-20T00:00:00.000Z",
          completed: true,
          status: "COMPLETED",
          sessionIntent: "pull",
          exercises: [
            {
              exerciseId: "cable-curl",
              sets: [
                { exerciseId: "cable-curl", setIndex: 1, reps: 12, rpe: 8, load: 30 },
                { exerciseId: "cable-curl", setIndex: 2, reps: 12, rpe: 8, load: 30 },
              ],
            },
          ],
        },
      ],
      baselines: [],
      exerciseById: { "cable-curl": cableCurl },
      primaryGoal: "hypertrophy",
      profile: { trainingAge: "intermediate" },
      sessionIntent: "upper",
    });

    expect(result.audit.resolvedLoads["cable-curl"]?.source).toBe("estimate");
    expect(result.workout.accessories[0].sets[0].targetLoad).toBe(35);
  });

  it("resolves mixed cable and machine equipment as cable for cold-start estimates", () => {
    const workout: WorkoutPlan = {
      id: "w-mixed-cable-machine",
      scheduledDate: "2026-03-28T00:00:00.000Z",
      warmup: [],
      mainLifts: [],
      accessories: [
        {
          id: "we-mixed-cable-machine",
          exercise: cableMachineCurl,
          orderIndex: 0,
          isMainLift: false,
          sets: [{ setIndex: 1, targetReps: 12, targetRpe: 8 }],
        },
      ],
      estimatedMinutes: 20,
    };

    const result = applyLoadsWithAudit(workout, {
      history: [],
      baselines: [],
      exerciseById: { "cable-machine-curl": cableMachineCurl },
      primaryGoal: "hypertrophy",
      profile: { trainingAge: "intermediate" },
    });

    expect(result.audit.resolvedLoads["cable-machine-curl"]?.source).toBe("estimate");
    expect(result.workout.accessories[0].sets[0].targetLoad).toBe(35);
  });

  it("does not scale explicit cable baseline loads", () => {
    const result = applyLoadsWithAudit(upperAccessoryWorkout, {
      history: [],
      baselines: [{ exerciseId: "cable-curl", context: "volume", topSetWeight: 40 }],
      exerciseById: { "cable-curl": cableCurl },
      primaryGoal: "hypertrophy",
      profile: { trainingAge: "intermediate" },
      sessionIntent: "upper",
    });

    expect(result.audit.resolvedLoads["cable-curl"]?.source).toBe("baseline");
    expect(result.workout.accessories[0].sets[0].targetLoad).toBe(40);
  });

  it("holds accessory load when discounted MANUAL history collapses the increment", () => {
    const cableRaise: Exercise = {
      id: "discounted-manual-raise",
      name: "Discounted Manual Raise",
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
      id: "w12",
      scheduledDate: "2026-02-20T00:00:00.000Z",
      warmup: [],
      mainLifts: [],
      accessories: [
        {
          id: "we12",
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
          confidence: 0.3,
          confidenceNotes: [
            "MANUAL history was heavily discounted because it looked unreliable: every set reported the same RPE.",
          ],
          exercises: [
            {
              exerciseId: "discounted-manual-raise",
              sets: [{ exerciseId: "discounted-manual-raise", setIndex: 1, reps: 12, rpe: 7, load: 40 }],
            },
          ],
        },
        {
          date: "2026-02-18T00:00:00.000Z",
          completed: true,
          status: "COMPLETED",
          selectionMode: "MANUAL",
          confidence: 0.3,
          confidenceNotes: [
            "MANUAL history was heavily discounted because it looked unreliable: every set reported the same RPE.",
          ],
          exercises: [
            {
              exerciseId: "discounted-manual-raise",
              sets: [{ exerciseId: "discounted-manual-raise", setIndex: 1, reps: 12, rpe: 7, load: 40 }],
            },
          ],
        },
        {
          date: "2026-02-14T00:00:00.000Z",
          completed: true,
          status: "COMPLETED",
          selectionMode: "INTENT",
          confidence: 1,
          confidenceNotes: ["Previous INTENT history kept full progression confidence."],
          exercises: [
            {
              exerciseId: "discounted-manual-raise",
              sets: [{ exerciseId: "discounted-manual-raise", setIndex: 1, reps: 12, rpe: 7, load: 40 }],
            },
          ],
        },
      ],
      baselines: [],
      exerciseById: { "discounted-manual-raise": cableRaise },
      primaryGoal: "hypertrophy",
      profile: { trainingAge: "intermediate" },
    });

    expect(result.accessories[0].sets[0].targetLoad).toBe(40);
  });

  it("uses W4 accumulation history (not deload history) as baseline source on a new mesocycle start", () => {
    const result = applyLoads(baseWorkout, {
      history: [
        {
          date: "2026-02-25T00:00:00.000Z",
          completed: true,
          status: "COMPLETED",
          sessionIntent: "push",
          mesocycleSnapshot: { phase: "DELOAD", week: 5 },
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
          mesocycleSnapshot: { phase: "ACCUMULATION", week: 4 },
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

    expect(result.mainLifts[0].sets[0].targetLoad).toBe(205);
  });

  it("falls back from missing W4 to highest accumulation week, then to non-deload performed history", () => {
    const w4MissingResult = applyLoads(baseWorkout, {
      history: [
        {
          date: "2026-02-25T00:00:00.000Z",
          completed: true,
          status: "COMPLETED",
          sessionIntent: "push",
          mesocycleSnapshot: { phase: "DELOAD", week: 5 },
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
          mesocycleSnapshot: { phase: "ACCUMULATION", week: 3 },
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
          mesocycleSnapshot: { phase: "ACCUMULATION", week: 2 },
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
          mesocycleSnapshot: { phase: "ACTIVE_DELOAD", week: 5 },
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

    expect(w4MissingResult.mainLifts[0].sets[0].targetLoad).toBe(175);
    expect(noAccumulationSnapshotResult.mainLifts[0].sets[0].targetLoad).toBe(165);
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
    // Both should progress above 200 (working-set RPE 7.5 -> double progression)
    expect(zeroBasedTop).toBeGreaterThan(200);
    expect(zeroBasedTop).toBe(oneBasedTop);
  });
});
